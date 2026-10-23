import type {
  CategoryIp,
  ConditionGrade,
  ListingType,
  Manufacturer,
  NormalizedItem,
  RawItemDetail,
  ToyType,
} from "./types.js";
import { listingTypes } from "./types.js";

const rules = {
  ip: [
    [
      "kamen_rider",
      /(?:仮面(?:ライダー|らいだー|わんだー)|假面骑士|kamen[\s_-]*rider|ライダー(?:ヒーロー|怪人|ガシャット|スイング|アドバンス|ゴチゾウ|カプセム|エグズ)|レジェンドライダー|平成ライダー|昭和ライダー|スカイライダー|シャドームーン|オルフェノク|ショッカー|ガシャット|ライドウォッチ|プログライズキー|ワンダーライドブック|バイスタンプ|レイズバックル|ゴチゾウ|フルボトル|ロックシード|オー?メダル|ガイアメモリ|アストロスイッチ|ウィザードリング|シフトカー|眼魂|ゴーストアイコン|ライドケミー(?:トレカ)?|カプセム|ライドエグズ|ガシャコン|ゼクター|デンオウベルト|ディケイドライバー|ダブルドライバー|オーズドライバー|フォーゼドライバー|ウィザードライバー|戦極ドライバー|ゲネシスドライバー|ドライブドライバー|ゴーストドライバー|ゲーマドライバー|ビルドドライバー|ジクウドライバー|ゼロワンドライバー|聖剣ソードライバー|リバイスドライバー|デザイアドライバー|ガッチャードライバー|ゼッツドライバー|ノクスドライバー|カイザドライバー|デルタドライバー|ロストドライバー|アークドライバー|ヴィジョンドライバー|ベイルドライバー|デストリームドライバー|クウガ|アギト|龍騎|ファイズ|ディケイド|オーズ|フォーゼ|鎧武|ガイム|エグゼイド|ジオウ|ゼロワン|リバイス|ギーツ|ガッチャード|ゼッツ)/i,
    ],
    [
      "ultraman",
      /(?:ウルトラ(?:マン|セブン|Q|怪獣|ヒーロー|アクション|レプリカ|カプセル|メダル|エッグ|メカニックス|怪獣戯画|怪獣名鑑|コレクション|兄弟|五兄弟)|奥特曼|ultra[\s_-]*(?:man|seven)|バルタン星人|ゼットン|エレキング|キングジョー|カネゴン|ピグモン|ジャミラ|ゴモラ|メフィラス星人|ザラブ星人|ペガッサ星人|バキシム|ジラース|ガラモン|ウインダム|ザラガス|ザムシャー|ベムラー|レッドキング|ツインテール|ペギラ|メトロン星人|カルミラ)/i,
    ],
    [
      "super_sentai",
      /(?:スーパー戦隊|超级战队|超級戰隊|super[\s_-]*sentai|戦隊(?:ヒーロー|シリーズ|ロボ)|歴代戦隊|ゴレンジャー|ジャッカー|バトルフィーバー|デンジマン|サンバルカン|ゴーグルファイブ|ダイナマン|バイオマン|チェンジマン|フラッシュマン|マスクマン|ライブマン|ターボレンジャー|ファイブマン|ジェットマン|ジュウレンジャー|ダイレンジャー|カクレンジャー|オーレンジャー|カーレンジャー|メガレンジャー|ギンガマン|ゴーゴーファイブ|タイムレンジャー|ガオレンジャー|ハリケンジャー|アバレンジャー|デカレンジャー|マジレンジャー|ボウケンジャー|ゲキレンジャー|ゴーオンジャー|シンケンジャー|ゴセイジャー|ゴーカイジャー|ゴーバスターズ|キョウリュウジャー|トッキュウジャー|ニンニンジャー|ジュウオウジャー|キュウレンジャー|ルパンレンジャー|パトレンジャー|リュウソウジャー|キラメイジャー|ゼンカイジャー|ドンブラザーズ|キングオージャー|ブンブンジャー|ゴジュウジャー|レンジャーキー|センタイギア|アバタロウギア|獣電池)/i,
    ],
    [
      "godzilla",
      /(?:ゴジラ|哥斯拉|godzilla|メカゴジラ|スペースゴジラ|キングギドラ|デストロイア|ビオランテ|ガイガン|ヘドラ|アンギラス|ミニラ(?:[^ァ-ヶー]|$))/i,
    ],
  ] as const,
  toy: [
    ["dx_belt", /変身ベルト|ベルト|driver|ドライバー/i],
    ["gashapon", /ガシャポン|ガチャ|カプセル/i],
    ["shokugan", /食玩|shokugan/i],
    ["sofubi", /ソフビ|soft\s*vinyl/i],
    ["finger_puppet", /指人形/i],
    ["card", /カード|card/i],
    ["medal", /メダル|medal/i],
    ["model", /プラモデル|模型|model\s*kit/i],
    ["henshin_item", /変身|アイテム|henshin/i],
    ["figure", /フィギュア|figure/i],
    ["set", /まとめ売り|大量|セット|lot/i],
  ] as const,
  manufacturer: [
    ["bandai_spirits", /bandai\s*spirits|バンダイスピリッツ/i],
    ["banpresto", /banpresto|バンプレスト/i],
    ["megahouse", /megahouse|メガハウス/i],
    ["plex", /plex|プレックス/i],
    ["bandai", /bandai|バンダイ/i],
  ] as const,
};

