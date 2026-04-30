/**
 * 거래처 / 내부 알림 메시지 템플릿
 *
 * §7 (승인/반려/보류), §8 (배차), §10 (미처리 단계 알림) 기반.
 * 모든 메시지는 한국어, 거래처에게는 차갑지 않게 작성.
 */

export interface OrderContext {
    orderNo: string;
    customerName: string;
    productName: string;
    requestedQuantity?: string; // 단위 포함 예: "10톤"
    approvedQuantity?: string;
    confirmedDeliveryDate?: string;
    plannedShipDate?: string;
}

// ============================================================
// 거래처 알림 (Customer-facing)
// ============================================================

export const customerTemplates = {
    ORDER_REQUESTED: (ctx: OrderContext) => ({
        title: `[한양유화] 주문요청이 접수되었습니다 (${ctx.orderNo})`,
        message: `안녕하세요, ${ctx.customerName} 담당자님.

주문요청이 정상적으로 접수되었습니다.

- 품목: ${ctx.productName}
- 요청 수량: ${ctx.requestedQuantity ?? '-'}
- 진행 상태: 담당자 확인 대기

담당자 확인 후 진행 상황을 다시 안내드리겠습니다.

감사합니다.`,
    }),

    ORDER_APPROVED: (ctx: OrderContext) => ({
        title: `[한양유화] 주문이 확인되었습니다 (${ctx.orderNo})`,
        message: `안녕하세요, ${ctx.customerName} 담당자님.

주문요청이 담당자에 의해 확인되었습니다.

- 품목: ${ctx.productName}
- 승인 수량: ${ctx.approvedQuantity ?? '-'}
- 예상 출고일: ${ctx.confirmedDeliveryDate ?? '담당자 협의'}
- 진행 상태: 담당자 확인 완료

최종 단가 및 출고 조건은 담당자 확인 후 별도 안내됩니다.

감사합니다.`,
    }),

    ORDER_REJECTED: (
        ctx: OrderContext & { rejectReason: string }
    ) => ({
        title: `[한양유화] 주문 진행 안내 (${ctx.orderNo})`,
        message: `안녕하세요, ${ctx.customerName} 담당자님.

요청하신 주문은 현재 즉시 진행이 어렵습니다.

- 품목: ${ctx.productName}
- 요청 수량: ${ctx.requestedQuantity ?? '-'}
- 사유: ${ctx.rejectReason}

담당자가 대체 가능 품목 또는 가능 일정을 별도로 안내드리겠습니다.
불편을 드려 죄송합니다.`,
    }),

    ORDER_HOLD: (
        ctx: OrderContext & { holdReason: string; remindAt: string }
    ) => ({
        title: `[한양유화] 주문 진행 확인 중 (${ctx.orderNo})`,
        message: `안녕하세요, ${ctx.customerName} 담당자님.

주문요청 건은 현재 추가 확인 중입니다.

- 품목: ${ctx.productName}
- 요청 수량: ${ctx.requestedQuantity ?? '-'}
- 보류 사유: ${ctx.holdReason}
- 다음 안내 예정: ${ctx.remindAt}

확인되는 즉시 담당자가 안내드리겠습니다.`,
    }),

    DISPATCH_FAILED: (
        ctx: OrderContext & { plannedShipDate: string; nextRetryDate: string }
    ) => ({
        title: `[한양유화] 출고 일정 조정 안내 (${ctx.orderNo})`,
        message: `안녕하세요, ${ctx.customerName} 담당자님.

주문 건의 배차가 지연되어 출고 일정 재확인이 필요합니다.

- 품목: ${ctx.productName}
- 수량: ${ctx.approvedQuantity ?? '-'}
- 기존 예정일: ${ctx.plannedShipDate}
- 현재 상태: 배차 재시도 예정
- 다음 안내 예정: ${ctx.nextRetryDate}

담당자가 확인 후 다시 안내드리겠습니다. 양해 부탁드립니다.`,
    }),

    DISPATCH_COMPLETED: (
        ctx: OrderContext & {
            plannedShipDate: string;
            vehicleNumber?: string;
            driverPhone?: string;
            shareWithCustomer: boolean;
        }
    ) => ({
        title: `[한양유화] 배차 완료 안내 (${ctx.orderNo})`,
        message: `안녕하세요, ${ctx.customerName} 담당자님.

주문 건의 배차가 완료되었습니다.

- 품목: ${ctx.productName}
- 수량: ${ctx.approvedQuantity ?? '-'}
- 예상 출고일: ${ctx.plannedShipDate}${ctx.shareWithCustomer && ctx.vehicleNumber
                ? `\n- 차량 정보: ${ctx.vehicleNumber}`
                : ''
            }${ctx.shareWithCustomer && ctx.driverPhone
                ? `\n- 기사 연락처: ${ctx.driverPhone}`
                : ''
            }

감사합니다.`,
    }),

    SHIPPED: (
        ctx: OrderContext & { actualShipDate: string }
    ) => ({
        title: `[한양유화] 출고 완료 안내 (${ctx.orderNo})`,
        message: `안녕하세요, ${ctx.customerName} 담당자님.

주문 건이 출고 완료되었습니다.

- 품목: ${ctx.productName}
- 출고 수량: ${ctx.approvedQuantity ?? '-'}
- 출고일: ${ctx.actualShipDate}

도착 후 수량 및 상태 확인 부탁드립니다.
감사합니다.`,
    }),
} as const;

