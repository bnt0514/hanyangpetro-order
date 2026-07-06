import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import { auth } from '@/lib/auth';
import { fmtNumber } from '@/lib/orders';
import { defaultProfitRange, getProfitReport, type ProfitReportRow, type ProfitSortDir, type ProfitSortKey } from '@/lib/profit-report';
import { canViewAllStaffData } from '@/lib/staff-permissions';

export const dynamic = 'force-dynamic';

type ProfitViewKey = 'monthly' | 'product' | 'rep' | 'customer' | 'repCustomers';
type TableMode = 'monthly' | 'product' | 'customer' | 'rep';

const sortKeys: ProfitSortKey[] = ['sales', 'profit', 'quantity', 'purchase', 'receivable', 'name'];
const viewKeys: ProfitViewKey[] = ['monthly', 'product', 'rep', 'customer', 'repCustomers'];

const sortLabels: Record<ProfitSortKey, string> = {
    name: '이름',
    quantity: '수량',
    sales: '매출',
    purchase: '매입',
    profit: '수익',
    receivable: '미수',
};

const viewMeta: Record<ProfitViewKey, { title: string; short: string; mode: TableMode; description: string }> = {
    monthly: { title: '월별 수익', short: '월별', mode: 'monthly', description: '월 단위로 매출·매입·수익 흐름을 봅니다.' },
    product: { title: '품목별 수익', short: '품목', mode: 'product', description: '품목별 매출·매입·수익률을 비교합니다.' },
    rep: { title: '담당자별 매출/수금', short: '담당자', mode: 'rep', description: '담당자별 매출과 기간 수금액을 봅니다.' },
    customer: { title: '거래처별 매출/수금/미수', short: '거래처', mode: 'customer', description: '거래처별 매출, 수금, 현재 미수를 확인합니다.' },
    repCustomers: { title: '담당자 거래처 목록', short: '담당거래처', mode: 'customer', description: '선택 담당자의 거래처별 현황을 봅니다.' },
};

