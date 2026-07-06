/**
 * 한양유화 주문 상태 머신
 *
 * §6 상태 전환 규칙을 코드로 강제한다.
 * - 모든 상태 변경은 반드시 canTransition()을 통과해야 한다.
 * - 변경 시 OrderStatusHistory + NotificationLog 기록은 service layer에서 함께 처리.
 */

import { OrderStatus } from './enums';

/**
 * 각 상태에서 다음으로 이동 가능한 상태들의 화이트리스트.
 * 무제한으로 열어두지 않는다 (§6).
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
    // ----- Intake -----
    REQUESTED: [
        OrderStatus.PENDING_SALES_REVIEW,
        OrderStatus.CANCELLED,
    ],

    // ----- Review -----
    PENDING_SALES_REVIEW: [
        OrderStatus.SALES_REVIEWING,
        OrderStatus.APPROVED,
        OrderStatus.REJECTED,
        OrderStatus.ON_HOLD,
        OrderStatus.CANCELLED,
    ],
    SALES_REVIEWING: [
        OrderStatus.APPROVED,
        OrderStatus.REJECTED,
        OrderStatus.ON_HOLD,
        OrderStatus.CANCELLED,
    ],
    CREDIT_OVER_LIMIT: [
        OrderStatus.APPROVED,
        OrderStatus.REJECTED,
        OrderStatus.ON_HOLD,
        OrderStatus.CANCELLED,
    ],
    ON_HOLD: [
        OrderStatus.SALES_REVIEWING,
        OrderStatus.APPROVED,
        OrderStatus.REJECTED,
        OrderStatus.CANCELLED,
    ],

    // 승인 후: 공급처 주문 필요한 경우 vs 내부 재고/한화 직오더로 바로 배차
    APPROVED: [
        OrderStatus.SUPPLIER_ORDER_REQUIRED,
        OrderStatus.DISPATCH_WAITING, // 공급처 주문 불필요 시
        OrderStatus.CANCELLED,
    ],

    // 반려는 종료. 재오픈은 새 주문으로 처리.
    REJECTED: [],

    // ----- Supplier -----
    SUPPLIER_ORDER_REQUIRED: [
        OrderStatus.SUPPLIER_ORDER_COMPLETED,
        OrderStatus.ON_HOLD,
        OrderStatus.CANCELLED,
    ],
    SUPPLIER_ORDER_COMPLETED: [
        OrderStatus.DISPATCH_WAITING,
        OrderStatus.CANCELLED,
    ],

    // ----- Dispatch -----
    DISPATCH_WAITING: [
        OrderStatus.DISPATCHING,
        OrderStatus.CANCELLED,
    ],
    DISPATCHING: [
        OrderStatus.DISPATCH_COMPLETED,
        OrderStatus.DISPATCH_FAILED,
        OrderStatus.CANCELLED,
    ],
    DISPATCH_FAILED: [
        OrderStatus.DISPATCH_RETRY_SCHEDULED,
        OrderStatus.CANCELLED,
    ],
    DISPATCH_RETRY_SCHEDULED: [
        OrderStatus.DISPATCHING,
        OrderStatus.CANCELLED,
    ],
    DISPATCH_COMPLETED: [
        OrderStatus.READY_TO_SHIP,
        OrderStatus.CANCELLED,
    ],

    // ----- Shipment -----
    READY_TO_SHIP: [
        OrderStatus.SHIPPING,
        OrderStatus.CANCELLED,
    ],
    SHIPPING: [
        OrderStatus.SHIPPED,
        OrderStatus.CANCELLED,
    ],
    SHIPPED: [
        OrderStatus.DELIVERY_CONFIRM_PENDING,
        OrderStatus.DELIVERY_CONFIRMED, // 내부 직접 확인 가능
        OrderStatus.DELIVERY_DISPUTED,
        OrderStatus.ERP_INPUT_WAITING, // 수령 확인을 건너뛰고 ERP 입력 가능
    ],

    // ----- Receipt -----
    DELIVERY_CONFIRM_PENDING: [
        OrderStatus.DELIVERY_CONFIRMED,
        OrderStatus.DELIVERY_DISPUTED,
        OrderStatus.ERP_INPUT_WAITING, // 자동/수동 간주
    ],
    DELIVERY_CONFIRMED: [
        OrderStatus.ERP_INPUT_WAITING,
    ],
    DELIVERY_DISPUTED: [
        // 이슈 해결 후 재진입 또는 취소
        OrderStatus.DELIVERY_CONFIRMED,
        OrderStatus.CANCELLED,
    ],

    // ----- ERP -----
    ERP_INPUT_WAITING: [
        OrderStatus.ERP_INPUT_COMPLETED,
    ],
    ERP_INPUT_COMPLETED: [
        OrderStatus.INVOICE_WAITING,
    ],

    // ----- Invoice / Close -----
    INVOICE_WAITING: [
        OrderStatus.INVOICE_COMPLETED,
    ],
    INVOICE_COMPLETED: [
        OrderStatus.COMPLETED,
    ],
    COMPLETED: [],
    CANCELLED: [],
};

/** 가드: from → to 전환이 허용되는가 */
export function canTransition(
    from: OrderStatus,
    to: OrderStatus
): boolean {
    if (from === to) return false;
    const allowed = ORDER_STATUS_TRANSITIONS[from] ?? [];
    return allowed.includes(to);
}

/** 사람이 읽을 수 있는 에러 메시지 */
export function assertTransition(
    from: OrderStatus,
    to: OrderStatus
): void {
    if (!canTransition(from, to)) {
        throw new Error(
            `잘못된 상태 전환: ${from} → ${to} (허용된 전환: ${ORDER_STATUS_TRANSITIONS[from]?.join(', ') || '없음'
            })`
        );
    }
}

/** 종결 상태 여부 */
export function isTerminalStatus(status: OrderStatus): boolean {
    return status === OrderStatus.COMPLETED ||
        status === OrderStatus.CANCELLED ||
        status === OrderStatus.REJECTED;
}

/** 거래처 알림이 필요한 상태 변경 (§10 후반부) */
export const CUSTOMER_NOTIFIABLE_STATUSES: OrderStatus[] = [
    OrderStatus.REQUESTED,
    OrderStatus.APPROVED,
    OrderStatus.REJECTED,
    OrderStatus.ON_HOLD,
    OrderStatus.DISPATCH_FAILED,
    OrderStatus.DISPATCH_RETRY_SCHEDULED,
    OrderStatus.DISPATCH_COMPLETED,
    OrderStatus.READY_TO_SHIP,
    OrderStatus.SHIPPED,
    OrderStatus.DELIVERY_CONFIRM_PENDING,
];

export function shouldNotifyCustomer(newStatus: OrderStatus): boolean {
    return CUSTOMER_NOTIFIABLE_STATUSES.includes(newStatus);
}
