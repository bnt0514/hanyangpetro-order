'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Loader2 } from 'lucide-react';
import { softDeleteOrder } from '@/app/orders/actions';

export default function DeleteOrderButton({ orderId }: { orderId: string }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    function handleDelete() {
        const reason = window.prompt(
            '⚠️ 주문 삭제 사유를 입력하세요.\n(삭제 후에도 내역은 보존됩니다)',
        );
        if (reason === null || !reason.trim()) return;

        setError(null);
        startTransition(async () => {
            const r = await softDeleteOrder(orderId, reason);
            if (r.ok) {
                router.push('/admin?deleted=1');
            } else {
                setError(r.error);
            }
        });
    }

    return (
        <div>
            <button
                onClick={handleDelete}
                disabled={pending}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium disabled:opacity-60 transition-colors"
            >
                {pending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                주문 삭제
            </button>
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>
    );
}
