'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export type LedgerUpdateResult = { ok: true } | { ok: false; error: string };

function parseDateOnly(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    return new Date(`${value}T00:00:00`);
}

function parseOptionalPrice(value: number | null | undefined) {
    if (value == null) return null;
    if (!Number.isFinite(value) || value < 0) return Number.NaN;
    return value;
}

function dateToIso(value: Date | null | undefined) {
    return value ? value.toISOString().slice(0, 10) : '-';
}

function appendAuditMemo(memo: string | null, line: string) {
    return [memo?.trim(), line].filter(Boolean).join('\n');
}

export async function updateSalesLedgerDate(input: {
    itemId: string;
    salesDate: string;
    reason: string;
}): Promise<LedgerUpdateResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff' || session.user.name !== '양희철') {
        return { ok: false, error: '원장 수정은 양희철만 가능합니다.' };
    }

    const salesDate = parseDateOnly(input.salesDate);
    if (!salesDate) return { ok: false, error: '매출일자를 확인해 주세요.' };
    if (!input.reason.trim()) return { ok: false, error: '변경 사유를 입력해 주세요.' };

    if (input.itemId.startsWith('ledger:')) {
        const ledgerEntryId = input.itemId.slice('ledger:'.length);
        const entry = await prisma.ledgerEntry.findUnique({
            where: { id: ledgerEntryId },
            include: { order: { select: { id: true, orderNo: true, status: true } } },
        });
        if (!entry || entry.ledgerType !== 'SALES' || !entry.customerId) {
            return { ok: false, error: '이관 매출 원장 항목을 찾을 수 없습니다.' };
        }

        const previousDate = entry.transactionDate;
        await prisma.$transaction(async (tx) => {
            await tx.ledgerEntry.update({
                where: { id: ledgerEntryId },
                data: {
                    transactionDate: salesDate,
                    memo: appendAuditMemo(entry.memo, `[매출일자 변경] ${dateToIso(previousDate)} → ${input.salesDate} / ${input.reason.trim()}`),
                },
            });
            if (entry.order) {
                await tx.orderStatusHistory.create({
                    data: {
                        orderId: entry.order.id,
                        previousStatus: entry.order.status,
                        newStatus: entry.order.status,
                        changedByUserId: session.user.id,
                        changeReason: `[이관 매출일자 변경] 오더 ${entry.order.orderNo} / ${dateToIso(previousDate)} → ${input.salesDate} / ${input.reason.trim()}`,
                    },
                });
            }
        });

        revalidatePath('/admin');
        revalidatePath(`/admin/customers/${entry.customerId}/ledger`);
        if (entry.orderId) revalidatePath(`/admin/orders/${entry.orderId}`);
        return { ok: true };
    }

    const item = await prisma.orderItem.findUnique({
        where: { id: input.itemId },
        include: {
            order: { select: { id: true, orderNo: true, customerId: true, status: true, requestedDeliveryDate: true, deletedAt: true } },
        },
    });
    if (!item || item.order.deletedAt) return { ok: false, error: '원장 항목을 찾을 수 없습니다.' };

    const previousDate = item.salesLedgerDate ?? item.order.requestedDeliveryDate;

    await prisma.$transaction(async (tx) => {
        await tx.orderItem.updateMany({
            where: { orderId: item.orderId },
            data: { salesLedgerDate: salesDate },
        });
        await tx.orderStatusHistory.create({
            data: {
                orderId: item.orderId,
                previousStatus: item.order.status,
                newStatus: item.order.status,
                changedByUserId: session.user.id,
                changeReason: `[매출일자 변경] 오더 ${item.order.orderNo} / ${dateToIso(previousDate)} → ${input.salesDate} / ${input.reason.trim()}`,
            },
        });
    });

    revalidatePath('/admin');
    revalidatePath(`/admin/orders/${item.orderId}`);
    revalidatePath(`/admin/customers/${item.order.customerId}/ledger`);
    revalidatePath('/portal');
    revalidatePath('/portal/ledger');
    return { ok: true };
}

