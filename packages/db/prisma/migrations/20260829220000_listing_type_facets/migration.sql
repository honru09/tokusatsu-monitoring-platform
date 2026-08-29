CREATE TYPE "ListingType" AS ENUM ('auction', 'direct');

ALTER TABLE "Item"
  ADD COLUMN "listingType" "ListingType" NOT NULL DEFAULT 'direct';

UPDATE "Item"
SET "listingType" = 'auction'
WHERE "auctionEndAt" IS NOT NULL;

CREATE INDEX "Item_listingType_detectedAt_idx"
  ON "Item"("listingType", "detectedAt");
