import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, BookOpen } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminSuppliersPage() {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const suppliers = await prisma.supplier.findMany({
        where: { isActive: true },
        select: {
            id: true,
            supplierName: true,
            contactPerson: true,
            phone: true,
            _count: { select: { ledgerEntries: true, orderItems: true } },
        },
        orderBy: { supplierName: 'asc' },
    });

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
                    <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> 대시보드</Link>
                    <span className="text-sm text-slate-500">{session.user.name}</span>
                </div>
            </header>
            <main className="mx-auto max-w-5xl p-6">
                <div className="mb-6 flex items-center gap-2">
                    <BookOpen className="text-blue-600" size={24} />
                    <h1 className="text-2xl font-bold text-slate-800">매입처 원장</h1>
                </div>
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
                            {suppliers.map((supplier) => (
                                <tr key={supplier.id}>
                                    <td className="px-5 py-3 font-medium text-slate-800">{supplier.supplierName}</td>
                                    <td className="px-5 py-3 text-slate-600">{supplier.contactPerson ?? '-'}</td>
                                    <td className="px-5 py-3 text-slate-600">{supplier.phone ?? '-'}</td>
                                    <td className="px-5 py-3 text-right text-slate-600">{supplier._count.ledgerEntries.toLocaleString('ko-KR')}</td>
                                    <td className="px-5 py-3 text-right text-slate-600">{supplier._count.orderItems.toLocaleString('ko-KR')}</td>
                                    <td className="px-5 py-3 text-right"><Link href={`/admin/suppliers/${supplier.id}/ledger`} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900">원장</Link></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            </main>
        </div>
    );
}