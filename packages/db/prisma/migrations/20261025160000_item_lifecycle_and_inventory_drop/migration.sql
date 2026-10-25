-- Lifecycle convergence: one lifecycle column on Item becomes the source
-- of truth for visibility/eligibility. status stays as the raw platform
-- signal; archivedAt/deleted_at stay as plain timestamps.
-- Backfill priority (deterministic, first match wins):
--   deleted (deleted_at set)
--   > purchased (a PurchaseRecord exists)
--   > disliked (ignored)
--   > sold (status = sold)
--   > ended (status = ended, or archived under the old scheme)
--   > live (the default)
-- Also drops the legacy per-product Inventory table: purchase intake has
-- written InventoryOrder rows all along, and nothing reads Inventory.

CREATE TYPE "ItemLifecycleStatus" AS ENUM ('live', 'sold', 'ended', 'purchased', 'disliked', 'deleted');

ALTER TABLE "Item" ADD COLUMN "lifecycleStatus" "ItemLifecycleStatus" NOT NULL DEFAULT 'live';

UPDATE "Item" SET "lifecycleStatus" = 'deleted'
WHERE "deleted_at" IS NOT NULL;

UPDATE "Item" SET "lifecycleStatus" = 'purchased'
WHERE "lifecycleStatus" = 'live'
  AND EXISTS (SELECT 1 FROM "PurchaseRecord" WHERE "PurchaseRecord"."itemId" = "Item"."id");

UPDATE "Item" SET "lifecycleStatus" = 'disliked'
WHERE "lifecycleStatus" = 'live' AND "ignored" = true;

UPDATE "Item" SET "lifecycleStatus" = 'sold'
WHERE "lifecycleStatus" = 'live' AND "status" = 'sold';

UPDATE "Item" SET "lifecycleStatus" = 'ended'
WHERE "lifecycleStatus" = 'live' AND ("status" = 'ended' OR "archivedAt" IS NOT NULL);

CREATE INDEX "Item_lifecycleStatus_idx" ON "Item"("lifecycleStatus");

DROP TABLE IF EXISTS "inventory";
