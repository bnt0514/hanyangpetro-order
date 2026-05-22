-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "salesLedgerDate" DATETIME;
ALTER TABLE "OrderItem" ADD COLUMN "purchaseLedgerDate" DATETIME;

-- CreateIndex
CREATE INDEX "OrderItem_salesLedgerDate_idx" ON "OrderItem"("salesLedgerDate");
CREATE INDEX "OrderItem_purchaseLedgerDate_idx" ON "OrderItem"("purchaseLedgerDate");