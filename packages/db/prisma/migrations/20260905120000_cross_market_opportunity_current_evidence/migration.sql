BEGIN;

-- A worker can spend time evaluating an opportunity after it reads its source
-- rows. This guard makes the final write fail closed when that evidence is no
-- longer the currently published comparison/rate/source identity. FOR SHARE
-- also closes the inverse race: a source update that starts after this check
-- waits for the write and then the invalidation triggers below withdraw it.
CREATE FUNCTION enforce_current_cross_market_opportunity_evidence()
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
  comparison_observed_at TIMESTAMPTZ;
  comparison_source_key TEXT;
  comparison_source_only BOOLEAN;
  item_product_id TEXT;
  item_source_key TEXT;
  item_source_only BOOLEAN;
  current_rate NUMERIC;
  current_rate_source TEXT;
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
     OR NEW."evidence" #> '{comparison,matchedCount}'
          IS DISTINCT FROM to_jsonb(comparison_matched_count)
     OR NEW."evidence" #> '{comparison,confidence}'
          IS DISTINCT FROM to_jsonb(comparison_confidence)
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

  SELECT item."product_id", source."key", source."comparison_only"
  INTO item_product_id, item_source_key, item_source_only
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
  THEN
    NEW."status" := 'needs_facts';
    NEW."missing_facts" := ARRAY['listing_identity'];
    NEW."rejection_reason" := NULL;
    NEW."evaluated_at" := CURRENT_TIMESTAMP;
    NEW."updated_at" := CURRENT_TIMESTAMP;
    RETURN NEW;
  END IF;

  SELECT "rate", "source", "fetched_at"
  INTO current_rate, current_rate_source, current_rate_fetched_at
  FROM "exchange_rates"
  WHERE "pair" = 'JPY_CNY'
  FOR SHARE;

  IF NOT FOUND
     OR current_rate IS DISTINCT FROM NEW."jpy_to_cny_rate"
     OR current_rate_fetched_at IS DISTINCT FROM NEW."exchange_rate_fetched_at"
     OR NEW."evidence" #>> '{exchangeRate,source}'
          IS DISTINCT FROM current_rate_source
  THEN
    NEW."status" := 'needs_facts';
    NEW."missing_facts" := ARRAY['exchange_rate'];
    NEW."rejection_reason" := NULL;
    NEW."evaluated_at" := CURRENT_TIMESTAMP;
    NEW."updated_at" := CURRENT_TIMESTAMP;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "cross_market_opportunity_current_evidence_guard"
BEFORE INSERT OR UPDATE OF
  "status",
  "product_id",
  "japan_item_id",
  "comparison_id",
  "xianyu_reference_price_cny",
  "jpy_to_cny_rate",
  "evidence",
  "comparison_observed_at",
  "exchange_rate_fetched_at"
ON "cross_market_opportunities"
FOR EACH ROW
EXECUTE FUNCTION enforce_current_cross_market_opportunity_evidence();

CREATE FUNCTION invalidate_source_cross_market_opportunities()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "cross_market_opportunities" AS opportunity
  SET "status" = 'needs_facts',
      "missing_facts" = ARRAY['comparison_identity', 'listing_identity'],
      "rejection_reason" = NULL,
      "evaluated_at" = CURRENT_TIMESTAMP,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE opportunity."status" = 'ready'
    AND (
      EXISTS (
        SELECT 1
        FROM "product_market_comparisons" AS comparison
        WHERE comparison."id" = opportunity."comparison_id"
          AND comparison."source_id" = NEW."id"
      )
      OR EXISTS (
        SELECT 1
        FROM "Item" AS item
        WHERE item."id" = opportunity."japan_item_id"
          AND item."sourceId" = NEW."id"
      )
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "source_cross_market_opportunity_invalidation"
AFTER UPDATE OF "key", "comparison_only" ON "Source"
FOR EACH ROW
WHEN (
  OLD."key" IS DISTINCT FROM NEW."key"
  OR OLD."comparison_only" IS DISTINCT FROM NEW."comparison_only"
)
EXECUTE FUNCTION invalidate_source_cross_market_opportunities();

-- The original item invalidation trigger predates source switching.
CREATE TRIGGER "item_source_cross_market_opportunity_invalidation"
AFTER UPDATE OF "sourceId" ON "Item"
FOR EACH ROW
WHEN (OLD."sourceId" IS DISTINCT FROM NEW."sourceId")
EXECUTE FUNCTION invalidate_item_cross_market_opportunities();

-- Rate provenance is evidence too, even when the numeric rate is unchanged.
CREATE TRIGGER "exchange_provenance_cross_market_opportunity_invalidation"
AFTER UPDATE OF "source", "reference_date" ON "exchange_rates"
FOR EACH ROW
WHEN (
  OLD."source" IS DISTINCT FROM NEW."source"
  OR OLD."reference_date" IS DISTINCT FROM NEW."reference_date"
)
EXECUTE FUNCTION invalidate_exchange_cross_market_opportunities();

-- Preserve historical values for audit, but withdraw every row whose current
-- dependencies no longer exactly support a ready claim.
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
      AND exchange_rate."rate" = opportunity."jpy_to_cny_rate"
      AND exchange_rate."fetched_at" = opportunity."exchange_rate_fetched_at"
      AND opportunity."evidence" #> '{comparison,matchedCount}'
            = to_jsonb(comparison."matched_count")
      AND opportunity."evidence" #> '{comparison,confidence}'
            = to_jsonb(comparison."confidence")
      AND opportunity."evidence" #>> '{comparison,referenceUrl}'
            IS NOT DISTINCT FROM comparison."reference_url"
      AND opportunity."evidence" #>> '{comparison,referenceTitle}'
            IS NOT DISTINCT FROM comparison."reference_title"
      AND opportunity."evidence" #>> '{exchangeRate,source}'
            IS NOT DISTINCT FROM exchange_rate."source"
  );

COMMIT;
