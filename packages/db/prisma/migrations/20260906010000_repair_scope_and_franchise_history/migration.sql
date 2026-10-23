-- Keep historical rows under the same physical-toy scope enforced for new
-- crawler writes. Archiving preserves purchase/audit relations while removing
-- these rows from every live procurement workspace.
UPDATE "Item"
SET
  "archivedAt" = COALESCE("archivedAt", CURRENT_TIMESTAMP),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "archivedAt" IS NULL
  AND (
    "categoryToyType"::text = 'card'
    OR "titleRaw" ~* '(mook|magazine|comic|novel|書籍|漫画|マンガ|コミック|写真集|攻略本|図鑑|辞典|事典|図録|資料集|雑誌|絵本|小説|冊子|パンフレット|チラシ|フライヤー|ポスター|カタログ|新聞|号外)'
    OR (
      "titleRaw" ~* '(^|[^[:alpha:]])(DVD|CD)([^[:alpha:]]|$)|Blu[‐-]?ray|ブルーレイ|サウンドトラック|ゲームソフト|プレイステーション|プレステ|レンタル落ち'
      AND "titleRaw" !~* 'ベルト|ドライバー|ソフビ|フィギュア|ガシャポン|ガチャ|食玩|玩具|おもちゃ|変身|プラモデル|模型|メダル|ロックシード|ガシャット|アイテム|可動|人形|指人形|ワンダーライドブック'
    )
    OR (
      "titleRaw" ~* 'トレーディングカード|トレカ|カードダス|カードゲーム|カード[[:space:]]*(のみ|だけ|まとめ売り)|シール[[:space:]]*(のみ|だけ)|ステッカー[[:space:]]*(のみ|だけ)'
      AND "titleRaw" !~* 'カードデッキ|カード付き|カード付属|カード含む'
    )
    OR (
      COALESCE("descriptionRaw", '') ~* '(カード|シール|ステッカー)[[:space:]]*(のみ|だけ)|トレーディングカード|カードダス|書籍|雑誌|漫画|コミック|小説|写真集'
      AND "titleRaw" !~* 'DX|ベルト|ドライバー|フィギュア|ソフビ|ガシャット|ゴチゾウ|プログライズキー|アイコン|メモリ|バックル|変身|可動|プラモデル|消しゴム'
    )
  );

