import { prisma } from '@/lib/db';
import { LEDGER_DISPATCH_COMPLETED_WHERE, ledgerPurchaseDate } from '@/lib/ledger-policy';

export type SupplierLedgerRow = {
    id: string;
    rowSource: 'ORDER' | 'IMPORT' | 'MANUAL' | 'PAYMENT';
    orderId: string | null;
    orderNo: string;
    purchaseDate: Date | null;
    productId: string | null;
    productName: string;
    productCode: string;
    quantity: number;
    unit: string;
    unitPrice: number | null;
    supplyAmount: number | null;
    vatAmount: number | null;
    totalAmount: number | null;
    memo: string | null;
    paymentId?: string | null;
    paymentType?: string | null;
    noteNumber?: string | null;
    noteMaturityDate?: Date | null;
    noteIssuer?: string | null;
    noteDescription?: string | null;
};

export type PaymentRow = {
    id: string;
    txDate: Date;
    txType: string;
    amount: number;
    memo: string | null;
    source: string;
    noteNumber: string | null;
    noteMaturityDate: Date | null;
    noteIssuer: string | null;
    noteDescription: string | null;
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
    netPayable: number;
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

function normalizeMatchText(value: string | null | undefined) {
    return (value ?? '').replace(/\s+/g, '').replace(/[<>()（）]/g, '').toUpperCase();
}

function sameDateOnly(a: Date | null | undefined, b: Date | null | undefined) {
    if (!a || !b) return false;
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function nearlyEqual(a: number | null | undefined, b: number | null | undefined, tolerance = 1) {
    if (a == null || b == null) return true;
    return Math.abs(a - b) <= tolerance;
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

    const [orderItems, imports, periodPayments, allPurchaseItemsSinceOpening, allPurchaseLedgerSinceOpening, allPaymentsSinceOpening] = await Promise.all([
        prisma.orderItem.findMany({
            where: {
                purchaseSupplierId: supplierId,
                purchaseLedgerDate: { gte: from, lt: toExclusive },
                order: {
                    deletedAt: null,
                    ...LEDGER_DISPATCH_COMPLETED_WHERE,
                },
            },
            include: {
                product: { select: { productName: true, productCode: true } },
                order: {
                    select: {
                        id: true,
                        orderNo: true,
                        status: true,
                        requestedDeliveryDate: true,
                        memo: true,
                        dispatches: {
                            where: { dispatchStatus: 'DISPATCH_COMPLETED' },
                            orderBy: { plannedDispatchDate: 'asc' },
                            take: 1,
                            select: { plannedDispatchDate: true },
                        },
                    },
                },
            },
            orderBy: [{ order: { requestedDeliveryDate: 'asc' } }, { createdAt: 'asc' }],
        }),
        prisma.ledgerEntry.findMany({
            where: {
                ledgerType: 'PURCHASE',
                supplierId,
                transactionDate: { gte: from, lt: toExclusive },
                orderItemId: null,
            },
            include: {
                product: { select: { productName: true, productCode: true } },
                order: { select: { id: true, orderNo: true } },
            },
            orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
        }),
        // 기간 내 지급
        prisma.creditTransaction.findMany({
            where: { supplierId, txType: { in: ['PAYMENT', 'NOTE_TRANSFER'] }, txDate: { gte: from, lt: toExclusive } },
            orderBy: { txDate: 'asc' },
        }),
        // 기준일 이후 전체 매입 (미지급금 잔액 계산용)
        openingDate
            ? prisma.orderItem.findMany({
                where: {
                    purchaseSupplierId: supplierId,
                    purchaseLedgerDate: { gte: openingDate },
                    order: {
                        deletedAt: null,
                        ...LEDGER_DISPATCH_COMPLETED_WHERE,
                    },
                    purchaseUnitPrice: { not: null },
                },
                select: { requestedQuantity: true, purchaseUnitPrice: true, purchaseLedgerDate: true },
            })
            : Promise.resolve([]),
        openingDate
            ? prisma.ledgerEntry.aggregate({
                where: {
                    ledgerType: 'PURCHASE',
                    supplierId,
                    transactionDate: { gte: openingDate },
                    orderItemId: null,
                },
                _sum: { supplyAmount: true },
            })
            : Promise.resolve({ _sum: { supplyAmount: 0 } }),
        // 기준일 이후 전체 지급
        openingDate
            ? prisma.creditTransaction.aggregate({
                where: { supplierId, txType: { in: ['PAYMENT', 'NOTE_TRANSFER'] }, txDate: { gte: openingDate } },
                _sum: { amount: true },
            })
            : Promise.resolve({ _sum: { amount: 0 } }),
    ]);

    const rows: SupplierLedgerRow[] = [
        ...orderItems.map((item) => {
            const supplyAmount = item.purchaseUnitPrice == null ? null : item.requestedQuantity * item.purchaseUnitPrice;
            const vatAmount = supplyAmount == null ? null : Math.round(supplyAmount * 0.1);
            const totalAmount = supplyAmount == null ? null : supplyAmount + (vatAmount ?? 0);
            const purchaseDate = ledgerPurchaseDate(item);
            return {
                id: item.id,
                rowSource: 'ORDER' as const,
                orderId: item.order.id,
                orderNo: item.order.orderNo,
                purchaseDate,
                productId: item.productId,
                productName: item.product.productName,
                productCode: item.product.productCode,
                quantity: item.requestedQuantity,
                unit: item.unit,
                unitPrice: item.purchaseUnitPrice,
                supplyAmount,
                vatAmount,
                totalAmount,
                memo: item.memo ?? item.order.memo,
            };
        }).filter((row) => row.purchaseDate != null && row.purchaseDate >= from && row.purchaseDate < toExclusive),
        ...imports.filter((entry) => !orderItems.some((item) => {
            const entrySupplyAmount = entry.supplyAmount ?? (entry.unitPrice == null ? null : entry.quantity * entry.unitPrice);
            const itemSupplyAmount = item.purchaseUnitPrice == null ? null : item.requestedQuantity * item.purchaseUnitPrice;
            const itemPurchaseDate = ledgerPurchaseDate(item);
            return sameDateOnly(entry.transactionDate, itemPurchaseDate)
                && normalizeMatchText(entry.productName) === normalizeMatchText(item.product.productName)
                && nearlyEqual(entry.quantity, item.requestedQuantity, 0.0001)
                && nearlyEqual(entrySupplyAmount, itemSupplyAmount, 10);
        })).map((entry) => {
            const supplyAmount = entry.supplyAmount ?? (entry.unitPrice == null ? null : entry.quantity * entry.unitPrice);
            const vatAmount = entry.vatAmount ?? (supplyAmount == null ? null : Math.round(supplyAmount * 0.1));
            const totalAmount = entry.totalAmount ?? (supplyAmount == null ? null : supplyAmount + (vatAmount ?? 0));
            return {
                id: `ledger:${entry.id}`,
                rowSource: (entry.sourceType === 'MANUAL' ? 'MANUAL' : 'IMPORT') as 'IMPORT' | 'MANUAL',
                orderId: entry.order?.id ?? null,
                orderNo: entry.order?.orderNo ?? '',
                purchaseDate: entry.transactionDate,
                productId: entry.productId,
                productName: entry.product?.productName ?? entry.productName,
                productCode: entry.product?.productCode ?? entry.productCode ?? '-',
                quantity: entry.quantity,
                unit: entry.unit,
                unitPrice: entry.unitPrice,
                supplyAmount,
                vatAmount,
                totalAmount,
                memo: entry.memo ?? entry.sourceFile,
            };
        }),
        ...periodPayments.map((payment) => {
            const isNote = payment.txType === 'NOTE_TRANSFER';
            return {
                id: `payment:${payment.id}`,
                rowSource: 'PAYMENT' as const,
                orderId: null,
                orderNo: isNote ? '어음지급' : '지급',
                purchaseDate: payment.txDate,
                productId: null,
                productName: isNote ? '어음지급' : '출금/송금',
                productCode: '-',
                quantity: 0,
                unit: '',
                unitPrice: null,
                supplyAmount: -payment.amount,
                vatAmount: null,
                totalAmount: -payment.amount,
                memo: payment.memo,
                paymentId: payment.id,
                paymentType: payment.txType,
                noteNumber: payment.noteNumber,
                noteMaturityDate: payment.noteMaturityDate,
                noteIssuer: payment.noteIssuer,
                noteDescription: payment.noteDescription,
            };
        }),
    ].sort((a, b) => (a.purchaseDate?.getTime() ?? 0) - (b.purchaseDate?.getTime() ?? 0) || a.orderNo.localeCompare(b.orderNo, 'ko') || a.productName.localeCompare(b.productName, 'ko'));

    const periodPaymentTotal = periodPayments.reduce((s, r) => s + r.amount, 0);
    const orderPurchasesSinceOpening = allPurchaseItemsSinceOpening.reduce((sum, item) => {
        const purchaseDate = ledgerPurchaseDate(item);
        if (!openingDate || !purchaseDate || purchaseDate < openingDate) return sum;
        return sum + item.requestedQuantity * (item.purchaseUnitPrice ?? 0);
    }, 0);
    const importedPurchasesSinceOpening = (allPurchaseLedgerSinceOpening as { _sum: { supplyAmount: number | null } })._sum.supplyAmount ?? 0;
    const purchasesSinceOpening = orderPurchasesSinceOpening + importedPurchasesSinceOpening;
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
            txType: p.txType,
            amount: p.amount,
            memo: p.memo,
            source: p.source,
            noteNumber: p.noteNumber,
            noteMaturityDate: p.noteMaturityDate,
            noteIssuer: p.noteIssuer,
            noteDescription: p.noteDescription,
        })),
        periodPaymentTotal,
        openingPayable,
        openingPayableDate: openingDate,
        netPayable,
    };
}

