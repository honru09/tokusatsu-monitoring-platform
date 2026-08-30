CREATE TABLE "exchange_rates" (
    "pair" TEXT NOT NULL,
    "base_currency" TEXT NOT NULL,
    "quote_currency" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "source" TEXT NOT NULL,
    "reference_date" DATE NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("pair")
);

CREATE TABLE "shopping_carts" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "shopping_carts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shopping_cart_items" (
    "id" TEXT NOT NULL,
    "cart_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "shopping_cart_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cart_shares" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "cart_id" TEXT,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ,
    CONSTRAINT "cart_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shopping_carts_key_key" ON "shopping_carts"("key");
CREATE UNIQUE INDEX "shopping_cart_items_cart_id_item_id_key" ON "shopping_cart_items"("cart_id", "item_id");
CREATE UNIQUE INDEX "cart_shares_token_key" ON "cart_shares"("token");
CREATE INDEX "exchange_rates_fetched_at_idx" ON "exchange_rates"("fetched_at");
CREATE INDEX "shopping_cart_items_item_id_idx" ON "shopping_cart_items"("item_id");
CREATE INDEX "cart_shares_created_at_idx" ON "cart_shares"("created_at");
CREATE INDEX "cart_shares_expires_at_idx" ON "cart_shares"("expires_at");

ALTER TABLE "shopping_cart_items" ADD CONSTRAINT "shopping_cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "shopping_carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shopping_cart_items" ADD CONSTRAINT "shopping_cart_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_shares" ADD CONSTRAINT "cart_shares_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "shopping_carts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
