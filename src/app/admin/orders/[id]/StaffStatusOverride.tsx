'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2, RotateCcw } from 'lucide-react';
import { manualChangeOrderStatus } from '@/app/orders/actions';
import { ORDER_STATUS, ORDER_STATUS_VALUES, normalizeOrderStatus, statusLabel, type CanonicalOrderStatus } from '@/lib/orders';

export default function StaffStatusOverride({
    orderId,
    currentStatus,
}: {
    orderId: string;
    currentStatus: string;
}) {
    const router = useRouter();
    const currentCanonicalStatus = normalizeOrderStatus(currentStatus);
    const [selectedStatus, setSelectedStatus] = useState<CanonicalOrderStatus>(ORDER_STATUS.SHIPPED);
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    function changeManually() {
        if (selectedStatus === currentCanonicalStatus) {
            setError('현재와 다른 상태를 선택해주세요.');
            return;
        }
        const reason = window.prompt('상태를 수동 변경하는 사유를 입력하세요.');
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

    return (
        <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
                <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value as CanonicalOrderStatus)}
                    disabled={pending}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-500 disabled:opacity-60"
                    title="직원 전용 상태 수동 변경"
                >
                    {ORDER_STATUS_VALUES.map((status) => (
                        <option key={status} value={status}>
                            {statusLabel(status)}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={changeManually}
                    disabled={pending || selectedStatus === currentCanonicalStatus}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                    {pending ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                    상태 변경
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
