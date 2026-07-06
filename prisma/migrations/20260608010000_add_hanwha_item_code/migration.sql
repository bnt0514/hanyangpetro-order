ALTER TABLE "Product" ADD COLUMN "hanwhaItemCode" TEXT;

CREATE TABLE "HanwhaItemCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemName" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "salesItemId" TEXT,
    "plant" TEXT,
    "plantName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "HanwhaItemCode_itemName_key" ON "HanwhaItemCode"("itemName");
CREATE INDEX "HanwhaItemCode_itemCode_idx" ON "HanwhaItemCode"("itemCode");
