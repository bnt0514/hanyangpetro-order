import { prisma } from '@/lib/db';

export type LedgerProductComparison = {
    productId: string;
    productName: string;
    currentQuantity: number;
    previousQuantity: number;
    quantityDelta: number;
    currentAvgUnitPrice: number | null;
    previousAvgUnitPrice: number | null;
    unitPriceDelta: number | null;
};

export type LedgerRow = {
    itemId: string;
    rowSource: 'ORDER' | 'IMPORT';
    orderId: string | null;
    orderNo: string;
    salesDate: Date | null;
    productId: string;
    productName: string;
    productCode: string;
    quantity: number;
    unit: string;
    unitPrice: number | null;
    amount: number | null;
    vatAmount?: number | null;
    totalAmount?: number | null;
    memo: string | null;
};

export type CompanyLedger = {
    companyEntityId: string;
    companyName: string;
    rows: LedgerRow[];
    totalQuantity: number;
    totalAmount: number;
    comparisons: LedgerProductComparison[];
};

export type ReceiptRow = {
    id: string;
    txDate: Date;
    amount: number;
    memo: string | null;
    source: string;
};

export type CustomerLedgerResult = {
    customerId: string;
    customerName: string;
    from: string;
    to: string;
    ledgers: CompanyLedger[];
    // 수금 내역 (해당 기간)
    receipts: ReceiptRow[];
    periodReceiptTotal: number;
    // 미수금 잔액
    openingReceivable: number;
    openingReceivableDate: Date | null;
    netReceivable: number; // openingReceivable + 기준일이후매출 - 기준일이후수금
};

function toDateOnly(value: string) {
    return new Date(`${value}T00:00:00`);
}

function addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function addMonths(date: Date, months: number) {
    const next = new Date(date);
    next.setMonth(next.getMonth() + months);
    return next;
}

