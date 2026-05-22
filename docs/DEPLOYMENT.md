# 한양유화 e-Business OS 운영 배포

홈페이지의 로그인 버튼은 `https://order.hanyangpetro.com/login`으로 연결되어 있습니다. 이 문서는 `hanyangpetro-ops` Next.js 앱을 해당 서브도메인에서 상시 실행하는 기준 절차입니다.

## 1. 앱 빌드

```powershell
Push-Location 'C:\website\hanyangpetro-ops'
npm install
npm run deploy:build
Pop-Location
```

## 2. PM2로 상시 실행

```powershell
Push-Location 'C:\website\hanyangpetro-ops'
npm install -g pm2
npm run pm2:start
pm2 save
Pop-Location
```

Windows 서버에서 재부팅 후 자동 실행이 필요하면 `pm2-windows-startup` 또는 NSSM 작업 등록을 사용합니다.

```powershell
npm install -g pm2-windows-startup
pm2-startup install
pm2 save
```

## 3. 리버스 프록시 연결

`order.hanyangpetro.com`을 서버로 DNS 연결한 뒤, 프록시에서 내부 `http://127.0.0.1:3000`으로 전달합니다.

### Caddy 예시

```caddyfile
order.hanyangpetro.com {
  reverse_proxy 127.0.0.1:3000
}
```

### Nginx 예시

```nginx
server {
  server_name order.hanyangpetro.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## 4. 운영 명령

```powershell
Push-Location 'C:\website\hanyangpetro-ops'
npm run deploy:build
npm run pm2:restart
pm2 logs hanyangpetro-ops
Pop-Location
```

## 5. 알림톡 발송 전환 메모

현재 배차 알림톡은 복사 방식입니다. 실제 발송 전환 시 `DispatchKakaoNoticeButton`의 메시지 템플릿을 그대로 서버 액션/API로 넘기고, 카카오 알림톡 발송 결과를 `OrderStatusHistory` 또는 별도 발송 로그 테이블에 기록하면 됩니다.