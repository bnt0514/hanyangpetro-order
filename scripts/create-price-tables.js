/**
 * 단가 시스템 + 여신 시뮬레이션 DB 추가
 * - ProductPrice 테이블 (제품별 기준 단가)
 * - PriceAdjustment 테이블 (월별 브랜드/제품군 조정값)
 * - Order.estimatedAmount 컬럼 추가
 * - OrderItem.estimatedUnitPrice 컬럼 추가
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    // 1. ProductPrice
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ProductPrice" (
      "id"          TEXT NOT NULL PRIMARY KEY,
      "productId"   TEXT NOT NULL UNIQUE,
      "basePrice"   REAL NOT NULL DEFAULT 0,
      "memo"        TEXT,
      "updatedById" TEXT,
      "updatedAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ProductPrice_productId_fkey"
        FOREIGN KEY ("productId") REFERENCES "Product"("id")
    )
  `);
    console.log('✅ ProductPrice 테이블 생성');

    // 2. PriceAdjustment
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PriceAdjustment" (
      "id"             TEXT NOT NULL PRIMARY KEY,
      "effectiveMonth" TEXT NOT NULL,
      "brand"          TEXT NOT NULL,
      "productGroup"   TEXT NOT NULL,
      "delta"          REAL NOT NULL DEFAULT 0,
      "memo"           TEXT,
      "createdById"    TEXT,
      "createdAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE("effectiveMonth", "brand", "productGroup")
    )
  `);
    await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PriceAdjustment_effectiveMonth_idx"
    ON "PriceAdjustment"("effectiveMonth")
  `);
    await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PriceAdjustment_brand_productGroup_idx"
    ON "PriceAdjustment"("brand", "productGroup")
  `);
    console.log('✅ PriceAdjustment 테이블 생성');

    // 3. Order.estimatedAmount 컬럼 (없으면 추가)
    try {
        await prisma.$executeRawUnsafe(`
      ALTER TABLE "Order" ADD COLUMN "estimatedAmount" REAL
    `);
        console.log('✅ Order.estimatedAmount 컬럼 추가');
    } catch {
        console.log('ℹ️  Order.estimatedAmount 이미 존재');
    }

    // 4. OrderItem.estimatedUnitPrice 컬럼 (없으면 추가)
    try {
        await prisma.$executeRawUnsafe(`
      ALTER TABLE "OrderItem" ADD COLUMN "estimatedUnitPrice" REAL
    `);
        console.log('✅ OrderItem.estimatedUnitPrice 컬럼 추가');
    } catch {
        console.log('ℹ️  OrderItem.estimatedUnitPrice 이미 존재');
    }

    console.log('\n🎉 DB 마이그레이션 완료');
}

run()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
