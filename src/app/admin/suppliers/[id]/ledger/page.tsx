import { auth } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { defaultSupplierLedgerRange, getSupplierLedger } from '@/lib/supplier-ledger';
import { fmtDate, fmtNumber } from '@/lib/orders';

export const dynamic = 'force-dynamic';

function fmtMoney(value: number | null | undefined) {
    if (value == null) return '-';
    return `${value.toLocaleString('ko-KR')}원`;
}

export default async function AdminSupplierLedgerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const [{ id }, sp] = await Promise.all([params, searchParams]);
    const range = defaultSupplierLedgerRange();
    const ledger = await getSupplierLedger(id, sp.from || range.from, sp.to || range.to);
    if (!ledger) notFound();

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
                    <Link href="/admin/suppliers" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> 매입처 목록</Link>
                    <span className="text-sm text-slate-500">{session.user.name}</span>
                </div>
            </header>
            <main className="mx-auto max-w-6xl space-y-6 p-6">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <div className="flex items-center gap-2"><BookOpen className="text-blue-600" size={24} /><h1 className="text-2xl font-bold text-slate-800">{ledger.supplierName} 매입처원장</h1></div>
                        <p className="mt-1 text-sm text-slate-500">이카운트 이관자료 + 실사용 주문 품목의 매입처 기준 원장입니다.</p>
                    </div>
                    <form className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 text-sm">
                        <input type="date" name="from" defaultValue={ledger.from} className="rounded-lg border border-slate-200 px-2 py-1" />
                        <span className="text-slate-400">~</span>
                        <input type="date" name="to" defaultValue={ledger.to} className="rounded-lg border border-slate-200 px-2 py-1" />
                        <button className="rounded-lg bg-slate-800 px-3 py-1.5 font-semibold text-white">조회</button>
                    </form>
                </div>
                <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-slate-100 px-6 py-4 text-sm text-slate-600">
                        총 수량 {fmtNumber(ledger.totalQuantity)}TON · 공급가액 {fmtMoney(ledger.totalSupplyAmount)} · 부가세 {fmtMoney(ledger.totalVatAmount)} · 합계 {fmtMoney(ledger.totalAmount)}
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
                                    <th className="px-5 py-3">매입일자</th>
                                    <th className="px-5 py-3">오더</th>
                                    <th className="px-5 py-3">품목</th>
                                    <th className="px-5 py-3 text-right">수량</th>
                                    <th className="px-5 py-3 text-right">단가</th>
                                    <th className="px-5 py-3 text-right">공급가액</th>
                                    <th className="px-5 py-3 text-right">부가세</th>
                                    <th className="px-5 py-3 text-right">합계</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {ledger.rows.map((row) => (
                                    <tr key={row.id}>
                                        <td className="px-5 py-3 text-slate-600">{fmtDate(row.purchaseDate)}</td>
                                        <td className="px-5 py-3 font-mono text-xs">{row.orderId ? <Link href={`/admin/orders/${row.orderId}`} className="text-blue-700">{row.orderNo}</Link> : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{row.orderNo}</span>}</td>
                                        <td className="px-5 py-3 text-slate-700"><span className="font-medium">{row.productName}</span><span className="ml-2 text-xs text-slate-400 font-mono">{row.productCode}</span></td>
                                        <td className="px-5 py-3 text-right text-slate-700">{fmtNumber(row.quantity)} {row.unit}</td>
                                        <td className="px-5 py-3 text-right text-slate-700">{fmtMoney(row.unitPrice)}</td>
                                        <td className="px-5 py-3 text-right text-slate-700">{fmtMoney(row.supplyAmount)}</td>
                                        <td className="px-5 py-3 text-right text-slate-700">{fmtMoney(row.vatAmount)}</td>
                                        <td className="px-5 py-3 text-right font-medium text-slate-800">{fmtMoney(row.totalAmount)}</td>
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