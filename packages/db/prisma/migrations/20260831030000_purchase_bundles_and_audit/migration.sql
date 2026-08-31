BEGIN;

ALTER TYPE "ImportOrigin" ADD VALUE IF NOT EXISTS 'purchase';

CREATE TABLE "purchase_bundles" (
    "id" TEXT NOT NULL,
    "pricing_mode" TEXT NOT NULL DEFAULT 'per_item',
    "total_purchase_amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'JPY',
    "purchased_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "archived_at" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "purchase_bundles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_bundles_pricing_mode_check"
      CHECK ("pricing_mode" IN ('per_item', 'bundle_total')),
    CONSTRAINT "purchase_bundles_total_purchase_amount_check"
      CHECK ("total_purchase_amount" >= 0),
    CONSTRAINT "purchase_bundles_currency_check"
      CHECK (char_length("currency") BETWEEN 3 AND 8),
    CONSTRAINT "purchase_bundles_version_check"
      CHECK ("version" >= 1)
);

CREATE TABLE "purchase_bundle_audits" (
    "id" TEXT NOT NULL,
    "bundle_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "before_data" JSONB,
    "after_data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchase_bundle_audits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_bundle_audits_event_type_check"
      CHECK ("event_type" IN ('created', 'price_changed', 'members_changed', 'updated', 'archived')),
    CONSTRAINT "purchase_bundle_audits_actor_check"
      CHECK (char_length(btrim("actor")) BETWEEN 1 AND 120),
    CONSTRAINT "purchase_bundle_audits_reason_check"
      CHECK (char_length(btrim("reason")) BETWEEN 1 AND 1000),
    CONSTRAINT "purchase_bundle_audits_before_data_check"
      CHECK ("before_data" IS NULL OR jsonb_typeof("before_data") = 'object'),
    CONSTRAINT "purchase_bundle_audits_after_data_check"
      CHECK (jsonb_typeof("after_data") = 'object')
);

ALTER TABLE "PurchaseRecord"
  ADD COLUMN "bundle_id" TEXT,
  ADD COLUMN "amount_allocated" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "PurchaseRecord"
  ADD CONSTRAINT "PurchaseRecord_purchaseAmount_check"
  CHECK ("purchaseAmount" >= 0);

-- Preserve every existing purchase as a one-item bundle. Reusing the purchase
-- record ID is deterministic and avoids a temporary migration mapping table.
INSERT INTO "purchase_bundles" (
  "id",
  "pricing_mode",
  "total_purchase_amount",
  "currency",
  "purchased_at",
  "note",
  "version",
  "created_at",
  "updated_at"
)
SELECT
  purchase."id",
  'per_item',
  purchase."purchaseAmount",
  'JPY',
  purchase."purchasedAt" AT TIME ZONE 'UTC',
  purchase."note",
  1,
  purchase."createdAt" AT TIME ZONE 'UTC',
  purchase."updatedAt" AT TIME ZONE 'UTC'
FROM "PurchaseRecord" AS purchase;

UPDATE "PurchaseRecord"
SET "bundle_id" = "id";

ALTER TABLE "PurchaseRecord"
  ALTER COLUMN "bundle_id" SET NOT NULL;

CREATE INDEX "purchase_bundles_archived_at_purchased_at_idx"
  ON "purchase_bundles"("archived_at", "purchased_at");
CREATE INDEX "purchase_bundles_purchased_at_idx"
  ON "purchase_bundles"("purchased_at");
CREATE INDEX "PurchaseRecord_bundle_id_idx"
  ON "PurchaseRecord"("bundle_id");
CREATE INDEX "purchase_bundle_audits_bundle_id_created_at_idx"
  ON "purchase_bundle_audits"("bundle_id", "created_at");
CREATE INDEX "purchase_bundle_audits_created_at_idx"
  ON "purchase_bundle_audits"("created_at");

ALTER TABLE "PurchaseRecord"
  ADD CONSTRAINT "PurchaseRecord_bundle_id_fkey"
  FOREIGN KEY ("bundle_id") REFERENCES "purchase_bundles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_bundle_audits"
  ADD CONSTRAINT "purchase_bundle_audits_bundle_id_fkey"
  FOREIGN KEY ("bundle_id") REFERENCES "purchase_bundles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "purchase_bundle_audits" (
  "id",
  "bundle_id",
  "event_type",
  "actor",
  "reason",
  "before_data",
  "after_data",
  "created_at"
)
SELECT
  gen_random_uuid()::text,
  purchase."bundle_id",
  'created',
  'system:migration',
  '将既有单商品购买记录无损迁移为购买批次',
  NULL,
  jsonb_build_object(
    'id', purchase."bundle_id",
    'version', 1,
    'pricingMode', 'per_item',
    'totalPurchaseAmountYen', purchase."purchaseAmount",
    'currency', 'JPY',
    'purchasedAt', purchase."purchasedAt",
    'note', purchase."note",
    'members', jsonb_build_array(
      jsonb_build_object(
        'purchaseId', purchase."id",
        'itemId', purchase."itemId",
        'amountYen', purchase."purchaseAmount",
        'amountAllocated', true
      )
    )
  ),
  CURRENT_TIMESTAMP
FROM "PurchaseRecord" AS purchase;

CREATE OR REPLACE FUNCTION prevent_purchase_bundle_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'purchase bundle audit history is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "purchase_bundle_audits_append_only"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "purchase_bundle_audits"
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_purchase_bundle_audit_mutation();

COMMIT;
