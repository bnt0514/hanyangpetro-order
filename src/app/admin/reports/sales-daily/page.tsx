import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import { auth } from '@/lib/auth';
import { fmtNumber } from '@/lib/orders';
import {
    getSalesDailyReport,
    todayIso,
    type DailyReportGroupBy,
    type DailyReportMode,
    type DailyReportRow,
} from '@/lib/sales-daily-report';
import DailyNavButtons from './DailyNavButtons';

export const dynamic = 'force-dynamic';

function fmtMoney(v: number) {
    if (v === 0) return '-';
    return `${Math.round(v).toLocaleString('ko-KR')}원`;
}

function fmtMoneySmall(v: number) {
    if (v === 0) return <span className="text-slate-300">-</span>;
    return <span>{Math.round(v).toLocaleString('ko-KR')}원</span>;
}

function isMode(v?: string): v is DailyReportMode {
    return v === 'daily' || v === 'monthly';
}

function isGroupBy(v?: string): v is DailyReportGroupBy {
    return v === 'total' || v === 'product' || v === 'customer';
}

function buildUrl(params: Record<string, string>) {
    return `/admin/reports/sales-daily?${new URLSearchParams(params).toString()}`;
}

function SummaryCard({ label, value, sub, tone = 'slate' }: {
    label: string; value: string; sub?: string; tone?: 'slate' | 'blue' | 'amber' | 'emerald' | 'red';
}) {
    const cls = {
        slate: 'bg-white border-slate-200 text-slate-800',
        blue: 'bg-blue-50 border-blue-100 text-blue-800',
        amber: 'bg-amber-50 border-amber-100 text-amber-800',
        emerald: 'bg-emerald-50 border-emerald-100 text-emerald-800',
        red: 'bg-red-50 border-red-100 text-red-800',
    }[tone];
    return (
        <div className={`rounded-2xl border px-4 py-3 shadow-sm ${cls}`}>
            <p className="text-xs font-medium opacity-70">{label}</p>
            <p className="mt-1 text-lg font-bold">{value}</p>
            {sub && <p className="mt-0.5 text-[11px] opacity-60">{sub}</p>}
        </div>
    );
}

