-- Repair: earlier backfill + dual-write preferred bundle.note for inventory
-- order `name`. Display name must come from the linked listing/product title.
-- Additive only: updates `name` where it currently equals `note` (or is empty)
-- and a better title exists. Never deletes note or other columns.

BEGIN;

UPDATE "inventory_orders" AS io
SET
  "name" = title_src."title",
  "updated_at" = CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON (order_row."id")
    order_row."id" AS order_id,
    COALESCE(
      NULLIF(btrim(item."title_zh"), ''),
      NULLIF(btrim(item."titleRaw"), '')
    ) AS title
  FROM "inventory_orders" AS order_row
  INNER JOIN "PurchaseRecord" AS purchase
    ON purchase."bundle_id" = order_row."source_bundle_id"
  INNER JOIN "Item" AS item ON item."id" = purchase."itemId"
  WHERE order_row."source_bundle_id" IS NOT NULL
    AND (
      (
        order_row."note" IS NOT NULL
        AND NULLIF(btrim(order_row."note"), '') IS NOT NULL
        AND order_row."name" IS NOT DISTINCT FROM order_row."note"
      )
      OR NULLIF(btrim(COALESCE(order_row."name", '')), '') IS NULL
    )
  ORDER BY
    order_row."id",
    purchase."createdAt" ASC,
    purchase."id" ASC
) AS title_src
WHERE io."id" = title_src.order_id
  AND title_src."title" IS NOT NULL
  AND title_src."title" IS DISTINCT FROM io."name";

COMMIT;