export interface TextClassification {
  categoryIp: CategoryIp;
  categoryToyType: ToyType;
  manufacturer: Manufacturer;
  conditionGrade: ConditionGrade;
  quantityEst?: number;
  confidence: number;
  conflicts: string[];
}

const cardTextPattern =
  /(?:trading\s*card|card\s*game|カードダス|トレカ|カード|卡片|集换式)/i;
const arcadeCardSeriesPattern =
  /(?:ガンバライド|ガンバライジング|ガンバレジェンズ)/i;
const paperCollectiblePattern =
  /(?:シール|ステッカー|sticker|ブックマーク|クリアファイル|チラシ|フライヤー|ポスター|カタログ|新聞|号外)/i;
const bookTextPattern =
  /(?:mook|magazine|comic|novel|書籍|漫画|マンガ|コミック|写真集|攻略本|図鑑|辞典|事典|図録|資料集|雑誌|絵本|小説|冊子|パンフレット|チラシ|フライヤー|ポスター|カタログ|新聞|号外|KCDX|著者|単行本|文庫版?)|(?:^|[\s【】「」『』|/])本(?:$|[\s【】「」『』|/])/i;
const mediaTextPattern =
  /(?:\bDVD\b|Blu[‐\-]?ray|ブルーレイ|\bCD\b|サウンドトラック|ゲームソフト|プレイステーション|プレステ|レンタル落ち)/i;
const standaloneMediaPattern =
  /^(?:【[^】]*】\s*)?(?:特撮\s+)?(?:映画\s+)?(?:DVD|Blu[‐\-]?ray|ブルーレイ)\b/i;
const referencedToyBonusPaperPattern =
  /(?:ソフビ|フィギュア|玩具|おもちゃ)購入特典(?:ステッカー|シール|カード)(?!付き|付属|含む)/i;
const standaloneCardAccessoryPattern =
  /ライダーカード.*(?:バインダー|(?:ベルト|ドライバー)付属品)|ソフビ\s*\d+周年記念\s*カード\s*\d+\s*枚セット/i;
const cardOnlyPattern =
  /(?:対応|専用|用)\s*カード|(?:トレカ|トレーディングカード|カードダス|カードゲーム)|カード\s*(?:のみ|だけ|まとめ売り)\b/i;

