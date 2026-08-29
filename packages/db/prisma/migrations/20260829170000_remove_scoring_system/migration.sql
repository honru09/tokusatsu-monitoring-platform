ALTER TABLE "inventory"
  DROP COLUMN IF EXISTS "procurementScore";

ALTER TABLE "discovery_feedback"
  DROP COLUMN IF EXISTS "recommendation_score";
