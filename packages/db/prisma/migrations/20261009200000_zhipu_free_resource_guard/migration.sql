ALTER TABLE "ai_runs" ADD COLUMN "quota_reservation" INTEGER,
  ADD COLUMN "quota_group" TEXT;
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_quota_reservation_nonnegative"
  CHECK ("quota_reservation" IS NULL OR "quota_reservation" >= 0);
CREATE INDEX "ai_runs_quota_group_started_at_idx" ON "ai_runs"("quota_group", "started_at");
