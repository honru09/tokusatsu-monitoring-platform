CREATE TYPE "ShfLine" AS ENUM ('standard', 'shinkocchou');
CREATE TYPE "ShfReleaseChannel" AS ENUM ('retail', 'tamashii_web', 'event', 'unknown');
CREATE TYPE "ShfEdition" AS ENUM ('first', 'reissue', 'unknown');
CREATE TYPE "ShfRegion" AS ENUM ('japanese', 'agent', 'hong_kong', 'unknown');

ALTER TABLE "Item"
  ADD COLUMN "shf_line" "ShfLine",
  ADD COLUMN "shf_release_channel" "ShfReleaseChannel",
  ADD COLUMN "shf_edition" "ShfEdition",
  ADD COLUMN "shf_region" "ShfRegion";

WITH candidates AS (
  SELECT
    "id",
    "titleRaw" AS title,
    CONCAT("titleRaw", E'\n', COALESCE("descriptionRaw", '')) AS full_text
  FROM "Item"
  WHERE "categoryIp" = 'kamen_rider'
    AND CONCAT("titleRaw", E'\n', COALESCE("descriptionRaw", '')) ~*
      '(S\.?[[:space:]]*H\.?[[:space:]]*Figuarts|S\.?[[:space:]]*H\.?[[:space:]]*フィギュアーツ|(^|[^[:alnum:]])SHF([^[:alnum:]]|$)|真骨[彫雕](製法)?|SHINKOCCHOU[[:space:]]*SEIHOU)'
    AND "titleRaw" !~*
      '(装動|SO[ -]?DO|勇動|(^|[^[:alnum:]])RKF([^[:alnum:]]|$)|S\.?I\.?C([[:space:]]|$)|Figuarts[[:space:]]*ZERO|フィギュアーツ[[:space:]]*ZERO|食玩|扭蛋|ガシャポン|ガチャポン|盒蛋|掌動|超動|創動|创动|(^|[^[:alnum:]])FW([^[:alnum:]]|$)|(^|[^[:alnum:]])ME([^[:alnum:]]|$)|一番くじ|一番赏|景品|ソフビ|软胶|ウルトラアクションフィギュア|(^|[^[:alnum:]])ACT([^[:alnum:]]|$)|(^|[^[:alnum:]])DD([^[:alnum:]]|$)|プラモデル|拼装模型|Figure-rise[[:space:]]*Standard|(^|[^[:alnum:]])FRS([^[:alnum:]]|$))'
)
UPDATE "Item" AS item
SET
  "shf_line" = CASE
    WHEN candidates.full_text ~* '(真骨[彫雕](製法)?|SHINKOCCHOU[[:space:]]*SEIHOU)'
      THEN 'shinkocchou'::"ShfLine"
    ELSE 'standard'::"ShfLine"
  END,
  "shf_release_channel" = CASE
    WHEN candidates.full_text ~* '(魂(網|网|ウェブ|WEB)?限定|魂ウェブ商店|魂WEB商店|Tamashii[[:space:]]*Web限定|輸送箱|运输盒)'
      THEN 'tamashii_web'::"ShfReleaseChannel"
    WHEN candidates.full_text ~* '(会場限定|活动限定|イベント限定|Tamashii[[:space:]]*Store限定|TNT限定|実店舗限定|实体店限定)'
      THEN 'event'::"ShfReleaseChannel"
    WHEN candidates.full_text ~* '(通[販贩]|一般販売|店頭販売)'
      THEN 'retail'::"ShfReleaseChannel"
    ELSE 'unknown'::"ShfReleaseChannel"
  END,
  "shf_edition" = CASE
    WHEN candidates.full_text ~* '(再販|再版|二次(生産|生产)|復刻)'
      THEN 'reissue'::"ShfEdition"
    WHEN candidates.full_text ~* '(初版|初回(生産|生产)|首次发售)'
      THEN 'first'::"ShfEdition"
    ELSE 'unknown'::"ShfEdition"
  END,
  "shf_region" = CASE
    WHEN candidates.full_text ~* '(代理版|中国版|大陸版|大陆版|中文(シール|贴纸)|防偽猫貼|防伪猫贴|猫貼|猫贴)'
      THEN 'agent'::"ShfRegion"
    WHEN candidates.full_text ~* '(香港版|港版)'
      THEN 'hong_kong'::"ShfRegion"
    WHEN candidates.full_text ~* '(日版|日本国内版|国内正規|魂(ホログラム|镭射标|鐳射標))'
      THEN 'japanese'::"ShfRegion"
    ELSE 'unknown'::"ShfRegion"
  END
FROM candidates
WHERE item."id" = candidates."id";

CREATE INDEX "Item_categoryIp_shf_line_listingType_idx"
  ON "Item"("categoryIp", "shf_line", "listingType");
