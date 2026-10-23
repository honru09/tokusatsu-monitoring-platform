BEGIN;

-- The three earlier migrations above this file have already shipped. Their
-- checksums are immutable, so all later evidence hardening is applied forward
-- here for both existing databases and fresh installations.
ALTER TABLE "cross_market_opportunities"
  ADD COLUMN "listing_observed_at" TIMESTAMPTZ,
  ADD COLUMN "evidence_expires_at" TIMESTAMPTZ;

UPDATE "cross_market_opportunities"
SET "evidence" = COALESCE("evidence", '{}'::JSONB);

UPDATE "cross_market_opportunities" AS opportunity
SET "listing_observed_at" = LEAST(
  item."lastSeenAt",
  opportunity."evaluated_at" + INTERVAL '5 minutes'
)
FROM "Item" AS item
WHERE item."id" = opportunity."japan_item_id";

UPDATE "cross_market_opportunities"
SET "listing_observed_at" = "evaluated_at"
WHERE "listing_observed_at" IS NULL;

UPDATE "cross_market_opportunities"
SET "evidence_expires_at" = LEAST(
  "listing_observed_at" + INTERVAL '24 hours',
  "comparison_observed_at" + INTERVAL '24 hours',
  COALESCE(
    "exchange_rate_fetched_at" + INTERVAL '36 hours',
    "comparison_observed_at" + INTERVAL '24 hours'
  )
)
WHERE "evidence_expires_at" IS NULL;

-- Migration 1600 has already withdrawn every ready row before introducing the
-- append-only comparison-run FK. Repeat the fail-closed update so this forward
-- migration remains correct if an operator inserted a row between deploys.
UPDATE "cross_market_opportunities"
SET "status" = 'needs_facts',
    "missing_facts" = ARRAY[
      'listing_freshness',
      'comparison_freshness',
      'exchange_rate_freshness'
    ],
    "rejection_reason" = NULL,
    "evaluated_at" = CURRENT_TIMESTAMP,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "status" = 'ready';

ALTER TABLE "cross_market_opportunities"
  ALTER COLUMN "evidence" SET NOT NULL,
  ALTER COLUMN "listing_observed_at" SET NOT NULL,
  DROP CONSTRAINT "cross_market_opportunities_reference_price_check",
  DROP CONSTRAINT "cross_market_opportunities_rate_check",
  DROP CONSTRAINT "cross_market_opportunities_evidence_object_check",
  DROP CONSTRAINT "cross_market_opportunities_ready_check",
  ADD CONSTRAINT "cross_market_opportunities_reference_price_check" CHECK (
    "xianyu_reference_price_cny" <> 'NaN'::NUMERIC
    AND "xianyu_reference_price_cny" > 0
  ) NOT VALID,
  ADD CONSTRAINT "cross_market_opportunities_rate_check" CHECK (
    "jpy_to_cny_rate" IS NULL
    OR (
      "jpy_to_cny_rate" <> 'NaN'::NUMERIC
      AND "jpy_to_cny_rate" > 0
    )
  ) NOT VALID,
  ADD CONSTRAINT "cross_market_opportunities_decimal_check" CHECK (
    "gross_spread_cny" IS NULL
    OR "gross_spread_cny" <> 'NaN'::NUMERIC
  ) NOT VALID,
  ADD CONSTRAINT "cross_market_opportunities_evidence_object_check" CHECK (
    jsonb_typeof("evidence") = 'object'
  ) NOT VALID,
  ADD CONSTRAINT "cross_market_opportunities_time_order_check" CHECK (
    "listing_observed_at" <= "evaluated_at" + INTERVAL '5 minutes'
    AND "comparison_observed_at" <= "evaluated_at" + INTERVAL '5 minutes'
    AND (
      "exchange_rate_fetched_at" IS NULL
      OR "exchange_rate_fetched_at" <= "evaluated_at" + INTERVAL '5 minutes'
    )
    AND (
      "evidence_expires_at" IS NULL
      OR "evidence_expires_at" > LEAST(
        "listing_observed_at",
        "comparison_observed_at",
        COALESCE("exchange_rate_fetched_at", "comparison_observed_at")
      )
    )
  ) NOT VALID,
  ADD CONSTRAINT "cross_market_opportunities_ready_check" CHECK (
    "status" <> 'ready'
    OR (
      cardinality("missing_facts") = 0
      AND "comparison_observed_at" IS NOT NULL
      AND "exchange_rate_fetched_at" IS NOT NULL
      AND "jpy_to_cny_rate" IS NOT NULL
      AND "acquisition_cost_jpy" IS NOT NULL
      AND "gross_revenue_jpy" IS NOT NULL
      AND "gross_spread_cny" IS NOT NULL
      AND "gross_spread_cny" > 0
      AND "gross_spread_ratio" IS NOT NULL
      AND "gross_spread_ratio" > 0
      AND "platform_fee_jpy" IS NOT NULL
      AND "international_shipping_jpy" IS NOT NULL
      AND "china_fulfillment_jpy" IS NOT NULL
      AND "net_profit_jpy" IS NOT NULL
      AND "net_margin_ratio" IS NOT NULL
      AND "net_profit_jpy" > 0
      AND "net_margin_ratio" > 0
      AND "net_margin_ratio" <= 1
      AND "evidence_expires_at" IS NOT NULL
      AND "evidence_expires_at" > "evaluated_at"
      AND "rejection_reason" IS NULL
    )
  ) NOT VALID;

