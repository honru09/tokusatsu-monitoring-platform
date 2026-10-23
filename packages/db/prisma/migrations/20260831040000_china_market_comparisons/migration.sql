CREATE TYPE "MarketComparisonStatus" AS ENUM (
  'pending',
  'refreshing',
  'ready',
  'insufficient',
  'failed'
);

CREATE TABLE "product_market_comparisons" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "status" "MarketComparisonStatus" NOT NULL DEFAULT 'pending',
  "search_keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "candidate_count" INTEGER NOT NULL DEFAULT 0,
  "matched_count" INTEGER NOT NULL DEFAULT 0,
  "reference_price_cny" NUMERIC(12,2),
  "min_price_cny" NUMERIC(12,2),
  "max_price_cny" NUMERIC(12,2),
  "reference_url" TEXT,
  "reference_title" TEXT,
  "confidence" DOUBLE PRECISION,
  "observed_at" TIMESTAMPTZ,
  "next_refresh_at" TIMESTAMPTZ,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "product_market_comparisons_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_market_comparisons_counts_check" CHECK (
    "candidate_count" >= 0
    AND "matched_count" >= 0
    AND "matched_count" <= "candidate_count"
  ),
  CONSTRAINT "product_market_comparisons_prices_check" CHECK (
    ("reference_price_cny" IS NULL OR "reference_price_cny" >= 0)
    AND ("min_price_cny" IS NULL OR "min_price_cny" >= 0)
    AND ("max_price_cny" IS NULL OR "max_price_cny" >= 0)
    AND (
      "min_price_cny" IS NULL
      OR "max_price_cny" IS NULL
      OR "min_price_cny" <= "max_price_cny"
    )
  ),
  CONSTRAINT "product_market_comparisons_confidence_check" CHECK (
    "confidence" IS NULL OR "confidence" BETWEEN 0 AND 1
  )
);

CREATE TABLE "comparison_offers" (
  "id" TEXT NOT NULL,
  "comparison_id" TEXT NOT NULL,
  "source_listing_id" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "title_raw" TEXT NOT NULL,
  "price_cny" NUMERIC(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "image_url" TEXT,
  "location" TEXT,
  "condition" TEXT,
  "status" "ItemStatus" NOT NULL DEFAULT 'unknown',
  "match_confidence" DOUBLE PRECISION,
  "match_decision" "MatchDecision" NOT NULL DEFAULT 'unmatched',
  "rejection_reason" TEXT,
  "match_evidence" JSONB,
  "source_data" JSONB,
  "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "comparison_offers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "comparison_offers_price_check" CHECK ("price_cny" >= 0),
  CONSTRAINT "comparison_offers_currency_check" CHECK (length(trim("currency")) > 0),
  CONSTRAINT "comparison_offers_confidence_check" CHECK (
    "match_confidence" IS NULL OR "match_confidence" BETWEEN 0 AND 1
  ),
  CONSTRAINT "comparison_offers_match_evidence_object_check" CHECK (
    "match_evidence" IS NULL OR jsonb_typeof("match_evidence") = 'object'
  ),
  CONSTRAINT "comparison_offers_source_data_object_check" CHECK (
    "source_data" IS NULL OR jsonb_typeof("source_data") = 'object'
  )
);

CREATE UNIQUE INDEX "product_market_comparisons_product_id_source_id_key"
  ON "product_market_comparisons"("product_id", "source_id");
CREATE INDEX "product_market_comparisons_status_next_refresh_at_idx"
  ON "product_market_comparisons"("status", "next_refresh_at");
CREATE INDEX "product_market_comparisons_source_id_status_idx"
  ON "product_market_comparisons"("source_id", "status");

CREATE UNIQUE INDEX "comparison_offers_comparison_id_source_listing_id_key"
  ON "comparison_offers"("comparison_id", "source_listing_id");
CREATE INDEX "comparison_offers_comparison_id_status_price_cny_idx"
  ON "comparison_offers"("comparison_id", "status", "price_cny");
CREATE INDEX "comparison_offers_match_decision_last_seen_at_idx"
  ON "comparison_offers"("match_decision", "last_seen_at");

ALTER TABLE "product_market_comparisons"
  ADD CONSTRAINT "product_market_comparisons_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_market_comparisons"
  ADD CONSTRAINT "product_market_comparisons_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "Source"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "comparison_offers"
  ADD CONSTRAINT "comparison_offers_comparison_id_fkey"
  FOREIGN KEY ("comparison_id") REFERENCES "product_market_comparisons"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON COLUMN "comparison_offers"."source_data" IS
  'Allowlisted product-side metadata only; never an unfiltered provider response.';
