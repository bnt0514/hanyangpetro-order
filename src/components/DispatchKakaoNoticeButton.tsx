'use client';

import { useMemo, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { fmtNumber } from '@/lib/orders';
import type { DispatchNoticeContext, HanwhaDispatchDetailRow } from '@/components/HanwhaDispatchDetails';

type NoticeVariant = 'compact' | 'full';

function fullRowLine(row: HanwhaDispatchDetailRow, index: number) {
    const indoChi = row.indoChiName ?? '-';
    const material = row.materialName ?? row.materialNameRaw ?? '-';
    const quantity = row.quantityTon != null ? `${fmtNumber(row.quantityTon)}TON` : '-';
    const driver = row.driverInfo || '-';
    return `${index + 1}. ${indoChi} / ${material} / ${quantity} / ${driver}`;
}

function compactMaterialLine(row: HanwhaDispatchDetailRow) {
    const material = row.materialName ?? row.materialNameRaw ?? '-';
    const quantity = row.quantityTon != null ? ` ${fmtNumber(row.quantityTon)}톤` : '';
    return `${material}${quantity}`;
}

function isVehicleNumber(value: string) {
    return /\d{4}\s*-\s*[가-힣]{2,}\d{1,3}[가-힣]/.test(value);
}

function isPhoneNumber(value: string) {
    return /01[016789][\s-]?\d{3,4}[\s-]?\d{4}/.test(value);
}

function compactDriverLine(row: HanwhaDispatchDetailRow) {
    const parts = (row.driverInfo || '')
        .split('·')
        .map((part) => part.trim())
        .filter(Boolean);
    const driverName = parts.find((part) => /^[가-힣]{2,6}$/.test(part));
    const driverPhone = parts.find(isPhoneNumber);
    const fallback = parts.filter((part) => !isVehicleNumber(part)).join(' ');
    const text = [driverName, driverPhone].filter(Boolean).join(' ') || fallback || row.driverInfo || '-';
    return `기사 ${text}`;
}

function compactMessage(rows: HanwhaDispatchDetailRow[], context?: DispatchNoticeContext) {
    const address = context?.deliveryAddress?.trim() || rows[0]?.indoChiName?.trim() || '-';
    const lines = [address];
    rows.forEach((row) => {
        lines.push(compactMaterialLine(row));
        lines.push(compactDriverLine(row));
    });
    return lines.filter(Boolean).join('\n');
}

function fullMessage(rows: HanwhaDispatchDetailRow[], title?: string, context?: DispatchNoticeContext) {
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
        ...rows.map(fullRowLine),
    ].filter((line): line is string => Boolean(line)).join('\n');
}

export default function DispatchKakaoNoticeButton({
    rows,
    title,
    context,
    variant = 'compact',
}: {
    rows: HanwhaDispatchDetailRow[];
    title?: string;
    context?: DispatchNoticeContext;
    variant?: NoticeVariant;
}) {
    const [copied, setCopied] = useState(false);
    const message = useMemo(() => {
        return variant === 'full'
            ? fullMessage(rows, title, context)
            : compactMessage(rows, context);
    }, [context, rows, title, variant]);

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
