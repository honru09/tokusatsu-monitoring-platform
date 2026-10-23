-- Only marketplace adapters whose public transaction model is known are safe
-- to backfill. Generic Firecrawl, Apify and public-page imports intentionally
-- remain unknown because their source domain alone does not prove a sale mode.
UPDATE "Item" AS item
SET "listingType" = CASE
  WHEN source.key = 'yahoo_auctions' OR item."auctionEndAt" IS NOT NULL
    THEN 'auction'::"ListingType"
  ELSE 'direct'::"ListingType"
END
FROM "Source" AS source
WHERE item."sourceId" = source.id
  AND item."listingType" = 'unknown'::"ListingType"
  AND source.channel = 'online'::"SourceChannel"
  AND source.key IN (
    'mandarake',
    'mercari',
    'rakuma',
    'surugaya',
    'yahoo_auctions',
    'yahoo_fleamarket',
    'yahoo_shopping'
  );
