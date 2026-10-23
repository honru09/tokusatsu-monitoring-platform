CREATE TYPE "JapanReverseSearchStatus" AS ENUM (
  'idle',
  'skipped',
  'scheduled',
  'failed'
);

CREATE TYPE "CrossMarketOpportunityStatus" AS ENUM (
  'needs_facts',
  'rejected',
  'ready'
);

CREATE TYPE "CrossMarketOpportunityTrigger" AS ENUM (
  'japan_listing',
  'xianyu_reverse_search'
);

ALTER TABLE "product_market_comparisons"
  ADD COLUMN "japan_search_status" "JapanReverseSearchStatus" NOT NULL DEFAULT 'idle',
  ADD COLUMN "japan_search_keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "japan_search_triggered_at" TIMESTAMPTZ,
  ADD COLUMN "japan_search_reason" TEXT;

CREATE TABLE "cross_market_opportunities" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "japan_item_id" TEXT NOT NULL,
  "comparison_id" TEXT NOT NULL,
  "status" "CrossMarketOpportunityStatus" NOT NULL,
  "trigger" "CrossMarketOpportunityTrigger" NOT NULL,
  "xianyu_reference_price_cny" DECIMAL(12, 2) NOT NULL,
  "jpy_to_cny_rate" DECIMAL(18, 8),
  "acquisition_cost_jpy" INTEGER,
  "gross_revenue_jpy" INTEGER,
  "gross_spread_cny" DECIMAL(12, 2),
  "gross_spread_ratio" DOUBLE PRECISION,
  "platform_fee_jpy" INTEGER,
  "international_shipping_jpy" INTEGER,
  "china_fulfillment_jpy" INTEGER,
  "net_profit_jpy" INTEGER,
  "net_margin_ratio" DOUBLE PRECISION,
  "missing_facts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "rejection_reason" TEXT,
  "evidence" JSONB,
  "comparison_observed_at" TIMESTAMPTZ NOT NULL,
  "exchange_rate_fetched_at" TIMESTAMPTZ,
  "evaluated_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "cross_market_opportunities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cross_market_opportunities_reference_price_check"
    CHECK ("xianyu_reference_price_cny" > 0),
  CONSTRAINT "cross_market_opportunities_rate_check"
    CHECK ("jpy_to_cny_rate" IS NULL OR "jpy_to_cny_rate" > 0),
  CONSTRAINT "cross_market_opportunities_costs_check"
    CHECK (
      ("acquisition_cost_jpy" IS NULL OR "acquisition_cost_jpy" >= 0)
      AND ("gross_revenue_jpy" IS NULL OR "gross_revenue_jpy" >= 0)
      AND ("platform_fee_jpy" IS NULL OR "platform_fee_jpy" >= 0)
      AND ("international_shipping_jpy" IS NULL OR "international_shipping_jpy" >= 0)
      AND ("china_fulfillment_jpy" IS NULL OR "china_fulfillment_jpy" >= 0)
    ),
  CONSTRAINT "cross_market_opportunities_ratios_check"
    CHECK (
      (
        "gross_spread_ratio" IS NULL
        OR "gross_spread_ratio" NOT IN (
          'NaN'::DOUBLE PRECISION,
          'Infinity'::DOUBLE PRECISION,
          '-Infinity'::DOUBLE PRECISION
        )
      )
      AND (
        "net_margin_ratio" IS NULL
        OR "net_margin_ratio" NOT IN (
          'NaN'::DOUBLE PRECISION,
          'Infinity'::DOUBLE PRECISION,
          '-Infinity'::DOUBLE PRECISION
        )
      )
    ),
  CONSTRAINT "cross_market_opportunities_evidence_object_check"
    CHECK (
      "evidence" IS NULL
      OR jsonb_typeof("evidence") = 'object'
    ),
  CONSTRAINT "cross_market_opportunities_ready_check"
    CHECK (
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
        AND "rejection_reason" IS NULL
      )
    )
);

CREATE UNIQUE INDEX "cross_market_opportunities_japan_item_id_comparison_id_key"
  ON "cross_market_opportunities"("japan_item_id", "comparison_id");
CREATE INDEX "cross_market_opportunities_status_net_profit_jpy_evaluated_at_idx"
  ON "cross_market_opportunities"("status", "net_profit_jpy", "evaluated_at");
CREATE INDEX "cross_market_opportunities_product_id_status_evaluated_at_idx"
  ON "cross_market_opportunities"("product_id", "status", "evaluated_at");
CREATE INDEX "cross_market_opportunities_comparison_id_status_idx"
  ON "cross_market_opportunities"("comparison_id", "status");

