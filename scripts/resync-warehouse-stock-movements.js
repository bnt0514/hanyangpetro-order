const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const EFFECTIVE = new Set([
    'DISPATCH_COMPLETED',
    'SHIPPED',
]);

function normalizeCompanyName(value) {
    return String(value || '')
        .replace(/주식\s*회사/g, '')
        .replace(/\(주\)|㈜|\s|[()]/g, '')
        .trim();
}

function isWarehouseInboundCustomerName(value) {
    const normalized = normalizeCompanyName(value);
    return normalized === '한양유화' || normalized.includes('비엔티') || normalized.includes('BNT');
}

async function main() {
    const apply = process.argv.includes('--apply');
    const orders = await prisma.order.findMany({
        where: { deletedAt: null, status: { in: Array.from(EFFECTIVE) } },
        include: {
            customer: { select: { companyName: true } },
            dispatches: { select: { hanwhaQuantityTon: true } },
            items: { include: { product: { select: { productName: true, productCode: true } } } },
        },
    });

    let createCount = 0;
    const rows = [];
    for (const order of orders) {
        const orderQuantity = order.items.reduce((sum, item) => sum + item.requestedQuantity, 0);
        const dispatchedQuantity = order.dispatches.reduce((sum, dispatch) => sum + (dispatch.hanwhaQuantityTon || 0), 0);
        if (order.dispatches.length > 0 && dispatchedQuantity + 0.0001 < orderQuantity) continue;

        const internal = isWarehouseInboundCustomerName(order.customer.companyName);
        for (const item of order.items) {
            if (item.fulfillmentType !== 'WAREHOUSE') continue;
            const companyEntityId = internal ? item.purchaseEntityId : item.salesEntityId;
            if (!companyEntityId) continue;
            rows.push({
                companyEntityId,
                orderItemId: item.id,
                productId: item.productId,
                productCode: item.product.productCode,
                productName: item.product.productName,
                movementDate: order.requestedDeliveryDate || new Date(),
                movementType: internal ? 'IN' : 'OUT',
                quantity: item.requestedQuantity,
                unit: item.unit,
                sourceType: 'ORDER_WAREHOUSE_STOCK',
                memo: internal ? '창고 입고 수량 반영' : '창고 출고 수량 반영',
            });
        }
    }

    console.log(`${apply ? 'Applying' : 'Previewing'} warehouse movement resync`);
    console.log(`effective orders: ${orders.length}, movements to create: ${rows.length}`);
    if (!apply) return;

    await prisma.$transaction(async (tx) => {
        await tx.warehouseStockMovement.deleteMany({ where: { sourceType: { in: ['ORDER_DISPATCH_COMPLETED', 'ORDER_WAREHOUSE_STOCK'] } } });
        for (const row of rows) {
            await tx.warehouseStockMovement.create({ data: row });
            createCount += 1;
        }
    });
    console.log(`Done. created ${createCount} movements.`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
