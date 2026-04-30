# 06. ERP Daily Closing Flow — 17:00 마감 자동입력 프로세스

## 1. 원칙

> **MVP에선 완전 자동입력이 아니라 "후보 생성 → 관리팀 검토 → 승인 → 실행" 구조.**

요구사항 §11 명시: "ERP 입력을 무조건 자동 실행하는 구조로 만들지 마라. 초기에는 관리팀 검토 후 실행 구조여야 한다."

## 2. 일일 타임라인 (Asia/Seoul)

| 시각      | 작업                                                                        | 자동/수동   | 산출물                                              |
| --------- | --------------------------------------------------------------------------- | ----------- | --------------------------------------------------- |
| 16:30     | 오늘 출고 예정/완료 중 미확정 건 알림                                       | cron (자동) | 담당자 텔레그램 + 내부 웹                           |
| 16:50     | 미처리 건 재알림 + 관리팀 공유                                              | cron (자동) | 담당+관리팀 알림                                    |
| **17:00** | **`SHIPPED` 상태 주문 자동 취합 → `ErpInputBatch` 생성 (status=GENERATED)** | cron (자동) | DB 배치 레코드 + 관리팀 알림                        |
| 17:05     | 관리팀 검토 화면 표시 (`/admin/erp/batches/today`)                          | 사람 (수동) | UI 검토                                             |
| 17:10     | 관리팀이 입력 대상 승인 (제외 건 마킹)                                      | 사람 (수동) | `batchStatus=APPROVED`, 제외 건은 `isExcluded=true` |
| 17:15     | 이카운트 어댑터 실행 (또는 export 파일 생성)                                | 자동        | `ecountStatus` 업데이트                             |
| 17:25     | 클릭2002 어댑터 실행 (또는 export 파일 생성)                                | 자동        | `click2002Status` 업데이트                          |
| 17:40     | 성공/실패 리포트 생성                                                       | 자동        | UI 업데이트 + 알림                                  |
| 17:50     | 실패 건 담당자/관리팀 알림                                                  | 자동        | 텔레그램 + 이메일                                   |
| 18:00     | 대표용 일일 리포트 생성                                                     | 자동        | 이메일                                              |

## 3. ErpInputBatch 생성 로직 (17:00 cron)

```typescript
// pseudo-code
const today = startOfDay(new Date(), 'Asia/Seoul');
const shippedToday = await prisma.order.findMany({
  where: {
    status: 'ERP_INPUT_WAITING',  // 또는 SHIPPED + 수령 확인
    shipments: { some: { actualShipDate: { gte: today } } },
    // 이미 다른 배치에 포함된 경우 제외
    erpInputItems: { none: { batch: { batchDate: today } } },
  },
});

const batch = await prisma.erpInputBatch.create({
  data: {
    batchDate: today,
    batchStatus: 'GENERATED',
    items: {
      create: shippedToday.map(o => ({
        orderId: o.id,
        ecountStatus: 'NOT_STARTED',
        click2002Status: 'NOT_STARTED',
        // 자동 제외 사유 검사
        ...autoExclusionCheck(o),
      })),
    },
  },
});

await notifyAdmins('ERP_BATCH_GENERATED', { batchDate: today, itemCount: shippedToday.length });
```

## 4. 자동 제외 사유 검사

배치 생성 시 다음 조건이면 자동으로 `isExcluded=true` 마킹 + 사유 기재:

| 사유                    | 검사 조건                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| 단가 미확정             | `Order.priceStatus IN ('UNKNOWN', 'NEGOTIATION_REQUIRED')` 또는 `OrderItem` 라인 중 하나라도 |
| 거래처 코드 미매칭      | `Customer.customerCode == null`                                                              |
| 품목 코드 미매칭        | `Product.ecountItemCode == null` 또는 `click2002ItemCode == null`                            |
| 실제 출고 수량 미확인   | `Shipment.shippedQuantity == null`                                                           |
| 배차 실패로 출고 미완료 | `Order.status` 가 `DISPATCH_FAILED` 계열                                                     |
| 출고 취소               | `Order.status == CANCELLED`                                                                  |
| 수량 차이 확인 필요     | `Shipment.hasQuantityDiscrepancy && quantityDifferenceReason == null`                        |
| 관리자 보류             | 관리자가 수동 마킹                                                                           |

자동 제외된 건은 검토 화면에서 빨간 표시 + 사유 표시. 관리팀이 수정 후 다시 포함 가능.

## 5. ERP 어댑터 인터페이스

`src/lib/erp/adapters.ts` (미작성):

