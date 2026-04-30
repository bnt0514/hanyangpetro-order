# 02. Order Status Flow — 주문 상태 및 전환 규칙

본 문서는 주문 라이프사이클의 25개 상태값과 전환 매트릭스를 정의한다. 코드는 `src/shared/state-machine.ts`에서 강제한다.

## 1. 25개 상태값

| 코드                       | 한글             | 단계     | 설명                                          |
| -------------------------- | ---------------- | -------- | --------------------------------------------- |
| `REQUESTED`                | 주문요청 접수    | INTAKE   | 거래처/영업이 주문을 등록한 직후              |
| `PENDING_SALES_REVIEW`     | 담당자 확인 대기 | REVIEW   | 담당자에게 알림 발송, 미응답 시 단계별 재알림 |
| `SALES_REVIEWING`          | 담당자 확인 중   | REVIEW   | 담당자가 검토 시작 (옵션)                     |
| `APPROVED`                 | 담당자 승인      | REVIEW   | 승인 완료, 다음 단계로                        |
| `REJECTED`                 | 반려             | TERMINAL | 사유와 거래처 안내 문구 필수                  |
| `ON_HOLD`                  | 보류             | REVIEW   | 다음 확인 예정일시 필수                       |
| `SUPPLIER_ORDER_REQUIRED`  | 공급처 주문 필요 | SUPPLIER | 한화/타사/수입 공급처에 주문 필요             |
| `SUPPLIER_ORDER_COMPLETED` | 공급처 주문 완료 | SUPPLIER | 공급처 측 주문 처리 완료                      |
| `DISPATCH_WAITING`         | 배차 대기        | DISPATCH | 배차 작업 대기                                |
| `DISPATCHING`              | 배차 중          | DISPATCH | 차량/기사 수배 진행                           |
| `DISPATCH_COMPLETED`       | 배차 완료        | DISPATCH | 차량 확정, 거래처 알림                        |
| `DISPATCH_FAILED`          | 배차 실패        | DISPATCH | 사유와 다음 재시도일 필수                     |
| `DISPATCH_RETRY_SCHEDULED` | 배차 재시도 예정 | DISPATCH | 다음 시도 예약됨                              |
| `READY_TO_SHIP`            | 출고 준비 완료   | SHIPMENT | 출고 직전                                     |
| `SHIPPING`                 | 출고 진행 중     | SHIPMENT | 차량 출발/이동 중                             |
| `SHIPPED`                  | 출고 완료        | SHIPMENT | 출고 완료, 실제 수량 입력                     |
| `DELIVERY_CONFIRM_PENDING` | 수령 확인 대기   | RECEIPT  | 거래처/내부 확인 대기                         |
| `DELIVERY_CONFIRMED`       | 수령 확인 완료   | RECEIPT  | 정상 수령 확인                                |
| `DELIVERY_DISPUTED`        | 수령 이슈 발생   | RECEIPT  | 수량/품질 분쟁                                |
| `ERP_INPUT_WAITING`        | ERP 입력 대기    | ERP      | 17:00 배치 대상                               |
| `ERP_INPUT_COMPLETED`      | ERP 입력 완료    | ERP      | 이카운트+클릭2002 모두 성공                   |
| `INVOICE_WAITING`          | 계산서/마감 대기 | INVOICE  | 월말/익월 마감 대기                           |
| `INVOICE_COMPLETED`        | 계산서 완료      | INVOICE  | 발행 완료                                     |
| `COMPLETED`                | 최종 완료        | TERMINAL | 거래 종결                                     |
| `CANCELLED`                | 취소             | TERMINAL | 어느 단계에서든 취소 가능                     |

## 2. 기본 흐름

