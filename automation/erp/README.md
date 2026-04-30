# ERP Automation Adapters

이카운트와 클릭2002에 데이터를 흘려보내는 어댑터 레이어.

## 모드

| 모드          | 환경변수 `ERP_ADAPTER_MODE` | 용도                                                                  |
| ------------- | --------------------------- | --------------------------------------------------------------------- |
| `mock` (기본) | `mock`                      | 개발/시연용. 90% 성공/10% 실패 시뮬레이션.                            |
| `export`      | `export`                    | 배치를 JSON으로 떨어뜨림. 사무실 PC의 기존 Python 자동화가 watch.     |
| `real`        | `real`                      | (미구현, 2차 MVP) Node 자체에서 PyAutoGUI/Playwright로 ERP 직접 조작. |

## 사용

```typescript
import { pickBothAdapters } from '@/../automation/erp';

const { ecount, click2002 } = pickBothAdapters();

// 단일 항목 (mock)
const r1 = await ecount.runItem(item);

// 배치 export
const r2 = await ecount.exportBatch?.('2026-04-30', items);
```

## Export 모드 통합 흐름

```
[Node 본 시스템]                    [사무실 PC Python 자동화]
       │                                    │
       │  17:15 exportBatch()               │
       ├─→ inbox/ecount/2026-04-30_*.json   │
       │                                    │ watch
       │                                    │ 클릭2002/이카운트 자동 입력 실행
       │                                    │
       │  ←─── result/ecount/2026-04-30_*_result.json
       │       (batchId, items[].success/error)
       │                                    │
       │  watch + DB 업데이트                │
       ▼                                    │
   ErpInputItem.ecountStatus                │
```

`result/*.json` 형식 (Python이 떨어뜨릴 형식):
```json
{
  "adapter": "ecount",
  "batchDate": "2026-04-30",
  "completedAt": "2026-04-30T17:25:13+09:00",
  "items": [
    { "itemId": "abc...", "success": true, "externalRef": "EC-2026000123" },
    { "itemId": "def...", "success": false, "errorMessage": "거래처 코드 미매칭" }
  ]
}
```

본 시스템은 별도 watcher (`automation/erp/watch-results.ts`, 미작성)로 결과 파일을 폴링/inotify 하여 `ErpInputItem` 상태를 업데이트한다.

## 폴더 구조 (운영 PC)

```
C:\hanyang\automation\erp\
├─ inbox\
│   ├─ ecount\          ← Node가 export 한 파일
│   └─ click2002\
└─ result\              ← Python이 결과를 떨어뜨림
    ├─ ecount\
    └─ click2002\
```

`ERP_EXPORT_DIR` 환경변수로 경로 변경 가능.
