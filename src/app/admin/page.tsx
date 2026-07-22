import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { fmtDate, fmtNumber, statusColor, statusLabel } from '@/lib/orders';
import { CalendarCheck, CheckCircle2, ClipboardList, PackageCheck, PlusCircle, Truck } from 'lucide-react';
import F5NewOrderShortcut from './F5NewOrderShortcut';
import RecentOrdersPanel from './RecentOrdersPanel';
import MobileStatusLink from './MobileStatusLink';
import { canViewAllStaffData, isYangHeeCheol as isYangHeeCheolUser } from '@/lib/staff-permissions';
import { isShipmentDueOnKstDate, kstDateKey } from '@/lib/shipment-status';

export const dynamic = 'force-dynamic';

type RecentRange = 'latest20' | '7d' | '14d' | '1m' | '3m' | 'all';
type RecentSort = 'createdAt' | 'orderNo' | 'deliveryDate' | 'customer' | 'status';
type SortDir = 'asc' | 'desc';
type RecentStatus = 'all' | 'intake' | 'approved' | 'dispatchWaiting' | 'dispatched';

const rangeOptions: { value: RecentRange; label: string }[] = [
    { value: 'latest20', label: '최신 20건' },
    { value: '7d', label: '최근 1주일' },
    { value: '14d', label: '최근 2주' },
    { value: '1m', label: '최근 1개월' },
    { value: '3m', label: '최근 3개월' },
    { value: 'all', label: '전체' },
];

const sortOptions: { value: RecentSort; label: string }[] = [
    { value: 'createdAt', label: '등록일시' },
    { value: 'deliveryDate', label: '도착일' },
    { value: 'customer', label: '거래처' },
    { value: 'status', label: '상태' },
];

const statusOptions: Record<RecentStatus, { label: string; statuses: string[] }> = {
    all: { label: '전체', statuses: [] },
    intake: { label: '접수된 오더', statuses: ['REQUESTED', 'CREDIT_OVER_LIMIT'] },
    approved: { label: '승인완료 오더', statuses: ['APPROVED'] },
    dispatchWaiting: { label: '배차대기', statuses: ['DISPATCHING'] },
    dispatched: { label: '배차 및 출고 완료', statuses: ['DISPATCH_COMPLETED', 'SHIPPED'] },
};

function isRecentRange(value?: string): value is RecentRange {
    return rangeOptions.some((option) => option.value === value);
}

function isRecentSort(value?: string): value is RecentSort {
    return sortOptions.some((option) => option.value === value);
}

function isRecentStatus(value?: string): value is RecentStatus {
    return value === 'all' || value === 'intake' || value === 'approved' || value === 'dispatchWaiting' || value === 'dispatched';
}

function startDateForRange(range: RecentRange, today: Date) {
    if (range === 'latest20' || range === 'all') return null;
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    if (range === '7d') start.setDate(start.getDate() - 6);
    if (range === '14d') start.setDate(start.getDate() - 13);
    if (range === '1m') start.setMonth(start.getMonth() - 1);
    if (range === '3m') start.setMonth(start.getMonth() - 3);
    return start;
}

function compareText(a: string, b: string) {
    return a.localeCompare(b, 'ko-KR', { numeric: true, sensitivity: 'base' });
}

