'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type { Brand, ProductGroup } from '@/lib/price-constants';

// BRANDS, PRODUCT_GROUPS는 src/lib/price-constants.ts 에서 import해서 사용하세요.

// ─────────────────────────────────────────────────────────────
// 현재 실효 단가 계산
// manufacturer → brand, category → productGroup 매핑 후
// basePrice + 해당 월까지 누적 delta 합산
// ─────────────────────────────────────────────────────────────
export async function getEffectivePrice(productId: string, forMonth?: string): Promise<number> {
    const month = forMonth ?? new Date().toISOString().slice(0, 7); // "YYYY-MM"

    const pp = await prisma.productPrice.findUnique({
        where: { productId },
        include: { product: true },
    });
    if (!pp) return 0;

    const brand = normalizeBrand(pp.product.manufacturer ?? '');
    const group = normalizeGroup(pp.product.category ?? '');

    // 해당 월 이전(포함) 조정값 합산
    const adjs = await prisma.priceAdjustment.findMany({
        where: {
            brand,
            productGroup: group,
            effectiveMonth: { lte: month },
        },
        select: { delta: true },
    });
    const totalDelta = adjs.reduce((s, a) => s + a.delta, 0);
    return Math.max(0, pp.basePrice + totalDelta);
}

// ─────────────────────────────────────────────────────────────
// 여신 시뮬레이션: 현재 미수 + 이번 오더 예상금액 vs 한도
// ─────────────────────────────────────────────────────────────
export type CreditSimResult = {
    ok: true;
    customerId: string;
    companyName: string;
    creditLimit: number;
    currentReceivable: number;
    estimatedOrderAmount: number;
    projectedTotal: number;
    isOver: boolean;
    overAmount: number;
    items: {
        productId: string;
        productName: string;
        quantity: number;
        unit: string;
        unitPrice: number;
        lineTotal: number;
        hasPriceData: boolean;
    }[];
    existingOverride: {
        id: string;
        status: string;
        requestedAt: string;
    } | null;
} | { ok: false; error: string };

export async function simulateCreditCheck(orderId: string): Promise<CreditSimResult> {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') {
        return { ok: false, error: '직원만 접근 가능합니다.' };
    }

    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
            customer: true,
            items: { include: { product: true } },
            creditOverride: true,
        },
    });
    if (!order) return { ok: false, error: '주문을 찾을 수 없습니다.' };

    const today = new Date().toISOString().slice(0, 7);
    const itemResults = [];
    let estimatedTotal = 0;

    for (const item of order.items) {
        const unitPrice = await getEffectivePrice(item.productId, today);
        // 수량은 TON 기준
        const qty = item.unit === 'KG' ? item.requestedQuantity / 1000 : item.requestedQuantity;
        const lineTotal = unitPrice * qty;
        estimatedTotal += lineTotal;
        itemResults.push({
            productId: item.productId,
            productName: item.product.productName,
            quantity: qty,
            unit: 'TON',
            unitPrice,
            lineTotal,
            hasPriceData: unitPrice > 0,
        });
    }

    const receivable = order.customer.receivableAmount;
    const creditLimit = order.customer.creditLimit;
    const projected = receivable + estimatedTotal;
    const isOver = projected > creditLimit && creditLimit > 0;

    return {
        ok: true,
        customerId: order.customerId,
        companyName: order.customer.companyName,
        creditLimit,
        currentReceivable: receivable,
        estimatedOrderAmount: estimatedTotal,
        projectedTotal: projected,
        isOver,
        overAmount: Math.max(0, projected - creditLimit),
        items: itemResults,
        existingOverride: order.creditOverride
            ? {
                id: order.creditOverride.id,
                status: order.creditOverride.status,
                requestedAt: order.creditOverride.createdAt.toISOString(),
            }
            : null,
    };
}

// ─────────────────────────────────────────────────────────────
// 시뮬레이션 결과를 Order / OrderItem에 저장
// ─────────────────────────────────────────────────────────────
export async function saveSimulationResult(orderId: string) {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') return;

    const sim = await simulateCreditCheck(orderId);
    if (!sim.ok) return;

    await prisma.$transaction(async (tx) => {
        await tx.order.update({
            where: { id: orderId },
            data: { estimatedAmount: sim.estimatedOrderAmount },
        });
        for (const it of sim.items) {
            await tx.orderItem.updateMany({
                where: { orderId, productId: it.productId },
                data: { estimatedUnitPrice: it.unitPrice },
            });
        }
    });
}

// ─────────────────────────────────────────────────────────────
// 한도초과 승인 요청 생성
// ─────────────────────────────────────────────────────────────
export type OverrideResult = { ok: true; overrideId: string } | { ok: false; error: string };