CREATE OR REPLACE FUNCTION enforce_cross_market_opportunity_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  item_product_id TEXT;
  item_source_key TEXT;
  item_comparison_only_source BOOLEAN;
  comparison_product_id TEXT;
  comparison_source_key TEXT;
  comparison_only_source BOOLEAN;
BEGIN
  SELECT item."product_id", source."key", source."comparison_only"
  INTO item_product_id, item_source_key, item_comparison_only_source
  FROM "Item" item
  JOIN "Source" source ON source."id" = item."sourceId"
  WHERE item."id" = NEW."japan_item_id";

  SELECT comparison."product_id", source."key", source."comparison_only"
  INTO comparison_product_id, comparison_source_key, comparison_only_source
  FROM "product_market_comparisons" comparison
  JOIN "Source" source ON source."id" = comparison."source_id"
  WHERE comparison."id" = NEW."comparison_id";

  IF item_product_id IS DISTINCT FROM NEW."product_id"
     OR item_comparison_only_source IS DISTINCT FROM FALSE
     OR item_source_key NOT IN (
       'mandarake',
       'mercari',
       'yahoo_auctions',
       'yahoo_fleamarket',
       'yahoo_shopping',
       'rakuma',
       'surugaya'
     )
     OR comparison_product_id IS DISTINCT FROM NEW."product_id"
     OR comparison_source_key IS DISTINCT FROM 'xianyu'
     OR comparison_only_source IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      'Cross-market opportunity must pair one Japan listing and comparison for the same product';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER "item_cross_market_opportunity_invalidation" ON "Item";
CREATE TRIGGER "item_cross_market_opportunity_invalidation"
AFTER UPDATE OF
  "product_id",
  "sourceItemId",
  "sourceUrl",
  "titleRaw",
  "priceCurrent",
  "shippingFee",
  "listingType",
  "categoryToyType",
  "quantityEst",
  "conditionGrade",
  "status",
  "archivedAt",
  "ignored",
  "lastSeenAt",
  "match_confidence",
  "match_decision"
ON "Item"
FOR EACH ROW
WHEN (
  OLD."product_id" IS DISTINCT FROM NEW."product_id"
  OR OLD."sourceItemId" IS DISTINCT FROM NEW."sourceItemId"
  OR OLD."sourceUrl" IS DISTINCT FROM NEW."sourceUrl"
  OR OLD."titleRaw" IS DISTINCT FROM NEW."titleRaw"
  OR OLD."priceCurrent" IS DISTINCT FROM NEW."priceCurrent"
  OR OLD."shippingFee" IS DISTINCT FROM NEW."shippingFee"
  OR OLD."listingType" IS DISTINCT FROM NEW."listingType"
  OR OLD."categoryToyType" IS DISTINCT FROM NEW."categoryToyType"
  OR OLD."quantityEst" IS DISTINCT FROM NEW."quantityEst"
  OR OLD."conditionGrade" IS DISTINCT FROM NEW."conditionGrade"
  OR OLD."status" IS DISTINCT FROM NEW."status"
  OR OLD."archivedAt" IS DISTINCT FROM NEW."archivedAt"
  OR OLD."ignored" IS DISTINCT FROM NEW."ignored"
  OR OLD."lastSeenAt" IS DISTINCT FROM NEW."lastSeenAt"
  OR OLD."match_confidence" IS DISTINCT FROM NEW."match_confidence"
  OR OLD."match_decision" IS DISTINCT FROM NEW."match_decision"
)
EXECUTE FUNCTION invalidate_item_cross_market_opportunities();

