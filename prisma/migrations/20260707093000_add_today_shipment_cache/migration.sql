CREATE TABLE "HanwhaTodayShipmentSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderDate" DATETIME NOT NULL,
    "targetDeliveryDate" DATETIME NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetchedByUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "HanwhaTodayShipmentRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "orderNo" TEXT,
    "shipToName" TEXT,
    "statusText" TEXT NOT NULL,
    "deliveryDateYmd" TEXT,
    "rawCells" TEXT NOT NULL,
    "rowText" TEXT,
    "detailLines" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HanwhaTodayShipmentRow_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "HanwhaTodayShipmentSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "HanwhaTodayShipmentSnapshot_orderDate_idx" ON "HanwhaTodayShipmentSnapshot"("orderDate");
CREATE INDEX "HanwhaTodayShipmentSnapshot_targetDeliveryDate_idx" ON "HanwhaTodayShipmentSnapshot"("targetDeliveryDate");
CREATE UNIQUE INDEX "HanwhaTodayShipmentSnapshot_orderDate_targetDeliveryDate_key" ON "HanwhaTodayShipmentSnapshot"("orderDate", "targetDeliveryDate");
CREATE INDEX "HanwhaTodayShipmentRow_snapshotId_idx" ON "HanwhaTodayShipmentRow"("snapshotId");
CREATE INDEX "HanwhaTodayShipmentRow_shipToName_idx" ON "HanwhaTodayShipmentRow"("shipToName");
CREATE INDEX "HanwhaTodayShipmentRow_deliveryDateYmd_idx" ON "HanwhaTodayShipmentRow"("deliveryDateYmd");
CREATE INDEX "HanwhaTodayShipmentRow_statusText_idx" ON "HanwhaTodayShipmentRow"("statusText");
