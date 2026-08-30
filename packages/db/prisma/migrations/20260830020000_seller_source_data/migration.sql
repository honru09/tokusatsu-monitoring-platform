-- Preserve marketplace-public seller fields without pretending there is a
-- cross-platform seller schema.  No credentials, cookies or private account
-- data are stored.
ALTER TABLE "Seller" ADD COLUMN "source_data" JSONB;
ALTER TABLE "Seller" ADD COLUMN "profile_url" TEXT;

-- Backfill sellers that already have an item-level public payload.  The
-- update is idempotent and only copies data that is already public in Item.
UPDATE "Seller" AS s
SET "source_data" = i."source_data"
FROM "Item" AS i
WHERE i."sellerId" = s."id"
  AND s."source_data" IS NULL
  AND i."source_data" IS NOT NULL;
