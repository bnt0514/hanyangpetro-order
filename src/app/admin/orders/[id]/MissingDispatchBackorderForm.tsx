'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, SplitSquareHorizontal } from 'lucide-react';
import { createMissingDispatchBackorder } from '@/app/orders/actions';

type MissingDispatchItem = {
    id: string;
    productName: string;
    quantity: number;
    unit: string;
};

export default function MissingDispatchBackorderForm({
    orderId,
    items,
    defaultDeliveryDate,
}: {
    orderId: string;
    items: MissingDispatchItem[];
    defaultDeliveryDate: string;
}) {
    const router = useRouter();
    const formRef = useRef<HTMLFormElement>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function fillAll() {
        for (const item of items) {
            const input = formRef.current?.elements.namedItem(`missing-${item.id}`) as HTMLInputElement | null;
            if (input) input.value = String(item.quantity);
        }
    }

    function submit(formData: FormData) {
        const deliveryDate = String(formData.get('deliveryDate') ?? '');
        const missingItems = items.map((item) => ({
            itemId: item.id,
            quantity: Number(formData.get(`missing-${item.id}`) || 0),
        }));

        setMessage(null);
        startTransition(async () => {
            const result = await createMissingDispatchBackorder(orderId, deliveryDate, missingItems);
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setMessage(`미배차분 오더 ${result.backorderNo ?? ''}를 생성했습니다.`);
            formRef.current?.reset();
            router.refresh();
        });
    }

    return (
        <section className="rounded-2xl border border-red-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-red-100 bg-red-50/70 px-6 py-4">
                <div>
                    <h2 className="flex items-center gap-2 font-semibold text-slate-800">
                        <AlertTriangle size={16} className="text-red-500" />
                        미배차분 / 백오더 생성
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">전체 오더, 품목 전체, 부분 수량을 새 납품요청일의 오더로 분할합니다.</p>
                </div>
                <button type="button" onClick={fillAll} className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50">
                    전체 미배차 입력
                </button>
            </div>
            <form ref={formRef} action={submit} className="space-y-4 p-5 text-sm">
                <label className="block max-w-xs">
                    <span className="mb-1 block text-xs font-medium text-slate-500">변경 납품요청일</span>
                    <input name="deliveryDate" type="date" required defaultValue={defaultDeliveryDate} className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" />
                </label>
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {items.map((item) => (
                        <label key={item.id} className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_160px] md:items-center">
                            <span>
                                <span className="block font-semibold text-slate-800">{item.productName}</span>
                                <span className="text-xs text-slate-400">주문수량 {item.quantity.toLocaleString('ko-KR')} {item.unit}</span>
                            </span>
                            <input name={`missing-${item.id}`} type="number" min="0" max={item.quantity} step="0.001" placeholder="미배차 수량" className="rounded-lg border border-slate-300 px-3 py-2 text-right outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" />
                        </label>
                    ))}
                </div>
                <div className="flex items-center justify-between gap-3">
                    {message && <p className="text-xs font-medium text-slate-600">{message}</p>}
                    <button disabled={pending} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 font-bold text-white hover:bg-red-700 disabled:opacity-60">
                        {pending ? <Loader2 size={15} className="animate-spin" /> : <SplitSquareHorizontal size={15} />}
                        새 오더 생성
                    </button>
                </div>
            </form>
        </section>
    );
}