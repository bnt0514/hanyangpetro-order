import { prisma } from '@/lib/db';
import { LEDGER_DISPATCH_COMPLETED_WHERE, ledgerPurchaseDate, ledgerSalesDate } from '@/lib/ledger-policy';
import { reportProductGroupLabel, reportProductIdentityKey } from '@/lib/report-product-identity';

export type PerformanceView =
    | 'sales_product'
    | 'sales_customer'
    | 'purchase_product'
    | 'purchase_supplier';

export type PerformanceSortKey =
    | 'name' | 'parentName' | 'rep'
    | 'quantityA' | 'quantityB' | 'quantityDelta'
    | 'amountA' | 'amountB' | 'amountDelta'
    | 'avgIntervalDays' | 'maxIntervalDays' | 'daysSinceLast' | 'daysUntilExpected';

export type PerformanceSortDir = 'asc' | 'desc';

export type ComparisonRow = {
    key: string;
    label: string;
    customerId?: string;
    supplierId?: string;
    salesRepName?: string;
    quantityA: number;
    quantityB: number;
    quantityDelta: number;
    amountA: number;
    amountB: number;
    amountDelta: number;
};

export type CrossRow = {
    key: string;
    parentKey: string;
    parentId?: string;
    parentLabel: string;
    productKey: string;
    productLabel: string;
    salesRepName?: string;
    quantityA: number;
    quantityB: number;
    quantityDelta: number;
    amountA: number;
    amountB: number;
    amountDelta: number;
};

export type PatternRow = {
    key: string;
    customerId?: string;
    customerName: string;
    salesRepName?: string;
    orderCount: number;
    totalQuantity: number;
    totalAmount: number;
    firstOrderDate: string | null;
    lastOrderDate: string | null;
    avgIntervalDays: number | null;
    maxIntervalDays: number | null;
    daysSinceLast: number | null;
    expectedNextOrderDate: string | null;
    daysUntilExpected: number | null;
    patternStatus: 'REGULAR' | 'IRREGULAR';
    irregularReason: string | null;
};

export type PerformanceReport = {
    periodA: { from: string; to: string };
    periodB: { from: string; to: string };
    patternPeriod: { from: string; to: string };
    selectedRepId: string;
    reps: { id: string; name: string }[];
    // 매출
    salesSummary: ComparisonRow;
    salesProducts: ComparisonRow[];
    salesCustomers: ComparisonRow[];
    salesCustomerProducts: CrossRow[];
    // 매입
    purchaseSummary: ComparisonRow;
    purchaseProducts: ComparisonRow[];
    purchaseSuppliers: ComparisonRow[];
    purchaseSupplierProducts: CrossRow[];
    // 주문패턴 (customer-patterns 페이지에서 사용)
    patterns: PatternRow[];
    irregularPatterns: PatternRow[];
};

// ────────────────────────────────────────────────────────────
// Internal fact types
// ────────────────────────────────────────────────────────────

type SalesFact = {
    date: Date;
    productKey: string;
    productName: string;
    customerKey: string;
    customerId?: string;
    customerName: string;
    salesRepId?: string | null;
    salesRepName?: string;
    quantity: number;
    amount: number;
};

type PurchaseFact = {
    date: Date;
    productKey: string;
    productName: string;
    supplierKey: string;
    supplierId?: string;
    supplierName: string;
    quantity: number;
    amount: number;
};

// ────────────────────────────────────────────────────────────
// Utility
// ────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

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

function monthStart(date: Date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function monthEnd(date: Date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0); }
function previousMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth() - 1, 1); }

function normalizeKey(value: string | null | undefined) {
    return (value ?? '').replace(/\s+/g, '').replace(/[()<>]/g, '').trim().toUpperCase();
}

function normalizeCompanyName(value: string | null | undefined) {
    return (value ?? '').replace(/주식\s*회사/g, '').replace(/\(주\)|㈜|\s|[()]/g, '').trim();
}

function isHanyangCustomerName(value: string | null | undefined) {
    return normalizeCompanyName(value) === '한양유화';
}

function amountFromParts(quantity: number, unitPrice?: number | null, supply?: number | null, total?: number | null, vat?: number | null) {
    if (supply != null) return supply;
    if (total != null) return total - (vat ?? 0);
    if (unitPrice != null) return quantity * unitPrice;
    return 0;
}

function emptyComparisonRow(key: string, label: string): ComparisonRow {
    return { key, label, quantityA: 0, quantityB: 0, quantityDelta: 0, amountA: 0, amountB: 0, amountDelta: 0 };
}

