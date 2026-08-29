-- Product/listing separation and normalized catalog entities.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE "MatchDecision" AS ENUM (
  'unmatched',
  'auto_matched',
  'review_required',
  'manually_matched'
);

CREATE TYPE "ReviewQueueStatus" AS ENUM (
  'pending',
  'confirmed',
  'rejected'
);

CREATE TABLE "franchises" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name_ja" TEXT NOT NULL,
  "name_zh" TEXT NOT NULL,
  "name_en" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "franchises_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "series" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "franchise_id" TEXT NOT NULL,
  "name_ja" TEXT NOT NULL,
  "name_zh" TEXT NOT NULL,
  "name_en" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "series_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "characters" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "series_id" TEXT,
  "name_ja" TEXT NOT NULL,
  "name_zh" TEXT NOT NULL,
  "name_en" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "manufacturers" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name_ja" TEXT NOT NULL,
  "name_zh" TEXT NOT NULL,
  "name_en" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "manufacturers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "toy_types" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name_ja" TEXT NOT NULL,
  "name_zh" TEXT NOT NULL,
  "name_en" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "toy_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "products" (
  "id" TEXT NOT NULL,
  "canonical_key" TEXT NOT NULL,
  "canonical_name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL,
  "title_zh" TEXT,
  "product_line" TEXT,
  "model_number" TEXT,
  "release_year" INTEGER,
  "franchise_id" TEXT,
  "series_id" TEXT,
  "manufacturer_id" TEXT,
  "toy_type_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "products_release_year_check" CHECK (
    "release_year" IS NULL OR "release_year" BETWEEN 1970 AND 2100
  )
);

CREATE TABLE "product_characters" (
  "product_id" TEXT NOT NULL,
  "character_id" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "evidence" TEXT,
  CONSTRAINT "product_characters_pkey" PRIMARY KEY ("product_id", "character_id"),
  CONSTRAINT "product_characters_confidence_check" CHECK (
    "confidence" >= 0 AND "confidence" <= 1
  )
);

CREATE TABLE "catalog_aliases" (
  "id" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_key" TEXT NOT NULL,
  "alias_text" TEXT NOT NULL,
  "normalized_text" TEXT NOT NULL,
  "locale" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalog_aliases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "average_cost" NUMERIC(12,2),
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "inventory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_quantity_check" CHECK ("quantity" >= 0),
  CONSTRAINT "inventory_average_cost_check" CHECK (
    "average_cost" IS NULL OR "average_cost" >= 0
  )
);

ALTER TABLE "Item"
  ADD COLUMN "product_id" TEXT,
  ADD COLUMN "normalized_title" TEXT,
  ADD COLUMN "field_confidences" JSONB,
  ADD COLUMN "extraction_evidence" JSONB,
  ADD COLUMN "match_confidence" DOUBLE PRECISION,
  ADD COLUMN "match_decision" "MatchDecision" NOT NULL DEFAULT 'unmatched';

CREATE TABLE "review_queue" (
  "id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "product_id" TEXT,
  "status" "ReviewQueueStatus" NOT NULL DEFAULT 'pending',
  "reasons" TEXT[] NOT NULL,
  "field_confidences" JSONB NOT NULL,
  "suggested_changes" JSONB,
  "resolved_by" TEXT,
  "resolved_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "review_queue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "review_queue_field_confidences_object_check" CHECK (
    jsonb_typeof("field_confidences") = 'object'
  )
);

CREATE UNIQUE INDEX "franchises_key_key" ON "franchises"("key");
CREATE UNIQUE INDEX "series_key_key" ON "series"("key");
CREATE INDEX "series_franchise_id_idx" ON "series"("franchise_id");
CREATE UNIQUE INDEX "characters_key_key" ON "characters"("key");
CREATE INDEX "characters_series_id_idx" ON "characters"("series_id");
CREATE UNIQUE INDEX "manufacturers_key_key" ON "manufacturers"("key");
CREATE UNIQUE INDEX "toy_types_key_key" ON "toy_types"("key");
CREATE UNIQUE INDEX "products_canonical_key_key" ON "products"("canonical_key");
CREATE INDEX "products_normalized_name_idx" ON "products"("normalized_name");
CREATE INDEX "products_normalized_name_trgm_idx" ON "products" USING GIN ("normalized_name" gin_trgm_ops);
CREATE INDEX "products_franchise_id_series_id_idx" ON "products"("franchise_id", "series_id");
CREATE INDEX "products_manufacturer_id_idx" ON "products"("manufacturer_id");
CREATE INDEX "products_toy_type_id_idx" ON "products"("toy_type_id");
CREATE INDEX "product_characters_character_id_idx" ON "product_characters"("character_id");
CREATE UNIQUE INDEX "catalog_aliases_entity_type_normalized_text_key" ON "catalog_aliases"("entity_type", "normalized_text");
CREATE INDEX "catalog_aliases_entity_type_entity_key_idx" ON "catalog_aliases"("entity_type", "entity_key");
CREATE UNIQUE INDEX "inventory_product_id_key" ON "inventory"("product_id");
CREATE INDEX "inventory_updated_at_idx" ON "inventory"("updated_at");
CREATE INDEX "Item_product_id_idx" ON "Item"("product_id");
CREATE INDEX "Item_needsReview_detectedAt_idx" ON "Item"("needsReview", "detectedAt");
CREATE UNIQUE INDEX "review_queue_item_id_status_key" ON "review_queue"("item_id", "status");
CREATE INDEX "review_queue_status_created_at_idx" ON "review_queue"("status", "created_at");
CREATE INDEX "review_queue_product_id_idx" ON "review_queue"("product_id");

ALTER TABLE "series" ADD CONSTRAINT "series_franchise_id_fkey"
  FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "characters" ADD CONSTRAINT "characters_series_id_fkey"
  FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_franchise_id_fkey"
  FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_series_id_fkey"
  FOREIGN KEY ("series_id") REFERENCES "series"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_manufacturer_id_fkey"
  FOREIGN KEY ("manufacturer_id") REFERENCES "manufacturers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_toy_type_id_fkey"
  FOREIGN KEY ("toy_type_id") REFERENCES "toy_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_characters" ADD CONSTRAINT "product_characters_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_characters" ADD CONSTRAINT "product_characters_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Item" ADD CONSTRAINT "Item_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
