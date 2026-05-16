import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Building2, Plus, BookOpen } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string }>;
}) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const { q = '' } = await searchParams;
    const query = q.trim();
    const customers = await prisma.customer.findMany({
        where: query
            ? {
                OR: [
                    { companyName: { contains: query } },
                    { customerCode: { contains: query } },
                    { businessNumber: { contains: query } },
                ],
            }
            : undefined,
        orderBy: [{ isActive: 'desc' }, { companyName: 'asc' }],
        include: { _count: { select: { addresses: true, orders: true } } },
        take: 300,
    });

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="bg-white border-b border-slate-200">
                <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/admin" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
                        <ArrowLeft size={14} /> 대시보드
                    </Link>
                    <Link
                        href="/admin/customers/new"
                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                    >
                        <Plus size={16} /> 신규 등록
                    </Link>
                    <Link
                        href="/admin/customers/import"
                        className="inline-flex items-center gap-2 rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                    >
                        도착지 가져오기
                    </Link>
                </div>
            </header>

            <main className="max-w-5xl mx-auto p-6 space-y-5">
                <div className="flex items-end justify-between gap-3 flex-wrap">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                            <Building2 size={24} /> 업체 관리
                        </h1>
                        <p className="mt-1 text-sm text-slate-500">업체 정보와 등록된 도착지를 수정합니다.</p>
                    </div>
                    <form className="flex items-center gap-2">
                        <input
                            name="q"
                            defaultValue={query}
                            placeholder="업체명/코드/사업자번호 검색"
                            className="w-72 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        />
                        <button className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900">
                            검색
                        </button>
                    </form>
                </div>

                <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase">
                                <th className="px-5 py-3">업체명</th>
                                <th className="px-5 py-3">거래처코드</th>
                                <th className="px-5 py-3">사업자번호</th>
                                <th className="px-5 py-3 text-right">도착지</th>
                                <th className="px-5 py-3 text-right">주문</th>
                                <th className="px-5 py-3">상태</th>
                                <th className="px-5 py-3 text-right">관리</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {customers.map((customer) => (
                                <tr key={customer.id} className="hover:bg-blue-50/40">
                                    <td className="px-5 py-3 font-semibold text-slate-800">{customer.companyName}</td>
                                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{customer.customerCode}</td>
                                    <td className="px-5 py-3 text-slate-500">{customer.businessNumber ?? '-'}</td>
                                    <td className="px-5 py-3 text-right text-slate-700">{customer._count.addresses}</td>
                                    <td className="px-5 py-3 text-right text-slate-500">{customer._count.orders}</td>
                                    <td className="px-5 py-3">
                                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${customer.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                            {customer.isActive ? '사용중' : '중지'}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-right space-x-1">
                                        <Link
                                            href={`/admin/customers/${customer.id}/ledger`}
                                            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                                        >
                                            <BookOpen size={12} /> 원장
                                        </Link>
                                        <Link
                                            href={`/admin/customers/${customer.id}`}
                                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                        >
                                            수정
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                            {customers.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-400">
                                        검색 결과가 없습니다.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </section>
            </main>
        </div>
    );
}