-- Repair legacy franchise labels only when the public listing title contains
-- one, and only one, deterministic franchise signal. Title evidence outranks
-- seller boilerplate in the description and mixed-franchise lots stay as-is.
WITH evidence AS (
  SELECT
    "id",
    (
      "titleRaw" ~* '仮面(ライダー|らいだー|わんだー)|假面骑士|kamen[[:space:]_-]*rider|ライダー(ヒーロー|怪人|ガシャット|スイング|アドバンス|ゴチゾウ|カプセム|エグズ)|レジェンドライダー|平成ライダー|昭和ライダー|スカイライダー|シャドームーン|オルフェノク|ショッカー|ガシャット|ライドウォッチ|プログライズキー|ワンダーライドブック|バイスタンプ|レイズバックル|ゴチゾウ|フルボトル|ロックシード|オー?メダル|ガイアメモリ|アストロスイッチ|ウィザードリング|シフトカー|眼魂|ゴーストアイコン|ライドケミー(トレカ)?|カプセム|ライドエグズ|ガシャコン|ゼクター|デンオウベルト|ディケイドライバー|ダブルドライバー|オーズドライバー|フォーゼドライバー|ウィザードライバー|戦極ドライバー|ゲネシスドライバー|ドライブドライバー|ゴーストドライバー|ゲーマドライバー|ビルドドライバー|ジクウドライバー|ゼロワンドライバー|聖剣ソードライバー|リバイスドライバー|デザイアドライバー|ガッチャードライバー|ゼッツドライバー|ノクスドライバー|カイザドライバー|デルタドライバー|ロストドライバー|アークドライバー|ヴィジョンドライバー|ベイルドライバー|デストリームドライバー|クウガ|アギト|龍騎|ファイズ|ディケイド|オーズ|フォーゼ|鎧武|ガイム|エグゼイド|ジオウ|ゼロワン|リバイス|ギーツ|ガッチャード|ゼッツ'
    ) AS is_kamen_rider,
    (
      "titleRaw" ~* 'ウルトラ(マン|セブン|Q|怪獣|ヒーロー|アクション|レプリカ|カプセル|メダル|エッグ|メカニックス|怪獣戯画|怪獣名鑑|コレクション|兄弟|五兄弟)|奥特曼|奧特曼|ultra[[:space:]_-]*(man|seven)|赛罗|賽羅|バルタン星人|ゼットン|エレキング|キングジョー|カネゴン|ピグモン|ジャミラ|ゴモラ|メフィラス星人|ザラブ星人|ペガッサ星人|バキシム|ジラース|ガラモン|ウインダム|ザラガス|ザムシャー|ベムラー|レッドキング|ツインテール|ペギラ|メトロン星人|カルミラ'
    ) AS is_ultraman,
    (
      "titleRaw" ~* 'スーパー戦隊|超级战队|超級戰隊|super[[:space:]_-]*sentai|戦隊(ヒーロー|シリーズ|ロボ)|歴代戦隊|ゴレンジャー|ジャッカー|バトルフィーバー|デンジマン|サンバルカン|ゴーグルファイブ|ダイナマン|バイオマン|チェンジマン|フラッシュマン|マスクマン|ライブマン|ターボレンジャー|ファイブマン|ジェットマン|ジュウレンジャー|ダイレンジャー|カクレンジャー|オーレンジャー|カーレンジャー|メガレンジャー|ギンガマン|ゴーゴーファイブ|タイムレンジャー|ガオレンジャー|ハリケンジャー|アバレンジャー|デカレンジャー|マジレンジャー|ボウケンジャー|ゲキレンジャー|ゴーオンジャー|シンケンジャー|ゴセイジャー|ゴーカイジャー|ゴーバスターズ|キョウリュウジャー|トッキュウジャー|ニンニンジャー|ジュウオウジャー|キュウレンジャー|ルパンレンジャー|パトレンジャー|リュウソウジャー|キラメイジャー|ゼンカイジャー|ドンブラザーズ|キングオージャー|ブンブンジャー|ゴジュウジャー|レンジャーキー|センタイギア|アバタロウギア|獣電池'
    ) AS is_super_sentai,
    (
      "titleRaw" ~* 'ゴジラ|哥斯拉|godzilla|メカゴジラ|スペースゴジラ|キングギドラ|デストロイア|ビオランテ|ガイガン|ヘドラ|アンギラス|ミニラ([^ァ-ヶー]|$)'
    ) AS is_godzilla
  FROM "Item"
  WHERE "archivedAt" IS NULL
), classified AS (
  SELECT
    "id",
    CASE
      WHEN is_kamen_rider THEN 'kamen_rider'::"CategoryIp"
      WHEN is_ultraman THEN 'ultraman'::"CategoryIp"
      WHEN is_super_sentai THEN 'super_sentai'::"CategoryIp"
      WHEN is_godzilla THEN 'godzilla'::"CategoryIp"
      ELSE NULL
    END AS category_ip
  FROM evidence
  WHERE
    is_kamen_rider::integer
    + is_ultraman::integer
    + is_super_sentai::integer
    + is_godzilla::integer = 1
)
UPDATE "Item" AS item
SET
  "categoryIp" = classified.category_ip,
  "updatedAt" = CURRENT_TIMESTAMP
FROM classified
WHERE item."id" = classified."id"
  AND classified.category_ip IS NOT NULL
  AND item."categoryIp" IS DISTINCT FROM classified.category_ip;

-- Series-to-franchise ownership comes from the curated catalogue, never from
-- seller descriptions. Older workers could re-parent a Series while matching
-- a listing whose description mentioned another franchise.
INSERT INTO franchises (
  id,
  key,
  name_ja,
  name_zh,
  name_en,
  updated_at
)
VALUES
  ('catalog-franchise-super-sentai', 'SUPER_SENTAI', 'スーパー戦隊', '超级战队', 'Super Sentai', CURRENT_TIMESTAMP),
  ('catalog-franchise-godzilla', 'GODZILLA', 'ゴジラ', '哥斯拉', 'Godzilla', CURRENT_TIMESTAMP)
