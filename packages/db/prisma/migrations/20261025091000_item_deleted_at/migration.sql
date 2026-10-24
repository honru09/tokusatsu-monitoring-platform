-- Pure delete tombstone: the row stays as the (sourceId, sourceItemId)
-- unique-key marker so the same listing is never re-imported for display.

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Item_deleted_at_status_idx" ON "Item"("deleted_at", "status");
