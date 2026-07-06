import { prisma } from '@/lib/db';
import { LEDGER_DISPATCH_COMPLETED_WHERE } from '@/lib/ledger-policy';


const RECEIPT_TX_TYPES = ['IN', 'NOTE_IN'];

export type CollectionStatus = 'PAID' | 'PARTIAL' | 'UNPAID' | 'ADVANCE';

export type CollectionBucket = {
    month: string;
    salesTotal: number;
    allocatedReceiptTotal: number;
    balance: number;
};

export type CollectionReconciliationRow = {
    customerId: string;
    customerName: string;
    customerCode: string | null;
    salesRepName: string | null;
    paymentTerms: string | null;
    selectedMonth: string;
    selectedSalesTotal: number;
    selectedAllocatedReceiptTotal: number;
    selectedBalance: number;
    priorUnpaidTotal: number;
    advanceAmount: number;
    receiptTotalThroughAsOf: number;
    latestReceiptDate: string | null;
    status: CollectionStatus;
    buckets: CollectionBucket[];
};

export type CollectionReconciliationSummary = {
    customerCount: number;
    selectedSalesTotal: number;
    selectedAllocatedReceiptTotal: number;
    selectedBalanceTotal: number;
    priorUnpaidTotal: number;
    advanceTotal: number;
    paidCount: number;
    partialCount: number;
    unpaidCount: number;
    advanceCount: number;
};

export type CollectionReconciliationReport = {
    selectedMonth: string;
    allocationFromMonth: string;
    asOf: string;
    query: string;
    status: string;
    rows: CollectionReconciliationRow[];
    summary: CollectionReconciliationSummary;
};

function pad2(value: number) {
    return String(value).padStart(2, '0');
}

