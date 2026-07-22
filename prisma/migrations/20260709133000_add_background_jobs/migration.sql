CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "queueKey" TEXT,
    "activeKey" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "error" TEXT,
    "progress" INTEGER,
    "requestedByUserId" TEXT,
    "requestedByCustomerUserId" TEXT,
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "heartbeatAt" DATETIME,
    "lockedAt" DATETIME,
    "lockedBy" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" DATETIME,
    "metadata" TEXT,
    "result" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "BackgroundJob_activeKey_key" ON "BackgroundJob"("activeKey");
CREATE INDEX "BackgroundJob_type_idx" ON "BackgroundJob"("type");
CREATE INDEX "BackgroundJob_status_queuedAt_idx" ON "BackgroundJob"("status", "queuedAt");
CREATE INDEX "BackgroundJob_queueKey_idx" ON "BackgroundJob"("queueKey");
CREATE INDEX "BackgroundJob_entityType_entityId_idx" ON "BackgroundJob"("entityType", "entityId");
CREATE INDEX "BackgroundJob_requestedByUserId_idx" ON "BackgroundJob"("requestedByUserId");
CREATE INDEX "BackgroundJob_createdAt_idx" ON "BackgroundJob"("createdAt");

ALTER TABLE "NotificationLog" ADD COLUMN "backgroundJobId" TEXT;
ALTER TABLE "NotificationLog" ADD COLUMN "readAt" DATETIME;

CREATE INDEX "NotificationLog_backgroundJobId_idx" ON "NotificationLog"("backgroundJobId");
CREATE INDEX "NotificationLog_recipientType_recipientId_readAt_createdAt_idx" ON "NotificationLog"("recipientType", "recipientId", "readAt", "createdAt");
