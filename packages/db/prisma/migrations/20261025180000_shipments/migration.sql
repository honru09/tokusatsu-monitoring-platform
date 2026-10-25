-- Confirmed outbound parcels for the shipping packing flow. Confirming a
-- shipment decrements inventory_orders.remaining_quantity per line.
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "total_declared" INTEGER NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shipment_lines" (
    "id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "inventory_order_id" TEXT NOT NULL,
    "item_name" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_declared_yen" INTEGER NOT NULL,
    "line_total_yen" INTEGER NOT NULL,

    CONSTRAINT "shipment_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shipments_created_at_idx" ON "shipments"("created_at");
CREATE INDEX "shipments_created_by_id_created_at_idx" ON "shipments"("created_by_id", "created_at");
CREATE INDEX "shipment_lines_shipment_id_idx" ON "shipment_lines"("shipment_id");
CREATE INDEX "shipment_lines_inventory_order_id_idx" ON "shipment_lines"("inventory_order_id");

ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "manager_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_inventory_order_id_fkey" FOREIGN KEY ("inventory_order_id") REFERENCES "inventory_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
