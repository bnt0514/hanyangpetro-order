import { auth, signOut } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { statusLabel, statusColor, fmtDate, fmtDateTime, fmtNumber } from '@/lib/orders';
import { Plus, Package, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const isHanwhaManager = session.user.role === 'EXECUTIVE' || session.user.role === 'ADMIN';

    // ── 통계 ────────────────────────────────────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [todayCount, pendingReviewCount, onHoldCount, shippedTodayCount, recent] = await Promise.all([
        prisma.order.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
        prisma.order.count({ where: { status: { in: ['REQUESTED', 'PENDING_SALES_REVIEW'] } } }),
        prisma.order.count({ where: { status: 'ON_HOLD' } }),
        prisma.order.count({
            where: { status: { in: ['SHIPPED', 'COMPLETED'] }, updatedAt: { gte: today, lt: tomorrow } },
        }),
        prisma.order.findMany({
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 20,
            include: {
                customer: { select: { companyName: true } },
                deliveryAddress: { select: { label: true } },
                items: { include: { product: { select: { productName: true } } } },
                requestedByUser: { select: { name: true } },
                requestedByCustomerUser: { select: { name: true } },
            },
        }),
    ]);

    const cards = [
        { label: '오늘 신규 주문', value: todayCount, tone: 'blue' as const, Icon: Plus },
        { label: '검토 대기', value: pendingReviewCount, tone: 'amber' as const, Icon: Clock },
        { label: '보류 주문', value: onHoldCount, tone: 'orange' as const, Icon: AlertTriangle },
        { label: '오늘 출고/완료', value: shippedTodayCount, tone: 'emerald' as const, Icon: CheckCircle2 },
    ];

    const toneClass: Record<string, string> = {
        blue: 'bg-blue-50 text-blue-700 border-blue-100',
        amber: 'bg-amber-50 text-amber-700 border-amber-100',
        orange: 'bg-orange-50 text-orange-700 border-orange-100',
        emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    };

    return (
        <div className="min-h-screen">
            <header className="bg-white border-b border-slate-200">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/admin" className="flex items-center gap-2">
                        <Image src="/hanyanglogo.png" alt="logo" width={32} height={32} className="h-8 w-auto" />
                        <span className="font-bold text-slate-800">한양유화 e-Business OS</span>
                    </Link>
                    <div className="flex items-center gap-4 text-sm">
                        <span className="text-slate-600">
                            {session.user.name}{' '}
                            <span className="text-xs text-slate-400">({session.user.role})</span>
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

            <main className="max-w-7xl mx-auto p-6">
                <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
                    <h1 className="text-2xl font-bold text-slate-800">대시보드</h1>
                    <div className="flex items-center gap-2 flex-wrap">
                        <Link
                            href="/admin/dispatch"
                            className="inline-flex items-center gap-2 rounded-xl bg-white border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                            🚚 한화 배차 조회
                        </Link>
                        {isHanwhaManager && (
                            <Link
                                href="/admin/settings/hanwha"
                                className="inline-flex items-center gap-2 rounded-xl bg-white border border-slate-300 px-3 py-2.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50"
                                title="한화 H-CRM 비밀번호 관리"
                            >
                                🔑 한화 비번
                            </Link>
                        )}
                        {isHanwhaManager && (
                            <Link
                                href="/admin/prices"
                                className="inline-flex items-center gap-2 rounded-xl bg-white border border-slate-300 px-3 py-2.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50"
                            >
                                📊 단가 관리
                            </Link>
                        )}
                        <Link
                            href="/admin/credit-overrides"
                            className="inline-flex items-center gap-2 rounded-xl bg-white border border-red-300 px-3 py-2.5 text-xs font-semibold text-red-600 shadow-sm hover:bg-red-50"
                        >
                            🛡 여신 초과 승인
                        </Link>
                        <Link
                            href="/admin/orders/deleted"
                            className="inline-flex items-center gap-2 rounded-xl bg-white border border-slate-300 px-3 py-2.5 text-xs font-semibold text-slate-500 shadow-sm hover:bg-slate-50"
                        >
                            🗑 삭제 내역
                        </Link>
                        <Link
                            href="/admin/orders/new"
                            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                        >
                            <Plus size={16} /> 신규 주문 등록
                        </Link>
                    </div>
                </div>

                {/* 통계 카드 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    {cards.map(({ label, value, tone, Icon }) => (
                        <div
                            key={label}
                            className={`rounded-xl border p-5 shadow-sm ${toneClass[tone]}`}
                        >
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-medium opacity-80">{label}</p>
                                <Icon size={18} className="opacity-60" />
                            </div>
                            <p className="mt-2 text-3xl font-bold">{fmtNumber(value)}</p>
                        </div>
                    ))}
                </div>

                {/* 최근 주문 */}
                <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                            <Package size={18} className="text-slate-500" />
                            <h2 className="font-semibold text-slate-800">최근 주문</h2>
                            <span className="text-xs text-slate-400">최신 20건</span>
                        </div>
                    </div>

                    {recent.length === 0 ? (
                        <div className="p-12 text-center text-sm text-slate-400">
                            아직 등록된 주문이 없습니다.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                                        <th className="px-6 py-3">주문번호</th>
                                        <th className="px-6 py-3">거래처</th>
                                        <th className="px-6 py-3">도착지</th>
                                        <th className="px-6 py-3">제품</th>
                                        <th className="px-6 py-3">도착일</th>
                                        <th className="px-6 py-3">상태</th>
                                        <th className="px-6 py-3">접수자</th>
                                        <th className="px-6 py-3">등록일시</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {recent.map((o) => (
                                        <tr
                                            key={o.id}
                                            className="hover:bg-blue-50/40 cursor-pointer transition"
                                            onClick={undefined}
                                        >
                                            <td className="px-6 py-3 font-mono text-xs text-slate-700">
                                                <Link href={`/admin/orders/${o.id}`} className="block">
                                                    {o.orderNo}
                                                </Link>
                                            </td>
                                            <td className="px-6 py-3 font-medium text-slate-800">
                                                <Link href={`/admin/orders/${o.id}`} className="block">
                                                    {o.customer.companyName}
                                                </Link>
                                            </td>
                                            <td className="px-6 py-3 text-slate-600">
                                                <Link href={`/admin/orders/${o.id}`} className="block">
                                                    {o.deliveryAddress.label}
                                                </Link>
                                            </td>
                                            <td className="px-6 py-3 text-slate-600">
                                                <Link href={`/admin/orders/${o.id}`} className="block">
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
                                            <td className="px-6 py-3 text-slate-600">
                                                <Link href={`/admin/orders/${o.id}`} className="block">
                                                    {fmtDate(o.requestedDeliveryDate)}
                                                </Link>
                                            </td>
                                            <td className="px-6 py-3">
                                                <Link href={`/admin/orders/${o.id}`} className="block">
                                                    <span
                                                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor(o.status)}`}
                                                    >
                                                        {statusLabel(o.status)}
                                                    </span>
                                                </Link>
                                            </td>
                                            <td className="px-6 py-3 text-xs text-slate-500">
                                                <Link href={`/admin/orders/${o.id}`} className="block">
                                                    {o.requestedByUser?.name ??
                                                        o.requestedByCustomerUser?.name ??
                                                        '-'}
                                                </Link>
                                            </td>
                                            <td className="px-6 py-3 text-xs text-slate-500">
                                                <Link href={`/admin/orders/${o.id}`} className="block">
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
            </main>
        </div>
    );
}
