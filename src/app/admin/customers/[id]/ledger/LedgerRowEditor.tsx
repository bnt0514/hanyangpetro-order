'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateLedgerOrderItem } from './actions';
import { useF8SaveShortcut } from '@/hooks/useF8SaveShortcut';

type ProductOption = { id: string; productName: string; productCode: string };

type Props = {
    itemId: string;
    salesDate: string;
    productId: string;
    quantity: number;
    unitPrice: number | null;
    memo: string | null;
    products: ProductOption[];
};

function priceToInput(value: number | null) {
    return value == null ? '' : String(value);
}

export default function LedgerRowEditor({ itemId, salesDate, productId, quantity, unitPrice, memo, products }: Props) {
    const router = useRouter();
    const rowRef = useRef<HTMLDivElement | null>(null);
    const [dateValue, setDateValue] = useState(salesDate);
    const [productValue, setProductValue] = useState(productId);
    const [quantityValue, setQuantityValue] = useState(String(quantity));
    const [priceValue, setPriceValue] = useState(priceToInput(unitPrice));
    const [memoValue, setMemoValue] = useState(memo ?? '');
    const [reason, setReason] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function submit() {
        setMessage(null);
        startTransition(async () => {
            const result = await updateLedgerOrderItem({
                itemId,
                salesDate: dateValue,
                productId: productValue,
                quantity: Number(quantityValue),
                salesUnitPrice: priceValue === '' ? null : Number(priceValue),
                memo: memoValue,
                reason,
            });
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setMessage('수정 완료');
            setReason('');
            router.refresh();
        });
    }

    useF8SaveShortcut(submit, { disabled: pending, scopeRef: rowRef });

    return (
        <div ref={rowRef} className="min-w-[620px] space-y-1">
            <div className="grid grid-cols-12 gap-1.5">
                <input
                    type="date"
                    value={dateValue}
                    onChange={(event) => setDateValue(event.target.value)}
                    disabled={pending}
                    className="col-span-2 rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-500 disabled:opacity-60"
                />
                <select
                    value={productValue}
                    onChange={(event) => setProductValue(event.target.value)}
                    disabled={pending}
                    className="col-span-3 rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-500 disabled:opacity-60"
                >
                    {products.map((product) => (
                        <option key={product.id} value={product.id}>{product.productName}</option>
                    ))}
                </select>
                <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={quantityValue}
                    onChange={(event) => setQuantityValue(event.target.value)}
                    disabled={pending}
                    className="col-span-1 rounded-lg border border-slate-300 px-2 py-1 text-right text-xs outline-none focus:border-blue-500 disabled:opacity-60"
                />
                <input
                    type="number"
                    min="0"
                    step="any"
                    value={priceValue}
                    onChange={(event) => setPriceValue(event.target.value)}
                    disabled={pending}
                    placeholder="단가"
                    className="col-span-2 rounded-lg border border-slate-300 px-2 py-1 text-right text-xs outline-none focus:border-blue-500 disabled:opacity-60"
                />
                <input
                    type="text"
                    value={memoValue}
                    onChange={(event) => setMemoValue(event.target.value)}
                    disabled={pending}
                    placeholder="비고"
                    className="col-span-2 rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-500 disabled:opacity-60"
                />
                <input
                    type="text"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    disabled={pending}
                    placeholder="사유"
                    className="col-span-1 rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-500 disabled:opacity-60"
                />
                <button
                    type="button"
                    onClick={submit}
                    disabled={pending}
                    title="이 행에서 F8로도 저장할 수 있습니다"
                    className="col-span-1 rounded-lg bg-slate-800 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
                >
                    저장 (F8)
                </button>
            </div>
            {message && <p className="text-[11px] text-slate-500">{message}</p>}
        </div>
    );
}
