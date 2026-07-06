'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateOrderPurchaseLedgerDate } from '@/app/orders/actions';
import { useF8SaveShortcut } from '@/hooks/useF8SaveShortcut';
import { getDateInfo } from '@/lib/korean-holidays';

export default function PurchaseLedgerDateEditor({
    orderId,
    currentDate,
}: {
    orderId: string;
    currentDate: string;
}) {
    const router = useRouter();
    const editorRef = useRef<HTMLDivElement | null>(null);
    const [date, setDate] = useState(currentDate);
    const [reason, setReason] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function submit() {
        setMessage(null);
        const trimmedReason = reason.trim();
        if (!trimmedReason) {
            setMessage('매입일자 수정 사유를 입력해 주세요.');
            return;
        }

        startTransition(async () => {
            const result = await updateOrderPurchaseLedgerDate(orderId, date, trimmedReason);
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setMessage('매입일자 수정 완료');
            setReason('');
            router.refresh();
        });
    }

    useF8SaveShortcut(submit, { disabled: pending || !reason.trim(), scopeRef: editorRef });

    const dateInfo = getDateInfo(date);

    return (
        <div ref={editorRef} className="space-y-1.5">
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
                    title="이 입력 영역에서 F8로도 저장할 수 있습니다"
                    className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
                >
                    저장
                </button>
            </div>
            {dateInfo && (
                <p className={`text-xs font-medium ${dateInfo.isWarning ? 'text-amber-600' : 'text-blue-600'}`}>{dateInfo.message}</p>
            )}
            {message && <p className="text-[11px] text-slate-500">{message}</p>}
        </div>
    );
}
