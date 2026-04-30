/**
 * 주문 상태 한글 라벨 + 색상 클래스
 */
export const ORDER_STATUS_LABEL: Record<string, string> = {
    REQUESTED: '신규 주문',
    PENDING_SALES_REVIEW: '영업 검토 대기',
    APPROVED: '승인됨',
    ON_HOLD: '보류',
    REJECTED: '반려',
    DISPATCH_WAITING: '배차 대기',
    DISPATCH_FAILED: '배차 실패',
    SHIPPED: '출고 완료',
    ERP_INPUT_WAITING: 'ERP 입력 대기',
    COMPLETED: '완료',
    CANCELLED: '취소됨',
};

export const ORDER_STATUS_COLOR: Record<string, string> = {
    REQUESTED: 'bg-blue-100 text-blue-700',
    PENDING_SALES_REVIEW: 'bg-amber-100 text-amber-800',
    APPROVED: 'bg-emerald-100 text-emerald-800',
    ON_HOLD: 'bg-orange-100 text-orange-800',
    REJECTED: 'bg-red-100 text-red-700',
    DISPATCH_WAITING: 'bg-indigo-100 text-indigo-700',
    DISPATCH_FAILED: 'bg-red-100 text-red-700',
    SHIPPED: 'bg-teal-100 text-teal-800',
    ERP_INPUT_WAITING: 'bg-purple-100 text-purple-800',
    COMPLETED: 'bg-slate-200 text-slate-700',
    CANCELLED: 'bg-slate-100 text-slate-500',
};

export function statusLabel(s: string): string {
    return ORDER_STATUS_LABEL[s] ?? s;
}

export function statusColor(s: string): string {
    return ORDER_STATUS_COLOR[s] ?? 'bg-slate-100 text-slate-600';
}

export function fmtDate(d: Date | string | null | undefined): string {
    if (!d) return '-';
    const dt = typeof d === 'string' ? new Date(d) : d;
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function fmtDateTime(d: Date | string | null | undefined): string {
    if (!d) return '-';
    const dt = typeof d === 'string' ? new Date(d) : d;
    return `${fmtDate(dt)} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

export function fmtNumber(n: number | null | undefined): string {
    if (n === null || n === undefined) return '-';
    return n.toLocaleString('ko-KR');
}
