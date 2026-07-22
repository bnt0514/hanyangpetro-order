'use client';

import { useCallback, useEffect, useRef, useState, useTransition, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, Search, Truck, XCircle } from 'lucide-react';
import {
    changeOrderStatus,
    completeHanwhaManualAction,
    getHanwhaOrderStatusCheckJobStatus,
    getHanwhaNewOrderJobStatus,
    startHanwhaNewOrder,
    startHanwhaNewOrderWithApproval,
    startHanwhaOrderStatusCheck,
} from '@/app/orders/actions';

const ALLOWED: Record<string, string[]> = {
    REQUESTED: ['APPROVED'],
    CREDIT_OVER_LIMIT: ['APPROVED'],
    APPROVED: ['DISPATCHING'],
    DISPATCH_COMPLETED: ['SHIPPED'],
};

const META: Record<
    string,
    { label: string; icon: ComponentType<{ size?: number; className?: string }>; cls: string; needsReason?: boolean }
> = {
    APPROVED: {
        label: '오더 승인',
        icon: CheckCircle2,
        cls: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    },
    REJECTED: {
        label: '반려',
        icon: XCircle,
        cls: 'bg-red-600 hover:bg-red-700 text-white',
        needsReason: true,
    },
    DISPATCHING: {
        label: '배차로 보내기',
        icon: Truck,
        cls: 'bg-sky-600 hover:bg-sky-700 text-white',
    },
    SHIPPED: {
        label: '출고완료',
        icon: CheckCircle2,
        cls: 'bg-orange-600 hover:bg-orange-700 text-white',
    },
};

