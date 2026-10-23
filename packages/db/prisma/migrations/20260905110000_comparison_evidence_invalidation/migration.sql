BEGIN;

CREATE FUNCTION invalidate_comparison_cross_market_opportunities()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "cross_market_opportunities"
  SET "status" = 'needs_facts',
      "missing_facts" = ARRAY['comparison_freshness'],
      "rejection_reason" = NULL,
      "evaluated_at" = CURRENT_TIMESTAMP,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE "comparison_id" = NEW."id" AND "status" = 'ready';
  RETURN NEW;
END;
$$;

CREATE TRIGGER "comparison_cross_market_opportunity_invalidation"
AFTER UPDATE OF "status", "product_id", "source_id", "reference_price_cny",
  "reference_url", "reference_title", "matched_count", "confidence",
  "observed_at", "last_error"
ON "product_market_comparisons"
FOR EACH ROW
WHEN (
  OLD."status" IS DISTINCT FROM NEW."status"
  OR OLD."product_id" IS DISTINCT FROM NEW."product_id"
  OR OLD."source_id" IS DISTINCT FROM NEW."source_id"
  OR OLD."reference_price_cny" IS DISTINCT FROM NEW."reference_price_cny"
  OR OLD."reference_url" IS DISTINCT FROM NEW."reference_url"
  OR OLD."reference_title" IS DISTINCT FROM NEW."reference_title"
  OR OLD."matched_count" IS DISTINCT FROM NEW."matched_count"
  OR OLD."confidence" IS DISTINCT FROM NEW."confidence"
  OR OLD."observed_at" IS DISTINCT FROM NEW."observed_at"
  OR OLD."last_error" IS DISTINCT FROM NEW."last_error"
)
EXECUTE FUNCTION invalidate_comparison_cross_market_opportunities();

CREATE FUNCTION invalidate_exchange_cross_market_opportunities()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."pair" = 'JPY_CNY' THEN
    UPDATE "cross_market_opportunities"
    SET "status" = 'needs_facts',
        "missing_facts" = ARRAY['exchange_rate'],
        "rejection_reason" = NULL,
        "evaluated_at" = CURRENT_TIMESTAMP,
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "status" = 'ready';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "exchange_cross_market_opportunity_invalidation"
AFTER UPDATE OF "pair", "rate", "fetched_at" ON "exchange_rates"
FOR EACH ROW
WHEN (
  OLD."pair" IS DISTINCT FROM NEW."pair"
  OR OLD."rate" IS DISTINCT FROM NEW."rate"
  OR OLD."fetched_at" IS DISTINCT FROM NEW."fetched_at"
)
EXECUTE FUNCTION invalidate_exchange_cross_market_opportunities();

CREATE TRIGGER "exchange_cross_market_opportunity_removal"
AFTER DELETE ON "exchange_rates"
FOR EACH ROW EXECUTE FUNCTION invalidate_exchange_cross_market_opportunities();

-- Historical failures stay auditable, but cannot remain current price evidence.
UPDATE "product_market_comparisons"
SET "status" = 'failed', "updated_at" = CURRENT_TIMESTAMP
WHERE "status" = 'ready' AND "last_error" IS NOT NULL;

UPDATE "cross_market_opportunities" AS opportunity
SET "status" = 'needs_facts',
    "missing_facts" = ARRAY['comparison_freshness'],
    "rejection_reason" = NULL,
    "evaluated_at" = CURRENT_TIMESTAMP,
    "updated_at" = CURRENT_TIMESTAMP
FROM "product_market_comparisons" AS comparison
WHERE opportunity."comparison_id" = comparison."id"
  AND opportunity."status" = 'ready'
  AND (
    comparison."status" <> 'ready'
    OR comparison."last_error" IS NOT NULL
    OR comparison."observed_at" IS DISTINCT FROM opportunity."comparison_observed_at"
    OR comparison."reference_price_cny" IS DISTINCT FROM opportunity."xianyu_reference_price_cny"
  );

COMMIT;
