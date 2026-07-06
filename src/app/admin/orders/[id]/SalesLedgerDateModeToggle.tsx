'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Loader2 } from 'lucide-react';
import { updateOrderPurchaseLedgerDateMode, updateOrderSalesLedgerDateMode } from '@/app/orders/actions';

export default function SalesLedgerDateModeToggle({
    orderId,
    shipAhead,
    shipAheadDate,
    currentSalesDateLabel,
    purchaseCarryover,
    purchaseCarryoverDate,
    currentPurchaseDateLabel,
}: {
    orderId: string;
    shipAhead: boolean;
    shipAheadDate: string;
    currentSalesDateLabel: string;
    purchaseCarryover: boolean;
    purchaseCarryoverDate: string;
    currentPurchaseDateLabel: string;
}) {
    const router = useRouter();
    const [salesChecked, setSalesChecked] = useState(shipAhead);
    const [purchaseChecked, setPurchaseChecked] = useState(purchaseCarryover);
    const [message, setMessage] = useState('');
    const [isPending, startTransition] = useTransition();

    function toggleSales(nextChecked: boolean) {
        setSalesChecked(nextChecked);
        setMessage('');
        startTransition(async () => {
            const result = await updateOrderSalesLedgerDateMode(
                orderId,
                nextChecked,
                nextChecked ? '선출하 체크' : '선출하 해제',
            );
            if (!result.ok) {
                setSalesChecked(!nextChecked);
                setMessage(result.error);
                return;
            }
            setMessage(nextChecked ? `매출일자를 ${shipAheadDate}로 변경했습니다.` : '매출일자를 도착일 기준으로 되돌렸습니다.');
            router.refresh();
        });
    }

    function togglePurchase(nextChecked: boolean) {
        setPurchaseChecked(nextChecked);
        setMessage('');
        startTransition(async () => {
            const result = await updateOrderPurchaseLedgerDateMode(
                orderId,
                nextChecked,
                nextChecked ? '매입이월 체크' : '매입이월 해제',
            );
            if (!result.ok) {
                setPurchaseChecked(!nextChecked);
                setMessage(result.error);
                return;
            }
            setMessage(nextChecked ? `매입일자를 ${purchaseCarryoverDate}로 변경했습니다.` : '매입일자를 기준일로 되돌렸습니다.');
            router.refresh();
        });
    }

    return (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
            <label className="flex cursor-pointer items-start gap-2 text-xs text-amber-800">
                <input
                    type="checkbox"
                    checked={salesChecked}
                    onChange={(event) => toggleSales(event.target.checked)}
                    disabled={isPending}
                    className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-200 disabled:opacity-60"
                />
                <span className="min-w-0">
                    <span className="inline-flex items-center gap-1 font-bold">
                        {isPending ? <Loader2 size={13} className="animate-spin" /> : <CalendarClock size={13} />}
                        선출하 / 매출이월
                    </span>
                    <span className="block text-amber-700">
                        현재 매출일자 {currentSalesDateLabel} · 체크 시 {shipAheadDate}
                    </span>
                </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-xs text-violet-800">
                <input
                    type="checkbox"
                    checked={purchaseChecked}
                    onChange={(event) => togglePurchase(event.target.checked)}
                    disabled={isPending}
                    className="mt-0.5 h-4 w-4 rounded border-violet-300 text-violet-600 focus:ring-violet-200 disabled:opacity-60"
                />
                <span className="min-w-0">
                    <span className="inline-flex items-center gap-1 font-bold">
                        {isPending ? <Loader2 size={13} className="animate-spin" /> : <CalendarClock size={13} />}
                        매입이월
                    </span>
                    <span className="block text-violet-700">
                        현재 매입일자 {currentPurchaseDateLabel} · 체크 시 {purchaseCarryoverDate}
                    </span>
                </span>
            </label>
            {message && <p className="text-[11px] text-amber-700">{message}</p>}
        </div>
    );
}
