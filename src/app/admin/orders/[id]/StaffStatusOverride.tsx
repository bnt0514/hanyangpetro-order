'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import { manualChangeOrderStatus } from '@/app/orders/actions';
import { confirmOrderReceipt } from '@/app/dispatch/actions';
import { statusLabel } from '@/lib/orders';

const STATUS_GROUPS: { label: string; statuses: string[] }[] = [
    { label: '신규 / 검토', statuses: ['REQUESTED', 'PENDING_SALES_REVIEW', 'SALES_REVIEWING'] },
    { label: '승인 / 보류 / 반려', statuses: ['APPROVED', 'ON_HOLD', 'REJECTED'] },
    { label: '배차', statuses: ['DISPATCH_WAITING', 'DISPATCH_COMPLETED', 'DISPATCH_FAILED'] },
    { label: '출고 / 수령', statuses: ['READY_TO_SHIP', 'SHIPPING', 'SHIPPED', 'DELIVERY_CONFIRM_PENDING', 'DELIVERY_CONFIRMED', 'DELIVERY_DISPUTED'] },
    { label: 'ERP / 계산서 / 완료', statuses: ['ERP_INPUT_WAITING', 'ERP_INPUT_COMPLETED', 'INVOICE_WAITING', 'INVOICE_COMPLETED', 'COMPLETED'] },
    { label: '취소', statuses: ['CANCELLED'] },
];

export default function StaffStatusOverride({
    orderId,
    currentStatus,
}: {
    orderId: string;
    currentStatus: string;
}) {
    const router = useRouter();
    const [selectedStatus, setSelectedStatus] = useState(currentStatus);
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    function changeManually() {
        if (selectedStatus === currentStatus) {
            setError('현재와 다른 상태를 선택해주세요.');
            return;
        }
        const reason = window.prompt('상태를 수동 변경하는 사유를 입력하세요');
        if (reason === null) return;
        setError(null);
        startTransition(async () => {
            const r = await manualChangeOrderStatus(orderId, selectedStatus, reason);
            if (!r.ok) {
                setError(r.error);
                return;
            }
            router.refresh();
        });
    }

    function completeReceipt() {
        const reason = window.prompt('입고 완료 메모를 입력하세요', '익일 제품 수령 확인 후 입고 완료');
        if (reason === null) return;
        setError(null);
        startTransition(async () => {
            const r = await confirmOrderReceipt(orderId, reason);
            if (!r.ok) {
                setError(r.error);
                return;
            }
            router.refresh();
        });
    }

    return (
        <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2 flex-wrap justify-end">
                <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value)}
                    disabled={pending}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-500 disabled:opacity-60"
                    title="직원 전용 상태 수동 변경"
                >
                    {STATUS_GROUPS.map((group) => (
                        <optgroup key={group.label} label={group.label}>
                            {group.statuses.map((status) => (
                                <option key={status} value={status}>
                                    {statusLabel(status)}
                                </option>
                            ))}
                        </optgroup>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={changeManually}
                    disabled={pending || selectedStatus === currentStatus}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                    {pending ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                    상태 변경
                </button>
                <button
                    type="button"
                    onClick={completeReceipt}
                    disabled={pending || currentStatus === 'COMPLETED'}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                    {pending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                    입고 완료
                </button>
            </div>
            {error && (
                <div className="flex items-center gap-1 text-xs text-red-600">
                    <AlertCircle size={13} /> {error}
                </div>
            )}
        </div>
    );
}
