ALTER TABLE "Order" ADD COLUMN "hanwhaStatusText" TEXT;
ALTER TABLE "Order" ADD COLUMN "hanwhaStatusRowText" TEXT;
ALTER TABLE "Order" ADD COLUMN "hanwhaStatusCheckedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "hanwhaStatusSource" TEXT;
ALTER TABLE "Order" ADD COLUMN "hanwhaStatusManualApprovedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "hanwhaStatusManualApprovedById" TEXT;

CREATE INDEX "Order_hanwhaStatusText_idx" ON "Order"("hanwhaStatusText");
CREATE INDEX "Order_hanwhaStatusCheckedAt_idx" ON "Order"("hanwhaStatusCheckedAt");
