const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const PRICE_SCALE = 1000; // 첨부 표 3,160 => 시스템 기준 3,160,000원/TON

const HANWHA_PRICES = [
    ['LD_5301', 3160], ['RPE_R5301', 3590], ['LD_5302', 2910], ['LD_5306', 2760],
    ['LD_5316', 2790], ['LD_5320', 2790], ['LD_5321', 2740], ['LD_5321A', 2590],
    ['LD_5602', 3080], ['LD_5602S', 3340], ['LD_749', 3510], ['LD_830', 2980],
    ['LD_OG', 2740], ['LD_5303', 2900], ['LD_5310', 2860], ['LD_5318', 2640],
    ['LD_5325', 2700], ['LD_950', 2920], ['LD_955', 2800], ['LD_961', 2860],
    ['LD_963', 2830], ['LD_OG', 2640], ['LD_5321F', 2640], ['LD_5316F', 2640],
    ['LD_5322F', 2670], ['LD_303', 3310], ['LD_960', 2920], ['LD_724', 3380],
    ['LD_737', 2990], ['LD_737_LDH', 2910], ['LD_OG', 2695],
    ['EVA_2020', 2880], ['EVA_2030', 2890], ['EVA_2040', 2900], ['EVA_2050', 3070],
    ['EVA_2240', 3430], ['EVA_2250', 3430], ['EVA_2315', 3020], ['EVA_2815', 3590],
    ['EVA_OG', 2940], ['EVA_2319', 3020], ['EVA_1125', 3130], ['EVA_1157', 3070],
    ['EVA_1159', 3180], ['EVA_1315', 3020], ['EVA_1316', 3030], ['EVA_1317', 3080],
    ['EVA_1326', 3220], ['EVA_1328', 3480], ['EVA_1519', 3490], ['EVA_1520', 3490],
    ['EVA_1528', 3520], ['EVA_1529', 3520], ['EVA_1533', 3760], ['EVA_1540', 5810],
    ['EVA_1631', 3490], ['EVA_1815', 3590], ['EVA_1828', 3810], ['EVA_X1833', 4230],
    ['EVA_1834', 3680], ['EVA_OG', 2960], ['EVA_1340', 5890], ['EVA_1333', 4910],
    ['EVA_1334', 4510], ['EVA_1218', 3330], ['EVA_1214', 3330],
    ['LLD_3120', 2500], ['LLD_3123', 2500], ['LLD_3126', 2510], ['LLD_3127D', 2500],
    ['LLD_3224', 2500], ['RPE_R3224', 3070], ['LLD_4200D', 2600], ['LLD_4300N', 2780],
    ['LLD_4300S', 2740], ['LLD_7635', 2660], ['LLD_9730', 2710], ['LLD_9730D', 2740],
    ['LLD_2630', 2389], ['LLD_2640', 2389], ['LLD_2650', 2389], ['LLD_OG', 2342],
    ['LLD_X-8400', 3530], ['LD_M1835H', 2800], ['LD_M1810H', 2800], ['LD_M1810H', 2800],
    ['LD_M2010E', 2800], ['LD_M2010E', 2800], ['LD_M3505E', 2790], ['LD_M2703E', 2770],
    ['LLD_M1000', 2661], ['LD_M3707A', 2770], ['LD_M3705A', 2770], ['LD_M2710H', 2790],
    ['RPE_R2710', 2910], ['LD_M2535H', 2820], ['LD_M1605E', 2790], ['LD_3120MF', 2520],
    ['LLD_2558', 2520], ['V1408DN', 2800], ['V1408DC', 2800], ['LD_3121UV', 2520],
    ['LLD_3303', 2570], ['LLD_3304', 2500], ['LLD_3305', 2560], ['LLD_3306W', 2520],
    ['LLD_3322', 2600], ['LLD_3325W', 2580], ['LLD_8262', 2770], ['LLD_OG', 2340],
    ['HD_8380', 3370], ['HD_8380L', 3400], ['HD_OG', 2280], ['HD_3392', 2400],
    ['HD_3390', 2400], ['HD_3390UV', 2430], ['HD_7600', 2450], ['RPE_R7600', 3190],
    ['HD_OG', 2280], ['HD_7390', 2550],
];

function norm(value) {
    return String(value ?? '').toUpperCase().replace(/[<>()\s_\-./]/g, '');
}

function gradeFromHanwhaCode(code) {
    const raw = code.replace(/^RPE_/, '').replace(/^(LD|LLD|HD|EVA)_/, '');
    return raw.replace(/_/g, '');
}

function groupFromCode(code) {
    if (code.startsWith('EVA_')) return 'EVA';
    if (code.startsWith('HD_') || code === 'RPE_R7600') return 'HDPE';
    if (code.startsWith('LLD_') || code === 'RPE_R3224' || code.startsWith('V')) return 'LLDPE';
    if (code.startsWith('LD_M') || code.startsWith('LLD_M')) return 'MLLDPE';
    if (code.startsWith('LD_') || code === 'RPE_R5301' || code === 'RPE_R2710') return 'LDPE';
    return null;
}