DROP TRIGGER "comparison_cross_market_opportunity_invalidation" ON "product_market_comparisons";
CREATE TRIGGER "comparison_cross_market_opportunity_invalidation"
AFTER UPDATE OF "status", "product_id", "source_id", "search_keywords",
  "candidate_count", "matched_count", "reference_price_cny", "min_price_cny",
  "max_price_cny", "reference_url", "reference_title", "confidence",
  "comparison_method", "keyword_identity_hash", "provider_stats",
  "observed_at", "last_error"
ON "product_market_comparisons"
FOR EACH ROW
WHEN (
  OLD."status" IS DISTINCT FROM NEW."status"
  OR OLD."product_id" IS DISTINCT FROM NEW."product_id"
  OR OLD."source_id" IS DISTINCT FROM NEW."source_id"
  OR OLD."search_keywords" IS DISTINCT FROM NEW."search_keywords"
  OR OLD."candidate_count" IS DISTINCT FROM NEW."candidate_count"
  OR OLD."matched_count" IS DISTINCT FROM NEW."matched_count"
  OR OLD."reference_price_cny" IS DISTINCT FROM NEW."reference_price_cny"
  OR OLD."min_price_cny" IS DISTINCT FROM NEW."min_price_cny"
  OR OLD."max_price_cny" IS DISTINCT FROM NEW."max_price_cny"
  OR OLD."reference_url" IS DISTINCT FROM NEW."reference_url"
  OR OLD."reference_title" IS DISTINCT FROM NEW."reference_title"
  OR OLD."confidence" IS DISTINCT FROM NEW."confidence"
  OR OLD."comparison_method" IS DISTINCT FROM NEW."comparison_method"
  OR OLD."keyword_identity_hash" IS DISTINCT FROM NEW."keyword_identity_hash"
  OR OLD."provider_stats" IS DISTINCT FROM NEW."provider_stats"
  OR OLD."observed_at" IS DISTINCT FROM NEW."observed_at"
  OR OLD."last_error" IS DISTINCT FROM NEW."last_error"
)
EXECUTE FUNCTION invalidate_comparison_cross_market_opportunities();

