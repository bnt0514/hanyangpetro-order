'use server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { LEDGER_DISPATCH_COMPLETED_WHERE } from '@/lib/ledger-policy';
import { BRANDS, PRODUCT_GROUPS, type Brand, type ProductGroup } from '@/lib/price-constants';
import { revalidatePath } from 'next/cache';

type ActionResult = { ok: true; count: number } | { ok: false; error: string };
type LedgerMode = 'SALES' | 'PURCHASE';


async function requirePriceAdmin() {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff' || !['EXECUTIVE', 'ADMIN'].includes(session.user.role ?? '')) return null;
    return session.user;
}

function parseMonth(month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) return null;
    const [year, monthNo] = month.split('-').map(Number);
    return {
        from: new Date(year, monthNo - 1, 1),
        toExclusive: new Date(year, monthNo, 1),
    };
}

function calcAmounts(quantity: number, unitPrice: number | null) {
    if (unitPrice == null) return { supplyAmount: null, vatAmount: null, totalAmount: null };
    const supplyAmount = Math.round(quantity * unitPrice);
    const vatAmount = Math.round(supplyAmount * 0.1);
    return { supplyAmount, vatAmount, totalAmount: supplyAmount + vatAmount };
}

function appendAuditMemo(memo: string | null | undefined, line: string) {
    return [memo?.trim(), line].filter(Boolean).join('\n');
}

function normalizeBrand(value: string | null | undefined): Brand {
    const v = (value ?? '').toLowerCase();
    if (v.includes('한화') || v.includes('hanwha')) return '한화';
    if (v.includes('롯데') || v.includes('lotte')) return '롯데';
    if (v.includes('lg') || v.includes('엘지')) return 'LG';
    if (v.includes('대한')) return '대한유화';
    return '기타';
}

function normalizeGroup(value: string | null | undefined): ProductGroup {
    const v = (value ?? '').toUpperCase().replace(/\s+/g, '');
    if (v.includes('MLLD') || v.includes('MLLLD')) return 'mLLDPE';
    if (v.includes('LLDPE')) return 'LLDPE';
    if (v.includes('LDPE')) return 'LDPE';
    if (v.includes('EVA')) return 'EVA';
    if (v.includes('HDPE')) return 'HDPE';
    if (v.includes('PP')) return 'PP';
    return 'PP';
}

function productBrand(product: { brand?: string | null; manufacturer?: string | null }) {
    return normalizeBrand(product.brand ?? product.manufacturer);
}

function productGroup(product: { productGroup?: string | null; category?: string | null; productName?: string | null }) {
    return normalizeGroup(product.productGroup ?? product.category ?? product.productName);
}

