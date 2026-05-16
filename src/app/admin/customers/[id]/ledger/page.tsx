import { auth } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { prisma } from '@/lib/db';
import { defaultLedgerRange, getCustomerLedger, type CompanyLedger, type ReceiptRow } from '@/lib/ledger';
import { fmtDate, fmtNumber } from '@/lib/orders';
import LedgerRowEditor from './LedgerRowEditor';

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

function LedgerTable({ ledger, canEdit, products }: { ledger: CompanyLedger; canEdit: boolean; products: { id: string; productName: string; productCode: string }[] }) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
                <div>
                    <h2 className="text-lg font-semibold text-slate-800">{ledger.companyName} 거래처원장</h2>
                    <p className="mt-1 text-xs text-slate-500">매출일자 기준 · 총 수량 {fmtNumber(ledger.totalQuantity)}TON · 총 금액 {fmtMoney(ledger.totalAmount)}</p>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase">
                            <th className="px-5 py-3">매출일자</th>
                            <th className="px-5 py-3">오더</th>
                            <th className="px-5 py-3">품목</th>
                            <th className="px-5 py-3 text-right">수량</th>
                            <th className="px-5 py-3 text-right">단가</th>
                            <th className="px-5 py-3 text-right">금액</th>
                            <th className="px-5 py-3">비고</th>
                            {canEdit && <th className="px-5 py-3">양희철 수정</th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {ledger.rows.map((row) => (
                            <tr key={row.itemId}>
                                <td className="px-5 py-3 text-slate-600">{fmtDate(row.salesDate)}</td>
                                <td className="px-5 py-3 font-mono text-xs">
                                    {row.orderId ? (
                                        <Link href={`/admin/orders/${row.orderId}`} className="text-blue-700">{row.orderNo}</Link>
                                    ) : (
                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{row.orderNo}</span>
                                    )}
                                </td>
                                <td className="px-5 py-3 text-slate-700"><span className="font-medium">{row.productName}</span><span className="ml-2 text-xs text-slate-400 font-mono">{row.productCode}</span></td>
                                <td className="px-5 py-3 text-right text-slate-700">{fmtNumber(row.quantity)} {row.unit}</td>
                                <td className="px-5 py-3 text-right text-slate-700">{fmtMoney(row.unitPrice)}</td>
                                <td className="px-5 py-3 text-right font-medium text-slate-800">{fmtMoney(row.amount)}</td>
                                <td className="px-5 py-3 text-slate-500">{row.memo ?? '-'}</td>
                                {canEdit && row.rowSource === 'ORDER' && (
                                    <td className="px-5 py-3">
                                        <LedgerRowEditor
                                            itemId={row.itemId}
                                            salesDate={row.salesDate ? fmtDate(row.salesDate) : ''}
                                            productId={row.productId}
                                            quantity={row.quantity}
                                            unitPrice={row.unitPrice}
                                            memo={row.memo}
                                            products={products}
                                        />
                                    </td>
                                )}
                                {canEdit && row.rowSource === 'IMPORT' && (
                                    <td className="px-5 py-3 text-xs text-slate-400">이관자료</td>
                                )}
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

export default async function AdminCustomerLedgerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const [{ id }, sp] = await Promise.all([params, searchParams]);
    const range = defaultLedgerRange();
    const ledger = await getCustomerLedger(id, sp.from || range.from, sp.to || range.to);
    if (!ledger) notFound();

    const products = await prisma.product.findMany({
        where: { isActive: true },
        select: { id: true, productName: true, productCode: true },
        orderBy: { productName: 'asc' },
    });
    const canEdit = session.user.name === '양희철';

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
                    <Link href={`/admin/customers/${ledger.customerId}`} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> 거래처 상세</Link>
                    <span className="text-sm text-slate-500">{session.user.name}</span>
                </div>
            </header>
            <main className="mx-auto max-w-6xl space-y-6 p-6">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <div className="flex items-center gap-2"><BookOpen className="text-blue-600" size={24} /><h1 className="text-2xl font-bold text-slate-800">{ledger.customerName} 거래처원장</h1></div>
                        <p className="mt-1 text-sm text-slate-500">매출일자=도착일자 기준. 도착일 수정 시 원장도 즉시 바뀝니다.</p>
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
                ) : ledger.ledgers.map((companyLedger) => (
                    <LedgerTable key={companyLedger.companyEntityId} ledger={companyLedger} canEdit={canEdit} products={products} />
                ))}

                {/* 수금 내역 */}
                {ledger.receipts.length > 0 && (
                    <section className="rounded-2xl border border-green-200 bg-white shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between gap-3 border-b border-green-100 px-6 py-4 bg-green-50">
                            <div>
                                <h2 className="text-lg font-semibold text-green-800">수금 내역</h2>
                                <p className="mt-1 text-xs text-green-600">기간 내 입금 합계: {fmtMoney(ledger.periodReceiptTotal)}</p>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase">
                                        <th className="px-5 py-3">입금일자</th>
                                        <th className="px-5 py-3 text-right">금액</th>
                                        <th className="px-5 py-3">비고</th>
                                        <th className="px-5 py-3">출처</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {ledger.receipts.map((r: ReceiptRow) => (
                                        <tr key={r.id}>
                                            <td className="px-5 py-3 text-slate-600">{fmtDate(r.txDate)}</td>
                                            <td className="px-5 py-3 text-right font-medium text-green-700">{fmtMoney(r.amount)}</td>
                                            <td className="px-5 py-3 text-slate-500">{r.memo ?? '-'}</td>
                                            <td className="px-5 py-3 text-xs text-slate-400">{r.source}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                )}

                {/* 미수금 잔액 */}
                <section className="rounded-2xl border border-slate-200 bg-white shadow-sm px-6 py-5">
                    <h2 className="text-base font-semibold text-slate-700 mb-4">미수금 잔액 현황</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div className="rounded-xl bg-slate-50 p-4">
                            <p className="text-xs text-slate-500">기초 미수금</p>
                            <p className="mt-1 text-lg font-bold text-slate-800">{fmtMoney(ledger.openingReceivable)}</p>
                            <p className="text-xs text-slate-400">{ledger.openingReceivableDate ? `기준일: ${fmtDate(ledger.openingReceivableDate)}` : '기준일 없음'}</p>
                        </div>
                        <div className="rounded-xl bg-blue-50 p-4">
                            <p className="text-xs text-blue-600">기간 매출 합계</p>
                            <p className="mt-1 text-lg font-bold text-blue-800">{fmtMoney(ledger.ledgers.reduce((s, l) => s + l.totalAmount, 0))}</p>
                        </div>
                        <div className="rounded-xl bg-green-50 p-4">
                            <p className="text-xs text-green-600">기간 수금 합계</p>
                            <p className="mt-1 text-lg font-bold text-green-800">{fmtMoney(ledger.periodReceiptTotal)}</p>
                        </div>
                        <div className={`rounded-xl p-4 ${ledger.netReceivable > 0 ? 'bg-orange-50' : 'bg-slate-50'}`}>
                            <p className="text-xs text-slate-500">현재 미수금 잔액</p>
                            <p className={`mt-1 text-lg font-bold ${ledger.netReceivable > 0 ? 'text-orange-700' : 'text-slate-700'}`}>{fmtMoney(ledger.netReceivable)}</p>
                            <p className="text-xs text-slate-400">기초 + 매출 - 수금</p>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
}
