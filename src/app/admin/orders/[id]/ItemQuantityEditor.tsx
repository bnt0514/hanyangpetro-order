'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateOrderItemQuantity } from '@/app/orders/actions';

export default function ItemQuantityEditor({
    itemId,
    currentQuantity,
    unit,
}: {
    itemId: string;
    currentQuantity: number;
    unit: string;
}) {
    const router = useRouter();
    const [quantity, setQuantity] = useState(String(currentQuantity));
    const [reason, setReason] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function submit() {
        setMessage(null);
        const nextQuantity = Number(quantity);
        startTransition(async () => {
            const result = await updateOrderItemQuantity(itemId, nextQuantity, reason);
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setMessage('수정 완료');
            setReason('');
            router.refresh();
        });
    }

    return (
        <div className="ml-auto flex max-w-xs flex-col items-end gap-1.5">
            <div className="flex items-center justify-end gap-1.5">
                <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    disabled={pending}
                    className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right text-xs outline-none focus:border-blue-500 disabled:opacity-60"
                />
                <span className="text-xs text-slate-400">{unit}</span>
            </div>
            <div className="flex items-center justify-end gap-1.5">
                <input
                    type="text"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="수정 사유"
                    disabled={pending}
                    className="w-36 rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-500 disabled:opacity-60"
                />
                <button
                    type="button"
                    onClick={submit}
                    disabled={pending}
                    className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
                >
                    수정
                </button>
            </div>
            {message && <p className="text-[11px] text-slate-500">{message}</p>}
        </div>
    );
}