'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, AlertCircle, CheckCircle2, Save } from 'lucide-react';
import Combobox, { type ComboboxOption } from '@/components/Combobox';
import { createOrder } from '@/app/orders/actions';

type DeliveryAddressOption = ComboboxOption & {
    addressLine1?: string | null;
    addressLine2?: string | null;
    contactPhone?: string | null;
};

type CompanyEntityOption = {
    id: string;
    code: string;
    displayName: string;
};

type SupplierOption = {
    id: string;
    supplierName: string;
    contactPerson?: string | null;
    phone?: string | null;
};

type ProductOption = ComboboxOption & {
    defaultSalesEntityId?: string | null;
    defaultSalesEntityName?: string | null;
    defaultPurchaseEntityId?: string | null;
    defaultPurchaseEntityName?: string | null;
    defaultSupplierId?: string | null;
    defaultSupplierName?: string | null;
    lastPurchaseSupplierId?: string | null;
    lastPurchaseSupplierName?: string | null;
    lastSalesUnitPrice?: number | null;
    lastPurchaseUnitPrice?: number | null;
};

type CustomerData = {
    customer: {
        id: string;
        companyName: string;
        customerCode: string;
        isInternalPurchaseOnly: boolean;
    };
    addresses: DeliveryAddressOption[];
    products: ProductOption[];
    companyEntities: CompanyEntityOption[];
    suppliers: SupplierOption[];
};

type AddressComboboxOption = DeliveryAddressOption & {
    customerId: string;
    customerName: string;
    customerCode: string;
};

interface Props {
    /** 'customer' 모드: 거래처 픽스, 'staff' 모드: 거래처도 선택 */
    mode: 'customer' | 'staff';
    /** customer 모드에서 고정될 거래처 정보 */
    fixedCustomer?: { id: string; name: string };
    /** staff 모드에서 거래처 옵션 목록 */
    customerOptions?: ComboboxOption[];
    /** staff 모드에서 거래처 선택 전에도 검색 가능한 전체 도착지 목록 */
    allAddressOptions?: AddressComboboxOption[];
}

type LineItem = {
    key: number;
    productId: string;
    quantity: string;
    salesEntityId: string;
    purchaseSupplierId: string;
    fulfillmentType: string;
    salesUnitPrice: string;
    purchaseUnitPrice: string;
};

const AUTO_ADDRESS_PREFIX = '__auto_address__:';

function makeAutoAddressId(customerId: string) {
    return `${AUTO_ADDRESS_PREFIX}${customerId}`;
}

function isAutoAddressId(value: string) {
    return value.startsWith(AUTO_ADDRESS_PREFIX);
}

