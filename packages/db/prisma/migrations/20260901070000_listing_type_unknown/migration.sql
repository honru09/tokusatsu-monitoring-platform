ALTER TABLE "Item" ALTER COLUMN "listingType" DROP DEFAULT;

CREATE TYPE "ListingType_new" AS ENUM ('auction', 'direct', 'unknown');

ALTER TABLE "Item"
ALTER COLUMN "listingType" TYPE "ListingType_new"
USING ("listingType"::text::"ListingType_new");

DROP TYPE "ListingType";

ALTER TYPE "ListingType_new" RENAME TO "ListingType";

ALTER TABLE "Item" ALTER COLUMN "listingType" SET DEFAULT 'unknown';
