import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import { auth } from '@/lib/auth';
import { fmtNumber } from '@/lib/orders';
import {
    getPerformanceReport,
    type ComparisonRow,
    type CrossRow,
    type PerformanceSortDir,
    type PerformanceSortKey,
    type PerformanceView,
} from '@/lib/performance-report';
import PerformanceRangeButtons from './PerformanceRangeButtons';
import PerformanceMultiFilter, { type PerformanceFilterOption } from './PerformanceMultiFilter';
import { canViewAllStaffData } from '@/lib/staff-permissions';

export const dynamic = 'force-dynamic';

type Search = {
    view?: string;
    aFrom?: string; aTo?: string;
    bFrom?: string; bTo?: string;
    rep?: string;
    sort?: string;
    dir?: string;
    customers?: string;
    suppliers?: string;
    products?: string;
};

// ────────────────────────────────────────────────────────────
// Metadata
// ────────────────────────────────────────────────────────────

type ViewMeta = { section: 'sales' | 'purchase'; label: string; title: string; description: string };
const viewMeta: Record<PerformanceView, ViewMeta> = {
    sales_product: { section: 'sales', label: '품목별', title: '매출 품목별', description: '품목별 매출 수량·금액 A/B 비교' },
    sales_customer: { section: 'sales', label: '거래처별', title: '매출 거래처별', description: '거래처별 매출 수량·금액 A/B 비교' },
    purchase_product: { section: 'purchase', label: '품목별', title: '매입 품목별', description: '품목별 매입 수량·금액 A/B 비교' },
    purchase_supplier: { section: 'purchase', label: '공급사별', title: '매입 공급사별', description: '공급사별 매입 수량·금액 A/B 비교' },
};

const salesViews: PerformanceView[] = ['sales_product', 'sales_customer'];
const purchaseViews: PerformanceView[] = ['purchase_product', 'purchase_supplier'];
const allViews: PerformanceView[] = [...salesViews, ...purchaseViews];

const comparisonSortKeys: PerformanceSortKey[] = ['name', 'rep', 'quantityA', 'quantityB', 'quantityDelta', 'amountA', 'amountB', 'amountDelta'];

const sortLabels: Record<PerformanceSortKey, string> = {
    name: '이름', parentName: '상위항목', rep: '담당자',
    quantityA: '기간 A 수량', quantityB: '기간 B 수량', quantityDelta: '수량 차이',
    amountA: '기간 A 금액', amountB: '기간 B 금액', amountDelta: '금액 차이',
    avgIntervalDays: '평균 주문간격', maxIntervalDays: '최대 공백', daysSinceLast: '최근 경과일', daysUntilExpected: '재주문 남은기간',
};

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function fmtMoney(value: number | null | undefined) {
    if (value == null) return '-';
    return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function deltaClass(value: number) {
    if (value === 0) return 'text-slate-500';
    return value > 0 ? 'text-blue-700' : 'text-red-700';
}

function validView(value?: string): PerformanceView {
    return allViews.includes(value as PerformanceView) ? value as PerformanceView : 'sales_product';
}

function validSort(value: string | undefined, _view: PerformanceView): PerformanceSortKey {
    return comparisonSortKeys.includes(value as PerformanceSortKey) ? value as PerformanceSortKey : 'quantityDelta';
}

function buildQuery(base: Record<string, string>, overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams(base);
    for (const [key, value] of Object.entries(overrides)) {
        if (value == null || value === '') params.delete(key);
        else params.set(key, value);
    }
    return `/admin/reports/performance?${params.toString()}`;
}

function parseKeyList(value?: string) {
    return (value ?? '').split(',').map((key) => key.trim()).filter(Boolean);
}

function uniqueOptions(options: PerformanceFilterOption[]) {
    const map = new Map<string, PerformanceFilterOption>();
    for (const option of options) {
        if (!map.has(option.key)) map.set(option.key, option);
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'ko'));
}

function sortComparisonRowsLocal(rows: ComparisonRow[], sort: PerformanceSortKey, dir: PerformanceSortDir) {
    const factor = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        if (sort === 'name') return a.label.localeCompare(b.label, 'ko') * factor;
        if (sort === 'rep') return (a.salesRepName ?? '').localeCompare(b.salesRepName ?? '', 'ko') * factor;
        if (sort === 'quantityA') return (a.quantityA - b.quantityA) * factor;
        if (sort === 'quantityB') return (a.quantityB - b.quantityB) * factor;
        if (sort === 'amountA') return (a.amountA - b.amountA) * factor;
        if (sort === 'amountB') return (a.amountB - b.amountB) * factor;
        if (sort === 'amountDelta') return (a.amountDelta - b.amountDelta) * factor;
        return (a.quantityDelta - b.quantityDelta) * factor;
    });
}