export async function requestCreditOverride(orderId: string): Promise<OverrideResult> {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') {
        return { ok: false, error: '직원만 요청할 수 있습니다.' };
    }

    const sim = await simulateCreditCheck(orderId);
    if (!sim.ok) return { ok: false, error: sim.error };
    if (!sim.isOver) return { ok: false, error: '한도를 초과하지 않았습니다.' };

    // 기존 PENDING 요청이 있으면 재활용
    const existing = await prisma.creditOverrideRequest.findUnique({ where: { orderId } });
    if (existing) {
        if (existing.status === 'PENDING') {
            return { ok: true, overrideId: existing.id };
        }
        // REJECTED → 새로 요청 (기존 삭제 후 재생성)
        await prisma.creditOverrideRequest.delete({ where: { orderId } });
    }

    await saveSimulationResult(orderId);

    const override = await prisma.creditOverrideRequest.create({
        data: {
            orderId,
            currentReceivable: sim.currentReceivable,
            creditLimit: sim.creditLimit,
            overAmount: sim.overAmount,
            status: 'PENDING',
            requestedById: session.user.id,
        },
    });

    // TODO: 카카오 알림톡 → 양희철 알림 (mock)
    console.log(`[알림] 여신 한도초과 승인 요청: ${sim.companyName} +${sim.overAmount.toLocaleString('ko-KR')}원 초과`);

    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath('/admin/credit-overrides');
    return { ok: true, overrideId: override.id };
}

// ─────────────────────────────────────────────────────────────
// 한도초과 승인 (EXECUTIVE만)
// ─────────────────────────────────────────────────────────────
export type ReviewResult = { ok: true } | { ok: false; error: string };

export async function approveCreditOverride(overrideId: string): Promise<ReviewResult> {
    const session = await auth();
    if (!session?.user || session.user.role !== 'EXECUTIVE') {
        return { ok: false, error: '대표(양희철)만 승인할 수 있습니다.' };
    }

    const override = await prisma.creditOverrideRequest.findUnique({
        where: { id: overrideId },
        include: { order: true },
    });
    if (!override) return { ok: false, error: '요청을 찾을 수 없습니다.' };
    if (override.status !== 'PENDING') return { ok: false, error: '이미 처리된 요청입니다.' };

    await prisma.creditOverrideRequest.update({
        where: { id: overrideId },
        data: { status: 'APPROVED', reviewedById: session.user.id, reviewedAt: new Date() },
    });

    revalidatePath(`/admin/orders/${override.orderId}`);
    revalidatePath('/admin/credit-overrides');
    return { ok: true };
}

export async function rejectCreditOverride(overrideId: string, reason: string): Promise<ReviewResult> {
    const session = await auth();
    if (!session?.user || session.user.role !== 'EXECUTIVE') {
        return { ok: false, error: '대표(양희철)만 처리할 수 있습니다.' };
    }

    const override = await prisma.creditOverrideRequest.findUnique({ where: { id: overrideId } });
    if (!override) return { ok: false, error: '요청을 찾을 수 없습니다.' };
    if (override.status !== 'PENDING') return { ok: false, error: '이미 처리된 요청입니다.' };

    await prisma.creditOverrideRequest.update({
        where: { id: overrideId },
        data: {
            status: 'REJECTED',
            reviewedById: session.user.id,
            reviewedAt: new Date(),
            rejectReason: reason,
        },
    });

    revalidatePath(`/admin/orders/${override.orderId}`);
    revalidatePath('/admin/credit-overrides');
    return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// 단가 관리
// ─────────────────────────────────────────────────────────────
export async function upsertProductBasePrice(
    productId: string,
    basePrice: number,
    memo?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
    const session = await auth();
    if (!session?.user || !['EXECUTIVE', 'ADMIN'].includes(session.user.role ?? '')) {
        return { ok: false, error: '관리자만 단가를 설정할 수 있습니다.' };
    }
    await prisma.productPrice.upsert({
        where: { productId },
        update: { basePrice, memo: memo ?? null, updatedById: session.user.id },
        create: { id: crypto.randomUUID(), productId, basePrice, memo: memo ?? null, updatedById: session.user.id },
    });
    revalidatePath('/admin/prices');
    return { ok: true };
}

export async function upsertPriceAdjustment(
    effectiveMonth: string,
    brand: string,
    productGroup: string,
    delta: number,
    memo?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
    const session = await auth();
    if (!session?.user || !['EXECUTIVE', 'ADMIN'].includes(session.user.role ?? '')) {
        return { ok: false, error: '관리자만 단가를 조정할 수 있습니다.' };
    }
    await prisma.priceAdjustment.upsert({
        where: { effectiveMonth_brand_productGroup: { effectiveMonth, brand, productGroup } },
        update: { delta, memo: memo ?? null, createdById: session.user.id },
        create: {
            id: crypto.randomUUID(),
            effectiveMonth,
            brand,
            productGroup,
            delta,
            memo: memo ?? null,
            createdById: session.user.id,
        },
    });
    revalidatePath('/admin/prices');
    return { ok: true };
}

export async function getPriceAdjustmentsForMonth(month: string) {
    return prisma.priceAdjustment.findMany({
        where: { effectiveMonth: month },
        orderBy: [{ brand: 'asc' }, { productGroup: 'asc' }],
    });
}

// ─────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────
function normalizeBrand(manufacturer: string): string {
    const m = manufacturer.toLowerCase();
    if (m.includes('한화')) return '한화';
    if (m.includes('롯데')) return '롯데';
    if (m.includes('lg') || m.includes('엘지')) return 'LG';
    if (m.includes('대한')) return '대한유화';
    return '기타';
}

function normalizeGroup(category: string): string {
    const c = category.toUpperCase();
    if (c.includes('MLLLD') || c.includes('MLLL')) return 'mLLDPE';
    if (c.includes('LLDPE')) return 'LLDPE';
    if (c.includes('LDPE')) return 'LDPE';
    if (c.includes('EVA')) return 'EVA';
    if (c.includes('HDPE')) return 'HDPE';
    return '기타';
}
