-- Additive batch inventory orders. Legacy purchase_bundles / PurchaseRecord
-- rows are never deleted or mutated. Each non-archived bundle becomes one
-- inventory order with best-effort qty/cost; originals remain readable.
--
-- Reverse (manual): DROP TRIGGER / DROP TABLE inventory_adjustments,
-- sales_records, inventory_orders — does not restore dual-written rows into
-- purchase tables because those were never removed.

BEGIN;

CREATE TABLE "inventory_orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "name" TEXT,
    "platform" TEXT,
    "purchase_cost" INTEGER NOT NULL,
    "initial_quantity" INTEGER NOT NULL,
    "remaining_quantity" INTEGER NOT NULL,
    "sold_quantity" INTEGER NOT NULL DEFAULT 0,
    "total_sales" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'in_stock',
    "purchased_at" TIMESTAMPTZ,
    "image_url" TEXT,
    "note" TEXT,
    "source_bundle_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "inventory_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_orders_order_number_key" UNIQUE ("order_number"),
    CONSTRAINT "inventory_orders_source_bundle_id_key" UNIQUE ("source_bundle_id"),
    CONSTRAINT "inventory_orders_purchase_cost_check"
      CHECK ("purchase_cost" >= 0),
    CONSTRAINT "inventory_orders_initial_quantity_check"
      CHECK ("initial_quantity" >= 1),
    CONSTRAINT "inventory_orders_remaining_quantity_check"
      CHECK ("remaining_quantity" >= 0 AND "remaining_quantity" <= "initial_quantity"),
    CONSTRAINT "inventory_orders_sold_quantity_check"
      CHECK ("sold_quantity" >= 0),
    CONSTRAINT "inventory_orders_total_sales_check"
      CHECK ("total_sales" >= 0),
    CONSTRAINT "inventory_orders_status_check"
      CHECK ("status" IN ('in_stock', 'partially_sold', 'sold_out'))
);

CREATE TABLE "sales_records" (
    "id" TEXT NOT NULL,
    "inventory_order_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sale_price" INTEGER NOT NULL,
    "cost_of_sale" INTEGER NOT NULL,
    "profit" INTEGER NOT NULL,
    "note" TEXT,
    "sold_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sales_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_records_quantity_check" CHECK ("quantity" >= 1),
    CONSTRAINT "sales_records_sale_price_check" CHECK ("sale_price" >= 0)
);

CREATE TABLE "inventory_adjustments" (
    "id" TEXT NOT NULL,
    "inventory_order_id" TEXT NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_adjustments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_adjustments_quantity_delta_check"
      CHECK ("quantity_delta" <> 0),
    CONSTRAINT "inventory_adjustments_reason_check"
      CHECK (char_length(btrim("reason")) BETWEEN 1 AND 1000)
);

-- Backfill: one non-archived purchase bundle → one inventory order.
-- Quantity = GREATEST(1, sum of member quantityEst or 1 per member).
-- Assume none sold yet (no historical sales ledger). Status stays in_stock.
INSERT INTO "inventory_orders" (
  "id",
  "order_number",
  "name",
  "platform",
  "purchase_cost",
  "initial_quantity",
  "remaining_quantity",
  "sold_quantity",
  "total_sales",
  "status",
  "purchased_at",
  "image_url",
  "note",
  "source_bundle_id",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid()::text,
  'ORD-' || upper(substr(replace(bundle."id", '-', ''), 1, 8)),
  COALESCE(
    NULLIF(btrim(bundle."note"), ''),
    (
      SELECT COALESCE(NULLIF(item."title_zh", ''), item."titleRaw")
      FROM "PurchaseRecord" AS purchase
      INNER JOIN "Item" AS item ON item."id" = purchase."itemId"
      WHERE purchase."bundle_id" = bundle."id"
      ORDER BY purchase."createdAt" ASC, purchase."id" ASC
      LIMIT 1
    )
  ),
  (
    SELECT source."displayName"
    FROM "PurchaseRecord" AS purchase
    INNER JOIN "Item" AS item ON item."id" = purchase."itemId"
    INNER JOIN "Source" AS source ON source."id" = item."sourceId"
    WHERE purchase."bundle_id" = bundle."id"
    ORDER BY purchase."createdAt" ASC, purchase."id" ASC
    LIMIT 1
  ),
  bundle."total_purchase_amount",
  GREATEST(
    1,
    COALESCE(
      (
        SELECT SUM(GREATEST(1, COALESCE(item."quantityEst", 1)))::integer
        FROM "PurchaseRecord" AS purchase
        INNER JOIN "Item" AS item ON item."id" = purchase."itemId"
        WHERE purchase."bundle_id" = bundle."id"
      ),
      1
    )
  ),
  GREATEST(
    1,
    COALESCE(
      (
        SELECT SUM(GREATEST(1, COALESCE(item."quantityEst", 1)))::integer
        FROM "PurchaseRecord" AS purchase
        INNER JOIN "Item" AS item ON item."id" = purchase."itemId"
        WHERE purchase."bundle_id" = bundle."id"
      ),
      1
    )
  ),
  0,
  0,
  'in_stock',
  bundle."purchased_at",
  (
    SELECT image."url"
    FROM "PurchaseRecord" AS purchase
    INNER JOIN "ItemImage" AS image ON image."itemId" = purchase."itemId"
    WHERE purchase."bundle_id" = bundle."id"
    ORDER BY purchase."createdAt" ASC, image."position" ASC, image."id" ASC
    LIMIT 1
  ),
  bundle."note",
  bundle."id",
  bundle."created_at",
  bundle."updated_at"
FROM "purchase_bundles" AS bundle
WHERE bundle."archived_at" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "inventory_orders" AS existing
    WHERE existing."source_bundle_id" = bundle."id"
  );

CREATE INDEX "inventory_orders_status_purchased_at_idx"
  ON "inventory_orders"("status", "purchased_at");
CREATE INDEX "inventory_orders_purchased_at_idx"
  ON "inventory_orders"("purchased_at");
CREATE INDEX "inventory_orders_created_at_idx"
  ON "inventory_orders"("created_at");
CREATE INDEX "sales_records_inventory_order_id_sold_at_idx"
  ON "sales_records"("inventory_order_id", "sold_at");
CREATE INDEX "sales_records_sold_at_idx"
  ON "sales_records"("sold_at");
CREATE INDEX "inventory_adjustments_inventory_order_id_created_at_idx"
  ON "inventory_adjustments"("inventory_order_id", "created_at");

ALTER TABLE "sales_records"
  ADD CONSTRAINT "sales_records_inventory_order_id_fkey"
  FOREIGN KEY ("inventory_order_id") REFERENCES "inventory_orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_adjustments"
  ADD CONSTRAINT "inventory_adjustments_inventory_order_id_fkey"
  FOREIGN KEY ("inventory_order_id") REFERENCES "inventory_orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Soft FK to legacy bundles: ON DELETE SET NULL so archive/cleanup of a
-- bundle never destroys the inventory order or its sales history.
ALTER TABLE "inventory_orders"
  ADD CONSTRAINT "inventory_orders_source_bundle_id_fkey"
  FOREIGN KEY ("source_bundle_id") REFERENCES "purchase_bundles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
