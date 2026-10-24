-- Purchase entry completion: persist purchase-link analyses on UrlImport
-- and let operators correct the purchased quantity per record.
-- Generated with prisma migrate diff from the e3bdba1 schema and reviewed
-- against the existing migration style.

-- AlterTable
ALTER TABLE "UrlImport" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'link',
ADD COLUMN "resultData" JSONB;

-- AlterTable
ALTER TABLE "PurchaseRecord" ADD COLUMN "quantityOverride" INTEGER;

-- CreateIndex
CREATE INDEX "UrlImport_origin_createdAt_idx" ON "UrlImport"("origin", "createdAt");
