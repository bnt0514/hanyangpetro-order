'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import {
    AlertCircle,
    CalendarCheck,
    CheckCircle2,
    Loader2,
    MapPin,
    PackageCheck,
    RefreshCw,
    Search,
    Truck,
} from 'lucide-react';
import {
    approveTodayShipmentOrder,
    fetchHanwhaTodayShipmentStatus,
    getHanwhaTodayShipmentJobStatus,
    refetchHanwhaTodayShipmentStatus,
    type TodayShipmentOrderVM,
    type TodayShipmentView,
} from '@/app/today-shipping/actions';
import { fmtDateTime, fmtNumber } from '@/lib/orders';

function statusClassName(state: TodayShipmentOrderVM['matchState']) {
    if (state === 'MATCHED') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (state === 'NOT_FETCHED' || state === 'NOT_HANWHA' || state === 'NO_HANWHA_ORDER_DATE') return 'bg-slate-100 text-slate-700 border-slate-200';
    if (state === 'AMBIGUOUS' || state === 'MISMATCH') return 'bg-amber-100 text-amber-800 border-amber-200';
    if (state === 'SNAPSHOT_FAILED') return 'bg-red-100 text-red-800 border-red-200';
    return 'bg-rose-100 text-rose-800 border-rose-200';
}

function snapshotMessage(view: TodayShipmentView) {
    if (!view.snapshot) return '저장된 한화 상태조회 결과가 없습니다.';
    if (view.snapshot.status === 'OK') {
        return `마지막 조회 ${fmtDateTime(view.snapshot.fetchedAt)} · e-Sales 행 ${view.snapshot.rowCount}건`;
    }
    return `마지막 조회 ${fmtDateTime(view.snapshot.fetchedAt)} · ${view.snapshot.errorMessage ?? '조회 실패'}`;
}

