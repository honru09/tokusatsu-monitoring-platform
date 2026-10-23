-- Re-evaluate every historical row from public listing evidence. The patterns
-- mirror packages/shared/src/classification.ts and deliberately avoid generic
-- words such as 怪獣. Existing categories are only changed when a deterministic
-- franchise marker says otherwise.
WITH listing_evidence AS (
  SELECT
    "id",
    concat_ws(E'\n', "titleRaw", "descriptionRaw", "conditionRaw") AS evidence,
    "titleRaw" AS title,
    coalesce("descriptionRaw", '') AS description,
    "categoryToyType"::text AS toy_type
  FROM "Item"
),
in_scope AS (
  SELECT "id", evidence
  FROM listing_evidence
  WHERE toy_type <> 'card'
    AND title !~* '(mook|magazine|comic|novel|書籍|漫画|マンガ|コミック|写真集|攻略本|図鑑|辞典|事典|図録|資料集|雑誌|絵本|小説|冊子|パンフレット)'
    AND NOT (
      title ~* '(^|[^[:alpha:]])(DVD|CD)([^[:alpha:]]|$)|Blu[‐-]?ray|ブルーレイ|サウンドトラック|ゲームソフト|プレイステーション|プレステ|レンタル落ち'
      AND title !~* 'ベルト|ドライバー|ソフビ|フィギュア|ガシャポン|ガチャ|食玩|玩具|おもちゃ|変身|プラモデル|模型|メダル|ロックシード|ガシャット|アイテム|可動|人形|指人形|ワンダーライドブック'
    )
    AND NOT (
      title ~* 'トレーディングカード|トレカ|カードダス|カードゲーム|カード[[:space:]]*(のみ|だけ|まとめ売り)|シール[[:space:]]*(のみ|だけ)|ステッカー[[:space:]]*(のみ|だけ)'
    )
    AND NOT (
      description ~* '(カード|シール|ステッカー)[[:space:]]*(のみ|だけ)|トレーディングカード|カードダス|書籍|雑誌|漫画|コミック|小説|写真集'
      AND title !~* 'DX|ベルト|ドライバー|フィギュア|ソフビ|ガシャット|ゴチゾウ|プログライズキー|アイコン|メモリ|バックル|変身|可動|プラモデル|消しゴム'
    )
),
classified AS (
  SELECT
    "id",
    CASE
      WHEN evidence ~* '仮面(ライダー|らいだー|わんだー)|假面骑士|kamen[[:space:]_-]*rider|ライダー(ヒーロー|怪人|ガシャット|スイング|アドバンス|ゴチゾウ|カプセム|エグズ)|レジェンドライダー|平成ライダー|昭和ライダー|スカイライダー|シャドームーン|オルフェノク|ショッカー|ガシャット|ライドウォッチ|プログライズキー|ワンダーライドブック|バイスタンプ|レイズバックル|ゴチゾウ|フルボトル|ロックシード|オー?メダル|ガイアメモリ|アストロスイッチ|ウィザードリング|シフトカー|眼魂|ゴーストアイコン|ライドケミー(トレカ)?|カプセム|ライドエグズ|ガシャコン|ゼクター|デンオウベルト|ディケイドライバー|ダブルドライバー|オーズドライバー|フォーゼドライバー|ウィザードライバー|戦極ドライバー|ゲネシスドライバー|ドライブドライバー|ゴーストドライバー|ゲーマドライバー|ビルドドライバー|ジクウドライバー|ゼロワンドライバー|聖剣ソードライバー|リバイスドライバー|デザイアドライバー|ガッチャードライバー|ゼッツドライバー|ノクスドライバー|カイザドライバー|デルタドライバー|ロストドライバー|アークドライバー|ヴィジョンドライバー|ベイルドライバー|デストリームドライバー|クウガ|アギト|龍騎|ファイズ|ディケイド|オーズ|フォーゼ|鎧武|ガイム|エグゼイド|ジオウ|ゼロワン|リバイス|ギーツ|ガッチャード|ゼッツ'
        THEN 'kamen_rider'::"CategoryIp"
      WHEN evidence ~* 'ウルトラ(マン|セブン|Q|怪獣|ヒーロー|アクション|レプリカ|カプセル|メダル|エッグ|メカニックス|怪獣戯画|怪獣名鑑|コレクション|兄弟|五兄弟)|奥特曼|ultra[[:space:]_-]*(man|seven)|バルタン星人|ゼットン|エレキング|キングジョー|カネゴン|ピグモン|ジャミラ|ゴモラ|メフィラス星人|ザラブ星人|ペガッサ星人|バキシム|ジラース|ガラモン|ウインダム|ザラガス|ザムシャー|ベムラー|レッドキング|ツインテール|ペギラ|メトロン星人|カルミラ'
        THEN 'ultraman'::"CategoryIp"
      WHEN evidence ~* 'スーパー戦隊|超级战队|超級戰隊|super[[:space:]_-]*sentai|戦隊(ヒーロー|シリーズ|ロボ)|歴代戦隊|ゴレンジャー|ジャッカー|バトルフィーバー|デンジマン|サンバルカン|ゴーグルファイブ|ダイナマン|バイオマン|チェンジマン|フラッシュマン|マスクマン|ライブマン|ターボレンジャー|ファイブマン|ジェットマン|ジュウレンジャー|ダイレンジャー|カクレンジャー|オーレンジャー|カーレンジャー|メガレンジャー|ギンガマン|ゴーゴーファイブ|タイムレンジャー|ガオレンジャー|ハリケンジャー|アバレンジャー|デカレンジャー|マジレンジャー|ボウケンジャー|ゲキレンジャー|ゴーオンジャー|シンケンジャー|ゴセイジャー|ゴーカイジャー|ゴーバスターズ|キョウリュウジャー|トッキュウジャー|ニンニンジャー|ジュウオウジャー|キュウレンジャー|ルパンレンジャー|パトレンジャー|リュウソウジャー|キラメイジャー|ゼンカイジャー|ドンブラザーズ|キングオージャー|ブンブンジャー|ゴジュウジャー|レンジャーキー|センタイギア|アバタロウギア|獣電池'
        THEN 'super_sentai'::"CategoryIp"
      WHEN evidence ~* 'ゴジラ|哥斯拉|godzilla|メカゴジラ|スペースゴジラ|キングギドラ|デストロイア|ビオランテ|ガイガン|ヘドラ|アンギラス|ミニラ([^ァ-ヶー]|$)'
        THEN 'godzilla'::"CategoryIp"
      ELSE NULL
    END AS category_ip
  FROM in_scope
)
UPDATE "Item" AS item
SET
  "categoryIp" = classified.category_ip,
  "updatedAt" = CURRENT_TIMESTAMP
FROM classified
WHERE item."id" = classified."id"
  AND classified.category_ip IS NOT NULL
  AND item."categoryIp" IN ('unknown', 'other')
  AND item."categoryIp" IS DISTINCT FROM classified.category_ip;
