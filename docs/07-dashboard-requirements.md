# 07. Dashboard Requirements — 대표/관리자 대시보드

## 1. 원칙

대표/관리자 첫 화면은 **복잡한 상세표보다 핵심 경고와 숫자**. 카드 클릭 시 해당 주문 목록으로 드릴다운.

## 2. 14개 핵심 카드

| #   | 카드                 | 계산                                                                           | 클릭 시 이동                             |
| --- | -------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| 1   | 오늘 신규 주문 수    | `Order.createdAt >= 오늘00시`                                                  | `/admin/orders?createdToday=true`        |
| 2   | 미확인 주문 수       | `status IN (REQUESTED, PENDING_SALES_REVIEW)`                                  | `/admin/orders?status=PENDING`           |
| 3   | 보류 주문 수         | `status = ON_HOLD`                                                             | `/admin/orders?status=ON_HOLD`           |
| 4   | 보류 재확인 지연     | `HoldReminder WHERE remindAt < now() AND isCompleted=false`                    | `/admin/orders?holdOverdue=true`         |
| 5   | 배차 중 건수         | `Dispatch.dispatchStatus IN (WAITING, DISPATCHING)`                            | `/admin/dispatch?status=ACTIVE`          |
| 6   | 배차 실패 건수       | `Dispatch.dispatchStatus = DISPATCH_FAILED`                                    | `/admin/dispatch?status=FAILED`          |
| 7   | 배차 재시도 예정     | `Dispatch.dispatchStatus = RETRY_SCHEDULED AND nextRetryDate <= 내일`          | `/admin/dispatch?retryDue=true`          |
| 8   | 오늘 출고 완료 건수  | `Shipment.actualShipDate >= 오늘00시 AND shipmentStatus = SHIPPED`             | `/admin/shipments?shippedToday=true`     |
| 9   | 출고 수량 차이 발생  | `Shipment.hasQuantityDiscrepancy = true AND createdAt >= 오늘`                 | `/admin/shipments?discrepancy=true`      |
| 10  | ERP 입력 대기        | `Order.status = ERP_INPUT_WAITING`                                             | `/admin/erp?status=WAITING`              |
| 11  | ERP 입력 완료 (오늘) | `Order.status = ERP_INPUT_COMPLETED AND updatedAt >= 오늘`                     | `/admin/erp?status=COMPLETED&date=today` |
| 12  | ERP 입력 실패        | `ErpInputItem WHERE ecountStatus = FAILED OR click2002Status = FAILED` (today) | `/admin/erp/failures`                    |
| 13  | 여신 초과 예상 주문  | `Order WHERE creditWarningLevel >= 1 AND status NOT IN terminal`               | `/admin/orders?creditWarning=true`       |
| 14  | 미수금 위험 거래처   | `Customer WHERE receivableAmount > creditLimit * 0.8 AND isActive`             | `/admin/customers?atRisk=true`           |

## 3. 카드 디자인 규칙

```
┌────────────────────────────────────┐
│ 🔴  배차 실패 건수                 │
│                                    │
│         3                          │
│                                    │
│ 어제 대비 +2  ▲                    │
└────────────────────────────────────┘
```

- 숫자 = 0 → 회색 (정상)
- 1~ → 노랑 (주의)
- 임계값 초과 → 빨강 (긴급)

임계값 예시:
- 미확인 주문 5건 이상 → 노랑, 10건 이상 → 빨강
- 보류 재확인 지연 1건 이상 → 빨강
- 배차 실패 1건 이상 → 빨강
- 출고 수량 차이 1건 이상 → 노랑
- ERP 실패 1건 이상 → 빨강
- 여신 초과 예상 1건 이상 → 빨강

## 4. 카드 그룹

대시보드를 4개 섹션으로 그룹화:

### 🟦 오늘 현황 (Today)
- 1. 신규 주문
- 2. 미확인
- 8. 출고 완료
- 11. ERP 완료

### 🟧 즉시 조치 필요 (Action Required)
- 4. 보류 재확인 지연
- 6. 배차 실패
- 9. 수량 차이
- 12. ERP 실패

### 🟨 모니터링 (Watch)
- 3. 보류 주문
- 5. 배차 중
- 7. 재시도 예정
- 10. ERP 대기

### 🟥 경영 위험 (Business Risk)
- 13. 여신 초과 예상
- 14. 미수금 위험

## 5. 추가 위젯

### 5.1 영업사원별 처리 현황 (대표/관리자만)
| 영업사원 | 담당 주문 | 미처리 | 보류 | 평균 처리 시간 |
| -------- | --------- | ------ | ---- | -------------- |
| 홍길동   | 12        | 1      | 0    | 23분           |
| 김영희   | 8         | 3 (!)  | 2    | 1시간 12분     |

미처리 3+ → 빨강 강조.

### 5.2 최근 알림 (개인용)
헤더 벨 아이콘 클릭 시 드로어. `NotificationLog WHERE recipientId = me ORDER BY createdAt DESC LIMIT 20`.

### 5.3 주간 차트 (옵션, 1차 MVP 후순위)
- 일별 주문 접수/승인/반려/출고 라인 차트
- recharts 또는 visx

## 6. 화면 레이아웃

```
┌────────────────────────────────────────────────────────┐
│ 헤더: 로고 / 검색 / 알림 벨 / 사용자 메뉴               │
├────────┬───────────────────────────────────────────────┤
│        │ 오늘 현황 (4 카드)                             │
│ 사이드 │                                                │
│ 메뉴   │ 즉시 조치 필요 (4 카드)                        │
│        │                                                │
│ • 대시 │ 모니터링 (4 카드)                              │
│ • 주문 │                                                │
│ • 배차 │ 경영 위험 (2 카드) + 영업사원 표              │
│ • 출고 │                                                │
│ • ERP  │ (옵션) 주간 차트                              │
│ • 알림 │                                                │
│ • 마스터│                                               │
└────────┴───────────────────────────────────────────────┘
```

## 7. 구현 메모

- 카드는 React Server Component로 SSR (각 카드 = 1 쿼리)
- 30초 간격 자동 새로고침 (옵션, `revalidatePath` 또는 SWR)
- 권한별 카드 노출 차등:
  - `EXECUTIVE` — 14개 모두 + 영업사원 표 + 주간 차트
  - `ADMIN` — 14개 모두 + 영업사원 표
  - `SALES` — 본인 담당 주문 기준 1, 2, 3, 4, 5, 6, 7, 8 (개인화)
  - `SUPPORT` — 1, 2, 6, 8, 9, 10, 11, 12

## 8. 모바일 대응
- 카드 그리드: 데스크탑 4열, 태블릿 2열, 모바일 1열
- 사이드 메뉴는 햄버거 토글
