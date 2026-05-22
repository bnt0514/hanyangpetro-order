import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { prisma } from '@/lib/db';
import { fmtDate, fmtNumber } from '@/lib/orders';
import { defaultLedgerRange, getCustomerLedger, type CustomerLedgerResult } from '@/lib/ledger';
import { getSupplierLedger, type SupplierLedgerResult } from '@/lib/supplier-ledger';
import LedgerPopupButtons from './LedgerPopupButtons';

export const dynamic = 'force-dynamic';

type Search = {
    q?: string;
    tab?: string;
    customerQ?: string;
    supplierQ?: string;
    customerId?: string;
    supplierId?: string;
    view?: string;
    from?: string;
    to?: string;
};

type CompanyResult = {
    key: string;
    label: string;
    customer?: {
        id: string;
        companyName: string;
        customerCode: string | null;
        salesRepName: string | null;
        ledgerCount: number;
    };
    supplier?: {
        id: string;
        supplierName: string;
        contactPerson: string | null;
        phone: string | null;
        ledgerCount: number;
        orderItemCount: number;
    };
};

async function findCustomers(q: string) {
    if (!q) return [];
    return prisma.customer.findMany({
        where: { isActive: true, companyName: { contains: q } },
        select: {
            id: true,
            companyName: true,
            customerCode: true,
            defaultSalesRep: { select: { name: true } },
            _count: { select: { ledgerEntries: true } },
        },
        orderBy: { companyName: 'asc' },
        take: 50,
    });
}

async function findSuppliers(q: string) {
    if (!q) return [];
    return prisma.supplier.findMany({
        where: { isActive: true, supplierName: { contains: q } },
        select: {
            id: true,
            supplierName: true,
            contactPerson: true,
            phone: true,
            _count: { select: { ledgerEntries: true, orderItems: true } },
        },
        orderBy: { supplierName: 'asc' },
        take: 50,
    });
}

function fmtMoney(value: number | null | undefined) {
    if (value == null) return '-';
    return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function pad(n: number) { return String(n).padStart(2, '0'); }

function dateToIso(date: Date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function calcRanges(today = new Date()) {
    const y = today.getFullYear();
    const m = today.getMonth() + 1;
    const todayStr = dateToIso(today);
    const thisFrom = `${y}-${pad(m)}-01`;
    const prevY = m === 1 ? y - 1 : y;
    const prevM = m === 1 ? 12 : m - 1;
    const prevFrom = `${prevY}-${pad(prevM)}-01`;
    const prevTo = `${prevY}-${pad(prevM)}-${pad(new Date(prevY, prevM, 0).getDate())}`;
    const r3M = m - 2;
    const r3Y = r3M <= 0 ? y - 1 : y;
    const r3MAdj = r3M <= 0 ? 12 + r3M : r3M;
    return {
        recent3: { label: '최근 3개월', from: `${r3Y}-${pad(r3MAdj)}-01`, to: todayStr },
        prev: { label: '전월', from: prevFrom, to: prevTo },
        current: { label: '당월', from: thisFrom, to: todayStr },
    };
}

function normalizeCompanyName(value: string) {
    return value
        .toLowerCase()
        .replace(/주식\s*회사/g, '')
        .replace(/\(주\)|㈜|\(유\)|\(사\)|\(합\)|\(재\)/g, '')
        .replace(/[\s()[\]{}<>,.·•\-_\/\\]+/g, '')
        .trim();
}

function buildLedgerHref(params: Record<string, string | undefined>) {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value) sp.set(key, value);
    }
    return `/admin/ledger?${sp.toString()}`;
}