function addToComparison(map: Map<string, ComparisonRow>, key: string, label: string) {
    const row = map.get(key) ?? emptyComparisonRow(key, label);
    map.set(key, row);
    return row;
}

function finalizeComparison(row: ComparisonRow) {
    row.quantityDelta = row.quantityA - row.quantityB;
    row.amountDelta = row.amountA - row.amountB;
}

// ────────────────────────────────────────────────────────────
// Sort helpers
// ────────────────────────────────────────────────────────────

function sortComparisonRows(rows: ComparisonRow[], sort: PerformanceSortKey, dir: PerformanceSortDir) {
    const factor = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        if (sort === 'name') return a.label.localeCompare(b.label, 'ko') * factor;
        if (sort === 'rep') return (a.salesRepName ?? '').localeCompare(b.salesRepName ?? '', 'ko') * factor;
        if (sort === 'quantityA') return (a.quantityA - b.quantityA) * factor;
        if (sort === 'quantityB') return (a.quantityB - b.quantityB) * factor;
        if (sort === 'amountA') return (a.amountA - b.amountA) * factor;
        if (sort === 'amountB') return (a.amountB - b.amountB) * factor;
        if (sort === 'amountDelta') return (a.amountDelta - b.amountDelta) * factor;
        return (a.quantityDelta - b.quantityDelta) * factor; // default: quantityDelta
    });
}

function sortCrossRows(rows: CrossRow[], sort: PerformanceSortKey, dir: PerformanceSortDir) {
    const factor = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        if (sort === 'parentName') return (a.parentLabel.localeCompare(b.parentLabel, 'ko') || a.productLabel.localeCompare(b.productLabel, 'ko')) * factor;
        if (sort === 'name') return a.productLabel.localeCompare(b.productLabel, 'ko') * factor;
        if (sort === 'rep') return (a.salesRepName ?? '').localeCompare(b.salesRepName ?? '', 'ko') * factor;
        if (sort === 'quantityA') return (a.quantityA - b.quantityA) * factor;
        if (sort === 'quantityB') return (a.quantityB - b.quantityB) * factor;
        if (sort === 'amountA') return (a.amountA - b.amountA) * factor;
        if (sort === 'amountB') return (a.amountB - b.amountB) * factor;
        if (sort === 'amountDelta') return (a.amountDelta - b.amountDelta) * factor;
        // default: quantityDelta desc, then group by parent
        if (sort === 'quantityDelta') return (a.quantityDelta - b.quantityDelta) * factor;
        const p = a.parentLabel.localeCompare(b.parentLabel, 'ko');
        return p !== 0 ? p : b.quantityDelta - a.quantityDelta;
    });
}

function sortPatternRows(rows: PatternRow[], sort: PerformanceSortKey, dir: PerformanceSortDir) {
    const factor = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        if (sort === 'name') return a.customerName.localeCompare(b.customerName, 'ko') * factor;
        if (sort === 'rep') return (a.salesRepName ?? '').localeCompare(b.salesRepName ?? '', 'ko') * factor;
        if (sort === 'quantityA') return (a.totalQuantity - b.totalQuantity) * factor;
        if (sort === 'amountA') return (a.totalAmount - b.totalAmount) * factor;
        if (sort === 'maxIntervalDays') return ((a.maxIntervalDays ?? 999999) - (b.maxIntervalDays ?? 999999)) * factor;
        if (sort === 'daysSinceLast') return ((a.daysSinceLast ?? 999999) - (b.daysSinceLast ?? 999999)) * factor;
        if (sort === 'daysUntilExpected') return ((a.daysUntilExpected ?? 999999) - (b.daysUntilExpected ?? 999999)) * factor;
        if (sort === 'avgIntervalDays') return ((a.avgIntervalDays ?? 999999) - (b.avgIntervalDays ?? 999999)) * factor;
        return (a.orderCount - b.orderCount) * factor;
    });
}

// ────────────────────────────────────────────────────────────
// Data fetchers
// ────────────────────────────────────────────────────────────

