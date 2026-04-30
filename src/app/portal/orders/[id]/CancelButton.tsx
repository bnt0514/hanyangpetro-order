'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { XCircle, AlertCircle, Loader2 } from 'lucide-react';
import { cancelOwnOrder } from '@/app/orders/actions';

export default function CancelButton({ orderId }: { orderId: string }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    function onClick() {
        if (!window.confirm('이 주문을 취소하시겠습니까?')) return;
        setError(null);
        startTransition(async () => {
            const r = await cancelOwnOrder(orderId);
            if (!r.ok) {
                setError(r.error);
                return;
            }
            router.refresh();
        });
    }

    return (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            {error && (
                <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}
            <button
                type="button"
                onClick={onClick}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 text-sm font-semibold shadow-sm transition disabled:opacity-60"
            >
                {pending ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
                주문 취소
            </button>
            <p className="mt-2 text-xs text-slate-400">
                영업팀이 검토를 시작하기 전에만 취소할 수 있습니다.
            </p>
        </section>
    );
}
