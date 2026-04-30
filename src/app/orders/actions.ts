'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export type OrderItemInput = { productId: string; quantity: number };
export type CreateOrderInput = {
    customerId: string;          // 거래처 (customer 로그인 시 자동, staff는 폼에서)
    deliveryAddressId: string;
    orderDate: string;           // YYYY-MM-DD
    deliveryDate: string;        // YYYY-MM-DD
    items: OrderItemInput[];
    memo?: string;
};

export type CreateOrderResult =
    | { ok: true; orderId: string; orderNo: string }
    | { ok: false; error: string };

/**
 * 주문 생성 (거래처/직원 공통)
 * - 거래처 로그인: customerId가 본인과 일치해야 함
 * - 직원 로그인: 어떤 거래처든 가능
 * - 모든 필수값 검증
 */
export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };

    // ── 입력 검증 ───────────────────────────────────────────────
    if (!input.customerId) return { ok: false, error: '거래처를 선택해주세요.' };
    if (!input.deliveryAddressId) return { ok: false, error: '도착지를 선택해주세요.' };
    if (!input.orderDate) return { ok: false, error: '주문일자를 입력해주세요.' };
    if (!input.deliveryDate) return { ok: false, error: '도착일자를 입력해주세요.' };
    if (!input.items || input.items.length === 0)
        return { ok: false, error: '제품을 1개 이상 선택해주세요.' };

    for (const it of input.items) {
        if (!it.productId) return { ok: false, error: '모든 제품을 선택해주세요.' };
        if (!Number.isFinite(it.quantity) || it.quantity <= 0)
            return { ok: false, error: '모든 제품의 수량을 입력해주세요.' };
    }

    // ── 권한 검증 ───────────────────────────────────────────────
    if (session.user.userKind === 'customer') {
        if (session.user.customerId !== input.customerId) {
            return { ok: false, error: '본인 거래처의 주문만 생성할 수 있습니다.' };
        }
    }

    // ── 도착지 검증 ─────────────────────────────────────────────
    const addr = await prisma.deliveryAddress.findUnique({
        where: { id: input.deliveryAddressId },
        select: { id: true, customerId: true, isActive: true },
    });
    if (!addr || addr.customerId !== input.customerId || !addr.isActive) {
        return { ok: false, error: '도착지가 거래처와 일치하지 않습니다.' };
    }

    // ── 주문번호 생성: HY-YYMMDD-NNNN ───────────────────────────
    const today = new Date(input.orderDate + 'T00:00:00');
    const yymmdd =
        String(today.getFullYear()).slice(2) +
        String(today.getMonth() + 1).padStart(2, '0') +
        String(today.getDate()).padStart(2, '0');
    const startOfDay = new Date(today);
    const endOfDay = new Date(today);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const todaysCount = await prisma.order.count({
        where: { createdAt: { gte: startOfDay, lt: endOfDay } },
    });
    const orderNo = `HY-${yymmdd}-${String(todaysCount + 1).padStart(4, '0')}`;

    // ── 트랜잭션으로 주문 생성 ──────────────────────────────────
    try {
        const order = await prisma.$transaction(async (tx) => {
            const created = await tx.order.create({
                data: {
                    orderNo,
                    customerId: input.customerId,
                    deliveryAddressId: input.deliveryAddressId,
                    requestedByUserId:
                        session.user.userKind === 'staff' ? session.user.id : undefined,
                    requestedByCustomerUserId:
                        session.user.userKind === 'customer' ? session.user.id : undefined,
                    orderSource:
                        session.user.userKind === 'customer' ? 'CUSTOMER_PORTAL' : 'SALES_MANUAL',
                    status: 'REQUESTED',
                    requestedDeliveryDate: new Date(input.deliveryDate + 'T00:00:00'),
                    memo: input.memo,
                    items: {
                        create: input.items.map((it) => ({
                            productId: it.productId,
                            requestedQuantity: it.quantity,
                            unit: 'TON',
                        })),
                    },
                    statusHistory: {
                        create: {
                            previousStatus: null,
                            newStatus: 'REQUESTED',
                            changedByUserId:
                                session.user.userKind === 'staff' ? session.user.id : undefined,
                            changeReason: '주문 등록',
                        },
                    },
                },
            });
            return created;
        });

        // 화이트리스트 자동 추가 (거래처별 자주 주문하는 제품 학습)
        for (const it of input.items) {
            await prisma.customerProductWhitelist.upsert({
                where: {
                    customerId_productId: {
                        customerId: input.customerId,
                        productId: it.productId,
                    },
                },
                update: {
                    lastOrderedAt: new Date(),
                    totalOrderCount: { increment: 1 },
                },
                create: {
                    customerId: input.customerId,
                    productId: it.productId,
                    firstOrderedAt: new Date(),
                    lastOrderedAt: new Date(),
                    totalOrderCount: 1,
                    isVisibleInPortal: true,
                },
            });
        }

        revalidatePath('/admin');
        revalidatePath('/portal');

        return { ok: true, orderId: order.id, orderNo: order.orderNo };
    } catch (e) {
        console.error('createOrder failed:', e);
        return { ok: false, error: '주문 저장 중 오류가 발생했습니다.' };
    }
}