async function fetchSalesFacts(from: Date, toInclusive: Date, salesRepId?: string): Promise<SalesFact[]> {
    const toExclusive = addDays(toInclusive, 1);
    const customerRepFilter = salesRepId ? { defaultSalesRepId: salesRepId } : {};
    const [orderItems, importEntries] = await Promise.all([
        prisma.orderItem.findMany({
            where: {
                OR: [
                    { salesLedgerDate: { gte: from, lt: toExclusive } },
                    { salesLedgerDate: null, order: { requestedDeliveryDate: { gte: from, lt: toExclusive } } },
                ],
                order: {
                    deletedAt: null,
                    ...LEDGER_DISPATCH_COMPLETED_WHERE,
                    customer: customerRepFilter,
                },
            },
            include: {
                product: { select: { id: true, productName: true, productCode: true } },
                order: { include: { customer: { select: { id: true, companyName: true, defaultSalesRepId: true, defaultSalesRep: { select: { name: true } } } } } },
            },
        }),
        prisma.ledgerEntry.findMany({
            where: {
                ledgerType: 'SALES',
                orderItemId: null,
                transactionDate: { gte: from, lt: toExclusive },
                ...(salesRepId ? { customer: { defaultSalesRepId: salesRepId } } : {}),
            },
            include: {
                product: { select: { id: true, productName: true, productCode: true } },
                customer: { select: { id: true, companyName: true, defaultSalesRepId: true, defaultSalesRep: { select: { name: true } } } },
            },
        }),
    ]);

    const facts: SalesFact[] = [];

    for (const item of orderItems) {
        const customerName = item.order.customer.companyName;
        if (isHanyangCustomerName(customerName)) continue;
        const quantity = item.requestedQuantity ?? 0;
        facts.push({
            date: ledgerSalesDate(item) ?? item.createdAt,
            productKey: reportProductIdentityKey(item.product.productName, item.product.productCode),
            productName: reportProductGroupLabel(item.product.productName),
            customerKey: item.order.customer.id,
            customerId: item.order.customer.id,
            customerName,
            salesRepId: item.order.customer.defaultSalesRepId,
            salesRepName: item.order.customer.defaultSalesRep?.name ?? '미지정',
            quantity,
            amount: amountFromParts(quantity, item.salesUnitPrice),
        });
    }

    for (const entry of importEntries) {
        const customerName = entry.customer?.companyName || entry.counterpartyName || '미지정 거래처';
        if (isHanyangCustomerName(customerName)) continue;
        const quantity = entry.quantity ?? 0;
        const productName = entry.product?.productName || entry.productName || '미지정 품목';
        facts.push({
            date: entry.transactionDate,
            productKey: reportProductIdentityKey(productName, entry.product?.productCode),
            productName: reportProductGroupLabel(productName),
            customerKey: entry.customer?.id || `name:${normalizeKey(customerName)}`,
            customerId: entry.customer?.id ?? undefined,
            customerName,
            salesRepId: entry.customer?.defaultSalesRepId,
            salesRepName: entry.customer?.defaultSalesRep?.name ?? '미지정',
            quantity,
            amount: amountFromParts(quantity, entry.unitPrice, entry.supplyAmount, entry.totalAmount, entry.vatAmount),
        });
    }

    return facts;
}

