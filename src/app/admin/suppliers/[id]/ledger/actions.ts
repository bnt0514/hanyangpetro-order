'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export type SupplierLedgerUpdateResult = { ok: true } | { ok: false; error: string };

function parseDateOnly(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    return new Date(`${value}T00:00:00`);
}

function dateToIso(value: Date | null | undefined) {
    return value ? value.toISOString().slice(0, 10) : '-';
}

function appendAuditMemo(memo: string | null, line: string) {
    return [memo?.trim(), line].filter(Boolean).join('\n');
}

function dispatchCompletedDate(statusHistory: { createdAt: Date }[]) {
    if (statusHistory.length === 0) return null;
    return parseDateOnly(dateToIso(statusHistory[0].createdAt));
}

export async function updatePurchaseLedgerDate(input: {
    itemId: string;
    purchaseDate: string;
    reason: string;
}): Promise<SupplierLedgerUpdateResult> {
    const session = await auth();
    if (!session?.user) return { ok: false, error: '로그인이 필요합니다.' };
    if (session.user.userKind !== 'staff' || session.user.name !== '양희철') {
        return { ok: false, error: '원장 수정은 양희철만 가능합니다.' };
    }

    const purchaseDate = parseDateOnly(input.purchaseDate);
    if (!purchaseDate) return { ok: false, error: '매입일자를 확인해 주세요.' };
    if (!input.reason.trim()) return { ok: false, error: '변경 사유를 입력해 주세요.' };

    if (input.itemId.startsWith('ledger:')) {
        const ledgerEntryId = input.itemId.slice('ledger:'.length);
        const entry = await prisma.ledgerEntry.findUnique({
            where: { id: ledgerEntryId },
            include: { order: { select: { id: true, orderNo: true, status: true } } },
        });
        if (!entry || entry.ledgerType !== 'PURCHASE' || !entry.supplierId) {
            return { ok: false, error: '이관 매입 원장 항목을 찾을 수 없습니다.' };
        }

        const previousDate = entry.transactionDate;
        await prisma.$transaction(async (tx) => {
            await tx.ledgerEntry.update({
                where: { id: ledgerEntryId },
                data: {
                    transactionDate: purchaseDate,
                    memo: appendAuditMemo(entry.memo, `[매입일자 변경] ${dateToIso(previousDate)} → ${input.purchaseDate} / ${input.reason.trim()}`),
                },
            });
            if (entry.order) {
                await tx.orderStatusHistory.create({
                    data: {
                        orderId: entry.order.id,
                        previousStatus: entry.order.status,
                        newStatus: entry.order.status,
                        changedByUserId: session.user.id,
                        changeReason: `[이관 매입일자 변경] 오더 ${entry.order.orderNo} / ${dateToIso(previousDate)} → ${input.purchaseDate} / ${input.reason.trim()}`,
                    },
                });
            }
        });

        revalidatePath('/admin');
        revalidatePath(`/admin/suppliers/${entry.supplierId}/ledger`);
        if (entry.orderId) revalidatePath(`/admin/orders/${entry.orderId}`);
        return { ok: true };
    }

    const item = await prisma.orderItem.findUnique({
        where: { id: input.itemId },
        include: {
            order: {
                select: {
                    id: true,
                    orderNo: true,
                    status: true,
                    requestedDeliveryDate: true,
                    deletedAt: true,
                    statusHistory: {
                        where: { newStatus: 'DISPATCH_COMPLETED' },
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                    },
                },
            },
        },
    });
    if (!item || item.order.deletedAt || !item.purchaseSupplierId) {
        return { ok: false, error: '매입 원장 항목을 찾을 수 없습니다.' };
    }

    const previousDate = item.purchaseLedgerDate ?? dispatchCompletedDate(item.order.statusHistory) ?? item.order.requestedDeliveryDate;

    await prisma.$transaction(async (tx) => {
        await tx.orderItem.updateMany({
            where: { orderId: item.orderId, purchaseSupplierId: item.purchaseSupplierId },
            data: { purchaseLedgerDate: purchaseDate },
        });
        await tx.orderStatusHistory.create({
            data: {
                orderId: item.orderId,
                previousStatus: item.order.status,
                newStatus: item.order.status,
                changedByUserId: session.user.id,
                changeReason: `[매입일자 변경] 오더 ${item.order.orderNo} / ${dateToIso(previousDate)} → ${input.purchaseDate} / ${input.reason.trim()}`,
            },
        });
    });

    revalidatePath('/admin');
    revalidatePath(`/admin/orders/${item.orderId}`);
    revalidatePath(`/admin/suppliers/${item.purchaseSupplierId}/ledger`);
    return { ok: true };
}