function dateToIso(date: Date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function monthKey(date: Date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function parseMonth(value: string | undefined, fallback: Date) {
    if (value && /^\d{4}-\d{2}$/.test(value)) {
        const [year, month] = value.split('-').map(Number);
        return new Date(year, month - 1, 1);
    }
    return new Date(fallback.getFullYear(), fallback.getMonth(), 1);
}

function parseDate(value: string | undefined, fallback: Date) {
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const date = new Date(`${value}T00:00:00`);
        if (!Number.isNaN(date.getTime())) return date;
    }
    return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
}

function addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function monthEnd(date: Date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function previousMonthStart(today = new Date()) {
    return new Date(today.getFullYear(), today.getMonth() - 1, 1);
}

function normalizeSearch(value: string | null | undefined) {
    return (value ?? '').replace(/\s+/g, '').toLowerCase();
}

function normalizeMatchText(value: string | null | undefined) {
    return (value ?? '').replace(/\s+/g, '').replace(/[<>()（）]/g, '').toUpperCase();
}

function salesMatchKey(input: {
    customerId: string;
    date: Date;
    productId?: string | null;
    productName?: string | null;
    quantity: number;
    amount: number;
}) {
    const productKey = input.productId || normalizeMatchText(input.productName);
    return [
        input.customerId,
        dateToIso(input.date),
        productKey,
        Math.round(input.quantity * 10000),
        Math.round(input.amount),
    ].join('|');
}

function vatIncludedAmount(input: {
    quantity?: number | null;
    unitPrice?: number | null;
    supplyAmount?: number | null;
    vatAmount?: number | null;
    totalAmount?: number | null;
}) {
    if (input.totalAmount != null) return Math.round(input.totalAmount);
    if (input.supplyAmount != null || input.vatAmount != null) {
        return Math.round((input.supplyAmount ?? 0) + (input.vatAmount ?? 0));
    }
    if (input.quantity != null && input.unitPrice != null) {
        const supply = input.quantity * input.unitPrice;
        return Math.round(supply + Math.round(supply * 0.1));
    }
    return 0;
}

function addToMap(map: Map<string, number>, key: string, amount: number) {
    map.set(key, (map.get(key) ?? 0) + amount);
}

export function defaultCollectionReconciliationParams(today = new Date()) {
    const selected = previousMonthStart(today);
    return {
        month: monthKey(selected),
        asOf: dateToIso(today),
        fromMonth: '2024-01',
    };
}

export async function getCollectionReconciliationReport(options: {
    month?: string;
    asOf?: string;
    fromMonth?: string;
    q?: string;
    status?: string;
} = {}): Promise<CollectionReconciliationReport> {
    const defaults = defaultCollectionReconciliationParams();
    const selectedMonthDate = parseMonth(options.month, parseMonth(defaults.month, previousMonthStart()));
    const allocationFromDate = parseMonth(options.fromMonth, parseMonth(defaults.fromMonth, new Date(2024, 0, 1)));
    const asOfDate = parseDate(options.asOf, new Date());
    const selectedMonth = monthKey(selectedMonthDate);
    const allocationFromMonth = monthKey(allocationFromDate);
    const selectedMonthEndExclusive = addDays(monthEnd(selectedMonthDate), 1);
    const asOfExclusive = addDays(asOfDate, 1);
    const query = (options.q ?? '').trim();
    const normalizedQuery = normalizeSearch(query);
    const statusFilter = options.status ?? 'all';

    const [customers, ledgerSales, orderItems, receipts] = await Promise.all([
        prisma.customer.findMany({
            where: { isActive: true },
            select: {
                id: true,
                companyName: true,
                customerCode: true,
                paymentTerms: true,
                defaultSalesRep: { select: { name: true } },
            },
            orderBy: { companyName: 'asc' },
        }),
        prisma.ledgerEntry.findMany({
            where: {
                ledgerType: 'SALES',
                customerId: { not: null },
                orderItemId: null,
                transactionDate: { gte: allocationFromDate, lt: selectedMonthEndExclusive },
            },
            select: {
                customerId: true,
                transactionDate: true,
                productId: true,
                productName: true,
                quantity: true,
                unitPrice: true,
                supplyAmount: true,
                vatAmount: true,
                totalAmount: true,
            },
        }),
        prisma.orderItem.findMany({
            where: {
                OR: [
                    { salesLedgerDate: { gte: allocationFromDate, lt: selectedMonthEndExclusive } },
                    { salesLedgerDate: null, order: { requestedDeliveryDate: { gte: allocationFromDate, lt: selectedMonthEndExclusive } } },
                ],
                order: {
                    deletedAt: null,
                    ...LEDGER_DISPATCH_COMPLETED_WHERE,
                },
                salesUnitPrice: { not: null },
            },
            select: {
                requestedQuantity: true,
                salesUnitPrice: true,
                salesLedgerDate: true,
                productId: true,
                product: { select: { productName: true } },
                order: {
                    select: {
                        customerId: true,
                        requestedDeliveryDate: true,
                    },
                },
            },
        }),
        prisma.creditTransaction.findMany({
            where: {
                customerId: { not: null },
                txType: { in: RECEIPT_TX_TYPES },
                txDate: { gte: allocationFromDate, lt: asOfExclusive },
            },
            select: {
                customerId: true,
                txDate: true,
                amount: true,
            },
            orderBy: [{ txDate: 'asc' }, { createdAt: 'asc' }],
        }),
    ]);

    const importedSalesKeys = new Set<string>();
    const customerData = new Map(customers.map((customer) => [
        customer.id,
        {
            customer,
            salesByMonth: new Map<string, number>(),
            receipts: [] as { txDate: Date; amount: number }[],
        },
    ]));

    for (const entry of ledgerSales) {
        if (!entry.customerId) continue;
        const data = customerData.get(entry.customerId);
        if (!data) continue;
        const amount = vatIncludedAmount(entry);
        importedSalesKeys.add(salesMatchKey({
            customerId: entry.customerId,
            date: entry.transactionDate,
            productId: entry.productId,
            productName: entry.productName,
            quantity: entry.quantity,
            amount,
        }));
        addToMap(data.salesByMonth, monthKey(entry.transactionDate), amount);
    }

    for (const item of orderItems) {
        const customerId = item.order.customerId;
        const data = customerData.get(customerId);
        if (!data) continue;
        const date = item.salesLedgerDate ?? item.order.requestedDeliveryDate;
        if (!date) continue;
        const amount = vatIncludedAmount({
            quantity: item.requestedQuantity,
            unitPrice: item.salesUnitPrice,
        });
        if (importedSalesKeys.has(salesMatchKey({
            customerId,
            date,
            productId: item.productId,
            productName: item.product.productName,
            quantity: item.requestedQuantity,
            amount,
        }))) continue;
        addToMap(data.salesByMonth, monthKey(date), amount);
    }

    for (const receipt of receipts) {
        if (!receipt.customerId) continue;
        const data = customerData.get(receipt.customerId);
        if (!data) continue;
        data.receipts.push({ txDate: receipt.txDate, amount: Math.round(receipt.amount) });
    }

    const rows: CollectionReconciliationRow[] = [];
    for (const data of customerData.values()) {
        const monthKeys = Array.from(data.salesByMonth.keys()).filter((key) => key <= selectedMonth).sort();
        const receiptTotalThroughAsOf = data.receipts.reduce((sum, receipt) => sum + receipt.amount, 0);
        let remainingReceipt = receiptTotalThroughAsOf;
        const buckets: CollectionBucket[] = [];

        for (const key of monthKeys) {
            const salesTotal = Math.round(data.salesByMonth.get(key) ?? 0);
            const allocated = Math.min(salesTotal, remainingReceipt);
            remainingReceipt -= allocated;
            buckets.push({
                month: key,
                salesTotal,
                allocatedReceiptTotal: allocated,
                balance: salesTotal - allocated,
            });
        }

        const selectedBucket = buckets.find((bucket) => bucket.month === selectedMonth) ?? {
            month: selectedMonth,
            salesTotal: 0,
            allocatedReceiptTotal: 0,
            balance: 0,
        };
        const priorUnpaidTotal = buckets
            .filter((bucket) => bucket.month < selectedMonth)
            .reduce((sum, bucket) => sum + bucket.balance, 0);
        const latestReceiptDate = data.receipts.length > 0
            ? dateToIso(data.receipts.reduce((latest, receipt) => receipt.txDate > latest ? receipt.txDate : latest, data.receipts[0].txDate))
            : null;
        const advanceAmount = Math.max(0, remainingReceipt);
        const selectedSalesTotal = selectedBucket.salesTotal;
        const selectedAllocatedReceiptTotal = selectedBucket.allocatedReceiptTotal;
        const selectedBalance = selectedBucket.balance;
        const status: CollectionStatus = selectedSalesTotal > 0
            ? selectedBalance === 0
                ? 'PAID'
                : selectedAllocatedReceiptTotal > 0
                    ? 'PARTIAL'
                    : 'UNPAID'
            : advanceAmount > 0
                ? 'ADVANCE'
                : 'PAID';

        if (selectedSalesTotal === 0 && advanceAmount === 0 && priorUnpaidTotal === 0) continue;
        if (normalizedQuery) {
            const searchText = normalizeSearch([
                data.customer.companyName,
                data.customer.customerCode,
                data.customer.defaultSalesRep?.name,
                data.customer.paymentTerms,
            ].filter(Boolean).join(' '));
            if (!searchText.includes(normalizedQuery)) continue;
        }
        if (statusFilter !== 'all' && status !== statusFilter) continue;

        rows.push({
            customerId: data.customer.id,
            customerName: data.customer.companyName,
            customerCode: data.customer.customerCode,
            salesRepName: data.customer.defaultSalesRep?.name ?? null,
            paymentTerms: data.customer.paymentTerms,
            selectedMonth,
            selectedSalesTotal,
            selectedAllocatedReceiptTotal,
            selectedBalance,
            priorUnpaidTotal,
            advanceAmount,
            receiptTotalThroughAsOf,
            latestReceiptDate,
            status,
            buckets: buckets.filter((bucket) => bucket.balance !== 0 || bucket.month === selectedMonth).slice(-6),
        });
    }

    rows.sort((a, b) => {
        const severity = (row: CollectionReconciliationRow) =>
            row.status === 'UNPAID' ? 0
                : row.status === 'PARTIAL' ? 1
                    : row.priorUnpaidTotal > 0 ? 2
                        : row.status === 'ADVANCE' ? 3
                            : 4;
        return severity(a) - severity(b)
            || (b.selectedBalance - a.selectedBalance)
            || a.customerName.localeCompare(b.customerName, 'ko');
    });

    const summary = rows.reduce<CollectionReconciliationSummary>((acc, row) => {
        acc.customerCount += 1;
        acc.selectedSalesTotal += row.selectedSalesTotal;
        acc.selectedAllocatedReceiptTotal += row.selectedAllocatedReceiptTotal;
        acc.selectedBalanceTotal += row.selectedBalance;
        acc.priorUnpaidTotal += row.priorUnpaidTotal;
        acc.advanceTotal += row.advanceAmount;
        if (row.status === 'PAID') acc.paidCount += 1;
        if (row.status === 'PARTIAL') acc.partialCount += 1;
        if (row.status === 'UNPAID') acc.unpaidCount += 1;
        if (row.status === 'ADVANCE') acc.advanceCount += 1;
        return acc;
    }, {
        customerCount: 0,
        selectedSalesTotal: 0,
        selectedAllocatedReceiptTotal: 0,
        selectedBalanceTotal: 0,
        priorUnpaidTotal: 0,
        advanceTotal: 0,
        paidCount: 0,
        partialCount: 0,
        unpaidCount: 0,
        advanceCount: 0,
    });

    return {
        selectedMonth,
        allocationFromMonth,
        asOf: dateToIso(asOfDate),
        query,
        status: statusFilter,
        rows,
        summary,
    };
}

