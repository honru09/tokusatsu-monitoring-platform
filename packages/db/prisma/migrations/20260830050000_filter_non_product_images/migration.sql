-- Convert Yahoo thumbnail proxies back to their canonical product-photo URL.
INSERT INTO "ItemImage" ("id", "itemId", "url", "position", "createdAt")
SELECT
  gen_random_uuid(),
  image."itemId",
  regexp_replace(
    image."url",
    '^https://auc-pctr\.c\.yimg\.jp/i/([^?]+).*$',
    'https://\1',
    'i'
  ),
  image."position",
  image."createdAt"
FROM "ItemImage" AS image
WHERE image."url" ~* '^https://auc-pctr\.c\.yimg\.jp/i/[a-z0-9.-]+/'
ON CONFLICT ("itemId", "url") DO NOTHING;

-- Remove proxies, seller avatars, page icons, placeholders and invalid page
-- routes that were previously mistaken for gallery images.
DELETE FROM "ItemImage"
WHERE
  "url" ~* '^https://auc-pctr\.c\.yimg\.jp/i/'
  OR "url" ~* '^https://s\.yimg\.jp/'
  OR "url" ~* '^https://displayname-pctr\.c\.yimg\.jp/'
  OR "url" ~* '^https://(?:page\.)?auctions\.yahoo\.co\.jp/jp/auction/'
  OR "url" ~* '(?:^|[/_\-.])(?:avatar|banner|common|favicon|header|footer|icon|logo|no[-_]?image|placeholder|profile|sprite|tracking|pixel)(?:[/_\-.]|$)'
  OR "url" ~* '\.svg(?:\?|$)';

-- Restore stable positions and the denormalized count used by enrichment.
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "itemId"
      ORDER BY "position" ASC, "createdAt" ASC, "id" ASC
    ) - 1 AS next_position
  FROM "ItemImage"
)
UPDATE "ItemImage" AS image
SET "position" = ranked.next_position
FROM ranked
WHERE image."id" = ranked."id";

UPDATE "Item" AS item
SET "imageCount" = (
  SELECT count(*)::integer
  FROM "ItemImage" AS image
  WHERE image."itemId" = item."id"
);
