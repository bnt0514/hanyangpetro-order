'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, PauseCircle, XCircle, Truck, AlertCircle, Loader2, ExternalLink } from 'lucide-react';
import { changeOrderStatus, startHanwhaNewOrder } from '@/app/orders/actions';

const ALLOWED: Record<string, string[]> = {
    REQUESTED: ['APPROVED', 'ON_HOLD', 'REJECTED'],
    PENDING_SALES_REVIEW: ['APPROVED', 'ON_HOLD', 'REJECTED'],
    ON_HOLD: ['APPROVED', 'REJECTED'],
    APPROVED: ['DISPATCH_WAITING', 'CANCELLED'],
};

const META: Record<
    string,
    { label: string; icon: React.ComponentType<{ size?: number }>; cls: string; needsReason?: boolean }
> = {
    APPROVED: {
        label: '승인',
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

    const transitions = ALLOWED[currentStatus] ?? [];
    const showHanwhaOrderButton = canStartHanwhaOrder && currentStatus === 'APPROVED';
    const hanwhaOrdered = !!hanwhaOrderedAt;
    const hanwhaOrderedDateStr = hanwhaOrderedAt
        ? new Date(hanwhaOrderedAt).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : null;

    if (transitions.length === 0 && !showHanwhaOrderButton) {
        return (
            <section className="bg-slate-50 rounded-2xl border border-slate-200 p-5 text-sm text-slate-500 text-center">
                현재 상태({currentStatus})에서는 추가 액션이 없습니다.
            </section>
        );
    }

    function act(next: string) {
        if (next === 'DISPATCH_WAITING' && !hanwhaOrdered) {
            if (!window.confirm('한화오더가 완료되지 않았습니다.\n\n타사 오더인 경우, 혹은 이미 한화 오더가 완료된 경우라면 계속 진행하세요.')) return;
        }
        const meta = META[next];
        let reason: string | null = null;
        if (meta?.needsReason) {
            reason = window.prompt(`${meta.label} 사유를 입력하세요`);
            if (reason === null) return; // cancelled
        }
        setError(null);
        startTransition(async () => {
            const r = await changeOrderStatus(orderId, next, reason ?? undefined);
            if (!r.ok) {
                setError(r.error);
                return;
            }
            router.refresh();
        });
    }

    function startHanwhaOrder() {
        if (hanwhaOrdered) {
            if (!window.confirm(
                `이미 한화오더가 완료된 건입니다 (${hanwhaOrderedDateStr}).\n계속 진행 시 중복 오더가 될 수 있습니다.\n한화 오더 내역을 확인하신 후 진행하세요.\n\n계속 진행하시겠습니까?`
            )) return;
        } else {
            if (!window.confirm('한화 H-CRM 브라우저를 열고 새 주문 화면까지 자동 진행할까요?')) return;
        }
        setError(null);
        setMessage(null);
        startHanwhaTransition(async () => {
            const r = await startHanwhaNewOrder(orderId);
            if (!r.ok) {
                setError(r.error);
                return;
            }
            setMessage(r.message);
            router.refresh();
        });
    }

    return (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h2 className="font-semibold text-slate-800 mb-3">주문 처리</h2>
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
            <div className="flex flex-wrap gap-2 items-center">
                {transitions.map((next) => {
                    const m = META[next];
                    if (!m) return null;
                    const Icon = m.icon;
                    const isDispatchWaiting = next === 'DISPATCH_WAITING';
                    return (
                        <button
                            key={next}
                            type="button"
                            disabled={pending}
                            onClick={() => act(next)}
                            title={isDispatchWaiting && !hanwhaOrdered ? '한화오더 미완료 — 확인 후 이동 가능' : undefined}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm transition disabled:opacity-60 disabled:cursor-not-allowed ${m.cls} ${isDispatchWaiting && !hanwhaOrdered ? 'opacity-60' : ''}`}
                        >
                            {pending ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
                            {m.label}
                        </button>
                    );
                })}
                {showHanwhaOrderButton && (
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            disabled={hanwhaPending}
                            onClick={startHanwhaOrder}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {hanwhaPending ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
                            한화오더
                        </button>
                        {hanwhaOrdered && hanwhaOrderedDateStr && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                                <CheckCircle2 size={12} />
                                오더완료 {hanwhaOrderedDateStr}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}

