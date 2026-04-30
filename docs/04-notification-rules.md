# 04. Notification Rules — 알림 규칙 및 채널 정책

## 1. 채널 비용 정책 (MVP 결정)

| 채널                         | 비용                                                                          | MVP 사용                              |
| ---------------------------- | ----------------------------------------------------------------------------- | ------------------------------------- |
| **이메일 (SMTP)**            | **무료** (회사 메일 / Gmail App Password / Brevo·Resend 무료 티어 月 3,000건) | ✅ 거래처 + 내부                       |
| **내부 웹 알림** (벨 아이콘) | **무료**                                                                      | ✅ 내부만                              |
| **텔레그램 봇**              | **무료**                                                                      | ✅ 내부 즉시 알림 (담당자/관리팀 그룹) |
| Slack webhook                | 무료                                                                          | 옵션                                  |
| 카카오 알림톡                | **유료** (~7-10원/건 + 발송사 등록비)                                         | ❌ 2차 MVP                             |
| SMS / LMS                    | **유료** (~20-30원/건)                                                        | ❌ 2차 MVP                             |
| 카톡 친구톡                  | 유료 (~14-30원/건)                                                            | ❌                                     |

→ MVP는 **이메일 + 내부 웹 + 텔레그램**으로 충분히 운영 가능. 카톡 알림톡은 거래처 만족도 확인 후 도입.

`NotificationChannel` enum에는 모든 채널이 포함되어 있어 어댑터만 추가하면 즉시 확장 가능.

## 2. 크로스체크 3원칙 (요구사항 §12)

모든 핵심 이벤트는 다음 3가지가 반드시 함께 기록되어야 한다:

1. **`Order.status` 변경**
2. **`OrderStatusHistory` INSERT** (내부 담당자 확인 기록)
3. **`NotificationLog` INSERT** (거래처 알림 발송 또는 발송 예정)

→ 이 3개를 1개 트랜잭션으로 묶는 서비스 함수 `changeOrderStatus()`를 두고, UI 어디서도 `prisma.order.update()`를 직접 호출하지 못하게 한다.

거래처 알림 발송이 실패해도 (예: 이메일 서버 장애) `NotificationLog.sendStatus = FAILED`, `failedReason` 기록 후 내부 담당자에게 별도 알림.

## 3. 거래처 알림 트리거 이벤트

`shouldNotifyCustomer(newStatus)` 가 `true`인 상태:

| 이벤트              | 상태                                                | 알림톡 템플릿                                   |
| ------------------- | --------------------------------------------------- | ----------------------------------------------- |
| 주문요청 접수       | `REQUESTED` → `PENDING_SALES_REVIEW`                | `ORDER_REQUESTED`                               |
| 담당자 승인         | → `APPROVED`                                        | `ORDER_APPROVED`                                |
| 반려                | → `REJECTED`                                        | `ORDER_REJECTED` (사유 포함)                    |
| 보류                | → `ON_HOLD`                                         | `ORDER_HOLD` (사유 + 다음 안내일 포함)          |
| 배차 실패/일정 변경 | → `DISPATCH_FAILED` 또는 `DISPATCH_RETRY_SCHEDULED` | `DISPATCH_FAILED`                               |
| 배차 완료           | → `DISPATCH_COMPLETED`                              | `DISPATCH_COMPLETED` (차량/기사 정보 노출 토글) |
| 출고 예정           | → `READY_TO_SHIP`                                   | (옵션)                                          |
| 출고 완료           | → `SHIPPED`                                         | `SHIPPED`                                       |
| 수령 확인 요청      | → `DELIVERY_CONFIRM_PENDING`                        | (옵션, 거래처 포털 사용 시만)                   |

거래처에게는 **내부 미처리 상황을 노출하지 않는다.** "10분 미확인" 같은 메시지는 내부에만.

## 4. 내부 미처리 단계 알림 (요구사항 §10)

