'use client';

import { useMemo, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { fmtNumber } from '@/lib/orders';
import type { DispatchNoticeContext, HanwhaDispatchDetailRow } from '@/components/HanwhaDispatchDetails';

function rowLine(row: HanwhaDispatchDetailRow, index: number) {
    const indoChi = row.indoChiName ?? '-';
    const material = row.materialName ?? row.materialNameRaw ?? '-';
    const quantity = row.quantityTon != null ? `${fmtNumber(row.quantityTon)}TON` : '-';
    const driver = row.driverInfo || '-';
    return `${index + 1}. ${indoChi} / ${material} / ${quantity} / ${driver}`;
}

export default function DispatchKakaoNoticeButton({
    rows,
    title,
    context,
}: {
    rows: HanwhaDispatchDetailRow[];
    title?: string;
    context?: DispatchNoticeContext;
}) {
    const [copied, setCopied] = useState(false);
    const message = useMemo(() => {
        const totalQuantity = rows.reduce((sum, row) => sum + (row.quantityTon ?? 0), 0);
        return [
            '[한양유화 배차안내]',
            context?.orderNo ? `오더번호: ${context.orderNo}` : null,
            context?.customerName ? `거래처: ${context.customerName}` : null,
            context?.deliveryDate ? `도착일: ${context.deliveryDate}` : null,
            context?.deliveryAddress ? `도착지: ${context.deliveryAddress}` : null,
            `구분: ${title ?? '배차내역'}`,
            `배차: ${rows.length}건 / 합계 ${fmtNumber(totalQuantity)}TON`,
            '상세:',
            ...rows.map(rowLine),
        ].filter((line): line is string => Boolean(line)).join('\n');
    }, [context, rows, title]);

    async function copyMessage() {
        setCopied(false);
        try {
            await navigator.clipboard.writeText(message);
            setCopied(true);
        } catch {
            window.prompt('알림톡에 넣을 내용을 복사하세요.', message);
        }
    }

    return (
        <div className="flex items-center gap-2">
            <button
                type="button"
                onClick={copyMessage}
                className="inline-flex items-center gap-1.5 rounded-lg bg-yellow-400 px-3 py-1.5 text-xs font-bold text-slate-900 hover:bg-yellow-300"
                title="배차내역을 복사합니다"
            >
                <MessageCircle size={14} /> 배차내역 복사
            </button>
            {copied && <span className="text-xs font-medium text-emerald-700">복사됨</span>}
        </div>
    );
}