function fmtMoney(value: number | null | undefined) {
    if (value == null) return '-';
    return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function marginRate(row: ProfitReportRow) {
    if (!row.salesTotal) return '-';
    return `${((row.profitTotal / row.salesTotal) * 100).toFixed(1)}%`;
}

function validSort(value?: string): ProfitSortKey {
    return sortKeys.includes(value as ProfitSortKey) ? value as ProfitSortKey : 'sales';
}

function validView(value?: string): ProfitViewKey {
    return viewKeys.includes(value as ProfitViewKey) ? value as ProfitViewKey : 'monthly';
}

function buildQuery(base: Record<string, string>, overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams(base);
    for (const [key, value] of Object.entries(overrides)) {
        if (value == null || value === '') params.delete(key);
        else params.set(key, value);
    }
    return `/admin/reports/profit?${params.toString()}`;
}

function MoneyCell({ total, supply, vat }: { total: number; supply?: number; vat?: number }) {
    return (
        <div className="text-right leading-tight">
            <div className="font-semibold text-slate-900">{fmtMoney(total)}</div>
            <div className="mt-0.5 text-[10px] text-slate-400">공급 {fmtMoney(supply ?? 0)} · VAT {fmtMoney(vat ?? 0)}</div>
        </div>
    );
}

function SummaryCard({ label, value, sub, tone = 'slate' }: { label: string; value: string; sub?: string; tone?: 'slate' | 'blue' | 'emerald' | 'red' | 'amber' }) {
    const toneClass = {
        slate: 'bg-white border-slate-200 text-slate-800',
        blue: 'bg-blue-50 border-blue-100 text-blue-800',
        emerald: 'bg-emerald-50 border-emerald-100 text-emerald-800',
        red: 'bg-red-50 border-red-100 text-red-800',
        amber: 'bg-amber-50 border-amber-100 text-amber-800',
    }[tone];
    return (
        <div className={`rounded-2xl border px-4 py-3 shadow-sm ${toneClass}`}>
            <p className="text-xs font-medium opacity-75">{label}</p>
            <p className="mt-1 text-lg font-bold xl:text-xl">{value}</p>
            {sub && <p className="mt-0.5 text-[11px] opacity-70">{sub}</p>}
        </div>
    );
}

function TabLink({ view, activeView, count, baseQuery }: { view: ProfitViewKey; activeView: ProfitViewKey; count: number; baseQuery: Record<string, string> }) {
    const active = view === activeView;
    return (
        <Link
            href={buildQuery(baseQuery, { view })}
            className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${active ? 'border-blue-600 bg-blue-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50'}`}
        >
            {viewMeta[view].short} <span className={active ? 'text-blue-100' : 'text-slate-400'}>{count.toLocaleString('ko-KR')}</span>
        </Link>
    );
}

function SortHeader({ label, sortKey, currentSort, dir, baseQuery }: { label: string; sortKey: ProfitSortKey; currentSort: ProfitSortKey; dir: ProfitSortDir; baseQuery: Record<string, string> }) {
    const active = sortKey === currentSort;
    const nextDir: ProfitSortDir = active && dir === 'desc' ? 'asc' : 'desc';
    return (
        <Link
            href={buildQuery(baseQuery, { sort: sortKey, dir: nextDir })}
            className={`inline-flex items-center gap-1 hover:text-blue-700 ${active ? 'font-bold text-blue-700' : 'text-slate-500'}`}
        >
            {label}{active && <span>{dir === 'desc' ? '↓' : '↑'}</span>}
        </Link>
    );
}

function ProfitTable({ rows, mode, sort, dir, baseQuery }: { rows: ProfitReportRow[]; mode: TableMode; sort: ProfitSortKey; dir: ProfitSortDir; baseQuery: Record<string, string> }) {
    const showPurchase = mode === 'monthly' || mode === 'product';
    const showProfit = mode === 'monthly' || mode === 'product';
    const showCustomerMoney = mode === 'customer' || mode === 'rep';
    const colSpan = 4 + (showPurchase ? 1 : 0) + (showProfit ? 2 : 0) + (showCustomerMoney ? 2 : 0) + (mode === 'customer' || mode === 'rep' ? 1 : 0);

    return (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="max-h-[calc(100vh-330px)] min-h-[360px] overflow-auto">
                <table className="w-full min-w-[980px] text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs font-semibold text-slate-500 shadow-sm">
                        <tr>
                            <th className="sticky left-0 z-20 min-w-56 bg-slate-50 px-4 py-3"><SortHeader label="구분" sortKey="name" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>
                            {(mode === 'customer' || mode === 'rep') && <th className="min-w-24 px-4 py-3">담당자</th>}
                            <th className="px-4 py-3 text-right"><SortHeader label="수량" sortKey="quantity" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>
                            <th className="px-4 py-3 text-right"><SortHeader label="매출" sortKey="sales" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>
                            {showPurchase && <th className="px-4 py-3 text-right"><SortHeader label="매입" sortKey="purchase" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>}
                            {showProfit && <th className="px-4 py-3 text-right"><SortHeader label="수익" sortKey="profit" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>}
                            {showProfit && <th className="px-4 py-3 text-right">수익률</th>}
                            {showCustomerMoney && <th className="px-4 py-3 text-right">수금</th>}
                            {showCustomerMoney && <th className="px-4 py-3 text-right"><SortHeader label="현재 미수" sortKey="receivable" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.map((row) => (
                            <tr key={row.key} className="group hover:bg-blue-50/40">
                                <td className="sticky left-0 z-[1] bg-white px-4 py-2.5 font-medium text-slate-800 group-hover:bg-blue-50">
                                    {mode === 'customer' && row.customerId
                                        ? <Link href={`/admin/customers/${row.customerId}/ledger`} className="text-blue-700 hover:underline">{row.label}</Link>
                                        : row.label}
                                </td>
                                {(mode === 'customer' || mode === 'rep') && <td className="px-4 py-2.5 text-slate-500">{row.salesRepName ?? row.label}</td>}
                                <td className="px-4 py-2.5 text-right text-slate-700">{fmtNumber(row.quantity)} TON</td>
                                <td className="px-4 py-2.5"><MoneyCell total={row.salesTotal} supply={row.salesSupply} vat={row.salesVat} /></td>
                                {showPurchase && <td className="px-4 py-2.5"><MoneyCell total={row.purchaseTotal} supply={row.purchaseSupply} vat={row.purchaseVat} /></td>}
                                {showProfit && <td className={`px-4 py-2.5 text-right font-bold ${row.profitTotal >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtMoney(row.profitTotal)}</td>}
                                {showProfit && <td className="px-4 py-2.5 text-right text-slate-700">{marginRate(row)}</td>}
                                {showCustomerMoney && <td className="px-4 py-2.5 text-right font-medium text-emerald-700">{fmtMoney(row.receiptTotal)}</td>}
                                {showCustomerMoney && <td className={`px-4 py-2.5 text-right font-bold ${row.currentReceivable > 0 ? 'text-orange-700' : 'text-slate-700'}`}>{fmtMoney(row.currentReceivable)}</td>}
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr>
                                <td colSpan={colSpan} className="px-4 py-16 text-center text-sm text-slate-400">조회 결과가 없습니다.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

export default async function AdminProfitReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; sort?: string; dir?: string; rep?: string; view?: string }> }) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const sp = await searchParams;
    const range = defaultProfitRange();
    const canViewAll = canViewAllStaffData(session.user);
    const view = validView(sp.view);
    const sort = validSort(sp.sort || (view === 'monthly' ? 'name' : 'sales'));
    const dir = (sp.dir === 'asc' || (!sp.dir && sort === 'name') ? 'asc' : 'desc') as ProfitSortDir;
    const report = await getProfitReport({
        fromIso: sp.from || range.from,
        toIso: sp.to || range.to,
        sort,
        dir,
        selectedRepId: sp.rep || 'all',
        viewerUserId: session.user.id,
        canViewAll,
    });

    const baseQuery = { from: report.from, to: report.to, sort, dir, rep: report.selectedRepId, view };
    const activeRows = {
        monthly: report.monthly,
        product: report.byProduct,
        rep: report.byRep,
        customer: report.byCustomer,
        repCustomers: report.repCustomers,
    }[view];
    const activeMeta = viewMeta[view];

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
                <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-5">
                    <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> 대시보드</Link>
                    <span className="text-sm text-slate-500">{session.user.name}</span>
                </div>
            </header>

            <main className="mx-auto max-w-[1600px] space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div>
                        <div className="flex items-center gap-2"><BarChart3 className="text-blue-600" size={22} /><h1 className="text-xl font-bold text-slate-800">월별 수익 · 원장 요약</h1></div>
                        <p className="mt-1 text-xs text-slate-500">긴 표를 한 번에 나열하지 않고 탭별로 전환합니다. 표 헤더를 누르면 바로 정렬됩니다.</p>
                    </div>
                    <form className="flex flex-wrap items-center gap-2 text-sm">
                        <input type="hidden" name="view" value={view} />
                        <input type="hidden" name="dir" value={dir} />
                        <input type="date" name="from" defaultValue={report.from} className="rounded-lg border border-slate-200 px-2 py-1.5" />
                        <span className="text-slate-400">~</span>
                        <input type="date" name="to" defaultValue={report.to} className="rounded-lg border border-slate-200 px-2 py-1.5" />
                        <select name="sort" defaultValue={sort} className="rounded-lg border border-slate-200 px-2 py-1.5">
                            {sortKeys.map((key) => <option key={key} value={key}>{sortLabels[key]}순</option>)}
                        </select>
                        {canViewAll && (
                            <select name="rep" defaultValue={report.selectedRepId} className="rounded-lg border border-slate-200 px-2 py-1.5">
                                <option value="all">전체 담당자</option>
                                {report.reps.map((rep) => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
                            </select>
                        )}
                        <button className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800">조회</button>
                    </form>
                </div>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    <SummaryCard label="총 매출" value={fmtMoney(report.summary.salesTotal)} sub={`공급 ${fmtMoney(report.summary.salesSupply)}`} tone="blue" />
                    <SummaryCard label="총 매입" value={fmtMoney(report.summary.purchaseTotal)} sub={`공급 ${fmtMoney(report.summary.purchaseSupply)}`} tone="amber" />
                    <SummaryCard label="총 수익" value={fmtMoney(report.summary.profitTotal)} sub={`수익률 ${marginRate(report.summary)}`} tone={report.summary.profitTotal >= 0 ? 'emerald' : 'red'} />
                    <SummaryCard label="총 수량" value={`${fmtNumber(report.summary.quantity)} TON`} tone="slate" />
                    <SummaryCard label="기간 수금" value={fmtMoney(report.summary.receiptTotal)} tone="emerald" />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex flex-wrap gap-2">
                        <TabLink view="monthly" activeView={view} count={report.monthly.length} baseQuery={baseQuery} />
                        <TabLink view="product" activeView={view} count={report.byProduct.length} baseQuery={baseQuery} />
                        <TabLink view="rep" activeView={view} count={report.byRep.length} baseQuery={baseQuery} />
                        <TabLink view="customer" activeView={view} count={report.byCustomer.length} baseQuery={baseQuery} />
                        <TabLink view="repCustomers" activeView={view} count={report.repCustomers.length} baseQuery={baseQuery} />
                    </div>
                    <div className="text-right">
                        <p className="text-sm font-bold text-slate-800">{activeMeta.title}</p>
                        <p className="text-xs text-slate-500">{activeMeta.description} · 현재 정렬: {sortLabels[sort]} {dir === 'desc' ? '내림차순' : '오름차순'}</p>
                    </div>
                </div>

                <ProfitTable rows={activeRows} mode={activeMeta.mode} sort={sort} dir={dir} baseQuery={baseQuery} />
            </main>
        </div>
    );
}
