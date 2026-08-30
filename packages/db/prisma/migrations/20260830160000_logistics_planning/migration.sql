-- Deterministic package, margin and multi-carrier shipping planning.
CREATE TYPE "ShippingBasis" AS ENUM ('weight', 'volume');

CREATE TABLE "item_logistics" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "weight_grams" INTEGER,
    "package_weight_grams" INTEGER,
    "length_mm" INTEGER,
    "width_mm" INTEGER,
    "height_mm" INTEGER,
    "volume_cm3" INTEGER,
    "estimated_sale_price_yen" INTEGER,
    "estimated_profit_yen" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "item_logistics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shipping_carriers" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'JPY',
    "source_url" TEXT,
    "note" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "shipping_carriers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shipping_tariffs" (
    "id" TEXT NOT NULL,
    "carrier_id" TEXT NOT NULL,
    "service_name" TEXT NOT NULL,
    "basis" "ShippingBasis" NOT NULL,
    "min_value" INTEGER NOT NULL,
    "max_value" INTEGER,
    "price_yen" INTEGER NOT NULL,
    "zone" TEXT NOT NULL DEFAULT 'JP',
    "source_note" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "shipping_tariffs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "item_logistics_item_id_key" ON "item_logistics"("item_id");
CREATE UNIQUE INDEX "shipping_carriers_key_key" ON "shipping_carriers"("key");
CREATE INDEX "item_logistics_updated_at_idx" ON "item_logistics"("updated_at");
CREATE INDEX "shipping_carriers_enabled_display_name_idx" ON "shipping_carriers"("enabled", "display_name");
CREATE INDEX "shipping_tariffs_carrier_id_basis_min_value_idx" ON "shipping_tariffs"("carrier_id", "basis", "min_value");
CREATE INDEX "shipping_tariffs_zone_basis_min_value_idx" ON "shipping_tariffs"("zone", "basis", "min_value");

ALTER TABLE "item_logistics" ADD CONSTRAINT "item_logistics_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shipping_tariffs" ADD CONSTRAINT "shipping_tariffs_carrier_id_fkey" FOREIGN KEY ("carrier_id") REFERENCES "shipping_carriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep the historical active catalogue within the agreed toy-only boundary.
UPDATE "Item"
SET "status" = 'ended', "archivedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'active'
  AND "titleRaw" ~* '(辞典|事典|図鑑|書籍|漫画|マンガ|コミック|雑誌|写真集|攻略本|パンフレット|mook|magazine|comic|novel)';

-- Editable baseline domestic reference tiers. Operators can replace these with
-- the actual forwarding route and destination-zone prices from each carrier.
INSERT INTO "shipping_carriers" ("id", "key", "display_name", "currency", "source_url", "note", "enabled", "updated_at")
VALUES
  (gen_random_uuid()::text, 'yamato_reference', 'ヤマト運輸（参考）', 'JPY', 'https://www.kuronekoyamato.co.jp/ytc/search/estimate/ichiran.html', '参考阶梯，按实际地区与燃油附加费校准', true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'jppost_reference', '日本郵便 ゆうパック（参考）', 'JPY', 'https://www.post.japanpost.jp/service/you_pack/charge/ichiran.html', '参考阶梯，按实际地区与燃油附加费校准', true, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'sagawa_reference', '佐川急便（参考）', 'JPY', 'https://www.sagawa-exp.co.jp/send/fare/faretable.html', '参考阶梯，按实际地区与燃油附加费校准', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

WITH c AS (SELECT "id", "key" FROM "shipping_carriers" WHERE "key" IN ('yamato_reference','jppost_reference','sagawa_reference'))
INSERT INTO "shipping_tariffs" ("id", "carrier_id", "service_name", "basis", "min_value", "max_value", "price_yen", "zone", "source_note", "updated_at")
SELECT gen_random_uuid()::text, c."id", '标准宅配', 'weight'::"ShippingBasis", t.min_value, t.max_value, t.price_yen, 'JP', '参考阶梯；请在设置中按实际线路维护', CURRENT_TIMESTAMP
FROM c
CROSS JOIN (VALUES
  (0, 1000, 810),
  (1001, 2000, 930),
  (2001, 5000, 1150),
  (5001, 10000, 1450),
  (10001, NULL::integer, 1900)
) AS t(min_value, max_value, price_yen)
WHERE NOT EXISTS (SELECT 1 FROM "shipping_tariffs" st WHERE st."carrier_id" = c."id");

WITH c AS (SELECT "id" FROM "shipping_carriers" WHERE "key" IN ('yamato_reference','jppost_reference','sagawa_reference'))
INSERT INTO "shipping_tariffs" ("id", "carrier_id", "service_name", "basis", "min_value", "max_value", "price_yen", "zone", "source_note", "updated_at")
SELECT gen_random_uuid()::text, c."id", '体积参考', 'volume'::"ShippingBasis", t.min_value, t.max_value, t.price_yen, 'JP', '体积重参考；请按承运商计泡规则校准', CURRENT_TIMESTAMP
FROM c
CROSS JOIN (VALUES
  (0, 10000, 810),
  (10001, 20000, 1050),
  (20001, 40000, 1350),
  (40001, 80000, 1750),
  (80001, NULL::integer, 2300)
) AS t(min_value, max_value, price_yen)
WHERE NOT EXISTS (SELECT 1 FROM "shipping_tariffs" st WHERE st."carrier_id" = c."id" AND st."basis" = 'volume');
