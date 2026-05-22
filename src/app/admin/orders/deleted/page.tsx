import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { prisma } from '@/lib/db';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { statusLabel, statusColor, fmtDate, fmtDateTime } from '@/lib/orders';
import BackButton from '@/components/BackButton';

export const dynamic = 'force-dynamic';

export default async function DeletedOrdersPage() {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const orders = await prisma.order.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: 'desc' },
        include: {
            customer: { select: { companyName: true, customerCode: true } },
            items: { include: { product: { select: { productName: true } } } },
        },
    });

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="bg-white border-b border-slate-200">
                <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/admin" className="flex items-center gap-2">
                        <Image src="/hanyanglogo.png" alt="logo" width={32} height={32} className="h-8 w-auto" />
                        <span className="font-bold text-slate-800">한양유화 e-Business OS</span>
                    </Link>
                    <span className="text-sm text-slate-600">{session.user.name}</span>
                </div>
            </header>

            <main className="max-w-5xl mx-auto p-6 space-y-6">
                <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
                    <ArrowLeft size={14} /> 대시보드로
                </Link>

                <div className="flex items-center gap-3">
                    <Trash2 size={22} className="text-red-400" />
                    <h1 className="text-2xl font-bold text-slate-800">삭제된 주문 내역</h1>
                    <span className="bg-slate-200 text-slate-600 text-xs px-2 py-0.5 rounded-full font-semibold">
                        {orders.length}건
                    </span>
                </div>

                <p className="text-sm text-slate-500 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    ⚠️ 삭제된 주문은 복구되지 않습니다. 감사 목적으로 내역만 보존됩니다.
                </p>

                {orders.length === 0 ? (
                    <p className="text-slate-400 text-sm text-center py-16 bg-white rounded-2xl border border-slate-200">
                        삭제된 주문이 없습니다.
                    </p>
                ) : (
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase">
                                <tr>
                                    <th className="text-left px-5 py-3">주문번호</th>
                                    <th className="text-left px-4 py-3">거래처</th>
                                    <th className="text-left px-4 py-3">제품</th>
                                    <th className="text-left px-4 py-3">삭제일시</th>
                                    <th className="text-left px-4 py-3">삭제 사유</th>
                                    <th className="text-left px-4 py-3">삭제 전 상태</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {orders.map((o) => (
                                    <tr key={o.id} className="hover:bg-slate-50">
                                        <td className="px-5 py-3 font-mono text-xs text-slate-500">{o.orderNo}</td>
                                        <td className="px-4 py-3">
                                            <p className="font-medium text-slate-800">{o.customer.companyName}</p>
                                            <p className="text-xs text-slate-400">{o.customer.customerCode}</p>
                                        </td>
                                        <td className="px-4 py-3 text-slate-600">
                                            {o.items.map((it) => it.product.productName).join(', ') || '-'}
                                        </td>
                                        <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                                            {o.deletedAt ? fmtDateTime(o.deletedAt) : '-'}
                                        </td>
                                        <td className="px-4 py-3 text-slate-600 max-w-xs">
                                            <span className="text-red-600">{o.deleteReason ?? '-'}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${statusColor(o.status)}`}>
                                                {statusLabel(o.status)}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </main>
        </div>
    );
}
