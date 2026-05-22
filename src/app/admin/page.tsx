import { auth, signOut } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { fmtNumber, statusLabel } from '@/lib/orders';
import { Plus, Package, AlertTriangle, CheckCircle2 } from 'lucide-react';
import AdminNav from './AdminNav';
import F5NewOrderShortcut from './F5NewOrderShortcut';
import RecentOrdersTable from './RecentOrdersTable';

export const dynamic = 'force-dynamic';

type RecentRange = 'latest20' | '7d' | '14d' | '1m' | '3m' | 'all';
type RecentSort = 'createdAt' | 'orderNo' | 'deliveryDate' | 'customer' | 'status';
type SortDir = 'asc' | 'desc';

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
    { value: 'orderNo', label: '주문번호' },
    { value: 'deliveryDate', label: '도착일' },
    { value: 'customer', label: '거래처' },
    { value: 'status', label: '상태' },
];

function isRecentRange(value?: string): value is RecentRange {
    return rangeOptions.some((option) => option.value === value);
}

function isRecentSort(value?: string): value is RecentSort {
    return sortOptions.some((option) => option.value === value);
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
    searchParams: Promise<{ recentRange?: string; recentSort?: string; recentDir?: string; recentOwner?: string; recentUserId?: string }>;
}) {
    const session = await auth();
    if (!session?.user) redirect('/login');
    if (session.user.userKind !== 'staff') redirect('/portal');

    const sp = await searchParams;
    const recentRange = isRecentRange(sp.recentRange) ? sp.recentRange : 'latest20';
    const recentSort = isRecentSort(sp.recentSort) ? sp.recentSort : 'createdAt';
    const recentDir: SortDir = sp.recentDir === 'asc' ? 'asc' : 'desc';
    const isYangHeeCheol = session.user.name === '양희철';
    const recentOwner = sp.recentOwner === 'mine' ? 'mine' : sp.recentOwner === 'user' && isYangHeeCheol ? 'user' : 'all';
    const selectedRecentUserId = isYangHeeCheol && recentOwner === 'user' ? sp.recentUserId ?? '' : '';

    const isHanwhaManager = session.user.role === 'EXECUTIVE' || session.user.role === 'ADMIN';
    const canManageCreditLimits = session.user.id === 'cmojpskkh0000994c99z7ro6d' || session.user.name === '양희철';

    // ── 통계 ────────────────────────────────────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
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

    const [todayCount, approvedTodayCount, onHoldCount, shippedTodayCount, recentRaw, staffUsers] = await Promise.all([
        prisma.order.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
        // 오늘 승인완료된 주문 수 (이후 배차 진행 포함, 보류/반려/삭제 제외)
        prisma.order.count({
            where: {
                deletedAt: null,
                status: { notIn: ['ON_HOLD', 'REJECTED', 'CANCELLED'] },
                statusHistory: { some: { newStatus: 'APPROVED', createdAt: { gte: today, lt: tomorrow } } },
            },
        }),
        prisma.order.count({ where: { status: 'ON_HOLD' } }),
        prisma.order.count({
            where: { status: { in: ['SHIPPED', 'COMPLETED'] }, updatedAt: { gte: today, lt: tomorrow } },
        }),
        prisma.order.findMany({
            where: { deletedAt: null, ...(recentStart ? { createdAt: { gte: recentStart } } : {}), ...recentOwnerWhere },
            orderBy: { createdAt: 'desc' },
            take: recentRange === 'latest20' ? 20 : undefined,
            include: {
                customer: { select: { companyName: true } },
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

    const recentRangeLabel = rangeOptions.find((option) => option.value === recentRange)?.label ?? '최신 20건';

    const cards = [
        { label: '오늘 신규 주문', value: todayCount, tone: 'blue' as const, Icon: Plus },
        { label: '오늘 승인완료', value: approvedTodayCount, tone: 'emerald' as const, Icon: CheckCircle2 },
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
                        <Link href="/settings" className="text-slate-500 hover:text-blue-600 transition text-sm">비밀번호 변경</Link>
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
                <h1 className="text-2xl font-bold text-slate-800 mb-4">대시보드</h1>

                <AdminNav isHanwhaManager={isHanwhaManager} canManageCreditLimits={canManageCreditLimits} />

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

                <F5NewOrderShortcut />

                {/* 신규 주문 등록 버튼 */}
                <Link
                    href="/admin/orders/new"
                    className="flex items-center justify-center gap-3 w-full rounded-2xl bg-slate-900 hover:bg-slate-700 text-white font-bold text-lg py-6 mb-6 shadow-md transition-colors"
                >
                    <Plus size={26} />
                    신규 주문 등록 (F5)
                </Link>

                {/* 최근 주문 */}
                <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                            <Package size={18} className="text-slate-500" />
                            <h2 className="font-semibold text-slate-800">최근 주문</h2>
                            <span className="text-xs text-slate-400">{recentRangeLabel} · {recent.length}건</span>
                        </div>
                        <form className="flex flex-wrap items-center gap-2 text-xs">
                            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                                <button
                                    type="submit"
                                    name="recentOwner"
                                    value="all"
                                    className={`rounded-md px-2.5 py-1.5 font-semibold ${recentOwner === 'all' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white'}`}
                                >
                                    전체오더보기
                                </button>
                                <button
                                    type="submit"
                                    name="recentOwner"
                                    value="mine"
                                    className={`rounded-md px-2.5 py-1.5 font-semibold ${recentOwner === 'mine' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-white'}`}
                                >
                                    내 오더만 보기
                                </button>
                            </div>
                            {isYangHeeCheol && (
                                <>
                                    <input type="hidden" name="recentOwner" value={recentOwner === 'user' ? 'user' : recentOwner} />
                                    <select name="recentUserId" defaultValue={selectedRecentUserId} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-700 outline-none focus:border-blue-500">
                                        <option value="">전체 담당자</option>
                                        {staffUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                                    </select>
                                    <button type="submit" name="recentOwner" value="user" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 font-semibold text-blue-700 hover:bg-blue-100">담당자 적용</button>
                                </>
                            )}
                            <select name="recentRange" defaultValue={recentRange} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-700 outline-none focus:border-blue-500">
                                {rangeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                            <select name="recentSort" defaultValue={recentSort} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-700 outline-none focus:border-blue-500">
                                {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}순</option>)}
                            </select>
                            <select name="recentDir" defaultValue={recentDir} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-700 outline-none focus:border-blue-500">
                                <option value="desc">내림차순</option>
                                <option value="asc">오름차순</option>
                            </select>
                            <button type="submit" className="rounded-lg bg-slate-800 px-3 py-1.5 font-semibold text-white hover:bg-slate-900">적용</button>
                        </form>
                    </div>

                    <RecentOrdersTable
                        orders={recent.map((o) => ({
                            id: o.id,
                            orderNo: o.orderNo,
                            status: o.status,
                            createdAt: o.createdAt.toISOString(),
                            requestedDeliveryDate: o.requestedDeliveryDate?.toISOString() ?? null,
                            customer: { companyName: o.customer.companyName },
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
                        initialSort={recentSort}
                        initialDir={recentDir}
                    />
                </section>
            </main>
        </div>
    );
}
