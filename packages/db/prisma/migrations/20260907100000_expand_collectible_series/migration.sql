CREATE TYPE "CollectibleSeries" AS ENUM ('shf', 'sic');

ALTER TABLE "Item"
ADD COLUMN "collectible_series" "CollectibleSeries";

WITH candidates AS (
  SELECT
    "id",
    "categoryIp",
    "titleRaw",
    COALESCE("descriptionRaw", '') AS description_raw,
    ("titleRaw" || E'\n' || COALESCE("descriptionRaw", '')) AS full_text
  FROM "Item"
  WHERE "categoryIp" IN ('kamen_rider', 'ultraman')
)
UPDATE "Item" AS item
SET
  "collectible_series" = 'shf',
  "shf_line" = CASE
    WHEN candidates.full_text ~* '(真骨[彫雕](製法)?|SHINKOCCHOU[[:space:]]*SEIHOU)'
      THEN 'shinkocchou'::"ShfLine"
    ELSE 'standard'::"ShfLine"
  END
FROM candidates
WHERE item."id" = candidates."id"
  AND candidates.full_text ~* '(S\.?[[:space:]]*H\.?[[:space:]]*Figuarts|S\.?[[:space:]]*H\.?[[:space:]]*フィギュアーツ|(^|[^[:alnum:]])SHF([^[:alnum:]]|$)|真骨[彫雕](製法)?|SHINKOCCHOU[[:space:]]*SEIHOU)'
  AND candidates."titleRaw" !~* '(装動|SO[[:space:]-]?DO|勇動|(^|[^[:alnum:]])RKF([^[:alnum:]]|$)|S\.?I\.?C|Figuarts[[:space:]]*ZERO|フィギュアーツ[[:space:]]*ZERO|食玩|ガシャポン|ガチャポン|掌動|超動|創動|一番くじ|景品|ソフビ|ウルトラアクションフィギュア|Figure-rise[[:space:]]*Standard|(^|[^[:alnum:]])FRS([^[:alnum:]]|$))';

UPDATE "Item"
SET "collectible_series" = 'shf'
WHERE "shf_line" IS NOT NULL
  AND "collectible_series" IS NULL;

UPDATE "Item"
SET "collectible_series" = 'sic'
WHERE "categoryIp" = 'kamen_rider'
  AND ("titleRaw" || E'\n' || COALESCE("descriptionRaw", '')) ~* '((^|[^[:alnum:]_])S[.]?[[:space:]]*I[.]?[[:space:]]*C[.]?([^[:alnum:]_]|$)|SIC極魂)'
  AND "collectible_series" IS NULL;

CREATE INDEX "Item_collectible_series_categoryIp_listingType_idx"
ON "Item"("collectible_series", "categoryIp", "listingType");
