CREATE TABLE "negotiation_cases" (
  "id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "initiated_by_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'in_progress',
  "status_changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "negotiation_cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "negotiation_cases_item_id_key"
ON "negotiation_cases"("item_id");

CREATE INDEX "negotiation_cases_status_status_changed_at_idx"
ON "negotiation_cases"("status", "status_changed_at");

CREATE INDEX "negotiation_cases_initiated_by_id_updated_at_idx"
ON "negotiation_cases"("initiated_by_id", "updated_at");

ALTER TABLE "negotiation_cases"
ADD CONSTRAINT "negotiation_cases_item_id_fkey"
FOREIGN KEY ("item_id") REFERENCES "Item"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "negotiation_cases"
ADD CONSTRAINT "negotiation_cases_initiated_by_id_fkey"
FOREIGN KEY ("initiated_by_id") REFERENCES "manager_accounts"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
