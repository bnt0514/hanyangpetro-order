import { auth, signOut } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { defaultLedgerRange, getCustomerLedger, type CompanyLedger } from '@/lib/ledger';
import { fmtDate, fmtNumber } from '@/lib/orders';
import BackButton from '@/components/BackButton';

export const dynamic = 'force-dynamic';

function fmtMoney(value: number | null | undefined) {
    if (value == null) return '-';
    return `${value.toLocaleString('ko-KR')}원`;
}

function deltaClass(value: number | null) {
    if (value == null || value === 0) return 'text-slate-500';
    return value > 0 ? 'text-red-600' : 'text-blue-600';
}

function deltaText(value: number | null, suffix = '') {
    if (value == null) return '-';
    if (value === 0) return `변동없음${suffix}`;
    return `${value > 0 ? '▲' : '▼'} ${Math.abs(value).toLocaleString('ko-KR')}${suffix}`;
}

function LedgerTable({ ledger }: { ledger: CompanyLedger }) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-100 px-6 py-4">
                <h2 className="text-lg font-semibold text-slate-800">{ledger.companyName} 거래처원장</h2>
                <p className="mt-1 text-xs text-slate-500">총 수량 {fmtNumber(ledger.totalQuantity)}TON · 총 금액 {fmtMoney(ledger.totalAmount)}</p>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase">
                            <th className="px-5 py-3">매출일자</th>
                            <th className="px-5 py-3">품목</th>
                            <th className="px-5 py-3 text-right">수량</th>
                            <th className="px-5 py-3 text-right">단가</th>
                            <th className="px-5 py-3 text-right">금액</th>
                            <th className="px-5 py-3">비고</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {ledger.rows.map((row) => (
                            <tr key={row.itemId}>
                                <td className="px-5 py-3 text-slate-600">{fmtDate(row.salesDate)}</td>
                                <td className="px-5 py-3 text-slate-700"><span className="font-medium">{row.productName}</span><span className="ml-2 text-xs text-slate-400 font-mono">{row.productCode}</span></td>
                                <td className="px-5 py-3 text-right text-slate-700">{fmtNumber(row.quantity)} {row.unit}</td>
                                <td className="px-5 py-3 text-right text-slate-700">{fmtMoney(row.unitPrice)}</td>
                                <td className="px-5 py-3 text-right font-medium text-slate-800">{fmtMoney(row.amount)}</td>
                                <td className="px-5 py-3 text-slate-500">{row.memo ?? '-'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {ledger.comparisons.length > 0 && (
                <div className="border-t border-slate-100 bg-slate-50/60 px-6 py-4">
                    <h3 className="text-sm font-semibold text-slate-700">전달 대비 품목 변화</h3>
                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                        {ledger.comparisons.map((item) => (
                            <div key={item.productId} className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
                                <p className="font-medium text-slate-800">{item.productName}</p>
                                <p className="mt-1 text-slate-500">수량 {fmtNumber(item.previousQuantity)} → {fmtNumber(item.currentQuantity)}TON <span className={deltaClass(item.quantityDelta)}>{deltaText(item.quantityDelta, 'TON')}</span></p>
                                <p className="mt-1 text-slate-500">평균단가 {fmtMoney(item.previousAvgUnitPrice)} → {fmtMoney(item.currentAvgUnitPrice)} <span className={deltaClass(item.unitPriceDelta)}>{deltaText(item.unitPriceDelta, '원')}</span></p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </section>
    );
}

export default async function PortalLedgerPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'customer') redirect('/admin');
    if (!session.user.customerId) redirect('/login');

    const sp = await searchParams;
    const range = defaultLedgerRange();
    const ledger = await getCustomerLedger(session.user.customerId, sp.from || range.from, sp.to || range.to);
    if (!ledger) redirect('/portal');

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="bg-white border-b border-slate-200">
                <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/portal" className="flex items-center gap-2">
                        <Image src="/hanyanglogo.png" alt="logo" width={32} height={32} className="h-8 w-auto" />
                        <span className="font-bold text-slate-800">한양유화 거래처 포털</span>
                    </Link>
                    <form action={async () => { 'use server'; await signOut({ redirectTo: '/login' }); }}>
                        <button className="text-sm text-slate-500 hover:text-red-600 transition">로그아웃</button>
                    </form>
                </div>
            </header>
            <main className="max-w-5xl mx-auto p-6 space-y-6">
                <Link href="/portal" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> 포털로</Link>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <div className="flex items-center gap-2"><BookOpen className="text-blue-600" size={24} /><h1 className="text-2xl font-bold text-slate-800">{ledger.customerName} 거래처원장</h1></div>
                        <p className="mt-1 text-sm text-slate-500">매출일자=도착일자 기준입니다.</p>
                    </div>
                    <form className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 text-sm">
                        <input type="date" name="from" defaultValue={ledger.from} className="rounded-lg border border-slate-200 px-2 py-1" />
                        <span className="text-slate-400">~</span>
                        <input type="date" name="to" defaultValue={ledger.to} className="rounded-lg border border-slate-200 px-2 py-1" />
                        <button className="rounded-lg bg-slate-800 px-3 py-1.5 font-semibold text-white">조회</button>
                    </form>
                </div>
                {ledger.ledgers.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-400">조회 기간 내 매출 원장 항목이 없습니다.</div>
                ) : ledger.ledgers.map((companyLedger) => <LedgerTable key={companyLedger.companyEntityId} ledger={companyLedger} />)}
            </main>
            <BackButton />
        </div>
    );
}