ON CONFLICT (key) DO UPDATE SET
  name_ja = EXCLUDED.name_ja,
  name_zh = EXCLUDED.name_zh,
  name_en = EXCLUDED.name_en,
  updated_at = CURRENT_TIMESTAMP;

-- Remove the historical two-character aliases that caused ゼロノス and
-- ゼロワン listings to be interpreted as Ultraman Zero.
DELETE FROM catalog_aliases
WHERE entity_type = 'series'
  AND entity_key = 'ULTRAMAN_ZERO'
  AND normalized_text IN ('ゼロ', 'zero');

UPDATE series AS series_row
SET
  franchise_id = franchise_row.id,
  updated_at = CURRENT_TIMESTAMP
FROM franchises AS franchise_row
WHERE
  (
    series_row.key LIKE 'KAMEN_RIDER_%'
    AND franchise_row.key = 'KAMEN_RIDER'
  )
  OR (
    series_row.key LIKE 'ULTRAMAN_%'
    AND franchise_row.key = 'ULTRAMAN'
  )
  OR (
    series_row.key LIKE 'SUPER_SENTAI_%'
    AND franchise_row.key = 'SUPER_SENTAI'
  )
  OR (
    series_row.key LIKE 'GODZILLA_%'
    AND franchise_row.key = 'GODZILLA'
  );

-- A canonical Product that has a Series must share that Series' parent.
UPDATE products AS product
SET
  franchise_id = series_row.franchise_id,
  updated_at = CURRENT_TIMESTAMP
FROM series AS series_row
WHERE product.series_id = series_row.id
  AND product.franchise_id IS DISTINCT FROM series_row.franchise_id;

-- Fill historical products that never received a normalized franchise only
-- when every active listing attached to that product agrees on one known IP.
WITH unanimous_product_category AS (
  SELECT
    item.product_id,
    MIN(item."categoryIp"::text) AS category_ip
  FROM "Item" AS item
  WHERE item.product_id IS NOT NULL
    AND item."archivedAt" IS NULL
    AND item."categoryIp" IN (
      'kamen_rider'::"CategoryIp",
      'ultraman'::"CategoryIp",
      'super_sentai'::"CategoryIp",
      'godzilla'::"CategoryIp"
    )
  GROUP BY item.product_id
  HAVING COUNT(DISTINCT item."categoryIp") = 1
), product_parent AS (
  SELECT
    unanimous.product_id,
    franchise_row.id AS franchise_id
  FROM unanimous_product_category AS unanimous
  JOIN franchises AS franchise_row
    ON franchise_row.key = CASE unanimous.category_ip
      WHEN 'kamen_rider' THEN 'KAMEN_RIDER'
      WHEN 'ultraman' THEN 'ULTRAMAN'
      WHEN 'super_sentai' THEN 'SUPER_SENTAI'
      WHEN 'godzilla' THEN 'GODZILLA'
    END
)
UPDATE products AS product
SET
  franchise_id = parent.franchise_id,
  updated_at = CURRENT_TIMESTAMP
FROM product_parent AS parent
WHERE product.id = parent.product_id
  AND product.series_id IS NULL
  AND product.franchise_id IS NULL;

-- Detach only explicit cross-franchise listing/product conflicts. The worker's
-- deterministic backfill rematches these rows after the corrected catalogue is
-- seeded. Products without franchise evidence remain attached and reviewable.
UPDATE "Item" AS item
SET
  product_id = NULL,
  match_confidence = NULL,
  match_decision = 'unmatched'::"MatchDecision",
  "needsReview" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP
FROM products AS product
JOIN franchises AS franchise_row ON franchise_row.id = product.franchise_id
WHERE item.product_id = product.id
  AND item."archivedAt" IS NULL
  AND (
    (item."categoryIp" = 'kamen_rider'::"CategoryIp" AND franchise_row.key <> 'KAMEN_RIDER')
    OR (item."categoryIp" = 'ultraman'::"CategoryIp" AND franchise_row.key <> 'ULTRAMAN')
    OR (item."categoryIp" = 'super_sentai'::"CategoryIp" AND franchise_row.key <> 'SUPER_SENTAI')
    OR (item."categoryIp" = 'godzilla'::"CategoryIp" AND franchise_row.key <> 'GODZILLA')
  );
