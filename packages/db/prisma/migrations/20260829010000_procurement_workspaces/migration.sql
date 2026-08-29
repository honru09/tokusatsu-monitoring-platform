-- Procurement workspaces: URL imports, purchase records and archival metadata.
CREATE TYPE "ImportOrigin" AS ENUM ('search', 'url');

ALTER TABLE "Item"
  ADD COLUMN "importOrigin" "ImportOrigin" NOT NULL DEFAULT 'search',
  ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Item_archivedAt_status_idx" ON "Item"("archivedAt", "status");
CREATE INDEX "Item_importOrigin_createdAt_idx" ON "Item"("importOrigin", "createdAt");

CREATE TABLE "UrlImport" (
  "id" TEXT NOT NULL,
  "queueJobId" TEXT,
  "sourceUrl" TEXT NOT NULL,
  "adapterKey" TEXT NOT NULL,
  "itemId" TEXT,
  "status" "JobStatus" NOT NULL DEFAULT 'queued',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "currentStep" TEXT,
  "errorText" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UrlImport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UrlImport_queueJobId_key" ON "UrlImport"("queueJobId");
CREATE INDEX "UrlImport_status_createdAt_idx" ON "UrlImport"("status", "createdAt");
CREATE INDEX "UrlImport_sourceUrl_idx" ON "UrlImport"("sourceUrl");
ALTER TABLE "UrlImport" ADD CONSTRAINT "UrlImport_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PurchaseRecord" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "purchaseAmount" INTEGER NOT NULL,
  "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PurchaseRecord_itemId_key" ON "PurchaseRecord"("itemId");
CREATE INDEX "PurchaseRecord_purchasedAt_idx" ON "PurchaseRecord"("purchasedAt");
CREATE INDEX "PurchaseRecord_verifiedAt_idx" ON "PurchaseRecord"("verifiedAt");
ALTER TABLE "PurchaseRecord" ADD CONSTRAINT "PurchaseRecord_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PurchaseReceipt" (
  "id" TEXT NOT NULL,
  "purchaseId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "dataBase64" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PurchaseReceipt_purchaseId_createdAt_idx" ON "PurchaseReceipt"("purchaseId", "createdAt");
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_purchaseId_fkey"
  FOREIGN KEY ("purchaseId") REFERENCES "PurchaseRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
