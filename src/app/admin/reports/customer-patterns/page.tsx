import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Repeat } from 'lucide-react';
import { auth } from '@/lib/auth';
import { fmtNumber } from '@/lib/orders';
import { getPerformanceReport, type PatternRow, type PerformanceSortDir, type PerformanceSortKey } from '@/lib/performance-report';
import PerformanceRangeButtons from '../performance/PerformanceRangeButtons';

export const dynamic = 'force-dynamic';

type PatternView = 'regular' | 'irregular';
type Search = { view?: string; patternFrom?: string; patternTo?: string; rep?: string; sort?: string; dir?: string };

const sortKeys: PerformanceSortKey[] = ['name', 'rep', 'quantityA', 'amountA', 'avgIntervalDays', 'maxIntervalDays', 'daysSinceLast', 'daysUntilExpected'];
const sortLabels: Record<PerformanceSortKey, string> = {
    name: '거래처',
    parentName: '상위항목',
    rep: '담당자',
    quantityA: '총수량',
    quantityB: '기간 B 수량',
    quantityDelta: '수량 차이',
    amountA: '총금액',
    amountB: '기간 B 금액',
    amountDelta: '금액 차이',
    avgIntervalDays: '평균 주문간격',
    maxIntervalDays: '최대 공백',
    daysSinceLast: '최근 경과일',
    daysUntilExpected: '재주문 남은기간',
};

