'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Loader2, Save } from 'lucide-react';
import { updateOrderMemo } from '@/app/orders/actions';

export default function OrderMemoEditor({
    orderId,
    initialMemo,
}: {
    orderId: string;
    initialMemo: string;
}) {
    const router = useRouter();
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function saveMemo() {
        const nextMemo = textareaRef.current?.value ?? '';
        setMessage(null);
        startTransition(async () => {
            const result = await updateOrderMemo(orderId, nextMemo);
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setMessage('메모를 저장했습니다.');
            router.refresh();
        });
    }

    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <FileText size={16} className="text-slate-500" />
                    <h2 className="font-semibold text-slate-800">주문 추가 요청사항</h2>
                </div>
                <button
                    type="button"
                    onClick={saveMemo}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-60"
                >
                    {pending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    저장
                </button>
            </div>
            <textarea
                ref={textareaRef}
                defaultValue={initialMemo}
                rows={4}
                placeholder="한화 새 주문의 주문 추가 요청사항에 붙여넣을 메모를 입력하세요."
                className="w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            {message && <p className="mt-2 text-xs font-medium text-slate-600">{message}</p>}
        </section>
    );
}