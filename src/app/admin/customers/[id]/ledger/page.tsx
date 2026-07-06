import { auth } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { defaultLedgerRange, getCustomerLedger, type CompanyLedger } from '@/lib/ledger';
import { fmtDate, fmtNumber } from '@/lib/orders';
import { prisma } from '@/lib/db';
import LedgerRangeForm from './LedgerRangeForm';
import ManualEntryDeleteButton from './ManualEntryDeleteButton';
import LedgerRowEditButton, { type LedgerProductOption } from '@/app/admin/ledger/LedgerRowEditButton';
import LedgerQuickAddForm from '@/app/admin/ledger/LedgerQuickAddForm';
import { canEditCustomerLedger, canViewAllStaffData } from '@/lib/staff-permissions';

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

function deltaClass(value: number | null) {
    if (value == null || value === 0) return 'text-slate-500';
    return value > 0 ? 'text-red-600' : 'text-blue-600';
}

function deltaText(value: number | null, suffix = '') {
    if (value == null) return '-';
    if (value === 0) return `변동없음${suffix}`;
    return `${value > 0 ? '▲' : '▼'} ${Math.abs(value).toLocaleString('ko-KR')}${suffix}`;
}

function LedgerTable({ ledger, customerId, canEdit, products }: { ledger: CompanyLedger; customerId: string; canEdit: boolean; products: LedgerProductOption[] }) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
                <div>
                    <h2 className="text-lg font-semibold text-slate-800">{ledger.companyName} 거래처원장</h2>
                    <p className="mt-1 text-xs text-slate-500">매출일자=원장 반영일 기준 · 변경 시 오더 도착일은 유지되고 이력에 기록됩니다.</p>
                </div>
                <LedgerQuickAddForm canEdit={canEdit} mode="SALES" customerId={customerId} companyEntityId={ledger.companyEntityId} products={products} />
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase">
                            <th className="px-5 py-3">매출일자</th>
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
                                ? `/admin/finance-transactions?txType=NOTE_IN&q=${encodeURIComponent(row.noteNumber)}`
                                : row.receiptId
                                    ? `/admin/finance-transactions?q=${encodeURIComponent(row.memo ?? row.receiptId)}`
                                    : null;
                            return (
                                <tr key={row.itemId} className="hover:bg-slate-50/70">
                                    <td className="px-5 py-3 text-slate-600">
                                        <div className="flex items-center gap-2">
                                            <span>{row.salesDate ? fmtDate(row.salesDate) : '-'}</span>
                                            {row.rowSource !== 'RECEIPT' && <LedgerRowEditButton
                                                canEdit={canEdit}
                                                mode="SALES"
                                                rowId={row.itemId}
                                                transactionDate={dateToInput(row.salesDate)}
                                                productId={row.productId && !row.productId.startsWith('IMPORTED:') ? row.productId : null}
                                                productName={row.productName}
                                                quantity={row.quantity}
                                                unit={row.unit}
                                                unitPrice={row.unitPrice}
                                                memo={row.memo}
                                                products={products}
                                            />}
                                        </div>
                                    </td>
                                    <td className="px-5 py-3 font-mono text-xs">
                                        {row.rowSource === 'RECEIPT' && financeHref ? (
                                            <Link href={financeHref} className="inline-flex rounded-full bg-green-50 px-2.5 py-1 font-semibold text-green-700 hover:bg-green-100 hover:text-green-900">
                                                {row.orderNo}
                                            </Link>
                                        ) : row.rowSource === 'MANUAL' ? (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">
                                                ✍️ 수동입력
                                                {canEdit && <ManualEntryDeleteButton ledgerEntryId={row.itemId.replace('ledger:', '')} />}
                                            </span>
                                        ) : row.orderId ? (
                                            <Link href={`/admin/orders/${row.orderId}`} className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 font-semibold text-blue-700 hover:bg-blue-100 hover:text-blue-900">
                                                {row.orderNo}
                                            </Link>
                                        ) : (
                                            <span className="text-slate-300">-</span>
                                        )}
                                    </td>
                                    <td className="px-5 py-3 text-slate-700">
                                        <span className="font-medium">{row.productName}</span>
                                        {row.rowSource === 'RECEIPT' && (
                                            <div className="mt-1 text-xs text-slate-400">
                                                {row.noteNumber ? `어음번호 ${row.noteNumber}` : row.memo ?? '-'}
                                                {row.noteMaturityDate ? ` / 만기 ${fmtDate(row.noteMaturityDate)}` : ''}
                                                {row.noteIssuer ? ` / 발행인 ${row.noteIssuer}` : ''}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-5 py-3 text-right text-slate-700">{row.rowSource === 'RECEIPT' ? '-' : fmtNumber(row.quantity)}</td>
                                    <td className="px-5 py-3 text-right text-slate-700">{fmtAmount(row.unitPrice)}</td>
                                    <td className={`px-5 py-3 text-right font-medium ${row.rowSource === 'RECEIPT' ? 'text-green-700' : 'text-slate-800'}`}>{fmtAmount(row.amount)}</td>
                                    <td className="px-5 py-3 text-right text-slate-700">{fmtAmount(row.vatAmount)}</td>
                                    <td className={`px-5 py-3 text-right font-semibold ${row.rowSource === 'RECEIPT' ? 'text-green-700' : 'text-slate-900'}`}>{fmtAmount(row.totalAmount)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                    {ledger.companyEntityId !== 'RECEIPTS' && <tfoot>
                        <tr className="border-t border-slate-200 bg-slate-50 text-sm font-semibold text-slate-800">
                            <td className="px-5 py-3" colSpan={3}>합계</td>
                            <td className="px-5 py-3 text-right">{fmtNumber(ledger.totalQuantity)}</td>
                            <td className="px-5 py-3 text-right text-slate-400">-</td>
                            <td className="px-5 py-3 text-right">{fmtAmount(ledger.totalAmount)}</td>
                            <td className="px-5 py-3 text-right">{fmtAmount(ledger.totalVatAmount)}</td>
                            <td className="px-5 py-3 text-right">{fmtAmount(ledger.totalWithVat)}</td>
                        </tr>
                    </tfoot>}
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
    const [ledger, products, currentUser, customerAccess] = await Promise.all([
        getCustomerLedger(id, sp.from || range.from, sp.to || range.to),
        prisma.product.findMany({
            where: { isActive: true },
            select: { id: true, productName: true, productCode: true },
            orderBy: [{ productName: 'asc' }],
        }),
        prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true, isActive: true } }),
        prisma.customer.findUnique({ where: { id }, select: { defaultSalesRepId: true } }),
    ]);
    if (!ledger) notFound();
    if (!canViewAllStaffData(session.user) && customerAccess?.defaultSalesRepId !== session.user.id) notFound();
    const canEditLedger = !!currentUser?.isActive && canEditCustomerLedger(currentUser);

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
                    <Link href="/admin/ledger?tab=customer" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> 거래처원장 조회</Link>
                    <span className="text-sm text-slate-500">{session.user.name}</span>
                </div>
            </header>
            <main className="mx-auto max-w-6xl space-y-6 p-6">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <div className="flex items-center gap-2"><BookOpen className="text-blue-600" size={24} /><h1 className="text-2xl font-bold text-slate-800">{ledger.customerName} 거래처원장</h1></div>
                        <p className="mt-1 text-sm text-slate-500">매출일자는 기본적으로 도착일자를 따르며, 필요 시 원장에서 오더 단위로 별도 변경합니다.</p>
                    </div>
                    <LedgerRangeForm from={ledger.from} to={ledger.to} />
                </div>
                <form action="/admin/ledger" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-3 sm:flex-row sm:items-end">
                    <input type="hidden" name="tab" value="customer" />
                    <div className="flex-1">
                        <label className="mb-1.5 block text-sm font-medium text-slate-700">다른 거래처 원장 조회</label>
                        <input
                            name="q"
                            placeholder="매출처/거래처명을 입력하세요"
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                    </div>
                    <button className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">조회</button>
                </form>
                {ledger.ledgers.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
                        <p>조회 기간 내 매출 원장 항목이 없습니다.</p>
                        <div className="mt-4 flex justify-center">
                            <LedgerQuickAddForm canEdit={canEditLedger} mode="SALES" customerId={ledger.customerId} products={products} />
                        </div>
                    </div>
                ) : ledger.ledgers.map((companyLedger) => (
                    <LedgerTable key={companyLedger.companyEntityId} ledger={companyLedger} customerId={ledger.customerId} canEdit={canEditLedger} products={products} />
                ))}

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
                <div className="flex justify-end">
                    <Link href="/admin/ledger?tab=customer" className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700">
                        <ArrowLeft size={14} /> 거래처원장 조회로 돌아가기
                    </Link>
                </div>
            </main>
        </div>
    );
}
