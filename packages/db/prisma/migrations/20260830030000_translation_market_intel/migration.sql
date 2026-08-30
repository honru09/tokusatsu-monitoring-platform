-- Persist complete item translations instead of keeping them only in browser state.
ALTER TABLE "Item"
  ADD COLUMN "title_zh" TEXT,
  ADD COLUMN "description_zh" TEXT,
  ADD COLUMN "condition_zh" TEXT,
  ADD COLUMN "shipping_zh" TEXT,
  ADD COLUMN "details_zh" JSONB,
  ADD COLUMN "translation_status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "translated_at" TIMESTAMP(3);

CREATE TYPE "MarketIntelKind" AS ENUM ('news', 'forum', 'post');

CREATE TABLE "market_intel" (
  "id" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "source_platform" TEXT NOT NULL,
  "source_name" TEXT NOT NULL,
  "kind" "MarketIntelKind" NOT NULL,
  "author" TEXT,
  "title_raw" TEXT NOT NULL,
  "body_raw" TEXT NOT NULL,
  "title_zh" TEXT,
  "body_zh" TEXT,
  "translation_status" TEXT NOT NULL DEFAULT 'pending',
  "published_at" TIMESTAMP(3),
  "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "translated_at" TIMESTAMP(3),
  "product_links" JSONB,
  "source_data" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "market_intel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "market_intel_source_url_key" ON "market_intel"("source_url");
CREATE INDEX "market_intel_kind_published_at_idx" ON "market_intel"("kind", "published_at");
CREATE INDEX "market_intel_detected_at_idx" ON "market_intel"("detected_at");
