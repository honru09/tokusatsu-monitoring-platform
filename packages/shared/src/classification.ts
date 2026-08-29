import type {
  CategoryIp,
  ConditionGrade,
  Manufacturer,
  NormalizedItem,
  RawItemDetail,
  ToyType,
} from "./types.js";

const rules = {
  ip: [
    ["kamen_rider", /仮面ライダー|假面骑士|kamen\s*rider/i],
    ["ultraman", /ウルトラマン|奥特曼|ultraman/i],
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
const bookTextPattern =
  /(?:mook|magazine|comic|novel|書籍|漫画|マンガ|コミック|写真集|攻略本|図鑑|雑誌|絵本|小説|パンフレット)|(?:^|[\s【】「」『』|/])本(?:$|[\s【】「」『』|/])/i;

/** Items outside the procurement scope must be rejected before persistence. */
export function isExcludedCollectibleText(
  title: string,
  description = "",
): boolean {
  const text = `${title}\n${description}`;
  return cardTextPattern.test(text) || bookTextPattern.test(text);
}

function firstMatch<T extends string>(
  text: string,
  entries: readonly (readonly [T, RegExp])[],
  fallback: T,
): T {
  return entries.find(([, matcher]) => matcher.test(text))?.[0] ?? fallback;
}

export function classifyText(
  title: string,
  description = "",
  condition = "",
): TextClassification {
  const text = `${title}\n${description}\n${condition}`;
  const categoryIp = firstMatch(text, rules.ip, "unknown" as CategoryIp);
  const categoryToyType = firstMatch(text, rules.toy, "unknown" as ToyType);
  const manufacturer = firstMatch(
    text,
    rules.manufacturer,
    "unknown" as Manufacturer,
  );

  let conditionGrade: ConditionGrade = "unknown";
  if (/ジャンク|junk|故障|動作未確認/i.test(text)) conditionGrade = "junk";
  else if (/汚れ|破損|欠品|傷|キズ|塗装剥げ/i.test(text))
    conditionGrade = "stained_or_damaged";
  else if (/未開封|新品|sealed|未使用/i.test(text))
    conditionGrade = "new_sealed";
  else if (/美品|極美品|like\s*new/i.test(text)) conditionGrade = "like_new";
  else if (/中古|使用感|used/i.test(text)) conditionGrade = "used";

  const quantityCandidates = [
    ...text.matchAll(/(?:全|計|約)?\s*(\d{1,3})\s*(?:点|個|体|枚|本|pcs?)/gi),
  ]
    .map((match) => Number(match[1]))
    .filter((value) => value > 0 && value <= 500);
  const quantityEst = quantityCandidates.length
    ? Math.max(...quantityCandidates)
    : undefined;
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
  if (/未開封|新品/.test(text) && /ジャンク|破損|欠品/.test(text))
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

export function normalizeRawItem(raw: RawItemDetail): NormalizedItem {
  const classification = classifyText(
    raw.titleRaw,
    raw.descriptionRaw,
    raw.conditionRaw,
  );
  const priceTotalEst = raw.priceCurrent + (raw.shippingFee ?? 0);
  const unitCostEst = classification.quantityEst
    ? Math.round(priceTotalEst / classification.quantityEst)
    : undefined;
  const needsReview =
    classification.confidence < 0.6 || classification.conflicts.length > 0;
  return {
    ...raw,
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
  if (!endAt) return 60 * 60 * 1000;
  const remaining = endAt.getTime() - now.getTime();
  if (remaining <= 0) return 30 * 60 * 1000;
  if (remaining <= 3 * 60 * 1000) return 30 * 1000;
  if (remaining <= 10 * 60 * 1000) return 60 * 1000;
  if (remaining <= 30 * 60 * 1000) return 2 * 60 * 1000;
  return 15 * 60 * 1000;
}
