-- The unauthenticated Mercari HTML fallback used to overwrite fixed-price
-- listings as `unknown` after the earlier platform backfill ran.  The adapter
-- now defaults those pages to `direct`; repair every existing affected row so
-- historical and newly discovered inventory share the same transaction type.
UPDATE "Item" AS item
SET "listingType" = CASE
  WHEN item."auctionEndAt" IS NOT NULL THEN 'auction'::"ListingType"
  ELSE 'direct'::"ListingType"
END
FROM "Source" AS source
WHERE item."sourceId" = source.id
  AND item."listingType" = 'unknown'::"ListingType"
  AND source.key = 'mercari';
