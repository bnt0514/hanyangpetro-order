ALTER TABLE "Order" ADD COLUMN "sameDayDelivery" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Order_sameDayDelivery_idx" ON "Order"("sameDayDelivery");
