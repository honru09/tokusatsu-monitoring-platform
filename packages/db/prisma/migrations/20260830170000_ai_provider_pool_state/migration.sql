-- Cache rows written before provider-aware routing remain readable for audit,
-- but application code treats their NULL provider as a stale cache miss.
ALTER TABLE "ai_cache"
  ADD COLUMN "provider" TEXT;

CREATE INDEX "ai_cache_provider_model_idx"
  ON "ai_cache"("provider", "model");

-- Preserve every existing model-state row while moving from model-only
-- identity to provider + model identity. md5() is built into PostgreSQL and
-- therefore does not require pgcrypto during deploy.
ALTER TABLE "ai_model_state"
  ADD COLUMN "id" TEXT,
  ADD COLUMN "cooldown_until" TIMESTAMPTZ,
  ADD COLUMN "quota_reset_at" TIMESTAMPTZ;

UPDATE "ai_model_state"
SET "id" = md5("provider" || E'\x1f' || "model")
WHERE "id" IS NULL;

ALTER TABLE "ai_model_state"
  ALTER COLUMN "id" SET NOT NULL,
  DROP CONSTRAINT "ai_model_state_pkey",
  ADD CONSTRAINT "ai_model_state_pkey" PRIMARY KEY ("id");

CREATE UNIQUE INDEX "ai_model_state_provider_model_key"
  ON "ai_model_state"("provider", "model");

CREATE INDEX "ai_model_state_cooldown_until_idx"
  ON "ai_model_state"("cooldown_until");

-- Provider-level health and quota state keeps hot circuit-breaker updates out
-- of individual model rows and supports account-wide limits.
CREATE TABLE "ai_provider_state" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'unknown',
  "cooldown_until" TIMESTAMPTZ,
  "quota_reset_at" TIMESTAMPTZ,
  "remaining_requests" INTEGER,
  "remaining_tokens" INTEGER,
  "last_error_code" TEXT,
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "ai_provider_state_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_provider_state_provider_not_empty"
    CHECK (length(trim("provider")) > 0),
  CONSTRAINT "ai_provider_state_failures_check"
    CHECK ("consecutive_failures" >= 0),
  CONSTRAINT "ai_provider_state_remaining_check"
    CHECK (
      ("remaining_requests" IS NULL OR "remaining_requests" >= 0)
      AND ("remaining_tokens" IS NULL OR "remaining_tokens" >= 0)
    )
);

CREATE UNIQUE INDEX "ai_provider_state_provider_key"
  ON "ai_provider_state"("provider");

CREATE INDEX "ai_provider_state_status_updated_at_idx"
  ON "ai_provider_state"("status", "updated_at");

CREATE INDEX "ai_provider_state_cooldown_until_idx"
  ON "ai_provider_state"("cooldown_until");