function sortCrossRowsLocal(rows: CrossRow[], sort: PerformanceSortKey, dir: PerformanceSortDir) {
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
        return (a.quantityDelta - b.quantityDelta) * factor;
    });
}

function aggregateCrossRows(rows: CrossRow[], groupBy: 'parent' | 'product') {
    const map = new Map<string, ComparisonRow>();

    for (const row of rows) {
        const key = groupBy === 'parent' ? row.parentKey : row.productKey;
        const label = groupBy === 'parent' ? row.parentLabel : row.productLabel;
        const current = map.get(key) ?? {
            key,
            label,
            customerId: groupBy === 'parent' ? row.parentId : undefined,
            supplierId: groupBy === 'parent' ? row.parentId : undefined,
            salesRepName: row.salesRepName,
            quantityA: 0,
            quantityB: 0,
            quantityDelta: 0,
            amountA: 0,
            amountB: 0,
            amountDelta: 0,
        };
        current.quantityA += row.quantityA;
        current.quantityB += row.quantityB;
        current.amountA += row.amountA;
        current.amountB += row.amountB;
        current.quantityDelta = current.quantityA - current.quantityB;
        current.amountDelta = current.amountA - current.amountB;
        map.set(key, current);
    }

    return Array.from(map.values());
}

function summarizeRows(rows: CrossRow[], label: string): ComparisonRow {
    const summary: ComparisonRow = { key: 'summary', label, quantityA: 0, quantityB: 0, quantityDelta: 0, amountA: 0, amountB: 0, amountDelta: 0 };
    for (const row of rows) {
        summary.quantityA += row.quantityA;
        summary.quantityB += row.quantityB;
        summary.amountA += row.amountA;
        summary.amountB += row.amountB;
    }
    summary.quantityDelta = summary.quantityA - summary.quantityB;
    summary.amountDelta = summary.amountA - summary.amountB;
    return summary;
}

// ────────────────────────────────────────────────────────────
// UI Components
// ────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
    return (
        <div className={`rounded-2xl border px-4 py-3 shadow-sm ${highlight ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white'}`}>
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className="mt-1 text-lg font-bold text-slate-800">{value}</p>
            {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
        </div>
    );
}

function SortHeader({ label, sortKey, currentSort, dir, baseQuery }: {
    label: string; sortKey: PerformanceSortKey; currentSort: PerformanceSortKey; dir: PerformanceSortDir; baseQuery: Record<string, string>;
}) {
    const active = sortKey === currentSort;
    const nextDir: PerformanceSortDir = active && dir === 'desc' ? 'asc' : 'desc';
    return (
        <Link href={buildQuery(baseQuery, { sort: sortKey, dir: nextDir })}
            className={`inline-flex items-center gap-1 hover:text-blue-700 ${active ? 'font-bold text-blue-700' : 'text-slate-500'}`}>
            {label}{active && <span>{dir === 'desc' ? '↓' : '↑'}</span>}
        </Link>
    );
}

