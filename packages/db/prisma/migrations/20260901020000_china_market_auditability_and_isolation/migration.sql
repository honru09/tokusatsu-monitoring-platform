-- China-market sources are evidence-only. Refuse to silently reclassify a
-- source that already owns procurement listings.
ALTER TABLE "Source"
  ADD COLUMN "comparison_only" BOOLEAN NOT NULL DEFAULT false;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Item" item
    JOIN "Source" source ON source."id" = item."sourceId"
    WHERE source."key" = 'xianyu'
  ) THEN
    RAISE EXCEPTION
      'Source xianyu already owns Item rows and cannot become comparison-only';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "product_market_comparisons" comparison
    JOIN "Source" source ON source."id" = comparison."source_id"
    WHERE source."key" <> 'xianyu'
  ) THEN
    RAISE EXCEPTION
      'Existing China-market comparisons use an unsupported source';
  END IF;
END
$migration$;

UPDATE "Source"
SET
  "comparison_only" = true,
  "enabled" = false
WHERE "key" = 'xianyu';

ALTER TABLE "Source"
  ADD CONSTRAINT "Source_comparison_only_disabled_check" CHECK (
    NOT "comparison_only" OR NOT "enabled"
  );

ALTER TABLE "product_market_comparisons"
  ADD COLUMN "comparison_method" TEXT,
  ADD COLUMN "keyword_identity_hash" TEXT,
  ADD COLUMN "provider_stats" JSONB;

-- Rows produced by the implementation immediately preceding this migration
-- used the same v1 representative-listing median contract. Provider counters
-- were not retained, so provider_stats intentionally stays NULL for history.
UPDATE "product_market_comparisons" comparison
SET "comparison_method" = 'xianyu-v1'
FROM "Source" source
WHERE source."id" = comparison."source_id"
  AND source."key" = 'xianyu'
  AND comparison."comparison_method" IS NULL;

-- Provenance is part of the pricing evidence, not optional diagnostics.
-- Remove unverifiable historical candidates before making it mandatory.
DELETE FROM "comparison_offers" offer
USING "product_market_comparisons" comparison, "Source" source
WHERE comparison."id" = offer."comparison_id"
  AND source."id" = comparison."source_id"
  AND (
    offer."provider_key" IS NULL
    OR length(trim(offer."provider_key")) = 0
    OR offer."query_keyword" IS NULL
    OR length(trim(offer."query_keyword")) = 0
    OR (
      source."key" = 'xianyu'
      AND (
        offer."source_listing_id" !~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'
        OR offer."source_url" <>
          'https://www.goofish.com/item?id=' || offer."source_listing_id"
      )
    )
  );

-- A historical public summary remains ready only if its surviving evidence
-- proves the same active sample count and representative price/link pair.
UPDATE "product_market_comparisons" comparison
SET
  "status" = 'insufficient',
  "reference_price_cny" = NULL,
  "min_price_cny" = NULL,
  "max_price_cny" = NULL,
  "reference_url" = NULL,
  "reference_title" = NULL,
  "confidence" = NULL,
  "last_error" = COALESCE(
    NULLIF(comparison."last_error", ''),
    '历史参考价缺少可复核的来源证据，等待重新采样'
  )
