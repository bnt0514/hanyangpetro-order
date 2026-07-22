import { auth, signOut } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { statusLabel, statusColor, fmtDate, fmtDateTime, fmtNumber } from '@/lib/orders';
import { BookOpen, CheckCircle2, ClipboardList, PackageCheck, PlusCircle, Truck } from 'lucide-react';
import HomepageArchiveLink from '@/components/HomepageArchiveLink';
import MobileStatusLink from '@/app/admin/MobileStatusLink';
import { isShipmentDueOnKstDate, kstDateKey } from '@/lib/shipment-status';

export const dynamic = 'force-dynamic';

type RecentStatus = 'all' | 'intake' | 'approved' | 'dispatchWaiting' | 'dispatched';

const statusOptions: Record<RecentStatus, { label: string; statuses: string[] }> = {
    all: { label: '전체', statuses: [] },
    intake: { label: '접수된 오더', statuses: ['REQUESTED', 'CREDIT_OVER_LIMIT'] },
    approved: { label: '승인완료 오더', statuses: ['APPROVED'] },
    dispatchWaiting: { label: '배차대기', statuses: ['DISPATCHING'] },
    dispatched: { label: '배차 및 출고 완료', statuses: ['DISPATCH_COMPLETED', 'SHIPPED'] },
};

function isRecentStatus(value?: string): value is RecentStatus {
    return value === 'all'
        || value === 'intake'
        || value === 'approved'
        || value === 'dispatchWaiting'
        || value === 'dispatched';
}