function mergeCompanyResults(customers: Awaited<ReturnType<typeof findCustomers>>, suppliers: Awaited<ReturnType<typeof findSuppliers>>) {
    const map = new Map<string, CompanyResult>();
    const customerKeysByNormalizedName = new Map<string, string[]>();

    for (const customer of customers) {
        const normalizedName = normalizeCompanyName(customer.companyName);
        const key = `customer:${customer.id}`;
        const current = map.get(key) ?? { key, label: customer.companyName };
        current.label = customer.companyName;
        current.customer = {
            id: customer.id,
            companyName: customer.companyName,
            customerCode: customer.customerCode,
            salesRepName: customer.defaultSalesRep?.name ?? null,
            ledgerCount: customer._count.ledgerEntries,
        };
        map.set(key, current);

        if (normalizedName) {
            const keys = customerKeysByNormalizedName.get(normalizedName) ?? [];
            keys.push(key);
            customerKeysByNormalizedName.set(normalizedName, keys);
        }
    }

    for (const supplier of suppliers) {
        const normalizedName = normalizeCompanyName(supplier.supplierName);
        const matchedCustomerKeys = normalizedName ? customerKeysByNormalizedName.get(normalizedName) : undefined;
        const key = matchedCustomerKeys?.length === 1 ? matchedCustomerKeys[0] : `supplier:${supplier.id}`;
        const current = map.get(key) ?? { key, label: supplier.supplierName };
        if (!current.customer) current.label = supplier.supplierName;
        current.supplier = {
            id: supplier.id,
            supplierName: supplier.supplierName,
            contactPerson: supplier.contactPerson,
            phone: supplier.phone,
            ledgerCount: supplier._count.ledgerEntries,
            orderItemCount: supplier._count.orderItems,
        };
        map.set(key, current);
    }

    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'ko'));
}

function resultLinks(result: CompanyResult, q: string, from: string, to: string) {
    const base = { q, from, to };
    return {
        all: buildLedgerHref({ ...base, customerId: result.customer?.id, supplierId: result.supplier?.id, view: 'all' }),
        compare: buildLedgerHref({ ...base, customerId: result.customer?.id, supplierId: result.supplier?.id, view: 'compare' }),
        sales: result.customer ? buildLedgerHref({ ...base, customerId: result.customer.id, view: 'sales' }) : undefined,
        purchase: result.supplier ? buildLedgerHref({ ...base, supplierId: result.supplier.id, view: 'purchase' }) : undefined,
    };
}

