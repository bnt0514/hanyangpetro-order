'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updatePurchaseLedgerDate } from './actions';
import { useF8SaveShortcut } from '@/hooks/useF8SaveShortcut';

type Props = {
    itemId: string;
    purchaseDate: string;
};

export default function PurchaseLedgerDateEditor({ itemId, purchaseDate }: Props) {
    const router = useRouter();
    const editorRef = useRef<HTMLDivElement | null>(null);
    const [dateValue, setDateValue] = useState(purchaseDate);
    const [reason, setReason] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function submit() {
        setMessage(null);
        startTransition(async () => {
            const result = await updatePurchaseLedgerDate({ itemId, purchaseDate: dateValue, reason });
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setMessage('변경 완료');
            setReason('');
            router.refresh();
        });
    }

    useF8SaveShortcut(submit, { disabled: pending || !reason.trim(), scopeRef: editorRef });

    return (
        <div ref={editorRef} className="min-w-[260px] space-y-1">
            <div className="flex items-center gap-1.5">
                <input
                    type="date"
                    value={dateValue}
                    onChange={(event) => setDateValue(event.target.value)}
                    disabled={pending}
                    className="w-32 rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-violet-500 disabled:opacity-60"
                />
                <input
                    type="text"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    disabled={pending}
                    placeholder="변경 사유"
                    className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-violet-500 disabled:opacity-60"
                />
                <button
                    type="button"
                    onClick={submit}
                    disabled={pending || !reason.trim()}
                    title="이 행에서 F8로도 변경할 수 있습니다"
                    className="rounded-lg bg-violet-600 px-2 py-1 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                >
                    변경
                </button>
            </div>
            {message && <p className="text-[11px] text-slate-500">{message}</p>}
        </div>
    );
}