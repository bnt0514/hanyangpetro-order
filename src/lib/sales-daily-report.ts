import { prisma } from '@/lib/db';

export type DailyReportGroupBy = 'total' | 'product' | 'customer';
export type DailyReportMode = 'daily' | 'monthly';

export type DailyReportRow = {
    period: string;        // YYYY-MM-DD or YYYY-MM
    groupKey: string;      // unique key for the row
    label: string;         // product/customer name, or same as period for total
    salesQuantity: number;
    salesSupply: number;
    salesVat: number;
    salesTotal: number;
    purchaseQuantity: number;
    purchaseSupply: number;
    purchaseVat: number;
    purchaseTotal: number;
    profit: number;
};

export type DailyReport = {
    from: string;
    to: string;
    mode: DailyReportMode;
    groupBy: DailyReportGroupBy;
    rows: DailyReportRow[];
    summary: {
        salesQuantity: number;
        salesTotal: number;
        purchaseQuantity: number;
        purchaseTotal: number;
        profit: number;
    };
};

function dateToIso(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthKey(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function addDays(d: Date, n: number) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
}

export function todayIso(): string {
    return dateToIso(new Date());
}

export function yesterdayIso(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return dateToIso(d);
}

export function lastMonthRange(): { from: string; to: string } {
    const today = new Date();
    const firstOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: dateToIso(firstOfLastMonth), to: dateToIso(lastOfLastMonth) };
}

export function last3MonthsRange(): { from: string; to: string } {
    const today = new Date();
    const firstOf3MonthsAgo = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    return { from: dateToIso(firstOf3MonthsAgo), to: dateToIso(today) };
}

export async function getSalesDailyReport(options: {
    fromIso: string;
    toIso: string;
    mode: DailyReportMode;
    groupBy: DailyReportGroupBy;
}): Promise<DailyReport> {
    const { fromIso, toIso, mode, groupBy } = options;

    const from = new Date(`${fromIso}T00:00:00`);
    const to = new Date(`${toIso}T00:00:00`);
    const toExclusive = addDays(to, 1);

    const entries = await prisma.ledgerEntry.findMany({
        where: {
            transactionDate: { gte: from, lt: toExclusive },
            ledgerType: { in: ['SALES', 'PURCHASE'] },
        },
        select: {
            ledgerType: true,
            transactionDate: true,
            counterpartyName: true,
            productName: true,
            quantity: true,
            supplyAmount: true,
            vatAmount: true,
            totalAmount: true,
            customer: { select: { companyName: true } },
            supplier: { select: { supplierName: true } },
            product: { select: { productName: true } },
        },
        orderBy: { transactionDate: 'asc' },
    });

    const map = new Map<string, DailyReportRow>();

    for (const entry of entries) {
        const date = new Date(entry.transactionDate);
        const period = mode === 'daily' ? dateToIso(date) : monthKey(date);

        let groupLabel: string;
        if (groupBy === 'total') {
            groupLabel = period;
        } else if (groupBy === 'product') {
            groupLabel = entry.product?.productName || entry.productName || '기타';
        } else {
            // customer groupBy
            if (entry.ledgerType === 'SALES') {
                groupLabel = entry.customer?.companyName || entry.counterpartyName || '기타';
            } else {
                groupLabel = entry.supplier?.supplierName || entry.counterpartyName || '기타';
            }
        }

        const groupKey = groupBy === 'total' ? period : `${period}::${groupLabel}`;

        let row = map.get(groupKey);
        if (!row) {
            row = {
                period,
                groupKey,
                label: groupLabel,
                salesQuantity: 0, salesSupply: 0, salesVat: 0, salesTotal: 0,
                purchaseQuantity: 0, purchaseSupply: 0, purchaseVat: 0, purchaseTotal: 0,
                profit: 0,
            };
            map.set(groupKey, row);
        }

        const qty = entry.quantity ?? 0;
        const supply = entry.supplyAmount ?? 0;
        const vat = entry.vatAmount ?? 0;
        const total = entry.totalAmount != null ? entry.totalAmount : supply + vat;

        if (entry.ledgerType === 'SALES') {
            row.salesQuantity += qty;
            row.salesSupply += supply;
            row.salesVat += vat;
            row.salesTotal += total;
        } else {
            row.purchaseQuantity += qty;
            row.purchaseSupply += supply;
            row.purchaseVat += vat;
            row.purchaseTotal += total;
        }
        row.profit = row.salesTotal - row.purchaseTotal;
    }

    const rows = Array.from(map.values()).sort((a, b) => {
        if (a.period !== b.period) return a.period.localeCompare(b.period);
        return a.label.localeCompare(b.label, 'ko');
    });

    const summary = rows.reduce(
        (acc, row) => {
            acc.salesQuantity += row.salesQuantity;
            acc.salesTotal += row.salesTotal;
            acc.purchaseQuantity += row.purchaseQuantity;
            acc.purchaseTotal += row.purchaseTotal;
            acc.profit += row.profit;
            return acc;
        },
        { salesQuantity: 0, salesTotal: 0, purchaseQuantity: 0, purchaseTotal: 0, profit: 0 },
    );

    return { from: fromIso, to: toIso, mode, groupBy, rows, summary };
}
