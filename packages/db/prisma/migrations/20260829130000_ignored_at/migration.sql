ALTER TABLE "Item" ADD COLUMN "ignoredAt" TIMESTAMP(3);

CREATE INDEX "Item_ignored_ignoredAt_idx" ON "Item"("ignored", "ignoredAt");
