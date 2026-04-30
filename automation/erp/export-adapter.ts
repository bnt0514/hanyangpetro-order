/**
 * Export ERP adapters — 이카운트 / 클릭2002
 *
 * 배치를 JSON 파일로 떨어뜨리는 모드. 기존 사무실 PC의 Python 자동화 8개가
 * `ERP_EXPORT_DIR/inbox/` 를 watch 하여 처리하고, 결과를
 * `ERP_EXPORT_DIR/result/` 에 떨어뜨리면 본 시스템이 다시 watch 해서 흡수한다.
 *
 * 가장 안전한 통합 방식 — 기존 자동화 코드를 거의 그대로 재사용 가능.
 * docs/06-erp-daily-closing-flow.md §9 옵션 A 참조.
 */

import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type { ErpAdapter, ErpExportResult, ErpItemPayload, ErpRunResult } from './interface';

const EXPORT_DIR = process.env.ERP_EXPORT_DIR || 'C:\\hanyang\\automation\\erp\\inbox';

function makeExportAdapter(name: 'ecount' | 'click2002'): ErpAdapter {
    return {
        name,
        mode: 'export',
        /**
         * Export 모드에서 runItem 단일 호출은 의미 없다.
         * 항상 PENDING 으로 표시하고 exportBatch 를 사용해야 한다.
         */
        async runItem(item: ErpItemPayload): Promise<ErpRunResult> {
            return {
                success: false,
                errorMessage: 'Export mode: use exportBatch() instead of runItem()',
            };
        },
        async exportBatch(batchDate: string, items: ErpItemPayload[]): Promise<ErpExportResult> {
            const dir = join(EXPORT_DIR, name);
            await mkdir(dir, { recursive: true });
            const file = join(dir, `${batchDate}_${name}_${Date.now()}.json`);
            const payload = {
                adapter: name,
                batchDate,
                generatedAt: new Date().toISOString(),
                itemCount: items.length,
                items,
            };
            await writeFile(file, JSON.stringify(payload, null, 2), 'utf-8');
            // eslint-disable-next-line no-console
            console.log(`[export:${name}] 📤 ${items.length} items → ${file}`);
            return { success: true, filePath: file, itemCount: items.length };
        },
    };
}

export const exportEcountAdapter = makeExportAdapter('ecount');
export const exportClick2002Adapter = makeExportAdapter('click2002');
