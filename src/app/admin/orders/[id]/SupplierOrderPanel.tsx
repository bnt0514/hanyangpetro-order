'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, MessageCircle, Save } from 'lucide-react';
import { bulkConfirmOrderPurchaseSupplier, prepareSupplierKakaoNotice } from '@/app/orders/actions';
import { useF8SaveShortcut } from '@/hooks/useF8SaveShortcut';

type SupplierOption = {
    id: string;
    supplierName: string;
    contactPerson?: string | null;
    phone?: string | null;
};

type SupplierOrderItem = {
    id: string;
    productName: string;
    productCode: string;
    requestedQuantity: number;
    unit: string;
    purchaseSupplierId?: string | null;
    purchaseSupplierName?: string | null;
    purchaseSupplierPhone?: string | null;
    purchaseSupplierConfirmedAt?: string | null;
};

export default function SupplierOrderPanel({
    orderId,
    currentStatus,
    items,
    suppliers,
}: {
    orderId: string;
    currentStatus: string;
    items: SupplierOrderItem[];
    suppliers: SupplierOption[];
}) {
    const router = useRouter();
    const bulkSaveRef = useRef<HTMLDivElement | null>(null);
    const [bulkSupplierId, setBulkSupplierId] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    const missingCount = items.filter((item) => !item.purchaseSupplierId || !item.purchaseSupplierConfirmedAt).length;
    const groupedItems = useMemo(() => {
        const groups = new Map<string, { supplierId: string; supplierName: string; phone?: string | null; items: SupplierOrderItem[] }>();
        for (const item of items) {
            if (!item.purchaseSupplierId) continue;
            const key = item.purchaseSupplierId;
            const existing = groups.get(key);
            if (existing) {
                existing.items.push(item);
            } else {
                groups.set(key, {
                    supplierId: key,
                    supplierName: item.purchaseSupplierName ?? '매입처 미지정',
                    phone: item.purchaseSupplierPhone,
                    items: [item],
                });
            }
        }
        return Array.from(groups.values());
    }, [items]);

    function saveBulk() {
        setError(null);
        setMessage(null);
        startTransition(async () => {
            const result = await bulkConfirmOrderPurchaseSupplier(orderId, bulkSupplierId);
            if (!result.ok) {
                setError(result.error);
                return;
            }
            setMessage('전체 품목 매입처를 저장했습니다.');
            router.refresh();
        });
    }

    function prepareNotice(supplierId: string) {
        setError(null);
        setMessage(null);
        startTransition(async () => {
            const result = await prepareSupplierKakaoNotice(orderId, supplierId);
            if (!result.ok) {
                setError(result.error);
                return;
            }
            setMessage(result.message);
            router.refresh();
        });
    }

    useF8SaveShortcut(saveBulk, { disabled: pending || !bulkSupplierId, scopeRef: bulkSaveRef });

    return (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="font-semibold text-slate-800">매입처 확인</h2>
                    <p className="mt-1 text-sm text-slate-500">
                        오더 수락 전 품목별 매입처를 저장해야 합니다. 같은 매입처면 일괄 저장을 사용하세요.
                    </p>
                </div>
                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${missingCount === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {missingCount === 0 ? '전체 저장됨' : `${missingCount}개 확인 필요`}
                </span>
            </div>

            {(error || message) && (
                <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                    {error ? <AlertCircle size={16} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0" />}
                    <span className="whitespace-pre-wrap">{error ?? message}</span>
                </div>
            )}

            <div ref={bulkSaveRef} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3">
                <select
                    value={bulkSupplierId}
                    onChange={(event) => setBulkSupplierId(event.target.value)}
                    disabled={pending}
                    className="min-w-56 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:opacity-60"
                >
                    <option value="">일괄 저장할 매입처 선택</option>
                    {suppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>{supplier.supplierName}</option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={saveBulk}
                    disabled={pending || !bulkSupplierId}
                    title="이 영역에서 F8로도 저장할 수 있습니다"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
                >
                    {pending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    전체 품목 매입처 저장
                </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
                {groupedItems.length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                        아직 저장된 매입처가 없습니다.
                    </div>
                )}
                {groupedItems.map((group) => (
                    <div key={group.supplierId} className="rounded-xl border border-slate-200 p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="font-semibold text-slate-800">{group.supplierName}</p>
                                <p className="text-xs text-slate-500">{group.phone ? `담당 연락처 ${group.phone}` : '담당 연락처 없음'}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => prepareNotice(group.supplierId)}
                                disabled={pending || currentStatus !== 'APPROVED'}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                title={currentStatus === 'APPROVED' ? '알림톡 API 연결 전까지 메시지만 준비합니다' : '오더 수락 후 사용 가능합니다'}
                            >
                                <MessageCircle size={14} /> 알림톡 준비
                            </button>
                        </div>
                        <ul className="mt-3 space-y-1 text-sm text-slate-600">
                            {group.items.map((item) => (
                                <li key={item.id} className="flex justify-between gap-3">
                                    <span>{item.productName}</span>
                                    <span className="shrink-0 font-medium">{item.requestedQuantity.toLocaleString('ko-KR')} {item.unit}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
        </section>
    );
}