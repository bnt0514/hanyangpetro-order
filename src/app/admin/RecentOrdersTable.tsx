'use client';

import { useState } from 'react';
import Link from 'next/link';
import { statusLabel, statusColor, fmtDate, fmtDateTime, fmtNumber } from '@/lib/orders';
import DashboardNextActionButton from './DashboardNextActionButton';

type RecentSort = 'createdAt' | 'orderNo' | 'deliveryDate' | 'customer' | 'status';
type SortDir = 'asc' | 'desc';

export type RecentOrderRow = {
    id: string;
    orderNo: string;
    status: string;
    createdAt: string; // ISO string
    requestedDeliveryDate: string | null; // ISO string
    customer: { companyName: string };
    deliveryAddress: { label: string };
    items: { id: string; product: { productName: string }; requestedQuantity: number; unit: string }[];
    requestedByUser: { name: string } | null;
    requestedByCustomerUser: { name: string } | null;
    deliveryDateChangeRequests?: { status: string }[];
};

function compareText(a: string, b: string) {
    return a.localeCompare(b, 'ko-KR', { numeric: true, sensitivity: 'base' });
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
    initialSort,
    initialDir,
}: {
    orders: RecentOrderRow[];
    initialSort: RecentSort;
    initialDir: SortDir;
}) {
    const [sort, setSort] = useState<RecentSort>(initialSort);
    const [dir, setDir] = useState<SortDir>(initialDir);

    function handleSort(key: RecentSort) {
        if (sort === key) {
            setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSort(key);
            setDir('asc');
        }
    }

    const sorted = [...orders].sort((a, b) => {
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
                        <th className="px-6 py-3"><SortHeader label="주문번호" sortKey="orderNo" currentSort={sort} dir={dir} onSort={handleSort} /></th>
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
                    {sorted.map((o) => (
                        <tr
                            key={o.id}
                            className="hover:bg-blue-50/40 cursor-pointer transition"
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
                                    {fmtDate(o.requestedDeliveryDate ? new Date(o.requestedDeliveryDate) : null)}
                                </Link>
                            </td>
                            <td className="px-6 py-3">
                                <div className="flex items-center gap-2 whitespace-nowrap">
                                    <span
                                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor(o.status)}`}
                                    >
                                        {statusLabel(o.status)}
                                    </span>
                                    {o.deliveryDateChangeRequests?.[0] && (
                                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${o.deliveryDateChangeRequests[0].status === 'PENDING' ? 'bg-amber-100 text-amber-800' : o.deliveryDateChangeRequests[0].status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                            ⚠ 도착일요청
                                        </span>
                                    )}
                                    <DashboardNextActionButton orderId={o.id} currentStatus={o.status} />
                                </div>
                            </td>
                            <td className="px-6 py-3 text-xs text-slate-500">
                                {o.requestedByUser?.name ?? o.requestedByCustomerUser?.name ?? '-'}
                            </td>
                            <td className="px-6 py-3 text-xs text-slate-500">
                                {fmtDateTime(new Date(o.createdAt))}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
