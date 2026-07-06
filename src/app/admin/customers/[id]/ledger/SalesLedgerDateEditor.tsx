'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateSalesLedgerDate } from './actions';
import { useF8SaveShortcut } from '@/hooks/useF8SaveShortcut';

type Props = {
    itemId: string;
    salesDate: string;
};

export default function SalesLedgerDateEditor({ itemId, salesDate }: Props) {
    const router = useRouter();
    const editorRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const [dateValue, setDateValue] = useState(salesDate);
    const [reason, setReason] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function submit() {
        setMessage(null);
        startTransition(async () => {
            const result = await updateSalesLedgerDate({ itemId, salesDate: dateValue, reason });
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setMessage('변경 완료');
            setReason('');
            setOpen(false);
            router.refresh();
        });
    }

    useF8SaveShortcut(submit, { disabled: pending || !reason.trim(), scopeRef: editorRef });

    return (
        <div ref={editorRef} className="relative inline-block text-left">
            <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-lg border border-blue-200 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50">
                일자수정
            </button>
            {open && (
                <div className="absolute left-0 z-40 mt-2 w-[300px] rounded-2xl border border-slate-200 bg-white p-3 text-xs shadow-xl">
                    <div className="space-y-2">
                        <label className="block space-y-1">
                            <span className="font-semibold text-slate-600">매출일자</span>
                            <input
                                type="date"
                                value={dateValue}
                                onChange={(event) => setDateValue(event.target.value)}
                                disabled={pending}
                                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-blue-500 disabled:opacity-60"
                            />
                        </label>
                        <label className="block space-y-1">
                            <span className="font-semibold text-slate-600">변경 사유 *</span>
                            <input
                                type="text"
                                value={reason}
                                onChange={(event) => setReason(event.target.value)}
                                disabled={pending}
                                placeholder="예: 익월 매출 반영"
                                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:border-blue-500 disabled:opacity-60"
                            />
                        </label>
                    </div>
                    {message && <p className="mt-2 text-[11px] text-slate-500">{message}</p>}
                    <div className="mt-3 flex justify-end gap-2">
                        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-600">취소</button>
                        <button type="button" onClick={submit} disabled={pending || !reason.trim()} title="이 영역에서 F8로도 변경할 수 있습니다" className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                            변경
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