/** Items outside the procurement scope must be rejected before persistence. */
export function isExcludedCollectibleText(
  title: string,
  description = "",
): boolean {
  const titleWithoutMissingAccessory = title.replace(
    /(?:カード|シール|ステッカー)\s*(?:無し|なし|欠品|はがれ|剥がれ)/gi,
    "",
  );
  const explicitToy =
    /(?:DX|ベルト|ドライバー|フィギュア|ソフビ|ガシャット|ゴチゾウ|プログライズキー|アイコン|メモリ|バックル|変身|可動|プラモデル|消しゴム)/i.test(
      titleWithoutMissingAccessory,
    );
  // These are Kamen Rider arcade card systems. Listings often omit the word
  // "card", so their series name itself is decisive flat-collectible evidence.
  if (arcadeCardSeriesPattern.test(titleWithoutMissingAccessory)) return true;
  if (bookTextPattern.test(titleWithoutMissingAccessory)) return true;
  // A title such as "ソフビ購入特典ステッカー" names the toy only as the
  // source of the bonus. It is still a flat collectible, not a sofubi listing.
  if (referencedToyBonusPaperPattern.test(titleWithoutMissingAccessory))
    return true;
  if (standaloneCardAccessoryPattern.test(titleWithoutMissingAccessory))
    return true;
  // Media titles can contain words such as "変身" in the film name. A leading
  // DVD/Blu-ray marker is stronger evidence than those incidental toy terms.
  if (standaloneMediaPattern.test(titleWithoutMissingAccessory)) return true;
  // Audio/video/game media is outside the physical toy procurement scope.
  // Keep bundles that clearly contain a real toy and merely mention a bonus
  // disc (for example a belt with a DVD bonus).
  const explicitPhysicalToy =
    /(?:ベルト|ドライバー|ソフビ|フィギュア|ガシャポン|ガチャ(?!ード)|食玩|玩具|おもちゃ|変身|プラモデル|模型|メダル|ロックシード|ガシャット|アイテム|可動|人形|指人形|ワンダーライドブック)/i.test(
      titleWithoutMissingAccessory,
    );
  if (
    mediaTextPattern.test(titleWithoutMissingAccessory) &&
    !explicitPhysicalToy
  )
    return true;
  // "DX ... 対応カード" is a common false positive: the belt/driver is
  // referenced only as the compatible device and the listing contains cards.
  const cardOnly = cardOnlyPattern.test(titleWithoutMissingAccessory);
  const toyIncludesCard =
    explicitPhysicalToy &&
    /(?:カード|トレカ).*(?:付き|付属|含む)|(?:付き|付属|含む).*(?:カード|トレカ)/i.test(
      titleWithoutMissingAccessory,
    );
  if (cardOnly && !toyIncludesCard) return true;
  if (
    !explicitToy &&
    (cardTextPattern.test(titleWithoutMissingAccessory) ||
      paperCollectiblePattern.test(titleWithoutMissingAccessory))
  )
    return true;
  // A generic title can still be a flat collectible when the seller explicitly
  // says the listing contains only a card/sticker/book. Do not reject a real
  // toy merely because its description mentions a missing label or insert.
  if (
    !explicitToy &&
    /(?:カード|シール|ステッカー)\s*(?:のみ|だけ)|トレーディングカード|カードダス|書籍|雑誌|漫画|コミック|小説|写真集/i.test(
      description,
    )
  )
    return true;
  return false;
}

export function isExcludedNormalizedItem(
  item: Pick<NormalizedItem, "titleRaw" | "descriptionRaw" | "categoryToyType">,
) {
  return (
    item.categoryToyType === "card" ||
    isExcludedCollectibleText(item.titleRaw, item.descriptionRaw ?? "")
  );
}

function firstMatch<T extends string>(
  text: string,
  entries: readonly (readonly [T, RegExp])[],
  fallback: T,
): T {
  return entries.find(([, matcher]) => matcher.test(text))?.[0] ?? fallback;
}

function validQuantity(value: number) {
  return Number.isInteger(value) && value > 0 && value <= 500;
}

const itemCountUnitSource =
  "点|個|个|件|体|只|枚|本(?!体)|冊|pcs?|pieces?|units?";