export default async function AdminHome({
    searchParams,
}: {
    searchParams: Promise<{ recentRange?: string; recentSort?: string; recentDir?: string; recentOwner?: string; recentUserId?: string; recentStatus?: string }>;
}) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const sp = await searchParams;
    const recentRange = isRecentRange(sp.recentRange) ? sp.recentRange : 'latest20';
    const recentSort = isRecentSort(sp.recentSort) ? sp.recentSort : 'createdAt';
    const recentDir: SortDir = sp.recentDir === 'asc' ? 'asc' : 'desc';
    const recentStatus = isRecentStatus(sp.recentStatus) ? sp.recentStatus : 'all';
    const isYangHeeCheol = isYangHeeCheolUser(session.user);
    const canViewAll = canViewAllStaffData(session.user);
    const recentOwner = sp.recentOwner === 'mine' ? 'mine' : sp.recentOwner === 'user' && isYangHeeCheol ? 'user' : 'all';
    const selectedRecentUserId = isYangHeeCheol && recentOwner === 'user' ? sp.recentUserId ?? '' : '';

    // ── 통계 ────────────────────────────────────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const recentStart = startDateForRange(recentRange, today);
    const ownerUserId = recentOwner === 'mine' ? session.user.id : selectedRecentUserId;
    const recentOwnerWhere = ownerUserId
        ? {
            OR: [
                { requestedByUserId: ownerUserId },
                { salesRepId: ownerUserId },
                { customer: { defaultSalesRepId: ownerUserId } },
            ],
        }
        : {};
    const dashboardStatusWhere = recentStatus === 'all'
        ? {}
        : { status: { in: statusOptions[recentStatus].statuses } };
    const baseOpenWhere = { deletedAt: null, ...recentOwnerWhere };
    const [intakeCount, approvedCount, dispatchWaitingCount, dispatchedCandidates, recentRaw, dashboardRaw, staffUsers] = await Promise.all([
        prisma.order.count({ where: { ...baseOpenWhere, status: { in: statusOptions.intake.statuses } } }),
        prisma.order.count({ where: { ...baseOpenWhere, status: { in: statusOptions.approved.statuses } } }),
        prisma.order.count({ where: { ...baseOpenWhere, status: { in: statusOptions.dispatchWaiting.statuses } } }),
        prisma.order.findMany({
            where: { ...baseOpenWhere, status: { in: statusOptions.dispatched.statuses } },
            orderBy: { createdAt: 'desc' },
            include: {
                customer: { select: { companyName: true, defaultSalesRepId: true, defaultSalesRep: { select: { name: true } } } },
                deliveryAddress: { select: { label: true } },
                items: { include: { product: { select: { productName: true } } } },
                requestedByUser: { select: { name: true } },
                requestedByCustomerUser: { select: { name: true } },
                deliveryDateChangeRequests: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } },
            },
        }),
        prisma.order.findMany({
            where: { deletedAt: null, ...(recentStart ? { createdAt: { gte: recentStart } } : {}), ...recentOwnerWhere },
            orderBy: { createdAt: 'desc' },
            take: recentRange === 'latest20' ? 20 : undefined,
            include: {
                customer: { select: { companyName: true, defaultSalesRepId: true, defaultSalesRep: { select: { name: true } } } },
                deliveryAddress: { select: { label: true } },
                items: { include: { product: { select: { productName: true } } } },
                requestedByUser: { select: { name: true } },
                requestedByCustomerUser: { select: { name: true } },
                deliveryDateChangeRequests: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } },
            },
        }),
        recentStatus === 'all'
            ? Promise.resolve([])
            : prisma.order.findMany({
                where: {
                    deletedAt: null,
                    ...recentOwnerWhere,
                    ...(recentStatus === 'dispatched'
                        ? { status: { in: statusOptions.dispatched.statuses } }
                        : dashboardStatusWhere),
                },
                orderBy: { createdAt: 'desc' },
                take: 20,
                include: {
                    customer: { select: { companyName: true, defaultSalesRepId: true, defaultSalesRep: { select: { name: true } } } },
                    deliveryAddress: { select: { label: true } },
                    items: { include: { product: { select: { productName: true } } } },
                    requestedByUser: { select: { name: true } },
                    requestedByCustomerUser: { select: { name: true } },
                    deliveryDateChangeRequests: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } },
                },
            }),
        isYangHeeCheol
            ? prisma.user.findMany({
                where: { isActive: true },
                select: { id: true, name: true },
                orderBy: { name: 'asc' },
            })
            : Promise.resolve([]),
    ]);

    const recent = [...recentRaw].sort((a, b) => {
        let result = 0;
        if (recentSort === 'createdAt') result = a.createdAt.getTime() - b.createdAt.getTime();
        if (recentSort === 'deliveryDate') result = (a.requestedDeliveryDate?.getTime() ?? 0) - (b.requestedDeliveryDate?.getTime() ?? 0);
        if (recentSort === 'orderNo') result = compareText(a.orderNo, b.orderNo);
        if (recentSort === 'customer') result = compareText(a.customer.companyName, b.customer.companyName);
        if (recentSort === 'status') result = compareText(statusLabel(a.status), statusLabel(b.status));
        return recentDir === 'asc' ? result : -result;
    });
    const shipmentDateKey = kstDateKey(new Date());
    const dispatchedTodayOrders = dispatchedCandidates.filter((order) =>
        isShipmentDueOnKstDate(order, shipmentDateKey)
    );
    const dispatchedCount = dispatchedTodayOrders.length;
    const dashboardOrders = (recentStatus === 'dispatched' ? dispatchedTodayOrders : dashboardRaw)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 20);

    const recentRangeLabel = rangeOptions.find((option) => option.value === recentRange)?.label ?? '최신 20건';
    const recentStatusLabel = statusOptions[recentStatus].label;

    const dashboardCards = [
        { key: 'intake', label: '접수된 오더', description: '오더 승인이 필요한 주문', value: intakeCount, Icon: ClipboardList, className: 'border-orange-200 bg-white text-orange-950', iconClassName: 'bg-orange-500 text-white' },
        { key: 'approved', label: '승인완료 오더', description: '한화 주문이 필요한 오더', value: approvedCount, Icon: PackageCheck, className: 'border-amber-200 bg-white text-amber-950', iconClassName: 'bg-amber-500 text-white' },
        { key: 'dispatchWaiting', label: '배차대기', description: '한화 주문/혹은 타사 주문 완료되어 배차 대기중', value: dispatchWaitingCount, Icon: Truck, className: 'border-red-200 bg-white text-red-950', iconClassName: 'bg-red-500 text-white' },
        { key: 'dispatched', label: '배차 및 출고 완료', description: '오늘 배차완료/출고완료 처리된 오더', value: dispatchedCount, Icon: CheckCircle2, className: 'border-emerald-200 bg-white text-emerald-950', iconClassName: 'bg-emerald-600 text-white' },
    ];
    const quickActionCards = [
        { href: '/admin/orders/new', label: '오더 등록(F5)', mobileLabel: '오더 등록', subLabel: '신규 주문 입력', Icon: PlusCircle, className: 'border-orange-200 bg-white text-orange-900', iconClassName: 'bg-orange-500 text-white' },
        { href: '/admin/dispatch', label: '배차 조회', mobileLabel: '배차 조회', subLabel: '한화 배차내역 확인', Icon: Truck, className: 'border-red-200 bg-white text-red-900', iconClassName: 'bg-red-500 text-white' },
        { href: '/admin/today-shipping', label: '금일 출고예정', mobileLabel: '금일 출고예정', subLabel: '오늘 출고 대상 상태 확인', Icon: CalendarCheck, className: 'border-amber-200 bg-white text-amber-900', iconClassName: 'bg-amber-500 text-white' },
    ];

    return (
        <div className="min-h-full bg-[#fff7ed] p-3 md:p-6">
            <div className="mx-auto max-w-5xl">
                <div className="staff-desktop-view mb-5">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.75rem' }}>
                        {quickActionCards.map(({ href, label, subLabel, Icon, className, iconClassName }) => (
                            <Link
                                key={href}
                                href={href}
                                className={`group rounded-lg border shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${className}`}
                                style={{
                                    display: 'flex',
                                    minHeight: '5rem',
                                    alignItems: 'center',
                                    gap: '1rem',
                                    padding: '1rem',
                                    textAlign: 'left',
                                }}
                            >
                                <span
                                    className={`shrink-0 rounded-lg shadow-sm ${iconClassName}`}
                                    style={{
                                        display: 'flex',
                                        height: '3rem',
                                        width: '3rem',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <Icon size={24} />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span style={{ display: 'block', fontSize: '1.125rem', fontWeight: 900, lineHeight: 1.2 }}>{label}</span>
                                    <span style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.75rem', fontWeight: 600, lineHeight: 1.2, color: '#64748b' }}>{subLabel}</span>
                                </span>
                            </Link>
                        ))}
                    </div>
                </div>

                <div className="staff-mobile-view mb-4">
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '0.75rem' }}>
                        {quickActionCards.map(({ href, mobileLabel, subLabel, Icon, className, iconClassName }) => (
                            <Link
                                key={href}
                                href={href}
                                className={`group rounded-lg border shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${className}`}
                                style={{
                                    display: 'flex',
                                    minHeight: '5.75rem',
                                    alignItems: 'center',
                                    justifyContent: 'flex-start',
                                    gap: '1rem',
                                    padding: '1rem',
                                    textAlign: 'left',
                                }}
                            >
                                <span
                                    className={`shrink-0 rounded-lg shadow-sm ${iconClassName}`}
                                    style={{
                                        display: 'flex',
                                        height: '3rem',
                                        width: '3rem',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <Icon size={24} />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span style={{ display: 'block', fontSize: '1.1rem', fontWeight: 900, lineHeight: 1.15 }}>{mobileLabel}</span>
                                    <span style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.2, color: '#64748b' }}>{subLabel}</span>
                                </span>
                            </Link>
                        ))}
                    </div>
                </div>

                <div className="overflow-hidden rounded-lg border border-orange-300 bg-orange-500 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-white">
                        <h1 className="text-2xl font-black">대시보드</h1>
                        {recentStatus !== 'all' && (
                            <Link href="/admin" className="rounded-full border border-white/40 bg-white/15 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/25">
                                전체 보기
                            </Link>
                        )}
                    </div>

                    <div className="space-y-3 bg-orange-50 p-4">
                        <div className="grid grid-cols-1 gap-3">
                            {dashboardCards.map(({ key, label, description, value, Icon, className, iconClassName }) => (
                                <MobileStatusLink
                                    key={label}
                                    href={`/admin?recentStatus=${key}`}
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
                                            href={`/admin/orders/${order.id}`}
                                            className="block rounded-lg border border-orange-100 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-md"
                                        >
                                            <div className="flex flex-wrap items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${statusColor(order.status)}`}>
                                                            {statusLabel(order.status)}
                                                        </span>
                                                    </div>
                                                    <p className="mt-2 truncate text-lg font-black text-slate-900">{order.customer.companyName}</p>
                                                    <p className="mt-1 text-sm font-semibold text-slate-500">{order.deliveryAddress.label}</p>
                                                </div>
                                                <div className="shrink-0 text-right">
                                                    <p className="text-xs font-bold text-slate-400">도착일</p>
                                                    <p className="text-base font-black text-slate-800">{fmtDate(order.requestedDeliveryDate)}</p>
                                                </div>
                                            </div>
                                            <div className="mt-3 grid gap-1 rounded-lg bg-orange-50/70 px-3 py-2">
                                                {order.items.map((item) => (
                                                    <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                                                        <span className="min-w-0 truncate font-bold text-slate-700">{item.product.productName}</span>
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
                </div>

                <F5NewOrderShortcut />

                <div id="mobile-orders" className="mt-5">
                    <RecentOrdersPanel
                        key={`${recentRange}:${recentSort}:${recentDir}:${recentOwner}:${selectedRecentUserId}`}
                        initialRows={recent.map((o) => ({
                            id: o.id,
                            orderNo: o.orderNo,
                            status: o.status,
                            createdAt: o.createdAt.toISOString(),
                            requestedDeliveryDate: o.requestedDeliveryDate?.toISOString() ?? null,
                            customer: {
                                companyName: o.customer.companyName,
                                defaultSalesRepId: o.customer.defaultSalesRepId,
                                defaultSalesRep: o.customer.defaultSalesRep,
                            },
                            deliveryAddress: { label: o.deliveryAddress.label },
                            items: o.items.map((it) => ({
                                id: it.id,
                                product: { productName: it.product.productName },
                                requestedQuantity: it.requestedQuantity,
                                unit: it.unit,
                            })),
                            requestedByUser: o.requestedByUser ?? null,
                            requestedByCustomerUser: o.requestedByCustomerUser ?? null,
                            deliveryDateChangeRequests: o.deliveryDateChangeRequests,
                        }))}
                        initialRange={recentRange}
                        initialSort={recentSort}
                        initialDir={recentDir}
                        initialOwner={recentOwner}
                        initialUserId={selectedRecentUserId}
                        canViewAllRecentOrders={canViewAll}
                        staffUsers={staffUsers}
                    />
                </div>
                <p className="mt-2 text-right text-xs text-slate-400">{recentRangeLabel} · {recent.length}건</p>
            </div>
        </div>
    );
}
