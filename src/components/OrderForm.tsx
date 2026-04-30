'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, AlertCircle, CheckCircle2, Save } from 'lucide-react';
import Combobox, { type ComboboxOption } from '@/components/Combobox';
import { createOrder } from '@/app/orders/actions';

type CustomerData = {
    addresses: ComboboxOption[];
    products: ComboboxOption[];
};

interface Props {
    /** 'customer' 모드: 거래처 픽스, 'staff' 모드: 거래처도 선택 */
    mode: 'customer' | 'staff';
    /** customer 모드에서 고정될 거래처 정보 */
    fixedCustomer?: { id: string; name: string };
    /** staff 모드에서 거래처 옵션 목록 */
    customerOptions?: ComboboxOption[];
}

type LineItem = { key: number; productId: string; quantity: string };

function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function tomorrowISO() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function OrderForm({ mode, fixedCustomer, customerOptions = [] }: Props) {
    const router = useRouter();
    const [pending, start] = useTransition();

    const [customerId, setCustomerId] = useState(fixedCustomer?.id ?? '');
    const [data, setData] = useState<CustomerData | null>(null);
    const [loading, setLoading] = useState(false);

    const [orderDate, setOrderDate] = useState(todayISO());
    const [deliveryDate, setDeliveryDate] = useState(tomorrowISO());
    const [addressId, setAddressId] = useState('');
    const [items, setItems] = useState<LineItem[]>([{ key: 1, productId: '', quantity: '' }]);
    const [memo, setMemo] = useState('');

    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // 거래처 변경 시 도착지/제품 다시 로드
    useEffect(() => {
        if (!customerId) {
            setData(null);
            setAddressId('');
            return;
        }
        let cancel = false;
        setLoading(true);
        fetch(`/api/customers/${customerId}/data`)
            .then((r) => r.json())
            .then((d) => {
                if (cancel) return;
                setData(d);
                // 기본 도착지 자동 선택 (첫 번째 = isDefault desc 정렬됨)
                if (d.addresses?.length > 0) setAddressId(d.addresses[0].value);
                else setAddressId('');
            })
            .catch(() => setError('거래처 데이터 로드 실패'))
            .finally(() => !cancel && setLoading(false));
        return () => {
            cancel = true;
        };
    }, [customerId]);

    function addLine() {
        setItems((prev) => [...prev, { key: Date.now(), productId: '', quantity: '' }]);
    }
    function removeLine(key: number) {
        setItems((prev) => (prev.length === 1 ? prev : prev.filter((i) => i.key !== key)));
    }
    function updateLine(key: number, patch: Partial<LineItem>) {
        setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
    }

    /** 누락된 필수 값을 정확히 알려줌. 다 되면 null. */
    function getMissingMsg(): string | null {
        if (!customerId) return '거래처를 선택해주세요.';
        if (!addressId) return '도착지를 선택해주세요.';
        if (!orderDate) return '주문일자를 입력해주세요.';
        if (!deliveryDate) return '도착일자를 입력해주세요.';
        for (let idx = 0; idx < items.length; idx++) {
            const it = items[idx];
            if (!it.productId) return `${idx + 1}번째 제품을 선택해주세요.`;
            if (!it.quantity || Number(it.quantity) <= 0)
                return `${idx + 1}번째 제품의 수량을 입력해주세요.`;
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
                const res = await createOrder({
                    customerId,
                    deliveryAddressId: addressId,
                    orderDate,
                    deliveryDate,
                    items: items.map((i) => ({
                        productId: i.productId,
                        quantity: Number(i.quantity),
                    })),
                    memo: memo.trim() || undefined,
                });
                if (res.ok) {
                    setSuccess(`주문 등록 완료 — 주문번호 ${res.orderNo}`);
                    // 폼 초기화 (거래처 모드면 거래처 유지)
                    setItems([{ key: Date.now(), productId: '', quantity: '' }]);
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
                        onChange={(v: string) => setCustomerId(v)}
                        placeholder="거래처명의 일부를 입력하세요 (대소문자 무관, 포함만 되면 OK)"
                        emptyText="일치하는 거래처가 없습니다"
                    />
                )}
            </div>

            {/* 일자 2개 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        주문일자<span className="text-red-500 ml-0.5">*</span>
                    </label>
                    <input
                        type="date"
                        value={orderDate}
                        onChange={(e) => setOrderDate(e.target.value)}
                        required
                        className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        도착일자<span className="text-red-500 ml-0.5">*</span>
                    </label>
                    <input
                        type="date"
                        value={deliveryDate}
                        onChange={(e) => setDeliveryDate(e.target.value)}
                        required
                        className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                </div>
            </div>

            {/* 도착지 */}
            <Combobox
                label="도착지"
                required
                options={data?.addresses ?? []}
                value={addressId}
                onChange={(v: string) => setAddressId(v)}
                placeholder={
                    !customerId
                        ? '먼저 거래처를 선택하세요'
                        : loading
                            ? '도착지 불러오는 중...'
                            : '도착지명 입력 (한 글자만 입력해도 검색)'
                }
                disabled={!customerId || loading}
                emptyText="등록된 도착지가 없습니다"
            />

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
                <div className="space-y-2">
                    {items.map((it) => (
                        <div key={it.key} className="grid grid-cols-12 gap-2 items-start">
                            <div className="col-span-7">
                                <Combobox
                                    options={data?.products ?? []}
                                    value={it.productId}
                                    onChange={(v: string) => updateLine(it.key, { productId: v })}
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
                            <div className="col-span-4">
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
                            <div className="col-span-1">
                                <button
                                    type="button"
                                    onClick={() => removeLine(it.key)}
                                    disabled={items.length === 1}
                                    className="inline-flex h-[42px] w-full items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-red-600 hover:border-red-200 disabled:opacity-30 disabled:hover:text-slate-400"
                                    title="삭제"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
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
