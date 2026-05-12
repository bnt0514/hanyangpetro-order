const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// 두 번째 첨부 이미지 기준 브랜드 보정표.
// 규칙: brand === 'n' 은 무시, 빈칸은 한화로 해석 가능하나 기존 한화 단가표 작업과 중복되므로
// 이 스크립트는 이미지에서 명확히 브랜드명이 적힌 행만 추가 보정한다.
const BRAND_OVERRIDES = [
    ['HI100', 'LG'],
    ['220F', '도람'],
    ['VC640', '도람'],
    ['125N', '금호'],
    ['158K', '금호'],
    ['2700J', '롯데'],
    ['5502', '대한'],
    ['6060HF', 'GS'],
    ['8380', 'SK'],
    ['B230A', '롯데'],
    ['F120A', '도람'],
    ['XF07A', 'GS'],
    ['XF 07A', 'GS'],
    ['xf07a', 'GS'],
    ['xf 07a', 'GS'],
    ['XF07AOA', 'GS'],
    ['XF07A OA', 'GS'],
    ['BF415', '롯데'],
    ['955(750b)', 'LG'],
    ['955F/B', 'LG'],
    ['UR654', '롯데'],
    ['3300', '대한'],
    ['3300OG', '대한'],
    ['3300 OG', '대한'],
    ['3300OGB', '대한'],
    ['3300en OG', '대한'],
    ['J801R', 'LG'],
    ['BJ500', '롯데'],
    ['M1400', '대한'],
    ['m710', '대한'],
    ['RP344NK', '대한'],
    ['344NK', '대한'],
    ['RP344RK', '대한'],
    ['344RK', '대한'],
    ['E182L', '도람'],
    ['182l', '도람'],
    ['E182', '도람'],
    ['H5604F', '롯데'],
    ['h5604f', '롯데'],
    ['ITEM-5604', '롯데'],
    ['E287PV', '도람'],
    ['e287pv', '도람'],
    ['e287', '도람'],
    ['5078', 'n'],
    ['8835h', 'n'],
    ['2630', 'n'],
    ['4210', 'n'],
    ['M710', '대한'],
    ['19010', 'n'],
    ['19010MF', 'n'],
    ['3108', 'n'],
    ['3108bm', 'n'],
    ['KTR602', 'n'],
    ['ktr 602', 'n'],
    ['KTR602P', 'n'],
    ['602p', 'n'],
    ['ktr 602p', 'n'],
];

function normalize(value) {
    return String(value ?? '').toUpperCase().replace(/[<>()\s_\-./]/g, '');
}

function tokens(product) {
    const values = [product.productCode, product.productName];
    const angle = String(product.productName ?? '').match(/<([^>]+)>/);
    if (angle?.[1]) values.push(angle[1]);
    const item = String(product.productCode ?? '').match(/^ITEM[-_\s]?(.+)$/i);
    if (item?.[1]) values.push(item[1]);
    return values.map(normalize).filter(Boolean);
}

async function main() {
    const apply = process.argv.includes('--apply');
    const products = await prisma.product.findMany({ select: { id: true, productCode: true, productName: true, manufacturer: true, category: true } });
    const updates = [];
    const skipped = [];

    for (const [rawCode, brand] of BRAND_OVERRIDES) {
        if (brand === 'n') {
            skipped.push([rawCode, brand, 'n']);
            continue;
        }
        const key = normalize(rawCode);
        const matches = products.filter((product) => tokens(product).includes(key));
        if (matches.length === 0) {
            skipped.push([rawCode, brand, 'not-found']);
            continue;
        }
        for (const product of matches) {
            updates.push({ product, brand, rawCode });
        }
    }

    const unique = new Map();
    for (const update of updates) {
        unique.set(`${update.product.id}:${update.brand}`, update);
    }
    const finalUpdates = [...unique.values()].filter(({ product, brand }) => product.manufacturer !== brand);

    console.log(`BRAND_ROWS=${BRAND_OVERRIDES.length}`);
    console.log(`UPDATE_TARGETS=${finalUpdates.length}`);
    for (const { product, brand, rawCode } of finalUpdates) {
        console.log(`UPDATE\t${rawCode}\t${product.productCode}\t${product.productName}\t${product.manufacturer ?? '-'} => ${brand}`);
    }
    console.log(`SKIPPED=${skipped.length}`);
    for (const row of skipped) console.log(`SKIP\t${row.join('\t')}`);

    if (!apply) {
        console.log('Dry-run only. Run with --apply to update DB.');
        return;
    }

    await prisma.$transaction(
        finalUpdates.map(({ product, brand }) =>
            prisma.product.update({ where: { id: product.id }, data: { manufacturer: brand } }),
        ),
    );
    console.log('Applied.');
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
