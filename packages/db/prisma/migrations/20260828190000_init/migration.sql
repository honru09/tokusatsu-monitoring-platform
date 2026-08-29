-- CreateEnum
CREATE TYPE "SourceChannel" AS ENUM ('online', 'physical_store');

-- CreateEnum
CREATE TYPE "SellerType" AS ENUM ('individual', 'store', 'unknown');

-- CreateEnum
CREATE TYPE "CategoryIp" AS ENUM ('kamen_rider', 'ultraman', 'other', 'unknown');

-- CreateEnum
CREATE TYPE "ToyType" AS ENUM ('gashapon', 'shokugan', 'figure', 'sofubi', 'finger_puppet', 'dx_belt', 'henshin_item', 'card', 'medal', 'model', 'set', 'other', 'unknown');

-- CreateEnum
CREATE TYPE "Manufacturer" AS ENUM ('bandai', 'bandai_spirits', 'banpresto', 'megahouse', 'plex', 'other', 'unknown');

-- CreateEnum
CREATE TYPE "ConditionGrade" AS ENUM ('new_sealed', 'like_new', 'used', 'stained_or_damaged', 'junk', 'unknown');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('active', 'sold', 'ended', 'reserved', 'unknown');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "baseUrl" TEXT,
    "channel" "SourceChannel" NOT NULL DEFAULT 'online',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rateLimitMs" INTEGER NOT NULL DEFAULT 2000,
    "circuitOpenAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seller" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sellerType" "SellerType" NOT NULL DEFAULT 'unknown',
    "locationText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Seller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "titleRaw" TEXT NOT NULL,
    "descriptionRaw" TEXT,
    "sellerId" TEXT,
    "locationText" TEXT,
    "priceCurrent" INTEGER NOT NULL,
    "shippingFee" INTEGER,
    "priceTotalEst" INTEGER NOT NULL,
    "listedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auctionEndAt" TIMESTAMP(3),
    "bidCount" INTEGER,
    "conditionRaw" TEXT,
    "categoryIp" "CategoryIp" NOT NULL DEFAULT 'unknown',
    "categoryToyType" "ToyType" NOT NULL DEFAULT 'unknown',
    "manufacturer" "Manufacturer" NOT NULL DEFAULT 'unknown',
    "conditionGrade" "ConditionGrade" NOT NULL DEFAULT 'unknown',
    "channel" "SourceChannel" NOT NULL DEFAULT 'online',
    "quantityEst" INTEGER,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "unitCostEst" INTEGER,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "needsReview" BOOLEAN NOT NULL DEFAULT true,
    "procurementScore" INTEGER NOT NULL DEFAULT 0,
    "status" "ItemStatus" NOT NULL DEFAULT 'unknown',
    "suspectedDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemImage" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "localThumbnailUrl" TEXT,
    "perceptualHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemPriceHistory" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "priceCurrent" INTEGER NOT NULL,
    "shippingFee" INTEGER,
    "bidCount" INTEGER,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemClassification" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "classifierType" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "conflict" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhysicalStore" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "name" TEXT NOT NULL,
    "area" TEXT,
    "address" TEXT,
    "openingHours" TEXT,
    "websiteUrl" TEXT,
    "socialUrl" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhysicalStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlJob" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "queueJobId" TEXT,
    "jobType" TEXT NOT NULL,
    "query" JSONB,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "errorText" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrawlJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "payload" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualReview" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "beforeData" JSONB NOT NULL,
    "afterData" JSONB NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Source_key_key" ON "Source"("key");

-- CreateIndex
CREATE INDEX "Seller_name_idx" ON "Seller"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Seller_sourceId_name_key" ON "Seller"("sourceId", "name");

-- CreateIndex
CREATE INDEX "Item_categoryIp_priceCurrent_idx" ON "Item"("categoryIp", "priceCurrent");

-- CreateIndex
CREATE INDEX "Item_conditionGrade_categoryToyType_manufacturer_idx" ON "Item"("conditionGrade", "categoryToyType", "manufacturer");

-- CreateIndex
CREATE INDEX "Item_auctionEndAt_idx" ON "Item"("auctionEndAt");

-- CreateIndex
CREATE INDEX "Item_detectedAt_idx" ON "Item"("detectedAt");

-- CreateIndex
CREATE INDEX "Item_listedAt_idx" ON "Item"("listedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Item_sourceId_sourceItemId_key" ON "Item"("sourceId", "sourceItemId");

-- CreateIndex
CREATE INDEX "ItemImage_itemId_position_idx" ON "ItemImage"("itemId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ItemImage_itemId_url_key" ON "ItemImage"("itemId", "url");

-- CreateIndex
CREATE INDEX "ItemPriceHistory_itemId_observedAt_idx" ON "ItemPriceHistory"("itemId", "observedAt");

-- CreateIndex
CREATE INDEX "ItemClassification_itemId_createdAt_idx" ON "ItemClassification"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "PhysicalStore_area_idx" ON "PhysicalStore"("area");

-- CreateIndex
CREATE INDEX "CrawlJob_status_createdAt_idx" ON "CrawlJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_readAt_createdAt_idx" ON "Alert"("readAt", "createdAt");

-- CreateIndex
CREATE INDEX "ManualReview_itemId_createdAt_idx" ON "ManualReview"("itemId", "createdAt");

-- AddForeignKey
ALTER TABLE "Seller" ADD CONSTRAINT "Seller_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemImage" ADD CONSTRAINT "ItemImage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPriceHistory" ADD CONSTRAINT "ItemPriceHistory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemClassification" ADD CONSTRAINT "ItemClassification_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalStore" ADD CONSTRAINT "PhysicalStore_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlJob" ADD CONSTRAINT "CrawlJob_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualReview" ADD CONSTRAINT "ManualReview_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
