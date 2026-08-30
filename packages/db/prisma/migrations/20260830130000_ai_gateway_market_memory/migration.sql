CREATE TABLE "ai_runs" (
  "id" TEXT NOT NULL,
  "item_id" TEXT,
  "seller_id" TEXT,
  "task" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "requested_model" TEXT NOT NULL,
  "actual_model" TEXT,
  "status" TEXT NOT NULL,
  "input_hash" TEXT NOT NULL,
  "input" JSONB NOT NULL,
  "output" JSONB,
  "confidence" DOUBLE PRECISION,
  "final_decision" JSONB,
  "corrected_by_id" TEXT,
  "human_modified" BOOLEAN NOT NULL DEFAULT false,
  "fallback_used" BOOLEAN NOT NULL DEFAULT false,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "latency_ms" INTEGER,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "error_code" TEXT,
  "error_message" TEXT,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ,
  CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_runs_task_not_empty" CHECK (length(trim("task")) > 0),
  CONSTRAINT "ai_runs_model_not_empty" CHECK (length(trim("requested_model")) > 0),
  CONSTRAINT "ai_runs_status_check" CHECK ("status" IN ('running', 'succeeded', 'failed', 'cached')),
  CONSTRAINT "ai_runs_input_object_check" CHECK (jsonb_typeof("input") = 'object'),
  CONSTRAINT "ai_runs_output_object_check" CHECK ("output" IS NULL OR jsonb_typeof("output") = 'object'),
  CONSTRAINT "ai_runs_final_object_check" CHECK ("final_decision" IS NULL OR jsonb_typeof("final_decision") = 'object'),
  CONSTRAINT "ai_runs_confidence_check" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
  CONSTRAINT "ai_runs_attempt_check" CHECK ("attempt" >= 1),
  CONSTRAINT "ai_runs_latency_check" CHECK ("latency_ms" IS NULL OR "latency_ms" >= 0),
  CONSTRAINT "ai_runs_token_check" CHECK (("input_tokens" IS NULL OR "input_tokens" >= 0) AND ("output_tokens" IS NULL OR "output_tokens" >= 0))
);

CREATE TABLE "ai_cache" (
  "key" TEXT NOT NULL,
  "task" TEXT NOT NULL,
  "input_hash" TEXT NOT NULL,
  "route_revision" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "output" JSONB NOT NULL,
  "confidence" DOUBLE PRECISION,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "ai_cache_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "ai_cache_output_object_check" CHECK (jsonb_typeof("output") = 'object'),
  CONSTRAINT "ai_cache_confidence_check" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1))
);

CREATE TABLE "ai_model_state" (
  "model" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "configured" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'unknown',
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "last_success_at" TIMESTAMPTZ,
  "last_failure_at" TIMESTAMPTZ,
  "last_error_code" TEXT,
  "last_checked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "ai_model_state_pkey" PRIMARY KEY ("model"),
  CONSTRAINT "ai_model_state_status_check" CHECK ("status" IN ('unknown', 'ready', 'online', 'degraded', 'offline', 'unavailable')),
  CONSTRAINT "ai_model_state_failures_check" CHECK ("consecutive_failures" >= 0)
);

CREATE TABLE "ai_feedback" (
  "id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "ai_run_id" TEXT,
  "action" TEXT NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_feedback_action_check" CHECK ("action" IN ('correct', 'incorrect', 'interested', 'purchased', 'not_worth_buying')),
  CONSTRAINT "ai_feedback_note_length" CHECK ("note" IS NULL OR length("note") <= 500)
);

CREATE TABLE "market_snapshots" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "window_days" INTEGER NOT NULL,
  "snapshot_date" DATE NOT NULL,
  "observed_count" INTEGER NOT NULL,
  "sold_count" INTEGER NOT NULL,
  "active_count" INTEGER NOT NULL,
  "price_min" NUMERIC(12,2),
  "price_max" NUMERIC(12,2),
  "price_average" NUMERIC(12,2),
  "price_median" NUMERIC(12,2),
  "average_sell_hours" NUMERIC(12,2),
  "price_trend_pct" NUMERIC(8,2),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "market_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "market_snapshots_window_check" CHECK ("window_days" IN (1, 7, 30, 90)),
  CONSTRAINT "market_snapshots_counts_check" CHECK ("observed_count" >= 0 AND "sold_count" >= 0 AND "active_count" >= 0),
  CONSTRAINT "market_snapshots_prices_check" CHECK (("price_min" IS NULL OR "price_min" >= 0) AND ("price_max" IS NULL OR "price_max" >= 0) AND ("price_average" IS NULL OR "price_average" >= 0) AND ("price_median" IS NULL OR "price_median" >= 0))
);

