'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { fmtNumber } from '@/lib/orders';
import RecentOrdersTable, { type RecentOrderRow } from './RecentOrdersTable';

type RecentRange = 'latest20' | '7d' | '14d' | '1m' | '3m' | 'all';
type RecentSort = 'createdAt' | 'orderNo' | 'deliveryDate' | 'customer' | 'status';
type SortDir = 'asc' | 'desc';
type RecentOwner = 'all' | 'mine' | 'user';
type StaffUserOption = { id: string; name: string };

type DashboardOrderStatusChangedEvent = CustomEvent<{ orderId?: string; status?: string }>;

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

function labelForRange(range: RecentRange) {
    return rangeOptions.find((option) => option.value === range)?.label ?? '최신 20건';
}

export default function RecentOrdersPanel({
    initialRows,
    initialRange,
    initialSort,
    initialDir,
    initialOwner,
    initialUserId,
    canViewAllRecentOrders,
    staffUsers = [],
}: {
    initialRows: RecentOrderRow[];
    initialRange: RecentRange;
    initialSort: RecentSort;
    initialDir: SortDir;
    initialOwner: RecentOwner;
    initialUserId: string;
    canViewAllRecentOrders: boolean;
    staffUsers?: StaffUserOption[];
}) {
    const [orders, setOrders] = useState(initialRows);
    const [range, setRange] = useState<RecentRange>(initialRange);
    const [sort, setSort] = useState<RecentSort>(initialSort);
    const [dir, setDir] = useState<SortDir>(initialDir);
    const [owner, setOwner] = useState<RecentOwner>(initialOwner);
    const [recentUserId, setRecentUserId] = useState(initialUserId);
    const [query, setQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        function handleStatusChanged(event: Event) {
            const { orderId, status } = (event as DashboardOrderStatusChangedEvent).detail ?? {};
            if (!orderId || !status) return;
            setOrders((prev) => prev.map((order) => (
                order.id === orderId ? { ...order, status } : order
            )));
        }

        window.addEventListener('dashboard-order-status-changed', handleStatusChanged);
        return () => window.removeEventListener('dashboard-order-status-changed', handleStatusChanged);
    }, []);

    async function load(next?: Partial<{ range: RecentRange; sort: RecentSort; dir: SortDir; owner: RecentOwner; recentUserId: string }>) {
        const nextRange = next?.range ?? range;
        const nextSort = next?.sort ?? sort;
        const nextDir = next?.dir ?? dir;
        const requestedOwner = canViewAllRecentOrders ? (next?.owner ?? owner) : 'mine';
        const requestedUserId = next?.recentUserId ?? recentUserId;
        const nextOwner = requestedOwner === 'user' && !requestedUserId ? 'all' : requestedOwner;
        const nextUserId = nextOwner === 'user' ? requestedUserId : '';

        setIsLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                recentRange: nextRange,
                recentSort: nextSort,
                recentDir: nextDir,
                recentOwner: nextOwner,
                recentUserId: nextUserId,
            });
            const res = await fetch(`/api/admin/recent-orders?${params.toString()}`, { cache: 'no-store' });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? '최근 주문을 불러오지 못했습니다.');
            setOrders(data.orders ?? []);
            setRange(nextRange);
            setSort(nextSort);
            setDir(nextDir);
            setOwner(nextOwner);
            setRecentUserId(nextUserId);
        } catch (err) {
            setError(err instanceof Error ? err.message : '최근 주문을 불러오지 못했습니다.');
        } finally {
            setIsLoading(false);
        }
    }

    function handleApply(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        void load();
    }

    return (
        <section className="overflow-hidden rounded-lg border border-orange-100 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                    <Package size={18} className="text-orange-500" />
                    <h2 className="font-semibold text-slate-800">최근 주문</h2>
                    <span className="text-xs text-slate-400">{labelForRange(range)} · {fmtNumber(orders.length)}건</span>
                    {isLoading && <span className="text-xs font-semibold text-orange-500">불러오는 중</span>}
                </div>
                <form onSubmit={handleApply} className="flex flex-wrap items-center gap-2 text-xs">
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="거래처명, 담당자명, 품목명 검색"
                        className="w-64 rounded-lg border border-orange-200 bg-white px-3 py-1.5 text-slate-700 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                    />
                    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                        {canViewAllRecentOrders && (
                            <button
                                type="button"
                                onClick={() => void load({ owner: 'all', recentUserId: '' })}
                                className={`rounded-md px-2.5 py-1.5 font-semibold ${owner === 'all' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white'}`}
                            >
                                전체오더보기
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => void load({ owner: 'mine', recentUserId: '' })}
                            className={`rounded-md px-2.5 py-1.5 font-semibold ${owner === 'mine' ? 'bg-orange-600 text-white' : 'text-slate-600 hover:bg-white'}`}
                        >
                            내 담당 거래처
                        </button>
                    </div>
                    {canViewAllRecentOrders && staffUsers.length > 0 && (
                        <select
                            value={owner === 'user' ? recentUserId : ''}
                            onChange={(e) => {
                                const userId = e.target.value;
                                void load(userId ? { owner: 'user', recentUserId: userId } : { owner: 'all', recentUserId: '' });
                            }}
                            className="rounded-lg border border-orange-200 bg-white px-2.5 py-1.5 text-slate-700 outline-none focus:border-orange-500"
                        >
                            <option value="">담당자별</option>
                            {staffUsers.map((user) => (
                                <option key={user.id} value={user.id}>{user.name}</option>
                            ))}
                        </select>
                    )}
                    <select value={range} onChange={(e) => setRange(e.target.value as RecentRange)} className="rounded-lg border border-orange-200 bg-white px-2.5 py-1.5 text-slate-700 outline-none focus:border-orange-500">
                        {rangeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <select value={sort} onChange={(e) => setSort(e.target.value as RecentSort)} className="rounded-lg border border-orange-200 bg-white px-2.5 py-1.5 text-slate-700 outline-none focus:border-orange-500">
                        {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}순</option>)}
                    </select>
                    <select value={dir} onChange={(e) => setDir(e.target.value as SortDir)} className="rounded-lg border border-orange-200 bg-white px-2.5 py-1.5 text-slate-700 outline-none focus:border-orange-500">
                        <option value="desc">내림차순</option>
                        <option value="asc">오름차순</option>
                    </select>
                    <button type="submit" className="rounded-lg bg-orange-600 px-3 py-1.5 font-semibold text-white hover:bg-orange-700" disabled={isLoading}>적용</button>
                </form>
            </div>
            {error && <div className="border-b border-red-100 bg-red-50 px-6 py-2 text-xs font-semibold text-red-700">{error}</div>}

            <RecentOrdersTable
                orders={orders}
                sort={sort}
                dir={dir}
                onSort={(nextSort, nextDir) => {
                    setSort(nextSort);
                    setDir(nextDir);
                }}
                searchQuery={query}
            />
        </section>
    );
}
