'use client';

import { useRef, useState, useTransition } from 'react';
import { PlusCircle } from 'lucide-react';
import { createManualDispatch } from '@/app/dispatch/actions';
import { useF8SaveShortcut } from '@/hooks/useF8SaveShortcut';

type ManualDispatchItem = {
    productName: string;
    quantity: number;
    unit: string;
};

export default function ManualDispatchForm({
    orderId,
    items,
}: {
    orderId: string;
    items: ManualDispatchItem[];
}) {
    const formRef = useRef<HTMLFormElement>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function submit(formData: FormData) {
        setMessage(null);
        formData.set('orderId', orderId);
        startTransition(async () => {
            const result = await createManualDispatch(formData);
            if (result.ok) {
                setMessage('수기 배차내역을 저장했습니다.');
                formRef.current?.reset();
            } else {
                setMessage(result.error);
            }
        });
    }

    useF8SaveShortcut(() => formRef.current?.requestSubmit(), { disabled: pending, scopeRef: formRef });

    return (
        <section className="rounded-2xl border border-amber-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-amber-100 bg-amber-50/70 px-6 py-4">
                <h2 className="font-semibold text-slate-800">수기 배차내역 입력</h2>
                <p className="mt-1 text-xs text-slate-500">타사 배차처럼 한화 조회로 들어오지 않는 배차를 별도로 입력합니다.</p>
            </div>
            <form ref={formRef} action={submit} className="grid gap-3 p-5 text-sm lg:grid-cols-[1.5fr_0.7fr_1.3fr_auto] lg:items-end">
                <input type="hidden" name="orderId" value={orderId} />
                <label>
                    <span className="mb-1 block text-xs font-medium text-slate-500">품목</span>
                    <select
                        name="materialName"
                        required
                        defaultValue=""
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                    >
                        <option value="" disabled>품목 선택</option>
                        {items.map((item) => (
                            <option key={item.productName} value={item.productName}>
                                {item.productName} / 주문 {item.quantity.toLocaleString('ko-KR')}{item.unit}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span className="mb-1 block text-xs font-medium text-slate-500">수량(TON)</span>
                    <input name="quantityTon" required type="number" min="0.001" step="0.001" placeholder="5" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-right outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" />
                </label>
                <label>
                    <span className="mb-1 block text-xs font-medium text-slate-500">기사정보</span>
                    <input name="driverInfo" required placeholder="3392-전남82바 · 박승수 · 01037357061" className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" />
                </label>
                <div>
                    <button disabled={pending} title="F8로도 저장할 수 있습니다" className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 font-bold text-white hover:bg-amber-600 disabled:opacity-60">
                        <PlusCircle size={15} /> 저장 (F8)
                    </button>
                </div>
                {message && <p className="lg:col-span-4 text-xs font-medium text-slate-600">{message}</p>}
            </form>
        </section>
    );
}
