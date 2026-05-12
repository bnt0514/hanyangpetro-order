/**
 * 주문 상태 한글 라벨 + 색상 클래스
 */
export const ORDER_STATUS_LABEL: Record<string, string> = {
    REQUESTED: '신규 주문',
    PENDING_SALES_REVIEW: '영업 검토 대기',
    SALES_REVIEWING: '영업 검토 중',
    APPROVED: '승인됨',
    ON_HOLD: '보류',
    REJECTED: '반려',
    SUPPLIER_ORDER_REQUIRED: '공급처 주문 필요',
    SUPPLIER_ORDER_COMPLETED: '공급처 주문 완료',
    DISPATCH_WAITING: '배차 대기',
    DISPATCHING: '배차 중',
    DISPATCH_COMPLETED: '배차 완료',
    DISPATCH_FAILED: '배차 실패',
    DISPATCH_RETRY_SCHEDULED: '배차 재시도 예정',
    READY_TO_SHIP: '출고 준비 완료',
    SHIPPING: '출고 진행 중',
    SHIPPED: '출고 완료',
    DELIVERY_CONFIRM_PENDING: '수령 확인 대기',
    DELIVERY_CONFIRMED: '수령 확인 완료',
    DELIVERY_DISPUTED: '수령 이슈 발생',
    ERP_INPUT_WAITING: 'ERP 입력 대기',
    ERP_INPUT_COMPLETED: 'ERP 입력 완료',
    INVOICE_WAITING: '계산서/마감 대기',
    INVOICE_COMPLETED: '계산서 완료',
    COMPLETED: '완료',
    CANCELLED: '취소됨',
    DELETED: '삭제됨',
};

export const ORDER_STATUS_COLOR: Record<string, string> = {
    REQUESTED: 'bg-blue-100 text-blue-700',
    PENDING_SALES_REVIEW: 'bg-amber-100 text-amber-800',
    SALES_REVIEWING: 'bg-amber-100 text-amber-800',
    APPROVED: 'bg-emerald-100 text-emerald-800',
    ON_HOLD: 'bg-orange-100 text-orange-800',
    REJECTED: 'bg-red-100 text-red-700',
    SUPPLIER_ORDER_REQUIRED: 'bg-violet-100 text-violet-800',
    SUPPLIER_ORDER_COMPLETED: 'bg-violet-100 text-violet-800',
    DISPATCH_WAITING: 'bg-indigo-100 text-indigo-700',
    DISPATCHING: 'bg-sky-100 text-sky-800',
    DISPATCH_COMPLETED: 'bg-cyan-100 text-cyan-800',
    DISPATCH_FAILED: 'bg-red-100 text-red-700',
    DISPATCH_RETRY_SCHEDULED: 'bg-orange-100 text-orange-800',
    READY_TO_SHIP: 'bg-teal-100 text-teal-800',
    SHIPPING: 'bg-teal-100 text-teal-800',
    SHIPPED: 'bg-teal-100 text-teal-800',
    DELIVERY_CONFIRM_PENDING: 'bg-lime-100 text-lime-800',
    DELIVERY_CONFIRMED: 'bg-lime-100 text-lime-800',
    DELIVERY_DISPUTED: 'bg-red-100 text-red-700',
    ERP_INPUT_WAITING: 'bg-purple-100 text-purple-800',
    ERP_INPUT_COMPLETED: 'bg-purple-100 text-purple-800',
    INVOICE_WAITING: 'bg-fuchsia-100 text-fuchsia-800',
    INVOICE_COMPLETED: 'bg-fuchsia-100 text-fuchsia-800',
    COMPLETED: 'bg-slate-200 text-slate-700',
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
