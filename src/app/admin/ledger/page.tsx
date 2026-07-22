import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Fragment } from 'react';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { prisma } from '@/lib/db';
import { fmtDate, fmtNumber } from '@/lib/orders';
import { defaultLedgerRange, getCustomerLedger, type CustomerLedgerResult } from '@/lib/ledger';
import { getSupplierLedger, type SupplierLedgerResult } from '@/lib/supplier-ledger';
import LedgerPopupButtons from './LedgerPopupButtons';
import FinanceImportButton from './FinanceImportButton';
import LedgerRowEditButton, { type LedgerProductOption } from './LedgerRowEditButton';
import { ledgerSalesDate, LEDGER_DISPATCH_COMPLETED_WHERE } from '@/lib/ledger-policy';
import { canEditCustomerLedger, canViewAllStaffData, isYangHeeCheol } from '@/lib/staff-permissions';

export const dynamic = 'force-dynamic';

type Search = {
    q?: string;
    tab?: string;
    customerQ?: string;
    supplierQ?: string;
    customerId?: string;
    supplierId?: string;
    view?: string;
    salesRepId?: string;
    expandedCustomerId?: string;
    from?: string;
    to?: string;
};

type CompanyResult = {
    key: string;
    label: string;
    customer?: {
        id: string;
        companyName: string;
        customerCode: string | null;
        salesRepName: string | null;
        ledgerCount: number;
    };
    supplier?: {
        id: string;
        supplierName: string;
        contactPerson: string | null;
        phone: string | null;
        ledgerCount: number;
        orderItemCount: number;
    };
};

type SalesCustomerSummary = {
    customerId: string;
    customerName: string;
    customerCode: string | null;
    salesRepName: string | null;
    rowCount: number;
    totalQuantity: number;
    totalSupplyAmount: number;
    totalVatAmount: number;
    totalAmount: number;
};

async function findCustomers(q: string, salesRepId?: string) {
    if (!q) return [];
    return prisma.customer.findMany({
        where: {
            isActive: true,
            ...(salesRepId ? { defaultSalesRepId: salesRepId } : {}),
            OR: [
                { companyName: { contains: q } },
                { customerCode: { contains: q } },
                { businessNumber: { contains: q } },
                { ledgerEntries: { some: { counterpartyName: { contains: q } } } },
            ],
        },
        select: {
            id: true,
            companyName: true,
            customerCode: true,
            defaultSalesRep: { select: { name: true } },
            _count: { select: { ledgerEntries: true } },
        },
        orderBy: { companyName: 'asc' },
        take: 50,
    });
}

async function findSuppliers(q: string) {
    if (!q) return [];
    return prisma.supplier.findMany({
        where: {
            isActive: true,
            OR: [
                { supplierName: { contains: q } },
                { contactPerson: { contains: q } },
                { phone: { contains: q } },
                { ledgerEntries: { some: { counterpartyName: { contains: q } } } },
            ],
        },
        select: {
            id: true,
            supplierName: true,
            contactPerson: true,
            phone: true,
            _count: { select: { ledgerEntries: true, orderItems: true } },
        },
        orderBy: { supplierName: 'asc' },
        take: 50,
    });
}

function fmtMoney(value: number | null | undefined) {
    if (value == null) return '-';
    return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function pad(n: number) { return String(n).padStart(2, '0'); }

function dateToIso(date: Date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toDateOnly(value: string) {
    return new Date(`${value}T00:00:00`);
}

function addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function dateToInput(value: Date | null | undefined) {
    if (!value) return '';
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseIsoMonth(value: string | undefined, fallback: Date) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return new Date(fallback.getFullYear(), fallback.getMonth(), 1);
    }
    const [year, month] = value.split('-').map(Number);
    return new Date(year, month - 1, 1);
}

function monthRangeFrom(base: Date, offset: number) {
    const first = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    return {
        from: dateToIso(first),
        to: dateToIso(last),
    };
}

function calcRanges(selectedFrom?: string, today = new Date()) {
    const y = today.getFullYear();
    const m = today.getMonth() + 1;
    const todayStr = dateToIso(today);
    const thisFrom = `${y}-${pad(m)}-01`;
    const selectedMonth = parseIsoMonth(selectedFrom, today);
    const prev = monthRangeFrom(selectedMonth, -1);
    const next = monthRangeFrom(selectedMonth, 1);
    const r3M = m - 2;
    const r3Y = r3M <= 0 ? y - 1 : y;
    const r3MAdj = r3M <= 0 ? 12 + r3M : r3M;
    return {
        recent3: { label: '최근 3개월', from: `${r3Y}-${pad(r3MAdj)}-01`, to: todayStr },
        prev: { label: '1개월 전', from: prev.from, to: prev.to },
        current: { label: '당월', from: thisFrom, to: todayStr },
        next: { label: '1개월 후', from: next.from, to: next.to },
    };
}

function normalizeCompanyName(value: string) {
    return value
        .toLowerCase()
        .replace(/주식\s*회사/g, '')
        .replace(/\(주\)|㈜|\(유\)|\(사\)|\(합\)|\(재\)/g, '')
        .replace(/[\s()[\]{}<>,.·•\-_\/\\]+/g, '')
        .trim();
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

function calcVatAmount(supplyAmount: number | null) {
    return supplyAmount == null ? null : Math.round(supplyAmount * 0.1);
}

function addSalesSummaryAmount(
    summary: SalesCustomerSummary,
    quantity: number,
    supplyAmount: number | null,
    vatAmount?: number | null,
    totalAmount?: number | null,
) {
    const resolvedVat = vatAmount ?? calcVatAmount(supplyAmount);
    const resolvedTotal = totalAmount ?? (supplyAmount == null ? null : supplyAmount + (resolvedVat ?? 0));
    summary.rowCount += 1;
    summary.totalQuantity += quantity;
    if (supplyAmount != null) summary.totalSupplyAmount += supplyAmount;
    if (resolvedVat != null) summary.totalVatAmount += resolvedVat;
    if (resolvedTotal != null) summary.totalAmount += resolvedTotal;
}

function salesRepCustomerWhere(salesRepId: string) {
    if (salesRepId === 'all') return {};
    if (salesRepId === 'unassigned') return { defaultSalesRepId: null };
    return { defaultSalesRepId: salesRepId };
}

function buildLedgerHref(params: Record<string, string | undefined>) {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value) sp.set(key, value);
    }
    return `/admin/ledger?${sp.toString()}`;
}

