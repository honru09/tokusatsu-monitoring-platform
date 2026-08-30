-- Optional provider-native metering supports fail-closed free-tier budgets
-- without changing historical AI run records.
ALTER TABLE "ai_runs"
  ADD COLUMN "provider_usage" DOUBLE PRECISION;

ALTER TABLE "ai_runs"
  ADD CONSTRAINT "ai_runs_provider_usage_nonnegative"
  CHECK ("provider_usage" IS NULL OR "provider_usage" >= 0);

CREATE INDEX "ai_runs_provider_usage_idx"
  ON "ai_runs"("provider", "started_at")
  WHERE "provider_usage" IS NOT NULL;
