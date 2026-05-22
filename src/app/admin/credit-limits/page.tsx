import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { auth } from '@/lib/auth';
import { canManageCreditLimits, defaultAsOf, getCreditLimitReport, type CreditLimitSortDir, type CreditLimitSortKey } from '@/lib/credit-limits';
import { applyCalculatedCreditLimits, updateCustomerCreditLimit } from './actions';
import BulkSaveButton from './BulkSaveButton';
import F8FormShortcut from '@/components/F8FormShortcut';

export const dynamic = 'force-dynamic';

const sortOptions: { value: CreditLimitSortKey; label: string }[] = [
    { value: 'calculatedLimit', label: '산정한도순' },
    { value: 'averageSales', label: '평균매출순' },
    { value: 'currentLimit', label: '최종여신순' },
    { value: 'difference', label: '차액순' },
    { value: 'creditInsuranceAmount', label: '매출채권보험순' },
    { value: 'mortgageAmount', label: '근저당설정순' },
    { value: 'creditGrade', label: '내부등급순' },
    { value: 'rep', label: '담당자순' },
    { value: 'customer', label: '거래처명순' },
];

function money(value: number) {
    return Math.round(value).toLocaleString('ko-KR');
}

function dateText(date: Date) {
    return date.toISOString().slice(0, 10);
}

function hiddenState(report: { asOf: string; months: number }, sort: string, dir: string, q: string) {
    return (
        <>
            <input type="hidden" name="asOf" value={report.asOf} />
            <input type="hidden" name="months" value={report.months} />
            <input type="hidden" name="sort" value={sort} />
            <input type="hidden" name="dir" value={dir} />
            <input type="hidden" name="q" value={q} />
        </>
    );
}