function formatHanwhaOrderFailureReason(value: string | null | undefined) {
    const raw = (value ?? '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '').trim();
    if (/connectOverCDP.*timeout|timeout.*connectOverCDP/i.test(raw)) {
        return '한화 e-Sales Chrome 연결 시간이 초과되었습니다.';
    }
    if (/target page, context or browser has been closed/i.test(raw)) {
        return '한화 e-Sales Chrome 창 또는 연결이 작업 중 닫혔습니다.';
    }
    return raw.replace(/\s+/g, ' ').slice(0, 300) || '한화 e-Sales 자동 입력 중 오류가 발생했습니다.';
}

export default function StatusActions({
    orderId,
    currentStatus,
    canStartHanwhaOrder = false,
    hasHanwhaOrderItems = false,
    autoStartHanwhaOrder = false,
    hanwhaOrderedAt,
    hanwhaStatusText,
    hanwhaStatusCheckedAt,
    hanwhaStatusSource,
    canReorderHanwhaOrder = false,
    initialHanwhaOrderFailure = null,
}: {
    orderId: string;
    currentStatus: string;
    canStartHanwhaOrder?: boolean;
    hasHanwhaOrderItems?: boolean;
    autoStartHanwhaOrder?: boolean;
    canReorderHanwhaOrder?: boolean;
    hanwhaOrderedAt?: Date | string | null;
    hanwhaStatusText?: string | null;
    hanwhaStatusCheckedAt?: Date | string | null;
    hanwhaStatusSource?: string | null;
    initialHanwhaOrderFailure?: {
        reason: string;
        failedAt: string | null;
    } | null;
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [hanwhaPending, startHanwhaTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [hanwhaJobId, setHanwhaJobId] = useState<string | null>(null);
    const [hanwhaStatusJobId, setHanwhaStatusJobId] = useState<string | null>(null);
    const [waitingManualAction, setWaitingManualAction] = useState(false);
    const [manualTitle, setManualTitle] = useState('수동 조치가 필요합니다');
    const [manualButtonLabel, setManualButtonLabel] = useState('완료 후 계속');
    const [hanwhaOrderFailure, setHanwhaOrderFailure] = useState(initialHanwhaOrderFailure);
    const autoHanwhaStartedRef = useRef(false);

    const transitions = ALLOWED[currentStatus] ?? [];
    const showHanwhaStatusButton = canStartHanwhaOrder;
    const hanwhaOrdered = !!hanwhaOrderedAt;
    const showHanwhaOrderButton = canStartHanwhaOrder
        && currentStatus === 'APPROVED'
        && !hanwhaOrdered
        && (!autoStartHanwhaOrder || Boolean(hanwhaOrderFailure));
    const showHanwhaReorderButton = canStartHanwhaOrder
        && canReorderHanwhaOrder
        && hanwhaOrdered
        && (currentStatus === 'APPROVED' || currentStatus === 'DISPATCHING');
    const hanwhaOrderedDateStr = hanwhaOrderedAt
        ? new Date(hanwhaOrderedAt).toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        })
        : null;
    const hanwhaStatusDateStr = hanwhaStatusCheckedAt
        ? new Date(hanwhaStatusCheckedAt).toLocaleString('ko-KR', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        })
        : null;
    const hanwhaOrderFailureDateStr = hanwhaOrderFailure?.failedAt
        ? new Date(hanwhaOrderFailure.failedAt).toLocaleString('ko-KR', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        })
        : null;

    const queueHanwhaOrderWithApproval = useCallback(async () => {
        setHanwhaOrderFailure(null);
        const result = await startHanwhaNewOrderWithApproval(orderId);
        if (!result.ok) {
            setError(result.error);
            return;
        }
        setMessage(result.message);
        setHanwhaJobId(result.jobId);
        setWaitingManualAction(result.status === 'WAITING_MANUAL_ACTION');
        setManualTitle(result.manualTitle ?? '수동 조치가 필요합니다');
        setManualButtonLabel(result.manualButtonLabel ?? '완료 후 계속');
    }, [orderId]);

    useEffect(() => {
        if (!autoStartHanwhaOrder || autoHanwhaStartedRef.current || hanwhaOrderFailure) return;
        autoHanwhaStartedRef.current = true;
        setError(null);
        setMessage(null);
        startHanwhaTransition(async () => {
            await queueHanwhaOrderWithApproval();
        });
    }, [autoStartHanwhaOrder, hanwhaOrderFailure, queueHanwhaOrderWithApproval]);

    useEffect(() => {
        if (!hanwhaJobId) return;
        const activeJobId = hanwhaJobId;
        let cancelled = false;

        async function poll() {
            const result = await getHanwhaNewOrderJobStatus(activeJobId);
            if (cancelled) return;

            if (!result.ok) {
                setError(result.error);
                setHanwhaJobId(null);
                return;
            }

            if (result.status === 'QUEUED') {
                setMessage(`한화 e-Sales 입력 대기 중입니다. 현재 ${result.position}번째입니다.`);
                return;
            }

            if (result.status === 'RUNNING') {
                setWaitingManualAction(false);
                setMessage('한화 e-Sales 입력을 진행 중입니다.');
                return;
            }

            if (result.status === 'WAITING_MANUAL_ACTION') {
                setWaitingManualAction(true);
                setManualTitle(result.manualTitle ?? '수동 조치가 필요합니다');
                setManualButtonLabel(result.manualButtonLabel ?? '완료 후 계속');
                setMessage(result.message ?? 'e-Sales에서 필요한 수동 조치를 완료한 뒤 계속 버튼을 눌러주세요.');
                return;
            }

            if (result.status === 'DONE') {
                setWaitingManualAction(false);
                setMessage(result.message ?? '한화 e-Sales 입력을 완료했습니다.');
                setHanwhaJobId(null);
                router.refresh();
                return;
            }

            if (result.status === 'FAILED') {
                setWaitingManualAction(false);
                setError(null);
                setHanwhaOrderFailure({
                    reason: formatHanwhaOrderFailureReason(result.error),
                    failedAt: new Date().toISOString(),
                });
                setHanwhaJobId(null);
            }
        }

        void poll();
        const timer = window.setInterval(() => void poll(), 2000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [hanwhaJobId, router]);

    useEffect(() => {
        if (!hanwhaStatusJobId) return;
        const activeJobId = hanwhaStatusJobId;
        let cancelled = false;

        async function poll() {
            const result = await getHanwhaOrderStatusCheckJobStatus(activeJobId);
            if (cancelled) return;

            if (!result.ok) {
                setError(result.error);
                setHanwhaStatusJobId(null);
                return;
            }

            if (result.job.status === 'DONE') {
                setMessage(result.message || `한화 주문상태확인이 완료되었습니다.${result.status ? ` 현재 상태: ${result.status}` : ''}`);
                setHanwhaStatusJobId(null);
                router.refresh();
                return;
            }

            if (result.job.status === 'FAILED') {
                setError(result.job.error || result.job.message || '한화 주문상태확인 중 오류가 발생했습니다.');
                setHanwhaStatusJobId(null);
                router.refresh();
                return;
            }

            setMessage(result.job.message || '한화 주문상태확인이 백그라운드에서 진행 중입니다.');
        }

        void poll();
        const timer = window.setInterval(() => void poll(), 2000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [hanwhaStatusJobId, router]);

    if (transitions.length === 0 && !showHanwhaOrderButton && !showHanwhaStatusButton) {
        return (
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-500">
                현재 상태에서 추가 작업이 없습니다.
            </section>
        );
    }

    function act(next: string) {
        const meta = META[next];
        let reason: string | null = null;
        if (meta?.needsReason) {
            reason = window.prompt(`${meta.label} 사유를 입력하세요.`);
            if (reason === null) return;
        }

        setError(null);
        startTransition(async () => {
            const result = await changeOrderStatus(orderId, next, reason ?? undefined);
            if (!result.ok) {
                setError(result.error);
                return;
            }
            if (next === 'APPROVED' && hasHanwhaOrderItems) {
                await queueHanwhaOrderWithApproval();
            }
            router.refresh();
        });
    }

    function startHanwhaOrder() {
        const confirmed = window.confirm('한화오더를 진행할까요?');
        if (!confirmed) return;

        setError(null);
        setMessage(null);
        startHanwhaTransition(async () => {
            await queueHanwhaOrderWithApproval();
        });
    }

    function startHanwhaReorder() {
        const confirmed = window.confirm('이미 한화 오더가 정상 완료된 상태입니다. 재오더 하시겠습니까?');
        if (!confirmed) return;

        setError(null);
        setMessage(null);
        startHanwhaTransition(async () => {
            const result = await startHanwhaNewOrderWithApproval(orderId);
            if (!result.ok) {
                setError(result.error);
                return;
            }
            setMessage(result.message);
            setHanwhaJobId(result.jobId);
            setWaitingManualAction(result.status === 'WAITING_MANUAL_ACTION');
            setManualTitle(result.manualTitle ?? '수동 조치가 필요합니다');
            setManualButtonLabel(result.manualButtonLabel ?? '완료 후 계속');
        });
    }

    function startHanwhaOrderTest() {
        setError(null);
        setMessage(null);
        startHanwhaTransition(async () => {
            const result = await startHanwhaNewOrder(orderId);
            if (!result.ok) {
                setError(result.error);
                return;
            }
            setMessage(result.message);
            setHanwhaJobId(result.jobId);
            setWaitingManualAction(result.status === 'WAITING_MANUAL_ACTION');
            setManualTitle(result.manualTitle ?? '수동 조치가 필요합니다');
            setManualButtonLabel(result.manualButtonLabel ?? '완료 후 계속');
        });
    }

    function checkHanwhaStatus() {
        setError(null);
        setMessage(null);
        startHanwhaTransition(async () => {
            const result = await startHanwhaOrderStatusCheck(orderId);
            if (!result.ok) {
                setError(result.error);
                return;
            }
            setMessage(result.message);
            if ('queued' in result) {
                setHanwhaStatusJobId(result.job.id);
            } else {
                setHanwhaStatusJobId(null);
                router.refresh();
            }
        });
    }

    function completeManualAction() {
        if (!hanwhaJobId) return;
        setError(null);
        setMessage('수동 조치 이후 자동 입력을 이어서 진행 중입니다.');
        setWaitingManualAction(false);
        startHanwhaTransition(async () => {
            const result = await completeHanwhaManualAction(hanwhaJobId);
            if (!result.ok) {
                setError(result.error);
                setWaitingManualAction(true);
                return;
            }
            setMessage(result.message);
            if (result.status === 'DONE') {
                setHanwhaJobId(null);
                router.refresh();
            } else {
                setWaitingManualAction(result.status === 'WAITING_MANUAL_ACTION');
                setManualTitle(result.manualTitle ?? '수동 조치가 필요합니다');
                setManualButtonLabel(result.manualButtonLabel ?? '완료 후 계속');
            }
        });
    }

    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-slate-800">주문 처리</h2>
            {currentStatus === 'CREDIT_OVER_LIMIT' && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span>여신초과 상태입니다. 여신초과 승인 완료 후에만 오더승인으로 진행할 수 있습니다.</span>
                </div>
            )}

            {error && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {hanwhaOrderFailure && !hanwhaOrdered && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <div className="min-w-0">
                        <p className="font-semibold">한화오더 시도 실패</p>
                        <p className="mt-0.5">자동 한화오더를 완료하지 못했습니다. 아래 한화오더 버튼을 직접 눌러 다시 시도해주세요.</p>
                        <p className="mt-1 break-words text-xs text-red-600">
                            {hanwhaOrderFailureDateStr && `${hanwhaOrderFailureDateStr} · `}
                            {hanwhaOrderFailure.reason}
                        </p>
                    </div>
                </div>
            )}

            {message && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                    <span>{message}</span>
                </div>
            )}

            {autoStartHanwhaOrder && !hanwhaJobId && !hanwhaOrderFailure && !error && !message && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
                    <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" />
                    <span>한화 e-Sales 주문을 자동으로 시작하고 있습니다.</span>
                </div>
            )}

            {hanwhaStatusText && (
                <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 size={12} />
                    <span>한화 주문상태 {hanwhaStatusText}</span>
                    {hanwhaStatusDateStr && <span className="text-emerald-500">· {hanwhaStatusDateStr}</span>}
                    {hanwhaStatusSource === 'MANUAL_TODAY_SHIPPING' && <span className="text-emerald-500">· 수동 승인</span>}
                </div>
            )}

            {currentStatus === 'DISPATCHING' && (
                <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                    <Truck size={12} />
                    <span>배차중입니다. 배차조회에서 매칭되면 배차완료로 처리됩니다.</span>
                </div>
            )}

            {waitingManualAction && hanwhaJobId && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <span>{manualTitle}</span>
                    <button
                        type="button"
                        disabled={hanwhaPending}
                        onClick={completeManualAction}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                    >
                        {hanwhaPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                        {manualButtonLabel}
                    </button>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
                {transitions.map((next) => {
                    const meta = META[next];
                    if (!meta) return null;

                    const Icon = meta.icon;

                    return (
                        <button
                            key={next}
                            type="button"
                            disabled={pending}
                            onClick={() => act(next)}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${meta.cls}`}
                        >
                            {pending ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
                            {meta.label}
                        </button>
                    );
                })}

                {(showHanwhaOrderButton || showHanwhaReorderButton || showHanwhaStatusButton) && (
                    <div className="flex flex-wrap items-center gap-2">
                        {showHanwhaOrderButton && (
                            <button
                                type="button"
                                disabled={hanwhaPending || Boolean(hanwhaJobId)}
                                onClick={startHanwhaOrder}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {hanwhaPending || hanwhaJobId ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
                                한화오더
                            </button>
                        )}

                        {showHanwhaReorderButton && (
                            <button
                                type="button"
                                disabled={hanwhaPending || Boolean(hanwhaJobId)}
                                onClick={startHanwhaReorder}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {hanwhaPending || hanwhaJobId ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
                                한화 재오더
                            </button>
                        )}

                        <button
                            type="button"
                            disabled={hanwhaPending || Boolean(hanwhaJobId) || Boolean(hanwhaStatusJobId)}
                            onClick={checkHanwhaStatus}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {hanwhaPending || hanwhaJobId || hanwhaStatusJobId ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                            주문상태확인
                        </button>

                        {showHanwhaOrderButton && (
                            <button
                                type="button"
                                disabled={hanwhaPending || Boolean(hanwhaJobId)}
                                onClick={startHanwhaOrderTest}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {hanwhaPending || hanwhaJobId ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                                테스트
                            </button>
                        )}

                        {hanwhaOrdered && hanwhaOrderedDateStr && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                                <CheckCircle2 size={12} />
                                한화 오더 완료 {hanwhaOrderedDateStr}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}