async function fetchPurchaseFacts(from: Date, toInclusive: Date, salesRepId?: string): Promise<PurchaseFact[]> {
    const toExclusive = addDays(toInclusive, 1);
    const customerRepFilter = salesRepId ? { defaultSalesRepId: salesRepId } : {};

    const [orderItems, ledgerEntries] = await Promise.all([
        prisma.orderItem.findMany({
            where: {
                purchaseUnitPrice: { not: null },
                fulfillmentType: { not: 'WAREHOUSE' }, // 창고 출고는 매입 집계 제외
                purchaseLedgerDate: { gte: from, lt: toExclusive },
                order: {
                    deletedAt: null,
                    ...LEDGER_DISPATCH_COMPLETED_WHERE,
                    customer: customerRepFilter,
                },
            },
            include: {
                product: { select: { id: true, productName: true, productCode: true } },
                purchaseSupplier: { select: { id: true, supplierName: true } },
                order: {
                    select: {
                        requestedDeliveryDate: true,
                        createdAt: true,
                        
                        dispatches: {
                            where: { dispatchStatus: 'DISPATCH_COMPLETED' },
                            orderBy: { plannedDispatchDate: 'asc' },
                            take: 1,
                            select: { plannedDispatchDate: true },
                        },
                    },
                },
            },
        }),
        prisma.ledgerEntry.findMany({
            where: {
                ledgerType: 'PURCHASE',
                transactionDate: { gte: from, lt: toExclusive },
                ...(salesRepId ? { customer: { defaultSalesRepId: salesRepId } } : {}),
            },
            include: {
                product: { select: { id: true, productName: true, productCode: true } },
                supplier: { select: { id: true, supplierName: true } },
            },
        }),
    ]);

    const facts: PurchaseFact[] = [];

    for (const item of orderItems) {
        const supplierName = item.purchaseSupplier?.supplierName ?? '미지정 공급사';
        const supplierKey = item.purchaseSupplierId ?? `name:${normalizeKey(supplierName)}`;
        const quantity = item.requestedQuantity ?? 0;
        facts.push({
            date: ledgerPurchaseDate(item) ?? item.order.createdAt,
            productKey: reportProductIdentityKey(item.product.productName, item.product.productCode),
            productName: reportProductGroupLabel(item.product.productName),
            supplierKey,
            supplierId: item.purchaseSupplierId ?? undefined,
            supplierName,
            quantity,
            amount: amountFromParts(quantity, item.purchaseUnitPrice),
        });
    }

    for (const entry of ledgerEntries) {
        const supplierName = entry.supplier?.supplierName ?? entry.counterpartyName ?? '미지정 공급사';
        const supplierKey = entry.supplierId ?? `name:${normalizeKey(supplierName)}`;
        const quantity = entry.quantity ?? 0;
        const productName = entry.product?.productName ?? entry.productName ?? '미지정 품목';
        facts.push({
            date: entry.transactionDate,
            productKey: reportProductIdentityKey(productName, entry.product?.productCode),
            productName: reportProductGroupLabel(productName),
            supplierKey,
            supplierId: entry.supplierId ?? undefined,
            supplierName,
            quantity,
            amount: amountFromParts(quantity, entry.unitPrice, entry.supplyAmount, entry.totalAmount, entry.vatAmount),
        });
    }

    return facts;
}

// ────────────────────────────────────────────────────────────
// Builders
// ────────────────────────────────────────────────────────────

function buildSalesComparison(aFacts: SalesFact[], bFacts: SalesFact[]) {
    const summary = emptyComparisonRow('summary', '전체');
    const products = new Map<string, ComparisonRow>();
    const customers = new Map<string, ComparisonRow>();

    function add(fact: SalesFact, period: 'A' | 'B') {
        const product = addToComparison(products, fact.productKey, fact.productName);
        const customer = addToComparison(customers, fact.customerKey, fact.customerName);
        customer.customerId = fact.customerId;
        customer.salesRepName = fact.salesRepName ?? '미지정';
        for (const row of [summary, product, customer]) {
            if (period === 'A') { row.quantityA += fact.quantity; row.amountA += fact.amount; }
            else { row.quantityB += fact.quantity; row.amountB += fact.amount; }
        }
    }

    for (const fact of aFacts) add(fact, 'A');
    for (const fact of bFacts) add(fact, 'B');
    for (const row of [summary, ...products.values(), ...customers.values()]) finalizeComparison(row);
    return { summary, products: Array.from(products.values()), customers: Array.from(customers.values()) };
}

function buildPurchaseComparison(aFacts: PurchaseFact[], bFacts: PurchaseFact[]) {
    const summary = emptyComparisonRow('summary', '전체');
    const products = new Map<string, ComparisonRow>();
    const suppliers = new Map<string, ComparisonRow>();

    function add(fact: PurchaseFact, period: 'A' | 'B') {
        const product = addToComparison(products, fact.productKey, fact.productName);
        const supplier = addToComparison(suppliers, fact.supplierKey, fact.supplierName);
        supplier.supplierId = fact.supplierId;
        for (const row of [summary, product, supplier]) {
            if (period === 'A') { row.quantityA += fact.quantity; row.amountA += fact.amount; }
            else { row.quantityB += fact.quantity; row.amountB += fact.amount; }
        }
    }

    for (const fact of aFacts) add(fact, 'A');
    for (const fact of bFacts) add(fact, 'B');
    for (const row of [summary, ...products.values(), ...suppliers.values()]) finalizeComparison(row);
    return { summary, products: Array.from(products.values()), suppliers: Array.from(suppliers.values()) };
}

