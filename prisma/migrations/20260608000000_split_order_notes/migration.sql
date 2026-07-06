ALTER TABLE "DeliveryAddress" ADD COLUMN "defaultDriverCustomerNotice" TEXT;
ALTER TABLE "DeliveryAddress" ADD COLUMN "defaultOrderExtraRequest" TEXT;

ALTER TABLE "Order" ADD COLUMN "driverCustomerNotice" TEXT;
ALTER TABLE "Order" ADD COLUMN "orderExtraRequest" TEXT;

UPDATE "Order"
SET "orderExtraRequest" = "memo"
WHERE "memo" IS NOT NULL
  AND trim("memo") <> ''
  AND "orderExtraRequest" IS NULL;