function DailyTable({ rows, groupBy, mode }: { rows: DailyReportRow[]; groupBy: DailyReportGroupBy; mode: DailyReportMode }) {
    const showGroup = groupBy !== 'total';
    const showPeriod = mode === 'daily' || groupBy === 'total';

    if (rows.length === 0) {
        return (
            <div className="p-12 text-center text-sm text-slate-400">
                조회 결과가 없습니다.
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
                <thead>
                    <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500 sticky top-0">
                        <th className="px-4 py-3 sticky left-0 bg-slate-50 z-10">{mode === 'daily' ? '날짜' : '월'}</th>
                        {showGroup && (
                            <th className="px-4 py-3">{groupBy === 'product' ? '품목' : '거래처'}</th>
                        )}
                        <th className="px-4 py-3 text-right text-blue-600">매출수량</th>
                        <th className="px-4 py-3 text-right text-blue-600">매출금액</th>
                        <th className="px-4 py-3 text-right text-blue-500 text-[11px]">공급가액</th>
                        <th className="px-4 py-3 text-right text-blue-500 text-[11px]">VAT</th>
                        <th className="px-4 py-3 text-right text-amber-600">매입수량</th>
                        <th className="px-4 py-3 text-right text-amber-600">매입금액</th>
                        <th className="px-4 py-3 text-right text-amber-500 text-[11px]">공급가액</th>
                        <th className="px-4 py-3 text-right text-amber-500 text-[11px]">VAT</th>
                        <th className="px-4 py-3 text-right text-emerald-600">수익</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {rows.map((row) => (
                        <tr key={row.groupKey} className="hover:bg-blue-50/40 transition">
                            <td className="px-4 py-2.5 font-mono text-xs text-slate-600 sticky left-0 bg-white">{row.period}</td>
                            {showGroup && (
                                <td className="px-4 py-2.5 font-medium text-slate-800">{row.label}</td>
                            )}
                            <td className="px-4 py-2.5 text-right text-slate-700">
                                {row.salesQuantity > 0 ? `${fmtNumber(row.salesQuantity)} T` : <span className="text-slate-300">-</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right font-semibold text-blue-700">
                                {row.salesTotal > 0 ? fmtMoney(row.salesTotal) : <span className="text-slate-300">-</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right text-[11px] text-slate-400">
                                {fmtMoneySmall(row.salesSupply)}
                            </td>
                            <td className="px-4 py-2.5 text-right text-[11px] text-slate-400">
                                {fmtMoneySmall(row.salesVat)}
                            </td>
                            <td className="px-4 py-2.5 text-right text-slate-700">
                                {row.purchaseQuantity > 0 ? `${fmtNumber(row.purchaseQuantity)} T` : <span className="text-slate-300">-</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right font-semibold text-amber-700">
                                {row.purchaseTotal > 0 ? fmtMoney(row.purchaseTotal) : <span className="text-slate-300">-</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right text-[11px] text-slate-400">
                                {fmtMoneySmall(row.purchaseSupply)}
                            </td>
                            <td className="px-4 py-2.5 text-right text-[11px] text-slate-400">
                                {fmtMoneySmall(row.purchaseVat)}
                            </td>
                            <td className={`px-4 py-2.5 text-right font-bold ${row.profit > 0 ? 'text-emerald-700' : row.profit < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                                {row.profit !== 0 ? fmtMoney(row.profit) : <span className="text-slate-300">-</span>}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default async function SalesDailyPage({
    searchParams,
}: {
    searchParams: Promise<{ from?: string; to?: string; mode?: string; groupBy?: string }>;
}) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const sp = await searchParams;
    const today = todayIso();
    const from = sp.from || today;
    const to = sp.to || today;
    const mode: DailyReportMode = isMode(sp.mode) ? sp.mode : 'daily';
    const groupBy: DailyReportGroupBy = isGroupBy(sp.groupBy) ? sp.groupBy : 'total';

    const report = await getSalesDailyReport({ fromIso: from, toIso: to, mode, groupBy });

    const modeOptions: { value: DailyReportMode; label: string }[] = [
        { value: 'daily', label: '일별' },
        { value: 'monthly', label: '월별' },
    ];

    const groupByOptions: { value: DailyReportGroupBy; label: string }[] = [
        { value: 'total', label: '전체' },
        { value: 'product', label: '품목별' },
        { value: 'customer', label: '거래처별' },
    ];

    const baseQuery = { from, to, mode, groupBy };

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
                <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-5">
                    <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
                        <ArrowLeft size={14} /> 대시보드
                    </Link>
                    <span className="text-sm text-slate-500">{session.user.name}</span>
                </div>
            </header>

            <main className="mx-auto max-w-[1600px] space-y-4 p-5">

                {/* 헤더 + 조회 폼 */}
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-2">
                        <CalendarDays className="text-orange-500" size={20} />
                        <h1 className="text-lg font-bold text-slate-800">매입매출조회</h1>
                        <span className="text-xs text-slate-400">일별·월별 매출·매입 현황</span>
                    </div>
                    <form className="flex flex-wrap items-end gap-3 text-sm">
                        <div className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-slate-500">조회 기간</span>
                            <div className="flex items-center gap-1.5">
                                <input type="date" name="from" defaultValue={from}
                                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" />
                                <span className="text-slate-400">~</span>
                                <input type="date" name="to" defaultValue={to}
                                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm" />
                            </div>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-slate-500">표시 방식</span>
                            <div className="flex gap-1">
                                {modeOptions.map((opt) => (
                                    <Link key={opt.value}
                                        href={buildUrl({ ...baseQuery, mode: opt.value })}
                                        className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${mode === opt.value ? 'border-orange-500 bg-orange-500 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                                        {opt.label}
                                    </Link>
                                ))}
                            </div>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-slate-500">분류 기준</span>
                            <div className="flex gap-1">
                                {groupByOptions.map((opt) => (
                                    <Link key={opt.value}
                                        href={buildUrl({ ...baseQuery, groupBy: opt.value })}
                                        className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${groupBy === opt.value ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                                        {opt.label}
                                    </Link>
                                ))}
                            </div>
                        </div>
                        <button type="submit"
                            className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800">
                            조회
                        </button>
                    </form>
                </div>

                {/* 빠른 날짜 이동 */}
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <DailyNavButtons from={from} to={to} mode={mode} groupBy={groupBy} />
                </div>

                {/* 요약 카드 */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <SummaryCard label="매출수량" value={`${fmtNumber(report.summary.salesQuantity)} T`} tone="blue" />
                    <SummaryCard label="총 매출" value={fmtMoney(report.summary.salesTotal)} tone="blue" />
                    <SummaryCard label="매입수량" value={`${fmtNumber(report.summary.purchaseQuantity)} T`} tone="amber" />
                    <SummaryCard label="총 매입" value={fmtMoney(report.summary.purchaseTotal)} tone="amber" />
                    <SummaryCard
                        label="수익"
                        value={fmtMoney(report.summary.profit)}
                        tone={report.summary.profit >= 0 ? 'emerald' : 'red'}
                    />
                </div>

                {/* 테이블 */}
                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                        <p className="text-sm font-semibold text-slate-700">
                            {mode === 'daily' ? '일별' : '월별'} {groupBy === 'total' ? '전체' : groupBy === 'product' ? '품목별' : '거래처별'} 현황
                            <span className="ml-2 text-xs font-normal text-slate-400">{report.rows.length}건</span>
                        </p>
                        <span className="text-xs text-slate-400">{from} ~ {to}</span>
                    </div>
                    <div className="max-h-[calc(100vh-380px)] min-h-[320px] overflow-auto">
                        <DailyTable rows={report.rows} groupBy={groupBy} mode={mode} />
                    </div>
                </section>
            </main>
        </div>
    );
}
