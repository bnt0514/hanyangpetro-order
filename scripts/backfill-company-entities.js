const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function isHanwhaProduct(product) {
    const manufacturer = product.manufacturer ?? '';
    const click2002ItemCode = product.click2002ItemCode ?? '';
    return manufacturer.includes('한화') || manufacturer.toLowerCase().includes('hanwha') || click2002ItemCode.trim().length > 0;
}

async function main() {
    const hanyang = await prisma.companyEntity.upsert({
        where: { code: 'HANYANG_PETRO' },
        update: {
            displayName: '한양유화',
            legalName: '주식회사 한양유화',
            isActive: true,
            isDefaultSales: true,
            isDefaultPurchase: true,
        },
        create: {
            code: 'HANYANG_PETRO',
            displayName: '한양유화',
            legalName: '주식회사 한양유화',
            isDefaultSales: true,
            isDefaultPurchase: true,
            memo: '한화 품목 기본 매입/매출 주체',
        },
    });

    const bnt = await prisma.companyEntity.upsert({
        where: { code: 'BNT' },
        update: {
            displayName: '비엔티',
            legalName: '비엔티',
            isActive: true,
        },
        create: {
            code: 'BNT',
            displayName: '비엔티',
            legalName: '비엔티',
            memo: '타사 품목 기본 매입/매출 주체',
        },
    });

    const products = await prisma.product.findMany({
        select: { id: true, manufacturer: true, category: true, click2002ItemCode: true },
    });

    let hanyangProducts = 0;
    let bntProducts = 0;
    for (const product of products) {
        const entity = isHanwhaProduct(product) ? hanyang : bnt;
        await prisma.product.update({
            where: { id: product.id },
            data: {
                brand: product.manufacturer ?? null,
                productGroup: product.category ?? null,
                defaultSalesEntityId: entity.id,
                defaultPurchaseEntityId: entity.id,
            },
        });
        if (entity.id === hanyang.id) hanyangProducts += 1;
        else bntProducts += 1;
    }

    const orderItems = await prisma.orderItem.findMany({
        where: { OR: [{ salesEntityId: null }, { purchaseEntityId: null }] },
        select: {
            id: true,
            product: { select: { defaultSalesEntityId: true, defaultPurchaseEntityId: true, manufacturer: true, click2002ItemCode: true } },
        },
    });

    let patchedItems = 0;
    for (const item of orderItems) {
        const fallback = isHanwhaProduct(item.product) ? hanyang.id : bnt.id;
        await prisma.orderItem.update({
            where: { id: item.id },
            data: {
                salesEntityId: item.product.defaultSalesEntityId ?? fallback,
                purchaseEntityId: item.product.defaultPurchaseEntityId ?? fallback,
            },
        });
        patchedItems += 1;
    }

    console.log(JSON.stringify({
        ok: true,
        companies: [hanyang.code, bnt.code],
        hanyangProducts,
        bntProducts,
        patchedItems,
    }, null, 2));
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });