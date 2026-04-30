-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "loginId" TEXT,
    "passwordHash" TEXT,
    "phone" TEXT,
    "role" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "backupUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_backupUserId_fkey" FOREIGN KEY ("backupUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("backupUserId", "createdAt", "email", "id", "isActive", "name", "passwordHash", "phone", "role", "updatedAt") SELECT "backupUserId", "createdAt", "email", "id", "isActive", "name", "passwordHash", "phone", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_loginId_key" ON "User"("loginId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
