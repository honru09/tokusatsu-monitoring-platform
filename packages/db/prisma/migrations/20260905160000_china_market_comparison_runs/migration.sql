BEGIN;

CREATE TABLE "china_market_comparison_runs" (
  "id" TEXT NOT NULL,
  "comparison_id" TEXT NOT NULL,
  "refresh_token" TEXT NOT NULL,
  "status" "MarketComparisonStatus" NOT NULL DEFAULT 'refreshing',
  "search_keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "candidate_count" INTEGER NOT NULL DEFAULT 0,
  "matched_count" INTEGER NOT NULL DEFAULT 0,
  "comparison_method" TEXT,
  "provider_stats" JSONB,
  "reference_price_cny" DECIMAL(12, 2),
  "reference_url" TEXT,
  "observed_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL,
  "completed_at" TIMESTAMPTZ,
  "sanitized_error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "china_market_comparison_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "china_market_comparison_runs_refresh_token_check" CHECK (
    "refresh_token" ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT "china_market_comparison_runs_counts_check" CHECK (
    "candidate_count" BETWEEN 0 AND 50
    AND "matched_count" BETWEEN 0 AND "candidate_count"
  ),
  CONSTRAINT "china_market_comparison_runs_method_check" CHECK (
    "comparison_method" IS NULL
    OR length(trim("comparison_method")) BETWEEN 1 AND 80
  ),
  CONSTRAINT "china_market_comparison_runs_provider_stats_check" CHECK (
    "provider_stats" IS NULL OR jsonb_typeof("provider_stats") = 'object'
  ),
  CONSTRAINT "china_market_comparison_runs_reference_price_check" CHECK (
    "reference_price_cny" IS NULL
    OR (
      "reference_price_cny" <> 'NaN'::NUMERIC
      AND "reference_price_cny" > 0
      AND "reference_price_cny" <= 1000000
    )
  ),
  CONSTRAINT "china_market_comparison_runs_error_check" CHECK (
    "sanitized_error" IS NULL
    OR length(trim("sanitized_error")) BETWEEN 1 AND 500
  ),
  CONSTRAINT "china_market_comparison_runs_lifecycle_check" CHECK (
    (
      "status" = 'refreshing'
      AND "completed_at" IS NULL
      AND "sanitized_error" IS NULL
    )
    OR (
      "status" IN ('ready', 'insufficient', 'failed')
      AND "completed_at" IS NOT NULL
      AND "completed_at" >= "started_at"
    )
  ),
  CONSTRAINT "china_market_comparison_runs_ready_evidence_check" CHECK (
    "status" <> 'ready'
    OR (
      cardinality("search_keywords") BETWEEN 3 AND 8
      AND "candidate_count" BETWEEN 3 AND 50
      AND "matched_count" BETWEEN 3 AND "candidate_count"
      AND "comparison_method" IS NOT NULL
      AND "provider_stats" IS NOT NULL
      AND "reference_price_cny" IS NOT NULL
      AND "reference_url" ~
        '^https://www[.]goofish[.]com/item[?]id=[A-Za-z0-9][A-Za-z0-9_-]{2,127}$'
      AND "observed_at" IS NOT NULL
      AND "sanitized_error" IS NULL
    )
  )
);

CREATE UNIQUE INDEX "china_market_comparison_runs_refresh_token_key"
  ON "china_market_comparison_runs"("refresh_token");
CREATE INDEX "china_market_comparison_runs_comparison_id_completed_at_idx"
  ON "china_market_comparison_runs"("comparison_id", "completed_at");
CREATE INDEX "china_market_comparison_runs_status_started_at_idx"
  ON "china_market_comparison_runs"("status", "started_at");

ALTER TABLE "china_market_comparison_runs"
  ADD CONSTRAINT "china_market_comparison_runs_comparison_id_fkey"
  FOREIGN KEY ("comparison_id") REFERENCES "product_market_comparisons"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION enforce_china_market_comparison_run_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  unique_keyword_count INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM "product_market_comparisons"
      WHERE "id" = OLD."comparison_id"
    ) THEN
      RAISE EXCEPTION 'Completed China-market run summaries are append-only'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."completed_at" IS NOT NULL
       OR NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."comparison_id" IS DISTINCT FROM OLD."comparison_id"
       OR NEW."refresh_token" IS DISTINCT FROM OLD."refresh_token"
       OR NEW."started_at" IS DISTINCT FROM OLD."started_at"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    THEN
      RAISE EXCEPTION 'China-market run identity and completed summaries are immutable'
        USING ERRCODE = '23514';
    END IF;
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
    RAISE EXCEPTION 'China-market run keywords must be distinct normalized phrases'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "china_market_comparison_run_integrity_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "china_market_comparison_runs"
