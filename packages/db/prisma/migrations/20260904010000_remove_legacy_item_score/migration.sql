-- The scoring system was removed from every public and internal workflow.
-- This final legacy column survived the earlier inventory-only cleanup.
ALTER TABLE "Item"
  DROP COLUMN IF EXISTS "procurementScore";
