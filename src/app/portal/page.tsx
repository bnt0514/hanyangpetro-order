import { auth, signOut } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { statusLabel, statusColor, fmtDate, fmtDateTime, fmtNumber } from '@/lib/orders';
import { Plus, Package, BookOpen } from 'lucide-react';
import BackButton from '@/components/BackButton';

export const dynamic = 'force-dynamic';

export default async function PortalHome() {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'customer') redirect('/admin');
    if (!session.user.customerId) redirect('/login');

    const customerId = session.user.customerId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [orders, todayCount, inProgressCount] = await Promise.all([
        prisma.order.findMany({
            where: { customerId },
            orderBy: { createdAt: 'desc' },
            take: 20,
            include: {
                deliveryAddress: { select: { label: true } },
                items: { include: { product: { select: { productName: true } } } },
            },
        }),
        prisma.order.count({
            where: { customerId, deletedAt: null, createdAt: { gte: today, lt: tomorrow } },
        }),
        prisma.order.count({
            where: {
                customerId,
                status: {
                    in: [
                        'REQUESTED',
                        'PENDING_SALES_REVIEW',
                        'APPROVED',
                        'ON_HOLD',
                        'DISPATCH_WAITING',
                    ],
                },
            },
        }),
    ]);

    return (
        <div className="min-h-screen">
            <header className="bg-white border-b border-slate-200">
                <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/portal" className="flex items-center gap-2">
                        <Image src="/hanyanglogo.png" alt="logo" width={32} height={32} className="h-8 w-auto" />
                        <span className="font-bold text-slate-800">한양유화 거래처 포털</span>
                    </Link>
                    <div className="flex items-center gap-4 text-sm">
                        <span className="text-slate-600">
                            {session.user.customerName}{' '}
                            <span className="text-xs text-slate-400">({session.user.name})</span>
                        </span>
                        <form
                            action={async () => {
                                'use server';
                                await signOut({ redirectTo: '/login' });
                            }}
                        >
                            <button className="text-slate-500 hover:text-red-600 transition">로그아웃</button>
                        </form>
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto p-6">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">
                            {session.user.customerName}
                        </h1>
                        <p className="text-sm text-slate-500 mt-1">주문 현황</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Link
                            href="/portal/ledger"
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                            <BookOpen size={16} /> 거래처원장
                        </Link>
                        <Link
                            href="/portal/orders/new"
                            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                        >
                            <Plus size={16} /> 신규 주문 등록
                        </Link>
                    </div>
                </div>

                {/* 통계 */}
                <div className="grid grid-cols-2 gap-4 mb-8">
                    <div className="rounded-xl border border-blue-100 bg-blue-50 p-5">
                        <p className="text-sm font-medium text-blue-700/80">오늘 등록한 주문</p>
                        <p className="mt-2 text-3xl font-bold text-blue-700">
                            {fmtNumber(todayCount)}
                        </p>
                    </div>
                    <div className="rounded-xl border border-amber-100 bg-amber-50 p-5">
                        <p className="text-sm font-medium text-amber-700/80">진행 중인 주문</p>
                        <p className="mt-2 text-3xl font-bold text-amber-700">
                            {fmtNumber(inProgressCount)}
                        </p>
                    </div>
                </div>

                {/* 최근 주문 */}
                <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100">
                        <Package size={18} className="text-slate-500" />
                        <h2 className="font-semibold text-slate-800">최근 주문</h2>
                        <span className="text-xs text-slate-400">최신 20건</span>
                    </div>

                    {orders.length === 0 ? (
                        <div className="p-12 text-center text-sm text-slate-400">
                            아직 등록된 주문이 없습니다. 위의 &quot;신규 주문 등록&quot; 버튼을 눌러 시작하세요.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                                        <th className="px-5 py-3">주문번호</th>
                                        <th className="px-5 py-3">도착지</th>
                                        <th className="px-5 py-3">제품</th>
                                        <th className="px-5 py-3">도착일</th>
                                        <th className="px-5 py-3">상태</th>
                                        <th className="px-5 py-3">등록</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {orders.map((o) => (
                                        <tr key={o.id} className="hover:bg-blue-50/40 cursor-pointer transition">
                                            <td className="px-5 py-3 font-mono text-xs text-slate-700">
                                                <Link href={`/portal/orders/${o.id}`} className="block">
                                                    {o.orderNo}
                                                </Link>
                                            </td>
                                            <td className="px-5 py-3 text-slate-600">
                                                <Link href={`/portal/orders/${o.id}`} className="block">
                                                    {o.deliveryAddress.label}
                                                </Link>
                                            </td>
                                            <td className="px-5 py-3 text-slate-600">
                                                <Link href={`/portal/orders/${o.id}`} className="block">
                                                    {o.items.map((it) => (
                                                        <div key={it.id} className="text-xs">
                                                            {it.product.productName}{' '}
                                                            <span className="text-slate-400">
                                                                ({fmtNumber(it.requestedQuantity)}{it.unit})
                                                            </span>
                                                        </div>
                                                    ))}
                                                </Link>
                                            </td>
                                            <td className="px-5 py-3 text-slate-600">
                                                <Link href={`/portal/orders/${o.id}`} className="block">
                                                    {fmtDate(o.requestedDeliveryDate)}
                                                </Link>
                                            </td>
                                            <td className="px-5 py-3">
                                                <Link href={`/portal/orders/${o.id}`} className="block">
                                                    <span
                                                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor(o.status)}`}
                                                    >
                                                        {statusLabel(o.status)}
                                                    </span>
                                                </Link>
                                            </td>
                                            <td className="px-5 py-3 text-xs text-slate-500">
                                                <Link href={`/portal/orders/${o.id}`} className="block">
                                                    {fmtDateTime(o.createdAt)}
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>

                <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    🔒 비밀번호는 사업자번호 숫자입니다. 추후 설정에서 변경할 수 있습니다.
                </div>
            </main>
            <BackButton />
        </div>
    );
}
