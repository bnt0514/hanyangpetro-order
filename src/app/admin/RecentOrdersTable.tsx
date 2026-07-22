'use client';

import Link from 'next/link';
import { statusLabel, statusColor, fmtDate, fmtDateTime, fmtNumber } from '@/lib/orders';
import DashboardNextActionButton from './DashboardNextActionButton';

type RecentSort = 'createdAt' | 'orderNo' | 'deliveryDate' | 'customer' | 'status';
type SortDir = 'asc' | 'desc';

export type RecentOrderRow = {
    id: string;
    orderNo: string;
    status: string;
    createdAt: string;
    requestedDeliveryDate: string | null;
    customer: { companyName: string; defaultSalesRepId?: string | null; defaultSalesRep?: { name: string } | null };
    deliveryAddress: { label: string };
    items: { id: string; product: { productName: string }; requestedQuantity: number; unit: string }[];
    requestedByUser: { name: string } | null;
    requestedByCustomerUser: { name: string } | null;
    deliveryDateChangeRequests?: { status: string }[];
};

function compareText(a: string, b: string) {
    return a.localeCompare(b, 'ko-KR', { numeric: true, sensitivity: 'base' });
}

function normalizeSearch(value: string | null | undefined) {
    return (value ?? '').toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
}

function orderSearchText(order: RecentOrderRow) {
    return [
        order.orderNo,
        order.customer.companyName,
        order.customer.defaultSalesRep?.name,
        order.deliveryAddress.label,
        order.requestedByUser?.name,
        order.requestedByCustomerUser?.name,
        statusLabel(order.status),
        ...order.items.map((item) => item.product.productName),
    ].map((value) => normalizeSearch(value)).join(' ');
}

function SortHeader({
    label,
    sortKey,
    currentSort,
    dir,
    onSort,
}: {
    label: string;
    sortKey: RecentSort;
    currentSort: RecentSort;
    dir: SortDir;
    onSort: (key: RecentSort) => void;
}) {
    const active = currentSort === sortKey;
    const mark = active ? (dir === 'asc' ? '▲' : '▼') : '↕';
    return (
        <button
            type="button"
            onClick={() => onSort(sortKey)}
            className={`inline-flex items-center gap-1 hover:text-slate-900 ${active ? 'font-bold text-slate-800' : ''}`}
        >
            {label}<span className="text-[10px]">{mark}</span>
        </button>
    );
}

export default function RecentOrdersTable({
    orders,
    sort,
    dir,
    onSort,
    searchQuery = '',
}: {
    orders: RecentOrderRow[];
    sort: RecentSort;
    dir: SortDir;
    onSort: (sort: RecentSort, dir: SortDir) => void;
    searchQuery?: string;
}) {
    function handleSort(key: RecentSort) {
        const nextDir = sort === key ? (dir === 'asc' ? 'desc' : 'asc') : 'asc';
        onSort(key, nextDir);
    }

    const normalizedQuery = normalizeSearch(searchQuery);
    const filtered = normalizedQuery
        ? orders.filter((order) => orderSearchText(order).includes(normalizedQuery))
        : orders;

    const sorted = [...filtered].sort((a, b) => {
        let result = 0;
        if (sort === 'createdAt') result = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (sort === 'deliveryDate') result = (a.requestedDeliveryDate ? new Date(a.requestedDeliveryDate).getTime() : 0) - (b.requestedDeliveryDate ? new Date(b.requestedDeliveryDate).getTime() : 0);
        if (sort === 'orderNo') result = compareText(a.orderNo, b.orderNo);
        if (sort === 'customer') result = compareText(a.customer.companyName, b.customer.companyName);
        if (sort === 'status') result = compareText(statusLabel(a.status), statusLabel(b.status));
        return dir === 'asc' ? result : -result;
    });

    if (sorted.length === 0) {
        return (
            <div className="p-12 text-center text-sm text-slate-400">
                아직 등록된 주문이 없습니다.
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                        <th className="px-6 py-3"><SortHeader label="거래처" sortKey="customer" currentSort={sort} dir={dir} onSort={handleSort} /></th>
                        <th className="px-6 py-3">도착지</th>
                        <th className="px-6 py-3">제품</th>
                        <th className="px-6 py-3"><SortHeader label="도착일" sortKey="deliveryDate" currentSort={sort} dir={dir} onSort={handleSort} /></th>
                        <th className="px-6 py-3"><SortHeader label="상태" sortKey="status" currentSort={sort} dir={dir} onSort={handleSort} /></th>
                        <th className="px-6 py-3">접수자</th>
                        <th className="px-6 py-3"><SortHeader label="등록일시" sortKey="createdAt" currentSort={sort} dir={dir} onSort={handleSort} /></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {sorted.map((order) => (
                        <tr key={order.id} className="cursor-pointer transition hover:bg-blue-50/40">
                            <td className="px-6 py-3 font-medium text-slate-800">
                                <Link href={`/admin/orders/${order.id}`} className="block">
                                    {order.customer.companyName}
                                </Link>
                            </td>
                            <td className="px-6 py-3 text-slate-600">
                                <Link href={`/admin/orders/${order.id}`} className="block">
                                    {order.deliveryAddress.label}
                                </Link>
                            </td>
                            <td className="px-6 py-3 text-slate-600">
                                <Link href={`/admin/orders/${order.id}`} className="block">
                                    {order.items.map((item) => (
                                        <div key={item.id} className="text-xs">
                                            {item.product.productName}{' '}
                                            <span className="text-slate-400">
                                                ({fmtNumber(item.requestedQuantity)}{item.unit})
                                            </span>
                                        </div>
                                    ))}
                                </Link>
                            </td>
                            <td className="px-6 py-3 text-slate-600">
                                <Link href={`/admin/orders/${order.id}`} className="block">
                                    {fmtDate(order.requestedDeliveryDate ? new Date(order.requestedDeliveryDate) : null)}
                                </Link>
                            </td>
                            <td className="px-6 py-3">
                                <div className="flex items-center gap-2 whitespace-nowrap">
                                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor(order.status)}`}>
                                        {statusLabel(order.status)}
                                    </span>
                                    {order.deliveryDateChangeRequests?.[0] && (
                                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${order.deliveryDateChangeRequests[0].status === 'PENDING' ? 'bg-amber-100 text-amber-800' : order.deliveryDateChangeRequests[0].status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                            도착일요청
                                        </span>
                                    )}
                                    <DashboardNextActionButton orderId={order.id} currentStatus={order.status} />
                                </div>
                            </td>
                            <td className="px-6 py-3 text-xs text-slate-500">
                                {order.requestedByUser?.name ?? order.requestedByCustomerUser?.name ?? '-'}
                            </td>
                            <td className="px-6 py-3 text-xs text-slate-500">
                                {fmtDateTime(new Date(order.createdAt))}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