const packUnitSource =
  "箱|盒|袋|包|パック|セット|pack(?:s)?|box(?:es)?|carton(?:s)?|set(?:s)?";
const inexactCountPrefixSource =
  "約|约|大約|大约|およそ|おおよそ|至少|少なくとも|about|around|approx(?:imately)?|at\\s+least";
const inexactCountSuffixSource =
  "以上|以下|未満|不足|前後|くらい|ぐらい|程度|ほど|余り|多い|少ない|[〜～~+]|or\\s+(?:more|less)|and\\s+up";
const accessoryCountTermSource =
  "(?:交換(?:用)?(?:パーツ|部品|武器|手首|頭部)|替え(?:パーツ|部品|手首|顔)|付属(?:品|パーツ|部品|武器)|パーツ|部品|台座|おまけ|アクセサリ(?:ー|ies)|accessor(?:y|ies)|parts?|配件)";

function normalizeCountText(value: string) {
  return value
    .replace(/[０-９]/g, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
    )
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")");
}

function countContextIsAccessory(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 28), index);
  const after = text.slice(index + length, index + length + 28);
  return (
    new RegExp(
      `${accessoryCountTermSource}\\s*(?:[:：+＋x×*]\\s*)?$`,
      "iu",
    ).test(before) ||
    new RegExp(`^\\s*(?:の|of)?\\s*${accessoryCountTermSource}`, "iu").test(
      after,
    )
  );
}

function explicitCountIsProduct(
  text: string,
  index: number,
  length: number,
  unit: string,
) {
  const before = text.slice(Math.max(0, index - 12), index);
  const after = text.slice(index + length, index + length + 16);
  // Approximation and bounds are useful review clues, but not safe exact
  // quantities for unit-cost ranking.
  if (new RegExp(`(?:${inexactCountPrefixSource})\\s*$`, "iu").test(before))
    return false;
  if (new RegExp(`(?:${inexactCountSuffixSource})`, "iu").test(after))
    return false;
  if (countContextIsAccessory(text, index, length)) return false;

  // A listing often mentions the number of photos, pages, cards or manuals;
  // those counts must not become the number of purchasable toys.
  const context = text.slice(Math.max(0, index - 18), index + length + 18);
  if (
    /(?:写真|画像|フォト|photo|image)\s*\d+\s*(?:枚|点|pcs?)/i.test(context) ||
    /(?:説明書|取扱説明書|冊子|ページ|頁)\s*\d+\s*(?:枚|冊|ページ|頁|pcs?)/i.test(
      context,
    )
  )
    return false;
  if (
    /(?:写真|画像|フォト|photo|image|説明書|取扱説明書|冊子|ページ|頁|カード|カードダス|シール|ステッカー)/i.test(
      context,
    ) &&
    /(?:枚|冊|ページ|頁)/i.test(unit)
  )
    return false;
  return true;
}

/**
 * Read only explicit lot counts. Model numbers, scales, clothing sizes,
 * approximate bounds and counts of photos/manuals are deliberately ignored.
 * Pack expressions are accepted only when the per-pack item count is stated.
 */
