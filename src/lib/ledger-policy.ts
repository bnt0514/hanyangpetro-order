const LEDGER_REFLECTED_ORDER_STATUSES = [
    'DISPATCH_COMPLETED',
    'SHIPPED',
];

export const LEDGER_DISPATCH_COMPLETED_WHERE = {
    status: {
        in: LEDGER_REFLECTED_ORDER_STATUSES,
    },
};

export function ledgerSalesDate(item: { salesLedgerDate: Date | null; order: { requestedDeliveryDate: Date | null } }) {
    return item.salesLedgerDate ?? item.order.requestedDeliveryDate;
}

export function ledgerPurchaseDate(item: { purchaseLedgerDate: Date | null }) {
    return item.purchaseLedgerDate;
}

export function purchaseRequestDateFromOrderNo(orderNo: string | null | undefined) {
    const match = /^HY-(\d{2})(\d{2})(\d{2})-/.exec(orderNo ?? '');
    if (!match) return null;
    const year = Number(`20${match[1]}`);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, monthIndex, day);
    return Number.isNaN(date.getTime()) ? null : date;
}