function fmtMoney(value: number | null | undefined) {
    if (value == null) return '-';
    return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function fmtDays(value: number | null) {
    if (value == null) return '-';
    if (value < 0) return `${Math.abs(value)}일 지남`;
    if (value === 0) return '오늘 예상';
    return `${value}일 남음`;
}

function validView(value?: string): PatternView {
    return value === 'irregular' ? 'irregular' : 'regular';
}

function validSort(value?: string): PerformanceSortKey {
    return sortKeys.includes(value as PerformanceSortKey) ? value as PerformanceSortKey : 'daysUntilExpected';
}

function buildQuery(base: Record<string, string>, overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams(base);
    for (const [key, value] of Object.entries(overrides)) {
        if (value == null || value === '') params.delete(key);
        else params.set(key, value);
    }
    return `/admin/reports/customer-patterns?${params.toString()}`;
}

function SortHeader({ label, sortKey, currentSort, dir, baseQuery }: { label: string; sortKey: PerformanceSortKey; currentSort: PerformanceSortKey; dir: PerformanceSortDir; baseQuery: Record<string, string> }) {
    const active = sortKey === currentSort;
    const nextDir: PerformanceSortDir = active && dir === 'desc' ? 'asc' : 'desc';
    return (
        <Link href={buildQuery(baseQuery, { sort: sortKey, dir: nextDir })} className={`inline-flex items-center gap-1 hover:text-blue-700 ${active ? 'font-bold text-blue-700' : 'text-slate-500'}`}>
            {label}{active && <span>{dir === 'desc' ? '↓' : '↑'}</span>}
        </Link>
    );
}

function PatternTable({ rows, sort, dir, baseQuery, irregular }: { rows: PatternRow[]; sort: PerformanceSortKey; dir: PerformanceSortDir; baseQuery: Record<string, string>; irregular: boolean }) {
    return (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="max-h-[calc(100vh-280px)] min-h-[420px] overflow-auto">
                <table className="w-full min-w-[1280px] text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs font-semibold text-slate-500 shadow-sm">
                        <tr>
                            <th className="sticky left-0 z-20 min-w-60 bg-slate-50 px-4 py-3"><SortHeader label="거래처" sortKey="name" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>
                            <th className="px-4 py-3"><SortHeader label="담당자" sortKey="rep" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>
                            <th className="px-4 py-3 text-right">주문횟수</th>
                            <th className="px-4 py-3 text-right"><SortHeader label="총수량" sortKey="quantityA" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>
                            <th className="px-4 py-3 text-right"><SortHeader label="총금액" sortKey="amountA" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>
                            <th className="px-4 py-3">최초 주문</th>
                            <th className="px-4 py-3">최근 주문</th>
                            <th className="px-4 py-3 text-right"><SortHeader label="평균 주문간격" sortKey="avgIntervalDays" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>
                            <th className="px-4 py-3 text-right"><SortHeader label="최대 공백" sortKey="maxIntervalDays" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>
                            <th className="px-4 py-3 text-right"><SortHeader label="최근 경과" sortKey="daysSinceLast" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>
                            <th className="px-4 py-3">예상 재주문일</th>
                            <th className="px-4 py-3 text-right"><SortHeader label="남은 기간" sortKey="daysUntilExpected" currentSort={sort} dir={dir} baseQuery={baseQuery} /></th>
                            {irregular && <th className="px-4 py-3">분류 사유</th>}
                            <th className="px-4 py-3 text-right">알림톡</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.map((row) => (
                            <tr key={row.key} className="group hover:bg-blue-50/40">
                                <td className="sticky left-0 z-[1] bg-white px-4 py-2.5 font-medium text-slate-800 group-hover:bg-blue-50">
                                    {row.customerId ? <Link href={`/admin/customers/${row.customerId}/ledger`} className="text-blue-700 hover:underline">{row.customerName}</Link> : row.customerName}
                                </td>
                                <td className="px-4 py-2.5 text-slate-500">{row.salesRepName ?? '미지정'}</td>
                                <td className="px-4 py-2.5 text-right text-slate-700">{row.orderCount.toLocaleString('ko-KR')}회</td>
                                <td className="px-4 py-2.5 text-right text-slate-700">{fmtNumber(row.totalQuantity)} TON</td>
                                <td className="px-4 py-2.5 text-right text-slate-700">{fmtMoney(row.totalAmount)}</td>
                                <td className="px-4 py-2.5 text-slate-600">{row.firstOrderDate ?? '-'}</td>
                                <td className="px-4 py-2.5 text-slate-600">{row.lastOrderDate ?? '-'}</td>
                                <td className="px-4 py-2.5 text-right text-slate-700">{row.avgIntervalDays == null ? '-' : `${row.avgIntervalDays.toFixed(1)}일`}</td>
                                <td className="px-4 py-2.5 text-right text-slate-700">{row.maxIntervalDays == null ? '-' : `${row.maxIntervalDays.toFixed(0)}일`}</td>
                                <td className="px-4 py-2.5 text-right text-slate-700">{row.daysSinceLast == null ? '-' : `${row.daysSinceLast}일`}</td>
                                <td className="px-4 py-2.5 text-slate-600">{row.expectedNextOrderDate ?? '-'}</td>
                                <td className={`px-4 py-2.5 text-right font-semibold ${row.daysUntilExpected != null && row.daysUntilExpected <= 3 ? 'text-red-700' : 'text-slate-700'}`}>{fmtDays(row.daysUntilExpected)}</td>
                                {irregular && <td className="px-4 py-2.5 text-xs font-medium text-orange-700">{row.irregularReason ?? '-'}</td>}
                                <td className="px-4 py-2.5 text-right"><button type="button" disabled className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-400">알림톡 준비</button></td>
                            </tr>
                        ))}
                        {rows.length === 0 && <tr><td colSpan={irregular ? 14 : 13} className="px-4 py-16 text-center text-sm text-slate-400">조회 결과가 없습니다.</td></tr>}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

export default async function CustomerPatternsPage({ searchParams }: { searchParams: Promise<Search> }) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const sp = await searchParams;
    const view = validView(sp.view);
    const sort = validSort(sp.sort);
    const dir = (sp.dir === 'asc' || (!sp.dir && sort === 'name') ? 'asc' : 'desc') as PerformanceSortDir;
    const canViewAll = session.user.name === '양희철' || session.user.name === '차성식';
    const report = await getPerformanceReport({
        patternFrom: sp.patternFrom,
        patternTo: sp.patternTo,
        sort,
        dir,
        viewerUserId: session.user.id,
        canViewAll,
        selectedRepId: sp.rep || 'all',
    });
    const rows = view === 'irregular' ? report.irregularPatterns : report.patterns;
    const baseQuery = {
        view,
        sort,
        dir,
        patternFrom: report.patternPeriod.from,
        patternTo: report.patternPeriod.to,
        rep: report.selectedRepId,
    };

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
                <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-5">
                    <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> 대시보드</Link>
                    <span className="text-sm text-slate-500">{session.user.name}</span>
                </div>
            </header>

            <main className="mx-auto max-w-[1600px] space-y-4 p-5">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div className="flex items-center gap-2"><Repeat className="text-emerald-600" size={22} /><h1 className="text-xl font-bold text-slate-800">거래처주문패턴</h1></div>
                            <p className="mt-1 text-xs text-slate-500">{canViewAll ? '전체 거래처 기준' : '내 담당 거래처 기준'}입니다. 정기 거래처와 비정기 거래처를 분리해서 관리합니다.</p>
                        </div>
                        <form className="flex flex-wrap items-end gap-2 text-sm">
                            <input type="hidden" name="view" value={view} />
                            <input type="hidden" name="sort" value={sort} />
                            <input type="hidden" name="dir" value={dir} />
                            {canViewAll && (
                                <select name="rep" defaultValue={report.selectedRepId} className="rounded-lg border border-slate-200 px-2 py-1.5">
                                    <option value="all">전체 담당자</option>
                                    {report.reps.map((rep) => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
                                </select>
                            )}
                            <div>
                                <p className="mb-2 text-xs font-semibold text-emerald-700">주문패턴 기준 기간</p>
                                <PerformanceRangeButtons target="pattern" from={report.patternPeriod.from} />
                                <div className="flex items-center gap-2"><input type="date" name="patternFrom" defaultValue={report.patternPeriod.from} className="rounded-lg border border-slate-200 px-2 py-1.5" /><span className="text-slate-400">~</span><input type="date" name="patternTo" defaultValue={report.patternPeriod.to} className="rounded-lg border border-slate-200 px-2 py-1.5" /></div>
                            </div>
                            <button className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800">조회</button>
                        </form>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex flex-wrap gap-2">
                        <Link href={buildQuery(baseQuery, { view: 'regular', sort: 'daysUntilExpected' })} className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${view === 'regular' ? 'border-blue-600 bg-blue-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50'}`}>정기 거래처 <span className={view === 'regular' ? 'text-blue-100' : 'text-slate-400'}>{report.patterns.length}</span></Link>
                        <Link href={buildQuery(baseQuery, { view: 'irregular', sort: 'daysSinceLast' })} className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${view === 'irregular' ? 'border-blue-600 bg-blue-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50'}`}>비정기 거래처 <span className={view === 'irregular' ? 'text-blue-100' : 'text-slate-400'}>{report.irregularPatterns.length}</span></Link>
                    </div>
                    <p className="text-xs text-slate-500">현재 정렬: {sortLabels[sort]} {dir === 'desc' ? '내림차순' : '오름차순'}</p>
                </div>

                <PatternTable rows={rows} sort={sort} dir={dir} baseQuery={baseQuery} irregular={view === 'irregular'} />
            </main>
        </div>
    );
}
