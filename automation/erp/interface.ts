/**
 * ERP Adapter Interface — 이카운트 + 클릭2002
 *
 * MVP 전략 (docs/06-erp-daily-closing-flow.md §5):
 *   Mode A — Mock      : 90% 성공/10% 실패 시뮬레이션 (개발/시연용)
 *   Mode B — Export    : 배치를 JSON/CSV로 떨어뜨림 → 기존 Python 자동화가 watch
 *   Mode C — Real      : Node에서 직접 자동화 (2차 MVP, 추후)
 *
 * 사용 예:
 *   const adapter = pickAdapter('ecount');   // env 기반 자동 선택
 *   const result = await adapter.runItem(item);
 */

export interface ErpItemPayload {
    itemId: string;            // ErpInputItem.id
    orderId: string;           // Order.id
    orderNo: string;
    customerCode: string;
    customerName: string;
    productCode: string;       // Product.ecountItemCode 또는 click2002ItemCode
    productName: string;
    quantity: string;          // decimal as string (정밀도 보존)
    unit: 'KG' | 'TON';
    unitPrice?: string;
    shipDate: string;          // YYYY-MM-DD
    deliveryAddress: string;
    memo?: string;
}

export interface ErpRunResult {
    success: boolean;
    externalRef?: string;      // ERP 측 생성된 전표 번호
    errorMessage?: string;
    raw?: unknown;             // 디버깅용 원시 응답
}

export interface ErpExportResult {
    success: boolean;
    filePath: string;
    itemCount: number;
}

export interface ErpAdapter {
    readonly name: 'ecount' | 'click2002';
    readonly mode: 'mock' | 'export' | 'real';
    /** 항목 1건 실행 */
    runItem(item: ErpItemPayload): Promise<ErpRunResult>;
    /** 배치 단위 export (Python 자동화에 넘기는 모드) */
    exportBatch?(batchDate: string, items: ErpItemPayload[]): Promise<ErpExportResult>;
}
