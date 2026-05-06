/**
 * Create CreditTransaction and CreditOverrideRequest tables in SQLite
 * Run after: node scripts/create-hanwha-tables.js
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
    const stmts = [
        `CREATE TABLE IF NOT EXISTS "CreditTransaction" (
      "id"          TEXT NOT NULL PRIMARY KEY,
      "customerId"  TEXT NOT NULL,
      "txDate"      DATETIME NOT NULL,
      "txType"      TEXT NOT NULL,
      "amount"      REAL NOT NULL,
      "source"      TEXT NOT NULL DEFAULT 'MANUAL',
      "orderId"     TEXT,
      "memo"        TEXT,
      "createdById" TEXT,
      "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CreditTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT,
      CONSTRAINT "CreditTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL
    )`,
        `CREATE INDEX IF NOT EXISTS "CreditTransaction_customerId_idx" ON "CreditTransaction"("customerId")`,
        `CREATE INDEX IF NOT EXISTS "CreditTransaction_txDate_idx" ON "CreditTransaction"("txDate")`,
        `CREATE INDEX IF NOT EXISTS "CreditTransaction_txType_idx" ON "CreditTransaction"("txType")`,
        `CREATE INDEX IF NOT EXISTS "CreditTransaction_orderId_idx" ON "CreditTransaction"("orderId")`,
        `CREATE TABLE IF NOT EXISTS "CreditOverrideRequest" (
      "id"                TEXT NOT NULL PRIMARY KEY,
      "orderId"           TEXT NOT NULL,
      "currentReceivable" REAL NOT NULL,
      "creditLimit"       REAL NOT NULL,
      "overAmount"        REAL NOT NULL,
      "status"            TEXT NOT NULL DEFAULT 'PENDING',
      "requestedById"     TEXT,
      "reviewedById"      TEXT,
      "reviewedAt"        DATETIME,
      "rejectReason"      TEXT,
      "createdAt"         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CreditOverrideRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE,
      CONSTRAINT "CreditOverrideRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE SET NULL,
      CONSTRAINT "CreditOverrideRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL
    )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "CreditOverrideRequest_orderId_key" ON "CreditOverrideRequest"("orderId")`,
        `CREATE INDEX IF NOT EXISTS "CreditOverrideRequest_status_idx" ON "CreditOverrideRequest"("status")`,
        `CREATE INDEX IF NOT EXISTS "CreditOverrideRequest_createdAt_idx" ON "CreditOverrideRequest"("createdAt")`,
    ];

    for (const s of stmts) {
        await p.$executeRawUnsafe(s);
        console.log('OK:', s.slice(0, 60).replace(/\s+/g, ' '));
    }

    const tables = await p.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    console.log('\nAll tables:', tables.map(t => t.name).join(', '));
    await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
