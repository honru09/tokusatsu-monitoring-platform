ALTER TABLE "product_market_comparisons"
  ADD COLUMN "refresh_token" TEXT,
  ADD COLUMN "refresh_lease_until" TIMESTAMPTZ;

ALTER TABLE "comparison_offers"
  ADD COLUMN "provider_key" TEXT,
  ADD COLUMN "provider_run_id" TEXT,
  ADD COLUMN "query_keyword" TEXT;

-- Downgrade summaries created under the earlier two-sample/nullable evidence
-- rules before installing the stricter public-ready invariant.
UPDATE "product_market_comparisons"
SET
  "status" = 'insufficient',
  "last_error" = COALESCE(
    NULLIF("last_error", ''),
    '历史参考价不满足三样本及原链接完整性规则'
  )
WHERE "status" = 'ready'
  AND (
    "matched_count" < 3
    OR "reference_price_cny" IS NULL
    OR "reference_price_cny" <= 0
    OR "min_price_cny" IS NULL
    OR "min_price_cny" <= 0
    OR "max_price_cny" IS NULL
    OR "max_price_cny" <= 0
    OR "reference_price_cny" NOT BETWEEN "min_price_cny" AND "max_price_cny"
    OR "reference_url" IS NULL
    OR "reference_url" !~ '^https://[^[:space:]]+$'
    OR "observed_at" IS NULL
    OR "confidence" IS NULL
  );

DELETE FROM "comparison_offers"
WHERE "price_cny" <= 0
  OR length(trim("source_listing_id")) = 0
  OR length(trim("source_url")) = 0
  OR "source_url" !~ '^https://[^[:space:]]+$'
  OR length(trim("title_raw")) = 0;

ALTER TABLE "product_market_comparisons"
  ADD CONSTRAINT "product_market_comparisons_refresh_lease_pair_check" CHECK (
    ("refresh_token" IS NULL AND "refresh_lease_until" IS NULL)
    OR (length(trim("refresh_token")) > 0 AND "refresh_lease_until" IS NOT NULL)
  ),
  ADD CONSTRAINT "product_market_comparisons_ready_evidence_check" CHECK (
    "status" <> 'ready'
    OR (
      "matched_count" >= 3
      AND "reference_price_cny" > 0
      AND "min_price_cny" > 0
      AND "max_price_cny" > 0
      AND "reference_price_cny" BETWEEN "min_price_cny" AND "max_price_cny"
      AND "reference_url" ~ '^https://[^[:space:]]+$'
      AND "observed_at" IS NOT NULL
      AND "confidence" IS NOT NULL
    )
  );

ALTER TABLE "comparison_offers"
  DROP CONSTRAINT "comparison_offers_price_check",
  ADD CONSTRAINT "comparison_offers_price_check" CHECK ("price_cny" > 0),
  ADD CONSTRAINT "comparison_offers_identity_check" CHECK (
    length(trim("source_listing_id")) > 0
    AND length(trim("title_raw")) > 0
    AND "source_url" ~ '^https://[^[:space:]]+$'
  ),
  ADD CONSTRAINT "comparison_offers_provider_key_check" CHECK (
    "provider_key" IS NULL OR length(trim("provider_key")) > 0
  ),
  ADD CONSTRAINT "comparison_offers_query_keyword_check" CHECK (
    "query_keyword" IS NULL OR length(trim("query_keyword")) > 0
  );

DROP INDEX IF EXISTS "product_market_comparisons_source_id_status_idx";
CREATE INDEX "product_market_comparisons_source_id_status_next_refresh_at_idx"
  ON "product_market_comparisons"("source_id", "status", "next_refresh_at");
CREATE INDEX "product_market_comparisons_product_id_status_observed_at_idx"
  ON "product_market_comparisons"("product_id", "status", "observed_at");
CREATE INDEX "comparison_offers_comparison_id_last_seen_at_idx"
  ON "comparison_offers"("comparison_id", "last_seen_at");
