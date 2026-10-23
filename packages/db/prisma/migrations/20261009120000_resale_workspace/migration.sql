CREATE TABLE "resale_settings" (
  "id" TEXT NOT NULL DEFAULT 'default', "paused" BOOLEAN NOT NULL DEFAULT true,
  "auto_import" BOOLEAN NOT NULL DEFAULT false, "auto_generate" BOOLEAN NOT NULL DEFAULT false, "auto_publish" BOOLEAN NOT NULL DEFAULT false,
  "daily_publish_limit" INTEGER NOT NULL DEFAULT 30, "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "min_price_jpy" INTEGER NOT NULL DEFAULT 0, "max_price_jpy" INTEGER NOT NULL DEFAULT 1000000,
  "exchange_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.05, "markup_percent" DOUBLE PRECISION NOT NULL DEFAULT 30,
  "extra_cost_cny" DOUBLE PRECISION NOT NULL DEFAULT 0, "source_fresh_minutes" INTEGER NOT NULL DEFAULT 10,
  "delivery_text" TEXT NOT NULL DEFAULT '', "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "resale_settings_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "resale_listings" (
  "id" TEXT NOT NULL, "item_id" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'draft', "version" INTEGER NOT NULL DEFAULT 1,
  "human_control" BOOLEAN NOT NULL DEFAULT false, "title" TEXT NOT NULL, "description" TEXT NOT NULL,
  "price_cny" DOUBLE PRECISION NOT NULL, "image_urls" TEXT[] DEFAULT ARRAY[]::TEXT[], "delivery_text" TEXT NOT NULL DEFAULT '',
  "rights_confirmed" BOOLEAN NOT NULL DEFAULT false, "fulfillment_confirmed" BOOLEAN NOT NULL DEFAULT false,
  "source_price_jpy" INTEGER NOT NULL, "source_shipping_jpy" INTEGER,
  "generated_at" TIMESTAMPTZ, "generation_token" TEXT, "generation_started_at" TIMESTAMPTZ, "generation_error" TEXT, "generation_requested_by" TEXT,
  "target_item_id" TEXT, "target_url" TEXT, "published_at" TIMESTAMPTZ, "publish_origin" TEXT,
  "operation_token" TEXT, "operation_started_at" TIMESTAMPTZ, "requires_withdrawal" BOOLEAN NOT NULL DEFAULT false,
  "last_error" TEXT, "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "resale_listings_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "resale_events" (
  "id" TEXT NOT NULL, "listing_id" TEXT, "account_id" TEXT, "action" TEXT NOT NULL, "detail" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "resale_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "resale_listings_item_id_key" ON "resale_listings"("item_id");
CREATE UNIQUE INDEX "resale_listings_target_item_id_key" ON "resale_listings"("target_item_id");
CREATE INDEX "resale_listings_status_human_control_updated_at_idx" ON "resale_listings"("status", "human_control", "updated_at");
CREATE INDEX "resale_events_listing_id_created_at_idx" ON "resale_events"("listing_id", "created_at");
CREATE INDEX "resale_events_action_created_at_idx" ON "resale_events"("action", "created_at");
ALTER TABLE "resale_listings" ADD CONSTRAINT "resale_listings_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resale_events" ADD CONSTRAINT "resale_events_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "resale_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
