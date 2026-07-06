/**
 * 한양유화 주문관제 시스템 - 도메인 enum 및 한글 라벨
 *
 * Prisma enum과 1:1 동기화 (prisma/schema.prisma).
 * UI 표시용 한글 라벨, 색상 토큰, 그룹핑을 함께 제공한다.
 */

// ============================================================
// User role
// ============================================================
export const UserRole = {
    EXECUTIVE: 'EXECUTIVE',
    ADMIN: 'ADMIN',
    SALES: 'SALES',
    SUPPORT: 'SUPPORT',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserRoleLabel: Record<UserRole, string> = {
    EXECUTIVE: '대표/임원',
    ADMIN: '관리자',
    SALES: '영업담당자',
    SUPPORT: '관리팀/영업지원',
};

// ============================================================
// Supplier type
// ============================================================
export const SupplierType = {
    HANWHA: 'HANWHA',
    DOMESTIC_OTHER: 'DOMESTIC_OTHER',
    IMPORT_DEALER: 'IMPORT_DEALER',
    INTERNAL_STOCK: 'INTERNAL_STOCK',
} as const;
export type SupplierType = (typeof SupplierType)[keyof typeof SupplierType];

export const SupplierTypeLabel: Record<SupplierType, string> = {
    HANWHA: '한화솔루션 (직오더)',
    DOMESTIC_OTHER: '타사 국산',
    IMPORT_DEALER: '수입 딜러',
    INTERNAL_STOCK: '내부 재고',
};

// ============================================================
// Order source
// ============================================================
export const OrderSource = {
    CUSTOMER_PORTAL: 'CUSTOMER_PORTAL',
    SALES_MANUAL: 'SALES_MANUAL',
    PHONE: 'PHONE',
    KAKAO: 'KAKAO',
    EMAIL: 'EMAIL',
    SPREADSHEET: 'SPREADSHEET',
    OTHER: 'OTHER',
} as const;
export type OrderSource = (typeof OrderSource)[keyof typeof OrderSource];

export const OrderSourceLabel: Record<OrderSource, string> = {
    CUSTOMER_PORTAL: '거래처 포털',
    SALES_MANUAL: '영업 직접입력',
    PHONE: '전화',
    KAKAO: '카카오톡',
    EMAIL: '이메일',
    SPREADSHEET: '오더시트',
    OTHER: '기타',
};

// ============================================================
// Order status (25 states)
// ============================================================
export const OrderStatus = {
    REQUESTED: 'REQUESTED',
    PENDING_SALES_REVIEW: 'PENDING_SALES_REVIEW',
    SALES_REVIEWING: 'SALES_REVIEWING',
    CREDIT_OVER_LIMIT: 'CREDIT_OVER_LIMIT',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    ON_HOLD: 'ON_HOLD',
    SUPPLIER_ORDER_REQUIRED: 'SUPPLIER_ORDER_REQUIRED',
    SUPPLIER_ORDER_COMPLETED: 'SUPPLIER_ORDER_COMPLETED',
    DISPATCH_WAITING: 'DISPATCH_WAITING',
    DISPATCHING: 'DISPATCHING',
    DISPATCH_COMPLETED: 'DISPATCH_COMPLETED',
    DISPATCH_FAILED: 'DISPATCH_FAILED',
    DISPATCH_RETRY_SCHEDULED: 'DISPATCH_RETRY_SCHEDULED',
    READY_TO_SHIP: 'READY_TO_SHIP',
    SHIPPING: 'SHIPPING',
    SHIPPED: 'SHIPPED',
    DELIVERY_CONFIRM_PENDING: 'DELIVERY_CONFIRM_PENDING',
    DELIVERY_CONFIRMED: 'DELIVERY_CONFIRMED',
    DELIVERY_DISPUTED: 'DELIVERY_DISPUTED',
    ERP_INPUT_WAITING: 'ERP_INPUT_WAITING',
    ERP_INPUT_COMPLETED: 'ERP_INPUT_COMPLETED',
    INVOICE_WAITING: 'INVOICE_WAITING',
    INVOICE_COMPLETED: 'INVOICE_COMPLETED',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const OrderStatusLabel: Record<OrderStatus, string> = {
    REQUESTED: '주문요청 접수',
    PENDING_SALES_REVIEW: '담당자 확인 대기',
    SALES_REVIEWING: '담당자 확인 중',
    CREDIT_OVER_LIMIT: '여신초과',
    APPROVED: '담당자 승인',
    REJECTED: '반려',
    ON_HOLD: '보류',
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
    COMPLETED: '최종 완료',
    CANCELLED: '취소',
};

/** UI badge color tokens (Tailwind) */
export const OrderStatusColor: Record<OrderStatus, string> = {
    REQUESTED: 'bg-blue-100 text-blue-800',
    PENDING_SALES_REVIEW: 'bg-amber-100 text-amber-800',
    SALES_REVIEWING: 'bg-amber-200 text-amber-900',
    CREDIT_OVER_LIMIT: 'bg-red-100 text-red-800',
    APPROVED: 'bg-green-100 text-green-800',
    REJECTED: 'bg-red-100 text-red-800',
    ON_HOLD: 'bg-orange-100 text-orange-800',
    SUPPLIER_ORDER_REQUIRED: 'bg-purple-100 text-purple-800',
    SUPPLIER_ORDER_COMPLETED: 'bg-purple-200 text-purple-900',
    DISPATCH_WAITING: 'bg-sky-100 text-sky-800',
    DISPATCHING: 'bg-sky-200 text-sky-900',
    DISPATCH_COMPLETED: 'bg-cyan-100 text-cyan-800',
    DISPATCH_FAILED: 'bg-red-200 text-red-900',
    DISPATCH_RETRY_SCHEDULED: 'bg-orange-200 text-orange-900',
    READY_TO_SHIP: 'bg-teal-100 text-teal-800',
    SHIPPING: 'bg-teal-200 text-teal-900',
    SHIPPED: 'bg-emerald-200 text-emerald-900',
    DELIVERY_CONFIRM_PENDING: 'bg-yellow-100 text-yellow-800',
    DELIVERY_CONFIRMED: 'bg-emerald-300 text-emerald-900',
    DELIVERY_DISPUTED: 'bg-red-300 text-red-900',
    ERP_INPUT_WAITING: 'bg-indigo-100 text-indigo-800',
    ERP_INPUT_COMPLETED: 'bg-indigo-200 text-indigo-900',
    INVOICE_WAITING: 'bg-violet-100 text-violet-800',
    INVOICE_COMPLETED: 'bg-violet-200 text-violet-900',
    COMPLETED: 'bg-slate-200 text-slate-900',
    CANCELLED: 'bg-gray-200 text-gray-700 line-through',
};

/** 단계 그룹 (대시보드 필터/타임라인 표시용) */
export const OrderStatusGroup = {
    INTAKE: 'INTAKE',
    REVIEW: 'REVIEW',
    SUPPLIER: 'SUPPLIER',
    DISPATCH: 'DISPATCH',
    SHIPMENT: 'SHIPMENT',
    RECEIPT: 'RECEIPT',
    ERP: 'ERP',
    INVOICE: 'INVOICE',
    TERMINAL: 'TERMINAL',
} as const;
export type OrderStatusGroup =
    (typeof OrderStatusGroup)[keyof typeof OrderStatusGroup];

export const OrderStatusToGroup: Record<OrderStatus, OrderStatusGroup> = {
    REQUESTED: 'INTAKE',
    PENDING_SALES_REVIEW: 'REVIEW',
    SALES_REVIEWING: 'REVIEW',
    CREDIT_OVER_LIMIT: 'REVIEW',
    APPROVED: 'REVIEW',
    REJECTED: 'TERMINAL',
    ON_HOLD: 'REVIEW',
    SUPPLIER_ORDER_REQUIRED: 'SUPPLIER',
    SUPPLIER_ORDER_COMPLETED: 'SUPPLIER',
    DISPATCH_WAITING: 'DISPATCH',
    DISPATCHING: 'DISPATCH',
    DISPATCH_COMPLETED: 'DISPATCH',
    DISPATCH_FAILED: 'DISPATCH',
    DISPATCH_RETRY_SCHEDULED: 'DISPATCH',
    READY_TO_SHIP: 'SHIPMENT',
    SHIPPING: 'SHIPMENT',
    SHIPPED: 'SHIPMENT',
    DELIVERY_CONFIRM_PENDING: 'RECEIPT',
    DELIVERY_CONFIRMED: 'RECEIPT',
    DELIVERY_DISPUTED: 'RECEIPT',
    ERP_INPUT_WAITING: 'ERP',
    ERP_INPUT_COMPLETED: 'ERP',
    INVOICE_WAITING: 'INVOICE',
    INVOICE_COMPLETED: 'INVOICE',
    COMPLETED: 'TERMINAL',
    CANCELLED: 'TERMINAL',
};

// ============================================================
// Price status
// ============================================================
export const PriceStatus = {
    CONFIRMED_PRICE: 'CONFIRMED_PRICE',
    EXPECTED_PRICE: 'EXPECTED_PRICE',
    MONTHLY_CLOSING_PENDING: 'MONTHLY_CLOSING_PENDING',
    NEGOTIATION_REQUIRED: 'NEGOTIATION_REQUIRED',
    UNKNOWN: 'UNKNOWN',
} as const;
export type PriceStatus = (typeof PriceStatus)[keyof typeof PriceStatus];

export const PriceStatusLabel: Record<PriceStatus, string> = {
    CONFIRMED_PRICE: '확정단가',
    EXPECTED_PRICE: '예상단가',
    MONTHLY_CLOSING_PENDING: '월마감 대기',
    NEGOTIATION_REQUIRED: '별도협의 필요',
    UNKNOWN: '단가미정',
};

// ============================================================
// Dispatch
// ============================================================
export const DispatchStatus = {
    NOT_REQUIRED: 'NOT_REQUIRED',
    WAITING: 'WAITING',
    DISPATCHING: 'DISPATCHING',
    DISPATCH_COMPLETED: 'DISPATCH_COMPLETED',
    DISPATCH_FAILED: 'DISPATCH_FAILED',
    RETRY_SCHEDULED: 'RETRY_SCHEDULED',
    CANCELLED: 'CANCELLED',
} as const;
export type DispatchStatus =
    (typeof DispatchStatus)[keyof typeof DispatchStatus];

export const DispatchStatusLabel: Record<DispatchStatus, string> = {
    NOT_REQUIRED: '배차 불필요',
    WAITING: '배차 대기',
    DISPATCHING: '배차 중',
    DISPATCH_COMPLETED: '배차 완료',
    DISPATCH_FAILED: '배차 실패',
    RETRY_SCHEDULED: '재시도 예정',
    CANCELLED: '취소',
};

export const DispatchFailureReasonOptions = [
    '차량 수배 실패',
    '기사 연락 불가',
    '상차지 문제',
    '납품지 시간 불가',
    '공급처 출고 지연',
    '고객 요청 일정 변경',
    '기타',
] as const;

// ============================================================
// Shipment
// ============================================================
export const ShipmentStatus = {
    NOT_READY: 'NOT_READY',
    READY_TO_SHIP: 'READY_TO_SHIP',
    SHIPPING: 'SHIPPING',
    SHIPPED: 'SHIPPED',
    DELIVERY_CONFIRMED: 'DELIVERY_CONFIRMED',
    DELIVERY_DISPUTED: 'DELIVERY_DISPUTED',
} as const;
export type ShipmentStatus =
    (typeof ShipmentStatus)[keyof typeof ShipmentStatus];

export const ShipmentStatusLabel: Record<ShipmentStatus, string> = {
    NOT_READY: '미준비',
    READY_TO_SHIP: '출고 준비',
    SHIPPING: '출고 중',
    SHIPPED: '출고 완료',
    DELIVERY_CONFIRMED: '수령 확인',
    DELIVERY_DISPUTED: '수령 이슈',
};

// ============================================================
// Receipt
// ============================================================
export const ReceiptStatus = {
    CUSTOMER_CONFIRMED: 'CUSTOMER_CONFIRMED',
    SALES_CONFIRMED: 'SALES_CONFIRMED',
    SUPPORT_CONFIRMED: 'SUPPORT_CONFIRMED',
    AUTO_ASSUMED: 'AUTO_ASSUMED',
    DISPUTED: 'DISPUTED',
} as const;
export type ReceiptStatus = (typeof ReceiptStatus)[keyof typeof ReceiptStatus];

export const ReceiptStatusLabel: Record<ReceiptStatus, string> = {
    CUSTOMER_CONFIRMED: '거래처 직접 확인',
    SALES_CONFIRMED: '영업담당 확인',
    SUPPORT_CONFIRMED: '관리팀 확인',
    AUTO_ASSUMED: '자동 수령 간주',
    DISPUTED: '수령 이슈 제기',
};

// ============================================================
// ERP batch
// ============================================================
export const ErpBatchStatus = {
    GENERATED: 'GENERATED',
    UNDER_REVIEW: 'UNDER_REVIEW',
    APPROVED: 'APPROVED',
    RUNNING: 'RUNNING',
    COMPLETED: 'COMPLETED',
    PARTIALLY_FAILED: 'PARTIALLY_FAILED',
    FAILED: 'FAILED',
} as const;
export type ErpBatchStatus =
    (typeof ErpBatchStatus)[keyof typeof ErpBatchStatus];

export const ErpBatchStatusLabel: Record<ErpBatchStatus, string> = {
    GENERATED: '후보 생성됨',
    UNDER_REVIEW: '검토 중',
    APPROVED: '승인됨',
    RUNNING: '실행 중',
    COMPLETED: '완료',
    PARTIALLY_FAILED: '일부 실패',
    FAILED: '실패',
};

export const ErpItemStatus = {
    NOT_STARTED: 'NOT_STARTED',
    RUNNING: 'RUNNING',
    SUCCESS: 'SUCCESS',
    FAILED: 'FAILED',
    SKIPPED: 'SKIPPED',
    MANUAL_REQUIRED: 'MANUAL_REQUIRED',
} as const;
export type ErpItemStatus = (typeof ErpItemStatus)[keyof typeof ErpItemStatus];

export const ErpItemStatusLabel: Record<ErpItemStatus, string> = {
    NOT_STARTED: '대기',
    RUNNING: '실행 중',
    SUCCESS: '성공',
    FAILED: '실패',
    SKIPPED: '제외',
    MANUAL_REQUIRED: '수동 처리 필요',
};

export const ErpExclusionReasonOptions = [
    '단가 미확정',
    '거래처 코드 미매칭',
    '품목 코드 미매칭',
    '실제 출고 수량 미확인',
    '배차 실패로 출고 미완료',
    '출고 취소',
    '수량 차이 확인 필요',
    '관리자 보류',
] as const;

// ============================================================
// Notification
// ============================================================
export const NotificationChannel = {
    EMAIL: 'EMAIL',
    SMS: 'SMS',
    KAKAO_ALIMTALK: 'KAKAO_ALIMTALK',
    INTERNAL_WEB: 'INTERNAL_WEB',
    SLACK: 'SLACK',
    TELEGRAM: 'TELEGRAM',
    MANUAL: 'MANUAL',
} as const;
export type NotificationChannel =
    (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationChannelLabel: Record<NotificationChannel, string> = {
    EMAIL: '이메일',
    SMS: '문자',
    KAKAO_ALIMTALK: '카카오 알림톡',
    INTERNAL_WEB: '내부 웹 알림',
    SLACK: 'Slack',
    TELEGRAM: '텔레그램',
    MANUAL: '수동 안내',
};

/** 비용 구분 (UI에서 유료 채널 선택 시 경고 표시) */
export const NotificationChannelIsPaid: Record<NotificationChannel, boolean> = {
    EMAIL: false,
    SMS: true,
    KAKAO_ALIMTALK: true,
    INTERNAL_WEB: false,
    SLACK: false,
    TELEGRAM: false,
    MANUAL: false,
};

// ============================================================
// Reasons / option lists
// ============================================================
export const RejectReasonOptions = [
    '재고 부족',
    '공급처 주문 불가',
    '단종/취급 불가',
    '여신한도 초과',
    '미수금 확인 필요',
    '최소 주문수량 미달',
    '단가 조건 불일치',
    '납기 불가',
    '기타',
] as const;

export const HoldReasonOptions = [
    '공급처 단가 확인 필요',
    '공급처 재고 확인 필요',
    '고객 최종 확인 대기',
    '여신/미수금 확인 필요',
    '납기 조율 필요',
    '운송 조건 확인 필요',
    '대체품 검토 필요',
    '월마감 단가 대기',
    '대표 승인 필요',
    '기타',
] as const;