export async function bulkUpdateLedgerUnitPrices(input: {
    mode: LedgerMode;
    reason: string;
    updates: { rowId: string; unitPrice: number }[];
}): Promise<ActionResult> {
    const user = await requirePriceAdmin();
    if (!user) return { ok: false, error: '단가 수정 권한이 없습니다.' };
    if (!['SALES', 'PURCHASE'].includes(input.mode)) return { ok: false, error: '단가 구분을 확인해 주세요.' };
    if (!input.reason.trim()) return { ok: false, error: '수정 사유를 입력해 주세요.' };

    const updates = input.updates
        .filter((item) => item.rowId && Number.isFinite(item.unitPrice) && item.unitPrice >= 0)
        .slice(0, 1000);
    if (updates.length === 0) return { ok: false, error: '저장할 단가가 없습니다.' };

    const touchedOrderIds = new Set<string>();
    const touchedCustomerIds = new Set<string>();
    const touchedSupplierIds = new Set<string>();

    await prisma.$transaction(async (tx) => {
        for (const update of updates) {
            if (update.rowId.startsWith('ledger:')) {
                const ledgerEntryId = update.rowId.slice('ledger:'.length);
                const entry = await tx.ledgerEntry.findUnique({
                    where: { id: ledgerEntryId },
                    select: { id: true, ledgerType: true, quantity: true, unitPrice: true, memo: true, orderId: true, customerId: true, supplierId: true },
                });
                if (!entry || entry.ledgerType !== input.mode) continue;
                const amounts = calcAmounts(entry.quantity, update.unitPrice);
                await tx.ledgerEntry.update({
                    where: { id: ledgerEntryId },
                    data: {
                        unitPrice: update.unitPrice,
                        supplyAmount: amounts.supplyAmount,
                        vatAmount: amounts.vatAmount,
                        totalAmount: amounts.totalAmount,
                        memo: appendAuditMemo(entry.memo, `[단가 수정] ${entry.unitPrice?.toLocaleString('ko-KR') ?? '-'} -> ${update.unitPrice.toLocaleString('ko-KR')} / ${input.reason.trim()}`),
                    },
                });
                if (entry.orderId) touchedOrderIds.add(entry.orderId);
                if (entry.customerId) touchedCustomerIds.add(entry.customerId);
                if (entry.supplierId) touchedSupplierIds.add(entry.supplierId);
                continue;
            }

            const item = await tx.orderItem.findUnique({
                where: { id: update.rowId },
                include: {
                    order: { select: { id: true, customerId: true, status: true } },
                },
            });
            if (!item) continue;
            const quantity = item.requestedQuantity;
            const amounts = calcAmounts(quantity, update.unitPrice);
            await tx.orderItem.update({
                where: { id: item.id },
                data: input.mode === 'SALES'
                    ? { salesUnitPrice: update.unitPrice }
                    : { purchaseUnitPrice: update.unitPrice },
            });
            await tx.ledgerEntry.updateMany({
                where: { orderItemId: item.id, ledgerType: input.mode },
                data: {
                    unitPrice: update.unitPrice,
                    supplyAmount: amounts.supplyAmount,
                    vatAmount: amounts.vatAmount,
                    totalAmount: amounts.totalAmount,
                },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId: item.orderId,
                    previousStatus: item.order.status,
                    newStatus: item.order.status,
                    changedByUserId: user.id,
                    changeReason: `[단가 수정] ${input.mode === 'SALES' ? '매출' : '매입'}단가 ${update.unitPrice.toLocaleString('ko-KR')} / ${input.reason.trim()}`,
                },
            });
            touchedOrderIds.add(item.orderId);
            touchedCustomerIds.add(item.order.customerId);
            if (item.purchaseSupplierId) touchedSupplierIds.add(item.purchaseSupplierId);
        }
    });

    revalidatePath('/admin/prices');
    revalidatePath('/admin/ledger');
    for (const id of touchedOrderIds) revalidatePath(`/admin/orders/${id}`);
    for (const id of touchedCustomerIds) revalidatePath(`/admin/customers/${id}/ledger`);
    for (const id of touchedSupplierIds) revalidatePath(`/admin/suppliers/${id}/ledger`);
    return { ok: true, count: updates.length };
}