function mergeCompanyResults(customers: Awaited<ReturnType<typeof findCustomers>>, suppliers: Awaited<ReturnType<typeof findSuppliers>>) {
    const map = new Map<string, CompanyResult>();
    const customerKeysByNormalizedName = new Map<string, string[]>();

    for (const customer of customers) {
        const normalizedName = normalizeCompanyName(customer.companyName);
        const key = `customer:${customer.id}`;
        const current = map.get(key) ?? { key, label: customer.companyName };
        current.label = customer.companyName;
        current.customer = {
            id: customer.id,
            companyName: customer.companyName,
            customerCode: customer.customerCode,
            salesRepName: customer.defaultSalesRep?.name ?? null,
            ledgerCount: customer._count.ledgerEntries,
        };
        map.set(key, current);

        if (normalizedName) {
            const keys = customerKeysByNormalizedName.get(normalizedName) ?? [];
            keys.push(key);
            customerKeysByNormalizedName.set(normalizedName, keys);
        }
    }

    for (const supplier of suppliers) {
        const normalizedName = normalizeCompanyName(supplier.supplierName);
        const matchedCustomerKeys = normalizedName ? customerKeysByNormalizedName.get(normalizedName) : undefined;
        const key = matchedCustomerKeys?.length === 1 ? matchedCustomerKeys[0] : `supplier:${supplier.id}`;
        const current = map.get(key) ?? { key, label: supplier.supplierName };
        if (!current.customer) current.label = supplier.supplierName;
        current.supplier = {
            id: supplier.id,
            supplierName: supplier.supplierName,
            contactPerson: supplier.contactPerson,
            phone: supplier.phone,
            ledgerCount: supplier._count.ledgerEntries,
            orderItemCount: supplier._count.orderItems,
        };
        map.set(key, current);
    }

    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'ko'));
}

function resultLinks(result: CompanyResult, q: string, from: string, to: string) {
    const base = { q, from, to };
    return {
        all: buildLedgerHref({ ...base, customerId: result.customer?.id, supplierId: result.supplier?.id, view: 'all' }),
        compare: buildLedgerHref({ ...base, customerId: result.customer?.id, supplierId: result.supplier?.id, view: 'compare' }),
        sales: result.customer ? buildLedgerHref({ ...base, customerId: result.customer.id, view: 'sales' }) : undefined,
        purchase: result.supplier ? buildLedgerHref({ ...base, supplierId: result.supplier.id, view: 'purchase' }) : undefined,
    };
}

