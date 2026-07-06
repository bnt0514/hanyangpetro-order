import { auth } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { defaultSupplierLedgerRange, getSupplierLedger } from '@/lib/supplier-ledger';
import { fmtDate, fmtNumber } from '@/lib/orders';
import { prisma } from '@/lib/db';
import LedgerRangeForm from './LedgerRangeForm';
import ManualEntryDeleteButton from '@/app/admin/customers/[id]/ledger/ManualEntryDeleteButton';
import LedgerRowEditButton from '@/app/admin/ledger/LedgerRowEditButton';
import LedgerQuickAddForm from '@/app/admin/ledger/LedgerQuickAddForm';

export const dynamic = 'force-dynamic';

function fmtMoney(value: number | null | undefined) {
    if (value == null) return '-';
    return `${value.toLocaleString('ko-KR')}원`;
}

function fmtAmount(value: number | null | undefined) {
    if (value == null) return '-';
    return value.toLocaleString('ko-KR');
}

function dateToInput(value: Date | null | undefined) {
    if (!value) return '';
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export default async function AdminSupplierLedgerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const [{ id }, sp] = await Promise.all([params, searchParams]);
    const range = defaultSupplierLedgerRange();
    const [ledger, products, currentUser] = await Promise.all([
        getSupplierLedger(id, sp.from || range.from, sp.to || range.to),
        prisma.product.findMany({
            where: { isActive: true },
            select: { id: true, productName: true, productCode: true },
            orderBy: [{ productName: 'asc' }],
        }),
        prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true, isActive: true } }),
    ]);
    if (!ledger) notFound();
    const canEditLedger = !!currentUser?.isActive && ['양희철', '차성식'].includes(currentUser.name.replace(/\s/g, ''));

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
                    <Link href="/admin/ledger?tab=supplier" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> 매입처 원장 조회</Link>
                    <span className="text-sm text-slate-500">{session.user.name}</span>
                </div>
            </header>
            <main className="mx-auto max-w-6xl space-y-6 p-6">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <div className="flex items-center gap-2"><BookOpen className="text-violet-600" size={24} /><h1 className="text-2xl font-bold text-slate-800">{ledger.supplierName} 매입처원장</h1></div>
                        <p className="mt-1 text-sm text-slate-500">배차완료 이후 상태의 주문만 반영되며 매입일자=매입요청일 기준입니다, 필요 시 원장에서 매입처별로 별도 변경합니다.</p>
                    </div>
                    <LedgerRangeForm from={ledger.from} to={ledger.to} />
                </div>
                <form action="/admin/ledger" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-3 sm:flex-row sm:items-end">
                    <input type="hidden" name="tab" value="supplier" />
                    <div className="flex-1">
                        <label className="mb-1.5 block text-sm font-medium text-slate-700">다른 매입처 원장 조회</label>
                        <input
                            name="q"
                            placeholder="매입처명을 입력하세요"
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                    </div>
                    <button className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">조회</button>
                </form>
                <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
                        <h2 className="text-lg font-semibold text-slate-800">{ledger.supplierName} 매입 원장</h2>
                        <LedgerQuickAddForm canEdit={canEditLedger} mode="PURCHASE" supplierId={ledger.supplierId} products={products} />
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
                                    <th className="px-5 py-3">매입일자</th>
                                    <th className="px-5 py-3">오더번호</th>
                                    <th className="px-5 py-3">품목</th>
                                    <th className="px-5 py-3 text-right">수량(TON)</th>
                                    <th className="px-5 py-3 text-right">단가(원)</th>
                                    <th className="px-5 py-3 text-right">공급가액(원)</th>
                                    <th className="px-5 py-3 text-right">부가세(원)</th>
                                    <th className="px-5 py-3 text-right">합계(원)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {ledger.rows.map((row) => {
                                    const financeHref = row.noteNumber
                                        ? `/admin/finance-transactions?txType=NOTE_TRANSFER&q=${encodeURIComponent(row.noteNumber)}`
                                        : row.paymentId
                                            ? `/admin/finance-transactions?q=${encodeURIComponent(row.memo ?? row.paymentId)}`
                                            : null;
                                    return (
                                        <tr key={row.id} className="hover:bg-slate-50/70">
                                            <td className="px-5 py-3 text-slate-600">
                                                <div className="flex items-center gap-2">
                                                    <span>{row.purchaseDate ? fmtDate(row.purchaseDate) : '-'}</span>
                                                    {row.rowSource !== 'PAYMENT' && <LedgerRowEditButton
                                                        canEdit={canEditLedger}
                                                        mode="PURCHASE"
                                                        rowId={row.id}
                                                        transactionDate={dateToInput(row.purchaseDate)}
                                                        productId={row.productId}
                                                        productName={row.productName}
                                                        quantity={row.quantity}
                                                        unit={row.unit}
                                                        unitPrice={row.unitPrice}
                                                        memo={row.memo}
                                                        products={products}
                                                    />}
                                                </div>
                                            </td>
                                            <td className="px-5 py-3 font-mono text-xs">{row.rowSource === 'PAYMENT' && financeHref ? (<Link href={financeHref} className="inline-flex rounded-full bg-green-50 px-2.5 py-1 font-semibold text-green-700 hover:bg-green-100 hover:text-green-900">{row.orderNo}</Link>) : row.rowSource === 'MANUAL' ? (<span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">✍️ 수동입력<ManualEntryDeleteButton ledgerEntryId={row.id.replace("ledger:", "")} /></span>) : row.orderId ? <Link href={`/admin/orders/${row.orderId}`} className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 font-semibold text-blue-700 hover:bg-blue-100 hover:text-blue-900">{row.orderNo}</Link> : <span className="text-slate-300">-</span>}</td>
                                            <td className="px-5 py-3 text-slate-700">
                                                <span className="font-medium">{row.productName}</span>
                                                {row.rowSource === 'PAYMENT' && (
                                                    <div className="mt-1 text-xs text-slate-400">
                                                        {row.noteNumber ? `어음번호 ${row.noteNumber}` : row.memo ?? '-'}
                                                        {row.noteMaturityDate ? ` / 만기 ${fmtDate(row.noteMaturityDate)}` : ''}
                                                        {row.noteIssuer ? ` / 발행인 ${row.noteIssuer}` : ''}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-5 py-3 text-right text-slate-700">{row.rowSource === 'PAYMENT' ? '-' : fmtNumber(row.quantity)}</td>
                                            <td className="px-5 py-3 text-right text-slate-700">{fmtAmount(row.unitPrice)}</td>
                                            <td className={`px-5 py-3 text-right ${row.rowSource === 'PAYMENT' ? 'font-medium text-green-700' : 'text-slate-700'}`}>{fmtAmount(row.supplyAmount)}</td>
                                            <td className="px-5 py-3 text-right text-slate-700">{fmtAmount(row.vatAmount)}</td>
                                            <td className={`px-5 py-3 text-right font-medium ${row.rowSource === 'PAYMENT' ? 'text-green-700' : 'text-slate-800'}`}>{fmtAmount(row.totalAmount)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr className="border-t border-slate-200 bg-slate-50 text-sm font-semibold text-slate-800">
                                    <td className="px-5 py-3" colSpan={3}>합계</td>
                                    <td className="px-5 py-3 text-right">{fmtNumber(ledger.totalQuantity)}</td>
                                    <td className="px-5 py-3 text-right text-slate-400">-</td>
                                    <td className="px-5 py-3 text-right">{fmtAmount(ledger.totalSupplyAmount)}</td>
                                    <td className="px-5 py-3 text-right">{fmtAmount(ledger.totalVatAmount)}</td>
                                    <td className="px-5 py-3 text-right">{fmtAmount(ledger.totalAmount)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </section>
                <div className="flex justify-end">
                    <Link href="/admin/ledger?tab=supplier" className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700">
                        <ArrowLeft size={14} /> 매입처원장 조회로 돌아가기
                    </Link>
                </div>
            </main>
        </div>
    );
}


