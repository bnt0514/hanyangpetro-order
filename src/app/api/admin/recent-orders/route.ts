import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { statusLabel } from '@/lib/orders';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

type RecentRange = 'latest20' | '7d' | '14d' | '1m' | '3m' | 'all';
type RecentSort = 'createdAt' | 'orderNo' | 'deliveryDate' | 'customer' | 'status';
type SortDir = 'asc' | 'desc';
type RecentStatus = 'all' | 'intake' | 'approved' | 'dispatchWaiting' | 'dispatched';

const rangeOptions: RecentRange[] = ['latest20', '7d', '14d', '1m', '3m', 'all'];
const sortOptions: RecentSort[] = ['createdAt', 'orderNo', 'deliveryDate', 'customer', 'status'];
const statusOptions: Record<RecentStatus, string[]> = {
    all: [],
    intake: ['REQUESTED', 'PENDING_SALES_REVIEW', 'SALES_REVIEWING', 'CREDIT_OVER_LIMIT', 'ON_HOLD'],
    approved: ['APPROVED', 'SUPPLIER_ORDER_REQUIRED'],
    dispatchWaiting: ['SUPPLIER_ORDER_COMPLETED', 'DISPATCH_WAITING', 'DISPATCHING', 'DISPATCH_FAILED', 'DISPATCH_RETRY_SCHEDULED'],
    dispatched: ['DISPATCH_COMPLETED', 'READY_TO_SHIP', 'SHIPPING', 'SHIPPED', 'DELIVERY_CONFIRM_PENDING'],
};

const dashboardOrderInclude = {
    customer: { select: { companyName: true, defaultSalesRepId: true, defaultSalesRep: { select: { name: true } } } },
    deliveryAddress: { select: { label: true } },
    items: { include: { product: { select: { productName: true } } } },
    requestedByUser: { select: { name: true } },
    requestedByCustomerUser: { select: { name: true } },
    deliveryDateChangeRequests: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } },
} as const;

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

function mapOrderRow(o: any) {
    return {
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
        items: o.items.map((it: any) => ({
            id: it.id,
            product: { productName: it.product.productName },
            requestedQuantity: it.requestedQuantity,
            unit: it.unit,
        })),
        requestedByUser: o.requestedByUser ?? null,
        requestedByCustomerUser: o.requestedByCustomerUser ?? null,
        deliveryDateChangeRequests: o.deliveryDateChangeRequests,
    };
}

export async function GET(req: NextRequest) {
    const session = await auth();
    if (!session?.user || session.user.userKind !== 'staff') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const params = req.nextUrl.searchParams;
    const recentRange = rangeOptions.includes(params.get('recentRange') as RecentRange) ? params.get('recentRange') as RecentRange : 'latest20';
    const recentSort = sortOptions.includes(params.get('recentSort') as RecentSort) ? params.get('recentSort') as RecentSort : 'createdAt';
    const recentDir: SortDir = params.get('recentDir') === 'asc' ? 'asc' : 'desc';
    const recentStatus = Object.keys(statusOptions).includes(params.get('recentStatus') ?? '')
        ? params.get('recentStatus') as RecentStatus
        : 'all';
    const recentOwnerParam = params.get('recentOwner');
    const recentOwner = recentOwnerParam === 'mine' ? 'mine' : 'all';
    const selectedRecentUserId = '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const recentStart = startDateForRange(recentRange, today);
    const ownerUserId = recentOwner === 'mine' ? session.user.id : selectedRecentUserId;
    const ownerWhere: Prisma.OrderWhereInput = ownerUserId
        ? { customer: { defaultSalesRepId: ownerUserId } }
        : {};
    const statusWhere: Prisma.OrderWhereInput = recentStatus === 'all'
        ? {}
        : { status: { in: statusOptions[recentStatus] as any } };

    const raw = await prisma.order.findMany({
        where: { deletedAt: null, ...(recentStart ? { createdAt: { gte: recentStart } } : {}), ...ownerWhere, ...statusWhere },
        orderBy: { createdAt: 'desc' },
        take: recentRange === 'latest20' ? 20 : undefined,
        include: dashboardOrderInclude as any,
    });

    const sorted = [...raw].sort((a: any, b: any) => {
        let result = 0;
        if (recentSort === 'createdAt') result = a.createdAt.getTime() - b.createdAt.getTime();
        if (recentSort === 'deliveryDate') result = (a.requestedDeliveryDate?.getTime() ?? 0) - (b.requestedDeliveryDate?.getTime() ?? 0);
        if (recentSort === 'orderNo') result = compareText(a.orderNo, b.orderNo);
        if (recentSort === 'customer') result = compareText(a.customer.companyName, b.customer.companyName);
        if (recentSort === 'status') result = compareText(statusLabel(a.status), statusLabel(b.status));
        return recentDir === 'asc' ? result : -result;
    });

    return NextResponse.json({ orders: sorted.map(mapOrderRow) });
}
