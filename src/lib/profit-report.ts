import { prisma } from '@/lib/db';

export type ProfitSortKey = 'name' | 'quantity' | 'sales' | 'purchase' | 'profit' | 'receivable';
export type ProfitSortDir = 'asc' | 'desc';

export type ProfitReportRow = {
    key: string;
    label: string;
    salesRepName?: string;
    customerId?: string;
    quantity: number;
    salesSupply: number;
    salesVat: number;
    salesTotal: number;
    purchaseSupply: number;
    purchaseVat: number;
    purchaseTotal: number;
    profitTotal: number;
    receiptTotal: number;
    openingReceivable: number;
    currentReceivable: number;
};

export type ProfitReport = {
    from: string;
    to: string;
    selectedRepId: string;
    reps: { id: string; name: string }[];
    summary: ProfitReportRow;
    monthly: ProfitReportRow[];
    byProduct: ProfitReportRow[];
    byCustomer: ProfitReportRow[];
    byRep: ProfitReportRow[];
    repCustomers: ProfitReportRow[];
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

function monthKey(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function amountTotal(supply: number | null | undefined, vat: number | null | undefined, total: number | null | undefined) {
    if (total != null) return total;
    return (supply ?? 0) + (vat ?? 0);
}

function normalizeCompanyName(value: string | null | undefined) {
    return (value ?? '')
        .replace(/주식\s*회사/g, '')
        .replace(/\(주\)|㈜|\s|[()]/g, '')
        .trim();
}

function isHanyangCustomerName(value: string | null | undefined) {
    return normalizeCompanyName(value) === '한양유화';
}

function emptyRow(key: string, label: string): ProfitReportRow {
    return {
        key,
        label,
        quantity: 0,
        salesSupply: 0,
        salesVat: 0,
        salesTotal: 0,
        purchaseSupply: 0,
        purchaseVat: 0,
        purchaseTotal: 0,
        profitTotal: 0,
        receiptTotal: 0,
        openingReceivable: 0,
        currentReceivable: 0,
    };
}

function addToMap(map: Map<string, ProfitReportRow>, key: string, label: string) {
    const row = map.get(key) ?? emptyRow(key, label);
    map.set(key, row);
    return row;
}

function sortRows(rows: ProfitReportRow[], sort: ProfitSortKey, dir: ProfitSortDir = 'desc') {
    const sorted = [...rows];
    const factor = dir === 'asc' ? 1 : -1;
    if (sort === 'name') return sorted.sort((a, b) => a.label.localeCompare(b.label, 'ko') * factor);
    if (sort === 'quantity') return sorted.sort((a, b) => (a.quantity - b.quantity) * factor);
    if (sort === 'sales') return sorted.sort((a, b) => (a.salesTotal - b.salesTotal) * factor);
    if (sort === 'purchase') return sorted.sort((a, b) => (a.purchaseTotal - b.purchaseTotal) * factor);
    if (sort === 'receivable') return sorted.sort((a, b) => (a.currentReceivable - b.currentReceivable) * factor);
    return sorted.sort((a, b) => (a.profitTotal - b.profitTotal) * factor);
}

export function defaultProfitRange(today = new Date()) {
    return { from: `${today.getFullYear()}-01-01`, to: dateToIso(today) };
}

export async function getProfitReport(options: {
    fromIso?: string;
    toIso?: string;
    sort?: ProfitSortKey;
    dir?: ProfitSortDir;
    selectedRepId?: string;
    viewerUserId?: string;
    canViewAll?: boolean;
}): Promise<ProfitReport> {
    const fallback = defaultProfitRange();
    const from = toDateOnly(options.fromIso || fallback.from);
    const toInclusive = toDateOnly(options.toIso || fallback.to);
    const toExclusive = addDays(toInclusive, 1);
    const sort = options.sort || 'sales';
    const dir = options.dir === 'asc' ? 'asc' : 'desc';
    const selectedRepId = options.canViewAll ? (options.selectedRepId || 'all') : (options.viewerUserId || options.selectedRepId || 'all');

    const repWhere = selectedRepId !== 'all' ? { defaultSalesRepId: selectedRepId } : {};

    const [reps, ledgerEntries, purchaseLedgerEntries, orderItems, receipts, customers] = await Promise.all([
        prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.ledgerEntry.findMany({
            where: {
                transactionDate: { gte: from, lt: toExclusive },
                OR: [{ ledgerType: 'PURCHASE' }, { ledgerType: 'SALES', customer: repWhere }],
            },
            include: {
                customer: { select: { id: true, companyName: true, defaultSalesRepId: true, openingReceivable: true, defaultSalesRep: { select: { name: true } } } },
                supplier: { select: { id: true, supplierName: true } },
                product: { select: { id: true, productName: true, productCode: true } },
            },
        }),
        // also fetch ALL purchase entries independently for the unit rate map
        prisma.ledgerEntry.findMany({
            where: { transactionDate: { gte: from, lt: toExclusive }, ledgerType: 'PURCHASE' },
            select: { transactionDate: true, productId: true, productName: true, quantity: true, supplyAmount: true, vatAmount: true, totalAmount: true },
        }), prisma.orderItem.findMany({
            where: {
                order: {
                    deletedAt: null,
                    requestedDeliveryDate: { gte: from, lt: toExclusive },
                    status: { notIn: ['CANCELLED', 'REJECTED'] },
                    customer: repWhere,
                },
            },
            include: {
                product: { select: { id: true, productName: true, productCode: true } },
                order: { include: { customer: { include: { defaultSalesRep: { select: { name: true } } } } } },
            },
        }),
        prisma.creditTransaction.findMany({
            where: { txType: 'IN', txDate: { gte: from, lt: toExclusive }, customer: repWhere },
            include: { customer: { include: { defaultSalesRep: { select: { name: true } } } } },
        }),
        prisma.customer.findMany({
            where: repWhere,
            select: { id: true, companyName: true, openingReceivable: true, defaultSalesRepId: true, defaultSalesRep: { select: { name: true } } },
        }),
    ]);

    const summary = emptyRow('summary', '전체');
    const monthly = new Map<string, ProfitReportRow>();
    const byProduct = new Map<string, ProfitReportRow>();
    const byCustomer = new Map<string, ProfitReportRow>();
    const byRep = new Map<string, ProfitReportRow>();
    const repCustomers = new Map<string, ProfitReportRow>();

    // Build monthly product purchase unit rate for proportional attribution
    // key: "YYYY-MM:productKey" → { supply, vat, total, qty }
    type RateEntry = { supply: number; vat: number; total: number; qty: number };
    const monthProductRate = new Map<string, RateEntry>();
    for (const e of purchaseLedgerEntries) {
        const productKey = e.productId || `import:${e.productName}`;
        const rateKey = `${monthKey(e.transactionDate)}:${productKey}`;
        const r = monthProductRate.get(rateKey) ?? { supply: 0, vat: 0, total: 0, qty: 0 };
        r.supply += e.supplyAmount ?? 0;
        r.vat += e.vatAmount ?? 0;
        r.total += amountTotal(e.supplyAmount, e.vatAmount, e.totalAmount);
        r.qty += e.quantity ?? 0;
        monthProductRate.set(rateKey, r);
    }
    function getUnitPurchaseCost(date: Date, productKey: string, salesQty: number) {
        const r = monthProductRate.get(`${monthKey(date)}:${productKey}`);
        if (!r || r.qty === 0) return null;
        const ratio = salesQty / r.qty;
        return { supply: r.supply * ratio, vat: r.vat * ratio, total: r.total * ratio };
    }

    function addSales(date: Date, productKey: string, productLabel: string, customerId: string | null, customerLabel: string, repId: string | null, repName: string, quantity: number, supply: number, vat: number, total: number, explicitPurchaseCost?: { supply: number; vat: number; total: number } | null) {
        const month = addToMap(monthly, monthKey(date), monthKey(date));
        const product = addToMap(byProduct, productKey, productLabel);
        const customer = addToMap(byCustomer, customerId || `customer:${customerLabel}`, customerLabel);
        const rep = addToMap(byRep, repId || 'unassigned', repName || '미지정');
        const repCustomer = addToMap(repCustomers, customer.key, customerLabel);
        customer.customerId = customerId || undefined;
        customer.salesRepName = repName || '미지정';
        repCustomer.customerId = customerId || undefined;
        repCustomer.salesRepName = repName || '미지정';

        for (const row of [summary, month, product, customer, rep, repCustomer]) {
            row.quantity += quantity;
            row.salesSupply += supply;
            row.salesVat += vat;
            row.salesTotal += total;
        }

        const pc = explicitPurchaseCost ?? getUnitPurchaseCost(date, productKey, quantity);
        if (pc) {
            for (const row of [summary, month, product, customer, rep, repCustomer]) {
                row.purchaseSupply += pc.supply;
                row.purchaseVat += pc.vat;
                row.purchaseTotal += pc.total;
            }
        }
    }

    for (const entry of ledgerEntries) {
        const productKey = entry.productId || `import:${entry.productName}`;
        const productLabel = entry.product?.productName || entry.productName || '미지정 품목';
        const quantity = entry.quantity || 0;
        const supply = entry.supplyAmount ?? 0;
        const vat = entry.vatAmount ?? 0;
        const total = amountTotal(entry.supplyAmount, entry.vatAmount, entry.totalAmount);

        if (entry.ledgerType === 'SALES') {
            const customer = entry.customer;
            const customerLabel = customer?.companyName || entry.counterpartyName || '미지정 거래처';
            if (isHanyangCustomerName(customerLabel)) continue;
            addSales(
                entry.transactionDate,
                productKey,
                productLabel,
                customer?.id ?? null,
                customerLabel,
                customer?.defaultSalesRepId ?? null,
                customer?.defaultSalesRep?.name || '미지정',
                quantity,
                supply,
                vat,
                total,
            );
        }
    }

    for (const item of orderItems) {
        const date = item.order.requestedDeliveryDate || item.createdAt;
        const quantity = item.requestedQuantity || 0;
        const salesSupply = item.salesUnitPrice == null ? 0 : quantity * item.salesUnitPrice;
        const purchaseSupply = item.purchaseUnitPrice == null ? 0 : quantity * item.purchaseUnitPrice;
        const productKey = item.productId;
        const productLabel = item.product.productName;
        const customer = item.order.customer;
        if (isHanyangCustomerName(customer.companyName)) continue;
        const explicitCost = purchaseSupply > 0 ? { supply: purchaseSupply, vat: 0, total: purchaseSupply } : null;
        addSales(date, productKey, productLabel, customer.id, customer.companyName, customer.defaultSalesRepId, customer.defaultSalesRep?.name || '미지정', quantity, salesSupply, 0, salesSupply, explicitCost);
    }

    for (const receipt of receipts) {
        const customer = receipt.customer;
        if (!customer) continue;
        const customerRow = addToMap(byCustomer, customer.id, customer.companyName);
        const repCustomerRow = addToMap(repCustomers, customer.id, customer.companyName);
        const repRow = addToMap(byRep, customer.defaultSalesRepId || 'unassigned', customer.defaultSalesRep?.name || '미지정');
        for (const row of [summary, customerRow, repCustomerRow, repRow]) row.receiptTotal += receipt.amount;
    }

    for (const customer of customers) {
        const customerRow = addToMap(byCustomer, customer.id, customer.companyName);
        const repCustomerRow = addToMap(repCustomers, customer.id, customer.companyName);
        const opening = customer.openingReceivable ?? 0;
        for (const row of [customerRow, repCustomerRow]) {
            row.customerId = customer.id;
            row.salesRepName = customer.defaultSalesRep?.name || '미지정';
            row.openingReceivable = opening;
            row.currentReceivable = opening + row.salesTotal - row.receiptTotal;
        }
    }

    const allRows = [summary, ...monthly.values(), ...byProduct.values(), ...byCustomer.values(), ...byRep.values(), ...repCustomers.values()];
    for (const row of allRows) row.profitTotal = row.salesTotal - row.purchaseTotal;

    return {
        from: dateToIso(from),
        to: dateToIso(toInclusive),
        selectedRepId,
        reps,
        summary,
        monthly: sortRows(Array.from(monthly.values()), sort, dir),
        byProduct: sortRows(Array.from(byProduct.values()), sort, dir),
        byCustomer: sortRows(Array.from(byCustomer.values()).filter((row) => row.salesTotal > 0), sort, dir),
        byRep: sortRows(Array.from(byRep.values()), sort, dir),
        repCustomers: sortRows(Array.from(repCustomers.values()).filter((row) => row.salesTotal > 0), sort, dir),
    };
}


