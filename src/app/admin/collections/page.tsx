import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, CircleDollarSign, Search, TriangleAlert, WalletCards } from 'lucide-react';
import {
    defaultCollectionReconciliationParams,
    getCollectionReconciliationReport,
    type CollectionStatus,
} from '@/lib/collection-reconciliation';
import { canViewAllStaffData } from '@/lib/staff-permissions';

export const dynamic = 'force-dynamic';

type SearchParams = {
    month?: string;
    asOf?: string;
    fromMonth?: string;
    q?: string;
    status?: string;
};

function money(value: number) {
    return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function statusLabel(status: CollectionStatus) {
    if (status === 'PAID') return '수금완료';
    if (status === 'PARTIAL') return '일부수금';
    if (status === 'UNPAID') return '미수';
    return '선수금';
}

function statusClass(status: CollectionStatus) {
    if (status === 'PAID') return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
    if (status === 'PARTIAL') return 'bg-amber-50 text-amber-700 ring-amber-100';
    if (status === 'UNPAID') return 'bg-rose-50 text-rose-700 ring-rose-100';
    return 'bg-blue-50 text-blue-700 ring-blue-100';
}

function monthEndIso(month: string) {
    const [year, monthIndex] = month.split('-').map(Number);
    const last = new Date(year, monthIndex, 0);
    return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
}

function addMonth(month: string, delta: number) {
    const [year, monthIndex] = month.split('-').map(Number);
    const date = new Date(year, monthIndex - 1 + delta, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function buildHref(params: Record<string, string | undefined>) {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value) sp.set(key, value);
    }
    return `/admin/collections?${sp.toString()}`;
}

function SummaryCard({
    label,
    value,
    sub,
    tone,
}: {
    label: string;
    value: string;
    sub?: string;
    tone: 'slate' | 'blue' | 'emerald' | 'amber' | 'rose';
}) {
    const tones = {
        slate: 'border-slate-200 bg-white text-slate-900',
        blue: 'border-blue-100 bg-blue-50 text-blue-900',
        emerald: 'border-emerald-100 bg-emerald-50 text-emerald-900',
        amber: 'border-amber-100 bg-amber-50 text-amber-900',
        rose: 'border-rose-100 bg-rose-50 text-rose-900',
    };
    return (
        <div className={`rounded-xl border p-4 ${tones[tone]}`}>
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className="mt-1 text-lg font-black">{value}</p>
            {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
        </div>
    );
}

export default async function CollectionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');
    if (!canViewAllStaffData(session.user)) redirect('/admin');

    const sp = await searchParams;
    const defaults = defaultCollectionReconciliationParams();
    const report = await getCollectionReconciliationReport({
        month: sp.month || defaults.month,
        asOf: sp.asOf || defaults.asOf,
        fromMonth: sp.fromMonth || defaults.fromMonth,
        q: sp.q,
        status: sp.status,
    });
    const selectedMonthFrom = `${report.selectedMonth}-01`;
    const selectedMonthTo = monthEndIso(report.selectedMonth);
    const previousHref = buildHref({ ...sp, month: addMonth(report.selectedMonth, -1) });
    const nextHref = buildHref({ ...sp, month: addMonth(report.selectedMonth, 1) });

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
                    <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
                        <ArrowLeft size={14} /> 대시보드
                    </Link>
                    <span className="text-sm text-slate-500">{session.user.name}</span>
                </div>
            </header>

            <main className="mx-auto max-w-7xl space-y-4 p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <WalletCards className="text-emerald-700" size={26} />
                        <div>
                            <h1 className="text-2xl font-black text-slate-900">수금대조</h1>
                            <p className="mt-1 text-sm text-slate-500">
                                VAT 포함 합계 기준으로 입금/어음수취를 오래된 매출월부터 자동 배분합니다. 1원 차이도 미수 또는 초과로 봅니다.
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Link href={previousHref} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">1개월 전</Link>
                        <Link href={nextHref} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">1개월 후</Link>
                    </div>
                </div>

                <form className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="grid gap-3 md:grid-cols-[160px_160px_160px_160px_1fr_auto] md:items-end">
                        <label className="space-y-1">
                            <span className="text-xs font-semibold text-slate-500">매출 기준월</span>
                            <input name="month" type="month" defaultValue={report.selectedMonth} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
                        </label>
                        <label className="space-y-1">
                            <span className="text-xs font-semibold text-slate-500">수금 확인일</span>
                            <input name="asOf" type="date" defaultValue={report.asOf} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
                        </label>
                        <label className="space-y-1">
                            <span className="text-xs font-semibold text-slate-500">배분 시작월</span>
                            <input name="fromMonth" type="month" defaultValue={report.allocationFromMonth} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
                        </label>
                        <label className="space-y-1">
                            <span className="text-xs font-semibold text-slate-500">상태</span>
                            <select name="status" defaultValue={report.status} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100">
                                <option value="all">전체</option>
                                <option value="UNPAID">미수</option>
                                <option value="PARTIAL">일부수금</option>
                                <option value="PAID">수금완료</option>
                                <option value="ADVANCE">선수금</option>
                            </select>
                        </label>
                        <label className="space-y-1">
                            <span className="text-xs font-semibold text-slate-500">거래처 검색</span>
                            <div className="relative">
                                <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
                                <input name="q" defaultValue={report.query} placeholder="거래처명, 담당자, 수금조건" className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
                            </div>
                        </label>
                        <button className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-bold text-white hover:bg-slate-800">조회</button>
                    </div>
                </form>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                    <SummaryCard label="대상 거래처" value={`${report.summary.customerCount.toLocaleString('ko-KR')}개`} tone="slate" />
                    <SummaryCard label={`${report.selectedMonth} 매출`} value={money(report.summary.selectedSalesTotal)} tone="blue" />
                    <SummaryCard label="배분된 수금" value={money(report.summary.selectedAllocatedReceiptTotal)} tone="emerald" />
                    <SummaryCard label="기준월 미수" value={money(report.summary.selectedBalanceTotal)} sub={`${report.summary.unpaidCount + report.summary.partialCount}개 업체`} tone={report.summary.selectedBalanceTotal > 0 ? 'rose' : 'emerald'} />
                    <SummaryCard label="이전월 미수" value={money(report.summary.priorUnpaidTotal)} tone={report.summary.priorUnpaidTotal > 0 ? 'amber' : 'slate'} />
                    <SummaryCard label="선수금" value={money(report.summary.advanceTotal)} tone={report.summary.advanceTotal > 0 ? 'blue' : 'slate'} />
                </div>

                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
                        <div>
                            <h2 className="font-bold text-slate-900">{report.selectedMonth} 수금대조 결과</h2>
                            <p className="mt-0.5 text-xs text-slate-500">배분 시작월 {report.allocationFromMonth} · 수금 확인일 {report.asOf}</p>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs font-bold">
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-rose-700"><TriangleAlert size={13} /> 미수 {report.summary.unpaidCount}</span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-amber-700"><CircleDollarSign size={13} /> 일부 {report.summary.partialCount}</span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700"><CheckCircle2 size={13} /> 완료 {report.summary.paidCount}</span>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1180px] text-sm">
                            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                                <tr>
                                    <th className="px-4 py-3">거래처</th>
                                    <th className="px-4 py-3">상태</th>
                                    <th className="px-4 py-3 text-right">매출 합계</th>
                                    <th className="px-4 py-3 text-right">배분 수금</th>
                                    <th className="px-4 py-3 text-right">기준월 차액</th>
                                    <th className="px-4 py-3 text-right">이전월 미수</th>
                                    <th className="px-4 py-3 text-right">선수금</th>
                                    <th className="px-4 py-3">최근 수금</th>
                                    <th className="px-4 py-3">월별 잔액</th>
                                    <th className="px-4 py-3 text-right">보기</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {report.rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={10} className="px-4 py-12 text-center text-sm text-slate-400">조회 조건에 해당하는 수금대조 건이 없습니다.</td>
                                    </tr>
                                ) : report.rows.map((row) => (
                                    <tr key={row.customerId} className="align-top hover:bg-slate-50">
                                        <td className="px-4 py-3">
                                            <div className="font-bold text-slate-900">{row.customerName}</div>
                                            <div className="mt-0.5 text-xs text-slate-400">
                                                {row.customerCode ?? '-'} · {row.salesRepName ?? '담당자 없음'}
                                            </div>
                                            {row.paymentTerms && <div className="mt-1 text-xs text-slate-500">조건: {row.paymentTerms}</div>}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${statusClass(row.status)}`}>
                                                {statusLabel(row.status)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-semibold text-slate-800">{money(row.selectedSalesTotal)}</td>
                                        <td className="px-4 py-3 text-right font-semibold text-emerald-700">{money(row.selectedAllocatedReceiptTotal)}</td>
                                        <td className={`px-4 py-3 text-right font-black ${row.selectedBalance > 0 ? 'text-rose-700' : 'text-slate-500'}`}>{money(row.selectedBalance)}</td>
                                        <td className={`px-4 py-3 text-right font-semibold ${row.priorUnpaidTotal > 0 ? 'text-amber-700' : 'text-slate-400'}`}>{money(row.priorUnpaidTotal)}</td>
                                        <td className={`px-4 py-3 text-right font-semibold ${row.advanceAmount > 0 ? 'text-blue-700' : 'text-slate-400'}`}>{money(row.advanceAmount)}</td>
                                        <td className="px-4 py-3 text-slate-600">
                                            <div>{row.latestReceiptDate ?? '-'}</div>
                                            <div className="text-xs text-slate-400">누적 {money(row.receiptTotalThroughAsOf)}</div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex max-w-[300px] flex-wrap gap-1.5">
                                                {row.buckets.map((bucket) => (
                                                    <span key={bucket.month} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${bucket.balance > 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>
                                                        {bucket.month} {money(bucket.balance)}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex justify-end gap-1.5">
                                                <Link href={`/admin/customers/${row.customerId}/ledger?from=${selectedMonthFrom}&to=${selectedMonthTo}`} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800">원장</Link>
                                                <Link href={`/admin/finance-transactions?q=${encodeURIComponent(row.customerName)}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">입금</Link>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            </main>
        </div>
    );
}
