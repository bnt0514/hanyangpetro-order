const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const snapshotDate = new Date('2026-05-29T00:00:00');
const stocks = [
    ['HDPE<50100>', 0],
    ['EVA<1159>', 0],
    ['EVA<2315>', 0.525],
    ['EVA<1328>', 0],
    ['LLDPE<7635>', 0],
    ['LDPE<5321>', 3.4],
    ['LDPE<5301>', 1.2],
    ['LDPE<5303>', 0],
    ['LDPE<737>', 3.175],
    ['LDPE<749>', 1],
    ['HDPE<7600>', 1],
    ['EVA<2030>', 0.05],
    ['EVA<2250>', 0],
    ['LDPE<ME8000>', 0],
    ['P.P<J801R>', 0],
    ['HDPE<5502>', 1],
    ['LDPE<MB9500>', 1],
    ['TR570', 0.875],
    ['HDPE<8380L>', 0],
    ['LLDPE<1810HC>', 0],
    ['LLDPE<UF317>', 2],
    ['LLDPE<3127D>', 2],
    ['P.P<M710>', 6],
    ['ABS<HI100>', 0],
    ['LDPE<5320>', 0],
    ['ABS<SD0170>', 0],
];

function normalize(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/p\.p/g, 'pp')
        .replace(/[^0-9a-z가-힣]+/g, '')
        .trim();
}

function canonicalCode(productName) {
    return String(productName)
        .replace(/P\.P/gi, 'PP')
        .replace(/[<>]/g, '_')
        .replace(/[^a-zA-Z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();
}

async function main() {
    const apply = process.argv.includes('--apply');
    const company = await prisma.companyEntity.findFirst({ where: { code: 'HANYANG_PETRO' } });
    if (!company) throw new Error('HANYANG_PETRO company entity not found');

    let products = await prisma.product.findMany({ select: { id: true, productCode: true, productName: true } });
    const productByNorm = () => new Map(products.map((product) => [normalize(product.productName), product]));

    console.log(`${apply ? 'Applying' : 'Previewing'} ${stocks.length} warehouse stock snapshots for ${company.displayName}`);
    for (const [productName, quantity] of stocks) {
        const productCode = canonicalCode(productName);
        let product = productByNorm().get(normalize(productName));
        console.log(`${productName.padEnd(16)} ${String(quantity).padStart(8)} TON ${product ? `-> ${product.productName}` : `-> create ${productCode}`}`);
        if (!apply) continue;

        if (!product) {
            product = await prisma.product.upsert({
                where: { productCode },
                update: { productName, isActive: true },
                create: { productCode, productName, isActive: true },
                select: { id: true, productCode: true, productName: true },
            });
            products = [...products, product];
        }

        await prisma.warehouseStockSnapshot.upsert({
            where: {
                companyEntityId_productName_snapshotDate: {
                    companyEntityId: company.id,
                    productName,
                    snapshotDate,
                },
            },
            update: {
                productId: product.id,
                productCode,
                productName,
                quantity,
                unit: 'TON',
                memo: '2026-05-29 현재 창고 재고 기준 스냅샷',
            },
            create: {
                companyEntityId: company.id,
                productId: product.id,
                productCode,
                productName,
                snapshotDate,
                quantity,
                unit: 'TON',
                memo: '2026-05-29 현재 창고 재고 기준 스냅샷',
            },
        });
    }
    console.log(apply ? 'Done.' : 'Preview only. Run with --apply to save.');
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