function buildSalesBreakdown(aFacts: SalesFact[], bFacts: SalesFact[]): CrossRow[] {
    const map = new Map<string, CrossRow>();

    function add(fact: SalesFact, period: 'A' | 'B') {
        const key = `${fact.customerKey}::${fact.productKey}`;
        const row = map.get(key) ?? {
            key,
            parentKey: fact.customerKey,
            parentId: fact.customerId,
            parentLabel: fact.customerName,
            productKey: fact.productKey,
            productLabel: fact.productName,
            salesRepName: fact.salesRepName,
            quantityA: 0, quantityB: 0, quantityDelta: 0,
            amountA: 0, amountB: 0, amountDelta: 0,
        };
        if (period === 'A') { row.quantityA += fact.quantity; row.amountA += fact.amount; }
        else { row.quantityB += fact.quantity; row.amountB += fact.amount; }
        map.set(key, row);
    }

    for (const fact of aFacts) add(fact, 'A');
    for (const fact of bFacts) add(fact, 'B');
    for (const row of map.values()) { row.quantityDelta = row.quantityA - row.quantityB; row.amountDelta = row.amountA - row.amountB; }
    return Array.from(map.values());
}

function buildPurchaseBreakdown(aFacts: PurchaseFact[], bFacts: PurchaseFact[]): CrossRow[] {
    const map = new Map<string, CrossRow>();

    function add(fact: PurchaseFact, period: 'A' | 'B') {
        const key = `${fact.supplierKey}::${fact.productKey}`;
        const row = map.get(key) ?? {
            key,
            parentKey: fact.supplierKey,
            parentId: fact.supplierId,
            parentLabel: fact.supplierName,
            productKey: fact.productKey,
            productLabel: fact.productName,
            quantityA: 0, quantityB: 0, quantityDelta: 0,
            amountA: 0, amountB: 0, amountDelta: 0,
        };
        if (period === 'A') { row.quantityA += fact.quantity; row.amountA += fact.amount; }
        else { row.quantityB += fact.quantity; row.amountB += fact.amount; }
        map.set(key, row);
    }

    for (const fact of aFacts) add(fact, 'A');
    for (const fact of bFacts) add(fact, 'B');
    for (const row of map.values()) { row.quantityDelta = row.quantityA - row.quantityB; row.amountDelta = row.amountA - row.amountB; }
    return Array.from(map.values());
}

function buildPatterns(facts: SalesFact[], today = new Date()) {
    const map = new Map<string, { customerId?: string; customerName: string; salesRepName?: string; dates: Set<string>; totalQuantity: number; totalAmount: number }>();
    for (const fact of facts) {
        const row = map.get(fact.customerKey) ?? { customerId: fact.customerId, customerName: fact.customerName, salesRepName: fact.salesRepName ?? '미지정', dates: new Set<string>(), totalQuantity: 0, totalAmount: 0 };
        row.customerId = row.customerId ?? fact.customerId;
        row.salesRepName = row.salesRepName ?? fact.salesRepName ?? '미지정';
        row.dates.add(dateToIso(fact.date));
        row.totalQuantity += fact.quantity;
        row.totalAmount += fact.amount;
        map.set(fact.customerKey, row);
    }

    return Array.from(map.entries()).map(([key, row]) => {
        const dates = Array.from(row.dates).sort();
        let avgIntervalDays: number | null = null;
        let maxIntervalDays: number | null = null;
        const gaps: number[] = [];
        if (dates.length >= 2) {
            for (let i = 1; i < dates.length; i++) {
                gaps.push((toDateOnly(dates[i]).getTime() - toDateOnly(dates[i - 1]).getTime()) / DAY_MS);
            }
            avgIntervalDays = gaps.reduce((s, g) => s + g, 0) / gaps.length;
            maxIntervalDays = Math.max(...gaps);
        }
        const lastOrderDate = dates.at(-1) ?? null;
        const todayDate = toDateOnly(dateToIso(today));
        const daysSinceLast = lastOrderDate ? Math.floor((todayDate.getTime() - toDateOnly(lastOrderDate).getTime()) / DAY_MS) : null;
        let irregularReason: string | null = null;
        if (dates.length < 3) irregularReason = '주문 3회 미만';
        else if (avgIntervalDays == null) irregularReason = '주문 간격 부족';
        else if (avgIntervalDays > 70) irregularReason = '평균 70일 초과';
        else if (maxIntervalDays != null && maxIntervalDays > 90) irregularReason = '3개월 초과 공백';
        else if (daysSinceLast != null && daysSinceLast > 90) irregularReason = '최근 3개월 거래 없음';
        const patternStatus = irregularReason ? 'IRREGULAR' : 'REGULAR';
        const expectedDate = patternStatus === 'REGULAR' && lastOrderDate && avgIntervalDays != null ? addDays(toDateOnly(lastOrderDate), Math.round(avgIntervalDays)) : null;
        const daysUntilExpected = expectedDate ? Math.ceil((expectedDate.getTime() - toDateOnly(dateToIso(today)).getTime()) / DAY_MS) : null;
        return {
            key,
            customerId: row.customerId,
            customerName: row.customerName,
            salesRepName: row.salesRepName ?? '미지정',
            orderCount: dates.length,
            totalQuantity: row.totalQuantity,
            totalAmount: row.totalAmount,
            firstOrderDate: dates[0] ?? null,
            lastOrderDate,
            avgIntervalDays,
            maxIntervalDays,
            daysSinceLast,
            expectedNextOrderDate: expectedDate ? dateToIso(expectedDate) : null,
            daysUntilExpected,
            patternStatus,
            irregularReason,
        } satisfies PatternRow;
    });
}

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