```
REQUESTED
  → PENDING_SALES_REVIEW
  → SALES_REVIEWING  (옵션, 직접 APPROVED 가능)
  → APPROVED  /  REJECTED  /  ON_HOLD

[공급처 주문 필요 시]
APPROVED
  → SUPPLIER_ORDER_REQUIRED
  → SUPPLIER_ORDER_COMPLETED
  → DISPATCH_WAITING

[공급처 주문 불필요 시 — 내부 재고 또는 한화 직오더]
APPROVED
  → DISPATCH_WAITING

DISPATCH_WAITING
  → DISPATCHING
  → DISPATCH_COMPLETED  (성공)
  → READY_TO_SHIP
  → SHIPPING
  → SHIPPED
  → DELIVERY_CONFIRM_PENDING
  → DELIVERY_CONFIRMED  (또는 내부 확인)
  → ERP_INPUT_WAITING
  → ERP_INPUT_COMPLETED
  → INVOICE_WAITING
  → INVOICE_COMPLETED
  → COMPLETED
```

## 3. 배차 실패 흐름

```
DISPATCHING
  → DISPATCH_FAILED  (failure_reason + next_retry_date 필수)
  → DISPATCH_RETRY_SCHEDULED
  → DISPATCHING  (재시도)
  → DISPATCH_COMPLETED 또는 DISPATCH_FAILED
```

배차 실패 시 거래처 알림은 자동 발송되지 않을 수도 있고(설정), 발송 시 차량/기사 정보 노출 여부도 토글 가능. (`Dispatch.shareWithCustomer`)

## 4. 출고 후 수량 차이 흐름

```
SHIPPED  (planned vs actual 수량 차이)
  ├─ 차이 없음 → DELIVERY_CONFIRM_PENDING
  ├─ 차이 있음 → quantity_difference_reason 필수 입력
  │             → 관리자 확인 후 ERP_INPUT_WAITING
  └─ 거래처 이슈 제기 → DELIVERY_DISPUTED
```

수량 변경(SHIPPED 이후)은 가능하되 반드시 `OrderStatusHistory`에 변경 전/후 수량, 사유, 변경자, 일시 기록 필수.

## 5. 보류 흐름

```
PENDING_SALES_REVIEW (또는 SALES_REVIEWING)
  → ON_HOLD  (HoldReminder 자동 생성, remind_at 필수)
  → SALES_REVIEWING / APPROVED / REJECTED / CANCELLED
```

보류 시 `remind_at` 도달하면:
- 책임 담당자에게 내부 알림 발송 (`HOLD_REMINDER_DUE`)
- `HoldReminder.isCompleted = false` 인 채로 24시간 경과 시 관리팀 에스컬레이션

## 6. 전환 매트릭스 (요약)

상세는 코드의 `ORDER_STATUS_TRANSITIONS` 참조. 주요 원칙:

1. **무제한 전환 금지** — 각 상태마다 허용된 다음 상태 화이트리스트가 있다.
2. **CANCELLED는 거의 모든 단계에서 가능** — 단, `COMPLETED`와 `REJECTED`에서는 불가.
3. **REJECTED는 종결** — 재오픈은 새 주문으로.
4. **TERMINAL 상태 (`COMPLETED`, `CANCELLED`, `REJECTED`)에서는 다음 상태 없음.**
5. **ON_HOLD는 검토 단계 어디서든 진입 가능, 해제 시 SALES_REVIEWING으로 복귀.**

## 7. 상태 변경 시 필수 부수 작업

모든 상태 변경(서비스 함수 1개로 트랜잭션 처리):

1. `Order.status` 업데이트
2. `OrderStatusHistory` 1건 INSERT (previous, new, changedBy, reason, internal/customer message)
3. 필요 시 `HoldReminder`, `Dispatch`, `Shipment`, `DeliveryReceipt` 부수 레코드 INSERT/UPDATE
4. 거래처 알림 필요 여부 판정 (`shouldNotifyCustomer(newStatus)`) → `NotificationLog` INSERT
5. 내부 알림 필요 시 `NotificationLog` INSERT

→ §12 크로스체크 3원칙 (DB 상태 + 내부 기록 + 거래처 알림 로그) 자동 충족.
