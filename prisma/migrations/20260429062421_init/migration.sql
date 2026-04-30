-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "phone" TEXT,
    "role" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "backupUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_backupUserId_fkey" FOREIGN KEY ("backupUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerCode" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "businessNumber" TEXT,
    "defaultSalesRepId" TEXT,
    "creditLimit" REAL NOT NULL DEFAULT 0,
    "paymentTerms" TEXT,
    "receivableAmount" REAL NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Customer_defaultSalesRepId_fkey" FOREIGN KEY ("defaultSalesRepId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeliveryAddress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "postalCode" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeliveryAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productCode" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "manufacturer" TEXT,
    "grade" TEXT,
    "packagingType" TEXT,
    "category" TEXT,
    "ecountItemCode" TEXT,
    "click2002ItemCode" TEXT,
    "defaultSupplierId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_defaultSupplierId_fkey" FOREIGN KEY ("defaultSupplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerProductWhitelist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "firstOrderedAt" DATETIME,
    "lastOrderedAt" DATETIME,
    "totalOrderCount" INTEGER NOT NULL DEFAULT 0,
    "isVisibleInPortal" BOOLEAN NOT NULL DEFAULT true,
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerProductWhitelist_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerProductWhitelist_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierName" TEXT NOT NULL,
    "supplierType" TEXT NOT NULL DEFAULT 'DOMESTIC_OTHER',
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "memo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CustomerUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerUser_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "deliveryAddressId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "requestedByCustomerUserId" TEXT,
    "salesRepId" TEXT,
    "orderSource" TEXT NOT NULL DEFAULT 'SALES_MANUAL',
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "priceStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "requestedDeliveryDate" DATETIME,
    "confirmedDeliveryDate" DATETIME,
    "supplierType" TEXT,
    "supplierId" TEXT,
    "creditWarningLevel" INTEGER NOT NULL DEFAULT 0,
    "customerNoticeRequired" BOOLEAN NOT NULL DEFAULT true,
    "rawOrderText" TEXT,
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_deliveryAddressId_fkey" FOREIGN KEY ("deliveryAddressId") REFERENCES "DeliveryAddress" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_requestedByCustomerUserId_fkey" FOREIGN KEY ("requestedByCustomerUserId") REFERENCES "CustomerUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "requestedQuantity" REAL NOT NULL,
    "approvedQuantity" REAL,
    "shippedQuantity" REAL,
    "receivedQuantity" REAL,
    "unit" TEXT NOT NULL DEFAULT 'KG',
    "expectedPrice" REAL,
    "confirmedPrice" REAL,
    "priceStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "previousStatus" TEXT,
    "newStatus" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "changeReason" TEXT,
    "internalMemo" TEXT,
    "customerMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderStatusHistory_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HoldReminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "holdReason" TEXT NOT NULL,
    "remindAt" DATETIME NOT NULL,
    "reminderTargetUserId" TEXT,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" DATETIME,
    "createdByUserId" TEXT,
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HoldReminder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HoldReminder_reminderTargetUserId_fkey" FOREIGN KEY ("reminderTargetUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "HoldReminder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Dispatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "dispatchStatus" TEXT NOT NULL DEFAULT 'WAITING',
    "plannedDispatchDate" DATETIME,
    "dispatchAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "carrierName" TEXT,
    "vehicleNumber" TEXT,
    "driverName" TEXT,
    "driverPhone" TEXT,
    "failureReason" TEXT,
    "nextRetryDate" DATETIME,
    "shareWithCustomer" BOOLEAN NOT NULL DEFAULT false,
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Dispatch_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "shipmentStatus" TEXT NOT NULL DEFAULT 'NOT_READY',
    "plannedShipDate" DATETIME,
    "actualShipDate" DATETIME,
    "plannedQuantity" REAL,
    "shippedQuantity" REAL,
    "unit" TEXT NOT NULL DEFAULT 'KG',
    "hasQuantityDiscrepancy" BOOLEAN NOT NULL DEFAULT false,
    "quantityDifferenceReason" TEXT,
    "shipmentMemo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeliveryReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "receiptStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "confirmedByUserId" TEXT,
    "customerUserId" TEXT,
    "confirmedAt" DATETIME,
    "receivedQuantity" REAL,
    "discrepancyReason" TEXT,
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeliveryReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeliveryReceipt_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DeliveryReceipt_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "CustomerUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ErpInputBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchDate" DATETIME NOT NULL,
    "batchStatus" TEXT NOT NULL DEFAULT 'GENERATED',
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedByUserId" TEXT,
    "approvedAt" DATETIME,
    "ecountResult" TEXT,
    "click2002Result" TEXT,
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ErpInputBatch_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ErpInputItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "ecountStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "click2002Status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "ecountErrorMessage" TEXT,
    "click2002ErrorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "isExcluded" BOOLEAN NOT NULL DEFAULT false,
    "excludeReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ErpInputItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ErpInputBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ErpInputItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT,
    "recipientType" TEXT NOT NULL,
    "recipientId" TEXT,
    "recipientLabel" TEXT,
    "channel" TEXT NOT NULL,
    "notificationType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sendStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "sentAt" DATETIME,
    "failedReason" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_customerCode_key" ON "Customer"("customerCode");

-- CreateIndex
CREATE INDEX "Customer_companyName_idx" ON "Customer"("companyName");

-- CreateIndex
CREATE INDEX "DeliveryAddress_customerId_idx" ON "DeliveryAddress"("customerId");

-- CreateIndex
CREATE INDEX "DeliveryAddress_addressLine1_idx" ON "DeliveryAddress"("addressLine1");

-- CreateIndex
CREATE UNIQUE INDEX "Product_productCode_key" ON "Product"("productCode");

-- CreateIndex
CREATE INDEX "CustomerProductWhitelist_customerId_idx" ON "CustomerProductWhitelist"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProductWhitelist_customerId_productId_key" ON "CustomerProductWhitelist"("customerId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerUser_email_key" ON "CustomerUser"("email");

-- CreateIndex
CREATE INDEX "CustomerUser_customerId_idx" ON "CustomerUser"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_salesRepId_idx" ON "Order"("salesRepId");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_requestedDeliveryDate_idx" ON "Order"("requestedDeliveryDate");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_orderId_idx" ON "OrderStatusHistory"("orderId");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_createdAt_idx" ON "OrderStatusHistory"("createdAt");

-- CreateIndex
CREATE INDEX "HoldReminder_orderId_idx" ON "HoldReminder"("orderId");

-- CreateIndex
CREATE INDEX "HoldReminder_remindAt_idx" ON "HoldReminder"("remindAt");

-- CreateIndex
CREATE INDEX "HoldReminder_isCompleted_idx" ON "HoldReminder"("isCompleted");

-- CreateIndex
CREATE INDEX "Dispatch_orderId_idx" ON "Dispatch"("orderId");

-- CreateIndex
CREATE INDEX "Dispatch_dispatchStatus_idx" ON "Dispatch"("dispatchStatus");

-- CreateIndex
CREATE INDEX "Dispatch_nextRetryDate_idx" ON "Dispatch"("nextRetryDate");

-- CreateIndex
CREATE INDEX "Shipment_orderId_idx" ON "Shipment"("orderId");

-- CreateIndex
CREATE INDEX "Shipment_shipmentStatus_idx" ON "Shipment"("shipmentStatus");

-- CreateIndex
CREATE INDEX "Shipment_actualShipDate_idx" ON "Shipment"("actualShipDate");

-- CreateIndex
CREATE INDEX "DeliveryReceipt_orderId_idx" ON "DeliveryReceipt"("orderId");

-- CreateIndex
CREATE INDEX "ErpInputBatch_batchDate_idx" ON "ErpInputBatch"("batchDate");

-- CreateIndex
CREATE INDEX "ErpInputBatch_batchStatus_idx" ON "ErpInputBatch"("batchStatus");

-- CreateIndex
CREATE INDEX "ErpInputItem_batchId_idx" ON "ErpInputItem"("batchId");

-- CreateIndex
CREATE INDEX "ErpInputItem_ecountStatus_idx" ON "ErpInputItem"("ecountStatus");

-- CreateIndex
CREATE INDEX "ErpInputItem_click2002Status_idx" ON "ErpInputItem"("click2002Status");

-- CreateIndex
CREATE INDEX "NotificationLog_orderId_idx" ON "NotificationLog"("orderId");

-- CreateIndex
CREATE INDEX "NotificationLog_sendStatus_idx" ON "NotificationLog"("sendStatus");

-- CreateIndex
CREATE INDEX "NotificationLog_channel_idx" ON "NotificationLog"("channel");

-- CreateIndex
CREATE INDEX "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");