async function getSalesCustomerSummaries(fromIso: string, toIso: string, salesRepId: string): Promise<SalesCustomerSummary[]> {
    const from = toDateOnly(fromIso);
    const toExclusive = addDays(toDateOnly(toIso), 1);
    const customerWhere = salesRepCustomerWhere(salesRepId);

    const [currentItems, currentImports] = await Promise.all([
        prisma.orderItem.findMany({
            where: {
                OR: [
                    { salesLedgerDate: { gte: from, lt: toExclusive } },
                    { salesLedgerDate: null, order: { requestedDeliveryDate: { gte: from, lt: toExclusive } } },
                ],
                order: {
                    deletedAt: null,
                    ...LEDGER_DISPATCH_COMPLETED_WHERE,
                    customer: {
                        isActive: true,
                        ...customerWhere,
                    },
                },
            },
            select: {
                id: true,
                productId: true,
                requestedQuantity: true,
                salesUnitPrice: true,
                salesLedgerDate: true,
                product: { select: { productName: true } },
                order: {
                    select: {
                        requestedDeliveryDate: true,
                        customer: {
                            select: {
                                id: true,
                                companyName: true,
                                customerCode: true,
                                defaultSalesRep: { select: { name: true } },
                            },
                        },
                    },
                },
            },
            orderBy: [{ order: { requestedDeliveryDate: 'asc' } }, { createdAt: 'asc' }],
        }),
        prisma.ledgerEntry.findMany({
            where: {
                ledgerType: 'SALES',
                transactionDate: { gte: from, lt: toExclusive },
                orderItemId: null,
                customerId: { not: null },
                customer: {
                    isActive: true,
                    ...customerWhere,
                },
            },
            include: {
                customer: {
                    select: {
                        id: true,
                        companyName: true,
                        customerCode: true,
                        defaultSalesRep: { select: { name: true } },
                    },
                },
            },
            orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
        }),
    ]);

    const summaries = new Map<string, SalesCustomerSummary>();
    const currentItemsByCustomer = new Map<string, typeof currentItems>();
    const matchedOrderItemIds = new Set<string>();

    function getSummary(customer: {
        id: string;
        companyName: string;
        customerCode: string | null;
        defaultSalesRep: { name: string } | null;
    }) {
        const summary = summaries.get(customer.id) ?? {
            customerId: customer.id,
            customerName: customer.companyName,
            customerCode: customer.customerCode,
            salesRepName: customer.defaultSalesRep?.name ?? null,
            rowCount: 0,
            totalQuantity: 0,
            totalSupplyAmount: 0,
            totalVatAmount: 0,
            totalAmount: 0,
        };
        summaries.set(customer.id, summary);
        return summary;
    }

    for (const item of currentItems) {
        const customer = item.order.customer;
        const summary = getSummary(customer);
        const supplyAmount = item.salesUnitPrice == null ? null : item.requestedQuantity * item.salesUnitPrice;
        addSalesSummaryAmount(summary, item.requestedQuantity, supplyAmount);
        const list = currentItemsByCustomer.get(customer.id) ?? [];
        list.push(item);
        currentItemsByCustomer.set(customer.id, list);
    }

    for (const entry of currentImports) {
        if (!entry.customer) continue;
        const customerItems = currentItemsByCustomer.get(entry.customer.id) ?? [];
        const entrySupplyAmount = entry.supplyAmount ?? (entry.unitPrice == null ? null : entry.quantity * entry.unitPrice);
        const matchedItem = customerItems.find((item) => {
            if (matchedOrderItemIds.has(item.id)) return false;
            const itemSalesDate = ledgerSalesDate(item);
            const itemSupplyAmount = item.salesUnitPrice == null ? null : item.requestedQuantity * item.salesUnitPrice;
            const sameProduct = entry.productId
                ? entry.productId === item.productId
                : normalizeMatchText(entry.productName) === normalizeMatchText(item.product.productName);
            return sameDateOnly(entry.transactionDate, itemSalesDate)
                && sameProduct
                && nearlyEqual(entry.quantity, item.requestedQuantity, 0.0001)
                && nearlyEqual(entrySupplyAmount, itemSupplyAmount, 10);
        });
        if (matchedItem) {
            matchedOrderItemIds.add(matchedItem.id);
            continue;
        }

        const summary = getSummary(entry.customer);
        addSalesSummaryAmount(
            summary,
            entry.quantity,
            entrySupplyAmount,
            entry.vatAmount,
            entry.totalAmount,
        );
    }

    return Array.from(summaries.values())
        .filter((summary) => summary.rowCount > 0)
        .sort((a, b) => b.totalSupplyAmount - a.totalSupplyAmount || a.customerName.localeCompare(b.customerName, 'ko'));
}