export async function saveAndApplyPriceAdjustments(input: {
    month: string;
    memo?: string;
    values: Record<string, Record<string, number>>;
}): Promise<ActionResult> {
    const user = await requirePriceAdmin();
    if (!user) return { ok: false, error: '월별 단가조정 권한이 없습니다.' };
    const range = parseMonth(input.month);
    if (!range) return { ok: false, error: '기준월을 확인해 주세요.' };

    const previousRows = await prisma.priceAdjustment.findMany({
        where: { effectiveMonth: input.month },
        select: { brand: true, productGroup: true, delta: true },
    });
    const previousMap = new Map(previousRows.map((row) => [`${row.brand}:${row.productGroup === '기타' ? 'PP' : row.productGroup}`, row.delta]));
    const changed = new Map<string, number>();

    await prisma.$transaction(async (tx) => {
        for (const brand of BRANDS) {
            for (const group of PRODUCT_GROUPS) {
                const nextDelta = Number(input.values[brand]?.[group] ?? 0);
                if (!Number.isFinite(nextDelta)) continue;
                const key = `${brand}:${group}`;
                const previousDelta = previousMap.get(key) ?? 0;
                const diff = nextDelta - previousDelta;
                if (diff !== 0) changed.set(key, diff);
                await tx.priceAdjustment.upsert({
                    where: { effectiveMonth_brand_productGroup: { effectiveMonth: input.month, brand, productGroup: group } },
                    update: { delta: nextDelta, memo: input.memo?.trim() || null, createdById: user.id },
                    create: { effectiveMonth: input.month, brand, productGroup: group, delta: nextDelta, memo: input.memo?.trim() || null, createdById: user.id },
                });
            }
        }
    });

    if (changed.size === 0) {
        revalidatePath('/admin/prices');
        return { ok: true, count: 0 };
    }

    const orderItems = await prisma.orderItem.findMany({
        where: {
            OR: [
                { salesLedgerDate: { gte: range.from, lt: range.toExclusive } },
                { salesLedgerDate: null, order: { requestedDeliveryDate: { gte: range.from, lt: range.toExclusive } } },
            ],
            salesUnitPrice: { not: null },
            order: { deletedAt: null, ...LEDGER_DISPATCH_COMPLETED_WHERE },
        },
        include: {
            product: { select: { brand: true, manufacturer: true, productGroup: true, category: true, productName: true } },
            order: { select: { id: true, customerId: true, status: true } },
        },
    });
    const ledgerEntries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerType: 'SALES',
            transactionDate: { gte: range.from, lt: range.toExclusive },
            unitPrice: { not: null },
        },
        include: { product: { select: { brand: true, manufacturer: true, productGroup: true, category: true, productName: true } } },
    });

    let count = 0;
    const touchedOrderIds = new Set<string>();
    const touchedCustomerIds = new Set<string>();

    await prisma.$transaction(async (tx) => {
        for (const item of orderItems) {
            const key = `${productBrand(item.product)}:${productGroup(item.product)}`;
            const diff = changed.get(key);
            if (!diff || item.salesUnitPrice == null) continue;
            const unitPrice = Math.max(0, item.salesUnitPrice + diff);
            const amounts = calcAmounts(item.requestedQuantity, unitPrice);
            await tx.orderItem.update({ where: { id: item.id }, data: { salesUnitPrice: unitPrice } });
            await tx.ledgerEntry.updateMany({
                where: { orderItemId: item.id, ledgerType: 'SALES' },
                data: { unitPrice, supplyAmount: amounts.supplyAmount, vatAmount: amounts.vatAmount, totalAmount: amounts.totalAmount },
            });
            await tx.orderStatusHistory.create({
                data: {
                    orderId: item.orderId,
                    previousStatus: item.order.status,
                    newStatus: item.order.status,
                    changedByUserId: user.id,
                    changeReason: `[월별 단가조정] ${input.month} ${key} ${diff > 0 ? '+' : ''}${diff.toLocaleString('ko-KR')}원 반영`,
                },
            });
            touchedOrderIds.add(item.orderId);
            touchedCustomerIds.add(item.order.customerId);
            count += 1;
        }
        for (const entry of ledgerEntries) {
            if (!entry.product || entry.unitPrice == null) continue;
            const key = `${productBrand(entry.product)}:${productGroup(entry.product)}`;
            const diff = changed.get(key);
            if (!diff) continue;
            const unitPrice = Math.max(0, entry.unitPrice + diff);
            const amounts = calcAmounts(entry.quantity, unitPrice);
            await tx.ledgerEntry.update({
                where: { id: entry.id },
                data: {
                    unitPrice,
                    supplyAmount: amounts.supplyAmount,
                    vatAmount: amounts.vatAmount,
                    totalAmount: amounts.totalAmount,
                    memo: appendAuditMemo(entry.memo, `[월별 단가조정] ${input.month} ${key} ${diff > 0 ? '+' : ''}${diff.toLocaleString('ko-KR')}원 반영`),
                },
            });
            if (entry.orderId) touchedOrderIds.add(entry.orderId);
            if (entry.customerId) touchedCustomerIds.add(entry.customerId);
            count += 1;
        }
    });

    revalidatePath('/admin/prices');
    revalidatePath('/admin/ledger');
    for (const id of touchedOrderIds) revalidatePath(`/admin/orders/${id}`);
    for (const id of touchedCustomerIds) revalidatePath(`/admin/customers/${id}/ledger`);
    return { ok: true, count };
}