function monthStart(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function dateToIso(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function weightedAverage(totalAmount: number, totalQuantity: number) {
    return totalQuantity > 0 ? totalAmount / totalQuantity : null;
}

function ledgerProductKey(productId: string | null | undefined, productName: string) {
    return productId || `IMPORTED:${productName}`;
}

export function defaultLedgerRange(today = new Date()) {
    const from = monthStart(today);
    const to = today;
    return { from: dateToIso(from), to: dateToIso(to) };
}

export async function getCustomerLedger(customerId: string, fromIso?: string, toIso?: string): Promise<CustomerLedgerResult | null> {
    const fallback = defaultLedgerRange();
    const from = toDateOnly(fromIso || fallback.from);
    const toInclusive = toDateOnly(toIso || fallback.to);
    const toExclusive = addDays(toInclusive, 1);
    const previousFrom = addMonths(from, -1);
    const previousTo = addMonths(toExclusive, -1);

    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, companyName: true, openingReceivable: true, openingReceivableDate: true },
    });
    if (!customer) return null;

    const openingReceivable = customer.openingReceivable ?? 0;
    const openingDate = customer.openingReceivableDate;

    const [currentItems, previousItems, currentImports, previousImports, periodReceipts, allSalesSinceOpening, allReceiptsSinceOpening] = await Promise.all([
        prisma.orderItem.findMany({
            where: {
                order: {
                    customerId,
                    deletedAt: null,
                    requestedDeliveryDate: { gte: from, lt: toExclusive },
                    status: { notIn: ['CANCELLED', 'REJECTED'] },
                },
            },
            include: {
                salesEntity: true,
                product: { select: { id: true, productName: true, productCode: true } },
                order: { select: { id: true, orderNo: true, requestedDeliveryDate: true, memo: true } },
            },
            orderBy: [{ order: { requestedDeliveryDate: 'asc' } }, { createdAt: 'asc' }],
        }),
        prisma.orderItem.findMany({
            where: {
                order: {
                    customerId,
                    deletedAt: null,
                    requestedDeliveryDate: { gte: previousFrom, lt: previousTo },
                    status: { notIn: ['CANCELLED', 'REJECTED'] },
                },
            },
            include: {
                salesEntity: true,
                product: { select: { id: true, productName: true, productCode: true } },
            },
        }),
        prisma.ledgerEntry.findMany({
            where: {
                ledgerType: 'SALES',
                customerId,
                transactionDate: { gte: from, lt: toExclusive },
            },
            include: {
                companyEntity: true,
                product: { select: { id: true, productName: true, productCode: true } },
            },
            orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
        }),
        prisma.ledgerEntry.findMany({
            where: {
                ledgerType: 'SALES',
                customerId,
                transactionDate: { gte: previousFrom, lt: previousTo },
            },
            include: {
                companyEntity: true,
                product: { select: { id: true, productName: true, productCode: true } },
            },
        }),
        // 기간 내 수금(입금)
        prisma.creditTransaction.findMany({
            where: { customerId, txType: 'IN', txDate: { gte: from, lt: toExclusive } },
            orderBy: { txDate: 'asc' },
        }),
        // 기준일 이후 전체 매출 (미수금 잔액 계산용)
        openingDate
            ? prisma.ledgerEntry.aggregate({
                where: { ledgerType: 'SALES', customerId, transactionDate: { gte: openingDate } },
                _sum: { supplyAmount: true },
            })
            : Promise.resolve({ _sum: { supplyAmount: 0 } }),
        // 기준일 이후 전체 수금 (미수금 잔액 계산용)
        openingDate
            ? prisma.creditTransaction.aggregate({
                where: { customerId, txType: 'IN', txDate: { gte: openingDate } },
                _sum: { amount: true },
            })
            : Promise.resolve({ _sum: { amount: 0 } }),
    ]);

    const previousByCompanyProduct = new Map<string, { quantity: number; amount: number }>();
    const currentByCompanyProduct = new Map<string, { productName: string; quantity: number; amount: number }>();
    const ledgerMap = new Map<string, CompanyLedger>();

    function addPrevious(companyId: string, productKey: string, quantity: number, amount: number | null) {
        const key = `${companyId}:${productKey}`;
        const previous = previousByCompanyProduct.get(key) ?? { quantity: 0, amount: 0 };
        previous.quantity += quantity;
        if (amount != null) previous.amount += amount;
        previousByCompanyProduct.set(key, previous);
    }

    function addCurrentAggregation(companyId: string, productKey: string, productName: string, quantity: number, amount: number | null) {
        const key = `${companyId}:${productKey}`;
        const current = currentByCompanyProduct.get(key) ?? { productName, quantity: 0, amount: 0 };
        current.quantity += quantity;
        if (amount != null) current.amount += amount;
        currentByCompanyProduct.set(key, current);
    }

    function getLedger(companyId: string, companyName: string) {
        const ledger = ledgerMap.get(companyId) ?? {
            companyEntityId: companyId,
            companyName,
            rows: [],
            totalQuantity: 0,
            totalAmount: 0,
            comparisons: [],
        };
        ledgerMap.set(companyId, ledger);
        return ledger;
    }

    for (const item of previousItems) {
        if (!item.salesEntityId) continue;
        addPrevious(item.salesEntityId, item.productId, item.requestedQuantity, item.salesUnitPrice == null ? null : item.requestedQuantity * item.salesUnitPrice);
    }
    for (const entry of previousImports) {
        const companyId = entry.companyEntityId ?? 'ECOUNT_IMPORT';
        addPrevious(companyId, ledgerProductKey(entry.productId, entry.productName), entry.quantity, entry.supplyAmount ?? (entry.unitPrice == null ? null : entry.quantity * entry.unitPrice));
    }

    for (const item of currentItems) {
        const companyId = item.salesEntityId ?? 'UNASSIGNED';
        const companyName = item.salesEntity?.displayName ?? '미지정';
        const amount = item.salesUnitPrice == null ? null : item.requestedQuantity * item.salesUnitPrice;
        const ledger = getLedger(companyId, companyName);
        ledger.rows.push({
            itemId: item.id,
            rowSource: 'ORDER',
            orderId: item.order.id,
            orderNo: item.order.orderNo,
            salesDate: item.order.requestedDeliveryDate,
            productId: item.productId,
            productName: item.product.productName,
            productCode: item.product.productCode,
            quantity: item.requestedQuantity,
            unit: item.unit,
            unitPrice: item.salesUnitPrice,
            amount,
            memo: item.memo ?? item.order.memo,
        });
        ledger.totalQuantity += item.requestedQuantity;
        if (amount != null) ledger.totalAmount += amount;
        addCurrentAggregation(companyId, item.productId, item.product.productName, item.requestedQuantity, amount);
    }

    for (const entry of currentImports) {
        const companyId = entry.companyEntityId ?? 'ECOUNT_IMPORT';
        const companyName = entry.companyEntity?.displayName ?? '이카운트 이관';
        const productId = ledgerProductKey(entry.productId, entry.productName);
        const amount = entry.supplyAmount ?? (entry.unitPrice == null ? null : entry.quantity * entry.unitPrice);
        const ledger = getLedger(companyId, companyName);
        ledger.rows.push({
            itemId: `ledger:${entry.id}`,
            rowSource: 'IMPORT',
            orderId: null,
            orderNo: '이카운트',
            salesDate: entry.transactionDate,
            productId,
            productName: entry.product?.productName ?? entry.productName,
            productCode: entry.product?.productCode ?? entry.productCode ?? '-',
            quantity: entry.quantity,
            unit: entry.unit,
            unitPrice: entry.unitPrice,
            amount,
            vatAmount: entry.vatAmount,
            totalAmount: entry.totalAmount,
            memo: entry.memo ?? entry.sourceFile,
        });
        ledger.totalQuantity += entry.quantity;
        if (amount != null) ledger.totalAmount += amount;
        addCurrentAggregation(companyId, productId, entry.product?.productName ?? entry.productName, entry.quantity, amount);
    }

    for (const ledger of ledgerMap.values()) {
        ledger.rows.sort((a, b) => (a.salesDate?.getTime() ?? 0) - (b.salesDate?.getTime() ?? 0) || a.productName.localeCompare(b.productName, 'ko'));
        const productIds = Array.from(new Set(ledger.rows.map((row) => row.productId)));
        ledger.comparisons = productIds.map((productId) => {
            const current = currentByCompanyProduct.get(`${ledger.companyEntityId}:${productId}`) ?? { productName: '-', quantity: 0, amount: 0 };
            const previous = previousByCompanyProduct.get(`${ledger.companyEntityId}:${productId}`) ?? { quantity: 0, amount: 0 };
            const currentAvgUnitPrice = weightedAverage(current.amount, current.quantity);
            const previousAvgUnitPrice = weightedAverage(previous.amount, previous.quantity);
            return {
                productId,
                productName: current.productName,
                currentQuantity: current.quantity,
                previousQuantity: previous.quantity,
                quantityDelta: current.quantity - previous.quantity,
                currentAvgUnitPrice,
                previousAvgUnitPrice,
                unitPriceDelta: currentAvgUnitPrice != null && previousAvgUnitPrice != null ? currentAvgUnitPrice - previousAvgUnitPrice : null,
            };
        }).sort((a, b) => a.productName.localeCompare(b.productName, 'ko'));
    }

    const periodReceiptTotal = periodReceipts.reduce((s, r) => s + r.amount, 0);
    const salesSinceOpening = (allSalesSinceOpening as { _sum: { supplyAmount: number | null } })._sum.supplyAmount ?? 0;
    const receiptsSinceOpening = (allReceiptsSinceOpening as { _sum: { amount: number | null } })._sum.amount ?? 0;
    const netReceivable = openingReceivable + salesSinceOpening - receiptsSinceOpening;

    return {
        customerId: customer.id,
        customerName: customer.companyName,
        from: dateToIso(from),
        to: dateToIso(toInclusive),
        ledgers: Array.from(ledgerMap.values()).sort((a, b) => a.companyName.localeCompare(b.companyName, 'ko')),
        receipts: periodReceipts.map(r => ({
            id: r.id,
            txDate: r.txDate,
            amount: r.amount,
            memo: r.memo,
            source: r.source,
        })),
        periodReceiptTotal,
        openingReceivable,
        openingReceivableDate: openingDate,
        netReceivable,
    };
}