export async function updateLedgerOrderItem(input: {
    itemId: string;
    salesDate: string;
    productId: string;
    quantity: number;
    salesUnitPrice: number | null;
    memo?: string;
    reason: string;
}): Promise<LedgerUpdateResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff' || session.user.name !== '양희철') {
        return { ok: false, error: '원장 수정은 양희철만 가능합니다.' };
    }

    const salesDate = parseDateOnly(input.salesDate);
    if (!salesDate) return { ok: false, error: '매출일자를 확인해 주세요.' };
    if (!input.productId) return { ok: false, error: '품목을 선택해 주세요.' };
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) return { ok: false, error: '수량은 0보다 커야 합니다.' };
    const salesUnitPrice = parseOptionalPrice(input.salesUnitPrice);
    if (Number.isNaN(salesUnitPrice)) return { ok: false, error: '단가는 0 이상 숫자로 입력해 주세요.' };
    if (!input.reason.trim()) return { ok: false, error: '수정 사유를 입력해 주세요.' };

    const item = await prisma.orderItem.findUnique({
        where: { id: input.itemId },
        include: {
            order: { select: { id: true, customerId: true, status: true, requestedDeliveryDate: true, deletedAt: true } },
            product: { select: { productName: true } },
        },
    });
    if (!item || item.order.deletedAt) return { ok: false, error: '원장 항목을 찾을 수 없습니다.' };

    const product = await prisma.product.findUnique({
        where: { id: input.productId },
        select: { productName: true },
    });
    if (!product) return { ok: false, error: '품목을 찾을 수 없습니다.' };

    await prisma.$transaction(async (tx) => {
        await tx.orderItem.update({
            where: { id: input.itemId },
            data: {
                salesLedgerDate: salesDate,
                productId: input.productId,
                requestedQuantity: input.quantity,
                salesUnitPrice,
                memo: input.memo?.trim() || null,
            },
        });
        if (salesUnitPrice != null && item.salesEntityId) {
            await tx.customerProductPrice.upsert({
                where: {
                    customerId_productId_companyEntityId_priceType: {
                        customerId: item.order.customerId,
                        productId: input.productId,
                        companyEntityId: item.salesEntityId,
                        priceType: 'SALES',
                    },
                },
                update: {
                    unitPrice: salesUnitPrice,
                    sourceOrderItemId: input.itemId,
                    lastUsedAt: new Date(),
                    createdById: session.user.id,
                },
                create: {
                    customerId: item.order.customerId,
                    productId: input.productId,
                    companyEntityId: item.salesEntityId,
                    priceType: 'SALES',
                    unitPrice: salesUnitPrice,
                    sourceOrderItemId: input.itemId,
                    createdById: session.user.id,
                },
            });
        }

        const changeDesc: string[] = [];
        const previousDate = (item.salesLedgerDate ?? item.order.requestedDeliveryDate)?.toISOString().slice(0, 10) ?? '-';
        if (previousDate !== input.salesDate) changeDesc.push(`매출일자: ${previousDate} → ${input.salesDate}`);
        if (item.productId !== input.productId) changeDesc.push(`품목: ${item.product.productName} → ${product.productName}`);
        if (item.requestedQuantity !== input.quantity) changeDesc.push(`수량: ${item.requestedQuantity}${item.unit} → ${input.quantity}${item.unit}`);
        if ((item.salesUnitPrice ?? null) !== salesUnitPrice) changeDesc.push(`매출단가: ${item.salesUnitPrice?.toLocaleString('ko-KR') ?? '-'} → ${salesUnitPrice?.toLocaleString('ko-KR') ?? '-'}`);

        await tx.orderStatusHistory.create({
            data: {
                orderId: item.orderId,
                previousStatus: item.order.status,
                newStatus: item.order.status,
                changedByUserId: session.user.id,
                changeReason: `[원장 수정] ${changeDesc.join(', ')} / ${input.reason.trim()}`,
            },
        });
    });

    revalidatePath('/admin');
    revalidatePath(`/admin/orders/${item.orderId}`);
    revalidatePath(`/admin/customers/${item.order.customerId}/ledger`);
    revalidatePath('/portal');
    revalidatePath('/portal/ledger');
    return { ok: true };
}
