# 08. MVP Roadmap — 단계별 실행 계획

## Phase 0 — 사전 셋업 ✅ (이번 작업 완료분)

- [x] 신규 폴더 `c:\website\hanyangpetro-ops` 생성 (기존 Hugo 리포 분리)
- [x] 9개 설계 문서 작성 (`docs/`)
- [x] Prisma schema 17개 엔티티
- [x] 도메인 enum + 한글 라벨 + 색상
- [x] 주문 상태 머신 + 전환 가드
- [x] 거래처/내부 알림 템플릿
- [x] Docker Compose (Postgres)
- [x] `.gitignore`, `.env.example`, README

## Phase 1 — Next.js 앱 스캐폴드 (다음 작업)

- [ ] `npx create-next-app@latest .` (TypeScript, Tailwind, App Router, src/)
- [ ] 의존성 설치: Prisma, NextAuth, zod, react-hook-form, lucide-react, date-fns, sonner
- [ ] shadcn/ui 초기화 + 핵심 컴포넌트 (button, card, table, dialog, form, input, select, badge, tabs, dropdown-menu, sonner)
- [ ] `src/lib/db.ts` — Prisma 클라이언트 싱글톤
- [ ] `src/lib/auth.ts` — NextAuth 설정 (직원 + 거래처 사용자 분리)
- [ ] `prisma migrate dev --name init`
- [ ] `prisma/seed.ts` — 시드 데이터 (사용자 4, 거래처 5, 제품 14, 주문 20)
- [ ] 로그인 화면 `/login` (직원), `/portal/login` (거래처, 2차에서 활성화)

## Phase 2 — 내부 관제 화면 (MVP 핵심)

### Phase 2A — 조회 화면
- [ ] `/admin` — 대시보드 (14개 카드, 권한별 차등)
- [ ] `/admin/orders` — 주문 목록 (필터: 상태, 담당자, 거래처, 출처, 기간)
- [ ] `/admin/orders/[id]` — 주문 상세
  - 헤더 (거래처, 도착지, 담당, 여신 경고)
  - 품목 라인
  - 상태 타임라인 (`OrderStatusHistory`)
  - 부수 정보 패널 (배차/출고/수령/ERP)
  - 알림 로그 패널

### Phase 2B — 등록/수정
- [ ] `/admin/orders/new` — 주문 등록
  - 거래처 자동완성 (검색)
  - 도착지 선택 (선택한 거래처의 주소 또는 신규 입력)
  - 도착지 검색 → 거래처 자동 매칭 (역방향)
  - 품목 라인 (전체 Product에서 검색)
  - `rawOrderText` 텍스트 영역 (붙여넣기용)
  - 주문 출처, 메모

### Phase 2C — 상태 변경 모달
- [ ] 승인 모달 — 승인 수량/예상 출고일/공급처 유형/공급처/단가 상태/배차 필요/거래처 알림 여부
- [ ] 반려 모달 — 사유 (드롭다운 + 자유), 거래처 안내 문구, 대체 제안, 내부 메모
- [ ] 보류 모달 — 사유, **`remindAt` 필수 (없으면 저장 차단)**, 책임 담당자, 재알림 대상, 거래처 안내, 내부 메모

### Phase 2D — 배차/출고
- [ ] `/admin/dispatch` — 배차 칸반 (WAITING/DISPATCHING/FAILED/COMPLETED)
- [ ] 배차 처리 모달 — 차량/기사 입력 또는 실패 사유+재시도일
- [ ] `/admin/shipments` — 출고 처리 목록
- [ ] 출고 완료 모달 — 실제 수량 입력, 차이 시 사유 강제

### Phase 2E — ERP 마감
- [ ] `/admin/erp` — 배치 목록
- [ ] `/admin/erp/batches/[id]` — 배치 상세 + 검토/승인/실행 버튼
- [ ] `/admin/erp/failures` — 실패 건 모음

### Phase 2F — 알림 로그
- [ ] `/admin/notifications` — 알림 로그 뷰어 (필터, 재발송 버튼)

### Phase 2G — 마스터 데이터 (관리자만)
- [ ] `/admin/customers` — 거래처 목록/등록/수정 + 도착지 관리 + 화이트리스트 관리
- [ ] `/admin/products` — 제품 목록/등록/수정 (이카운트/클릭2002 코드 매핑)
- [ ] `/admin/suppliers` — 공급처
- [ ] `/admin/users` — 직원 (관리자만)

## Phase 3 — 자동화 & 스케줄러