FROM "Source" source
WHERE comparison."source_id" = source."id"
  AND comparison."status" = 'ready'
  AND (
    source."key" <> 'xianyu'
    OR comparison."comparison_method" IS NULL
    OR length(trim(comparison."comparison_method")) = 0
    OR comparison."keyword_identity_hash" !~ '^[0-9a-f]{64}$'
    OR comparison."provider_stats" IS NULL
    OR jsonb_typeof(comparison."provider_stats") <> 'object'
    OR NOT comparison."provider_stats" ?& ARRAY[
      'complete',
      'requestedKeywords',
      'attemptedKeywords',
      'rejectedRows'
    ]
    OR comparison."provider_stats" - ARRAY[
      'complete',
      'requestedKeywords',
      'attemptedKeywords',
      'rejectedRows'
    ] <> '{}'::jsonb
    OR jsonb_typeof(comparison."provider_stats" -> 'complete') <> 'boolean'
    OR jsonb_typeof(comparison."provider_stats" -> 'requestedKeywords') <> 'number'
    OR jsonb_typeof(comparison."provider_stats" -> 'attemptedKeywords') <> 'number'
    OR jsonb_typeof(comparison."provider_stats" -> 'rejectedRows') <> 'number'
    OR cardinality(comparison."search_keywords") NOT BETWEEN 3 AND 8
    OR comparison."candidate_count" NOT BETWEEN 3 AND 50
    OR comparison."matched_count" NOT BETWEEN 3 AND comparison."candidate_count"
    OR comparison."reference_price_cny" > 1000000
    OR comparison."min_price_cny" > 1000000
    OR comparison."max_price_cny" > 1000000
    OR comparison."reference_url" !~
      '^https://www[.]goofish[.]com/item[?]id=[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'
    OR comparison."reference_title" IS NULL
    OR length(trim(comparison."reference_title")) = 0
    OR (
      SELECT count(*)
      FROM "comparison_offers" offer
      WHERE offer."comparison_id" = comparison."id"
        AND offer."last_seen_at" = comparison."observed_at"
        AND offer."query_keyword" = ANY(comparison."search_keywords")
    ) <> comparison."candidate_count"
    OR (
      SELECT count(*)
      FROM "comparison_offers" offer
      WHERE offer."comparison_id" = comparison."id"
        AND offer."status" = 'active'
        AND offer."match_decision" IN ('auto_matched', 'manually_matched')
        AND offer."last_seen_at" = comparison."observed_at"
        AND offer."query_keyword" = ANY(comparison."search_keywords")
    ) <> comparison."matched_count"
    OR NOT EXISTS (
      SELECT 1
      FROM "comparison_offers" offer
      WHERE offer."comparison_id" = comparison."id"
        AND offer."status" = 'active'
        AND offer."match_decision" IN ('auto_matched', 'manually_matched')
        AND offer."last_seen_at" = comparison."observed_at"
        AND offer."query_keyword" = ANY(comparison."search_keywords")
        AND offer."source_url" = comparison."reference_url"
        AND offer."title_raw" = comparison."reference_title"
        AND offer."price_cny" = comparison."reference_price_cny"
    )
  );

ALTER TABLE "comparison_offers"
  DROP CONSTRAINT "comparison_offers_provider_key_check",
  DROP CONSTRAINT "comparison_offers_query_keyword_check",
  ALTER COLUMN "provider_key" SET NOT NULL,
  ALTER COLUMN "query_keyword" SET NOT NULL,
  ADD CONSTRAINT "comparison_offers_provider_key_check" CHECK (
    length(trim("provider_key")) BETWEEN 1 AND 200
  ),
  ADD CONSTRAINT "comparison_offers_provider_run_id_check" CHECK (
    "provider_run_id" IS NULL
    OR length(trim("provider_run_id")) BETWEEN 1 AND 240
  ),
  ADD CONSTRAINT "comparison_offers_query_keyword_check" CHECK (
    length(trim("query_keyword")) BETWEEN 1 AND 240
  );

