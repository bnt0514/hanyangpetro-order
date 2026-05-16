import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { prisma } from '@/lib/db';
import { fmtNumber } from '@/lib/orders';

export const dynamic = 'force-dynamic';

export default async function AdminLedgerPage({
    searchParams,
}: {
    searchParams: Promise<{ tab?: string; q?: string }>;
}) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const sp = await searchParams;
    const tab = sp.tab === 'supplier' ? 'supplier' : 'customer';
    const q = (sp.q ?? '').trim();
    const hasQuery = q.length > 0;

    const [customers, suppliers] = await Promise.all([
        hasQuery ? prisma.customer.findMany({
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
        }) : Promise.resolve([]),
        hasQuery ? prisma.supplier.findMany({
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
        }) : Promise.resolve([]),
    ]);

    const tabBase = (t: string) =>
        `/admin/ledger?tab=${t}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
                    <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
                        <ArrowLeft size={14} /> 대시보드
                    </Link>
                    <span className="text-sm text-slate-500">{session.user.name}</span>
                </div>
            </header>

            <main className="mx-auto max-w-6xl p-6 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                    <BookOpen className="text-teal-600" size={24} />
                    <h1 className="text-2xl font-bold text-slate-800">거래처 원장</h1>
                </div>

                <form className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-3 sm:flex-row sm:items-end">
                    <input type="hidden" name="tab" value={tab} />
                    <div className="flex-1">
                        <label className="mb-1.5 block text-sm font-medium text-slate-700">
                            업체명 검색
                        </label>
                        <input
                            name="q"
                            defaultValue={q}
                            placeholder={tab === 'supplier' ? '매입처명을 입력하세요' : '매출처/거래처명을 입력하세요'}
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                    </div>
                    <button className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
                        조회
                    </button>
                </form>

                {/* Tabs */}
                <div className="flex gap-2 border-b border-slate-200">
                    {[
                        { key: 'customer', label: '매출처 원장', count: customers.length },
                        { key: 'supplier', label: '매입처 원장', count: suppliers.length },
                    ].map((t) => (
                        <Link
                            key={t.key}
                            href={tabBase(t.key)}
                            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition -mb-px ${tab === t.key
                                ? 'border-blue-600 text-blue-700'
                                : 'border-transparent text-slate-500 hover:text-slate-800'
                                }`}
                        >
                            {t.label}
                            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500">
                                {hasQuery ? t.count : '-'}
                            </span>
                        </Link>
                    ))}
                </div>

                {/* Customer ledger list */}
                {tab === 'customer' && (
                    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
                                    <th className="px-5 py-3">거래처명</th>
                                    <th className="px-5 py-3">코드</th>
                                    <th className="px-5 py-3">담당자</th>
                                    <th className="px-5 py-3 text-right">원장건수</th>
                                    <th className="px-5 py-3 text-right">바로가기</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {!hasQuery && (
                                    <tr>
                                        <td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-400">업체명을 입력해서 원장을 조회하세요.</td>
                                    </tr>
                                )}
                                {hasQuery && customers.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-400">검색 결과가 없습니다.</td>
                                    </tr>
                                )}
                                {customers.map((c) => (
                                    <tr key={c.id} className="hover:bg-slate-50">
                                        <td className="px-5 py-3 font-medium text-slate-800">{c.companyName}</td>
                                        <td className="px-5 py-3 font-mono text-xs text-slate-500">{c.customerCode}</td>
                                        <td className="px-5 py-3 text-slate-600">{c.defaultSalesRep?.name ?? '-'}</td>
                                        <td className="px-5 py-3 text-right text-slate-600">{fmtNumber(c._count.ledgerEntries)}</td>
                                        <td className="px-5 py-3 text-right">
                                            <Link
                                                href={`/admin/customers/${c.id}/ledger`}
                                                className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
                                            >
                                                원장
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>
                )}

                {/* Supplier ledger list */}
                {tab === 'supplier' && (
                    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
                                    <th className="px-5 py-3">매입처</th>
                                    <th className="px-5 py-3">담당자</th>
                                    <th className="px-5 py-3">연락처</th>
                                    <th className="px-5 py-3 text-right">원장건수</th>
                                    <th className="px-5 py-3 text-right">주문품목</th>
                                    <th className="px-5 py-3 text-right">바로가기</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {!hasQuery && (
                                    <tr>
                                        <td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-400">업체명을 입력해서 원장을 조회하세요.</td>
                                    </tr>
                                )}
                                {hasQuery && suppliers.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-400">검색 결과가 없습니다.</td>
                                    </tr>
                                )}
                                {suppliers.map((s) => (
                                    <tr key={s.id} className="hover:bg-slate-50">
                                        <td className="px-5 py-3 font-medium text-slate-800">{s.supplierName}</td>
                                        <td className="px-5 py-3 text-slate-600">{s.contactPerson ?? '-'}</td>
                                        <td className="px-5 py-3 text-slate-600">{s.phone ?? '-'}</td>
                                        <td className="px-5 py-3 text-right text-slate-600">{fmtNumber(s._count.ledgerEntries)}</td>
                                        <td className="px-5 py-3 text-right text-slate-600">{fmtNumber(s._count.orderItems)}</td>
                                        <td className="px-5 py-3 text-right">
                                            <Link
                                                href={`/admin/suppliers/${s.id}/ledger`}
                                                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"
                                            >
                                                원장
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>
                )}
            </main>
        </div>
    );
}
