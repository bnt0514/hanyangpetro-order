-- Hanwha e-Sales order completion means the order is now waiting for dispatch matching.
UPDATE "Order"
SET "status" = 'DISPATCHING'
WHERE "deletedAt" IS NULL
  AND "status" = 'APPROVED'
  AND "hanwhaOrderedAt" IS NOT NULL;

INSERT INTO "OrderStatusHistory" ("id", "orderId", "previousStatus", "newStatus", "changeReason", "createdAt")
SELECT 'cm_dispatching_' || lower(hex(randomblob(12))),
       o."id",
       'APPROVED',
       'DISPATCHING',
       '[마이그레이션] 한화오더 완료 주문을 배차중으로 전환',
       CURRENT_TIMESTAMP
FROM "Order" o
WHERE o."deletedAt" IS NULL
  AND o."status" = 'DISPATCHING'
  AND o."hanwhaOrderedAt" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM "OrderStatusHistory" h
      WHERE h."orderId" = o."id"
        AND h."newStatus" = 'DISPATCHING'
        AND h."changeReason" = '[마이그레이션] 한화오더 완료 주문을 배차중으로 전환'
  );
