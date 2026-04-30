# 03. Data Model — 17개 엔티티 ER 설계

코드: [`prisma/schema.prisma`](../prisma/schema.prisma)

## ER 다이어그램 (논리)

```
[User]                         [Supplier]
   │ defaultRep                    │
   ▼                               ▼
[Customer] ─┬─ [DeliveryAddress] (1:N)
            ├─ [CustomerProductWhitelist] ─→ [Product] (M:N via this)
            ├─ [CustomerUser] (1:N)            │
            └─ [Order] (1:N)                   │
                  │                            │
                  ├─ [OrderItem] ──────────────┘
                  ├─ [OrderStatusHistory]
                  ├─ [HoldReminder]
                  ├─ [Dispatch]
                  ├─ [Shipment]
                  ├─ [DeliveryReceipt]
                  ├─ [ErpInputItem] ─→ [ErpInputBatch] (N:1)
                  └─ [NotificationLog]
```

## 엔티티 요약

| #   | 엔티티                     | 역할                                      |
| --- | -------------------------- | ----------------------------------------- |
| 1   | `User`                     | 내부 직원 (영업/관리/임원)                |
| 2   | `Customer`                 | 거래처 마스터 (여신·미수금 포함)          |
| 3   | `DeliveryAddress`          | 거래처별 도착지 (1:N, 본사 외 다중)       |
| 4   | `Product`                  | 제품 마스터 (이카운트/클릭2002 코드 매핑) |
| 5   | `CustomerProductWhitelist` | 거래처별 주문 가능 제품 (포털 노출 제어)  |
| 6   | `Supplier`                 | 공급처 (한화/타사국산/수입딜러/내부재고)  |
| 7   | `CustomerUser`             | 거래처 포털 로그인 계정 (2차 MVP)         |
| 8   | `Order`                    | 주문 마스터                               |
| 9   | `OrderItem`                | 주문 상세 (품목별 수량/단가)              |
| 10  | `OrderStatusHistory`       | 모든 상태 변경 이력 (필수)                |
| 11  | `HoldReminder`             | 보류 재알림                               |
| 12  | `Dispatch`                 | 배차 정보 (실패/재시도 포함)              |
| 13  | `Shipment`                 | 출고 정보 (수량 차이 포함)                |
| 14  | `DeliveryReceipt`          | 수령 확인 (5가지 방식, optional)          |
| 15  | `ErpInputBatch`            | 17:00 마감 배치                           |
| 16  | `ErpInputItem`             | ERP 입력 개별 건 (이카운트+클릭2002)      |
| 17  | `NotificationLog`          | 모든 알림 발송 로그 (성공/실패)           |

## 핵심 설계 결정

### A. DeliveryAddress 별도 분리
요구사항: "한 거래처에 여러 도착지 존재 가능, 도착지만 입력하면 거래처 자동 매칭."
→ `Order.deliveryAddressId` 필수, `DeliveryAddress.addressLine1`에 인덱스. 영업/관리자 화면에서 도착지 자동완성 → 선택 시 `customerId` 자동 채움.

### B. CustomerProductWhitelist
요구사항: "거래처는 기존에 나갔던 품목만 보이게, 신규 품목은 선택 불가 → 주문 실수 방지."
→ 별도 조인 테이블. 출고 완료(`SHIPPED`) 시 자동으로 (customerId, productId) 레코드 INSERT/UPDATE (`firstOrderedAt`, `lastOrderedAt`, `totalOrderCount`). 영업이 수동으로 추가/숨김 가능.
→ 거래처 포털: `WHERE customerId = me AND isVisibleInPortal = true`만 노출.
→ 영업/관리자: 전체 `Product`에서 검색 가능.

### C. 직원 vs 거래처 사용자 분리
- `User` — 내부 직원 (NextAuth credentials 또는 SSO)
- `CustomerUser` — 거래처 (별도 테이블, 별도 로그인 화면)
- `Order.requestedByUserId` (직원이 대신 등록) vs `Order.requestedByCustomerUserId` (거래처가 직접 등록) 둘 중 하나만 채워짐.

### D. 단가 미확정 (`PriceStatus`)
주문 단계에서 단가가 미정인 경우가 흔함. `Order.priceStatus` + `OrderItem.priceStatus` 둘 다에 두어 라인별로도 다른 상태 가능.

### E. Decimal 정밀도
수량(KG/TON)은 `@db.Decimal(18, 3)` (소수 3자리), 금액은 `@db.Decimal(18, 2)`.

### F. `rawOrderText` 필드
요구사항 §14: "주문 내용 붙여넣기 AI 정리 향후 기능."
→ `Order.rawOrderText`에 원문 보존. 1차 MVP에선 단순 텍스트 영역, 2차에서 OpenAI/Claude 호출로 구조화.

### G. NotificationLog의 다채널 지원
모든 채널(이메일/SMS/카톡/내부웹/텔레그램/Slack)을 enum으로 미리 정의. MVP는 INTERNAL_WEB + EMAIL + TELEGRAM만 실제 발송, 나머지는 PENDING/SKIPPED로 기록만.

### H. ErpInputItem이 Order에 1:N
하나의 Order가 여러 영업일에 걸쳐 분할 출고/입력될 수 있으므로 `(orderId, batchId)` 복수 레코드 가능.

## 시드 데이터 계획 (`prisma/seed.ts` — TODO)

- `User` 4명: 대표 1, 관리팀 1, 영업 2
- `Customer` 5곳 (각각 도착지 1~3개)
- `Supplier`: 한화 1, 도매 1, 수입 4 (SGCG/QAPCO/Reliance/Formosa)
- `Product`: EVA 2, HDPE 5, LDPE 3, LLDPE 2, mLLDPE 2 (각각 한화/수입 다양)
- `CustomerProductWhitelist`: 시드 시점에 임의 매핑
- `CustomerUser` 2명 (2차 MVP 테스트용)
- `Order` 20건: 단계별로 골고루 분포 (REQUESTED 3, ON_HOLD 2, DISPATCH_FAILED 1, SHIPPED 5, ERP_INPUT_WAITING 4, COMPLETED 5)
- 각 Order에 대응하는 `OrderStatusHistory`, `Dispatch`, `Shipment` 등

## 인덱스 전략

| 테이블             | 인덱스 컬럼                                                      | 용도                              |
| ------------------ | ---------------------------------------------------------------- | --------------------------------- |
| Customer           | companyName                                                      | 영업/관리자 검색                  |
| DeliveryAddress    | customerId, addressLine1                                         | 거래처별 / 주소 자동완성          |
| Order              | customerId, status, salesRepId, createdAt, requestedDeliveryDate | 목록 필터                         |
| OrderStatusHistory | orderId, createdAt                                               | 상세 타임라인                     |
| HoldReminder       | remindAt, isCompleted                                            | 스케줄러 폴링                     |
| Dispatch           | dispatchStatus, nextRetryDate                                    | 배차 실패 모니터링                |
| Shipment           | shipmentStatus, actualShipDate                                   | 일별 출고 집계 (ERP 배치 생성 시) |
| ErpInputBatch      | batchDate, batchStatus                                           | 일별 조회                         |
| ErpInputItem       | batchId, ecountStatus, click2002Status                           | 실패 건 필터                      |
| NotificationLog    | orderId, sendStatus, channel, createdAt                          | 알림 로그 뷰어                    |