export default async function PortalHome({
    searchParams,
}: {
    searchParams: Promise<{ recentStatus?: string }>;
}) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'customer') redirect('/admin');
    if (!session.user.customerId) redirect('/login');

    const sp = await searchParams;
    const recentStatus = isRecentStatus(sp.recentStatus) ? sp.recentStatus : 'all';
    const customerId = session.user.customerId;
    const baseWhere = { customerId, deletedAt: null };
    const [intakeCount, approvedCount, dispatchWaitingCount, dispatchedCandidates, orders, dashboardRaw] = await Promise.all([
        prisma.order.count({ where: { ...baseWhere, status: { in: statusOptions.intake.statuses } } }),
        prisma.order.count({ where: { ...baseWhere, status: { in: statusOptions.approved.statuses } } }),
        prisma.order.count({ where: { ...baseWhere, status: { in: statusOptions.dispatchWaiting.statuses } } }),
        prisma.order.findMany({
            where: { ...baseWhere, status: { in: statusOptions.dispatched.statuses } },
            orderBy: { createdAt: 'desc' },
            include: {
                deliveryAddress: { select: { label: true } },
                items: { include: { product: { select: { productName: true } } } },
            },
        }),
        prisma.order.findMany({
            where: baseWhere,
            orderBy: { createdAt: 'desc' },
            take: 20,
            include: {
                deliveryAddress: { select: { label: true } },
                items: { include: { product: { select: { productName: true } } } },
            },
        }),
        recentStatus === 'all'
            ? Promise.resolve([])
            : prisma.order.findMany({
                where: {
                    ...baseWhere,
                    ...(recentStatus === 'dispatched'
                        ? { status: { in: statusOptions.dispatched.statuses } }
                        : { status: { in: statusOptions[recentStatus].statuses } }),
                },
                orderBy: { createdAt: 'desc' },
                take: 20,
                include: {
                    deliveryAddress: { select: { label: true } },
                    items: { include: { product: { select: { productName: true } } } },
                },
            }),
    ]);

    const shipmentDateKey = kstDateKey(new Date());
    const dispatchedTodayOrders = dispatchedCandidates.filter((order) =>
        isShipmentDueOnKstDate(order, shipmentDateKey)
    );
    const dispatchedCount = dispatchedTodayOrders.length;
    const dashboardOrders = (recentStatus === 'dispatched' ? dispatchedTodayOrders : dashboardRaw)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 20);
    const recentStatusLabel = statusOptions[recentStatus].label;

    const quickActionCards = [
        {
            href: '/portal/orders/new',
            label: '오더 등록',
            subLabel: '신규 주문 입력',
            Icon: PlusCircle,
            className: 'border-orange-200 bg-white text-orange-900',
            iconClassName: 'bg-orange-500 text-white',
        },
        {
            href: '/portal/dispatch',
            label: '배차 조회',
            subLabel: '배차내역 확인',
            Icon: Truck,
            className: 'border-red-200 bg-white text-red-900',
            iconClassName: 'bg-red-500 text-white',
        },
        {
            href: '/portal/ledger',
            label: '거래처 원장',
            subLabel: '본인 거래처 원장',
            Icon: BookOpen,
            className: 'border-amber-200 bg-white text-amber-900',
            iconClassName: 'bg-amber-500 text-white',
        },
    ];

    const dashboardCards: {
        key: RecentStatus;
        label: string;
        description: string;
        value: number;
        Icon: typeof ClipboardList;
        className: string;
        iconClassName: string;
    }[] = [
            {
                key: 'intake',
                label: '접수된 오더',
                description: '오더 승인이 필요한 주문',
                value: intakeCount,
                Icon: ClipboardList,
                className: 'border-orange-200 bg-white text-orange-950',
                iconClassName: 'bg-orange-500 text-white',
            },
            {
                key: 'approved',
                label: '승인완료 오더',
                description: '한화 주문이 필요한 오더',
                value: approvedCount,
                Icon: PackageCheck,
                className: 'border-amber-200 bg-white text-amber-950',
                iconClassName: 'bg-amber-500 text-white',
            },
            {
                key: 'dispatchWaiting',
                label: '배차대기',
                description: '한화 주문/혹은 타사 주문 완료되어 배차 대기중',
                value: dispatchWaitingCount,
                Icon: Truck,
                className: 'border-red-200 bg-white text-red-950',
                iconClassName: 'bg-red-500 text-white',
            },
            {
                key: 'dispatched',
                label: '배차 및 출고 완료',
                description: '오늘 배차완료/출고완료 처리된 오더',
                value: dispatchedCount,
                Icon: CheckCircle2,
                className: 'border-emerald-200 bg-white text-emerald-950',
                iconClassName: 'bg-emerald-600 text-white',
            },
        ];

    return (
        <div className="min-h-screen bg-[#fff7ed]">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex min-h-16 max-w-5xl flex-col gap-3 px-4 py-3 md:h-16 md:flex-row md:items-center md:justify-between md:px-6 md:py-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <Link href="/portal" className="flex items-center gap-2">
                            <Image src="/hanyanglogo.png" alt="logo" width={32} height={32} className="h-8 w-auto" />
                            <span className="text-sm font-bold text-slate-800 sm:text-base">한양유화&BNT 거래처 포털</span>
                        </Link>
                        <HomepageArchiveLink />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                        <span className="min-w-0 text-slate-600">
                            {session.user.customerName}{' '}
                            <span className="text-xs text-slate-400">({session.user.name})</span>
                        </span>
                        <Link href="/settings" className="text-sm text-slate-500 transition hover:text-blue-600">비밀번호 변경</Link>
                        <form
                            action={async () => {
                                'use server';
                                await signOut({ redirectTo: '/login' });
                            }}
                        >
                            <button className="text-slate-500 transition hover:text-red-600">로그아웃</button>
                        </form>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-5xl p-3 md:p-6">
                <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                    {quickActionCards.map(({ href, label, subLabel, Icon, className, iconClassName }) => (
                        <Link
                            key={href}
                            href={href}
                            className={`group flex min-h-[5.75rem] items-center gap-4 rounded-lg border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md md:min-h-20 ${className}`}
                        >
                            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg shadow-sm ${iconClassName}`}>
                                <Icon size={24} />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-lg font-black leading-tight">{label}</span>
                                <span className="mt-1 block text-xs font-bold leading-tight text-slate-500 md:font-semibold">{subLabel}</span>
                            </span>
                        </Link>
                    ))}
                </div>

                <section className="overflow-hidden rounded-lg border border-orange-300 bg-orange-500 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-white">
                        <h1 className="text-2xl font-black">대시보드</h1>
                        {recentStatus !== 'all' && (
                            <Link href="/portal" className="rounded-full border border-white/40 bg-white/15 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/25">
                                전체 보기
                            </Link>
                        )}
                    </div>

                    <div className="space-y-3 bg-orange-50 p-4">
                        <div className="grid grid-cols-1 gap-3">
                            {dashboardCards.map(({ key, label, description, value, Icon, className, iconClassName }) => (
                                <MobileStatusLink
                                    key={key}
                                    href={`/portal?recentStatus=${key}`}
                                    className={`group flex items-center gap-4 rounded-lg border p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${recentStatus === key ? 'ring-2 ring-red-400' : ''} ${className}`}
                                >
                                    <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-lg shadow-sm ${iconClassName}`}>
                                        <Icon size={24} />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-xl font-black leading-tight">{label}</span>
                                        <span className="mt-1 block text-sm font-semibold text-slate-500">{description}</span>
                                    </span>
                                    <span className="shrink-0 text-right">
                                        <span className="block text-4xl font-black leading-none">{fmtNumber(value)}</span>
                                        <span className="mt-1 block text-xs font-bold text-slate-400">건</span>
                                    </span>
                                </MobileStatusLink>
                            ))}
                        </div>

                        <div id="dashboard-orders" className="rounded-lg border border-orange-200 bg-white p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-black text-slate-900">
                                        {recentStatus === 'all' ? '상태별 오더' : recentStatusLabel}
                                    </h2>
                                    <p className="text-xs font-semibold text-slate-500">
                                        상태 카드를 누르면 해당 오더가 카드 형태로 표시됩니다.
                                    </p>
                                </div>
                                {recentStatus !== 'all' && (
                                    <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-black text-orange-700">
                                        {fmtNumber(dashboardOrders.length)}건
                                    </span>
                                )}
                            </div>

                            {recentStatus === 'all' ? (
                                <div className="rounded-lg border border-dashed border-orange-200 bg-orange-50 px-4 py-8 text-center text-sm font-semibold text-orange-700">
                                    위 상태 카드를 선택하면 해당 오더들이 이곳에 카드로 표시됩니다.
                                </div>
                            ) : dashboardOrders.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-orange-200 bg-orange-50 px-4 py-8 text-center text-sm font-semibold text-orange-700">
                                    해당 상태의 오더가 없습니다.
                                </div>
                            ) : (
                                <div className="grid gap-2">
                                    {dashboardOrders.map((order) => (
                                        <Link
                                            key={order.id}
                                            href={`/portal/orders/${order.id}`}
                                            className="block rounded-lg border border-orange-100 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-md"
                                        >
                                            <div className="flex flex-wrap items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="font-mono text-xs font-black text-orange-700">{order.orderNo}</span>
                                                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${statusColor(order.status)}`}>
                                                            {statusLabel(order.status)}
                                                        </span>
                                                    </div>
                                                    <p className="mt-2 truncate text-lg font-black text-slate-900">
                                                        {order.deliveryAddress?.label ?? '도착지 미지정'}
                                                    </p>
                                                    <p className="mt-1 text-sm font-semibold text-slate-500">{session.user.customerName}</p>
                                                </div>
                                                <div className="shrink-0 text-right">
                                                    <p className="text-xs font-bold text-slate-400">도착일</p>
                                                    <p className="text-base font-black text-slate-800">{fmtDate(order.requestedDeliveryDate)}</p>
                                                </div>
                                            </div>
                                            <div className="mt-3 grid gap-1 rounded-lg bg-orange-50/70 px-3 py-2">
                                                {order.items.map((item) => (
                                                    <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                                                        <span className="min-w-0 truncate font-bold text-slate-700">{item.product?.productName ?? '제품 정보 없음'}</span>
                                                        <span className="shrink-0 font-black text-orange-700">
                                                            {fmtNumber(item.requestedQuantity)}{item.unit}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
                        <ClipboardList size={18} className="text-slate-500" />
                        <h2 className="font-semibold text-slate-800">최근 주문</h2>
                        <span className="text-xs text-slate-400">최신 20건</span>
                    </div>

                    {orders.length === 0 ? (
                        <div className="p-12 text-center text-sm text-slate-400">
                            아직 등록된 주문이 없습니다. 위의 &quot;오더 등록&quot; 버튼을 눌러 시작하세요.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
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
                                        <tr key={o.id} className="cursor-pointer transition hover:bg-blue-50/40">
                                            <td className="px-5 py-3 font-mono text-xs text-slate-700">
                                                <Link href={`/portal/orders/${o.id}`} className="block">
                                                    {o.orderNo}
                                                </Link>
                                            </td>
                                            <td className="px-5 py-3 text-slate-600">
                                                <Link href={`/portal/orders/${o.id}`} className="block">
                                                    {o.deliveryAddress?.label ?? '도착지 미지정'}
                                                </Link>
                                            </td>
                                            <td className="px-5 py-3 text-slate-600">
                                                <Link href={`/portal/orders/${o.id}`} className="block">
                                                    {o.items.map((it) => (
                                                        <div key={it.id} className="text-xs">
                                                            {it.product?.productName ?? '제품 정보 없음'}{' '}
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
                                                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor(o.status)}`}>
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
            </main>
        </div>
    );
}
