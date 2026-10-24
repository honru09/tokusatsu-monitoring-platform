CREATE TABLE "share_rounds" (
  "id" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "share_rounds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "share_round_items" (
  "id" TEXT NOT NULL,
  "round_id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "target_price_yen" INTEGER,
  "copied_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "share_round_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "share_rounds_created_by_id_created_at_idx"
ON "share_rounds"("created_by_id", "created_at");

CREATE INDEX "share_rounds_created_at_idx"
ON "share_rounds"("created_at");

CREATE UNIQUE INDEX "share_round_items_round_id_item_id_key"
ON "share_round_items"("round_id", "item_id");

CREATE INDEX "share_round_items_item_id_idx"
ON "share_round_items"("item_id");

ALTER TABLE "share_rounds"
ADD CONSTRAINT "share_rounds_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "manager_accounts"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "share_round_items"
ADD CONSTRAINT "share_round_items_round_id_fkey"
FOREIGN KEY ("round_id") REFERENCES "share_rounds"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "share_round_items"
ADD CONSTRAINT "share_round_items_item_id_fkey"
FOREIGN KEY ("item_id") REFERENCES "Item"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "direct_messages"
ADD COLUMN "round_id" TEXT;

CREATE INDEX "direct_messages_round_id_idx"
ON "direct_messages"("round_id");

ALTER TABLE "direct_messages"
ADD CONSTRAINT "direct_messages_round_id_fkey"
FOREIGN KEY ("round_id") REFERENCES "share_rounds"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
