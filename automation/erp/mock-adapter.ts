/**
 * Mock ERP adapters — 이카운트 / 클릭2002
 *
 * 개발/시연용. 실제 ERP를 건드리지 않고 90% 성공/10% 실패를 시뮬레이션.
 * 콘솔에 로그를 남기고 가짜 외부 참조 번호를 반환한다.
 */

import type { ErpAdapter, ErpItemPayload, ErpRunResult } from './interface';

function fakeRef(prefix: string) {
    const ts = Date.now().toString(36).toUpperCase();
    const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${prefix}-${ts}-${rnd}`;
}

function delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

function makeMockAdapter(name: 'ecount' | 'click2002'): ErpAdapter {
    return {
        name,
        mode: 'mock',
        async runItem(item: ErpItemPayload): Promise<ErpRunResult> {
            await delay(150 + Math.random() * 350);
            const ok = Math.random() > 0.1;
            const prefix = name === 'ecount' ? 'EC' : 'CL';
            if (ok) {
                const ref = fakeRef(prefix);
                // eslint-disable-next-line no-console
                console.log(`[mock:${name}] ✅ ${item.orderNo} ${item.productCode} ${item.quantity}${item.unit} → ${ref}`);
                return { success: true, externalRef: ref };
            } else {
                const errors = [
                    '거래처 코드 미매칭',
                    '품목 코드 미매칭',
                    '단가 미설정',
                    '세션 만료 - 재로그인 필요',
                    '동시 입력으로 인한 락 충돌',
                ];
                const errorMessage = errors[Math.floor(Math.random() * errors.length)];
                // eslint-disable-next-line no-console
                console.warn(`[mock:${name}] ❌ ${item.orderNo} → ${errorMessage}`);
                return { success: false, errorMessage };
            }
        },
    };
}

export const mockEcountAdapter = makeMockAdapter('ecount');
export const mockClick2002Adapter = makeMockAdapter('click2002');