CREATE OR REPLACE FUNCTION invalidate_exchange_cross_market_opportunities()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (
    TG_OP = 'DELETE' AND OLD."pair" = 'JPY_CNY'
  ) OR (
    TG_OP = 'UPDATE'
    AND (OLD."pair" = 'JPY_CNY' OR NEW."pair" = 'JPY_CNY')
  ) THEN
    UPDATE "cross_market_opportunities"
    SET "status" = 'needs_facts',
        "missing_facts" = ARRAY['exchange_rate'],
        "rejection_reason" = NULL,
        "evaluated_at" = CURRENT_TIMESTAMP,
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "status" = 'ready';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION comparison_offer_is_verified_match(
  decision "MatchDecision",
  confidence DOUBLE PRECISION,
  evidence JSONB
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT
    decision IN ('auto_matched', 'manually_matched')
    AND jsonb_typeof(evidence) = 'object'
    AND jsonb_typeof(evidence -> 'deterministic') = 'object'
    AND jsonb_typeof(evidence #> '{deterministic,score}') = 'number'
    AND jsonb_typeof(evidence #> '{deterministic,factors}') = 'object'
    AND jsonb_typeof(evidence #> '{deterministic,reasons}') = 'array'
    AND jsonb_typeof(evidence #> '{deterministic,excluded}') = 'boolean'
    AND COALESCE((evidence #>> '{deterministic,excluded}')::BOOLEAN, true) = false
    AND (
      decision = 'manually_matched'
      OR (
        confidence IS NOT NULL
        AND confidence NOT IN (
          'NaN'::DOUBLE PRECISION,
          'Infinity'::DOUBLE PRECISION,
          '-Infinity'::DOUBLE PRECISION
        )
        AND confidence BETWEEN 0.85 AND 1
      )
    );
$function$;

CREATE OR REPLACE FUNCTION enforce_ready_comparison_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  source_key TEXT;
  candidate_count INTEGER;
  accepted_count INTEGER;
  unique_keyword_count INTEGER;
BEGIN
  IF NEW."status" <> 'ready' THEN
    RETURN NEW;
  END IF;

  SELECT "key"
  INTO source_key
  FROM "Source"
  WHERE "id" = NEW."source_id";

  IF source_key IS DISTINCT FROM 'xianyu'
     OR NEW."reference_url" !~
       '^https://www[.]goofish[.]com/item[?]id=[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'
  THEN
    RAISE EXCEPTION 'Ready Xianyu summary requires its canonical source identity'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(DISTINCT lower(trim(keyword)))
  INTO unique_keyword_count
  FROM unnest(NEW."search_keywords") AS keyword;
  IF unique_keyword_count <> cardinality(NEW."search_keywords")
     OR EXISTS (
       SELECT 1
       FROM unnest(NEW."search_keywords") AS keyword
       WHERE length(trim(keyword)) NOT BETWEEN 2 AND 240
     )
  THEN
    RAISE EXCEPTION 'Ready comparison keywords must be distinct non-empty phrases'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."comparison_method" !~
       '^[A-Za-z0-9][A-Za-z0-9._:-]{0,69}(?:[-_:]v[0-9]+(?:[.][0-9]+)*)$'
     OR NEW."confidence" IS NULL
     OR NEW."confidence" IN (
       'NaN'::DOUBLE PRECISION,
       'Infinity'::DOUBLE PRECISION,
       '-Infinity'::DOUBLE PRECISION
     )
     OR NEW."confidence" NOT BETWEEN 0.85 AND 1
  THEN
    RAISE EXCEPTION 'Ready comparison requires a versioned matcher and confidence >= 0.85'
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
    AND comparison_offer_is_verified_match(
      offer."match_decision",
      offer."match_confidence",
      offer."match_evidence"
    )
    AND offer."last_seen_at" = NEW."observed_at"
    AND offer."query_keyword" = ANY(NEW."search_keywords")
    AND comparison_offer_has_audited_availability(
      offer."provider_key",
      offer."source_data",
      offer."last_seen_at"
    );

  IF accepted_count < 3 OR accepted_count <> NEW."matched_count" THEN
    RAISE EXCEPTION 'Ready comparison sample count is not backed by verified current offers'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "comparison_offers" offer
    WHERE offer."comparison_id" = NEW."id"
      AND offer."status" = 'active'
      AND comparison_offer_is_verified_match(
        offer."match_decision",
        offer."match_confidence",
        offer."match_evidence"
      )
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
    RAISE EXCEPTION 'Ready comparison price and URL must come from one verified offer'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

-- A worker can spend time evaluating an opportunity after it reads its source
-- rows. This guard makes the final write fail closed when that evidence is no
-- longer the currently published comparison/rate/source identity. FOR SHARE
-- also closes the inverse race: a source update that starts after this check
-- waits for the write and then the invalidation triggers below withdraw it.

CREATE OR REPLACE FUNCTION enforce_current_cross_market_opportunity_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  comparison_status "MarketComparisonStatus";
  comparison_error TEXT;
  comparison_product_id TEXT;
  comparison_reference_price NUMERIC;
  comparison_reference_url TEXT;
  comparison_reference_title TEXT;
  comparison_matched_count INTEGER;
  comparison_confidence DOUBLE PRECISION;
  comparison_method TEXT;
  comparison_keyword_hash TEXT;
  comparison_search_keywords TEXT[];
  comparison_candidate_count INTEGER;
  comparison_provider_stats JSONB;
  comparison_observed_at TIMESTAMPTZ;
  comparison_source_key TEXT;
  comparison_source_only BOOLEAN;
  item_product_id TEXT;
  item_source_key TEXT;
  item_source_only BOOLEAN;
  item_source_item_id TEXT;
  item_source_url TEXT;
  item_title_raw TEXT;
  item_price_current INTEGER;
  item_shipping_fee INTEGER;
  item_listing_type TEXT;
  item_category_toy_type TEXT;
  item_quantity INTEGER;
  item_condition_grade TEXT;
  item_status TEXT;
  item_archived_at TIMESTAMPTZ;
  item_ignored BOOLEAN;
  item_match_decision TEXT;
  item_match_confidence DOUBLE PRECISION;
  item_last_seen_at TIMESTAMPTZ;
  current_rate NUMERIC;
  current_rate_source TEXT;
  current_rate_reference_date DATE;
  current_rate_fetched_at TIMESTAMPTZ;
BEGIN
  IF NEW."status" <> 'ready' THEN
    RETURN NEW;
  END IF;

  SELECT
    comparison."status",
    comparison."last_error",
    comparison."product_id",
    comparison."reference_price_cny",
    comparison."reference_url",
    comparison."reference_title",
    comparison."matched_count",
    comparison."confidence",
    comparison."comparison_method",
    comparison."keyword_identity_hash",
    comparison."search_keywords",
    comparison."candidate_count",
    comparison."provider_stats",
    comparison."observed_at",
    source."key",
    source."comparison_only"
  INTO
    comparison_status,
    comparison_error,
    comparison_product_id,
    comparison_reference_price,
    comparison_reference_url,
    comparison_reference_title,
    comparison_matched_count,
    comparison_confidence,
    comparison_method,
    comparison_keyword_hash,
    comparison_search_keywords,
    comparison_candidate_count,
    comparison_provider_stats,
    comparison_observed_at,
    comparison_source_key,
    comparison_source_only
  FROM "product_market_comparisons" AS comparison
  JOIN "Source" AS source ON source."id" = comparison."source_id"
  WHERE comparison."id" = NEW."comparison_id"
  FOR SHARE OF comparison, source;

  IF NOT FOUND
     OR comparison_status <> 'ready'
     OR comparison_error IS NOT NULL
     OR comparison_product_id IS DISTINCT FROM NEW."product_id"
     OR comparison_source_key IS DISTINCT FROM 'xianyu'
     OR comparison_source_only IS DISTINCT FROM TRUE
     OR comparison_reference_price IS DISTINCT FROM NEW."xianyu_reference_price_cny"
     OR comparison_observed_at IS DISTINCT FROM NEW."comparison_observed_at"
     OR comparison_observed_at < CURRENT_TIMESTAMP - INTERVAL '24 hours'
     OR comparison_observed_at > NEW."evaluated_at" + INTERVAL '5 minutes'
     OR NEW."evidence" #>> '{assessmentVersion}'
          IS DISTINCT FROM 'cross-market-opportunity-v1'
     OR NEW."evidence" #>> '{comparison,method}'
          IS DISTINCT FROM comparison_method
     OR NEW."evidence" #>> '{comparison,keywordIdentityHash}'
          IS DISTINCT FROM comparison_keyword_hash
     OR NEW."evidence" #> '{comparison,searchKeywords}'
          IS DISTINCT FROM to_jsonb(comparison_search_keywords)
     OR NEW."evidence" #> '{comparison,candidateCount}'
          IS DISTINCT FROM to_jsonb(comparison_candidate_count)
     OR NEW."evidence" #> '{comparison,matchedCount}'
          IS DISTINCT FROM to_jsonb(comparison_matched_count)
     OR NEW."evidence" #> '{comparison,confidence}'
          IS DISTINCT FROM to_jsonb(comparison_confidence)
     OR NEW."evidence" #> '{comparison,providerStats}'
          IS DISTINCT FROM COALESCE(
            to_jsonb(comparison_provider_stats),
            'null'::JSONB
          )
     OR NEW."evidence" #> '{comparison,referencePriceCny}'
          IS DISTINCT FROM to_jsonb(comparison_reference_price)
     OR NEW."evidence" #>> '{comparison,referenceUrl}'
          IS DISTINCT FROM comparison_reference_url
     OR NEW."evidence" #>> '{comparison,referenceTitle}'
          IS DISTINCT FROM comparison_reference_title
  THEN
    NEW."status" := 'needs_facts';
    NEW."missing_facts" := ARRAY['comparison_freshness'];
    NEW."rejection_reason" := NULL;
    NEW."evaluated_at" := CURRENT_TIMESTAMP;
    NEW."updated_at" := CURRENT_TIMESTAMP;
    RETURN NEW;
  END IF;

  SELECT
    item."product_id",
    source."key",
    source."comparison_only",
    item."sourceItemId",
    item."sourceUrl",
    item."titleRaw",
    item."priceCurrent",
    item."shippingFee",
    item."listingType"::TEXT,
    item."categoryToyType"::TEXT,
    item."quantityEst",
    item."conditionGrade"::TEXT,
    item."status"::TEXT,
    item."archivedAt",
    item."ignored",
    item."match_decision"::TEXT,
    item."match_confidence",
    item."lastSeenAt"
  INTO
    item_product_id,
    item_source_key,
    item_source_only,
    item_source_item_id,
    item_source_url,
    item_title_raw,
    item_price_current,
    item_shipping_fee,
    item_listing_type,
    item_category_toy_type,
    item_quantity,
    item_condition_grade,
    item_status,
    item_archived_at,
    item_ignored,
    item_match_decision,
    item_match_confidence,
    item_last_seen_at
  FROM "Item" AS item
  JOIN "Source" AS source ON source."id" = item."sourceId"
  WHERE item."id" = NEW."japan_item_id"
  FOR SHARE OF item, source;

  IF NOT FOUND
     OR item_product_id IS DISTINCT FROM NEW."product_id"
     OR item_source_only IS DISTINCT FROM FALSE
     OR item_source_key NOT IN (
       'mandarake',
       'mercari',
       'yahoo_auctions',
       'yahoo_fleamarket',
       'yahoo_shopping',
       'rakuma',
       'surugaya'
     )
     OR item_last_seen_at IS DISTINCT FROM NEW."listing_observed_at"
     OR item_last_seen_at < CURRENT_TIMESTAMP - INTERVAL '24 hours'
     OR item_last_seen_at > NEW."evaluated_at" + INTERVAL '5 minutes'
     OR NEW."evidence" #>> '{listing,sourceKey}'
          IS DISTINCT FROM item_source_key
     OR NEW."evidence" #>> '{listing,sourceItemId}'
          IS DISTINCT FROM item_source_item_id
     OR NEW."evidence" #>> '{listing,sourceUrl}'
          IS DISTINCT FROM item_source_url
     OR NEW."evidence" #>> '{listing,titleRaw}'
          IS DISTINCT FROM item_title_raw
     OR NEW."evidence" #> '{listing,priceCurrent}'
          IS DISTINCT FROM to_jsonb(item_price_current)
     OR NEW."evidence" #> '{listing,shippingFee}'
          IS DISTINCT FROM COALESCE(to_jsonb(item_shipping_fee), 'null'::JSONB)
     OR NEW."evidence" #>> '{listing,listingType}'
          IS DISTINCT FROM item_listing_type
     OR NEW."evidence" #>> '{listing,categoryToyType}'
          IS DISTINCT FROM item_category_toy_type
     OR NEW."evidence" #> '{listing,quantity}'
          IS DISTINCT FROM COALESCE(to_jsonb(item_quantity), 'null'::JSONB)
     OR NEW."evidence" #>> '{listing,conditionGrade}'
          IS DISTINCT FROM item_condition_grade
     OR NEW."evidence" #>> '{listing,status}'
          IS DISTINCT FROM item_status
     OR NEW."evidence" #> '{listing,archived}'
          IS DISTINCT FROM to_jsonb(item_archived_at IS NOT NULL)
     OR NEW."evidence" #> '{listing,ignored}'
          IS DISTINCT FROM to_jsonb(item_ignored)
     OR NEW."evidence" #>> '{listing,matchDecision}'
          IS DISTINCT FROM item_match_decision
     OR NEW."evidence" #> '{listing,matchConfidence}'
          IS DISTINCT FROM COALESCE(
            to_jsonb(item_match_confidence),
            'null'::JSONB
          )
  THEN
    NEW."status" := 'needs_facts';
    NEW."missing_facts" := ARRAY['listing_identity'];
    NEW."rejection_reason" := NULL;
    NEW."evaluated_at" := CURRENT_TIMESTAMP;
    NEW."updated_at" := CURRENT_TIMESTAMP;
    RETURN NEW;
  END IF;

  SELECT "rate", "source", "reference_date", "fetched_at"
  INTO
    current_rate,
    current_rate_source,
    current_rate_reference_date,
    current_rate_fetched_at
  FROM "exchange_rates"
  WHERE "pair" = 'JPY_CNY'
  FOR SHARE;

  IF NOT FOUND
     OR current_rate IS DISTINCT FROM NEW."jpy_to_cny_rate"
     OR current_rate_fetched_at IS DISTINCT FROM NEW."exchange_rate_fetched_at"
     OR current_rate_fetched_at < CURRENT_TIMESTAMP - INTERVAL '36 hours'
     OR current_rate_fetched_at > NEW."evaluated_at" + INTERVAL '5 minutes'
     OR NEW."evidence" #> '{exchangeRate,rate}'
          IS DISTINCT FROM to_jsonb(current_rate)
     OR NEW."evidence" #>> '{exchangeRate,source}'
          IS DISTINCT FROM current_rate_source
     OR NEW."evidence" #>> '{exchangeRate,referenceDate}'
          IS DISTINCT FROM current_rate_reference_date::TEXT
  THEN
    NEW."status" := 'needs_facts';
    NEW."missing_facts" := ARRAY['exchange_rate'];
    NEW."rejection_reason" := NULL;
    NEW."evaluated_at" := CURRENT_TIMESTAMP;
    NEW."updated_at" := CURRENT_TIMESTAMP;
    RETURN NEW;
  END IF;

  IF NEW."evaluated_at" > CURRENT_TIMESTAMP + INTERVAL '5 minutes'
     OR NEW."evidence_expires_at" IS NULL
     OR NEW."evidence_expires_at" <= CURRENT_TIMESTAMP
     OR NEW."evidence_expires_at" > LEAST(
       item_last_seen_at + INTERVAL '24 hours',
       comparison_observed_at + INTERVAL '24 hours',
       current_rate_fetched_at + INTERVAL '36 hours'
     )
  THEN
    NEW."status" := 'needs_facts';
    NEW."missing_facts" := ARRAY[
      'listing_freshness',
      'comparison_freshness',
      'exchange_rate_freshness'
    ];
    NEW."rejection_reason" := NULL;
    NEW."evaluated_at" := CURRENT_TIMESTAMP;
    NEW."updated_at" := CURRENT_TIMESTAMP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER "cross_market_opportunity_current_evidence_guard" ON "cross_market_opportunities";
CREATE TRIGGER "cross_market_opportunity_current_evidence_guard"
BEFORE INSERT OR UPDATE OF
  "status",
  "product_id",
  "japan_item_id",
  "comparison_id",
  "xianyu_reference_price_cny",
  "jpy_to_cny_rate",
  "evidence",
  "listing_observed_at",
  "comparison_observed_at",
  "exchange_rate_fetched_at",
  "evidence_expires_at",
  "evaluated_at"
ON "cross_market_opportunities"
FOR EACH ROW
EXECUTE FUNCTION enforce_current_cross_market_opportunity_evidence();

CREATE FUNCTION invalidate_offer_cross_market_opportunities()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_comparison_id TEXT;
  new_comparison_id TEXT;
BEGIN
  old_comparison_id := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."comparison_id" END;
  new_comparison_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."comparison_id" END;

  UPDATE "cross_market_opportunities"
  SET "status" = 'needs_facts',
      "missing_facts" = ARRAY['comparison_identity'],
      "rejection_reason" = NULL,
      "evaluated_at" = CURRENT_TIMESTAMP,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE "status" = 'ready'
    AND "comparison_id" IN (old_comparison_id, new_comparison_id);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "comparison_offer_cross_market_opportunity_invalidation"
AFTER INSERT OR UPDATE OR DELETE ON "comparison_offers"
FOR EACH ROW
EXECUTE FUNCTION invalidate_offer_cross_market_opportunities();

UPDATE "cross_market_opportunities" AS opportunity
SET "status" = 'needs_facts',
    "missing_facts" = ARRAY['comparison_freshness'],
    "rejection_reason" = NULL,
    "evaluated_at" = CURRENT_TIMESTAMP,
    "updated_at" = CURRENT_TIMESTAMP
WHERE opportunity."status" = 'ready'
  AND NOT EXISTS (
    SELECT 1
    FROM "product_market_comparisons" AS comparison
    JOIN "Source" AS comparison_source
      ON comparison_source."id" = comparison."source_id"
    JOIN "Item" AS item ON item."id" = opportunity."japan_item_id"
    JOIN "Source" AS item_source ON item_source."id" = item."sourceId"
    JOIN "exchange_rates" AS exchange_rate
      ON exchange_rate."pair" = 'JPY_CNY'
    WHERE comparison."id" = opportunity."comparison_id"
      AND comparison."status" = 'ready'
      AND comparison."last_error" IS NULL
      AND comparison."product_id" = opportunity."product_id"
      AND item."product_id" = opportunity."product_id"
      AND comparison_source."key" = 'xianyu'
      AND comparison_source."comparison_only"
      AND NOT item_source."comparison_only"
      AND item_source."key" IN (
        'mandarake',
        'mercari',
        'yahoo_auctions',
        'yahoo_fleamarket',
        'yahoo_shopping',
        'rakuma',
        'surugaya'
      )
      AND comparison."reference_price_cny" = opportunity."xianyu_reference_price_cny"
      AND comparison."observed_at" = opportunity."comparison_observed_at"
      AND item."lastSeenAt" = opportunity."listing_observed_at"
      AND exchange_rate."rate" = opportunity."jpy_to_cny_rate"
      AND exchange_rate."fetched_at" = opportunity."exchange_rate_fetched_at"
      AND opportunity."evidence_expires_at" > CURRENT_TIMESTAMP
      AND opportunity."evidence_expires_at" <= LEAST(
        item."lastSeenAt" + INTERVAL '24 hours',
        comparison."observed_at" + INTERVAL '24 hours',
        exchange_rate."fetched_at" + INTERVAL '36 hours'
      )
      AND opportunity."evidence" #>> '{assessmentVersion}'
            = 'cross-market-opportunity-v1'
      AND opportunity."evidence" #>> '{comparison,method}'
            IS NOT DISTINCT FROM comparison."comparison_method"
      AND opportunity."evidence" #>> '{comparison,keywordIdentityHash}'
            IS NOT DISTINCT FROM comparison."keyword_identity_hash"
      AND opportunity."evidence" #> '{comparison,searchKeywords}'
            = to_jsonb(comparison."search_keywords")
      AND opportunity."evidence" #> '{comparison,candidateCount}'
            = to_jsonb(comparison."candidate_count")
      AND opportunity."evidence" #> '{comparison,matchedCount}'
            = to_jsonb(comparison."matched_count")
      AND opportunity."evidence" #> '{comparison,confidence}'
            = to_jsonb(comparison."confidence")
      AND opportunity."evidence" #>> '{comparison,referenceUrl}'
            IS NOT DISTINCT FROM comparison."reference_url"
      AND opportunity."evidence" #>> '{comparison,referenceTitle}'
            IS NOT DISTINCT FROM comparison."reference_title"
      AND opportunity."evidence" #> '{comparison,referencePriceCny}'
            = to_jsonb(comparison."reference_price_cny")
      AND opportunity."evidence" #>> '{listing,sourceKey}'
            = item_source."key"
      AND opportunity."evidence" #>> '{listing,sourceItemId}'
            = item."sourceItemId"
      AND opportunity."evidence" #>> '{listing,sourceUrl}'
            = item."sourceUrl"
      AND opportunity."evidence" #> '{listing,priceCurrent}'
            = to_jsonb(item."priceCurrent")
      AND opportunity."evidence" #>> '{exchangeRate,source}'
            IS NOT DISTINCT FROM exchange_rate."source"
  );

ALTER TABLE "cross_market_opportunities"
  VALIDATE CONSTRAINT "cross_market_opportunities_reference_price_check",
  VALIDATE CONSTRAINT "cross_market_opportunities_rate_check",
  VALIDATE CONSTRAINT "cross_market_opportunities_decimal_check",
  VALIDATE CONSTRAINT "cross_market_opportunities_evidence_object_check",
  VALIDATE CONSTRAINT "cross_market_opportunities_time_order_check",
  VALIDATE CONSTRAINT "cross_market_opportunities_ready_check";

COMMIT;
