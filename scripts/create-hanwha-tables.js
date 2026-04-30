const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
    const stmts = [
        `CREATE TABLE IF NOT EXISTS "HanwhaDispatchSnapshot" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "dispatchDate" DATETIME NOT NULL,
      "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "fetchedByUserId" TEXT,
      "status" TEXT NOT NULL DEFAULT 'OK',
      "rowCount" INTEGER NOT NULL DEFAULT 0,
      "errorMessage" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "HanwhaDispatchSnapshot_dispatchDate_key" ON "HanwhaDispatchSnapshot"("dispatchDate")`,
        `CREATE INDEX IF NOT EXISTS "HanwhaDispatchSnapshot_dispatchDate_idx" ON "HanwhaDispatchSnapshot"("dispatchDate")`,
        `CREATE TABLE IF NOT EXISTS "HanwhaDispatchRow" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "snapshotId" TEXT NOT NULL,
      "indoChiIndex" INTEGER NOT NULL,
      "indoChiName" TEXT NOT NULL,
      "materialNameRaw" TEXT,
      "materialName" TEXT,
      "quantityKg" REAL,
      "rawCells" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "HanwhaDispatchRow_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "HanwhaDispatchSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`,
        `CREATE INDEX IF NOT EXISTS "HanwhaDispatchRow_snapshotId_idx" ON "HanwhaDispatchRow"("snapshotId")`,
        `CREATE INDEX IF NOT EXISTS "HanwhaDispatchRow_indoChiName_idx" ON "HanwhaDispatchRow"("indoChiName")`,
        `CREATE INDEX IF NOT EXISTS "HanwhaDispatchRow_materialName_idx" ON "HanwhaDispatchRow"("materialName")`,
        `CREATE TABLE IF NOT EXISTS "SystemSetting" (
      "key" TEXT NOT NULL PRIMARY KEY,
      "value" TEXT NOT NULL,
      "description" TEXT,
      "updatedById" TEXT,
      "updatedAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    ];
    for (const s of stmts) {
        await p.$executeRawUnsafe(s);
        console.log('OK:', s.slice(0, 60).replace(/\s+/g, ' '));
    }
    const tables = await p.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    console.log('\nTables now:', tables.map(t => t.name).join(', '));
    await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
