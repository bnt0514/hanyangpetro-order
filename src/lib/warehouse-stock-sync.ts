import { Prisma } from '@prisma/client';

const STOCK_EFFECTIVE_STATUSES = new Set([
    'DISPATCH_COMPLETED',
    'SHIPPED',
    'DELIVERY_CONFIRM_PENDING',
    'DELIVERY_CONFIRMED',
    'ERP_INPUT_WAITING',
    'ERP_INPUT_COMPLETED',
    'INVOICE_WAITING',
    'INVOICE_COMPLETED',
    'COMPLETED',
]);

function normalizeCompanyName(value: string | null | undefined) {
    return (value ?? '')
        .replace(/주식\s*회사/g, '')
        .replace(/\(주\)|㈜|\s|[()]/g, '')
        .trim();
}

function isWarehouseInboundCustomerName(value: string | null | undefined) {
    const normalized = normalizeCompanyName(value);
    return normalized === '한양유화' || normalized.includes('비엔티') || normalized.includes('BNT');
}

export async function syncOrderWarehouseStockMovements(tx: Prisma.TransactionClient, orderId: string) {
    const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
            customer: { select: { companyName: true } },
            items: {
                include: {
                    product: { select: { productName: true, productCode: true } },
                },
            },
            dispatches: { select: { hanwhaQuantityTon: true } },
        },
    });
    if (!order) return;

    const itemIds = order.items.map((item) => item.id);
    const db = tx as Prisma.TransactionClient & {
        warehouseStockMovement: {
            deleteMany: (args: unknown) => Promise<unknown>;
            create: (args: unknown) => Promise<unknown>;
        };
    };

    if (itemIds.length > 0) {
        await db.warehouseStockMovement.deleteMany({ where: { orderItemId: { in: itemIds } } });
    }

    if (order.deletedAt) return;
    const internalPurchaseOnly = isWarehouseInboundCustomerName(order.customer.companyName);
    if (!STOCK_EFFECTIVE_STATUSES.has(order.status)) return;

    const orderQuantity = order.items.reduce((sum, item) => sum + item.requestedQuantity, 0);
    const dispatchedQuantity = order.dispatches.reduce((sum, dispatch) => sum + (dispatch.hanwhaQuantityTon ?? 0), 0);
    if (order.dispatches.length > 0 && dispatchedQuantity + 0.0001 < orderQuantity) return;

    const movementDate = order.requestedDeliveryDate ?? new Date();

    for (const item of order.items) {
        const fulfillmentType = (item as typeof item & { fulfillmentType?: string | null }).fulfillmentType;
        if (fulfillmentType !== 'WAREHOUSE') continue;

        const companyEntityId = internalPurchaseOnly
            ? item.purchaseEntityId
            : item.salesEntityId;
        if (!companyEntityId) continue;

        await db.warehouseStockMovement.create({
            data: {
                companyEntityId,
                orderItemId: item.id,
                productId: item.productId,
                productCode: item.product.productCode,
                productName: item.product.productName,
                movementDate,
                movementType: internalPurchaseOnly ? 'IN' : 'OUT',
                quantity: item.requestedQuantity,
                unit: item.unit,
                sourceType: 'ORDER_WAREHOUSE_STOCK',
                memo: internalPurchaseOnly ? '창고 입고 수량 반영' : '창고 출고 수량 반영',
            },
        });
    }
}