export function extractQuantityEst(text: string): number | undefined {
  const normalized = normalizeCountText(text);
  const candidates: number[] = [];
  const add = (value: number) => {
    if (validQuantity(value)) candidates.push(value);
  };

  // Treat a package multiplier as one evidence unit. The inner per-package
  // count must not fall through to the simple-count parser when either the
  // package count or the per-package count is approximate.
  const packExpressionRanges: Array<{ start: number; end: number }> = [];
  const packPattern = new RegExp(
    `(?:(${inexactCountPrefixSource})\\s*)?` +
      `(\\d{1,2})\\s*(${packUnitSource})` +
      `(?:\\s*(${inexactCountSuffixSource}))?` +
      `(?:\\s*(?:入り|装|含(?:有|む)?|of)\\s*)?` +
      `(?:\\s*[（(,:：，、]?\\s*)?` +
      `(?:各|每(?:个|件|盒|箱)?|per|with|of|1\\s*(?:${packUnitSource})\\s*(?:あたり|に)?|x|×|\\*)?\\s*` +
      `(?:(${inexactCountPrefixSource})\\s*)?` +
      `(\\d{1,2})\\s*(${itemCountUnitSource})` +
      `(?:\\s*(${inexactCountSuffixSource}))?\\s*` +
      `(?:入り|入|each|pcs?|个|個)?` +
      `(?:[）)]|$|[、,;；])?`,
    "giu",
  );
  for (const match of normalized.matchAll(packPattern)) {
    const start = match.index ?? 0;
    packExpressionRanges.push({ start, end: start + match[0].length });
    if (
      match[1] ||
      match[4] ||
      match[5] ||
      match[8] ||
      countContextIsAccessory(normalized, start, match[0].length)
    )
      continue;
    add(Number(match[2]) * Number(match[6]));
  }

  const simplePattern = new RegExp(
    `(\\d{1,3})\\s*(${itemCountUnitSource})`,
    "giu",
  );
  for (const match of normalized.matchAll(simplePattern)) {
    const index = match.index ?? 0;
    if (
      packExpressionRanges.some(
        (range) => index >= range.start && index < range.end,
      )
    )
      continue;
    if (explicitCountIsProduct(normalized, index, match[0].length, match[2]))
      add(Number(match[1]));
  }

  for (const match of normalized.matchAll(
    /(?:全|計)\s*(\d{1,3})\s*種(?:類)?\s*(?:コンプ(?:リート)?|セット|揃い)/giu,
  )) {
    add(Number(match[1]));
  }

  for (const match of normalized.matchAll(
    new RegExp(
      `(?:全)?\\s*(\\d{1,2})\\s*種(?:類)?\\s*(?:各|[x×*])\\s*` +
        `(\\d{1,2})\\s*(?:(${itemCountUnitSource}))?`,
      "giu",
    ),
  )) {
    add(Number(match[1]) * Number(match[2]));
  }

  const valid = candidates.filter(validQuantity);
  return valid.length ? Math.max(...valid) : undefined;
}

export function classifyText(
  title: string,
  description = "",
  condition = "",
): TextClassification {
  const text = `${title}\n${description}\n${condition}`;
  // The listing title is the strongest identity evidence. Marketplace boilerplate
  // and a seller's cross-franchise catalogue often appear in the description;
  // allowing that text to win previously mislabeled clear Ultraman titles as
  // Kamen Rider merely because the latter rule happened to be checked first.
  const titleCategoryIp = firstMatch(title, rules.ip, "unknown" as CategoryIp);
  const categoryIp =
    titleCategoryIp !== "unknown"
      ? titleCategoryIp
      : firstMatch(
          `${description}\n${condition}`,
          rules.ip,
          "unknown" as CategoryIp,
        );
  const categoryToyType = firstMatch(text, rules.toy, "unknown" as ToyType);
  const manufacturer = firstMatch(
    text,
    rules.manufacturer,
    "unknown" as Manufacturer,
  );

  const noNoticeableDamage =
    /目立った(?:傷|キズ)(?:や|・|、)?汚れ(?:は)?(?:ありません|ない|無し|なし)/i.test(
      text,
    );
  const conditionEvidence = text
    .replace(
      /目立った(?:傷|キズ)(?:や|・|、)?汚れ(?:は)?(?:ありません|ない|無し|なし)/giu,
      " ",
    )
    .replace(
      /(?:傷|キズ|汚れ|破損|欠品|故障|塗装剥げ)(?:や|・|、)?(?:傷|キズ|汚れ|破損|欠品|故障|塗装剥げ)?(?:は|が)?(?:ありません|ない|無し|なし)/giu,
      " ",
    )
    .replace(
      /(?:ジャンク(?:品)?|junk|動作未確認)(?:では|じゃ)?(?:ありません|ない)/giu,
      " ",
    );

  let conditionGrade: ConditionGrade = "unknown";
  if (/ジャンク|junk|故障|動作未確認/i.test(conditionEvidence))
    conditionGrade = "junk";
  else if (
    /(?:やや|目立つ|多数の?)?(?:汚れ|破損|欠品|傷|キズ|塗装剥げ)|全体的に状態が悪い/i.test(
      conditionEvidence,
    )
  )
    conditionGrade = "stained_or_damaged";
  else if (/未開封|新品|sealed|未使用/i.test(text))
    conditionGrade = "new_sealed";
  else if (/未使用に近い|美品|極美品|like\s*new/i.test(text))
    conditionGrade = "like_new";
  else if (noNoticeableDamage || /中古|使用感|used/i.test(text))
    conditionGrade = "used";

  const quantityEst = extractQuantityEst(text);
  const matchedDimensions = [
    categoryIp,
    categoryToyType,
    manufacturer,
    conditionGrade,
  ].filter((value) => value !== "unknown").length;
  const confidence = Math.min(
    0.95,
    0.42 + matchedDimensions * 0.11 + (quantityEst ? 0.08 : 0),
  );

  const conflicts: string[] = [];
  if (/未開封|新品/.test(text) && /ジャンク|破損|欠品/.test(conditionEvidence))
    conflicts.push("condition_text_conflict");

  return {
    categoryIp,
    categoryToyType,
    manufacturer,
    conditionGrade,
    quantityEst,
    confidence,
    conflicts,
  };
}