대상: `PENDING_SALES_REVIEW` 또는 `SALES_REVIEWING` 상태로 머무는 주문.

| 경과 시간         | 알림 대상                     | 채널                   | 템플릿                          |
| ----------------- | ----------------------------- | ---------------------- | ------------------------------- |
| 즉시              | 담당 영업                     | 텔레그램 + 내부 웹     | `ORDER_REQUESTED` (담당 영업용) |
| 10분 미확인       | 담당 영업 (재알림)            | 텔레그램 + 내부 웹     | `PENDING_REVIEW_10MIN`          |
| 30분 미확인       | 담당 영업 + 관리팀            | 텔레그램 그룹 + 이메일 | `PENDING_REVIEW_30MIN`          |
| 1시간 미확인      | 담당 영업 + 관리팀 + 영업총괄 | 텔레그램 그룹 + 이메일 | `PENDING_REVIEW_60MIN`          |
| 2시간 미확인      | 위 + 대표/임원                | 텔레그램 + 이메일      | `PENDING_REVIEW_120MIN`         |
| 당일 16:30 미처리 | 담당 영업 + 관리팀            | 텔레그램 + 이메일      | "마감 30분 전 처리 요청"        |
| 당일 17:00 미처리 | 대표 일일 리포트에 포함       | 이메일                 | 일일 리포트                     |

구현: 5분 간격 cron job이 `Order.status IN (PENDING_SALES_REVIEW, SALES_REVIEWING)` 인 행을 조회하여 마지막 알림 시각 대비 경과를 판정. 알림 발송 시 `NotificationLog.notificationType = 'INTERNAL_PENDING_30MIN'` 등으로 기록 (중복 발송 방지).

## 5. 보류 재알림 (`HoldReminder`)

- 보류 시 `remindAt` 필수 입력 (없으면 저장 차단).
- cron이 `WHERE remindAt <= now() AND isCompleted = false` 조회 → 책임 담당자에게 `HOLD_REMINDER_DUE` 알림.
- 담당자가 처리 시 `isCompleted = true`, `completedAt = now()`. 처리 안 하면 24시간 후 관리팀 에스컬레이션.

## 6. 배차 실패 알림 정책

거래처 알림은 **자동 발송 vs 영업 수동 검토 후 발송** 토글 가능 (`Order.customerNoticeRequired`).

차량 정보 / 기사 연락처 노출은 `Dispatch.shareWithCustomer`로 결정 (기본 false). 거래처가 기사에게 직접 연락하는 것이 정책상 부담스러울 수 있음.

## 7. ERP 입력 결과 알림

| 이벤트               | 대상               | 채널               |
| -------------------- | ------------------ | ------------------ |
| 17:05 배치 생성됨    | 관리팀             | 텔레그램 + 내부 웹 |
| 17:50 입력 실패 발생 | 관리팀 + 담당 영업 | 텔레그램 + 이메일  |
| 18:00 일일 리포트    | 대표 + 임원        | 이메일             |

## 8. 알림 로그 뷰어 화면 (`/admin/notifications`)

- 필터: 채널, 발송 상태(SENT/FAILED/PENDING), 수신자 유형, 기간
- 실패 건은 빨간색 강조 + 재발송 버튼
- 거래처별 알림 누적 통계 (월별)

## 9. MVP 단계의 mock 발송

`src/lib/notifications/sender.ts`(미작성)에서 어댑터 패턴으로 채널별 분기:

- `EmailSender` — nodemailer 사용, MVP에서 실제 발송
- `TelegramSender` — Telegram Bot API HTTP 호출, MVP에서 실제 발송
- `KakaoAlimtalkSender` — 항상 `SKIPPED` 처리, 콘솔에만 로그 (2차에서 구현)
- `SmsSender` — 동일

→ 이 구조로 카톡/SMS 도입 시 어댑터 1개만 교체하면 되고, 메시지 템플릿(`src/shared/notifications/templates.ts`)은 그대로 사용.