// ─────────────────────────────────────────────────────────────
// 주문 상태 변경 (직원 전용): 승인 / 보류 / 반려 / 취소
// ─────────────────────────────────────────────────────────────
export type ChangeStatusResult = { ok: true } | { ok: false; error: string };

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
    REQUESTED: ['APPROVED', 'ON_HOLD', 'REJECTED', 'PENDING_SALES_REVIEW'],
    PENDING_SALES_REVIEW: ['APPROVED', 'ON_HOLD', 'REJECTED'],
    ON_HOLD: ['APPROVED', 'REJECTED', 'REQUESTED'],
    APPROVED: ['DISPATCH_WAITING', 'CANCELLED'],
};

export async function changeOrderStatus(
    orderId: string,
    nextStatus: string,
    reason?: string,
): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff') {
        return { ok: false, error: '직원만 상태를 변경할 수 있습니다.' };
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { ok: false, error: '주문을 찾을 수 없습니다.' };

    const allowed = ALLOWED_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(nextStatus)) {
        return {
            ok: false,
            error: `'${order.status}' 상태에서 '${nextStatus}' 로 변경할 수 없습니다.`,
        };
    }

    try {
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: { status: nextStatus },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: nextStatus,
                    changedByUserId: session.user.id,
                    changeReason: reason ?? null,
                },
            });
        });
        revalidatePath('/admin');
        revalidatePath(`/admin/orders/${orderId}`);
        revalidatePath('/portal');
        return { ok: true };
    } catch (e) {
        console.error('changeOrderStatus failed:', e);
        return { ok: false, error: '상태 변경 중 오류가 발생했습니다.' };
    }
}

// 거래처 본인 주문 취소 (REQUESTED 상태일 때만)
export async function cancelOwnOrder(orderId: string): Promise<ChangeStatusResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'customer') {
        return { ok: false, error: '거래처 계정만 가능합니다.' };
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { ok: false, error: '주문을 찾을 수 없습니다.' };
    if (order.customerId !== session.user.customerId) {
        return { ok: false, error: '본인 주문만 취소할 수 있습니다.' };
    }
    if (order.status !== 'REQUESTED') {
        return {
            ok: false,
            error: '이미 영업팀에서 처리 중이라 취소할 수 없습니다. 담당자에게 연락해주세요.',
        };
    }

    try {
        await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id: orderId },
                data: { status: 'CANCELLED' },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId,
                    previousStatus: order.status,
                    newStatus: 'CANCELLED',
                    changeReason: `거래처 자가 취소 (${session.user.name ?? session.user.id})`,
                },
            });
        });
        revalidatePath('/portal');
        revalidatePath(`/portal/orders/${orderId}`);
        revalidatePath('/admin');
        return { ok: true };
    } catch (e) {
        console.error('cancelOwnOrder failed:', e);
        return { ok: false, error: '취소 중 오류가 발생했습니다.' };
    }
}

