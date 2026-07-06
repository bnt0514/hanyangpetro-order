'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Loader2, Save } from 'lucide-react';
import { updateOrderNotes } from '@/app/orders/actions';

type FieldName = 'driverCustomerNotice' | 'orderExtraRequest';

export default function OrderMemoEditor({
    orderId,
    initialDriverCustomerNotice,
    initialOrderExtraRequest,
}: {
    orderId: string;
    initialDriverCustomerNotice: string;
    initialOrderExtraRequest: string;
}) {
    const router = useRouter();
    const driverNoticeRef = useRef<HTMLTextAreaElement>(null);
    const extraRequestRef = useRef<HTMLTextAreaElement>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [savingField, setSavingField] = useState<FieldName | null>(null);
    const [pending, startTransition] = useTransition();

    function saveField(field: FieldName) {
        setMessage(null);
        setSavingField(field);
        startTransition(async () => {
            const result = await updateOrderNotes(orderId, field === 'driverCustomerNotice'
                ? { driverCustomerNotice: driverNoticeRef.current?.value ?? '' }
                : { orderExtraRequest: extraRequestRef.current?.value ?? '' });
            setSavingField(null);
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setMessage(field === 'driverCustomerNotice'
                ? '기사 및 고객 알림사항을 저장했습니다.'
                : '주문 추가 요청사항을 저장했습니다.');
            router.refresh();
        });
    }

    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
                <FileText size={16} className="text-slate-500" />
                <h2 className="font-semibold text-slate-800">한화 요청사항</h2>
            </div>
            <div className="grid gap-4">
                <label className="block">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="block text-xs font-bold text-slate-600">기사 및 고객 알림사항</span>
                        <button
                            type="button"
                            onClick={() => saveField('driverCustomerNotice')}
                            disabled={pending}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-60"
                        >
                            {savingField === 'driverCustomerNotice' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                            저장
                        </button>
                    </div>
                    <textarea
                        ref={driverNoticeRef}
                        defaultValue={initialDriverCustomerNotice}
                        rows={3}
                        placeholder="한화 새 주문의 기사 및 고객 알림사항 입력란에 붙여넣을 내용"
                        className="w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                </label>
                <label className="block">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="block text-xs font-bold text-slate-600">주문 추가 요청사항</span>
                        <button
                            type="button"
                            onClick={() => saveField('orderExtraRequest')}
                            disabled={pending}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-60"
                        >
                            {savingField === 'orderExtraRequest' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                            저장
                        </button>
                    </div>
                    <textarea
                        ref={extraRequestRef}
                        defaultValue={initialOrderExtraRequest}
                        rows={3}
                        placeholder="한화 새 주문의 주문 추가 요청사항 입력란에 붙여넣을 내용"
                        className="w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                </label>
            </div>
            {message && <p className="mt-2 text-xs font-medium text-slate-600">{message}</p>}
        </section>
    );
}
