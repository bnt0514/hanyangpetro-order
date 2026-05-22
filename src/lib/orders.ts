/**
 * 주문 상태 한글 라벨 + 색상 클래스
 */
export const ORDER_STATUS_LABEL: Record<string, string> = {
    // ── 진행 ──
    REQUESTED: '신규주문',
    PENDING_SALES_REVIEW: '검토대기',
    SALES_REVIEWING: '검토중',
    APPROVED: '승인완료',
    ON_HOLD: '보류',
    REJECTED: '반려',
    SUPPLIER_ORDER_REQUIRED: '승인완료',
    SUPPLIER_ORDER_COMPLETED: '승인완료',
    DISPATCH_WAITING: '배차대기',
    DISPATCHING: '배차대기',
    DISPATCH_COMPLETED: '배차완료',
    DISPATCH_FAILED: '미배차',
    DISPATCH_RETRY_SCHEDULED: '배차대기',
    READY_TO_SHIP: '배차완료',
    SHIPPING: '배차완료',
    SHIPPED: '배차완료',
    DELIVERY_CONFIRM_PENDING: '배차완료',
    DELIVERY_CONFIRMED: '입고완료',
    DELIVERY_DISPUTED: '배차완료',
    ERP_INPUT_WAITING: '입고완료',
    ERP_INPUT_COMPLETED: '입고완료',
    INVOICE_WAITING: '입고완료',
    INVOICE_COMPLETED: '입고완료',
    COMPLETED: '입고완료',
    // ── 종료 ──
    CANCELLED: '취소됨',
    DELETED: '삭제됨',
};

export const ORDER_STATUS_COLOR: Record<string, string> = {
    REQUESTED: 'bg-blue-100 text-blue-700',
    PENDING_SALES_REVIEW: 'bg-amber-100 text-amber-700',
    SALES_REVIEWING: 'bg-amber-100 text-amber-700',
    APPROVED: 'bg-emerald-100 text-emerald-700',
    ON_HOLD: 'bg-orange-100 text-orange-700',
    REJECTED: 'bg-red-100 text-red-700',
    SUPPLIER_ORDER_REQUIRED: 'bg-emerald-100 text-emerald-700',
    SUPPLIER_ORDER_COMPLETED: 'bg-emerald-100 text-emerald-700',
    DISPATCH_WAITING: 'bg-indigo-100 text-indigo-700',
    DISPATCHING: 'bg-indigo-100 text-indigo-700',
    DISPATCH_COMPLETED: 'bg-cyan-100 text-cyan-700',
    DISPATCH_FAILED: 'bg-indigo-100 text-indigo-700',
    DISPATCH_RETRY_SCHEDULED: 'bg-indigo-100 text-indigo-700',
    READY_TO_SHIP: 'bg-cyan-100 text-cyan-700',
    SHIPPING: 'bg-cyan-100 text-cyan-700',
    SHIPPED: 'bg-cyan-100 text-cyan-700',
    DELIVERY_CONFIRM_PENDING: 'bg-cyan-100 text-cyan-700',
    DELIVERY_CONFIRMED: 'bg-violet-100 text-violet-700',
    DELIVERY_DISPUTED: 'bg-cyan-100 text-cyan-700',
    ERP_INPUT_WAITING: 'bg-violet-100 text-violet-700',
    ERP_INPUT_COMPLETED: 'bg-violet-100 text-violet-700',
    INVOICE_WAITING: 'bg-violet-100 text-violet-700',
    INVOICE_COMPLETED: 'bg-violet-100 text-violet-700',
    COMPLETED: 'bg-violet-100 text-violet-700',
    CANCELLED: 'bg-slate-100 text-slate-500',
    DELETED: 'bg-slate-200 text-slate-500',
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