// ============================================================
// 내부 알림 (Employee-facing)
// ============================================================

export const internalTemplates = {
    PENDING_REVIEW_10MIN: (ctx: OrderContext) => ({
        title: `[미확인 10분] ${ctx.orderNo} ${ctx.customerName}`,
        message: `주문 ${ctx.orderNo} (${ctx.customerName} / ${ctx.productName}) 가 10분간 확인되지 않았습니다. 즉시 확인 부탁드립니다.`,
    }),

    PENDING_REVIEW_30MIN: (ctx: OrderContext) => ({
        title: `[미확인 30분 - 관리팀 공유] ${ctx.orderNo}`,
        message: `주문 ${ctx.orderNo} (${ctx.customerName} / ${ctx.productName}) 30분간 미처리 상태입니다. 담당자 확인이 필요합니다.`,
    }),

    PENDING_REVIEW_60MIN: (ctx: OrderContext) => ({
        title: `[미확인 1시간 - 영업총괄] ${ctx.orderNo}`,
        message: `주문 ${ctx.orderNo} 1시간 미처리. 영업총괄 확인이 필요합니다.`,
    }),

    PENDING_REVIEW_120MIN: (ctx: OrderContext) => ({
        title: `[미확인 2시간 - 임원 포함] ${ctx.orderNo}`,
        message: `주문 ${ctx.orderNo} 2시간 미처리. 임원 검토 필요.`,
    }),

    HOLD_REMINDER_DUE: (
        ctx: OrderContext & { holdReason: string }
    ) => ({
        title: `[보류 재확인 시각 도달] ${ctx.orderNo}`,
        message: `주문 ${ctx.orderNo} (${ctx.customerName}) 보류 재확인 시각이 도달했습니다.\n사유: ${ctx.holdReason}\n진행 상황을 확인해 주세요.`,
    }),

    ERP_BATCH_GENERATED: (ctx: { batchDate: string; itemCount: number }) => ({
        title: `[ERP 입력 후보 생성됨] ${ctx.batchDate}`,
        message: `${ctx.batchDate} 자 ERP 입력 후보 ${ctx.itemCount}건이 생성되었습니다. 관리팀 검토 후 승인해 주세요.`,
    }),

    ERP_BATCH_FAILED_ITEMS: (ctx: {
        batchDate: string;
        failedCount: number;
    }) => ({
        title: `[ERP 입력 실패 발생] ${ctx.batchDate}`,
        message: `${ctx.batchDate} 자 ERP 입력 중 ${ctx.failedCount}건 실패. 수동 처리가 필요합니다.`,
    }),

    SHIPMENT_QUANTITY_DISCREPANCY: (
        ctx: OrderContext & { plannedQty: string; actualQty: string }
    ) => ({
        title: `[출고 수량 차이 발생] ${ctx.orderNo}`,
        message: `주문 ${ctx.orderNo} (${ctx.customerName})\n예정 수량: ${ctx.plannedQty}\n실제 출고: ${ctx.actualQty}\n사유 입력 및 ERP 입력 전 검토 필요.`,
    }),

    CREDIT_LIMIT_EXCEEDED: (
        ctx: OrderContext & { creditUsageRate: string }
    ) => ({
        title: `[여신한도 초과 예상] ${ctx.customerName}`,
        message: `주문 ${ctx.orderNo} 승인 시 여신 사용률이 ${ctx.creditUsageRate}로 예상됩니다. 대표 승인이 필요합니다.`,
    }),
} as const;