export default function TodayShippingClient({ initialView }: { initialView: TodayShipmentView }) {
    const [view, setView] = useState(initialView);
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const [activeJobId, setActiveJobId] = useState<string | null>(null);

    function run(action: 'fetch' | 'refetch') {
        setError(null);
        setInfo(null);
        startTransition(async () => {
            const result = action === 'fetch'
                ? await fetchHanwhaTodayShipmentStatus(view.orderDate)
                : await refetchHanwhaTodayShipmentStatus(view.orderDate);

            if (!result.ok) {
                setError(result.error);
                if (result.view) setView(result.view);
                return;
            }

            if ('queued' in result) {
                setActiveJobId(result.job.id);
                setView(result.view);
                setInfo(result.message);
                return;
            }

            setActiveJobId(null);
            setView(result.view);
            setInfo(
                result.cached
                    ? `저장된 조회 결과 ${result.rowCount}건을 표시합니다.`
                    : `한화 e-Sales에서 새로 조회한 ${result.rowCount}건을 저장했습니다.`,
            );
        });
    }

    useEffect(() => {
        if (!activeJobId) return;
        const jobId = activeJobId;
        let cancelled = false;

        async function poll() {
            const result = await getHanwhaTodayShipmentJobStatus(jobId);
            if (cancelled) return;

            if (!result.ok) {
                setError(result.error);
                setActiveJobId(null);
                return;
            }

            setView(result.view);

            if (result.job.status === 'DONE') {
                setInfo(result.job.message || '금일출고예정 조회가 완료되었습니다.');
                setActiveJobId(null);
                return;
            }

            if (result.job.status === 'FAILED') {
                setError(result.job.error || result.job.message || '금일출고예정 조회에 실패했습니다.');
                setActiveJobId(null);
                return;
            }

            setInfo(result.job.message || '금일출고예정 조회가 백그라운드에서 진행 중입니다.');
        }

        void poll();
        const timer = window.setInterval(() => void poll(), 2000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [activeJobId]);

    function approveOrder(orderId: string) {
        setError(null);
        setInfo(null);
        startTransition(async () => {
            const result = await approveTodayShipmentOrder(orderId);
            if (!result.ok) {
                setError(result.error);
                if (result.view) setView(result.view);
                return;
            }

            setView(result.view);
            setInfo('승인으로 처리했습니다.');
        });
    }

    return (
        <div className="space-y-4 md:space-y-5">
            <section className="rounded-lg border border-orange-200 bg-white p-4 shadow-sm md:p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-orange-700">
                            <CalendarCheck size={20} />
                            <h1 className="text-xl font-black text-slate-900 md:text-2xl">금일 출고예정</h1>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
                            <span className="rounded-md bg-slate-100 px-2.5 py-1">오더 {view.orders.length}건</span>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {!view.snapshot ? (
                            <button
                                type="button"
                                onClick={() => run('fetch')}
                                disabled={pending || Boolean(activeJobId)}
                                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-orange-600 px-4 text-sm font-black text-white shadow-sm hover:bg-orange-700 disabled:opacity-60"
                            >
                                {pending || activeJobId ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                                한화 상태조회
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => {
                                    if (!window.confirm('한화 e-Sales에서 금일 출고예정 상태를 새로 조회할까요? 기존 저장 결과는 새 데이터로 교체됩니다.')) return;
                                    run('refetch');
                                }}
                                disabled={pending || Boolean(activeJobId)}
                                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-amber-500 px-4 text-sm font-black text-white shadow-sm hover:bg-amber-600 disabled:opacity-60"
                            >
                                {pending || activeJobId ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                                재조회
                            </button>
                        )}
                    </div>
                </div>

                <div className="mt-4 flex justify-start">
                    <Link
                        href="/admin/dispatch"
                        className="flex h-[7.5rem] w-36 flex-col justify-between rounded-lg border border-slate-300 bg-slate-50 p-3 shadow-sm transition hover:border-slate-500 hover:bg-white"
                    >
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white">
                            <Truck size={18} />
                        </span>
                        <span className="text-sm font-black leading-tight text-slate-900">
                            배차조회<br />
                            바로가기
                        </span>
                    </Link>
                </div>

                <p className={`mt-3 text-xs font-semibold ${view.snapshot?.status === 'FAILED' || view.snapshot?.status === 'AUTH_FAILED' ? 'text-red-700' : 'text-slate-500'}`}>
                    {snapshotMessage(view)}
                </p>

                {pending && (
                    <p className="mt-3 text-xs font-semibold text-slate-500">
                        금일출고예정 조회 작업을 등록하는 중입니다.
                    </p>
                )}
                {activeJobId && !pending && (
                    <p className="mt-3 text-xs font-semibold text-slate-500">
                        백그라운드에서 금일출고예정 조회가 진행 중입니다. 완료되면 자동으로 반영됩니다.
                    </p>
                )}

                {error && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                        <AlertCircle size={16} className="mt-0.5 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {info && !error && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
                        <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                        <span>{info}</span>
                    </div>
                )}
            </section>

            {view.orders.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm font-semibold text-slate-400">
                    금일 출고예정 한화 오더가 없습니다.
                </div>
            ) : (
                <div className="grid gap-3">
                    {view.orders.map((order) => (
                        <div
                            key={order.id}
                            className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange-200 hover:shadow-md"
                        >
                            <Link href={`/admin/orders/${order.id}`} className="block">
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-mono text-xs font-black text-slate-400">{order.orderNo}</span>
                                            <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${statusClassName(order.matchState)}`}>
                                                {order.hanwhaStatus}
                                            </span>
                                            {order.sameDayDelivery && (
                                                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">
                                                    당일도착
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-2 flex items-center gap-1.5 text-base font-black text-slate-900">
                                            <MapPin size={16} className="shrink-0 text-orange-500" />
                                            <span className="truncate">{order.shipToName}</span>
                                        </div>
                                        <p className="mt-1 text-xs font-semibold text-slate-500">
                                            {order.customerName} · 도착 {order.deliveryDate}
                                        </p>
                                    </div>
                                    <div className="rounded-md bg-orange-50 px-3 py-2 text-right text-xs font-black text-orange-800 md:min-w-24">
                                        {fmtNumber(order.items.reduce((sum, item) => sum + item.quantityTon, 0))} TON
                                    </div>
                                </div>

                                <div className="mt-3 grid gap-2">
                                    {order.items.map((item) => (
                                        <div key={`${order.id}-${item.productName}-${item.materialName}`} className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5 text-sm font-black text-slate-800">
                                                    <PackageCheck size={14} className="shrink-0 text-slate-400" />
                                                    <span className="truncate">{item.productName}</span>
                                                </div>
                                                <p className="mt-0.5 truncate text-xs font-semibold text-slate-400">
                                                    {item.materialName}{item.itemCode ? ` · ${item.itemCode}` : ''}
                                                </p>
                                            </div>
                                            <span className="shrink-0 text-sm font-black text-slate-700">{fmtNumber(item.quantityTon)} TON</span>
                                        </div>
                                    ))}
                                </div>

                                {order.matchNote && (
                                    <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                                        {order.matchNote}
                                    </p>
                                )}
                            </Link>

                            {order.canManualApprove && order.hanwhaStatus !== '승인' && (
                                <div className="mt-3 flex justify-end border-t border-slate-100 pt-3">
                                    <button
                                        type="button"
                                        onClick={() => approveOrder(order.id)}
                                        disabled={pending}
                                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                                    >
                                        {pending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                        승인처리
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
