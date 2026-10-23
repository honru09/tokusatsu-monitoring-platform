-- Preserve marketplace-public seller fields without pretending there is a
-- cross-platform seller schema.  No credentials, cookies or private account
-- data are stored.
ALTER TABLE "Seller" ADD COLUMN "source_data" JSONB;
ALTER TABLE "Seller" ADD COLUMN "profile_url" TEXT;
