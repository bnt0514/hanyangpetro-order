-- Add optional promissory-note fields to finance transactions.
ALTER TABLE "CreditTransaction" ADD COLUMN "noteNumber" TEXT;
ALTER TABLE "CreditTransaction" ADD COLUMN "noteMaturityDate" DATETIME;
ALTER TABLE "CreditTransaction" ADD COLUMN "noteIssuer" TEXT;
ALTER TABLE "CreditTransaction" ADD COLUMN "noteDescription" TEXT;