function SearchBox({ q, from, to, customerId, supplierId, view, canImportFinance }: { q: string; from: string; to: string; customerId?: string; supplierId?: string; view: string; canImportFinance: boolean }) {
    const ranges = calcRanges(from);
    const rangeHref = (range: { from: string; to: string }) => buildLedgerHref({ q, from: range.from, to: range.to, customerId, supplierId, view });
    const isActive = (range: { from: string; to: string }) => from === range.from && to === range.to;

    return (
        <form className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-64 flex-1 md:flex-none md:w-80">
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">거래처명 통합 조회</label>
                    <input name="q" defaultValue={q} placeholder="매출처/매입처명을 입력하세요" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                </div>
                <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-500">조회 시작</label>
                    <input name="from" type="date" defaultValue={from} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
                </div>
                <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-500">조회 종료</label>
                    <input name="to" type="date" defaultValue={to} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
                </div>
                <button className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">조회</button>
                <div className="flex flex-wrap gap-1.5 pl-0 md:pl-2">
                    {[ranges.recent3, ranges.prev, ranges.current, ranges.next].map((range) => (
                        <Link
                            key={range.label}
                            href={rangeHref(range)}
                            className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${isActive(range) ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                            {range.label}
                        </Link>
                    ))}
                    <FinanceImportButton enabled={canImportFinance} />
                </div>
            </div>
        </form>
    );
}

function CompanyResultList({ results, q, from, to }: { results: CompanyResult[]; q: string; from: string; to: string }) {
    if (!q) return <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-400">거래처명을 입력하면 매출/매입 거래처를 함께 조회합니다.</div>;
    if (results.length === 0) return <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-400">검색 결과가 없습니다.</div>;

    return (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <h2 className="text-sm font-bold text-slate-800">조회된 거래처</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{results.length}건</span>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
                            <th className="px-5 py-3">거래처</th>
                            <th className="px-5 py-3">구분</th>
                            <th className="px-5 py-3">매출처 정보</th>
                            <th className="px-5 py-3">매입처 정보</th>
                            <th className="px-5 py-3 text-right">보기</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {results.map((result) => {
                            const links = resultLinks(result, q, from, to);
                            return (
                                <tr key={result.key} className="hover:bg-slate-50">
                                    <td className="px-5 py-3 font-semibold text-slate-800">{result.label}</td>
                                    <td className="px-5 py-3">
                                        <div className="flex flex-wrap gap-1.5">
                                            {result.customer && <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">매출</span>}
                                            {result.supplier && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700">매입</span>}
                                        </div>
                                    </td>
                                    <td className="px-5 py-3 text-slate-600">{result.customer ? `${result.customer.customerCode ?? '-'} · ${result.customer.salesRepName ?? '담당자 없음'}` : '-'}</td>
                                    <td className="px-5 py-3 text-slate-600">{result.supplier ? `${result.supplier.contactPerson ?? '담당자 없음'} · 품목 ${fmtNumber(result.supplier.orderItemCount)}` : '-'}</td>
                                    <td className="px-5 py-3 text-right">
                                        <div className="flex flex-wrap justify-end gap-1.5">
                                            <Link href={links.all} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">전체</Link>
                                            {links.sales && <Link href={links.sales} className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800">매출</Link>}
                                            {links.purchase && <Link href={links.purchase} className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-800">매입</Link>}
                                            {result.customer && result.supplier && <Link href={links.compare} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">좌우비교</Link>}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function SalesByRepSearchBox({
    from,
    to,
    salesRepId,
    canSelectRep,
    salesRepOptions,
}: {
    from: string;
    to: string;
    salesRepId: string;
    canSelectRep: boolean;
    salesRepOptions: { id: string; name: string }[];
}) {
    const ranges = calcRanges(from);
    const rangeHref = (range: { from: string; to: string }) => buildLedgerHref({ tab: 'sales-by-rep', salesRepId, from: range.from, to: range.to });
    const isActive = (range: { from: string; to: string }) => from === range.from && to === range.to;

    return (
        <form className="rounded-2xl border border-orange-200 bg-white p-4 shadow-sm">
            <input type="hidden" name="tab" value="sales-by-rep" />
            <div className="flex flex-wrap items-end gap-2">
                <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">담당자</label>
                    {canSelectRep ? (
                        <select name="salesRepId" defaultValue={salesRepId} className="min-w-48 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100">
                            <option value="all">전체 담당자</option>
                            <option value="unassigned">담당자 없음</option>
                            {salesRepOptions.map((user) => (
                                <option key={user.id} value={user.id}>{user.name}</option>
                            ))}
                        </select>
                    ) : (
                        <>
                            <input type="hidden" name="salesRepId" value={salesRepId} />
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700">내 담당 거래처</div>
                        </>
                    )}
                </div>
                <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-500">조회 시작</label>
                    <input name="from" type="date" defaultValue={from} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
                </div>
                <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-500">조회 종료</label>
                    <input name="to" type="date" defaultValue={to} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
                </div>
                <button className="rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-700">요약 조회</button>
                <div className="flex flex-wrap gap-1.5 pl-0 md:pl-2">
                    {[ranges.recent3, ranges.prev, ranges.current, ranges.next].map((range) => (
                        <Link
                            key={range.label}
                            href={rangeHref(range)}
                            className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${isActive(range) ? 'bg-orange-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                            {range.label}
                        </Link>
                    ))}
                </div>
            </div>
        </form>
    );
}

function SalesByRepSummaryPanel({
    summaries,
    from,
    to,
    salesRepId,
    expandedCustomerId,
    expandedLedger,
    products,
    canEdit,
}: {
    summaries: SalesCustomerSummary[];
    from: string;
    to: string;
    salesRepId: string;
    expandedCustomerId?: string;
    expandedLedger: CustomerLedgerResult | null;
    products: LedgerProductOption[];
    canEdit: boolean;
}) {
    const totals = summaries.reduce((acc, summary) => ({
        customers: acc.customers + 1,
        rowCount: acc.rowCount + summary.rowCount,
        quantity: acc.quantity + summary.totalQuantity,
        supply: acc.supply + summary.totalSupplyAmount,
        vat: acc.vat + summary.totalVatAmount,
        total: acc.total + summary.totalAmount,
    }), { customers: 0, rowCount: 0, quantity: 0, supply: 0, vat: 0, total: 0 });

    const base = { tab: 'sales-by-rep', from, to, salesRepId };
    const collapseHref = buildLedgerHref(base);

    if (summaries.length === 0) {
        return (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-400">
                조회 기간에 매출이 있는 거래처가 없습니다.
            </div>
        );
    }

    return (
        <section className="overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm">
            <div className="border-b border-orange-100 bg-orange-50/80 p-4">
                <div className="grid gap-3 text-sm md:grid-cols-5">
                    <div className="rounded-xl bg-white p-4 shadow-sm"><p className="text-xs font-bold text-slate-400">매출 거래처</p><p className="mt-1 text-2xl font-black text-slate-900">{fmtNumber(totals.customers)}곳</p></div>
                    <div className="rounded-xl bg-white p-4 shadow-sm"><p className="text-xs font-bold text-slate-400">매출 행</p><p className="mt-1 text-2xl font-black text-slate-900">{fmtNumber(totals.rowCount)}건</p></div>
                    <div className="rounded-xl bg-white p-4 shadow-sm"><p className="text-xs font-bold text-slate-400">총 수량</p><p className="mt-1 text-2xl font-black text-orange-700">{fmtNumber(totals.quantity)} TON</p></div>
                    <div className="rounded-xl bg-white p-4 shadow-sm"><p className="text-xs font-bold text-slate-400">공급가액</p><p className="mt-1 text-2xl font-black text-slate-900">{fmtMoney(totals.supply)}</p></div>
                    <div className="rounded-xl bg-white p-4 shadow-sm"><p className="text-xs font-bold text-slate-400">합계</p><p className="mt-1 text-2xl font-black text-emerald-700">{fmtMoney(totals.total)}</p></div>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                    <thead>
                        <tr className="bg-white text-left text-xs font-medium uppercase text-slate-500">
                            <th className="px-5 py-3">거래처</th>
                            <th className="px-5 py-3">담당자</th>
                            <th className="px-5 py-3 text-right">행</th>
                            <th className="px-5 py-3 text-right">수량(TON)</th>
                            <th className="px-5 py-3 text-right">공급가액</th>
                            <th className="px-5 py-3 text-right">부가세</th>
                            <th className="px-5 py-3 text-right">합계</th>
                            <th className="px-5 py-3 text-right">원장</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {summaries.map((summary) => {
                            const isExpanded = expandedCustomerId === summary.customerId;
                            const href = isExpanded
                                ? collapseHref
                                : buildLedgerHref({ ...base, expandedCustomerId: summary.customerId });
                            return (
                                <Fragment key={summary.customerId}>
                                    <tr className={isExpanded ? 'bg-orange-50/60' : 'hover:bg-slate-50'}>
                                        <td className="px-5 py-3">
                                            <p className="font-bold text-slate-900">{summary.customerName}</p>
                                            <p className="mt-0.5 font-mono text-xs text-slate-400">{summary.customerCode ?? '-'}</p>
                                        </td>
                                        <td className="px-5 py-3 text-slate-600">{summary.salesRepName ?? '담당자 없음'}</td>
                                        <td className="px-5 py-3 text-right text-slate-600">{fmtNumber(summary.rowCount)}</td>
                                        <td className="px-5 py-3 text-right font-bold text-orange-700">{fmtNumber(summary.totalQuantity)}</td>
                                        <td className="px-5 py-3 text-right font-semibold text-slate-800">{fmtMoney(summary.totalSupplyAmount)}</td>
                                        <td className="px-5 py-3 text-right text-slate-600">{fmtMoney(summary.totalVatAmount)}</td>
                                        <td className="px-5 py-3 text-right font-bold text-emerald-700">{fmtMoney(summary.totalAmount)}</td>
                                        <td className="px-5 py-3 text-right">
                                            <Link href={href} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${isExpanded ? 'border border-orange-300 bg-white text-orange-700 hover:bg-orange-50' : 'bg-slate-900 text-white hover:bg-slate-800'}`}>
                                                {isExpanded ? '접기' : '펼치기'}
                                            </Link>
                                        </td>
                                    </tr>
                                    {isExpanded && expandedLedger && (
                                        <tr>
                                            <td colSpan={8} className="bg-orange-50/40 px-5 py-4">
                                                <CustomerLedgerPanel ledger={expandedLedger} products={products} canEdit={canEdit} />
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function CustomerLedgerPanel({ ledger, products, canEdit }: { ledger: CustomerLedgerResult; products: LedgerProductOption[]; canEdit: boolean }) {
    const salesTotal = ledger.ledgers.reduce((sum, item) => sum + item.totalAmount, 0);
    return (
        <section className="overflow-hidden rounded-2xl border border-teal-100 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-teal-50 px-5 py-3">
                <div>
                    <h2 className="font-bold text-teal-800">매출 원장 · {ledger.customerName}</h2>
                    <p className="mt-0.5 text-xs text-slate-500">{ledger.from} ~ {ledger.to}</p>
                </div>
                <LedgerPopupButtons mode="sales" salesHref={`/admin/customers/${ledger.customerId}/ledger?from=${ledger.from}&to=${ledger.to}`} />
            </div>
            <div className="grid grid-cols-2 gap-3 border-b border-teal-50 bg-teal-50/40 p-4 text-sm md:grid-cols-4">
                <div><p className="text-xs text-slate-500">기간 매출 합계</p><p className="font-bold text-slate-800">{fmtMoney(salesTotal)}</p></div>
                <div><p className="text-xs text-slate-500">기간 수금 합계</p><p className="font-bold text-green-700">{fmtMoney(ledger.periodReceiptTotal)}</p></div>
                <div><p className="text-xs text-slate-500">기초 미수금</p><p className="font-bold text-slate-800">{fmtMoney(ledger.openingReceivable)}</p></div>
                <div><p className="text-xs text-slate-500">현재 미수금</p><p className="font-bold text-orange-700">{fmtMoney(ledger.netReceivable)}</p></div>
            </div>
            <div className="max-h-[520px] overflow-auto">
                {ledger.ledgers.length === 0 ? <div className="p-10 text-center text-sm text-slate-400">조회 기간 내 매출 원장 항목이 없습니다.</div> : ledger.ledgers.map((companyLedger) => (
                    <table key={companyLedger.companyEntityId} className="w-full min-w-[980px] text-sm">
                        <caption className="bg-white px-4 py-2 text-left text-sm font-semibold text-slate-700">{companyLedger.companyName}</caption>
                        <thead className="sticky top-0 bg-slate-50 text-left text-xs font-medium uppercase text-slate-500"><tr><th className="px-4 py-2">매출일자</th><th className="px-4 py-2">오더</th><th className="px-4 py-2">품목</th><th className="px-4 py-2 text-right">수량(TON)</th><th className="px-4 py-2 text-right">단가</th><th className="px-4 py-2 text-right">공급가액</th><th className="px-4 py-2 text-right">부가세</th><th className="px-4 py-2 text-right">합계</th><th className="px-4 py-2 text-right">관리</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                            {companyLedger.rows.map((row) => {
                                const financeHref = row.noteNumber
                                    ? `/admin/finance-transactions?txType=NOTE_IN&q=${encodeURIComponent(row.noteNumber)}`
                                    : row.receiptId
                                        ? `/admin/finance-transactions?q=${encodeURIComponent(row.memo ?? row.receiptId)}`
                                        : null;
                                return (
                                    <tr key={row.itemId}>
                                        <td className="px-4 py-2 text-slate-600">{fmtDate(row.salesDate)}</td>
                                        <td className="px-4 py-2 font-mono text-xs">{row.rowSource === 'RECEIPT' && financeHref ? <Link href={financeHref} className="inline-flex rounded-full bg-green-50 px-2.5 py-1 font-semibold text-green-700 hover:bg-green-100 hover:text-green-900">{row.orderNo}</Link> : row.orderId ? <Link href={`/admin/orders/${row.orderId}`} className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 font-semibold text-blue-700 hover:bg-blue-100 hover:text-blue-900">{row.orderNo || '오더'}</Link> : <span className="text-slate-300">{row.orderNo || '-'}</span>}</td>
                                        <td className="px-4 py-2 text-slate-700">{row.productName}</td>
                                        <td className="px-4 py-2 text-right text-slate-600">{row.rowSource === 'RECEIPT' ? '-' : fmtNumber(row.quantity)}</td>
                                        <td className="px-4 py-2 text-right text-slate-600">{fmtMoney(row.unitPrice)}</td>
                                        <td className={`px-4 py-2 text-right font-medium ${row.rowSource === 'RECEIPT' ? 'text-green-700' : 'text-slate-800'}`}>{fmtMoney(row.amount)}</td>
                                        <td className="px-4 py-2 text-right text-slate-600">{fmtMoney(row.vatAmount)}</td>
                                        <td className={`px-4 py-2 text-right font-semibold ${row.rowSource === 'RECEIPT' ? 'text-green-700' : 'text-slate-900'}`}>{fmtMoney(row.totalAmount)}</td>
                                        <td className="px-4 py-2 text-right">{row.rowSource !== 'RECEIPT' && <LedgerRowEditButton canEdit={canEdit} mode="SALES" rowId={row.itemId} transactionDate={dateToInput(row.salesDate)} productId={row.productId && !row.productId.startsWith('IMPORTED:') ? row.productId : null} productName={row.productName} quantity={row.quantity} unit={row.unit} unitPrice={row.unitPrice} memo={row.memo} products={products} />}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot className="bg-slate-50 font-semibold text-slate-800"><tr><td className="px-4 py-2" colSpan={3}>합계</td><td className="px-4 py-2 text-right">{fmtNumber(companyLedger.totalQuantity)}</td><td className="px-4 py-2 text-right text-slate-400">-</td><td className="px-4 py-2 text-right">{fmtMoney(companyLedger.totalAmount)}</td><td className="px-4 py-2 text-right">{fmtMoney(companyLedger.totalVatAmount)}</td><td className="px-4 py-2 text-right">{fmtMoney(companyLedger.totalWithVat)}</td><td className="px-4 py-2" /></tr></tfoot>
                    </table>
                ))}
            </div>
        </section>
    );
}

function SupplierLedgerPanel({ ledger, products, canEdit }: { ledger: SupplierLedgerResult; products: LedgerProductOption[]; canEdit: boolean }) {
    return (
        <section className="overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-violet-50 px-5 py-3">
                <div>
                    <h2 className="font-bold text-violet-800">매입 원장 · {ledger.supplierName}</h2>
                    <p className="mt-0.5 text-xs text-slate-500">{ledger.from} ~ {ledger.to}</p>
                </div>
                <LedgerPopupButtons mode="purchase" purchaseHref={`/admin/suppliers/${ledger.supplierId}/ledger?from=${ledger.from}&to=${ledger.to}`} />
            </div>
            <div className="grid grid-cols-2 gap-3 border-b border-violet-50 bg-violet-50/40 p-4 text-sm md:grid-cols-4">
                <div><p className="text-xs text-slate-500">기간 매입 합계</p><p className="font-bold text-slate-800">{fmtMoney(ledger.totalSupplyAmount)}</p></div>
                <div><p className="text-xs text-slate-500">기간 지급 합계</p><p className="font-bold text-green-700">{fmtMoney(ledger.periodPaymentTotal)}</p></div>
                <div><p className="text-xs text-slate-500">기초 미지급금</p><p className="font-bold text-slate-800">{fmtMoney(ledger.openingPayable)}</p></div>
                <div><p className="text-xs text-slate-500">현재 미지급금</p><p className="font-bold text-orange-700">{fmtMoney(ledger.netPayable)}</p></div>
            </div>
            <div className="max-h-[520px] overflow-auto">
                {ledger.rows.length === 0 ? <div className="p-10 text-center text-sm text-slate-400">조회 기간 내 매입 원장 항목이 없습니다.</div> : (
                    <table className="w-full min-w-[980px] text-sm">
                        <thead className="sticky top-0 bg-slate-50 text-left text-xs font-medium uppercase text-slate-500"><tr><th className="px-4 py-2">매입일자</th><th className="px-4 py-2">오더</th><th className="px-4 py-2">품목</th><th className="px-4 py-2 text-right">수량(TON)</th><th className="px-4 py-2 text-right">단가</th><th className="px-4 py-2 text-right">공급가액</th><th className="px-4 py-2 text-right">부가세</th><th className="px-4 py-2 text-right">합계</th><th className="px-4 py-2 text-right">관리</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                            {ledger.rows.map((row) => {
                                const financeHref = row.noteNumber
                                    ? `/admin/finance-transactions?txType=NOTE_TRANSFER&q=${encodeURIComponent(row.noteNumber)}`
                                    : row.paymentId
                                        ? `/admin/finance-transactions?q=${encodeURIComponent(row.memo ?? row.paymentId)}`
                                        : null;
                                return (
                                    <tr key={row.id}>
                                        <td className="px-4 py-2 text-slate-600">{fmtDate(row.purchaseDate)}</td>
                                        <td className="px-4 py-2 font-mono text-xs">{row.rowSource === 'PAYMENT' && financeHref ? <Link href={financeHref} className="inline-flex rounded-full bg-green-50 px-2.5 py-1 font-semibold text-green-700 hover:bg-green-100 hover:text-green-900">{row.orderNo}</Link> : row.orderId ? <Link href={`/admin/orders/${row.orderId}`} className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 font-semibold text-blue-700 hover:bg-blue-100 hover:text-blue-900">{row.orderNo || '오더'}</Link> : <span className="text-slate-300">{row.orderNo || '-'}</span>}</td>
                                        <td className="px-4 py-2 text-slate-700">{row.productName}</td>
                                        <td className="px-4 py-2 text-right text-slate-600">{row.rowSource === 'PAYMENT' ? '-' : fmtNumber(row.quantity)}</td>
                                        <td className="px-4 py-2 text-right text-slate-600">{fmtMoney(row.unitPrice)}</td>
                                        <td className={`px-4 py-2 text-right font-medium ${row.rowSource === 'PAYMENT' ? 'text-green-700' : 'text-slate-800'}`}>{fmtMoney(row.supplyAmount)}</td>
                                        <td className="px-4 py-2 text-right text-slate-600">{fmtMoney(row.vatAmount)}</td>
                                        <td className={`px-4 py-2 text-right font-semibold ${row.rowSource === 'PAYMENT' ? 'text-green-700' : 'text-slate-900'}`}>{fmtMoney(row.totalAmount)}</td>
                                        <td className="px-4 py-2 text-right">{row.rowSource !== 'PAYMENT' && <LedgerRowEditButton canEdit={canEdit} mode="PURCHASE" rowId={row.id} transactionDate={dateToInput(row.purchaseDate)} productId={row.productId} productName={row.productName} quantity={row.quantity} unit={row.unit} unitPrice={row.unitPrice} memo={row.memo} products={products} />}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot className="bg-slate-50 font-semibold text-slate-800"><tr><td className="px-4 py-2" colSpan={3}>합계</td><td className="px-4 py-2 text-right">{fmtNumber(ledger.totalQuantity)}</td><td className="px-4 py-2 text-right text-slate-400">-</td><td className="px-4 py-2 text-right">{fmtMoney(ledger.totalSupplyAmount)}</td><td className="px-4 py-2 text-right">{fmtMoney(ledger.totalVatAmount)}</td><td className="px-4 py-2 text-right">{fmtMoney(ledger.totalAmount)}</td><td className="px-4 py-2" /></tr></tfoot>
                    </table>
                )}
            </div>
        </section>
    );
}

export default async function AdminLedgerPage({ searchParams }: { searchParams: Promise<Search> }) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const sp = await searchParams;
    const isSalesByRepTab = sp.tab === 'sales-by-rep';
    const q = (sp.q ?? sp.customerQ ?? sp.supplierQ ?? '').trim();
    const range = defaultLedgerRange();
    const from = sp.from || range.from;
    const to = sp.to || range.to;
    const view = sp.view === 'sales' || sp.view === 'purchase' || sp.view === 'compare' ? sp.view : 'all';
    const canViewAll = canViewAllStaffData(session.user);
    const canImportFinance = canViewAll;
    const canUseSalesRepSelector = isYangHeeCheol(session.user);
    const staffSalesRepId = canViewAll ? undefined : session.user.id;
    const requestedSalesRepId = sp.salesRepId || (canUseSalesRepSelector ? 'all' : session.user.id);
    const effectiveSalesRepId = canUseSalesRepSelector ? requestedSalesRepId : session.user.id;

    const [products, currentUser, salesRepOptions, customers, suppliers, salesSummaries] = await Promise.all([
        prisma.product.findMany({
            where: { isActive: true },
            select: { id: true, productName: true, productCode: true },
            orderBy: [{ productName: 'asc' }],
        }),
        prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, role: true, isActive: true } }),
        canUseSalesRepSelector
            ? prisma.user.findMany({
                where: { isActive: true },
                select: { id: true, name: true },
                orderBy: { name: 'asc' },
            })
            : Promise.resolve([] as { id: string; name: string }[]),
        isSalesByRepTab ? Promise.resolve([]) : findCustomers(q, staffSalesRepId),
        !isSalesByRepTab && canViewAll ? findSuppliers(q) : Promise.resolve([]),
        isSalesByRepTab ? getSalesCustomerSummaries(from, to, effectiveSalesRepId) : Promise.resolve([]),
    ]);
    const results = mergeCompanyResults(customers, suppliers);
    const canEditLedger = !!currentUser?.isActive && canEditCustomerLedger(currentUser);

    if (!isSalesByRepTab && q && !sp.customerId && !sp.supplierId && results.length === 1) {
        redirect(resultLinks(results[0], q, from, to).all);
    }

    const selectedCustomer = !isSalesByRepTab && sp.customerId
        ? await prisma.customer.findUnique({ where: { id: sp.customerId }, select: { defaultSalesRepId: true } })
        : null;
    const canOpenCustomerLedger = !sp.customerId || canViewAll || selectedCustomer?.defaultSalesRepId === session.user.id;
    const expandedCustomerId = isSalesByRepTab && sp.expandedCustomerId && salesSummaries.some((summary) => summary.customerId === sp.expandedCustomerId)
        ? sp.expandedCustomerId
        : undefined;

    const [customerLedger, supplierLedger, expandedCustomerLedger] = await Promise.all([
        !isSalesByRepTab && sp.customerId && view !== 'purchase' && canOpenCustomerLedger ? getCustomerLedger(sp.customerId, from, to) : Promise.resolve(null),
        !isSalesByRepTab && canViewAll && sp.supplierId && view !== 'sales' ? getSupplierLedger(sp.supplierId, from, to) : Promise.resolve(null),
        expandedCustomerId ? getCustomerLedger(expandedCustomerId, from, to) : Promise.resolve(null),
    ]);

    const showLedger = !isSalesByRepTab && (customerLedger || supplierLedger);
    const split = view === 'compare' && customerLedger && supplierLedger;
    const salesPopupHref = customerLedger ? `/admin/customers/${customerLedger.customerId}/ledger?from=${from}&to=${to}` : undefined;
    const purchasePopupHref = supplierLedger ? `/admin/suppliers/${supplierLedger.supplierId}/ledger?from=${from}&to=${to}` : undefined;
    const searchTabHref = buildLedgerHref({ q, from, to, customerId: sp.customerId, supplierId: sp.supplierId, view });
    const summaryTabHref = buildLedgerHref({ tab: 'sales-by-rep', from, to, salesRepId: effectiveSalesRepId });
    const tabClass = (active: boolean) => `rounded-xl px-4 py-2 text-sm font-bold transition ${active ? 'bg-slate-900 text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`;

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
                    <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> 대시보드</Link>
                    <span className="text-sm text-slate-500">{session.user.name}</span>
                </div>
            </header>
            <main className="mx-auto max-w-7xl space-y-4 p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <BookOpen className="text-slate-700" size={24} />
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800">거래처 원장 통합 조회</h1>
                            <p className="mt-1 text-sm text-slate-500">거래처명 검색과 담당자별 매출 거래처 요약을 함께 확인합니다.</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {salesPopupHref && purchasePopupHref && <LedgerPopupButtons mode="compare" salesHref={salesPopupHref} purchaseHref={purchasePopupHref} />}
                        {showLedger && <Link href={buildLedgerHref({ q, from, to })} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white">검색 결과로 돌아가기</Link>}
                    </div>
                </div>

                <div className="flex flex-wrap gap-2">
                    <Link href={searchTabHref} className={tabClass(!isSalesByRepTab)}>거래처명 통합 검색</Link>
                    <Link href={summaryTabHref} className={tabClass(isSalesByRepTab)}>담당자별 매출 업체</Link>
                </div>

                {isSalesByRepTab ? (
                    <>
                        <SalesByRepSearchBox
                            from={from}
                            to={to}
                            salesRepId={effectiveSalesRepId}
                            canSelectRep={canUseSalesRepSelector}
                            salesRepOptions={salesRepOptions}
                        />
                        <SalesByRepSummaryPanel
                            summaries={salesSummaries}
                            from={from}
                            to={to}
                            salesRepId={effectiveSalesRepId}
                            expandedCustomerId={expandedCustomerId}
                            expandedLedger={expandedCustomerLedger}
                            products={products}
                            canEdit={canEditLedger}
                        />
                    </>
                ) : (
                    <>
                        <SearchBox q={q} from={from} to={to} customerId={sp.customerId} supplierId={sp.supplierId} view={view} canImportFinance={canImportFinance} />

                        {showLedger ? (
                            <div className={split ? 'grid items-start gap-4 xl:grid-cols-2' : 'space-y-4'}>
                                {customerLedger && <CustomerLedgerPanel ledger={customerLedger} products={products} canEdit={canEditLedger} />}
                                {supplierLedger && <SupplierLedgerPanel ledger={supplierLedger} products={products} canEdit={canEditLedger} />}
                            </div>
                        ) : <CompanyResultList results={results} q={q} from={from} to={to} />}
                    </>
                )}
            </main>
        </div>
    );
}