ALTER TABLE "product_market_comparisons"
  DROP CONSTRAINT "product_market_comparisons_ready_evidence_check",
  ADD CONSTRAINT "product_market_comparisons_keywords_check" CHECK (
    cardinality("search_keywords") <= 8
  ),
  ADD CONSTRAINT "product_market_comparisons_method_check" CHECK (
    "comparison_method" IS NULL
    OR length(trim("comparison_method")) BETWEEN 1 AND 80
  ),
  ADD CONSTRAINT "product_market_comparisons_keyword_identity_hash_check" CHECK (
    "keyword_identity_hash" IS NULL
    OR "keyword_identity_hash" ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "product_market_comparisons_provider_stats_object_check" CHECK (
    "provider_stats" IS NULL OR jsonb_typeof("provider_stats") = 'object'
  ),
  ADD CONSTRAINT "product_market_comparisons_ready_evidence_check" CHECK (
    "status" <> 'ready'
    OR (
      cardinality("search_keywords") BETWEEN 3 AND 8
      AND "candidate_count" BETWEEN 3 AND 50
      AND "matched_count" BETWEEN 3 AND "candidate_count"
      AND "reference_price_cny" > 0
      AND "reference_price_cny" <= 1000000
      AND "min_price_cny" > 0
      AND "min_price_cny" <= 1000000
      AND "max_price_cny" > 0
      AND "max_price_cny" <= 1000000
      AND "reference_price_cny" BETWEEN "min_price_cny" AND "max_price_cny"
      AND "reference_url" ~ '^https://[^[:space:]]+$'
      AND "reference_title" IS NOT NULL
      AND length(trim("reference_title")) > 0
      AND "observed_at" IS NOT NULL
      AND "confidence" IS NOT NULL
      AND "comparison_method" IS NOT NULL
      AND length(trim("comparison_method")) > 0
      AND "keyword_identity_hash" ~ '^[0-9a-f]{64}$'
      AND "provider_stats" IS NOT NULL
      AND jsonb_typeof("provider_stats") = 'object'
      AND "provider_stats" ?& ARRAY[
        'complete',
        'requestedKeywords',
        'attemptedKeywords',
        'rejectedRows'
      ]
      AND "provider_stats" - ARRAY[
        'complete',
        'requestedKeywords',
        'attemptedKeywords',
        'rejectedRows'
      ] = '{}'::jsonb
      AND jsonb_typeof("provider_stats" -> 'complete') = 'boolean'
      AND jsonb_typeof("provider_stats" -> 'requestedKeywords') = 'number'
      AND jsonb_typeof("provider_stats" -> 'attemptedKeywords') = 'number'
      AND jsonb_typeof("provider_stats" -> 'rejectedRows') = 'number'
      AND ("provider_stats" ->> 'requestedKeywords')::NUMERIC =
        cardinality("search_keywords")
      AND ("provider_stats" ->> 'attemptedKeywords')::NUMERIC BETWEEN 0 AND
        ("provider_stats" ->> 'requestedKeywords')::NUMERIC
      AND ("provider_stats" ->> 'rejectedRows')::NUMERIC >= 0
    )
  );

CREATE INDEX "product_market_comparisons_source_id_refresh_lease_until_next_refresh_at_updated_at_idx"
  ON "product_market_comparisons"(
    "source_id",
    "refresh_lease_until",
    "next_refresh_at",
    "updated_at"
  );

-- Cross-table invariants require triggers because PostgreSQL CHECK
-- constraints cannot contain subqueries.
CREATE FUNCTION enforce_comparison_only_source_state()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."comparison_only" AND EXISTS (
    SELECT 1 FROM "Item" WHERE "sourceId" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'Comparison-only source % cannot own Item rows', NEW."key"
      USING ERRCODE = '23514';
  END IF;

  IF NOT NEW."comparison_only" AND EXISTS (
    SELECT 1
    FROM "product_market_comparisons"
    WHERE "source_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'Comparison source % cannot be changed to procurement mode', NEW."key"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER "Source_comparison_only_guard"
BEFORE INSERT OR UPDATE OF "comparison_only" ON "Source"
FOR EACH ROW
EXECUTE FUNCTION enforce_comparison_only_source_state();

CREATE FUNCTION reject_comparison_source_item()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Source"
    WHERE "id" = NEW."sourceId"
      AND "comparison_only"
  ) THEN
    RAISE EXCEPTION 'Comparison-only sources cannot be written to Item'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER "Item_comparison_source_guard"
BEFORE INSERT OR UPDATE OF "sourceId" ON "Item"
FOR EACH ROW
EXECUTE FUNCTION reject_comparison_source_item();

CREATE FUNCTION require_comparison_only_source()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "Source"
    WHERE "id" = NEW."source_id"
      AND "comparison_only"
  ) THEN
    RAISE EXCEPTION 'ProductMarketComparison requires a comparison-only source'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER "product_market_comparisons_source_guard"
BEFORE INSERT OR UPDATE OF "source_id" ON "product_market_comparisons"
FOR EACH ROW
EXECUTE FUNCTION require_comparison_only_source();

CREATE FUNCTION enforce_comparison_offer_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  source_key TEXT;
BEGIN
  SELECT source."key"
  INTO source_key
  FROM "product_market_comparisons" comparison
  JOIN "Source" source ON source."id" = comparison."source_id"
  WHERE comparison."id" = NEW."comparison_id";

  IF source_key IS NULL THEN
    RAISE EXCEPTION 'Comparison offer has no valid marketplace source'
      USING ERRCODE = '23514';
  END IF;

  IF source_key = 'xianyu' AND (
    NEW."source_listing_id" !~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'
    OR NEW."source_url" <>
      'https://www.goofish.com/item?id=' || NEW."source_listing_id"
  ) THEN
    RAISE EXCEPTION 'Xianyu offer URL and listing ID are not canonical'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER "comparison_offers_identity_guard"
BEFORE INSERT OR UPDATE OF
  "comparison_id", "source_listing_id", "source_url"
ON "comparison_offers"
FOR EACH ROW
EXECUTE FUNCTION enforce_comparison_offer_identity();

CREATE FUNCTION protect_published_comparison_offers()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  comparison_id TEXT;
BEGIN
  comparison_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD."comparison_id"
    ELSE NEW."comparison_id"
  END;

  IF EXISTS (
    SELECT 1
    FROM "product_market_comparisons"
    WHERE "id" = comparison_id
      AND "status" = 'ready'
      AND "refresh_token" IS NULL
  ) THEN
    RAISE EXCEPTION 'Published comparison offers require an acquired refresh lease'
      USING ERRCODE = '23514';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$function$;

CREATE TRIGGER "comparison_offers_published_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "comparison_offers"
FOR EACH ROW
EXECUTE FUNCTION protect_published_comparison_offers();

CREATE FUNCTION comparison_offer_has_audited_availability(
  provider_key TEXT,
  source_data JSONB,
  last_seen_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN provider_key !~ '^apify:' THEN true
    WHEN lower(COALESCE(source_data ->> 'detailStatus', '')) = 'full' THEN true
    WHEN lower(COALESCE(source_data ->> 'detailStatus', '')) = 'summary'
      AND source_data ->> 'availabilityEvidence' = 'apify_current_search_result'
      AND COALESCE(source_data ->> 'availabilityObservedAt', '') ~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
    THEN abs(EXTRACT(EPOCH FROM (
      last_seen_at - (source_data ->> 'availabilityObservedAt')::TIMESTAMPTZ
    ))) <= 1800
    ELSE false
  END
$function$;

CREATE FUNCTION enforce_ready_comparison_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  source_key TEXT;
  candidate_count INTEGER;
  accepted_count INTEGER;
BEGIN
  IF NEW."status" <> 'ready' THEN
    RETURN NEW;
  END IF;

  SELECT "key"
  INTO source_key
  FROM "Source"
  WHERE "id" = NEW."source_id";

  IF source_key = 'xianyu' AND NEW."reference_url" !~
    '^https://www[.]goofish[.]com/item[?]id=[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'
  THEN
    RAISE EXCEPTION 'Ready Xianyu summary requires a canonical item URL'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)
  INTO candidate_count
  FROM "comparison_offers" offer
  WHERE offer."comparison_id" = NEW."id"
    AND offer."last_seen_at" = NEW."observed_at"
    AND offer."query_keyword" = ANY(NEW."search_keywords");

  IF candidate_count <> NEW."candidate_count" THEN
    RAISE EXCEPTION 'Ready comparison candidate count is not backed by current offers'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)
  INTO accepted_count
  FROM "comparison_offers" offer
  WHERE offer."comparison_id" = NEW."id"
    AND offer."status" = 'active'
    AND offer."match_decision" IN ('auto_matched', 'manually_matched')
    AND offer."last_seen_at" = NEW."observed_at"
    AND offer."query_keyword" = ANY(NEW."search_keywords")
    AND comparison_offer_has_audited_availability(
      offer."provider_key",
      offer."source_data",
      offer."last_seen_at"
    );

  IF accepted_count < 3 OR accepted_count <> NEW."matched_count" THEN
    RAISE EXCEPTION 'Ready comparison sample count is not backed by current offers'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "comparison_offers" offer
    WHERE offer."comparison_id" = NEW."id"
      AND offer."status" = 'active'
      AND offer."match_decision" IN ('auto_matched', 'manually_matched')
      AND offer."last_seen_at" = NEW."observed_at"
      AND offer."query_keyword" = ANY(NEW."search_keywords")
      AND comparison_offer_has_audited_availability(
        offer."provider_key",
        offer."source_data",
        offer."last_seen_at"
      )
      AND offer."source_url" = NEW."reference_url"
      AND offer."title_raw" = NEW."reference_title"
      AND offer."price_cny" = NEW."reference_price_cny"
  ) THEN
    RAISE EXCEPTION 'Ready comparison price/link pair has no representative offer'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER "product_market_comparisons_ready_evidence_guard"
BEFORE INSERT OR UPDATE ON "product_market_comparisons"
FOR EACH ROW
EXECUTE FUNCTION enforce_ready_comparison_evidence();
