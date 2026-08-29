CREATE TYPE "DiscoveryAction" AS ENUM ('dislike', 'favorite', 'detail_view', 'undo');

CREATE TABLE "discovery_feedback" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "product_id" TEXT,
    "action" "DiscoveryAction" NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "position" INTEGER NOT NULL,
    "recommendation_score" INTEGER NOT NULL,
    "undo_of_id" TEXT,

    CONSTRAINT "discovery_feedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "discovery_feedback_position_check" CHECK ("position" >= 0),
    CONSTRAINT "discovery_feedback_recommendation_score_check" CHECK ("recommendation_score" BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX "discovery_feedback_undo_of_id_key" ON "discovery_feedback"("undo_of_id");
CREATE INDEX "discovery_feedback_listing_id_timestamp_idx" ON "discovery_feedback"("listing_id", "timestamp");
CREATE INDEX "discovery_feedback_product_id_timestamp_idx" ON "discovery_feedback"("product_id", "timestamp");
CREATE INDEX "discovery_feedback_action_timestamp_idx" ON "discovery_feedback"("action", "timestamp");

ALTER TABLE "discovery_feedback"
  ADD CONSTRAINT "discovery_feedback_listing_id_fkey"
  FOREIGN KEY ("listing_id") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "discovery_feedback"
  ADD CONSTRAINT "discovery_feedback_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "discovery_feedback"
  ADD CONSTRAINT "discovery_feedback_undo_of_id_fkey"
  FOREIGN KEY ("undo_of_id") REFERENCES "discovery_feedback"("id") ON DELETE SET NULL ON UPDATE CASCADE;