export default async function CreditLimitsPage({
    searchParams,
}: {
    searchParams: Promise<{ asOf?: string; months?: string; sort?: string; dir?: string; q?: string }>;
}) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (!canManageCreditLimits(session.user)) redirect('/admin');

    const params = await searchParams;
    const asOf = params.asOf || defaultAsOf();
    const months = params.months || '3';
    const sort = (params.sort || 'calculatedLimit') as CreditLimitSortKey;
    const dir = (params.dir === 'asc' ? 'asc' : 'desc') as CreditLimitSortDir;
    const q = params.q?.trim() || '';
    const report = await getCreditLimitReport({ asOf, months, sort, dir, q });

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="bg-white border-b border-slate-200">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/admin" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
                        <ArrowLeft size={14} /> 대시보드
                    </Link>
                    <div className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
                        양희철 전용
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto p-6 space-y-5">
                <F8FormShortcut formIdPrefix="credit-" />
                <div className="flex items-end justify-between gap-3 flex-wrap">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                            <ShieldCheck size={24} /> 거래처별 여신관리
                        </h1>
                        <p className="mt-1 text-sm text-slate-500">
                            산정한도는 당월 제외 선택 기간 평균매출액 × 2입니다. 최종 여신한도는 직접 수정해 저장할 수 있습니다.
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                            현재 조회 기간: {dateText(report.startDate)} ~ {dateText(report.endDate)} 전일
                        </p>
                    </div>
                    <form action={applyCalculatedCreditLimits}>
                        {hiddenState(report, sort, dir, q)}
                        <button className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-amber-700">
                            조회 결과 산정한도로 일괄반영
                        </button>
                    </form>
                </div>

                <section className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
                    <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
                        <p className="text-xs text-slate-500">조회 거래처</p>
                        <p className="mt-1 text-xl font-bold text-slate-900">{money(report.summary.customerCount)}개</p>
                    </div>
                    <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
                        <p className="text-xs text-slate-500">매출 발생</p>
                        <p className="mt-1 text-xl font-bold text-blue-700">{money(report.summary.activeSalesCustomerCount)}개</p>
                    </div>
                    <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
                        <p className="text-xs text-slate-500">평균매출 합계</p>
                        <p className="mt-1 text-xl font-bold text-slate-900">{money(report.summary.totalAverageSales)}원</p>
                    </div>
                    <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
                        <p className="text-xs text-slate-500">산정한도 합계</p>
                        <p className="mt-1 text-xl font-bold text-amber-700">{money(report.summary.totalCalculatedLimit)}원</p>
                    </div>
                    <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
                        <p className="text-xs text-slate-500">최종 여신 합계</p>
                        <p className="mt-1 text-xl font-bold text-slate-900">{money(report.summary.totalCurrentLimit)}원</p>
                    </div>
                    <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
                        <p className="text-xs text-slate-500">매출채권보험</p>
                        <p className="mt-1 text-xl font-bold text-emerald-700">{money(report.summary.totalCreditInsuranceAmount)}원</p>
                    </div>
                    <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
                        <p className="text-xs text-slate-500">근저당설정</p>
                        <p className="mt-1 text-xl font-bold text-indigo-700">{money(report.summary.totalMortgageAmount)}원</p>
                    </div>
                </section>

                <form className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-end gap-3 flex-wrap">
                    <label className="text-xs font-semibold text-slate-600">
                        기준일
                        <input type="date" name="asOf" defaultValue={report.asOf} className="mt-1 block rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-xs font-semibold text-slate-600">
                        기간
                        <select name="months" defaultValue={report.months} className="mt-1 block rounded-xl border border-slate-300 px-3 py-2 text-sm">
                            <option value="3">당월 제외 이전 3개월</option>
                            <option value="4">당월 제외 이전 4개월</option>
                            <option value="5">당월 제외 이전 5개월</option>
                            <option value="12">당월 제외 이전 1년</option>
                        </select>
                    </label>
                    <label className="text-xs font-semibold text-slate-600">
                        정렬
                        <select name="sort" defaultValue={sort} className="mt-1 block rounded-xl border border-slate-300 px-3 py-2 text-sm">
                            {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                    </label>
                    <label className="text-xs font-semibold text-slate-600">
                        방향
                        <select name="dir" defaultValue={dir} className="mt-1 block rounded-xl border border-slate-300 px-3 py-2 text-sm">
                            <option value="desc">내림차순</option>
                            <option value="asc">오름차순</option>
                        </select>
                    </label>
                    <label className="text-xs font-semibold text-slate-600 min-w-40">
                        검색
                        <input name="q" defaultValue={q} placeholder="거래처명/코드/담당자" className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                    </label>
                    <button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">조회</button>
                    <BulkSaveButton />
                </form>

                <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase">
                                    <th className="px-4 py-3 min-w-56">거래처</th>
                                    <th className="px-4 py-3 min-w-24">담당자</th>
                                    {report.monthKeys.map((month) => <th key={month} className="px-4 py-3 text-right min-w-28">{month}</th>)}
                                    <th className="px-4 py-3 text-right min-w-32">평균매출</th>
                                    <th className="px-4 py-3 text-right min-w-32">산정한도<br /><span className="font-normal">평균×2</span></th>
                                    <th className="px-4 py-3 text-right min-w-40">최종 여신한도</th>
                                    <th className="px-4 py-3 text-right min-w-32">내부등급</th>
                                    <th className="px-4 py-3 text-right min-w-36">차액<br /><span className="font-normal">최종-산정</span></th>
                                    <th className="px-4 py-3 text-right min-w-40">매출채권보험</th>
                                    <th className="px-4 py-3 text-right min-w-40">근저당설정</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {report.rows.map((row) => (
                                    <tr key={row.customerId} className="hover:bg-blue-50/30">
                                        <td className="px-4 py-3">
                                            <Link href={`/admin/customers/${row.customerId}`} className="font-semibold text-slate-800 hover:text-blue-700">{row.companyName}</Link>
                                            <div className="text-xs font-mono text-slate-400">{row.customerCode}</div>
                                        </td>
                                        <td className="px-4 py-3 text-slate-600">{row.salesRepName}</td>
                                        {row.monthlyAmounts.map((month) => <td key={month.month} className="px-4 py-3 text-right text-slate-600">{money(month.amount)}</td>)}
                                        <td className="px-4 py-3 text-right font-semibold text-slate-800">{money(row.averageSales)}</td>
                                        <td className="px-4 py-3 text-right font-bold text-amber-700">{money(row.calculatedLimit)}</td>
                                        <td className="px-4 py-3 text-right">
                                            <form id={`credit-${row.customerId}`} action={updateCustomerCreditLimit} className="flex justify-end gap-2">
                                                {hiddenState(report, sort, dir, q)}
                                                <input type="hidden" name="customerId" value={row.customerId} />
                                                <input name="creditLimit" defaultValue={row.currentLimit} className="w-36 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm font-semibold" />
                                            </form>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex justify-end gap-1.5">
                                                <select form={`credit-${row.customerId}`} name="creditGrade" defaultValue={row.creditGrade} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm font-semibold uppercase">
                                                    <option value="A">A</option>
                                                    <option value="B">B</option>
                                                    <option value="C">C</option>
                                                </select>
                                                <button form={`credit-${row.customerId}`} title="이 행에서 F8로도 저장할 수 있습니다" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">저장 (F8)</button>
                                            </div>
                                        </td>
                                        <td className={`px-4 py-3 text-right font-semibold ${row.difference >= 0 ? 'text-blue-700' : 'text-red-600'}`}>{money(row.difference)}</td>
                                        <td className="px-4 py-3 text-right">
                                            <input form={`credit-${row.customerId}`} name="creditInsuranceAmount" defaultValue={row.creditInsuranceAmount} className="w-36 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm" />
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <input form={`credit-${row.customerId}`} name="mortgageAmount" defaultValue={row.mortgageAmount} className="w-36 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm" />
                                        </td>
                                    </tr>
                                ))}
                                {report.rows.length === 0 && (
                                    <tr>
                                        <td colSpan={report.monthKeys.length + 9} className="px-4 py-12 text-center text-sm text-slate-400">조회 결과가 없습니다.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </main>
        </div>
    );
}

