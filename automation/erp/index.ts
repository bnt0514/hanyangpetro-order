/**
 * ERP Adapter Selector
 *
 * 환경변수 `ERP_ADAPTER_MODE` 에 따라 어댑터를 선택한다:
 *   mock   (default) — 개발/시연용
 *   export           — 사무실 PC + Python 자동화 통합 (운영 권장 시작점)
 *   real             — Node 직접 자동화 (미구현, 2차 MVP)
 */

import type { ErpAdapter } from './interface';
import { mockEcountAdapter, mockClick2002Adapter } from './mock-adapter';
import { exportEcountAdapter, exportClick2002Adapter } from './export-adapter';

type AdapterName = 'ecount' | 'click2002';
type Mode = 'mock' | 'export' | 'real';

export function pickAdapter(name: AdapterName, mode?: Mode): ErpAdapter {
    const m: Mode = (mode ?? (process.env.ERP_ADAPTER_MODE as Mode) ?? 'mock');
    if (m === 'mock') {
        return name === 'ecount' ? mockEcountAdapter : mockClick2002Adapter;
    }
    if (m === 'export') {
        return name === 'ecount' ? exportEcountAdapter : exportClick2002Adapter;
    }
    if (m === 'real') {
        throw new Error(`ERP adapter mode 'real' not implemented yet. Use 'mock' or 'export'.`);
    }
    throw new Error(`Unknown ERP_ADAPTER_MODE: ${m}`);
}

export function pickBothAdapters(mode?: Mode) {
    return {
        ecount: pickAdapter('ecount', mode),
        click2002: pickAdapter('click2002', mode),
    };
}