```typescript
export interface ErpAdapter {
  name: 'ecount' | 'click2002';
  /** 단일 입력 또는 배치 단위 */
  runItem(item: ErpInputItemWithOrder): Promise<{
    success: boolean;
    errorMessage?: string;
    externalRef?: string;  // ERP 측 생성된 전표 번호 등
  }>;
  /** export-only 모드: 입력 대신 파일로 출력 (기존 Python에 넘기기 위함) */
  exportBatch(batch: ErpInputBatchWithItems): Promise<string>;  // 파일 경로
}
```

### MVP 구현
- **모드 A: Mock** — 항상 90% 성공, 10% 랜덤 실패. 콘솔 로그.
- **모드 B: Export** — 배치를 JSON/CSV 파일로 `ERP_EXPORT_DIR`에 저장. 기존 Python 스크립트가 watch 폴더로 처리.

### 추후 (2차)
- **모드 C: Real** — Python 자동화를 Node에서 spawn하거나, Python을 HTTP API로 래핑하여 직접 호출. 또는 Node에서 직접 PyAutoGUI/Playwright로 클릭2002 자동화 재구현.

## 6. 배치 상태 머신

```
GENERATED  (17:00 cron 산출)
   │
   ▼ 관리팀이 검토 시작
UNDER_REVIEW
   │
   ▼ 관리팀 승인 (제외 건 확정)
APPROVED
   │
   ▼ 어댑터 실행 (또는 export)
RUNNING
   │
   ├─ 모든 항목 SUCCESS → COMPLETED
   ├─ 일부 FAILED → PARTIALLY_FAILED
   └─ 전부 FAILED → FAILED
```

`PARTIALLY_FAILED` / `FAILED` 상태에서 관리팀이 실패 건만 재시도 가능 (`retryCount` 증가).

## 7. 화면

### `/admin/erp` — 배치 목록
- 일자별 배치 카드 (오늘 + 최근 7일)
- 상태 배지, 항목 수, 성공/실패 수, 제외 수
- 클릭 → 상세

### `/admin/erp/batches/[id]` — 배치 상세
- 헤더: 배치 일자, 상태, 검토 정보
- 항목 표:
  - 주문번호, 거래처, 품목, 수량
  - 이카운트 상태, 클릭2002 상태
  - 제외 여부, 제외 사유
  - 액션: [제외/포함 토글], [개별 재시도]
- 액션 버튼:
  - `[검토 시작]` (GENERATED → UNDER_REVIEW)
  - `[승인 및 실행]` (UNDER_REVIEW → APPROVED → RUNNING)
  - `[Export 파일 다운로드]` (Python 자동화로 넘길 때)
  - `[실패 건 재시도]`

### `/admin/erp/failures` — 실패 건 모음
크로스 배치 실패 건 모음. 수동 처리/제외/재시도.

## 8. 18:00 대표용 일일 리포트

이메일 본문에 포함:

- 오늘 신규 주문 N건 / 처리 완료 N건 / 미처리 N건
- 오늘 출고 완료 N건 / 수량 차이 발생 N건
- ERP 입력 시도 N건 / 성공 N건 / 실패 N건 / 제외 N건
- 보류 주문 누적 N건 (3일 이상 N건)
- 여신 초과 예상 거래 N건
- 미수금 위험 거래처 N곳

리포트 발송 결과는 `NotificationLog`에 기록.

## 9. 향후 Python 자동화 통합 시나리오

기존 8개 Python 스크립트를 어떻게 흡수하느냐 옵션:

### 옵션 A: Export-only (가장 안전, 권장 시작점)
- 본 시스템이 매일 17:15에 JSON/CSV 파일을 `ERP_EXPORT_DIR`에 생성
- 기존 Python 스크립트는 그 파일을 읽어 클릭2002/이카운트에 입력
- 입력 결과를 result.json으로 다시 같은 폴더에 쓰면, Node가 watch하여 `ErpInputItem` 상태 업데이트
- 기존 자동화 코드 거의 수정 없이 통합 가능

### 옵션 B: Python을 HTTP API로 래핑
- 기존 스크립트에 `FastAPI` 한 겹 씌워서 `POST /run` 엔드포인트
- Node가 HTTP로 호출 → 결과 즉시 받음
- 타임아웃·재시도·로깅 깔끔

### 옵션 C: Node에서 Python 직접 실행
- `child_process.spawn('python', [scriptPath, args])`
- 단순하지만 stdout 파싱·에러 처리 번거로움

→ **MVP는 옵션 A**, 안정화되면 옵션 B로 발전.
