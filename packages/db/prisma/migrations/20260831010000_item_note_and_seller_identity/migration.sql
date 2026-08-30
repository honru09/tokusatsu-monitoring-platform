ALTER TABLE "Item"
ADD CONSTRAINT "Item_note_max_25_chars"
CHECK ("note" IS NULL OR char_length("note") <= 25);

ALTER TABLE "Seller" ADD COLUMN "source_seller_id" TEXT;

-- Yahoo! Fleamarket exposes a stable public seller ID in every detail page.
-- Normalize the existing seller rows onto that key before changing uniqueness.
UPDATE "Seller" AS seller
SET "source_seller_id" = substring(seller."profile_url" from '/user/([^/?#]+)')
FROM "Source" AS source
WHERE seller."sourceId" = source."id"
  AND source."key" = 'yahoo_fleamarket'
  AND seller."profile_url" IS NOT NULL;

DROP INDEX "Seller_sourceId_name_key";
CREATE UNIQUE INDEX "Seller_sourceId_source_seller_id_key"
ON "Seller"("sourceId", "source_seller_id");
CREATE INDEX "Seller_sourceId_name_idx" ON "Seller"("sourceId", "name");
CREATE INDEX "Item_sellerId_idx" ON "Item"("sellerId");

-- A nickname is not an identity: four current listings use a nickname shared
-- by different public seller IDs. Create only the missing public-ID rows, then
-- point each listing at the seller ID captured in its own public payload.
WITH listing_sellers AS (
  SELECT DISTINCT ON (
    item."sourceId",
    item."source_data" #>> '{seller,id}'
  )
    item."sourceId" AS source_id,
    item."source_data" #>> '{seller,id}' AS public_id,
    item."source_data" #>> '{seller,nickname}' AS nickname,
    item."source_data" #> '{seller}' AS seller_payload
  FROM "Item" AS item
  JOIN "Source" AS source ON source."id" = item."sourceId"
  WHERE source."key" = 'yahoo_fleamarket'
    AND NULLIF(item."source_data" #>> '{seller,id}', '') IS NOT NULL
    AND NULLIF(item."source_data" #>> '{seller,nickname}', '') IS NOT NULL
  ORDER BY
    item."sourceId",
    item."source_data" #>> '{seller,id}',
    item."updatedAt" DESC
)
INSERT INTO "Seller" (
  "id",
  "sourceId",
  "source_seller_id",
  "name",
  "sellerType",
  "source_data",
  "profile_url",
  "createdAt",
  "updatedAt"
)
SELECT
  'yahoo-fleamarket-' || public_id,
  source_id,
  public_id,
  nickname,
  'individual'::"SellerType",
  jsonb_build_object(
    'sellerId', public_id,
    'nickname', nickname,
    'publicProfile', seller_payload
  ),
  'https://paypayfleamarket.yahoo.co.jp/user/' || public_id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM listing_sellers
ON CONFLICT ("sourceId", "source_seller_id") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "profile_url" = EXCLUDED."profile_url",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "Item" AS item
SET "sellerId" = seller."id"
FROM "Source" AS source, "Seller" AS seller
WHERE source."id" = item."sourceId"
  AND source."key" = 'yahoo_fleamarket'
  AND seller."sourceId" = item."sourceId"
  AND seller."source_seller_id" = item."source_data" #>> '{seller,id}'
  AND item."sellerId" IS DISTINCT FROM seller."id";

-- Retain deterministic fallback grouping for sources that expose no seller ID.
CREATE UNIQUE INDEX "Seller_sourceId_name_without_source_id_key"
ON "Seller"("sourceId", "name")
WHERE "source_seller_id" IS NULL;