- [ ] cron worker 구조 (node-cron 또는 별도 워커 컨테이너)
- [ ] 미처리 단계별 알림 cron (5분 주기)
- [ ] 보류 재알림 cron (5분 주기)
- [ ] 17:00 ERP 배치 자동 생성 cron
- [ ] 16:30/16:50/17:50/18:00 알림 cron
- [ ] ERP 어댑터 인터페이스 (`ErpAdapter`) + Mock + Export 구현
- [ ] `automation/erp/` 폴더에 export → 기존 Python 자동화 watch 폴더 통합 가이드

## Phase 4 — 알림 채널 어댑터

- [ ] `EmailSender` — nodemailer (실제 발송)
- [ ] `TelegramSender` — Bot API (실제 발송)
- [ ] `InternalWebSender` — DB INSERT만 (벨 아이콘에서 조회)
- [ ] `KakaoAlimtalkSender` — 인터페이스만, 콘솔 로그 (2차에서 구현)
- [ ] `SmsSender` — 동일

## Phase 5 — 호스팅 & 배포

- [ ] 사무실 PC에 Docker Desktop 설치 확인
- [ ] PostgreSQL + 앱 컨테이너 기동
- [ ] Cloudflare Tunnel 설정 → `order.hanyangpetro.com` 노출
- [ ] DNS CNAME 추가 (Cloudflare 또는 도메인 등록기관)
- [ ] HTTPS 자동 (Cloudflare 처리)
- [ ] 운영 환경변수 설정
- [ ] DB 백업 자동화 (매일 새벽 `pg_dump` → 외장 SSD 또는 NAS)

## ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 2차 MVP — 거래처 포털

- [ ] `/portal/login` 거래처 로그인
- [ ] `/portal` 거래처 대시보드 (본인 회사 주문 현황)
- [ ] `/portal/orders/new` 거래처 주문 요청
  - 본인 회사 등록된 도착지 중 선택 (필수)
  - 화이트리스트 제품만 노출 (`CustomerProductWhitelist.isVisibleInPortal=true`)
  - 단가 미확정 동의 문구 (요구사항 §16)
- [ ] `/portal/orders/[id]` 본인 회사 주문 상태 확인
- [ ] (옵션) 거래처 수령 확인 버튼

## 2차 MVP — ERP 실연동

- [ ] 기존 Python 자동화 8개 인벤토리 작성
- [ ] Export-only 모드로 통합 (가장 안전)
- [ ] 안정화 후 FastAPI 래핑으로 발전
- [ ] 입력 결과 자동 피드백 (실패 사유 자동 분류)

## 2차 MVP — 알림 확장

- [ ] 카카오 알림톡 연동 (CoolSMS / NHN Toast / Aligo 비교 후 선정)
- [ ] 알림톡 템플릿 사전 등록 (카카오 비즈메시지센터)
- [ ] SMS 폴백 (알림톡 실패 시)
- [ ] 채널별 발송 비용 통계 대시보드

## 2차 MVP — 추가 기능

- [ ] AI 주문 원문 파싱 (OpenAI/Claude API, `Order.rawOrderText` → 구조화)
- [ ] 자동 수령 간주 정책 활성화 (대표 승인 필수)
- [ ] 이카운트 미수금 자동 동기화 (cron으로 ERP에서 가져오기)
- [ ] 모바일 PWA (영업사원 외근 시 사용)
- [ ] 카카오톡 챗봇 인입 자동화 (RPA로 카톡 메시지 → 시스템 INSERT)

## 3차 — 경영 분석

- [ ] 거래처별 매출/마진 분석
- [ ] 제품별 회전율
- [ ] 영업사원 KPI
- [ ] 분기/연간 리포트
- [ ] BI 도구 연동 (Metabase 등)

## 우선순위 매트릭스 (1차 MVP 화면별)

| 화면                | 가치  | 난이도 | 우선순위 |
| ------------------- | ----- | ------ | -------- |
| 주문 목록 + 상세    | ★★★★★ | ★★     | 1        |
| 승인/반려/보류 모달 | ★★★★★ | ★★     | 2        |
| 주문 등록           | ★★★★★ | ★★★    | 3        |
| 대시보드 14 카드    | ★★★★  | ★★     | 4        |
| 배차 관리           | ★★★★  | ★★     | 5        |
| 출고 완료 처리      | ★★★★  | ★★     | 6        |
| ERP 배치 검토/실행  | ★★★★  | ★★★    | 7        |
| 마스터 데이터 화면  | ★★★   | ★★     | 8        |
| 알림 로그 뷰어      | ★★    | ★      | 9        |
| 거래처 포털         | (2차) | ★★★    | 2차      |
