export const ORDER_STATUS = {
    REQUESTED: 'REQUESTED',
    CREDIT_OVER_LIMIT: 'CREDIT_OVER_LIMIT',
    REJECTED: 'REJECTED',
    APPROVED: 'APPROVED',
    DISPATCHING: 'DISPATCHING',
    DISPATCH_COMPLETED: 'DISPATCH_COMPLETED',
    SHIPPED: 'SHIPPED',
} as const;

export type CanonicalOrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const ORDER_STATUS_VALUES: CanonicalOrderStatus[] = [
    ORDER_STATUS.REQUESTED,
    ORDER_STATUS.CREDIT_OVER_LIMIT,
    ORDER_STATUS.REJECTED,
    ORDER_STATUS.APPROVED,
    ORDER_STATUS.DISPATCHING,
    ORDER_STATUS.DISPATCH_COMPLETED,
    ORDER_STATUS.SHIPPED,
];

export const ORDER_STATUS_LABEL: Record<string, string> = {
    REQUESTED: '신규주문',
    CREDIT_OVER_LIMIT: '여신초과',
    REJECTED: '반려',
    APPROVED: '승인완료',
    DISPATCHING: '배차중',
    DISPATCH_COMPLETED: '배차완료',
    SHIPPED: '출고완료',

    PENDING_SALES_REVIEW: '신규주문',
    SALES_REVIEWING: '신규주문',
    ON_HOLD: '신규주문',
    SUPPLIER_ORDER_REQUIRED: '승인완료',
    SUPPLIER_ORDER_COMPLETED: '승인완료',
    DISPATCH_WAITING: '배차중',
    DISPATCH_FAILED: '승인완료',
    DISPATCH_RETRY_SCHEDULED: '승인완료',
    READY_TO_SHIP: '출고완료',
    SHIPPING: '출고완료',
    DELIVERY_CONFIRM_PENDING: '출고완료',
    DELIVERY_CONFIRMED: '출고완료',
    DELIVERY_DISPUTED: '출고완료',
    ERP_INPUT_WAITING: '출고완료',
    ERP_INPUT_COMPLETED: '출고완료',
    INVOICE_WAITING: '출고완료',
    INVOICE_COMPLETED: '출고완료',
    COMPLETED: '출고완료',
    CANCELLED: '반려',
    DELETED: '삭제됨',
};

export const ORDER_STATUS_COLOR: Record<string, string> = {
    REQUESTED: 'bg-blue-100 text-blue-700',
    CREDIT_OVER_LIMIT: 'bg-red-100 text-red-700',
    REJECTED: 'bg-slate-100 text-slate-500',
    APPROVED: 'bg-emerald-100 text-emerald-700',
    DISPATCHING: 'bg-sky-100 text-sky-700',
    DISPATCH_COMPLETED: 'bg-cyan-100 text-cyan-700',
    SHIPPED: 'bg-orange-100 text-orange-700',

    PENDING_SALES_REVIEW: 'bg-blue-100 text-blue-700',
    SALES_REVIEWING: 'bg-blue-100 text-blue-700',
    ON_HOLD: 'bg-blue-100 text-blue-700',
    SUPPLIER_ORDER_REQUIRED: 'bg-emerald-100 text-emerald-700',
    SUPPLIER_ORDER_COMPLETED: 'bg-emerald-100 text-emerald-700',
    DISPATCH_WAITING: 'bg-sky-100 text-sky-700',
    DISPATCH_FAILED: 'bg-emerald-100 text-emerald-700',
    DISPATCH_RETRY_SCHEDULED: 'bg-emerald-100 text-emerald-700',
    READY_TO_SHIP: 'bg-orange-100 text-orange-700',
    SHIPPING: 'bg-orange-100 text-orange-700',
    DELIVERY_CONFIRM_PENDING: 'bg-orange-100 text-orange-700',
    DELIVERY_CONFIRMED: 'bg-orange-100 text-orange-700',
    DELIVERY_DISPUTED: 'bg-orange-100 text-orange-700',
    ERP_INPUT_WAITING: 'bg-orange-100 text-orange-700',
    ERP_INPUT_COMPLETED: 'bg-orange-100 text-orange-700',
    INVOICE_WAITING: 'bg-orange-100 text-orange-700',
    INVOICE_COMPLETED: 'bg-orange-100 text-orange-700',
    COMPLETED: 'bg-orange-100 text-orange-700',
    CANCELLED: 'bg-slate-100 text-slate-500',
    DELETED: 'bg-slate-200 text-slate-500',
};

export const LEGACY_ORDER_STATUS_TO_CANONICAL: Record<string, CanonicalOrderStatus> = {
    REQUESTED: ORDER_STATUS.REQUESTED,
    PENDING_SALES_REVIEW: ORDER_STATUS.REQUESTED,
    SALES_REVIEWING: ORDER_STATUS.REQUESTED,
    ON_HOLD: ORDER_STATUS.REQUESTED,
    CREDIT_OVER_LIMIT: ORDER_STATUS.CREDIT_OVER_LIMIT,
    REJECTED: ORDER_STATUS.REJECTED,
    CANCELLED: ORDER_STATUS.REJECTED,
    APPROVED: ORDER_STATUS.APPROVED,
    SUPPLIER_ORDER_REQUIRED: ORDER_STATUS.APPROVED,
    SUPPLIER_ORDER_COMPLETED: ORDER_STATUS.APPROVED,
    DISPATCH_WAITING: ORDER_STATUS.DISPATCHING,
    DISPATCHING: ORDER_STATUS.DISPATCHING,
    DISPATCH_FAILED: ORDER_STATUS.APPROVED,
    DISPATCH_RETRY_SCHEDULED: ORDER_STATUS.APPROVED,
    DISPATCH_COMPLETED: ORDER_STATUS.DISPATCH_COMPLETED,
    READY_TO_SHIP: ORDER_STATUS.SHIPPED,
    SHIPPING: ORDER_STATUS.SHIPPED,
    SHIPPED: ORDER_STATUS.SHIPPED,
    DELIVERY_CONFIRM_PENDING: ORDER_STATUS.SHIPPED,
    DELIVERY_CONFIRMED: ORDER_STATUS.SHIPPED,
    DELIVERY_DISPUTED: ORDER_STATUS.SHIPPED,
    ERP_INPUT_WAITING: ORDER_STATUS.SHIPPED,
    ERP_INPUT_COMPLETED: ORDER_STATUS.SHIPPED,
    INVOICE_WAITING: ORDER_STATUS.SHIPPED,
    INVOICE_COMPLETED: ORDER_STATUS.SHIPPED,
    COMPLETED: ORDER_STATUS.SHIPPED,
};

export const LEDGER_ORDER_STATUSES: CanonicalOrderStatus[] = [
    ORDER_STATUS.DISPATCH_COMPLETED,
    ORDER_STATUS.SHIPPED,
];

export function normalizeOrderStatus(status: string | null | undefined): CanonicalOrderStatus {
    return LEGACY_ORDER_STATUS_TO_CANONICAL[status ?? ''] ?? ORDER_STATUS.REQUESTED;
}

export function isCanonicalOrderStatus(status: string): status is CanonicalOrderStatus {
    return ORDER_STATUS_VALUES.includes(status as CanonicalOrderStatus);
}

export function statusLabel(s: string): string {
    return ORDER_STATUS_LABEL[s] ?? statusLabel(normalizeOrderStatus(s));
}

export function statusColor(s: string): string {
    return ORDER_STATUS_COLOR[s] ?? ORDER_STATUS_COLOR[normalizeOrderStatus(s)] ?? 'bg-slate-100 text-slate-600';
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
