'use client';

import { useMemo, useState } from 'react';
import { ClipboardCopy } from 'lucide-react';
import { fmtNumber } from '@/lib/orders';

type OrderCopyItem = {
    productName: string;
    quantity: number;
    unit?: string | null;
};

type OrderCopyContext = {
    orderNo?: string | null;
    customerName?: string | null;
    deliveryDate?: string | null;
    deliveryAddress?: string | null;
};

function itemLine(item: OrderCopyItem, index: number) {
    const unit = item.unit || 'TON';
    return `${index + 1}. ${item.productName || '-'} / ${fmtNumber(item.quantity)}${unit} / -`;
}

export default function OrderCopyButton({
    items,
    context,
}: {
    items: OrderCopyItem[];
    context: OrderCopyContext;
}) {
    const [copied, setCopied] = useState(false);
    const message = useMemo(() => {
        const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
        return [
            '[한양유화 오더안내]',
            context.orderNo ? `오더번호: ${context.orderNo}` : null,
            context.customerName ? `거래처: ${context.customerName}` : null,
            context.deliveryDate ? `도착일: ${context.deliveryDate}` : null,
            context.deliveryAddress ? `도착지: ${context.deliveryAddress}` : null,
            '구분: 오더내역',
            `오더: ${items.length}건 / 합계 ${fmtNumber(totalQuantity)}TON`,
            '상세:',
            ...items.map(itemLine),
        ].filter((line): line is string => Boolean(line)).join('\n');
    }, [context, items]);

    async function copyMessage() {
        setCopied(false);
        try {
            await navigator.clipboard.writeText(message);
            setCopied(true);
        } catch {
            window.prompt('오더 내용을 복사하세요.', message);
        }
    }

    return (
        <div className="flex items-center gap-2">
            <button
                type="button"
                onClick={copyMessage}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                title="오더 내용을 복사합니다"
            >
                <ClipboardCopy size={13} /> 오더 복사
            </button>
            {copied && <span className="text-xs font-medium text-emerald-700">복사됨</span>}
        </div>
    );
}
