'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, PauseCircle, XCircle, Truck, AlertCircle, Loader2 } from 'lucide-react';
import { changeOrderStatus } from '@/app/orders/actions';

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
}: {
    orderId: string;
    currentStatus: string;
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    const transitions = ALLOWED[currentStatus] ?? [];

    if (transitions.length === 0) {
        return (
            <section className="bg-slate-50 rounded-2xl border border-slate-200 p-5 text-sm text-slate-500 text-center">
                현재 상태({currentStatus})에서는 추가 액션이 없습니다.
            </section>
        );
    }

    function act(next: string) {
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

    return (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h2 className="font-semibold text-slate-800 mb-3">주문 처리</h2>
            {error && (
                <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}
            <div className="flex flex-wrap gap-2">
                {transitions.map((next) => {
                    const m = META[next];
                    if (!m) return null;
                    const Icon = m.icon;
                    return (
                        <button
                            key={next}
                            type="button"
                            disabled={pending}
                            onClick={() => act(next)}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm transition disabled:opacity-60 disabled:cursor-not-allowed ${m.cls}`}
                        >
                            {pending ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
                            {m.label}
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
