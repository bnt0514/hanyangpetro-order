# 한양유화 e-Business OS (주문 관제 시스템)

한양유화 내부 주문 접수 → 승인/반려/보류 → 공급처 주문 → 배차 → 출고 → ERP 입력 → 거래처 알림 → 마감/대시보드까지 연결하는 사내 주문 관제 시스템.

기존 마케팅 사이트(`hanyangpetro.com`, Hugo 정적 사이트)와 **완전히 분리된 별도 프로젝트**입니다. 동일 루트 도메인의 서브도메인(`order.hanyangpetro.com`)으로 서비스됩니다.

## 1차 MVP 범위

내부 직원용 주문 관제 화면이 우선입니다. 거래처(고객) 포털은 2차 확장으로 데이터 모델·라우팅만 미리 준비합니다.

- ✅ 내부 주문 등록 (전화/카톡/이메일 주문 대신 입력)
- ✅ 승인 / 반려 / 보류 + 보류 재알림
- ✅ 배차 상태 관리 (배차 중/완료/실패/재시도)
- ✅ 출고 완료 처리 (실제 출고 수량 차이 반영)
- ✅ 17:00 ERP 입력 후보 자동 생성 + 관리팀 검토 후 실행 (mock)
- ✅ 거래처/내부 알림 로그 (mock 발송)
- ✅ 대표/관리자 대시보드 기초
- 🟡 (2차) 거래처 로그인, 화이트리스트 기반 주문 포털, 실제 카톡 알림톡, 실제 ERP 자동입력

자세한 요구사항은 [`docs/`](./docs) 폴더 참조.

## 기술 스택

| 영역       | 선택                                                       |
| ---------- | ---------------------------------------------------------- |
| 프레임워크 | Next.js 15 (App Router, TypeScript)                        |
| ORM        | Prisma                                                     |
| DB         | PostgreSQL 16 (Docker)                                     |
| 인증       | NextAuth (Auth.js) — 직원 + 거래처 사용자 분리             |
| UI         | Tailwind CSS + shadcn/ui                                   |
| 알림(MVP)  | 이메일(SMTP) + 내부 웹 알림 + 텔레그램 webhook (모두 무료) |
| ERP 연동   | 어댑터 인터페이스 (mock → 추후 기존 Python 자동화 연결)    |
| 호스팅     | 사무실 Windows PC + Docker Desktop                         |
| 외부 노출  | Cloudflare Tunnel (무료, HTTPS 자동)                       |
| 도메인     | `order.hanyangpetro.com` (DNS CNAME 1줄 추가)              |

> 자세한 호스팅·도메인 설정은 [`docs/09-hosting-and-domain.md`](./docs/09-hosting-and-domain.md) 참조.

## 폴더 구조

```
hanyangpetro-ops/
├─ docs/                  # 설계 문서 (MVP 진행의 단일 진실원)
├─ prisma/
│  ├─ schema.prisma       # 17개 엔티티 데이터 모델
│  └─ seed.ts             # 시드 데이터 (TODO)
├─ src/
│  ├─ app/                # Next.js App Router (TODO: scaffold)
│  ├─ lib/                # DB, auth, 유틸 (TODO)
│  └─ shared/
│     ├─ enums.ts                  # 상태/역할/채널 enum
│     ├─ state-machine.ts          # 주문 상태 전환 가드
│     └─ notifications/templates.ts # 거래처/내부 알림 템플릿
├─ automation/
│  └─ erp/                # 이카운트/클릭2002 어댑터 자리
├─ docker-compose.yml     # Postgres + (추후) app 컨테이너
├─ .env.example
└─ .gitignore
```

## 다음 단계 (개발자가 이어서 할 것)

현재까지 만들어진 것: 설계 문서 9종, Prisma 스키마, 상태 머신, 알림 템플릿, Docker Compose, 환경 설정.
**아직 안 만든 것**: Next.js 앱 자체 (boilerplate는 CLI로 생성하는 게 깔끔하므로 다음 단계로 분리).

### Step 1. 사전 준비 (한 번만)

```powershell
# Node.js 20 LTS, Docker Desktop, Git 설치 확인
node --version    # v20.x
docker --version
```

### Step 2. PostgreSQL 컨테이너 띄우기

```powershell
cd C:\website\hanyangpetro-ops
copy .env.example .env
# .env 파일에서 비밀번호만 바꾸세요
docker compose up -d postgres
```

### Step 3. Next.js 앱 스캐폴드

```powershell
# 루트 폴더에서 실행
npx create-next-app@latest . --typescript --tailwind --app --src-dir --import-alias "@/*" --no-eslint --use-npm
# 기존 파일(README, prisma 등)을 덮어쓸지 물으면 "No"
```

### Step 4. Prisma & 추가 의존성

```powershell
npm install prisma @prisma/client next-auth@beta @auth/prisma-adapter zod react-hook-form @hookform/resolvers lucide-react date-fns
npm install -D ts-node @types/node

npx prisma generate
npx prisma migrate dev --name init
npx prisma db seed   # seed.ts 작성 후
```

### Step 5. shadcn/ui 초기화

```powershell
npx shadcn@latest init
npx shadcn@latest add button card table dialog form input select badge tabs dropdown-menu sonner
```

### Step 6. 화면 구현 (MVP 우선순위)

`docs/08-mvp-roadmap.md`의 화면 우선순위대로 구현:

1. `/admin` — 대시보드 (14개 카드)
2. `/admin/orders` — 주문 목록 (필터)
3. `/admin/orders/[id]` — 주문 상세 (상태 타임라인, 알림 로그)
4. `/admin/orders/new` — 주문 등록
5. 승인/반려/보류 모달 → 상태 머신 호출
6. `/admin/dispatch` — 배차 관리
7. `/admin/shipments` — 출고 완료 처리 (수량 차이 강조)
8. `/admin/erp` — ERP 입력 후보 (배치 생성/검토/승인/실행)
9. `/admin/notifications` — 알림 로그 뷰어

### Step 7. Cloudflare Tunnel로 외부 노출

`docs/09-hosting-and-domain.md` 참조.

## 문서 목차

| 파일                                                                        | 내용                                            |
| --------------------------------------------------------------------------- | ----------------------------------------------- |
| [01-business-overview.md](./docs/01-business-overview.md)                   | 사업/시스템 개요, 목표, 사용자 역할             |
| [02-order-status-flow.md](./docs/02-order-status-flow.md)                   | 25개 주문 상태 + 전환 매트릭스                  |
| [03-data-model.md](./docs/03-data-model.md)                                 | 17개 엔티티 ER 설계                             |
| [04-notification-rules.md](./docs/04-notification-rules.md)                 | 거래처/내부 알림 규칙·템플릿·미처리 단계 알림   |
| [05-dispatch-and-shipment-flow.md](./docs/05-dispatch-and-shipment-flow.md) | 배차 실패/재시도, 출고 수량 차이, 수령 확인     |
| [06-erp-daily-closing-flow.md](./docs/06-erp-daily-closing-flow.md)         | 17:00 마감 ERP 입력 타임라인                    |
| [07-dashboard-requirements.md](./docs/07-dashboard-requirements.md)         | 대표/관리자 대시보드 카드 명세                  |
| [08-mvp-roadmap.md](./docs/08-mvp-roadmap.md)                               | 1차 MVP → 2차 고객 포털 로드맵                  |
| [09-hosting-and-domain.md](./docs/09-hosting-and-domain.md)                 | 사무실 PC + Cloudflare Tunnel + 서브도메인 설정 |

## 라이선스

내부 사용. 무단 배포 금지.
