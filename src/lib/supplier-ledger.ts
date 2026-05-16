import { prisma } from '@/lib/db';

export type SupplierLedgerRow = {
    id: string;
    rowSource: 'ORDER' | 'IMPORT';
    orderId: string | null;
    orderNo: string;
    purchaseDate: Date | null;
    productName: string;
    productCode: string;
    quantity: number;
    unit: string;
    unitPrice: number | null;
    supplyAmount: number | null;
    vatAmount: number | null;
    totalAmount: number | null;
    memo: string | null;
};

export type PaymentRow = {
    id: string;
    txDate: Date;
    amount: number;
    memo: string | null;
    source: string;
};

export type SupplierLedgerResult = {
    supplierId: string;
    supplierName: string;
    from: string;
    to: string;
    rows: SupplierLedgerRow[];
    totalQuantity: number;
    totalSupplyAmount: number;
    totalVatAmount: number;
    totalAmount: number;
    // 지급 내역
    payments: PaymentRow[];
    periodPaymentTotal: number;
    // 미지급금 잔액
    openingPayable: number;
    openingPayableDate: Date | null;
    netPayable: number; // openingPayable + 기준일이후매입 - 기준일이후지급
};

function toDateOnly(value: string) {
    return new Date(`${value}T00:00:00`);
}

function addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function dateToIso(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function defaultSupplierLedgerRange(today = new Date()) {
    return { from: dateToIso(new Date(today.getFullYear(), today.getMonth(), 1)), to: dateToIso(today) };
}

export async function getSupplierLedger(supplierId: string, fromIso?: string, toIso?: string): Promise<SupplierLedgerResult | null> {
    const fallback = defaultSupplierLedgerRange();
    const from = toDateOnly(fromIso || fallback.from);
    const toInclusive = toDateOnly(toIso || fallback.to);
    const toExclusive = addDays(toInclusive, 1);

    const supplier = await prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { id: true, supplierName: true, openingPayable: true, openingPayableDate: true },
    });
    if (!supplier) return null;

    const openingPayable = supplier.openingPayable ?? 0;
    const openingDate = supplier.openingPayableDate;

    const [orderItems, imports, periodPayments, allPurchasesSinceOpening, allPaymentsSinceOpening] = await Promise.all([
        prisma.orderItem.findMany({
            where: {
                purchaseSupplierId: supplierId,
                order: {
                    deletedAt: null,
                    requestedDeliveryDate: { gte: from, lt: toExclusive },
                    status: { notIn: ['CANCELLED', 'REJECTED'] },
                },
            },
            include: {
                product: { select: { productName: true, productCode: true } },
                order: { select: { id: true, orderNo: true, requestedDeliveryDate: true, memo: true } },
            },
            orderBy: [{ order: { requestedDeliveryDate: 'asc' } }, { createdAt: 'asc' }],
        }),
        prisma.ledgerEntry.findMany({
            where: {
                ledgerType: 'PURCHASE',
                supplierId,
                transactionDate: { gte: from, lt: toExclusive },
            },
            include: { product: { select: { productName: true, productCode: true } } },
            orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
        }),
        // 기간 내 지급
        prisma.creditTransaction.findMany({
            where: { supplierId, txType: 'PAYMENT', txDate: { gte: from, lt: toExclusive } },
            orderBy: { txDate: 'asc' },
        }),
        // 기준일 이후 전체 매입 (미지급금 잔액 계산용)
        openingDate
            ? prisma.ledgerEntry.aggregate({
                where: { ledgerType: 'PURCHASE', supplierId, transactionDate: { gte: openingDate } },
                _sum: { supplyAmount: true },
            })
            : Promise.resolve({ _sum: { supplyAmount: 0 } }),
        // 기준일 이후 전체 지급 (미지급금 잔액 계산용)
        openingDate
            ? prisma.creditTransaction.aggregate({
                where: { supplierId, txType: 'PAYMENT', txDate: { gte: openingDate } },
                _sum: { amount: true },
            })
            : Promise.resolve({ _sum: { amount: 0 } }),
    ]);

    const rows: SupplierLedgerRow[] = [
        ...orderItems.map((item) => {
            const supplyAmount = item.purchaseUnitPrice == null ? null : item.requestedQuantity * item.purchaseUnitPrice;
            return {
                id: item.id,
                rowSource: 'ORDER' as const,
                orderId: item.order.id,
                orderNo: item.order.orderNo,
                purchaseDate: item.order.requestedDeliveryDate,
                productName: item.product.productName,
                productCode: item.product.productCode,
                quantity: item.requestedQuantity,
                unit: item.unit,
                unitPrice: item.purchaseUnitPrice,
                supplyAmount,
                vatAmount: null,
                totalAmount: supplyAmount,
                memo: item.memo ?? item.order.memo,
            };
        }),
        ...imports.map((entry) => ({
            id: `ledger:${entry.id}`,
            rowSource: 'IMPORT' as const,
            orderId: null,
            orderNo: '이카운트',
            purchaseDate: entry.transactionDate,
            productName: entry.product?.productName ?? entry.productName,
            productCode: entry.product?.productCode ?? entry.productCode ?? '-',
            quantity: entry.quantity,
            unit: entry.unit,
            unitPrice: entry.unitPrice,
            supplyAmount: entry.supplyAmount,
            vatAmount: entry.vatAmount,
            totalAmount: entry.totalAmount,
            memo: entry.memo ?? entry.sourceFile,
        })),
    ].sort((a, b) => (a.purchaseDate?.getTime() ?? 0) - (b.purchaseDate?.getTime() ?? 0) || a.productName.localeCompare(b.productName, 'ko'));

    const periodPaymentTotal = periodPayments.reduce((s, r) => s + r.amount, 0);
    const purchasesSinceOpening = (allPurchasesSinceOpening as { _sum: { supplyAmount: number | null } })._sum.supplyAmount ?? 0;
    const paymentsSinceOpening = (allPaymentsSinceOpening as { _sum: { amount: number | null } })._sum.amount ?? 0;
    const netPayable = openingPayable + purchasesSinceOpening - paymentsSinceOpening;

    return {
        supplierId: supplier.id,
        supplierName: supplier.supplierName,
        from: dateToIso(from),
        to: dateToIso(toInclusive),
        rows,
        totalQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
        totalSupplyAmount: rows.reduce((sum, row) => sum + (row.supplyAmount ?? 0), 0),
        totalVatAmount: rows.reduce((sum, row) => sum + (row.vatAmount ?? 0), 0),
        totalAmount: rows.reduce((sum, row) => sum + (row.totalAmount ?? row.supplyAmount ?? 0), 0),
        payments: periodPayments.map(p => ({
            id: p.id,
            txDate: p.txDate,
            amount: p.amount,
            memo: p.memo,
            source: p.source,
        })),
        periodPaymentTotal,
        openingPayable,
        openingPayableDate: openingDate,
        netPayable,
    };
}