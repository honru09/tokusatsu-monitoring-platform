-- Mercari's public search response exposes a stable sellerId. Historical
-- imports persisted that ID in public JSON/profile fields but left the
-- normalized Seller.source_seller_id empty, which fragmented seller browsing.
-- Merge only rows with the same explicit public ID; never infer identity from
-- a display name without its numeric suffix and never delete Item records.
BEGIN;

CREATE TEMP TABLE "_mercari_seller_identity_backfill" ON COMMIT DROP AS
WITH "mercari_candidates" AS (
  SELECT
    seller."id" AS "seller_id",
    seller."sourceId" AS "source_id",
    seller."source_seller_id",
    seller."name",
    seller."createdAt",
    COALESCE(
      NULLIF(seller."source_seller_id", ''),
      NULLIF(seller."source_data" ->> 'sellerId', ''),
      NULLIF(seller."source_data" #>> '{seller,id}', ''),
      NULLIF(seller."source_data" #>> '{seller,sellerId}', ''),
      NULLIF(substring(seller."profile_url" from '/profile/([0-9]+)'), ''),
      NULLIF(substring(seller."name" from '^Mercari 卖家 ([0-9]+)$'), ''),
      NULLIF(substring(seller."name" from '^Mercari 出品者 ([0-9]+)$'), '')
    ) AS "public_seller_id",
    (SELECT count(*) FROM "Item" item WHERE item."sellerId" = seller."id") AS "item_count"
  FROM "Seller" seller
  JOIN "Source" source ON source."id" = seller."sourceId"
  WHERE source."key" = 'mercari'
),
"identified" AS (
  SELECT *
  FROM "mercari_candidates"
  WHERE "public_seller_id" ~ '^[0-9]+$'
)
SELECT
  "seller_id",
  "source_id",
  "public_seller_id",
  first_value("seller_id") OVER (
    PARTITION BY "source_id", "public_seller_id"
    ORDER BY
      CASE WHEN "source_seller_id" = "public_seller_id" THEN 0 ELSE 1 END,
      CASE WHEN "name" !~ '^Mercari (卖家|出品者)( [0-9]+)?$' THEN 0 ELSE 1 END,
      "item_count" DESC,
      "createdAt" ASC,
      "seller_id" ASC
  ) AS "canonical_seller_id"
FROM "identified";

-- Preserve every existing listing and AI audit association before removing a
-- duplicate normalized Seller row.
UPDATE "Item" item
SET "sellerId" = identity."canonical_seller_id"
FROM "_mercari_seller_identity_backfill" identity
WHERE item."sellerId" = identity."seller_id"
  AND identity."seller_id" <> identity."canonical_seller_id";

UPDATE "ai_runs" run
SET "seller_id" = identity."canonical_seller_id"
FROM "_mercari_seller_identity_backfill" identity
WHERE run."seller_id" = identity."seller_id"
  AND identity."seller_id" <> identity."canonical_seller_id";

DELETE FROM "Seller" seller
USING "_mercari_seller_identity_backfill" identity
WHERE seller."id" = identity."seller_id"
  AND identity."seller_id" <> identity."canonical_seller_id";

UPDATE "Seller" seller
SET
  "source_seller_id" = identity."public_seller_id",
  "updatedAt" = CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT
    "canonical_seller_id",
    "public_seller_id"
  FROM "_mercari_seller_identity_backfill"
) identity
WHERE seller."id" = identity."canonical_seller_id"
  AND seller."source_seller_id" IS DISTINCT FROM identity."public_seller_id";

-- Repair an Item that was historically attached to a generic Seller even
-- though its own public Mercari payload contains the stable sellerId.
UPDATE "Item" item
SET "sellerId" = seller."id"
FROM "Source" source, "Seller" seller
WHERE item."sourceId" = source."id"
  AND source."key" = 'mercari'
  AND seller."sourceId" = source."id"
  AND seller."source_seller_id" = COALESCE(
    NULLIF(item."source_data" ->> 'sellerId', ''),
    NULLIF(item."source_data" #>> '{seller,id}', ''),
    NULLIF(item."source_data" #>> '{seller,sellerId}', '')
  )
  AND item."sellerId" IS DISTINCT FROM seller."id";

COMMIT;