FOR EACH ROW
EXECUTE FUNCTION enforce_china_market_comparison_run_integrity();

ALTER TABLE "cross_market_opportunities"
  ADD COLUMN "comparison_run_id" TEXT;

CREATE INDEX "cross_market_opportunities_comparison_run_id_idx"
  ON "cross_market_opportunities"("comparison_run_id");

ALTER TABLE "cross_market_opportunities"
  ADD CONSTRAINT "cross_market_opportunities_comparison_run_id_fkey"
  FOREIGN KEY ("comparison_run_id") REFERENCES "china_market_comparison_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "cross_market_opportunities"
SET "status" = 'needs_facts',
    "missing_facts" = ARRAY['comparison_freshness'],
    "rejection_reason" = NULL,
    "evaluated_at" = CURRENT_TIMESTAMP,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "status" = 'ready';

ALTER TABLE "cross_market_opportunities"
  ADD CONSTRAINT "cross_market_opportunities_ready_run_check" CHECK (
    "status" <> 'ready' OR "comparison_run_id" IS NOT NULL
  );

CREATE FUNCTION enforce_cross_market_opportunity_run_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_run "china_market_comparison_runs"%ROWTYPE;
BEGIN
  IF NEW."status" <> 'ready' THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO current_run
  FROM "china_market_comparison_runs"
  WHERE "id" = NEW."comparison_run_id"
  FOR SHARE;

  IF NOT FOUND
     OR current_run."status" <> 'ready'
     OR current_run."completed_at" IS NULL
     OR current_run."comparison_id" IS DISTINCT FROM NEW."comparison_id"
     OR current_run."reference_price_cny" IS DISTINCT FROM NEW."xianyu_reference_price_cny"
     OR current_run."observed_at" IS DISTINCT FROM NEW."comparison_observed_at"
     OR current_run."reference_url" IS DISTINCT FROM
          NEW."evidence" #>> '{comparison,referenceUrl}'
     OR current_run."comparison_method" IS DISTINCT FROM
          NEW."evidence" #>> '{comparison,method}'
     OR to_jsonb(current_run."search_keywords") IS DISTINCT FROM
          NEW."evidence" #> '{comparison,searchKeywords}'
     OR to_jsonb(current_run."candidate_count") IS DISTINCT FROM
          NEW."evidence" #> '{comparison,candidateCount}'
     OR to_jsonb(current_run."matched_count") IS DISTINCT FROM
          NEW."evidence" #> '{comparison,matchedCount}'
     OR COALESCE(to_jsonb(current_run."provider_stats"), 'null'::JSONB)
          IS DISTINCT FROM NEW."evidence" #> '{comparison,providerStats}'
  THEN
    NEW."status" := 'needs_facts';
    NEW."missing_facts" := ARRAY['comparison_freshness'];
    NEW."rejection_reason" := NULL;
    NEW."evaluated_at" := CURRENT_TIMESTAMP;
    NEW."updated_at" := CURRENT_TIMESTAMP;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "cross_market_opportunity_run_evidence_guard"
BEFORE INSERT OR UPDATE OF
  "status",
  "comparison_id",
  "comparison_run_id",
  "xianyu_reference_price_cny",
  "comparison_observed_at",
  "evidence"
ON "cross_market_opportunities"
FOR EACH ROW
EXECUTE FUNCTION enforce_cross_market_opportunity_run_evidence();

COMMIT;
