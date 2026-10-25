-- First-class per-item decisions (want / negotiate / pass / bought).
-- Additive only: existing items simply have no decision row yet.

CREATE TABLE "item_decisions" (
  "id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "decided_by_id" TEXT NOT NULL,
  "decided_at" TIMESTAMPTZ NOT NULL,
  "source_round_id" TEXT,
  "source_message_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "item_decisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "item_decisions_item_id_key"
ON "item_decisions"("item_id");

CREATE INDEX "item_decisions_status_idx"
ON "item_decisions"("status");

ALTER TABLE "item_decisions"
ADD CONSTRAINT "item_decisions_item_id_fkey"
FOREIGN KEY ("item_id") REFERENCES "Item"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "item_decisions"
ADD CONSTRAINT "item_decisions_decided_by_id_fkey"
FOREIGN KEY ("decided_by_id") REFERENCES "manager_accounts"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "item_decisions"
ADD CONSTRAINT "item_decisions_source_round_id_fkey"
FOREIGN KEY ("source_round_id") REFERENCES "share_rounds"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "item_decisions"
ADD CONSTRAINT "item_decisions_source_message_id_fkey"
FOREIGN KEY ("source_message_id") REFERENCES "direct_messages"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
