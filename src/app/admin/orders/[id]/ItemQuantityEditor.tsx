'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateOrderItem } from '@/app/orders/actions';
import Combobox from '@/components/Combobox';
import { useF8SaveShortcut } from '@/hooks/useF8SaveShortcut';

export type ProductOption = {
    id: string;
    productName: string;
    productCode: string;
    defaultSalesEntityId?: string | null;
    defaultPurchaseEntityId?: string | null;
    defaultSupplierId?: string | null;
};

export type CompanyEntityOption = { id: string; code: string; displayName: string };
export type SupplierOption = { id: string; supplierName: string; contactPerson?: string | null; phone?: string | null };

function priceToInput(value: number | null | undefined) {
    return value == null ? '' : String(value);
}

export default function ItemQuantityEditor({
    itemId,
    currentProductId,
    currentQuantity,
    currentSalesEntityId,
    currentPurchaseEntityId,
    currentPurchaseSupplierId,
    currentFulfillmentType,
    currentHanwhaBagType,
    isInternalPurchaseOnly,
    currentSalesUnitPrice,
    currentPurchaseUnitPrice,
    autoSalesUnitPrice,
    autoPurchaseUnitPrice,
    unit,
    orderStatus,
    products,
    companyEntities,
    suppliers,
}: {
    itemId: string;
    currentProductId: string;
    currentQuantity: number;
    currentSalesEntityId: string;
    currentPurchaseEntityId: string;
    currentPurchaseSupplierId: string;
    currentFulfillmentType: string;
    currentHanwhaBagType?: string | null;
    isInternalPurchaseOnly: boolean;
    currentSalesUnitPrice: number | null;
    currentPurchaseUnitPrice: number | null;
    /** 이 거래처+품목의 최근 매출단가 (주문에 단가 없을 때 자동 채움용) */
    autoSalesUnitPrice: number | null;
    /** 이 거래처+품목의 최근 매입단가 (주문에 단가 없을 때 자동 채움용) */
    autoPurchaseUnitPrice: number | null;
    unit: string;
    orderStatus: string;
    products: ProductOption[];
    companyEntities: CompanyEntityOption[];
    suppliers: SupplierOption[];
}) {
    const router = useRouter();
    const editorRef = useRef<HTMLDivElement | null>(null);
    const [productId, setProductId] = useState(currentProductId);
    const [quantity, setQuantity] = useState(String(currentQuantity));
    const [salesEntityId, setSalesEntityId] = useState(currentSalesEntityId);
    const [purchaseEntityId, setPurchaseEntityId] = useState(currentPurchaseEntityId);
    const [purchaseSupplierId, setPurchaseSupplierId] = useState(currentPurchaseSupplierId);
    const [fulfillmentType, setFulfillmentType] = useState(currentFulfillmentType);
    const [hanwhaBagType, setHanwhaBagType] = useState(currentHanwhaBagType ?? '');
    // 단가가 없으면 자동 조회값으로 초기화
    const [salesUnitPrice, setSalesUnitPrice] = useState(
        priceToInput(currentSalesUnitPrice ?? autoSalesUnitPrice)
    );
    const [purchaseUnitPrice, setPurchaseUnitPrice] = useState(
        priceToInput(currentPurchaseUnitPrice ?? autoPurchaseUnitPrice)
    );
    const [reason, setReason] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    // 단가가 자동 채움된 경우 UI로 표시
    const salesAutoFilled = currentSalesUnitPrice == null && autoSalesUnitPrice != null;
    const purchaseAutoFilled = currentPurchaseUnitPrice == null && autoPurchaseUnitPrice != null;

    const productOptions = products.map((product) => ({
        value: product.id,
        label: product.productName,
        sublabel: product.productCode,
    }));
    const supplierOptions = suppliers.map((supplier) => ({
        value: supplier.id,
        label: supplier.supplierName,
        sublabel: [supplier.contactPerson, supplier.phone].filter(Boolean).join(' · ') || undefined,
    }));

    function handleProductChange(value: string) {
        setProductId(value);
        const product = products.find((p) => p.id === value);
        if (product?.defaultSalesEntityId) setSalesEntityId(product.defaultSalesEntityId);
        if (product?.defaultPurchaseEntityId) setPurchaseEntityId(product.defaultPurchaseEntityId);
        if (product?.defaultSupplierId) setPurchaseSupplierId(product.defaultSupplierId);
    }

    function submit() {
        setMessage(null);
        const nextQuantity = Number(quantity);
        startTransition(async () => {
            const result = await updateOrderItem(itemId, productId, nextQuantity, reason || '매입처 확인', {
                fulfillmentType,
                salesEntityId: isInternalPurchaseOnly ? undefined : salesEntityId,
                purchaseEntityId,
                purchaseSupplierId: purchaseSupplierId || null,
                hanwhaBagType: hanwhaBagType || null,
                salesUnitPrice: isInternalPurchaseOnly || salesUnitPrice === '' ? null : Number(salesUnitPrice),
                purchaseUnitPrice: purchaseUnitPrice === '' ? null : Number(purchaseUnitPrice),
            });
            if (!result.ok) {
                setMessage(result.error);
                return;
            }
            setMessage('저장 완료');
            setReason('');
            router.refresh();
        });
    }

    useF8SaveShortcut(submit, { disabled: pending, scopeRef: editorRef });

    return (
        <div ref={editorRef} className="ml-auto flex max-w-sm flex-col items-end gap-1.5">
            <div className="w-full text-left">
                <Combobox
                    options={productOptions}
                    value={productId}
                    onChange={(value: string) => handleProductChange(value)}
                    placeholder="제품명 입력"
                    emptyText="일치하는 제품이 없습니다"
                    disabled={pending}
                />
            </div>
            <div className="flex items-center justify-end gap-1.5">
                <input
                    type="text"
                    inputMode="decimal"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    disabled={pending}
                    className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right text-xs outline-none focus:border-blue-500 disabled:opacity-60"
                />
                <span className="text-xs text-slate-400">{unit}</span>
            </div>
            <div className="grid w-full grid-cols-2 gap-1.5">
                <select
                    value={fulfillmentType}
                    onChange={(event) => setFulfillmentType(event.target.value)}
                    disabled={pending}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-500 disabled:opacity-60"
                    title="창고/직송"
                >
                    <option value="">창고/직송</option>
                    <option value="WAREHOUSE">창고</option>
                    <option value="DIRECT">직송</option>
                </select>
                <select
                    value={hanwhaBagType}
                    onChange={(event) => setHanwhaBagType(event.target.value)}
                    disabled={pending}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-500 disabled:opacity-60"
                    title="한화 포장백"
                >
                    <option value="">한화백 자동(FFS)</option>
                    <option value="FFS">FFS</option>
                    <option value="FB500">500백</option>
                    <option value="FB700">700백</option>
                    <option value="FB750">750백</option>
                </select>
                {!isInternalPurchaseOnly && (
                    <select
                        value={salesEntityId}
                        onChange={(event) => setSalesEntityId(event.target.value)}
                        disabled={pending}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-500 disabled:opacity-60"
                        title="매출주체"
                    >
                        <option value="">매출주체</option>
                        {companyEntities.map((company) => (
                            <option key={company.id} value={company.id}>{company.displayName}</option>
                        ))}
                    </select>
                )}
                <select
                    value={purchaseEntityId}
                    onChange={(event) => setPurchaseEntityId(event.target.value)}
                    disabled={pending}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-500 disabled:opacity-60"
                    title="매입주체"
                >
                    <option value="">매입주체</option>
                    {companyEntities.map((company) => (
                        <option key={company.id} value={company.id}>{company.displayName}</option>
                    ))}
                </select>
                <div className="col-span-2">
                    <Combobox
                        options={supplierOptions}
                        value={purchaseSupplierId}
                        onChange={(value: string) => setPurchaseSupplierId(value)}
                        placeholder="매입처명 입력"
                        emptyText="일치하는 매입처가 없습니다"
                        disabled={pending}
                    />
                </div>
                {!isInternalPurchaseOnly && (
                    <div className="relative">
                        <input
                            type="text"
                            inputMode="decimal"
                            value={salesUnitPrice}
                            onChange={(event) => setSalesUnitPrice(event.target.value)}
                            placeholder="매출단가"
                            disabled={pending}
                            className={`w-full rounded-lg border px-2 py-1 text-right text-xs outline-none focus:border-blue-500 disabled:opacity-60 ${salesAutoFilled ? 'border-blue-300 bg-blue-50' : 'border-slate-300'}`}
                        />
                        {salesAutoFilled && (
                            <span className="absolute -top-3 left-0 text-[10px] text-blue-500">직전단가 자동채움</span>
                        )}
                    </div>
                )}
                <div className="relative">
                    <input
                        type="text"
                        inputMode="decimal"
                        value={purchaseUnitPrice}
                        onChange={(event) => setPurchaseUnitPrice(event.target.value)}
                        placeholder="매입단가"
                        disabled={pending}
                        className={`w-full rounded-lg border px-2 py-1 text-right text-xs outline-none focus:border-blue-500 disabled:opacity-60 ${purchaseAutoFilled ? 'border-blue-300 bg-blue-50' : 'border-slate-300'}`}
                    />
                    {purchaseAutoFilled && (
                        <span className="absolute -top-3 left-0 text-[10px] text-blue-500">직전단가 자동채움</span>
                    )}
                </div>
            </div>
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
                    title="이 영역에서 F8로도 저장할 수 있습니다"
                    className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
                >
                    저장
                </button>
            </div>
            {message && <p className="text-[11px] text-slate-500">{message}</p>}
        </div>
    );
}