function aliasesFor(code) {
    const grade = gradeFromHanwhaCode(code);
    const aliases = new Set([grade]);
    if (grade === 'OG') aliases.add(code.startsWith('LLD') ? 'LLDOG' : code.startsWith('HD') ? 'HDOG' : code.startsWith('EVA') ? 'EVAOG' : 'LDOG');
    if (grade === '737LDH') aliases.add('737LDH');
    if (grade === 'M1810H') { aliases.add('M1810HA'); aliases.add('M1810HN'); }
    if (grade === 'M1835H') aliases.add('M1835HN');
    if (grade === 'M2010E') { aliases.add('M2010EA'); aliases.add('M2010EP'); }
    if (grade === 'M3505E') aliases.add('M3505EN');
    if (grade === 'M2703E') aliases.add('M2703EN');
    if (grade === 'M2710H') aliases.add('M2710HN');
    if (grade === 'M2535H') aliases.add('M2535H');
    if (grade === 'M1605E') aliases.add('M1605EN');
    if (grade === 'X8400') aliases.add('X8400');
    return [...aliases].map(norm);
}

function productTokens(product) {
    const tokens = new Set();
    const name = String(product.productName ?? '');
    const code = String(product.productCode ?? '');
    const angle = name.match(/<([^>]+)>/);
    if (angle?.[1]) tokens.add(norm(angle[1]));
    tokens.add(norm(code));
    const item = code.match(/^ITEM[-_\s]?(.+)$/i);
    if (item?.[1]) tokens.add(norm(item[1]));
    return [...tokens];
}

function matchesProduct(code, product) {
    const group = groupFromCode(code);
    if (group && norm(product.category) !== norm(group)) return false;
    const aliases = aliasesFor(code);
    const tokens = productTokens(product);
    return aliases.some((alias) => tokens.some((token) => token === alias));
}

function productNameFromCode(code) {
    const group = groupFromCode(code) ?? '기타';
    const grade = gradeFromHanwhaCode(code);
    const label = group === 'MLLDPE' ? 'mLLDPE' : group;
    return `${label}<${grade}>`;
}

async function main() {
    const apply = process.argv.includes('--apply');
    const products = await prisma.product.findMany({ include: { productPrice: true } });
    const currentHanwha = products.filter((p) => p.manufacturer === '한화');
    const matchedProductIds = new Set();
    const report = [];

    const uniqueRows = [];
    const seen = new Map();
    for (const [code, price] of HANWHA_PRICES) {
        seen.set(code, price);
    }
    for (const [code, price] of seen.entries()) uniqueRows.push([code, price]);

    for (const [code, price] of uniqueRows) {
        const matches = products.filter((product) => matchesProduct(code, product));
        report.push({ code, price, matches });
        for (const product of matches) matchedProductIds.add(product.id);
    }

    console.log(`한화 단가표 ${HANWHA_PRICES.length}행 / 중복 정리 ${uniqueRows.length}행`);
    console.log(`매칭 제품 ${matchedProductIds.size}개`);
    console.log('\nUNMATCHED');
    for (const row of report.filter((r) => r.matches.length === 0)) console.log(`${row.code}\t${row.price}`);
    console.log('\nMATCHED');
    for (const row of report.filter((r) => r.matches.length > 0)) {
        console.log(`${row.code}\t${row.price}\t=>\t${row.matches.map((p) => `${p.productName}/${p.productCode}/${p.manufacturer ?? '-'}/${p.productPrice?.basePrice ?? 0}`).join(' | ')}`);
    }
    console.log('\nCURRENT_HANWHA_NOT_IN_TABLE');
    for (const product of currentHanwha.filter((p) => !matchedProductIds.has(p.id))) {
        console.log(`${product.productName}\t${product.productCode}\t${product.category}`);
    }

    if (!apply) {
        console.log('\nDry-run only. Unmatched rows will be created as new Hanwha products when running with --apply.');
        console.log('Run with --apply to update DB.');
        return;
    }

    await prisma.$transaction(async (tx) => {
        for (const product of currentHanwha.filter((p) => !matchedProductIds.has(p.id))) {
            await tx.product.update({ where: { id: product.id }, data: { manufacturer: null } });
        }
        for (const row of report) {
            const basePrice = row.price * PRICE_SCALE;
            if (row.matches.length === 0) {
                const group = groupFromCode(row.code) ?? '기타';
                const product = await tx.product.upsert({
                    where: { productCode: row.code },
                    update: {
                        productName: productNameFromCode(row.code),
                        manufacturer: '한화',
                        category: group,
                        isActive: true,
                    },
                    create: {
                        productCode: row.code,
                        productName: productNameFromCode(row.code),
                        manufacturer: '한화',
                        category: group,
                        isActive: true,
                    },
                });
                await tx.productPrice.upsert({
                    where: { productId: product.id },
                    update: { basePrice, memo: `한화 첨부 단가표 ${row.code} (${row.price.toLocaleString()} × 1,000원/TON)` },
                    create: { productId: product.id, basePrice, memo: `한화 첨부 단가표 ${row.code} (${row.price.toLocaleString()} × 1,000원/TON)` },
                });
                continue;
            }
            for (const product of row.matches) {
                await tx.product.update({ where: { id: product.id }, data: { manufacturer: '한화' } });
                await tx.productPrice.upsert({
                    where: { productId: product.id },
                    update: { basePrice, memo: `한화 첨부 단가표 ${row.code} (${row.price.toLocaleString()} × 1,000원/TON)` },
                    create: { productId: product.id, basePrice, memo: `한화 첨부 단가표 ${row.code} (${row.price.toLocaleString()} × 1,000원/TON)` },
                });
            }
        }
    });
    console.log('\nApplied.');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
