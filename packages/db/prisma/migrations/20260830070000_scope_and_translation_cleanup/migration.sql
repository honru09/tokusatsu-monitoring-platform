-- Flat paper collectibles are outside the procurement scope. Preserve real
-- toys whose titles merely mention a missing sticker/card accessory.
DELETE FROM "Item"
WHERE "titleRaw" ~* '(カード|トレカ|書籍|雑誌|漫画|コミック|小説|図鑑|写真集|シール|ステッカー|ブックマーク|クリアファイル)'
  AND "titleRaw" !~* '(DX|ベルト|ドライバー|フィギュア|ソフビ|ガシャット|ゴチゾウ|プログライズキー|アイコン|メモリ|バックル|変身|可動|プラモデル|消しゴム)'
  AND "titleRaw" !~* '(カード|シール|ステッカー)[[:space:]]*(無し|なし|欠品|はがれ|剥がれ)';

-- Earlier translations could expose a full page-chrome bodyText row. Keep
-- the complete translated seller description and structured product fields,
-- but remove navigation/recommendation chrome from the item detail UI.
UPDATE "Item"
SET "details_zh" = COALESCE(
  (
    SELECT jsonb_agg(entry)
    FROM jsonb_array_elements("details_zh") AS entry
    WHERE entry->>'path' <> 'bodyText'
  ),
  '[]'::jsonb
)
WHERE "details_zh" IS NOT NULL
  AND jsonb_typeof("details_zh") = 'array';
