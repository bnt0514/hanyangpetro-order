'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateOrderDeliveryDate } from '@/app/orders/actions';

export default function DeliveryDateEditor({
    orderId,
    currentDate,
}: {
    orderId: string;
    currentDate: string;
}) {
    const router = useRouter();
    const [date, setDate] = useState(currentDate);
    const [reason, setReason] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function submit() {
        setMessage(null);
        startTransition(async () => {
            const result = await updateOrderDeliveryDate(orderId, date, reason);
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setMessage('도착일 수정 완료');
            setReason('');
            router.refresh();
        });
    }

    return (
        <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
                <input
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    disabled={pending}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                />
                <input
                    type="text"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="수정 사유"
                    disabled={pending}
                    className="w-36 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                />
                <button
                    type="button"
                    onClick={submit}
                    disabled={pending}
                    className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
                >
                    저장
                </button>
            </div>
            {message && <p className="text-[11px] text-slate-500">{message}</p>}
        </div>
    );
}