ALTER TABLE "cross_market_opportunities"
  ADD CONSTRAINT "cross_market_opportunities_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cross_market_opportunities"
  ADD CONSTRAINT "cross_market_opportunities_japan_item_id_fkey"
  FOREIGN KEY ("japan_item_id") REFERENCES "Item"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cross_market_opportunities"
  ADD CONSTRAINT "cross_market_opportunities_comparison_id_fkey"
  FOREIGN KEY ("comparison_id") REFERENCES "product_market_comparisons"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION enforce_cross_market_opportunity_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  item_product_id TEXT;
  item_comparison_only_source BOOLEAN;
  comparison_product_id TEXT;
  comparison_only_source BOOLEAN;
BEGIN
  SELECT item."product_id", source."comparison_only"
  INTO item_product_id, item_comparison_only_source
  FROM "Item" item
  JOIN "Source" source ON source."id" = item."sourceId"
  WHERE item."id" = NEW."japan_item_id";

  SELECT comparison."product_id", source."comparison_only"
  INTO comparison_product_id, comparison_only_source
  FROM "product_market_comparisons" comparison
  JOIN "Source" source ON source."id" = comparison."source_id"
  WHERE comparison."id" = NEW."comparison_id";

  IF item_product_id IS DISTINCT FROM NEW."product_id"
     OR item_comparison_only_source IS DISTINCT FROM FALSE
     OR comparison_product_id IS DISTINCT FROM NEW."product_id"
     OR comparison_only_source IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      'Cross-market opportunity must pair one Japan listing and comparison for the same product';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "cross_market_opportunity_identity_guard"
BEFORE INSERT OR UPDATE OF "product_id", "japan_item_id", "comparison_id"
ON "cross_market_opportunities"
FOR EACH ROW
EXECUTE FUNCTION enforce_cross_market_opportunity_identity();

CREATE OR REPLACE FUNCTION invalidate_item_cross_market_opportunities()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "cross_market_opportunities"
  SET
    "status" = 'needs_facts',
    "missing_facts" = ARRAY['listing_freshness'],
    "rejection_reason" = NULL,
    "evaluated_at" = CURRENT_TIMESTAMP,
    "updated_at" = CURRENT_TIMESTAMP
  WHERE "japan_item_id" = NEW."id"
    AND "status" = 'ready';
  RETURN NEW;
END;
$$;

CREATE TRIGGER "item_cross_market_opportunity_invalidation"
AFTER UPDATE OF
  "product_id",
  "priceCurrent",
  "shippingFee",
  "listingType",
  "quantityEst",
  "conditionGrade",
  "status",
  "archivedAt",
  "ignored",
  "match_confidence",
  "match_decision"
ON "Item"
FOR EACH ROW
WHEN (
  OLD."product_id" IS DISTINCT FROM NEW."product_id"
  OR OLD."priceCurrent" IS DISTINCT FROM NEW."priceCurrent"
  OR OLD."shippingFee" IS DISTINCT FROM NEW."shippingFee"
  OR OLD."listingType" IS DISTINCT FROM NEW."listingType"
  OR OLD."quantityEst" IS DISTINCT FROM NEW."quantityEst"
  OR OLD."conditionGrade" IS DISTINCT FROM NEW."conditionGrade"
  OR OLD."status" IS DISTINCT FROM NEW."status"
  OR OLD."archivedAt" IS DISTINCT FROM NEW."archivedAt"
  OR OLD."ignored" IS DISTINCT FROM NEW."ignored"
  OR OLD."match_confidence" IS DISTINCT FROM NEW."match_confidence"
  OR OLD."match_decision" IS DISTINCT FROM NEW."match_decision"
)
EXECUTE FUNCTION invalidate_item_cross_market_opportunities();

CREATE OR REPLACE FUNCTION invalidate_logistics_cross_market_opportunities()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_item_id TEXT;
BEGIN
  affected_item_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD."item_id"
    ELSE NEW."item_id"
  END;
  UPDATE "cross_market_opportunities"
  SET
    "status" = 'needs_facts',
    "missing_facts" = ARRAY['listing_freshness'],
    "rejection_reason" = NULL,
    "evaluated_at" = CURRENT_TIMESTAMP,
    "updated_at" = CURRENT_TIMESTAMP
  WHERE "japan_item_id" = affected_item_id
    AND "status" = 'ready';
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "item_logistics_cross_market_opportunity_invalidation"
AFTER INSERT OR UPDATE OR DELETE
ON "item_logistics"
FOR EACH ROW
EXECUTE FUNCTION invalidate_logistics_cross_market_opportunities();
