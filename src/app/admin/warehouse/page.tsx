import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getWarehouseStock } from '@/lib/warehouse-stock';
import { fmtNumber } from '@/lib/orders';
import { ArrowLeft, Warehouse } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function WarehousePage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const sp = await searchParams;
    const companies = await prisma.companyEntity.findMany({
        where: { isActive: true },
        select: { id: true, code: true, displayName: true },
        orderBy: { displayName: 'asc' },
    });
    const selectedCompany = companies.find((company) => company.id === sp.company) ?? companies.find((company) => company.code === 'HANYANG_PETRO') ?? companies[0];
    const rows = selectedCompany ? await getWarehouseStock(selectedCompany.id) : [];
    const totalQuantity = rows.reduce((sum, row) => sum + row.currentQuantity, 0);

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
            <main className="mx-auto max-w-6xl space-y-5 p-6">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <div className="flex items-center gap-2">
                            <Warehouse className="text-blue-600" size={24} />
                            <h1 className="text-2xl font-bold text-slate-800">창고 재고</h1>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">회사별 장부/재고를 분리해 관리합니다. 창고 오더만 입출고에 반영됩니다.</p>
                    </div>
                    <div className="rounded-2xl border border-blue-100 bg-blue-50 px-5 py-3 text-right">
                        <p className="text-xs font-medium text-blue-600">현재 총 재고</p>
                        <p className="text-2xl font-bold text-blue-800">{fmtNumber(totalQuantity)} TON</p>
                    </div>
                </div>

                <div className="flex gap-2 border-b border-slate-200">
                    {companies.map((company) => (
                        <Link
                            key={company.id}
                            href={`/admin/warehouse?company=${company.id}`}
                            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px ${selectedCompany?.id === company.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                        >
                            {company.displayName}
                        </Link>
                    ))}
                </div>

                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
                                <th className="px-5 py-3">품명</th>
                                <th className="px-5 py-3 text-right">기준재고</th>
                                <th className="px-5 py-3 text-right">입고</th>
                                <th className="px-5 py-3 text-right">출고</th>
                                <th className="px-5 py-3 text-right">현재고</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {rows.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-400">등록된 기준 재고가 없습니다.</td>
                                </tr>
                            ) : rows.map((row) => (
                                <tr key={row.productKey} className="hover:bg-slate-50">
                                    <td className="px-5 py-3 font-medium text-slate-800">
                                        {row.productName}
                                        {row.productCode && <span className="ml-2 font-mono text-xs text-slate-400">{row.productCode}</span>}
                                    </td>
                                    <td className="px-5 py-3 text-right text-slate-600">{fmtNumber(row.snapshotQuantity)} {row.unit}</td>
                                    <td className="px-5 py-3 text-right text-emerald-700">{fmtNumber(row.inboundQuantity)} {row.unit}</td>
                                    <td className="px-5 py-3 text-right text-red-600">{fmtNumber(row.outboundQuantity)} {row.unit}</td>
                                    <td className={`px-5 py-3 text-right font-bold ${row.currentQuantity < 0 ? 'text-red-700' : 'text-slate-900'}`}>{fmtNumber(row.currentQuantity)} {row.unit}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            </main>
        </div>
    );
}
