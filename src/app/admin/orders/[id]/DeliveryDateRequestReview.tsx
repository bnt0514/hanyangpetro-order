'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reviewOrderDeliveryDateChangeRequest } from '@/app/orders/actions';

type RequestRow = {
    id: string;
    requestedDate: string;
    requestedWeekdayText: string | null;
    reason: string | null;
    status: string;
    createdAt: string;
};

export default function DeliveryDateRequestReview({ requests }: { requests: RequestRow[] }) {
    const router = useRouter();
    const [memoById, setMemoById] = useState<Record<string, string>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    if (requests.length === 0) return null;

    function review(id: string, decision: 'APPROVED' | 'REJECTED') {
        setMessage(null);
        startTransition(async () => {
            const result = await reviewOrderDeliveryDateChangeRequest(id, decision, memoById[id] ?? '');
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setMessage(decision === 'APPROVED' ? '요청을 승인했습니다.' : '요청을 반려했습니다.');
            router.refresh();
        });
    }

    return (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <h2 className="font-bold text-amber-900">도착일 변경 요청</h2>
            <div className="mt-3 space-y-3">
                {requests.map((request) => (
                    <div key={request.id} className="rounded-xl border border-amber-200 bg-white p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-semibold text-slate-800">
                                요청일 {request.requestedDate}{request.requestedWeekdayText ? ` (${request.requestedWeekdayText})` : ''}
                            </p>
                            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${request.status === 'PENDING' ? 'bg-amber-100 text-amber-800' : request.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                {request.status === 'PENDING' ? '요청중' : request.status === 'APPROVED' ? '승인됨' : '반려됨'}
                            </span>
                        </div>
                        {request.reason && <p className="mt-1 text-xs text-slate-500">사유: {request.reason}</p>}
                        {request.status === 'PENDING' && (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <input value={memoById[request.id] ?? ''} onChange={(event) => setMemoById((prev) => ({ ...prev, [request.id]: event.target.value }))} placeholder="처리 메모" className="min-w-48 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs" />
                                <button type="button" onClick={() => review(request.id, 'APPROVED')} disabled={pending} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">승인</button>
                                <button type="button" onClick={() => review(request.id, 'REJECTED')} disabled={pending} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">반려</button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
            {message && <p className="mt-2 text-xs font-semibold text-amber-800">{message}</p>}
        </section>
    );
}