function ComparisonTable({ rows, view, sort, dir, baseQuery }: {
    rows: ComparisonRow[]; view: PerformanceView; sort: PerformanceSortKey; dir: PerformanceSortDir; baseQuery: Record<string, string>;
}) {
    const showRep = view === 'sales_customer';
    const isCustomer = view === 'sales_customer';
    const colCount = showRep ? 8 : 7;
    return (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="max-h-[calc(100vh-360px)] min-h-[320px] overflow-auto">
                <table className="w-full min-w-[900px] text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs font-semibold text-slate-500 shadow-sm">
                        <tr>
                            <th className="sticky left-0 z-20 min-w-52 bg-slate-50 px-4 py-3">
                                <SortHeader label={view === 'sales_product' || view === 'purchase_product' ? '품목' : view === 'sales_customer' ? '거래처' : '공급사'} sortKey="name" currentSort={sort} dir={dir} baseQuery={baseQuery} />
                            </th>
                            {showRep && <th className="px-4 py-3"><SortHeader label="담당자" sortKey="rep" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>}
                            <th className="px-4 py-3 text-right"><SortHeader label="기간 A 수량" sortKey="quantityA" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>
                            <th className="px-4 py-3 text-right"><SortHeader label="기간 B 수량" sortKey="quantityB" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>
                            <th className="px-4 py-3 text-right"><SortHeader label="수량 차이" sortKey="quantityDelta" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>
                            <th className="px-4 py-3 text-right"><SortHeader label="기간 A 금액" sortKey="amountA" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>
                            <th className="px-4 py-3 text-right"><SortHeader label="기간 B 금액" sortKey="amountB" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>
                            <th className="px-4 py-3 text-right"><SortHeader label="금액 차이" sortKey="amountDelta" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.map((row) => (
                            <tr key={row.key} className="group hover:bg-blue-50/40">
                                <td className="sticky left-0 z-[1] bg-white px-4 py-2.5 font-medium text-slate-800 group-hover:bg-blue-50">
                                    {isCustomer && row.customerId
                                        ? <Link href={`/admin/customers/${row.customerId}/ledger`} className="text-blue-700 hover:underline">{row.label}</Link>
                                        : row.label}
                                </td>
                                {showRep && <td className="px-4 py-2.5 text-slate-500">{row.salesRepName ?? '미지정'}</td>}
                                <td className="px-4 py-2.5 text-right text-slate-700">{fmtNumber(row.quantityA)} TON</td>
                                <td className="px-4 py-2.5 text-right text-slate-700">{fmtNumber(row.quantityB)} TON</td>
                                <td className={`px-4 py-2.5 text-right font-bold ${deltaClass(row.quantityDelta)}`}>{row.quantityDelta > 0 ? '+' : ''}{fmtNumber(row.quantityDelta)} TON</td>
                                <td className="px-4 py-2.5 text-right text-slate-700">{fmtMoney(row.amountA)}</td>
                                <td className="px-4 py-2.5 text-right text-slate-700">{fmtMoney(row.amountB)}</td>
                                <td className={`px-4 py-2.5 text-right font-bold ${deltaClass(row.amountDelta)}`}>{row.amountDelta > 0 ? '+' : ''}{fmtMoney(row.amountDelta)}</td>
                            </tr>
                        ))}
                        {rows.length === 0 && <tr><td colSpan={colCount} className="px-4 py-16 text-center text-sm text-slate-400">조회 결과가 없습니다.</td></tr>}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

// ────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────

export default async function AdminPerformanceReportPage({ searchParams }: { searchParams: Promise<Search> }) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');
    const canViewAll = canViewAllStaffData(session.user);

    const sp = await searchParams;
    const view = validView(sp.view);
    const sort = validSort(sp.sort, view);
    const dir = (sp.dir === 'asc' ? 'asc' : 'desc') as PerformanceSortDir;
    const selectedCustomerKeys = parseKeyList(sp.customers);
    const selectedSupplierKeys = parseKeyList(sp.suppliers);
    const selectedProductKeys = parseKeyList(sp.products);

    const report = await getPerformanceReport({
        aFrom: sp.aFrom, aTo: sp.aTo,
        bFrom: sp.bFrom, bTo: sp.bTo,
        selectedRepId: sp.rep || 'all',
        sort, dir,
        viewerUserId: session.user.id,
        canViewAll,
    });

    const section = viewMeta[view].section;
    const selectedCustomerSet = new Set(selectedCustomerKeys);
    const selectedSupplierSet = new Set(selectedSupplierKeys);
    const selectedProductSet = new Set(selectedProductKeys);
    const hasSalesFilters = selectedCustomerKeys.length > 0 || selectedProductKeys.length > 0;
    const hasPurchaseFilters = selectedSupplierKeys.length > 0 || selectedProductKeys.length > 0;

    const filteredSalesCrossRows = report.salesCustomerProducts.filter((row) =>
        (selectedCustomerSet.size === 0 || selectedCustomerSet.has(row.parentKey)) &&
        (selectedProductSet.size === 0 || selectedProductSet.has(row.productKey))
    );
    const filteredPurchaseCrossRows = report.purchaseSupplierProducts.filter((row) =>
        (selectedSupplierSet.size === 0 || selectedSupplierSet.has(row.parentKey)) &&
        (selectedProductSet.size === 0 || selectedProductSet.has(row.productKey))
    );

    const salesProducts = hasSalesFilters ? sortComparisonRowsLocal(aggregateCrossRows(filteredSalesCrossRows, 'product'), sort, dir) : report.salesProducts;
    const salesCustomers = hasSalesFilters ? sortComparisonRowsLocal(aggregateCrossRows(filteredSalesCrossRows, 'parent'), sort, dir) : report.salesCustomers;
    const purchaseProducts = hasPurchaseFilters ? sortComparisonRowsLocal(aggregateCrossRows(filteredPurchaseCrossRows, 'product'), sort, dir) : report.purchaseProducts;
    const purchaseSuppliers = hasPurchaseFilters ? sortComparisonRowsLocal(aggregateCrossRows(filteredPurchaseCrossRows, 'parent'), sort, dir) : report.purchaseSuppliers;
    const summary = section === 'purchase'
        ? (hasPurchaseFilters ? summarizeRows(filteredPurchaseCrossRows, '필터 적용') : report.purchaseSummary)
        : (hasSalesFilters ? summarizeRows(filteredSalesCrossRows, '필터 적용') : report.salesSummary);

    const salesCustomerOptions = uniqueOptions(report.salesCustomers.map((row) => ({ key: row.key, label: row.label })));
    const purchaseSupplierOptions = uniqueOptions(report.purchaseSuppliers.map((row) => ({ key: row.key, label: row.label })));
    const salesProductOptions = uniqueOptions(report.salesProducts.map((row) => ({ key: row.key, label: row.label })));
    const purchaseProductOptions = uniqueOptions(report.purchaseProducts.map((row) => ({ key: row.key, label: row.label })));

    const baseQuery: Record<string, string> = {
        view, sort, dir,
        aFrom: report.periodA.from, aTo: report.periodA.to,
        bFrom: report.periodB.from, bTo: report.periodB.to,
        rep: report.selectedRepId,
    };
    if (selectedCustomerKeys.length > 0) baseQuery.customers = selectedCustomerKeys.join(',');
    if (selectedSupplierKeys.length > 0) baseQuery.suppliers = selectedSupplierKeys.join(',');
    if (selectedProductKeys.length > 0) baseQuery.products = selectedProductKeys.join(',');

    // Determine count badges for sub-tabs
    const rowCount: Record<PerformanceView, number> = {
        sales_product: salesProducts.length,
        sales_customer: salesCustomers.length,
        purchase_product: purchaseProducts.length,
        purchase_supplier: purchaseSuppliers.length,
    };

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
                <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-5">
                    <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
                        <ArrowLeft size={14} /> 대시보드
                    </Link>
                    <span className="text-sm text-slate-500">{session.user.name}</span>
                </div>
            </header>

            <main className="mx-auto max-w-[1600px] space-y-4 p-5">

                {/* ── Filter card ── */}
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-2">
                        <BarChart3 className="text-blue-600" size={20} />
                        <h1 className="text-lg font-bold text-slate-800">매입 매출 조회</h1>
                        <span className="text-xs text-slate-400">{canViewAll ? '전체 거래처 기준' : '내 담당 거래처 기준'}</span>
                    </div>
                    <form className="flex flex-wrap items-end gap-3 text-sm">
                        <input type="hidden" name="view" value={view} />
                        <input type="hidden" name="sort" value={sort} />
                        <input type="hidden" name="dir" value={dir} />
                        {selectedCustomerKeys.length > 0 && <input type="hidden" name="customers" value={selectedCustomerKeys.join(',')} />}
                        {selectedSupplierKeys.length > 0 && <input type="hidden" name="suppliers" value={selectedSupplierKeys.join(',')} />}
                        {selectedProductKeys.length > 0 && <input type="hidden" name="products" value={selectedProductKeys.join(',')} />}

                        {/* Period A */}
                        <div className="min-w-[260px] flex-1 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5">
                            <div className="mb-1.5 flex items-center justify-between">
                                <span className="text-xs font-semibold text-blue-700">기간 A <span className="font-normal text-blue-400">(기준)</span></span>
                                <PerformanceRangeButtons target="a" from={report.periodA.from} />
                            </div>
                            <div className="flex items-center gap-1.5">
                                <input type="date" name="aFrom" defaultValue={report.periodA.from} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs" />
                                <span className="text-slate-400">~</span>
                                <input type="date" name="aTo" defaultValue={report.periodA.to} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs" />
                            </div>
                        </div>

                        {/* Period B */}
                        <div className="min-w-[260px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                            <div className="mb-1.5 flex items-center justify-between">
                                <span className="text-xs font-semibold text-slate-600">비교 기간 B</span>
                                <PerformanceRangeButtons target="b" from={report.periodB.from} />
                            </div>
                            <div className="flex items-center gap-1.5">
                                <input type="date" name="bFrom" defaultValue={report.periodB.from} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs" />
                                <span className="text-slate-400">~</span>
                                <input type="date" name="bTo" defaultValue={report.periodB.to} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs" />
                            </div>
                        </div>

                        {/* Rep + Search */}
                        <div className="flex flex-col gap-2">
                            {canViewAll && (
                                <select name="rep" defaultValue={report.selectedRepId} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
                                    <option value="all">전체 담당자</option>
                                    {report.reps.map((rep) => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
                                </select>
                            )}
                            <button className="rounded-xl bg-slate-900 px-6 py-2.5 font-semibold text-white hover:bg-slate-800">조회</button>
                        </div>
                    </form>
                </div>

                {/* ── Summary cards ── */}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <SummaryCard label={`기간 A ${section === 'purchase' ? '매입' : '매출'}수량`} value={`${fmtNumber(summary.quantityA)} TON`} sub={report.periodA.from + ' ~ ' + report.periodA.to} />
                    <SummaryCard label={`기간 B ${section === 'purchase' ? '매입' : '매출'}수량`} value={`${fmtNumber(summary.quantityB)} TON`} sub={report.periodB.from + ' ~ ' + report.periodB.to} />
                    <SummaryCard label="수량 차이 (A−B)" value={`${summary.quantityDelta > 0 ? '+' : ''}${fmtNumber(summary.quantityDelta)} TON`} highlight={summary.quantityDelta !== 0} />
                    <SummaryCard label="금액 차이 (A−B)" value={`${summary.amountDelta > 0 ? '+' : ''}${fmtMoney(summary.amountDelta)}`} highlight={summary.amountDelta !== 0} />
                </div>

                {/* ── Section tabs + sub-tabs ── */}
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    {/* Main section */}
                    <div className="flex border-b border-slate-100">
                        <Link
                            href={buildQuery(baseQuery, { view: 'sales_product', sort: 'quantityDelta', customers: '', suppliers: '', products: '' })}
                            className={`flex-1 py-3 text-center text-sm font-bold transition md:flex-none md:px-8 ${section === 'sales' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-500 hover:text-slate-800'}`}>
                            📊 매출
                        </Link>
                        <Link
                            href={buildQuery(baseQuery, { view: 'purchase_product', sort: 'quantityDelta', customers: '', suppliers: '', products: '' })}
                            className={`flex-1 py-3 text-center text-sm font-bold transition md:flex-none md:px-8 ${section === 'purchase' ? 'border-b-2 border-violet-600 text-violet-700' : 'text-slate-500 hover:text-slate-800'}`}>
                            📦 매입
                        </Link>
                    </div>
                    {/* Sub-tabs */}
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                            {(section === 'sales' ? salesViews : purchaseViews).map((v) => (
                                <Link key={v} href={buildQuery(baseQuery, { view: v, sort: 'quantityDelta' })}
                                    className={`rounded-xl border px-3 py-1.5 text-sm font-semibold transition ${view === v
                                        ? section === 'sales' ? 'border-blue-600 bg-blue-600 text-white' : 'border-violet-600 bg-violet-600 text-white'
                                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}>
                                    {viewMeta[v].label}
                                    <span className={`ml-1.5 text-xs ${view === v ? 'opacity-70' : 'text-slate-400'}`}>{rowCount[v]}</span>
                                </Link>
                            ))}
                        </div>
                        <div className="flex flex-1 flex-wrap items-start justify-end gap-3">
                            {section === 'sales' ? (
                                <PerformanceMultiFilter label="거래처" paramName="customers" options={salesCustomerOptions} selectedKeys={selectedCustomerKeys} tone="blue" />
                            ) : (
                                <PerformanceMultiFilter label="공급사" paramName="suppliers" options={purchaseSupplierOptions} selectedKeys={selectedSupplierKeys} tone="violet" />
                            )}
                            <PerformanceMultiFilter
                                label="품목"
                                paramName="products"
                                options={section === 'sales' ? salesProductOptions : purchaseProductOptions}
                                selectedKeys={selectedProductKeys}
                                tone={section === 'sales' ? 'blue' : 'violet'}
                            />
                            <p className="text-xs text-slate-400">
                                {viewMeta[view].description} · 정렬: {sortLabels[sort]} {dir === 'desc' ? '↓' : '↑'}
                            </p>
                        </div>
                    </div>
                </div>

                {/* ── Table ── */}
                <ComparisonTable
                    rows={
                        view === 'sales_product' ? salesProducts :
                            view === 'sales_customer' ? salesCustomers :
                                view === 'purchase_product' ? purchaseProducts :
                                    purchaseSuppliers
                    }
                    view={view} sort={sort} dir={dir} baseQuery={baseQuery} />

            </main>
        </div>
    );
}
