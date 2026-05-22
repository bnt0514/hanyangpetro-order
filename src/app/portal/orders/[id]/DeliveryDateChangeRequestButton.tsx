'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { requestOrderDeliveryDateChange } from '@/app/orders/actions';

const DAY_NAMES = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

function weekdayOf(iso: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    return DAY_NAMES[new Date(`${iso}T00:00:00`).getDay()] ?? '';
}

export default function DeliveryDateChangeRequestButton({ orderId }: { orderId: string }) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [date, setDate] = useState('');
    const [reason, setReason] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function begin() {
        const ok = window.confirm('도착일 변경 요청은 도착일 당일 오전 11시 이후에는 불가한 점 참고 부탁드립니다. 부득이한 사정으로 꼭 변경해야 하는 경우 담당자에게 연락주세요.');
        if (ok) setOpen(true);
    }

    function submit() {
        setMessage(null);
        startTransition(async () => {
            const result = await requestOrderDeliveryDateChange({
                orderId,
                requestedDate: date,
                requestedWeekdayText: weekdayOf(date),
                reason,
            });
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setMessage('도착일 변경 요청을 접수했습니다. 담당자 확인 후 안내됩니다.');
            setOpen(false);
            setDate('');
            setReason('');
            router.refresh();
        });
    }

    return (
        <div className="mt-2 space-y-2">
            <button type="button" onClick={begin} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100">
                도착일 변경 요청
            </button>
            {open && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <label className="block text-xs font-semibold text-slate-600">
                        변경 원하는 도착일
                        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
                    </label>
                    {date && <p className="mt-1 text-xs font-medium text-blue-600">{weekdayOf(date)}입니다</p>}
                    <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="요청 사유(선택)" className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
                    <div className="mt-2 flex gap-2">
                        <button type="button" onClick={submit} disabled={pending || !date} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">요청</button>
                        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">닫기</button>
                    </div>
                </div>
            )}
            {message && <p className="text-xs font-medium text-blue-700">{message}</p>}
        </div>
    );
}
