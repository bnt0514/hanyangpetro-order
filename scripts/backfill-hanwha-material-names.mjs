import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

function normalizeBag(value) {
    return value && /^(FFS|FB500|FB700|FB750)$/i.test(value) ? value.toUpperCase() : 'FFS';
}

function inferMaterial(product) {
    const existing = product.hanwhaMaterialName?.trim();
    if (existing) return existing;

    const candidates = [product.productCode, product.productName, product.memo]
        .filter(Boolean)
        .map((value) => String(value).trim());
    const mf = candidates.find((value) => /^MF_/i.test(value));
    if (mf) return mf;

    const text = `${product.productName} ${product.productCode ?? ''}`;
    if (!/\b(m?LLDPE|LDPE|EVA)\b/i.test(text)) return null;
    const grade = text.match(/<\s*([^>]+)\s*>/)?.[1] ?? text.match(/\b\d{3,4}\b/)?.[0];
    if (!grade) return null;

    const bag = normalizeBag(product.packagingType);
    return `MF_LD_${grade}_${bag}_LD2`;
}

try {
    const products = await prisma.product.findMany({
        where: { isActive: true },
        select: {
            id: true,
            productCode: true,
            productName: true,
            packagingType: true,
            memo: true,
            hanwhaMaterialName: true,
        },
        orderBy: { productName: 'asc' },
    });

    const targets = products
        .map((product) => ({ product, materialName: inferMaterial(product) }))
        .filter(({ product, materialName }) => materialName && product.hanwhaMaterialName !== materialName);

    console.log(`hanwha material targets: ${targets.length}`);
    for (const { product, materialName } of targets) {
        console.log(`${product.productName} (${product.productCode}) -> ${materialName}`);
    }

    if (apply) {
        for (const { product, materialName } of targets) {
            await prisma.product.update({
                where: { id: product.id },
                data: { hanwhaMaterialName: materialName },
            });
        }
        console.log(`updated: ${targets.length}`);
    } else {
        console.log('preview only. run with --apply to update products.');
    }
} finally {
    await prisma.$disconnect();
}
