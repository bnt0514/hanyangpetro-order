'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createLedgerManualRow } from './row-actions';
import type { LedgerProductOption } from './LedgerRowEditButton';

type Props = {
    canEdit: boolean;
    mode: 'SALES' | 'PURCHASE';
    customerId?: string;
    supplierId?: string;
    companyEntityId?: string | null;
    products: LedgerProductOption[];
};

function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

function parsePrice(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export default function LedgerQuickAddForm({ canEdit, mode, customerId, supplierId, companyEntityId, products }: Props) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [date, setDate] = useState(todayIso());
    const [productId, setProductId] = useState('');
    const [productName, setProductName] = useState('');
    const [quantity, setQuantity] = useState('');
    const [unit, setUnit] = useState('TON');
    const [unitPrice, setUnitPrice] = useState('');
    const [memo, setMemo] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    if (!canEdit) return null;

    function submit() {
        setMessage(null);
        const parsedQuantity = Number(quantity);
        const parsedPrice = parsePrice(unitPrice);
        const selectedProduct = products.find((product) => product.id === productId);
        if (!selectedProduct && !productName.trim()) {
            setMessage('품목을 선택하거나 입력해 주세요.');
            return;
        }
        if (!Number.isFinite(parsedQuantity) || parsedQuantity === 0) {
            setMessage('수량을 확인해 주세요.');
            return;
        }
        if (Number.isNaN(parsedPrice)) {
            setMessage('단가를 확인해 주세요.');
            return;
        }
        startTransition(async () => {
            const result = await createLedgerManualRow({
                mode,
                transactionDate: date,
                customerId,
                supplierId,
                companyEntityId: companyEntityId === 'UNASSIGNED' ? null : companyEntityId,
                productId: productId || null,
                productName: selectedProduct?.productName ?? productName,
                quantity: parsedQuantity,
                unit,
                unitPrice: parsedPrice,
                memo,
            });
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setDate(todayIso());
            setProductId('');
            setProductName('');
            setQuantity('');
            setUnitPrice('');
            setMemo('');
            setOpen(false);
            router.refresh();
        });
    }

    return (
        <div className="relative">
            <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-white hover:bg-amber-600">
                + 원장 직접 추가
            </button>
            {open && (
                <div className="absolute right-0 z-40 mt-2 w-[380px] rounded-2xl border border-slate-200 bg-white p-4 text-xs shadow-xl">
                    <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-1"><span className="font-semibold text-slate-600">일자</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5" /></label>
                        <label className="space-y-1"><span className="font-semibold text-slate-600">수량</span><input type="number" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-right" /></label>
                        <label className="col-span-2 space-y-1"><span className="font-semibold text-slate-600">품목 선택</span><select value={productId} onChange={(event) => { setProductId(event.target.value); setProductName(''); }} className="w-full rounded-lg border border-slate-300 px-2 py-1.5"><option value="">직접 입력</option>{products.map((product) => <option key={product.id} value={product.id}>{product.productName}</option>)}</select></label>
                        {!productId && <label className="col-span-2 space-y-1"><span className="font-semibold text-slate-600">품목명 직접 입력</span><input value={productName} onChange={(event) => setProductName(event.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5" /></label>}
                        <label className="space-y-1"><span className="font-semibold text-slate-600">단위</span><select value={unit} onChange={(event) => setUnit(event.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5"><option value="TON">TON</option><option value="KG">KG</option><option value="EA">EA</option><option value="BOX">BOX</option></select></label>
                        <label className="space-y-1"><span className="font-semibold text-slate-600">단가</span><input value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-right" /></label>
                        <label className="col-span-2 space-y-1"><span className="font-semibold text-slate-600">메모</span><input value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="예: 대여분, 상계" className="w-full rounded-lg border border-slate-300 px-2 py-1.5" /></label>
                    </div>
                    {message && <p className="mt-2 text-[11px] text-red-600">{message}</p>}
                    <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-600">취소</button><button type="button" onClick={submit} disabled={pending} className="rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">추가</button></div>
                </div>
            )}
        </div>
    );
}