/** Resolve the sale mode conservatively. A real auction end timestamp is
 * stronger than a stale direct marker; otherwise missing/invalid values stay
 * unknown instead of being promoted to fixed-price sales. */
export function resolveListingType(
  value: ListingType | null | undefined,
  auctionEndAt?: Date | null,
  fallback?: ListingType | null,
): ListingType {
  if (auctionEndAt && Number.isFinite(auctionEndAt.getTime())) return "auction";
  const candidate = value ?? fallback;
  return listingTypes.includes(candidate as ListingType)
    ? (candidate as ListingType)
    : "unknown";
}

export function normalizeRawItem(raw: RawItemDetail): NormalizedItem {
  const classification = classifyText(
    raw.titleRaw,
    raw.descriptionRaw,
    raw.conditionRaw,
  );
  const listingType = resolveListingType(raw.listingType, raw.auctionEndAt);
  const priceTotalEst = raw.priceCurrent + (raw.shippingFee ?? 0);
  const unitCostEst =
    classification.quantityEst &&
    raw.shippingFee != null &&
    listingType === "direct"
      ? Math.round(priceTotalEst / classification.quantityEst)
      : undefined;
  const needsReview =
    classification.confidence < 0.6 || classification.conflicts.length > 0;
  return {
    ...raw,
    listingType,
    priceTotalEst,
    categoryIp: classification.categoryIp,
    categoryToyType: classification.categoryToyType,
    manufacturer: classification.manufacturer,
    conditionGrade: classification.conditionGrade,
    quantityEst: classification.quantityEst,
    unitCostEst,
    confidence: classification.confidence,
    needsReview,
  };
}

export function auctionRefreshDelay(
  endAt: Date | null | undefined,
  now = new Date(),
): number {
  // Every live listing participates in the same two-hour availability SLA.
  // Search loops can discover replacements, but they cannot reliably tell us
  // that a previously stored buy-now listing was sold or removed.
  if (!endAt) return 2 * 60 * 60 * 1000;
  const remaining = endAt.getTime() - now.getTime();
  if (remaining <= 0) return 30 * 60 * 1000;
  if (remaining <= 3 * 60 * 1000) return 30 * 1000;
  if (remaining <= 10 * 60 * 1000) return 60 * 1000;
  if (remaining <= 30 * 60 * 1000) return 2 * 60 * 1000;
  if (remaining <= 2 * 60 * 60 * 1000) return 15 * 60 * 1000;
  if (remaining <= 6 * 60 * 60 * 1000) return 60 * 60 * 1000;
  return 2 * 60 * 60 * 1000;
}