function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function tomorrowISO() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shiftDate(iso: string, days: number): string {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function makeEmptyLine(): LineItem {
    return { key: Date.now() + Math.random(), productId: '', quantity: '', salesEntityId: '', purchaseSupplierId: '', fulfillmentType: '', salesUnitPrice: '', purchaseUnitPrice: '' };
}

function priceToInput(value: number | null | undefined) {
    return value == null ? '' : String(value);
}

export default function OrderForm({ mode, fixedCustomer, customerOptions = [], allAddressOptions = [] }: Props) {
    const router = useRouter();
    const [pending, start] = useTransition();
    const pendingAddressIdRef = useRef<string | null>(null);

    const [customerId, setCustomerId] = useState(fixedCustomer?.id ?? '');
    const [data, setData] = useState<CustomerData | null>(null);
    const [loading, setLoading] = useState(false);

    const [orderDate, setOrderDate] = useState(todayISO());
    const [deliveryDate, setDeliveryDate] = useState(tomorrowISO());
    const [addressId, setAddressId] = useState('');
    const [items, setItems] = useState<LineItem[]>([makeEmptyLine()]);
    const [memo, setMemo] = useState('');

    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [addressDefaultText, setAddressDefaultText] = useState('');
    const [addressFreeText, setAddressFreeText] = useState('');
    const selectedCustomerOption = customerOptions.find((customer) => customer.value === customerId);
    const autoAddressOption: DeliveryAddressOption | null = customerId && selectedCustomerOption
        ? {
            value: makeAutoAddressId(customerId),
            label: selectedCustomerOption.label,
            sublabel: `${selectedCustomerOption.sublabel ?? ''} · 도착지 자동 생성`.trim(),
        }
        : null;
    const addressOptions = customerId
        ? (data?.addresses?.length ? data.addresses : autoAddressOption ? [autoAddressOption] : [])
        : allAddressOptions;
    const selectedAddressDetail = addressId && !isAutoAddressId(addressId)
        ? addressOptions.find((address) => address.value === addressId)
        : null;
    const isInternalPurchaseOnly = Boolean(data?.customer?.isInternalPurchaseOnly);
    const supplierOptions: ComboboxOption[] = (data?.suppliers ?? []).map((supplier) => ({
        value: supplier.id,
        label: supplier.supplierName,
        sublabel: [supplier.contactPerson, supplier.phone].filter(Boolean).join(' · ') || undefined,
    }));

    // 거래처 변경 시 도착지/제품 다시 로드
    useEffect(() => {
        if (!customerId) {
            queueMicrotask(() => {
                setData(null);
                setAddressId('');
            });
            return;
        }
        let cancel = false;
        queueMicrotask(() => !cancel && setLoading(true));
        fetch(`/api/customers/${customerId}/data`)
            .then((r) => r.json())
            .then((d) => {
                if (cancel) return;
                setData(d);
                const pendingAddressId = pendingAddressIdRef.current;
                pendingAddressIdRef.current = null;
                if (pendingAddressId && d.addresses?.some((address: ComboboxOption) => address.value === pendingAddressId)) {
                    setAddressId(pendingAddressId);
                    setAddressDefaultText('');
                    setAddressFreeText('');
                } else if (d.addresses?.length > 0) {
                    setAddressId(d.addresses[0].value);
                    setAddressDefaultText('');
                    setAddressFreeText('');
                } else {
                    // 매칭된 도착지가 없으면 거래처명을 도착지 입력창에 자동 표시
                    const customerName =
                        customerOptions.find((c) => c.value === customerId)?.label ??
                        allAddressOptions.find((a) => a.customerId === customerId)?.customerName ??
                        fixedCustomer?.name ??
                        '';
                    setAddressId(makeAutoAddressId(customerId));
                    setAddressDefaultText(customerName);
                    setAddressFreeText(customerName);
                }
            })
            .catch(() => setError('거래처 데이터 로드 실패'))
            .finally(() => !cancel && setLoading(false));
        return () => {
            cancel = true;
        };
    }, [customerId]);

    function addLine() {
        setItems((prev) => [...prev, makeEmptyLine()]);
    }
    function removeLine(key: number) {
        setItems((prev) => (prev.length === 1 ? prev : prev.filter((i) => i.key !== key)));
    }
    function updateLine(key: number, patch: Partial<LineItem>) {
        setError(null);
        setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
    }

    function handleProductChange(key: number, productId: string) {
        const selectedProduct = data?.products.find((product) => product.value === productId);
        updateLine(key, {
            productId,
            salesEntityId: selectedProduct?.defaultSalesEntityId ?? '',
            purchaseSupplierId: selectedProduct?.lastPurchaseSupplierId ?? selectedProduct?.defaultSupplierId ?? '',
            salesUnitPrice: priceToInput(selectedProduct?.lastSalesUnitPrice),
            purchaseUnitPrice: priceToInput(selectedProduct?.lastPurchaseUnitPrice),
        });
    }

    function handleCustomerChange(value: string) {
        pendingAddressIdRef.current = null;
        setAddressDefaultText('');
        setAddressFreeText('');
        setCustomerId(value);
    }

    function handleAddressChange(value: string) {
        setAddressId(value);

        if (isAutoAddressId(value)) {
            const selectedAddress = allAddressOptions.find((address) => address.value === value);
            const autoText = selectedAddress?.customerName ?? selectedCustomerOption?.label ?? addressDefaultText;
            setAddressDefaultText(autoText);
            setAddressFreeText(autoText);
            if (mode === 'staff' && selectedAddress && selectedAddress.customerId !== customerId) {
                pendingAddressIdRef.current = value;
                setCustomerId(selectedAddress.customerId);
                setItems([makeEmptyLine()]);
            }
            return;
        }

        setAddressFreeText('');
        setAddressDefaultText('');
        if (mode !== 'staff' || !value) return;

        const selectedAddress = allAddressOptions.find((address) => address.value === value);
        if (!selectedAddress) return;
        if (selectedAddress.customerId !== customerId) {
            pendingAddressIdRef.current = value;
            setCustomerId(selectedAddress.customerId);
            setItems([makeEmptyLine()]);
        }
    }

    /** 누락된 필수 값을 정확히 알려줌. 다 되면 null. */
    function getMissingMsg(): string | null {
        if (!customerId) return '거래처를 선택해주세요.';
        if (!addressId && !addressFreeText.trim()) return '도착지를 선택해주세요.';
        if (!orderDate) return '주문일자를 입력해주세요.';
        if (!deliveryDate) return '도착일자를 입력해주세요.';
        for (let idx = 0; idx < items.length; idx++) {
            const it = items[idx];
            if (!it.productId) return `${idx + 1}번째 제품을 선택해주세요.`;
            if (!it.quantity || Number(it.quantity) <= 0)
                return `${idx + 1}번째 제품의 수량을 입력해주세요.`;
            if (!it.fulfillmentType) return `${idx + 1}번째 제품의 창고/직송을 선택해주세요.`;
            if (mode === 'staff') {
                if (!isInternalPurchaseOnly && !it.salesEntityId) return `${idx + 1}번째 제품의 매출주체를 선택해주세요.`;
                if (!it.purchaseSupplierId) return `${idx + 1}번째 제품의 매입처를 선택해주세요.`;
                if (it.salesUnitPrice && Number(it.salesUnitPrice) < 0) return `${idx + 1}번째 제품의 매출단가는 0 이상이어야 합니다.`;
                if (it.purchaseUnitPrice && Number(it.purchaseUnitPrice) < 0) return `${idx + 1}번째 제품의 매입단가는 0 이상이어야 합니다.`;
            }
        }
        return null;
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        // 클릭되면 먼저 input/combobox에서 blur 발생 → commit 완료.
        // 그 다음 microtask에 상태 재검증.
        setTimeout(() => {
            const missing = getMissingMsg();
            if (missing) {
                setError(missing);
                return;
            }
            if (pending) return;

            start(async () => {
                const autoAddress = isAutoAddressId(addressId);
                const payload = {
                    customerId,
                    deliveryAddressId: autoAddress ? '' : addressId,
                    deliveryAddressName: autoAddress || !addressId ? addressFreeText.trim() || addressDefaultText.trim() || undefined : undefined,
                    orderDate,
                    deliveryDate,
                    items: items.map((i) => ({
                        productId: i.productId,
                        quantity: Number(i.quantity),
                        fulfillmentType: i.fulfillmentType,
                        salesEntityId: mode === 'staff' && !isInternalPurchaseOnly ? i.salesEntityId || undefined : undefined,
                        purchaseSupplierId: mode === 'staff' ? i.purchaseSupplierId || undefined : undefined,
                        salesUnitPrice: mode === 'staff' && !isInternalPurchaseOnly && i.salesUnitPrice !== '' ? Number(i.salesUnitPrice) : null,
                        purchaseUnitPrice: mode === 'staff' && i.purchaseUnitPrice !== '' ? Number(i.purchaseUnitPrice) : null,
                    })),
                    memo: memo.trim() || undefined,
                };
                let res = await createOrder(payload);
                if (!res.ok && 'duplicate' in res && res.duplicate) {
                    const proceed = window.confirm(res.error);
                    if (!proceed) {
                        setError('중복 가능성이 있어 주문 저장을 취소했습니다.');
                        return;
                    }
                    res = await createOrder({ ...payload, allowDuplicate: true });
                }
                if (res.ok) {
                    setSuccess(`주문 등록 완료 — 주문번호 ${res.orderNo}`);
                    // 폼 초기화 (거래처 모드면 거래처 유지)
                    setItems([makeEmptyLine()]);
                    setAddressFreeText('');
                    setMemo('');
                    setOrderDate(todayISO());
                    setDeliveryDate(tomorrowISO());
                    router.refresh();
                } else {
                    setError(res.error);
                }
            });
        }, 200);
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {/* 거래처 */}
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    거래처<span className="text-red-500 ml-0.5">*</span>
                </label>
                {mode === 'customer' ? (
                    <input
                        type="text"
                        readOnly
                        value={fixedCustomer?.name ?? ''}
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-700 cursor-not-allowed"
                    />
                ) : (
                    <Combobox
                        options={customerOptions}
                        value={customerId}
                        onChange={(v: string) => handleCustomerChange(v)}
                        placeholder="거래처명의 일부를 입력하세요 (대소문자 무관, 포함만 되면 OK)"
                        emptyText="일치하는 거래처가 없습니다"
                    />
                )}
            </div>

            {/* 일자 2개 + 하루씩 이동 버튼 */}
            {/* 함께 이동 버튼 */}
            <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium">주문일 + 도착일 함께</span>
                <button
                    type="button"
                    onClick={() => {
                        setOrderDate(shiftDate(orderDate, -1));
                        setDeliveryDate(shiftDate(deliveryDate, -1));
                    }}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition"
                >
                    ◀ 하루 전
                </button>
                <button
                    type="button"
                    onClick={() => {
                        setOrderDate(shiftDate(orderDate, 1));
                        setDeliveryDate(shiftDate(deliveryDate, 1));
                    }}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition"
                >
                    하루 후 ▶
                </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        주문일자<span className="text-red-500 ml-0.5">*</span>
                    </label>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setOrderDate(shiftDate(orderDate, -1))}
                            className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-2.5 text-xs text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition leading-none"
                        >◀</button>
                        <input
                            type="date"
                            value={orderDate}
                            onChange={(e) => setOrderDate(e.target.value)}
                            required
                            className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                        <button
                            type="button"
                            onClick={() => setOrderDate(shiftDate(orderDate, 1))}
                            className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-2.5 text-xs text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition leading-none"
                        >▶</button>
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        도착일자<span className="text-red-500 ml-0.5">*</span>
                    </label>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setDeliveryDate(shiftDate(deliveryDate, -1))}
                            className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-2.5 text-xs text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition leading-none"
                        >◀</button>
                        <input
                            type="date"
                            value={deliveryDate}
                            onChange={(e) => setDeliveryDate(e.target.value)}
                            required
                            className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                        <button
                            type="button"
                            onClick={() => setDeliveryDate(shiftDate(deliveryDate, 1))}
                            className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-2.5 text-xs text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition leading-none"
                        >▶</button>
                    </div>
                </div>
            </div>

            {/* 도착지 */}
            <Combobox
                label="도착지"
                required
                options={addressOptions}
                value={addressId}
                defaultText={addressDefaultText}
                onChange={(v: string) => handleAddressChange(v)}
                onFreeText={(t) => {
                    setAddressFreeText(t);
                    if (!t.trim() && isAutoAddressId(addressId)) {
                        setAddressFreeText(addressDefaultText);
                    }
                }}
                placeholder={
                    loading
                        ? '도착지 불러오는 중...'
                        : customerId
                            ? '도착지명 입력 (한 글자만 입력해도 검색)'
                            : mode === 'staff'
                                ? '도착지명 입력 시 거래처 자동 선택'
                                : '먼저 거래처를 선택하세요'
                }
                disabled={(mode !== 'staff' && !customerId) || loading}
                emptyText="등록된 도착지가 없습니다"
            />
            {selectedAddressDetail && (selectedAddressDetail.addressLine1 || selectedAddressDetail.contactPhone) && (
                <div className="-mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    {selectedAddressDetail.addressLine1 && (
                        <p>
                            <span className="font-medium text-slate-700">주소</span>{' '}
                            {selectedAddressDetail.addressLine1}
                            {selectedAddressDetail.addressLine2 ? ` ${selectedAddressDetail.addressLine2}` : ''}
                        </p>
                    )}
                    {selectedAddressDetail.contactPhone && (
                        <p className="mt-1">
                            <span className="font-medium text-slate-700">전화번호</span>{' '}
                            {selectedAddressDetail.contactPhone}
                        </p>
                    )}
                </div>
            )}

            {/* 제품 + 수량 라인들 */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-slate-700">
                        제품<span className="text-red-500 ml-0.5">*</span>
                    </label>
                    <button
                        type="button"
                        onClick={addLine}
                        disabled={!customerId}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                        <Plus size={14} /> 제품 추가
                    </button>
                </div>
                {isInternalPurchaseOnly && (
                    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        한양유화 창고 입고 오더입니다. 매출로 집계하지 않으며 매입처/매입단가만 입력합니다.
                    </div>
                )}
                <div className="space-y-3">
                    {items.map((it, idx) => (
                        <div key={it.key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <span className="text-sm font-semibold text-slate-700">품목 {idx + 1}</span>
                                <button
                                    type="button"
                                    onClick={() => removeLine(it.key)}
                                    disabled={items.length === 1}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-red-600 hover:border-red-200 disabled:opacity-30 disabled:hover:text-slate-400"
                                    title="삭제"
                                >
                                    <Trash2 size={15} />
                                </button>
                            </div>
                            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
                                <div className={mode === 'staff' ? 'lg:col-span-3' : 'lg:col-span-6'}>
                                    <label className="mb-1 block text-xs font-medium text-slate-500">제품명</label>
                                    <Combobox
                                        options={data?.products ?? []}
                                        value={it.productId}
                                        onChange={(v: string) => handleProductChange(it.key, v)}
                                        placeholder={
                                            !customerId
                                                ? '먼저 거래처 선택'
                                                : '제품명 입력 (대소문자 무관, 포함 검색)'
                                        }
                                        disabled={!customerId || loading}
                                        emptyText={
                                            mode === 'customer'
                                                ? '주문 이력 없는 제품입니다. 담당자에게 문의해주세요.'
                                                : '제품이 없습니다'
                                        }
                                    />
                                </div>
                                <div className={mode === 'staff' ? 'lg:col-span-2' : 'lg:col-span-3'}>
                                    <label className="mb-1 block text-xs font-medium text-slate-500">수량</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            min={0}
                                            step="any"
                                            value={it.quantity}
                                            onChange={(e) =>
                                                updateLine(it.key, { quantity: e.target.value })
                                            }
                                            placeholder="수량"
                                            className="w-full rounded-lg border border-slate-300 bg-white pl-3.5 pr-12 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                        />
                                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                                            톤
                                        </span>
                                    </div>
                                </div>
                                <div className={mode === 'staff' ? 'lg:col-span-2' : 'lg:col-span-3'}>
                                    <label className="mb-1 block text-xs font-medium text-slate-500">창고/직송</label>
                                    <select
                                        value={it.fulfillmentType}
                                        onChange={(e) => updateLine(it.key, { fulfillmentType: e.target.value })}
                                        disabled={!customerId || loading}
                                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                                    >
                                        <option value="">선택 필수</option>
                                        <option value="WAREHOUSE">창고</option>
                                        <option value="DIRECT">직송</option>
                                    </select>
                                </div>
                                {mode === 'staff' && (
                                    <>
                                        {!isInternalPurchaseOnly && (
                                            <div className="lg:col-span-2">
                                                <label className="mb-1 block text-xs font-medium text-slate-500">매출주체</label>
                                                <select
                                                    value={it.salesEntityId}
                                                    onChange={(e) => updateLine(it.key, { salesEntityId: e.target.value })}
                                                    disabled={!customerId || loading}
                                                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                                                >
                                                    <option value="">매출주체</option>
                                                    {(data?.companyEntities ?? []).map((company) => (
                                                        <option key={company.id} value={company.id}>{company.displayName}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                        <div className="lg:col-span-2">
                                            <label className="mb-1 block text-xs font-medium text-slate-500">매입처</label>
                                            <Combobox
                                                options={supplierOptions}
                                                value={it.purchaseSupplierId}
                                                onChange={(value: string) => updateLine(it.key, { purchaseSupplierId: value })}
                                                disabled={!customerId || loading}
                                                placeholder="매입처명 입력"
                                                emptyText="일치하는 매입처가 없습니다"
                                            />
                                        </div>
                                        {!isInternalPurchaseOnly && (
                                            <div className="lg:col-span-2">
                                                <label className="mb-1 block text-xs font-medium text-slate-500">매출단가</label>
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={it.salesUnitPrice}
                                                    onChange={(e) => updateLine(it.key, { salesUnitPrice: e.target.value })}
                                                    placeholder="매출단가"
                                                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2.5 text-right text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                                />
                                            </div>
                                        )}
                                        <div className="lg:col-span-1">
                                            <label className="mb-1 block text-xs font-medium text-slate-500">매입단가</label>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                value={it.purchaseUnitPrice}
                                                onChange={(e) => updateLine(it.key, { purchaseUnitPrice: e.target.value })}
                                                placeholder="매입단가"
                                                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2.5 text-right text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                            {mode === 'staff' && it.productId && (
                                <div className="mt-3 text-[11px] text-slate-500">
                                    {!isInternalPurchaseOnly && data?.products.find((product) => product.value === it.productId)?.defaultSalesEntityName && (
                                        <span>기본 매출주체 {data.products.find((product) => product.value === it.productId)?.defaultSalesEntityName}</span>
                                    )}
                                    {data?.products.find((product) => product.value === it.productId)?.lastPurchaseSupplierName && (
                                        <span className="ml-2">직전 매입처 {data.products.find((product) => product.value === it.productId)?.lastPurchaseSupplierName}</span>
                                    )}
                                    {!data?.products.find((product) => product.value === it.productId)?.lastPurchaseSupplierName && data?.products.find((product) => product.value === it.productId)?.defaultSupplierName && (
                                        <span className="ml-2">기본 매입처 {data.products.find((product) => product.value === it.productId)?.defaultSupplierName}</span>
                                    )}
                                    {!isInternalPurchaseOnly && it.salesUnitPrice && <span className="ml-2">직전 매출단가 {Number(it.salesUnitPrice).toLocaleString('ko-KR')}</span>}
                                    {it.purchaseUnitPrice && <span className="ml-2">직전 매입단가 {Number(it.purchaseUnitPrice).toLocaleString('ko-KR')}</span>}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* 메모 */}
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    메모 <span className="text-xs font-normal text-slate-400">(선택)</span>
                </label>
                <textarea
                    rows={2}
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="특이사항이 있으면 입력해주세요"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
            </div>

            {/* 메시지 */}
            {error && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}
            {success && (
                <div className="flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                    <span>{success}</span>
                </div>
            )}

            <button
                type="submit"
                disabled={pending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
                <Save size={16} />
                {pending ? '저장 중...' : '주문 저장'}
            </button>
        </form>
    );
}
