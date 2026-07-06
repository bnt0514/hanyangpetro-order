'use client';

import { useEffect, useState, useTransition, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, PauseCircle, Search, Truck, XCircle } from 'lucide-react';
import { changeOrderStatus, checkHanwhaOrderStatus, completeHanwhaManualAction, getHanwhaNewOrderJobStatus, startHanwhaNewOrder, startHanwhaNewOrderWithApproval } from '@/app/orders/actions';

const ALLOWED: Record<string, string[]> = {
    REQUESTED: ['APPROVED', 'ON_HOLD', 'REJECTED'],
    PENDING_SALES_REVIEW: ['APPROVED', 'ON_HOLD', 'REJECTED'],
    CREDIT_OVER_LIMIT: ['APPROVED', 'ON_HOLD', 'REJECTED'],
    ON_HOLD: ['APPROVED', 'REJECTED'],
    APPROVED: ['DISPATCH_WAITING'],
};

const META: Record<
    string,
    { label: string; icon: ComponentType<{ size?: number; className?: string }>; cls: string; needsReason?: boolean }
> = {
    APPROVED: {
        label: '오더승인',
        icon: CheckCircle2,
        cls: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    },
    ON_HOLD: {
        label: '보류',
        icon: PauseCircle,
        cls: 'bg-amber-500 hover:bg-amber-600 text-white',
        needsReason: true,
    },
    REJECTED: {
        label: '반려',
        icon: XCircle,
        cls: 'bg-red-600 hover:bg-red-700 text-white',
        needsReason: true,
    },
    DISPATCH_WAITING: {
        label: '배차 대기로 보냄',
        icon: Truck,
        cls: 'bg-indigo-600 hover:bg-indigo-700 text-white',
    },
    CANCELLED: {
        label: '취소',
        icon: XCircle,
        cls: 'bg-slate-500 hover:bg-slate-600 text-white',
        needsReason: true,
    },
};

export default function StatusActions({
    orderId,
    currentStatus,
    canStartHanwhaOrder = false,
    hanwhaOrderedAt,
}: {
    orderId: string;
    currentStatus: string;
    canStartHanwhaOrder?: boolean;
    hanwhaOrderedAt?: Date | string | null;
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [hanwhaPending, startHanwhaTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [hanwhaJobId, setHanwhaJobId] = useState<string | null>(null);
    const [waitingManualAction, setWaitingManualAction] = useState(false);
    const [manualTitle, setManualTitle] = useState('수동 조치가 필요합니다');
    const [manualButtonLabel, setManualButtonLabel] = useState('완료 후 계속');

    const transitions = ALLOWED[currentStatus] ?? [];
    const showHanwhaOrderButton = canStartHanwhaOrder && currentStatus === 'APPROVED';
    const showHanwhaStatusButton = canStartHanwhaOrder;
    const hanwhaOrdered = !!hanwhaOrderedAt;
    const hanwhaOrderedDateStr = hanwhaOrderedAt
        ? new Date(hanwhaOrderedAt).toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        })
        : null;

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
                setMessage(`한화 e-Sales 열기 대기 중입니다. 현재 ${result.position}번째입니다.`);
                return;
            }

            if (result.status === 'RUNNING') {
                setWaitingManualAction(false);
                setMessage('한화 e-Sales 바로가기를 여는 중입니다.');
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
                setMessage(result.message ?? '한화 e-Sales 바로가기를 열었습니다.');
                setHanwhaJobId(null);
                router.refresh();
                return;
            }

            if (result.status === 'FAILED') {
                setWaitingManualAction(false);
                setError(result.error ?? '한화 e-Sales 열기 중 오류가 발생했습니다.');
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

    if (transitions.length === 0 && !showHanwhaOrderButton && !showHanwhaStatusButton) {
        return (
            <section className="bg-slate-50 rounded-2xl border border-slate-200 p-5 text-sm text-slate-500 text-center">
                현재 상태({currentStatus})에서는 추가 액션이 없습니다.
            </section>
        );
    }

    function act(next: string) {
        if (next === 'DISPATCH_WAITING' && !hanwhaOrdered) {
            const confirmed = window.confirm(
                '한화 e-Sales 처리 완료 기록이 없습니다.\n\n한화 직오더가 필요한 주문이면 e-Sales에서 먼저 처리했는지 확인해주세요. 계속 진행할까요?',
            );
            if (!confirmed) return;
        }

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
            router.refresh();
        });
    }

    function startHanwhaOrder() {
        const confirmed = window.confirm('한화오더를 진행할까요?');
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
            setManualTitle(result.manualTitle ?? '수동 조치가 필요합니다.');
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
            setManualTitle(result.manualTitle ?? '수동 조치가 필요합니다.');
            setManualButtonLabel(result.manualButtonLabel ?? '완료 후 계속');
        });
    }

    function checkHanwhaStatus() {
        setError(null);
        setMessage(null);
        startHanwhaTransition(async () => {
            const result = await checkHanwhaOrderStatus(orderId);
            if (!result.ok) {
                setError(result.error);
                return;
            }
            setMessage(result.message);
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
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h2 className="font-semibold text-slate-800 mb-3">주문 처리</h2>
            {currentStatus === 'CREDIT_OVER_LIMIT' && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span>여신초과 상태입니다. 승인권자 승인 완료 후에만 오더승인으로 진행할 수 있습니다.</span>
                </div>
            )}

            {error && (
                <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {message && (
                <div className="mb-3 flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                    <span>{message}</span>
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

            <div className="flex flex-wrap gap-2 items-center">
                {transitions.map((next) => {
                    const meta = META[next];
                    if (!meta) return null;

                    const Icon = meta.icon;
                    const isDispatchWaiting = next === 'DISPATCH_WAITING';

                    return (
                        <button
                            key={next}
                            type="button"
                            disabled={pending}
                            onClick={() => act(next)}
                            title={isDispatchWaiting && !hanwhaOrdered ? '한화 e-Sales 처리 여부 확인 후 이동 가능합니다.' : undefined}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm transition disabled:opacity-60 disabled:cursor-not-allowed ${meta.cls} ${isDispatchWaiting && !hanwhaOrdered ? 'opacity-60' : ''}`}
                        >
                            {pending ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
                            {meta.label}
                        </button>
                    );
                })}

                {(showHanwhaOrderButton || showHanwhaStatusButton) && (
                    <div className="flex items-center gap-2">
                        {showHanwhaOrderButton && (
                            <button
                                type="button"
                                disabled={hanwhaPending || Boolean(hanwhaJobId)}
                                onClick={startHanwhaOrder}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {hanwhaPending || hanwhaJobId ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
                                한화오더
                            </button>
                        )}

                        <button
                            type="button"
                            disabled={hanwhaPending || Boolean(hanwhaJobId)}
                            onClick={checkHanwhaStatus}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {hanwhaPending || hanwhaJobId ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                            주문상태확인
                        </button>

                        {showHanwhaOrderButton && (
                            <button
                                type="button"
                                disabled={hanwhaPending || Boolean(hanwhaJobId)}
                                onClick={startHanwhaOrderTest}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {hanwhaPending || hanwhaJobId ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                                테스트
                            </button>
                        )}

                        {hanwhaOrdered && hanwhaOrderedDateStr && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                                <CheckCircle2 size={12} />
                                기존 오더완료 {hanwhaOrderedDateStr}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}