export function defaultPerformanceRange(today = new Date()) {
    const currentStart = monthStart(today);
    const previous = previousMonth(today);
    const previousStart = monthStart(previous);
    const previousEnd = monthEnd(previous);
    const patternStart = new Date(2025, 0, 1);
    return {
        aFrom: dateToIso(currentStart),
        aTo: dateToIso(today),
        bFrom: dateToIso(previousStart),
        bTo: dateToIso(previousEnd),
        patternFrom: dateToIso(patternStart),
        patternTo: dateToIso(today),
    };
}

export async function getPerformanceReport(options: {
    aFrom?: string;
    aTo?: string;
    bFrom?: string;
    bTo?: string;
    patternFrom?: string;
    patternTo?: string;
    sort?: PerformanceSortKey;
    dir?: PerformanceSortDir;
    viewerUserId?: string;
    canViewAll?: boolean;
    selectedRepId?: string;
}): Promise<PerformanceReport> {
    const defaults = defaultPerformanceRange();
    const periodA = { from: options.aFrom || defaults.aFrom, to: options.aTo || defaults.aTo };
    const periodB = { from: options.bFrom || defaults.bFrom, to: options.bTo || defaults.bTo };
    const patternPeriod = { from: options.patternFrom || defaults.patternFrom, to: options.patternTo || defaults.patternTo };
    const sort = options.sort || 'quantityDelta';
    const dir = options.dir === 'asc' ? 'asc' : 'desc';
    const selectedRepId = options.canViewAll ? (options.selectedRepId || 'all') : (options.viewerUserId || 'all');
    const salesRepId = selectedRepId !== 'all' ? selectedRepId : undefined;

    const [reps, salesAFacts, salesBFacts, purchaseAFacts, purchaseBFacts, patternFacts] = await Promise.all([
        prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        fetchSalesFacts(toDateOnly(periodA.from), toDateOnly(periodA.to), salesRepId),
        fetchSalesFacts(toDateOnly(periodB.from), toDateOnly(periodB.to), salesRepId),
        fetchPurchaseFacts(toDateOnly(periodA.from), toDateOnly(periodA.to), salesRepId),
        fetchPurchaseFacts(toDateOnly(periodB.from), toDateOnly(periodB.to), salesRepId),
        fetchSalesFacts(toDateOnly(patternPeriod.from), toDateOnly(patternPeriod.to), salesRepId),
    ]);

    const salesComp = buildSalesComparison(salesAFacts, salesBFacts);
    const purchaseComp = buildPurchaseComparison(purchaseAFacts, purchaseBFacts);
    const patternRows = buildPatterns(patternFacts);

    return {
        periodA,
        periodB,
        patternPeriod,
        selectedRepId,
        reps,
        salesSummary: salesComp.summary,
        salesProducts: sortComparisonRows(salesComp.products, sort, dir),
        salesCustomers: sortComparisonRows(salesComp.customers, sort, dir),
        salesCustomerProducts: sortCrossRows(buildSalesBreakdown(salesAFacts, salesBFacts), sort, dir),
        purchaseSummary: purchaseComp.summary,
        purchaseProducts: sortComparisonRows(purchaseComp.products, sort, dir),
        purchaseSuppliers: sortComparisonRows(purchaseComp.suppliers, sort, dir),
        purchaseSupplierProducts: sortCrossRows(buildPurchaseBreakdown(purchaseAFacts, purchaseBFacts), sort, dir),
        patterns: sortPatternRows(patternRows.filter((r) => r.patternStatus === 'REGULAR'), sort, dir),
        irregularPatterns: sortPatternRows(patternRows.filter((r) => r.patternStatus === 'IRREGULAR'), sort, dir),
    };
}

