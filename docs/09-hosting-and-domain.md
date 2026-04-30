# 09. Hosting & Domain — 사무실 PC + Cloudflare Tunnel + 서브도메인

## 1. 결정 요약

| 항목       | 선택                           | 이유                                                                    |
| ---------- | ------------------------------ | ----------------------------------------------------------------------- |
| 호스팅     | **사무실 Windows 데스크탑 PC** | 클릭2002·이카운트가 같은 PC에 있어 ERP 자동화 통합 용이. 추가 비용 0원. |
| 컨테이너화 | **Docker Desktop for Windows** | Postgres + Next.js 앱 분리, 재시작/백업 쉬움                            |
| 외부 노출  | **Cloudflare Tunnel** (free)   | 공인 IP·포트포워딩 불필요. HTTPS 자동. 무료.                            |
| 도메인     | `order.hanyangpetro.com`       | 기존 `hanyangpetro.com` 그대로, DNS 레코드 1줄 추가                     |
| DB 백업    | `pg_dump` cron + 외장 SSD/NAS  | 비용 0원                                                                |

월 비용 합계: **0원** (전기료 제외)

## 2. 도메인 구조

```
hanyangpetro.com
├─ www.hanyangpetro.com         → 기존 Hugo 정적 사이트 (GitHub Pages, 변경 없음)
├─ hanyangpetro.com (apex)       → 동일 (Hugo)
└─ order.hanyangpetro.com        → 새 주문 시스템 (Cloudflare Tunnel)
```

기존 사이트와 도메인 분리 없이, 서브도메인 1개 추가만으로 해결.

## 3. Cloudflare Tunnel 설정

### Step 1. Cloudflare 계정 + 도메인 등록
- Cloudflare 계정 생성 (무료)
- `hanyangpetro.com` 을 Cloudflare에 추가 (네임서버 변경 필요할 수 있음)
  - **주의**: 기존 GitHub Pages 사이트가 이미 운영 중이므로, DNS 레코드를 Cloudflare로 옮길 때 기존 `www`/apex A·CNAME을 그대로 복사해야 함. 잘못하면 마케팅 사이트 다운.
  - 또는 도메인을 Cloudflare로 옮기지 않고, 기존 등록기관에 NS 그대로 두면서 `order.hanyangpetro.com` 만 Cloudflare 무료 DNS에 위임 (서브도메인 위임 방식). 이게 더 안전.

### Step 2. Cloudflare Zero Trust → Tunnels
1. https://one.dash.cloudflare.com → Networks → Tunnels → Create a tunnel
2. Connector: Cloudflared
3. 이름: `hanyang-ops`
4. Windows 설치 명령어 복사 → 사무실 PC PowerShell에 실행 (서비스로 등록됨)
5. Public hostname 추가:
   - Subdomain: `order`
   - Domain: `hanyangpetro.com`
   - Service: `HTTP` `localhost:3000`
6. 저장하면 자동으로 DNS CNAME이 추가됨 (`order.hanyangpetro.com` → `<tunnel-id>.cfargotunnel.com`)

### Step 3. HTTPS 확인
- 즉시 `https://order.hanyangpetro.com` 접속 가능
- HTTPS 인증서는 Cloudflare가 자동 발급/갱신 (무료)

## 4. 사무실 PC 환경 준비

### 필수 설치
- **Windows 11 또는 10** (이미 설치됨)
- **Docker Desktop for Windows** — https://www.docker.com/products/docker-desktop/
- **Node.js 20 LTS** — https://nodejs.org (개발용, 운영은 컨테이너 내부 Node 사용)
- **Git for Windows** — https://git-scm.com
- **Cloudflared** — Tunnel 설정 시 자동 설치

### 디렉토리
```
C:\hanyang\
├─ ops\                    # git clone 한 본 프로젝트
├─ data\                   # Docker 볼륨 (postgres 데이터)
├─ backups\                # pg_dump 백업
└─ automation\
   └─ erp\                 # 기존 Python 자동화 + 본 시스템 export 폴더
       └─ inbox\           # 본 시스템이 JSON 떨구는 위치
```

### Docker 컨테이너
```powershell
cd C:\hanyang\ops
copy .env.example .env
# .env 수정 (DB 비밀번호, NEXTAUTH_SECRET 등)
docker compose up -d
```

## 5. 백업 정책

### 자동 백업 스크립트 (`C:\hanyang\backup.ps1`)
```powershell
$date = Get-Date -Format "yyyy-MM-dd_HHmm"
$backupDir = "C:\hanyang\backups"
docker exec hanyang_ops_postgres pg_dump -U hanyang -d hanyang_ops -F c -f /tmp/backup.dump
docker cp hanyang_ops_postgres:/tmp/backup.dump "$backupDir\hanyang_$date.dump"
# 30일 이상 된 백업 삭제
Get-ChildItem $backupDir -Filter "*.dump" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item
# (옵션) 외장 SSD 또는 NAS로 복사
# Copy-Item "$backupDir\hanyang_$date.dump" "Z:\backups\"
```

### Windows 작업 스케줄러 등록
- 트리거: 매일 새벽 03:00
- 동작: `powershell.exe -File C:\hanyang\backup.ps1`

## 6. 한계 및 향후 이전 시나리오

### 현재 구조의 한계
- **사무실 PC 꺼지면 서비스 중단** — 영업시간 외에는 거래처 포털 응답 불가 (1차 MVP는 내부용이라 OK, 2차에서 이슈)
- **정전/네트워크 장애** 시 단일 장애점
- **단일 PC 자원 한계** — 동시 접속자 100+ 시 부족할 수 있음

### 향후 이전 시나리오

| 시점                | 옵션                                                       | 비용                         |
| ------------------- | ---------------------------------------------------------- | ---------------------------- |
| 거래처 포털 오픈 시 | 사내 NAS(시놀로지 등) Docker로 이전                        | 추가 비용 0 (NAS 보유 가정)  |
| 24/7 안정성 필요    | AWS Seoul EC2 t3.small + RDS                               | 월 5~10만원                  |
| 트래픽 증가 시      | 컨테이너만 클라우드, ERP 자동화는 사무실 유지 (하이브리드) | 위 + ERP 자동화 SQS·SSM 연결 |

## 7. 보안 체크리스트

- [ ] Cloudflare Access (Zero Trust) — 직원 IP 또는 Google 계정 인증으로 `/admin/*` 접근 제한 (무료 플랜에서 50 사용자까지 무료)
- [ ] 강력한 `NEXTAUTH_SECRET` (`openssl rand -base64 32`)
- [ ] DB 비밀번호 강력 + 외부 노출 X (포트 5432는 localhost 바인딩만)
- [ ] `.env` 절대 git commit 금지 (`.gitignore`에 포함됨)
- [ ] 직원 비밀번호 bcrypt 12+ rounds
- [ ] HTTPS 강제 (Cloudflare에서 "Always Use HTTPS" 켜기)
- [ ] 거래처 포털은 IP 화이트리스트 안 걸어도 되지만, 직원 관리자 페이지는 Cloudflare Access 권장
- [ ] DB 백업 외장 SSD/NAS에도 복사 (랜섬웨어 대비)

## 8. 운영 체크리스트 (월 1회)

- [ ] Docker 컨테이너 메모리/디스크 확인
- [ ] DB 크기 확인 (`SELECT pg_size_pretty(pg_database_size('hanyang_ops'))`)
- [ ] 백업 파일 30일치 보관 확인
- [ ] Cloudflare Tunnel 상태 확인
- [ ] OS·Docker·Node 보안 업데이트
- [ ] `NotificationLog` 1년 이상 데이터 아카이브 (선택)
