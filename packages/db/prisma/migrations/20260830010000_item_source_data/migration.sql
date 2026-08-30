-- Preserve public marketplace fields that do not map cleanly to the shared
-- Item columns (seller metadata, shipping text, condition labels, JSON-LD).
ALTER TABLE "Item" ADD COLUMN "source_data" JSONB;
