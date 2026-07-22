ALTER TABLE "Customer" ADD COLUMN "defaultDriverCustomerNotice" TEXT;
ALTER TABLE "Customer" ADD COLUMN "defaultOrderExtraRequest" TEXT;

UPDATE "Customer"
SET "defaultDriverCustomerNotice" = (
  SELECT "DeliveryAddress"."defaultDriverCustomerNotice"
  FROM "DeliveryAddress"
  WHERE "DeliveryAddress"."customerId" = "Customer"."id"
    AND "DeliveryAddress"."defaultDriverCustomerNotice" IS NOT NULL
  ORDER BY "DeliveryAddress"."isDefault" DESC, "DeliveryAddress"."label" ASC
  LIMIT 1
)
WHERE "defaultDriverCustomerNotice" IS NULL;

UPDATE "Customer"
SET "defaultOrderExtraRequest" = (
  SELECT "DeliveryAddress"."defaultOrderExtraRequest"
  FROM "DeliveryAddress"
  WHERE "DeliveryAddress"."customerId" = "Customer"."id"
    AND "DeliveryAddress"."defaultOrderExtraRequest" IS NOT NULL
  ORDER BY "DeliveryAddress"."isDefault" DESC, "DeliveryAddress"."label" ASC
  LIMIT 1
)
WHERE "defaultOrderExtraRequest" IS NULL;