CREATE TABLE "keyword_insights" (
  "keyword" TEXT NOT NULL,
  "listing_count" INTEGER NOT NULL DEFAULT 0,
  "average_price" NUMERIC(12,2),
  "low_price_ratio" NUMERIC(8,4),
  "purchase_ratio" NUMERIC(8,4),
  "high_value_ratio" NUMERIC(8,4),
  "recommended" BOOLEAN NOT NULL DEFAULT false,
  "rationale" TEXT,
  "last_analyzed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "keyword_insights_pkey" PRIMARY KEY ("keyword"),
  CONSTRAINT "keyword_insights_count_check" CHECK ("listing_count" >= 0),
  CONSTRAINT "keyword_insights_ratio_check" CHECK (("low_price_ratio" IS NULL OR "low_price_ratio" BETWEEN 0 AND 1) AND ("purchase_ratio" IS NULL OR "purchase_ratio" BETWEEN 0 AND 1) AND ("high_value_ratio" IS NULL OR "high_value_ratio" BETWEEN 0 AND 1))
);

CREATE TABLE "ai_briefs" (
  "id" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "period_start" TIMESTAMPTZ NOT NULL,
  "period_end" TIMESTAMPTZ NOT NULL,
  "model" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_briefs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_briefs_period_check" CHECK ("period" IN ('24h', '7d', '30d', '90d', 'system')),
  CONSTRAINT "ai_briefs_range_check" CHECK ("period_end" > "period_start"),
  CONSTRAINT "ai_briefs_result_object_check" CHECK (jsonb_typeof("result") = 'object')
);

CREATE UNIQUE INDEX "ai_cache_task_input_hash_route_revision_key" ON "ai_cache"("task", "input_hash", "route_revision");
CREATE INDEX "ai_cache_expires_at_idx" ON "ai_cache"("expires_at");
CREATE INDEX "ai_runs_task_started_at_idx" ON "ai_runs"("task", "started_at");
CREATE INDEX "ai_runs_status_started_at_idx" ON "ai_runs"("status", "started_at");
CREATE INDEX "ai_runs_requested_model_started_at_idx" ON "ai_runs"("requested_model", "started_at");
CREATE INDEX "ai_runs_item_id_started_at_idx" ON "ai_runs"("item_id", "started_at");
CREATE INDEX "ai_runs_seller_id_started_at_idx" ON "ai_runs"("seller_id", "started_at");
CREATE INDEX "ai_runs_input_hash_task_idx" ON "ai_runs"("input_hash", "task");
CREATE INDEX "ai_model_state_status_updated_at_idx" ON "ai_model_state"("status", "updated_at");
CREATE INDEX "ai_feedback_item_id_created_at_idx" ON "ai_feedback"("item_id", "created_at");
CREATE INDEX "ai_feedback_ai_run_id_idx" ON "ai_feedback"("ai_run_id");
CREATE INDEX "ai_feedback_action_created_at_idx" ON "ai_feedback"("action", "created_at");
CREATE UNIQUE INDEX "market_snapshots_product_id_window_days_snapshot_date_key" ON "market_snapshots"("product_id", "window_days", "snapshot_date");
CREATE INDEX "market_snapshots_window_days_snapshot_date_idx" ON "market_snapshots"("window_days", "snapshot_date");
CREATE INDEX "market_snapshots_product_id_snapshot_date_idx" ON "market_snapshots"("product_id", "snapshot_date");
CREATE INDEX "keyword_insights_recommended_last_analyzed_at_idx" ON "keyword_insights"("recommended", "last_analyzed_at");
CREATE UNIQUE INDEX "ai_briefs_period_period_start_key" ON "ai_briefs"("period", "period_start");
CREATE INDEX "ai_briefs_period_created_at_idx" ON "ai_briefs"("period", "created_at");

ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "Seller"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_corrected_by_id_fkey" FOREIGN KEY ("corrected_by_id") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_ai_run_id_fkey" FOREIGN KEY ("ai_run_id") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "market_snapshots" ADD CONSTRAINT "market_snapshots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
