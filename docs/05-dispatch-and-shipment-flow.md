# 05. Dispatch & Shipment Flow — 배차/출고/수령 확인

## 1. 승인 후 → 배차 진입 분기

| 케이스                                   | 분기                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| 한화 직오더 또는 내부 재고 보유          | `APPROVED` → `DISPATCH_WAITING`                                                          |
| 타사 국산 / 수입 원료 (공급처 주문 필요) | `APPROVED` → `SUPPLIER_ORDER_REQUIRED` → `SUPPLIER_ORDER_COMPLETED` → `DISPATCH_WAITING` |

분기 결정은 승인 모달에서 영업이 `Order.supplierType` 선택 시 결정. `INTERNAL_STOCK` 또는 `HANWHA` (정책상 직오더로 처리되는 경우) 면 공급처 주문 단계 건너뜀.

## 2. 배차 상태 머신

```
DISPATCH_WAITING
    │ (배차 시도 시작)
    ▼
DISPATCHING ── 성공 ──▶ DISPATCH_COMPLETED ──▶ READY_TO_SHIP
    │
    │ 실패 (failure_reason + next_retry_date 필수)
    ▼
DISPATCH_FAILED
    │
    ▼
DISPATCH_RETRY_SCHEDULED ──▶ DISPATCHING (재시도)
```

`Dispatch.dispatchAttemptCount` 매 시도마다 +1. 3회 이상 실패 시 대시보드 카드에 빨강 강조.

### 배차 실패 시 필수 입력
- `failureReason` — 7가지 옵션 중 선택 (또는 기타)
- `nextRetryDate` — 다음 시도 날짜/시간
- `memo` — 담당자 메모
- 거래처 알림 발송 여부 결정 (`Order.customerNoticeRequired` 토글)

### 배차 실패 사유 옵션
1. 차량 수배 실패
2. 기사 연락 불가
3. 상차지 문제
4. 납품지 시간 불가
5. 공급처 출고 지연
6. 고객 요청 일정 변경
7. 기타

### 거래처 알림 (배차 실패)
템플릿: `DISPATCH_FAILED` ([04-notification-rules.md](./04-notification-rules.md) §3)

### 거래처 알림 (배차 완료)
템플릿: `DISPATCH_COMPLETED`. 차량번호/기사 연락처는 `Dispatch.shareWithCustomer = true` 일 때만 포함.

## 3. 출고 처리

```
DISPATCH_COMPLETED → READY_TO_SHIP → SHIPPING → SHIPPED
```

### 출고 완료 처리 시 필수 입력 (`Shipment` 레코드 업데이트)
- `plannedQuantity` — 출고 예정 수량 (Order.approvedQuantity 자동 채움)
- `shippedQuantity` — **실제 출고 수량** (수동 입력)
- `actualShipDate` — 출고일
- `shipmentMemo` — 메모

### 수량 차이 처리
시스템이 자동 비교하여 `hasQuantityDiscrepancy = (plannedQuantity !== shippedQuantity)`.

차이가 있으면:
- `quantityDifferenceReason` **필수 입력** (저장 차단)
- 대시보드 "출고 수량 차이 발생" 카드에 노출
- 관리자 검토 후 ERP 입력 단계로 진행
- 내부 알림 (`SHIPMENT_QUANTITY_DISCREPANCY`)

출고 완료 후 수량 변경 가능하지만 반드시 `OrderStatusHistory`에 변경 전/후/사유/변경자/일시 기록.

## 4. 수령 확인 (Optional)

요구사항 §9: "거래처가 수령 버튼을 잘 누르지 않을 가능성이 있으므로 시스템상 필수 프로세스로 만들지 않는다."

### 5가지 수령 확인 방식
| 코드                 | 의미                               | 사용 시점                    |
| -------------------- | ---------------------------------- | ---------------------------- |
| `CUSTOMER_CONFIRMED` | 거래처가 직접 확인 버튼 클릭       | 2차 MVP, 거래처 포털에서     |
| `SALES_CONFIRMED`    | 영업담당자가 거래처 확인 후 처리   | MVP 기본                     |
| `SUPPORT_CONFIRMED`  | 관리팀이 확인 후 처리              | MVP 기본                     |
| `AUTO_ASSUMED`       | 출고 후 N영업일 무이슈 → 자동 간주 | 2차 MVP, 대표 승인 후 활성화 |
| `DISPUTED`           | 수량/품질 이슈 제기                | 어느 단계에서든 가능         |

### MVP 동작
- `SHIPPED` 처리 시 자동으로 `Order.status = DELIVERY_CONFIRM_PENDING` 으로 진행 (또는 SHIPPED → ERP_INPUT_WAITING 직행 옵션)
- 영업/관리팀이 "수령 확인 처리" 버튼 클릭 시 `DeliveryReceipt` INSERT + `Order.status = DELIVERY_CONFIRMED`
- 거래처 수령 버튼 UI는 2차 MVP

### 자동 수령 간주 정책 (2차 MVP)
- 환경변수 `ENABLE_AUTO_RECEIPT_ASSUMPTION=true` + `AUTO_RECEIPT_ASSUMPTION_DAYS=2`
- cron이 `actualShipDate + N영업일 < now()` AND `status = DELIVERY_CONFIRM_PENDING` AND `disputed 없음` 인 주문을 `AUTO_ASSUMED`로 변경
- **운영 전 대표 승인 필수** (요구사항 §9 명시)

### 거래처 수령 버튼 (2차 MVP UI 안)
거래처 포털 주문 상세 화면에 단순한 버튼 2개:
- `[정상 수령했습니다]` → `CUSTOMER_CONFIRMED`
- `[수량/납품 문제가 있습니다]` → 사유 입력 모달 → `DISPUTED`

## 5. 출고 후 → ERP 입력 대기

수령 확인 여부와 무관하게 다음 영업일 17:00 ERP 배치에 포함되도록:

```
SHIPPED  →  ERP_INPUT_WAITING  (자동, cron으로 매일 17:00)
```

수령 이슈(`DELIVERY_DISPUTED`) 발생 시는 ERP 입력 보류, 관리자 해결 후 재진입.

## 6. 화면 매핑

| 화면             | 경로               | 주요 액션                                                           |
| ---------------- | ------------------ | ------------------------------------------------------------------- |
| 배차 관리 보드   | `/admin/dispatch`  | 상태별 칸반(WAITING/DISPATCHING/FAILED/COMPLETED), 카드 클릭 → 모달 |
| 배차 상세 모달   | (모달)             | 차량/기사 입력, 실패 시 사유+재시도일 입력                          |
| 출고 완료 처리   | `/admin/shipments` | 미출고 목록 → 실제 수량 입력 → 차이 감지 시 사유 강제               |
| 수령 확인 (내부) | 주문 상세 → 패널   | 영업/관리팀이 직접 처리                                             |
