const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const EFFECTIVE = new Set([
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

function normalizeCompanyName(value) {
    return String(value || '')
        .replace(/주식\s*회사/g, '')
        .replace(/\(주\)|㈜|\s|[()]/g, '')
        .trim();
}

function isHanyangCustomerName(value) {
    return normalizeCompanyName(value) === '한양유화';
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

        const internal = isHanyangCustomerName(order.customer.companyName);
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
                sourceType: 'ORDER_DISPATCH_COMPLETED',
                memo: internal ? '한양유화 창고 입고 오더' : '창고 출고 오더',
            });
        }
    }

    console.log(`${apply ? 'Applying' : 'Previewing'} warehouse movement resync`);
    console.log(`effective orders: ${orders.length}, movements to create: ${rows.length}`);
    if (!apply) return;

    await prisma.$transaction(async (tx) => {
        await tx.warehouseStockMovement.deleteMany({ where: { sourceType: 'ORDER_DISPATCH_COMPLETED' } });
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
