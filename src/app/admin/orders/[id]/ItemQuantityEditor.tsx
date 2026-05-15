'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateOrderItem } from '@/app/orders/actions';
import Combobox from '@/components/Combobox';

export type ProductOption = { id: string; productName: string; productCode: string };

export default function ItemQuantityEditor({
    itemId,
    currentProductId,
    currentQuantity,
    unit,
    products,
}: {
    itemId: string;
    currentProductId: string;
    currentQuantity: number;
    unit: string;
    products: ProductOption[];
}) {
    const router = useRouter();
    const [productId, setProductId] = useState(currentProductId);
    const [quantity, setQuantity] = useState(String(currentQuantity));
    const [reason, setReason] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();
    const productOptions = products.map((product) => ({
        value: product.id,
        label: product.productName,
        sublabel: product.productCode,
    }));

    function submit() {
        setMessage(null);
        const nextQuantity = Number(quantity);
        startTransition(async () => {
            const result = await updateOrderItem(itemId, productId, nextQuantity, reason);
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setMessage('수정 완료');
            setReason('');
            router.refresh();
        });
    }

    return (
        <div className="ml-auto flex max-w-xs flex-col items-end gap-1.5">
            {/* 품목 선택 */}
            <div className="w-full text-left">
                <Combobox
                    options={productOptions}
                    value={productId}
                    onChange={(value: string) => setProductId(value)}
                    placeholder="제품명/코드 입력"
                    emptyText="일치하는 제품이 없습니다"
                    disabled={pending}
                />
            </div>
            {/* 수량 입력 */}
            <div className="flex items-center justify-end gap-1.5">
                <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    disabled={pending}
                    className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right text-xs outline-none focus:border-blue-500 disabled:opacity-60"
                />
                <span className="text-xs text-slate-400">{unit}</span>
            </div>
            {/* 사유 + 저장 */}
            <div className="flex items-center justify-end gap-1.5">
                <input
                    type="text"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="수정 사유"
                    disabled={pending}
                    className="w-36 rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-500 disabled:opacity-60"
                />
                <button
                    type="button"
                    onClick={submit}
                    disabled={pending}
                    className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
                >
                    저장
                </button>
            </div>
            {message && <p className="text-[11px] text-slate-500">{message}</p>}
        </div>
    );
}
