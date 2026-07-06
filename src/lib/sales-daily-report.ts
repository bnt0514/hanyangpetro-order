import { prisma } from '@/lib/db';

import { LEDGER_DISPATCH_COMPLETED_WHERE, ledgerPurchaseDate, ledgerSalesDate } from '@/lib/ledger-policy';

export type DailyReportGroupBy = 'total' | 'product' | 'customer';
export type DailyReportMode = 'daily' | 'monthly';

export type DailyReportRow = {
    period: string;        // YYYY-MM-DD or YYYY-MM
    groupKey: string;      // unique key for the row
    label: string;         // product/customer name, or same as period for total
    orderRefs: Array<{ id: string; orderNo: string }>;
    salesCounterparties: string[];
    purchaseCounterparties: string[];
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

// 창고 입고 거래처: 한양유화, 비엔티 판별 로직
function normalizeCompany(v: string | null | undefined) {
    return (v ?? '').replace(/주식\s*회사/g, '').replace(/\(주\)|㈜|\s|[()]/g, '').trim();
}
function isWarehouseInboundCustomer(v: string | null | undefined) {
    const n = normalizeCompany(v);
    return n === '한양유화' || n.includes('비엔티') || n.includes('BNT');
}

function pushUnique(list: string[], value: string | null | undefined) {
    const text = value?.trim();
    if (text && !list.includes(text)) list.push(text);
}

function pushOrderRef(list: Array<{ id: string; orderNo: string }>, order: { id: string; orderNo: string } | null | undefined) {
    if (!order?.id || !order.orderNo) return;
    if (!list.some((item) => item.id === order.id)) list.push({ id: order.id, orderNo: order.orderNo });
}

function normalizeMatchText(value: string | null | undefined) {
    return (value ?? '')
        .replace(/\s+/g, '')
        .replace(/주식회사|\(주\)|㈜/g, '')
        .replace(/[<>()\[\]]/g, '')
        .toUpperCase();
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

// ?ㅻ뜑 ?곹깭 以?留ㅼ텧/留ㅼ엯 吏묎퀎???ы븿???곹깭

export async function getSalesDailyReport(options: {
    fromIso: string;
    toIso: string;
    mode: DailyReportMode;
    groupBy: DailyReportGroupBy;
    filterQ?: string; // ?덈ぉ紐??먮뒗 嫄곕옒泥섎챸 ?꾪꽣
    viewerUserId?: string;
    canViewAll?: boolean;
}): Promise<DailyReport> {
    const { fromIso, toIso, mode, groupBy, filterQ } = options;
    const fq = filterQ?.trim().toLowerCase() || '';
    const salesRepId = options.canViewAll ? undefined : options.viewerUserId;

    const from = new Date(`${fromIso}T00:00:00`);
    const to = new Date(`${toIso}T00:00:00`);
    const toExclusive = addDays(to, 1);
    const inRange = (date: Date | null | undefined) => !!date && date >= from && date < toExclusive;

    // ?? 1) LedgerEntry (?섏엯 ?곗씠?? ????????????????????????????????
    const entries = await prisma.ledgerEntry.findMany({
        where: {
            transactionDate: { gte: from, lt: toExclusive },
            ledgerType: { in: ['SALES', 'PURCHASE'] },
            ...(salesRepId ? { customer: { defaultSalesRepId: salesRepId } } : {}),
        },
        select: {
            ledgerType: true,
            transactionDate: true,
            counterpartyName: true,
            productName: true,
            quantity: true,
            unitPrice: true,
            supplyAmount: true,
            vatAmount: true,
            totalAmount: true,
            orderItemId: true,
            order: { select: { id: true, orderNo: true } },
            customer: { select: { companyName: true } },
            supplier: { select: { supplierName: true } },
            product: { select: { productName: true } },
        },
        orderBy: { transactionDate: 'asc' },
    });

    // ?? 2) OrderItem (?ㅻ뜑 ?쒖뒪???ㅼ쟻, ?④? ?덈뒗 嫄대쭔) ??????????????
    const orderItems = await prisma.orderItem.findMany({
        where: {
            order: {
                deletedAt: null,
                ...LEDGER_DISPATCH_COMPLETED_WHERE,
                ...(salesRepId ? { customer: { defaultSalesRepId: salesRepId } } : {}),
            },
            OR: [
                { salesLedgerDate: { gte: from, lt: toExclusive } },
                { salesLedgerDate: null, order: { requestedDeliveryDate: { gte: from, lt: toExclusive } } },
                { purchaseLedgerDate: { gte: from, lt: toExclusive } },
            ],
        },
        select: {
            id: true,
            fulfillmentType: true,
            requestedQuantity: true,
            salesUnitPrice: true,
            purchaseUnitPrice: true,
            salesLedgerDate: true,
            purchaseLedgerDate: true,
            product: { select: { productName: true } },
            order: {
                select: {
                    requestedDeliveryDate: true,
                    id: true,
                    orderNo: true,
                    status: true,
                    customer: { select: { companyName: true } },
                    
                    dispatches: {
                        where: { dispatchStatus: 'DISPATCH_COMPLETED' },
                        orderBy: { plannedDispatchDate: 'asc' },
                        take: 1,
                        select: { plannedDispatchDate: true },
                    },
                },
            },
            purchaseSupplier: { select: { supplierName: true } },
        },
    });

    const map = new Map<string, DailyReportRow>();

    function upsert(period: string, label: string, cb: (r: DailyReportRow) => void) {
        const groupKey = groupBy === 'total' ? period : `${period}::${label}`;
        let row = map.get(groupKey);
        if (!row) {
            row = {
                period, groupKey, label,
                orderRefs: [],
                salesCounterparties: [],
                purchaseCounterparties: [],
                salesQuantity: 0, salesSupply: 0, salesVat: 0, salesTotal: 0,
                purchaseQuantity: 0, purchaseSupply: 0, purchaseVat: 0, purchaseTotal: 0,
                profit: 0,
            };
            map.set(groupKey, row);
        }
        cb(row);
        row.profit = row.salesTotal - row.purchaseTotal;
    }

    // LedgerEntry 泥섎━
    for (const entry of entries) {
        const date = new Date(entry.transactionDate);
        const period = mode === 'daily' ? dateToIso(date) : monthKey(date);
        const productLabel = entry.productName || entry.product?.productName || '湲고?';
        const salesLabel = entry.customer?.companyName || entry.counterpartyName || '湲고?';
        const purchaseLabel = entry.supplier?.supplierName || entry.counterpartyName || '湲고?';
        const counterLabel = entry.ledgerType === 'SALES' ? salesLabel : purchaseLabel;

        let groupLabel: string;
        if (groupBy === 'total') groupLabel = period;
        else if (groupBy === 'product') groupLabel = productLabel;
        else groupLabel = counterLabel;

        // ?꾪꽣 ?곸슜
        if (fq) {
            if (groupBy === 'product' && !productLabel.toLowerCase().includes(fq)) continue;
            if (groupBy === 'customer' && !counterLabel.toLowerCase().includes(fq)) continue;
        }

        const qty = entry.quantity ?? 0;
        const supply = entry.supplyAmount ?? 0;
        const vat = entry.vatAmount ?? 0;
        const total = entry.totalAmount != null ? entry.totalAmount : supply + vat;

        upsert(period, groupLabel, (r) => {
            pushOrderRef(r.orderRefs, entry.order);
            if (entry.ledgerType === 'SALES') {
                pushUnique(r.salesCounterparties, salesLabel);
                r.salesQuantity += qty; r.salesSupply += supply; r.salesVat += vat; r.salesTotal += total;
            } else {
                pushUnique(r.purchaseCounterparties, purchaseLabel);
                r.purchaseQuantity += qty; r.purchaseSupply += supply; r.purchaseVat += vat; r.purchaseTotal += total;
            }
        });
    }

    // OrderItem 泥섎━ (LedgerEntry? 以묐났 諛⑹?: salesLedgerDate媛 ?덈뒗 嫄댁? ?대? LedgerEntry??諛섏쁺??
    // orderItem? salesLedgerDate媛 null?닿굅??LedgerEntry??orderItemId濡??곌껐 ????嫄대쭔 ?ы븿
    // ???⑥닚 泥섎━: orderItem???곌껐??ledgerEntry瑜??쒖쇅?섍린 ?꾪빐 orderItem ?먯껜 吏묎퀎 (ledgerEntry? 以묐났 媛?μ꽦 ?덉쓬)
    // ?ㅼ젣濡쒕뒗 orderItem??異쒓퀬 ?꾨즺?섎㈃ ledgerEntry???곌껐?섎?濡? ledgerEntry.orderItemId媛 ?덈뒗 嫄?= orderItem怨?以묐났
    // ?곕씪??orderItem留?蹂꾨룄濡?吏묎퀎?섎릺, ledgerEntry???대? ?≫엺 嫄?orderItemId ?덈뒗 嫄?? ledgerEntry?먯꽌 泥섎━??
    // ??orderItem 以?ledgerEntry???곌껐??嫄댁? salesLedgerDate媛 ?덇퀬 ledgerEntry?먯꽌 吏묎퀎??
    // ??orderItem 以?ledgerEntry???곌껐 ????嫄?誘몄쟾?? 異쒓퀬?꾨즺 ?댁쟾)? ?ш린??吏묎퀎
    const alreadyInSalesLedger = new Set(entries.filter((e) => e.ledgerType === 'SALES' && e.orderItemId).map((e) => e.orderItemId as string));
    const alreadyInPurchaseLedger = new Set(entries.filter((e) => e.ledgerType === 'PURCHASE' && e.orderItemId).map((e) => e.orderItemId as string));
    const matchedSalesLedgerIndexes = new Set<number>();
    const matchedPurchaseLedgerIndexes = new Set<number>();

    function sameCounterparty(a: string | null | undefined, b: string | null | undefined) {
        const left = normalizeMatchText(a);
        const right = normalizeMatchText(b);
        return !left || !right || left === right || left.includes(right) || right.includes(left);
    }

    function findMatchingLedgerIndex(
        ledgerType: 'SALES' | 'PURCHASE',
        ledgerDate: Date | null,
        productLabel: string,
        counterpartyLabel: string,
        quantity: number,
        amount: number | null,
    ) {
        const matchedIndexes = ledgerType === 'SALES' ? matchedSalesLedgerIndexes : matchedPurchaseLedgerIndexes;
        return entries.findIndex((entry, index) => {
            if (entry.ledgerType !== ledgerType || entry.orderItemId || matchedIndexes.has(index)) return false;
            const entryProduct = entry.productName || entry.product?.productName || '';
            const entryCounterparty = ledgerType === 'SALES'
                ? entry.customer?.companyName || entry.counterpartyName
                : entry.supplier?.supplierName || entry.counterpartyName;
            const entryAmount = entry.supplyAmount ?? (entry.unitPrice == null ? null : entry.quantity * entry.unitPrice);
            return sameDateOnly(new Date(entry.transactionDate), ledgerDate)
                && normalizeMatchText(entryProduct) === normalizeMatchText(productLabel)
                && sameCounterparty(entryCounterparty, counterpartyLabel)
                && nearlyEqual(entry.quantity, quantity, 0.0001)
                && nearlyEqual(entryAmount, amount, 10);
        });
    }

    for (const item of orderItems) {
        const salesDateRaw = ledgerSalesDate(item) ?? new Date();
        const purchaseDateRaw = ledgerPurchaseDate(item);
        const date = new Date(salesDateRaw);
        const purchaseDate = purchaseDateRaw ? new Date(purchaseDateRaw) : null;
        const period = mode === 'daily' ? dateToIso(date) : monthKey(date);
        const purchasePeriod = purchaseDate ? (mode === 'daily' ? dateToIso(purchaseDate) : monthKey(purchaseDate)) : '';
        const productLabel = item.product?.productName || '湲고?';
        const customerLabel = item.order.customer?.companyName || '湲고?';
        const supplierLabel = item.purchaseSupplier?.supplierName || '湲고?';

        const qty = item.requestedQuantity;
        const isWarehouse = item.fulfillmentType === 'WAREHOUSE';
        const isInbound = isWarehouse && isWarehouseInboundCustomer(customerLabel);

        // 창고 입고(한양유화/비엔티 + WAREHOUSE): 매입만 집계
        // 창고 출고(일반 거래처 + WAREHOUSE): 매출만 집계
        // 일반 직납: 매출 + 매입
        const effectiveSalesSupply = isInbound ? 0 : Math.round(qty * (item.salesUnitPrice ?? 0));
        const effectiveSalesVat = Math.round(effectiveSalesSupply * 0.1);
        const effectiveSalesTotal = effectiveSalesSupply + effectiveSalesVat;
        const purchasePrice = item.purchaseUnitPrice ?? 0;
        const purchaseSupply = (purchasePrice > 0 && !isWarehouse) || isInbound
            ? Math.round(qty * purchasePrice)
            : 0;
        const purchaseVat = purchaseSupply > 0 ? Math.round(purchaseSupply * 0.1) : 0;
        const purchaseTotal = purchaseSupply + purchaseVat;

        const productMatches = !fq || groupBy !== 'product' || productLabel.toLowerCase().includes(fq);
        const salesCounterMatches = !fq || groupBy !== 'customer' || customerLabel.toLowerCase().includes(fq);
        const purchaseCounterMatches = !fq || groupBy !== 'customer' || supplierLabel.toLowerCase().includes(fq);

        let salesGroupLabel: string;
        if (groupBy === 'total') salesGroupLabel = period;
        else if (groupBy === 'product') salesGroupLabel = productLabel;
        else salesGroupLabel = customerLabel;

        // 매출 집계: 창고 입고가 아니면서 수량이 있을 때 (단가 없어도 수량은 집계)
        const salesAmountForMatch = item.salesUnitPrice == null || isInbound ? null : effectiveSalesSupply;
        const matchingSalesLedgerIndex = !alreadyInSalesLedger.has(item.id) && inRange(date) && !isInbound && qty > 0
            ? findMatchingLedgerIndex('SALES', date, productLabel, customerLabel, qty, salesAmountForMatch)
            : -1;
        if (matchingSalesLedgerIndex >= 0) matchedSalesLedgerIndexes.add(matchingSalesLedgerIndex);

        if (!alreadyInSalesLedger.has(item.id) && matchingSalesLedgerIndex < 0 && inRange(date) && productMatches && salesCounterMatches && !isInbound && qty > 0) {
            upsert(period, salesGroupLabel, (r) => {
                pushOrderRef(r.orderRefs, item.order);
                pushUnique(r.salesCounterparties, customerLabel);
                r.salesQuantity += qty;
                r.salesSupply += effectiveSalesSupply;
                r.salesVat += effectiveSalesVat;
                r.salesTotal += effectiveSalesTotal;
            });
        }
        // 매입 집계: 창고 입고이거나 일반 직납인 경우 수량 집계 (단가 없어도 수량은 집계)
        const shouldCountPurchase = isInbound || (!isWarehouse && qty > 0);
        const purchaseAmountForMatch = item.purchaseUnitPrice == null ? null : purchaseSupply;
        const matchingPurchaseLedgerIndex = !alreadyInPurchaseLedger.has(item.id) && inRange(purchaseDate) && shouldCountPurchase
            ? findMatchingLedgerIndex('PURCHASE', purchaseDate, productLabel, supplierLabel, qty, purchaseAmountForMatch)
            : -1;
        if (matchingPurchaseLedgerIndex >= 0) matchedPurchaseLedgerIndexes.add(matchingPurchaseLedgerIndex);

        if (!alreadyInPurchaseLedger.has(item.id) && matchingPurchaseLedgerIndex < 0 && inRange(purchaseDate) && productMatches && purchaseCounterMatches && shouldCountPurchase) {
            let purchaseGroupLabel: string;
            if (groupBy === 'total') purchaseGroupLabel = purchasePeriod;
            else if (groupBy === 'product') purchaseGroupLabel = productLabel;
            else purchaseGroupLabel = supplierLabel;
            upsert(purchasePeriod, purchaseGroupLabel, (r) => {
                pushOrderRef(r.orderRefs, item.order);
                pushUnique(r.purchaseCounterparties, supplierLabel);
                r.purchaseQuantity += qty;
                r.purchaseSupply += purchaseSupply;
                r.purchaseVat += purchaseVat;
                r.purchaseTotal += purchaseTotal;
            });
        }
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

