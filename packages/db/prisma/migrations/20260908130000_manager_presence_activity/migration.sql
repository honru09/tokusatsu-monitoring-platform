ALTER TABLE "manager_accounts"
ADD COLUMN "last_seen_at" TIMESTAMPTZ;

CREATE TABLE "manager_activities" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "item_id" TEXT,
  "count" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "manager_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "manager_activities_account_id_action_created_at_idx"
ON "manager_activities"("account_id", "action", "created_at");

CREATE INDEX "manager_activities_item_id_idx"
ON "manager_activities"("item_id");

ALTER TABLE "manager_activities"
ADD CONSTRAINT "manager_activities_account_id_fkey"
FOREIGN KEY ("account_id") REFERENCES "manager_accounts"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "manager_activities"
ADD CONSTRAINT "manager_activities_item_id_fkey"
FOREIGN KEY ("item_id") REFERENCES "Item"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
