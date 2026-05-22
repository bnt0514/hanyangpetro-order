/**
 * 매입 원장(LedgerEntry) 데이터에서 품목별 주거래 매입처를 분석하여
 * 60% 이상 점유율을 가진 매입처를 Product.defaultSupplierId에 저장합니다.
 *
 * 사용법:
 *   node scripts/apply-product-default-suppliers.js          # 드라이런 (변경 없음)
 *   node scripts/apply-product-default-suppliers.js --apply  # 실제 저장
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const THRESHOLD = 0.60; // 60%

async function main() {
    // 매입 원장 전체 조회 (supplierId 있는 것만)
    const entries = await prisma.ledgerEntry.findMany({
        where: {
            ledgerType: 'PURCHASE',
            supplierId: { not: null },
            productId: { not: null },
        },
        select: {
            productId: true,
            supplierId: true,
            quantity: true,
        },
    });

    console.log(`\n총 매입 원장 ${entries.length}건 분석 중...\n`);

    // 품목별 매입처별 수량 합산
    // Map<productId, Map<supplierId, totalQuantity>>
    const productSupplierQty = new Map();

    for (const entry of entries) {
        const pid = entry.productId;
        const sid = entry.supplierId;
        const qty = entry.quantity ?? 0;

        if (!productSupplierQty.has(pid)) productSupplierQty.set(pid, new Map());
        const supplierMap = productSupplierQty.get(pid);
        supplierMap.set(sid, (supplierMap.get(sid) ?? 0) + qty);
    }

    // 품목별 주거래처 결정
    const toUpdate = []; // { productId, supplierId, supplierName, ratio }
    const noMatch = [];

    const supplierIds = new Set([...entries.map(e => e.supplierId).filter(Boolean)]);
    const supplierNames = new Map();
    const suppliers = await prisma.supplier.findMany({
        where: { id: { in: [...supplierIds] } },
        select: { id: true, supplierName: true },
    });
    for (const s of suppliers) supplierNames.set(s.id, s.supplierName);

    const products = await prisma.product.findMany({
        where: { id: { in: [...productSupplierQty.keys()] } },
        select: { id: true, productName: true, defaultSupplierId: true },
    });
    const productMap = new Map(products.map(p => [p.id, p]));

    for (const [productId, supplierMap] of productSupplierQty.entries()) {
        const product = productMap.get(productId);
        if (!product) continue;

        const totalQty = [...supplierMap.values()].reduce((a, b) => a + b, 0);
        if (totalQty === 0) continue;

        // 점유율 높은 순 정렬
        const sorted = [...supplierMap.entries()].sort((a, b) => b[1] - a[1]);
        const [topSupplierId, topQty] = sorted[0];
        const ratio = topQty / totalQty;

        if (ratio >= THRESHOLD) {
            toUpdate.push({
                productId,
                productName: product.productName,
                supplierId: topSupplierId,
                supplierName: supplierNames.get(topSupplierId) ?? topSupplierId,
                ratio,
                totalQty,
                currentSupplierId: product.defaultSupplierId,
                changing: product.defaultSupplierId !== topSupplierId,
            });
        } else {
            noMatch.push({
                productId,
                productName: product.productName,
                totalQty,
                topSupplierName: supplierNames.get(topSupplierId) ?? topSupplierId,
                topRatio: ratio,
                supplierCount: supplierMap.size,
            });
        }
    }

    // 결과 출력
    console.log(`\n[주거래처 확정 (≥${THRESHOLD * 100}%)] - ${toUpdate.length}개 품목`);
    console.log('─'.repeat(90));
    for (const item of toUpdate) {
        const flag = item.changing ? (item.currentSupplierId ? '변경' : '신규') : '유지';
        console.log(
            `[${flag}] ${item.productName.padEnd(30)} → ${item.supplierName.padEnd(25)} (${(item.ratio * 100).toFixed(1)}%, ${item.totalQty.toFixed(1)}TON)`
        );
    }

    console.log(`\n[기준 미달 (분산 매입)] - ${noMatch.length}개 품목`);
    console.log('─'.repeat(90));
    for (const item of noMatch) {
        console.log(
            `  ${item.productName.padEnd(30)} 최다: ${item.toSupplierName ?? item.topSupplierName} (${(item.topRatio * 100).toFixed(1)}%, 공급처 ${item.supplierCount}곳)`
        );
    }

    const changes = toUpdate.filter(u => u.changing);
    console.log(`\n변경 대상: ${changes.length}건 / 기준 미달: ${noMatch.length}건`);

    if (!apply) {
        console.log('\n[드라이런] --apply 옵션을 추가하면 실제 저장됩니다.');
        await prisma.$disconnect();
        process.exit(0);
    }

    // 실제 저장
    let saved = 0;
    for (const item of toUpdate) {
        if (!item.changing) continue;
        await prisma.product.update({
            where: { id: item.productId },
            data: { defaultSupplierId: item.supplierId },
        });
        saved++;
    }

    console.log(`\n✅ ${saved}개 품목의 기본 매입처가 저장되었습니다.`);
    await prisma.$disconnect();
    process.exit(0);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
