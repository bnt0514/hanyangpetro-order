import { OrderStatus } from './enums';

export const ORDER_STATUS_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
    REQUESTED: [
        OrderStatus.APPROVED,
        OrderStatus.REJECTED,
    ],
    CREDIT_OVER_LIMIT: [
        OrderStatus.APPROVED,
        OrderStatus.REJECTED,
    ],
    APPROVED: [
        OrderStatus.DISPATCHING,
        OrderStatus.REJECTED,
    ],
    DISPATCHING: [
        OrderStatus.DISPATCH_COMPLETED,
        OrderStatus.REJECTED,
    ],
    DISPATCH_COMPLETED: [
        OrderStatus.SHIPPED,
        OrderStatus.REJECTED,
    ],
    SHIPPED: [],
    REJECTED: [],
};

export function canTransition(
    from: OrderStatus,
    to: OrderStatus
): boolean {
    if (from === to) return false;
    const allowed = ORDER_STATUS_TRANSITIONS[from] ?? [];
    return allowed.includes(to);
}

export function assertTransition(
    from: OrderStatus,
    to: OrderStatus
): void {
    if (!canTransition(from, to)) {
        throw new Error(
            `허용되지 않는 주문 상태 전환입니다: ${from} -> ${to}`
        );
    }
}

export function isTerminalStatus(status: OrderStatus): boolean {
    return status === OrderStatus.SHIPPED || status === OrderStatus.REJECTED;
}

export const CUSTOMER_NOTIFIABLE_STATUSES: OrderStatus[] = [
    OrderStatus.REQUESTED,
    OrderStatus.APPROVED,
    OrderStatus.REJECTED,
    OrderStatus.DISPATCHING,
    OrderStatus.DISPATCH_COMPLETED,
    OrderStatus.SHIPPED,
];

export function shouldNotifyCustomer(newStatus: OrderStatus): boolean {
    return CUSTOMER_NOTIFIABLE_STATUSES.includes(newStatus);
}