function SearchBox({ q, from, to, customerId, supplierId, view }: { q: string; from: string; to: string; customerId?: string; supplierId?: string; view: string }) {
    const ranges = calcRanges();
    const rangeHref = (range: { from: string; to: string }) => buildLedgerHref({ q, from: range.from, to: range.to, customerId, supplierId, view });
    const isActive = (range: { from: string; to: string }) => from === range.from && to === range.to;

    return (
        <form className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-64 flex-1 md:flex-none md:w-80">
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">거래처명 통합 조회</label>
                    <input name="q" defaultValue={q} placeholder="매출처/매입처명을 입력하세요" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                </div>
                <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-500">조회 시작</label>
                    <input name="from" type="date" defaultValue={from} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
                </div>
                <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-500">조회 종료</label>
                    <input name="to" type="date" defaultValue={to} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
                </div>
                <button className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">조회</button>
                <div className="flex flex-wrap gap-1.5 pl-0 md:pl-2">
                    {[ranges.recent3, ranges.prev, ranges.current].map((range) => (
                        <Link
                            key={range.label}
                            href={rangeHref(range)}
                            className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${isActive(range) ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                            {range.label}
                        </Link>
                    ))}
                </div>
            </div>
        </form>
    );
}

function CompanyResultList({ results, q, from, to }: { results: CompanyResult[]; q: string; from: string; to: string }) {
    if (!q) return <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-400">거래처명을 입력하면 매출/매입 거래처를 함께 조회합니다.</div>;
    if (results.length === 0) return <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-400">검색 결과가 없습니다.</div>;

    return (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <h2 className="text-sm font-bold text-slate-800">조회된 거래처</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{results.length}건</span>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
                            <th className="px-5 py-3">거래처</th>
                            <th className="px-5 py-3">구분</th>
                            <th className="px-5 py-3">매출처 정보</th>
                            <th className="px-5 py-3">매입처 정보</th>
                            <th className="px-5 py-3 text-right">보기</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {results.map((result) => {
                            const links = resultLinks(result, q, from, to);
                            return (
                                <tr key={result.key} className="hover:bg-slate-50">
                                    <td className="px-5 py-3 font-semibold text-slate-800">{result.label}</td>
                                    <td className="px-5 py-3">
                                        <div className="flex flex-wrap gap-1.5">
                                            {result.customer && <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">매출</span>}
                                            {result.supplier && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700">매입</span>}
                                        </div>
                                    </td>
                                    <td className="px-5 py-3 text-slate-600">{result.customer ? `${result.customer.customerCode ?? '-'} · ${result.customer.salesRepName ?? '담당자 없음'}` : '-'}</td>
                                    <td className="px-5 py-3 text-slate-600">{result.supplier ? `${result.supplier.contactPerson ?? '담당자 없음'} · 품목 ${fmtNumber(result.supplier.orderItemCount)}` : '-'}</td>
                                    <td className="px-5 py-3 text-right">
                                        <div className="flex flex-wrap justify-end gap-1.5">
                                            <Link href={links.all} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">전체</Link>
                                            {links.sales && <Link href={links.sales} className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800">매출</Link>}
                                            {links.purchase && <Link href={links.purchase} className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-800">매입</Link>}
                                            {result.customer && result.supplier && <Link href={links.compare} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">좌우비교</Link>}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function CustomerLedgerPanel({ ledger }: { ledger: CustomerLedgerResult }) {
    const salesTotal = ledger.ledgers.reduce((sum, item) => sum + item.totalAmount, 0);
    return (
        <section className="overflow-hidden rounded-2xl border border-teal-100 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-teal-50 px-5 py-3">
                <div>
                    <h2 className="font-bold text-teal-800">매출 원장 · {ledger.customerName}</h2>
                    <p className="mt-0.5 text-xs text-slate-500">{ledger.from} ~ {ledger.to}</p>
                </div>
                <LedgerPopupButtons mode="sales" salesHref={`/admin/customers/${ledger.customerId}/ledger?from=${ledger.from}&to=${ledger.to}`} />
            </div>
            <div className="grid grid-cols-2 gap-3 border-b border-teal-50 bg-teal-50/40 p-4 text-sm md:grid-cols-4">
                <div><p className="text-xs text-slate-500">기간 매출 합계</p><p className="font-bold text-slate-800">{fmtMoney(salesTotal)}</p></div>
                <div><p className="text-xs text-slate-500">기간 수금 합계</p><p className="font-bold text-green-700">{fmtMoney(ledger.periodReceiptTotal)}</p></div>
                <div><p className="text-xs text-slate-500">기초 미수금</p><p className="font-bold text-slate-800">{fmtMoney(ledger.openingReceivable)}</p></div>
                <div><p className="text-xs text-slate-500">현재 미수금</p><p className="font-bold text-orange-700">{fmtMoney(ledger.netReceivable)}</p></div>
            </div>
            <div className="max-h-[520px] overflow-auto">
                {ledger.ledgers.length === 0 ? <div className="p-10 text-center text-sm text-slate-400">조회 기간 내 매출 원장 항목이 없습니다.</div> : ledger.ledgers.map((companyLedger) => (
                    <table key={companyLedger.companyEntityId} className="w-full min-w-[980px] text-sm">
                        <caption className="bg-white px-4 py-2 text-left text-sm font-semibold text-slate-700">{companyLedger.companyName}</caption>
                        <thead className="sticky top-0 bg-slate-50 text-left text-xs font-medium uppercase text-slate-500"><tr><th className="px-4 py-2">매출일자</th><th className="px-4 py-2">오더</th><th className="px-4 py-2">품목</th><th className="px-4 py-2 text-right">수량(TON)</th><th className="px-4 py-2 text-right">단가</th><th className="px-4 py-2 text-right">공급가액</th><th className="px-4 py-2 text-right">부가세</th><th className="px-4 py-2 text-right">합계</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                            {companyLedger.rows.map((row) => (
                                <tr key={row.itemId}><td className="px-4 py-2 text-slate-600">{fmtDate(row.salesDate)}</td><td className="px-4 py-2 font-mono text-xs text-blue-700">{row.orderNo || '-'}</td><td className="px-4 py-2 text-slate-700">{row.productName}</td><td className="px-4 py-2 text-right text-slate-600">{fmtNumber(row.quantity)}</td><td className="px-4 py-2 text-right text-slate-600">{fmtMoney(row.unitPrice)}</td><td className="px-4 py-2 text-right font-medium text-slate-800">{fmtMoney(row.amount)}</td><td className="px-4 py-2 text-right text-slate-600">{fmtMoney(row.vatAmount)}</td><td className="px-4 py-2 text-right font-semibold text-slate-900">{fmtMoney(row.totalAmount)}</td></tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-slate-50 font-semibold text-slate-800"><tr><td className="px-4 py-2" colSpan={3}>합계</td><td className="px-4 py-2 text-right">{fmtNumber(companyLedger.totalQuantity)}</td><td className="px-4 py-2 text-right text-slate-400">-</td><td className="px-4 py-2 text-right">{fmtMoney(companyLedger.totalAmount)}</td><td className="px-4 py-2 text-right">{fmtMoney(companyLedger.totalVatAmount)}</td><td className="px-4 py-2 text-right">{fmtMoney(companyLedger.totalWithVat)}</td></tr></tfoot>
                    </table>
                ))}
            </div>
            {ledger.receipts.length > 0 && <div className="border-t border-teal-50 p-4 text-xs text-slate-600">수금 내역 {ledger.receipts.length}건 · 기간 수금 합계 {fmtMoney(ledger.periodReceiptTotal)}</div>}
        </section>
    );
}

function SupplierLedgerPanel({ ledger }: { ledger: SupplierLedgerResult }) {
    return (
        <section className="overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-violet-50 px-5 py-3">
                <div>
                    <h2 className="font-bold text-violet-800">매입 원장 · {ledger.supplierName}</h2>
                    <p className="mt-0.5 text-xs text-slate-500">{ledger.from} ~ {ledger.to}</p>
                </div>
                <LedgerPopupButtons mode="purchase" purchaseHref={`/admin/suppliers/${ledger.supplierId}/ledger?from=${ledger.from}&to=${ledger.to}`} />
            </div>
            <div className="grid grid-cols-2 gap-3 border-b border-violet-50 bg-violet-50/40 p-4 text-sm md:grid-cols-4">
                <div><p className="text-xs text-slate-500">기간 매입 합계</p><p className="font-bold text-slate-800">{fmtMoney(ledger.totalSupplyAmount)}</p></div>
                <div><p className="text-xs text-slate-500">기간 지급 합계</p><p className="font-bold text-green-700">{fmtMoney(ledger.periodPaymentTotal)}</p></div>
                <div><p className="text-xs text-slate-500">기초 미지급금</p><p className="font-bold text-slate-800">{fmtMoney(ledger.openingPayable)}</p></div>
                <div><p className="text-xs text-slate-500">현재 미지급금</p><p className="font-bold text-orange-700">{fmtMoney(ledger.netPayable)}</p></div>
            </div>
            <div className="max-h-[520px] overflow-auto">
                {ledger.rows.length === 0 ? <div className="p-10 text-center text-sm text-slate-400">조회 기간 내 매입 원장 항목이 없습니다.</div> : (
                    <table className="w-full min-w-[980px] text-sm">
                        <thead className="sticky top-0 bg-slate-50 text-left text-xs font-medium uppercase text-slate-500"><tr><th className="px-4 py-2">매입일자</th><th className="px-4 py-2">오더</th><th className="px-4 py-2">품목</th><th className="px-4 py-2 text-right">수량(TON)</th><th className="px-4 py-2 text-right">단가</th><th className="px-4 py-2 text-right">공급가액</th><th className="px-4 py-2 text-right">부가세</th><th className="px-4 py-2 text-right">합계</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                            {ledger.rows.map((row) => (
                                <tr key={row.id}><td className="px-4 py-2 text-slate-600">{fmtDate(row.purchaseDate)}</td><td className="px-4 py-2 font-mono text-xs text-blue-700">{row.orderNo || '-'}</td><td className="px-4 py-2 text-slate-700">{row.productName}</td><td className="px-4 py-2 text-right text-slate-600">{fmtNumber(row.quantity)}</td><td className="px-4 py-2 text-right text-slate-600">{fmtMoney(row.unitPrice)}</td><td className="px-4 py-2 text-right font-medium text-slate-800">{fmtMoney(row.supplyAmount)}</td><td className="px-4 py-2 text-right text-slate-600">{fmtMoney(row.vatAmount)}</td><td className="px-4 py-2 text-right font-semibold text-slate-900">{fmtMoney(row.totalAmount)}</td></tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-slate-50 font-semibold text-slate-800"><tr><td className="px-4 py-2" colSpan={3}>합계</td><td className="px-4 py-2 text-right">{fmtNumber(ledger.totalQuantity)}</td><td className="px-4 py-2 text-right text-slate-400">-</td><td className="px-4 py-2 text-right">{fmtMoney(ledger.totalSupplyAmount)}</td><td className="px-4 py-2 text-right">{fmtMoney(ledger.totalVatAmount)}</td><td className="px-4 py-2 text-right">{fmtMoney(ledger.totalAmount)}</td></tr></tfoot>
                    </table>
                )}
            </div>
            {ledger.payments.length > 0 && <div className="border-t border-violet-50 p-4 text-xs text-slate-600">지급 내역 {ledger.payments.length}건 · 기간 지급 합계 {fmtMoney(ledger.periodPaymentTotal)}</div>}
        </section>
    );
}

export default async function AdminLedgerPage({ searchParams }: { searchParams: Promise<Search> }) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const sp = await searchParams;
    const q = (sp.q ?? sp.customerQ ?? sp.supplierQ ?? '').trim();
    const range = defaultLedgerRange();
    const from = sp.from || range.from;
    const to = sp.to || range.to;
    const view = sp.view === 'sales' || sp.view === 'purchase' || sp.view === 'compare' ? sp.view : 'all';

    const [customers, suppliers] = await Promise.all([findCustomers(q), findSuppliers(q)]);
    const results = mergeCompanyResults(customers, suppliers);

    if (q && !sp.customerId && !sp.supplierId && results.length === 1) {
        redirect(resultLinks(results[0], q, from, to).all);
    }

    const [customerLedger, supplierLedger] = await Promise.all([
        sp.customerId && view !== 'purchase' ? getCustomerLedger(sp.customerId, from, to) : Promise.resolve(null),
        sp.supplierId && view !== 'sales' ? getSupplierLedger(sp.supplierId, from, to) : Promise.resolve(null),
    ]);

    const showLedger = customerLedger || supplierLedger;
    const split = view === 'compare' && customerLedger && supplierLedger;
    const salesPopupHref = customerLedger ? `/admin/customers/${customerLedger.customerId}/ledger?from=${from}&to=${to}` : undefined;
    const purchasePopupHref = supplierLedger ? `/admin/suppliers/${supplierLedger.supplierId}/ledger?from=${from}&to=${to}` : undefined;

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
                    <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> 대시보드</Link>
                    <span className="text-sm text-slate-500">{session.user.name}</span>
                </div>
            </header>
            <main className="mx-auto max-w-7xl space-y-4 p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <BookOpen className="text-slate-700" size={24} />
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800">거래처 원장 통합 조회</h1>
                            <p className="mt-1 text-sm text-slate-500">거래처명 하나로 매출/매입 원장을 함께 찾고, 전체·매출·매입·좌우비교로 확인합니다.</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {salesPopupHref && purchasePopupHref && <LedgerPopupButtons mode="compare" salesHref={salesPopupHref} purchaseHref={purchasePopupHref} />}
                        {showLedger && <Link href={buildLedgerHref({ q, from, to })} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white">검색 결과로 돌아가기</Link>}
                    </div>
                </div>

                <SearchBox q={q} from={from} to={to} customerId={sp.customerId} supplierId={sp.supplierId} view={view} />

                {showLedger ? (
                    <div className={split ? 'grid items-start gap-4 xl:grid-cols-2' : 'space-y-4'}>
                        {customerLedger && <CustomerLedgerPanel ledger={customerLedger} />}
                        {supplierLedger && <SupplierLedgerPanel ledger={supplierLedger} />}
                    </div>
                ) : <CompanyResultList results={results} q={q} from={from} to={to} />}
            </main>
        </div>
    );
}
