import { classifyCollectibleSeries } from "./collectible-series.js";
import { isExcludedCollectibleText } from "./classification.js";
import type {
  CategoryIp,
  ConditionGrade,
  ItemStatus,
  Manufacturer,
  SourceChannel,
  ToyType,
} from "./types.js";

export type InventoryQualityReason =
  | "excluded_collectible"
  | "offline_or_terminal"
  | "invalid_listing"
  | "weak_product_identity"
  | "junk_condition"
  | "damaged_without_bundle_value"
  | "insufficient_listing_evidence";

export type InventoryQualityCandidate = {
  titleRaw: string;
  descriptionRaw?: string | null;
  sourceUrl: string;
  priceCurrent: number;
  shippingFee?: number | null;
  categoryIp: CategoryIp | string;
  categoryToyType: ToyType | string;
  manufacturer: Manufacturer | string;
  conditionGrade: ConditionGrade | string;
  quantityEst?: number | null;
  imageCount?: number | null;
  imageUrls?: readonly string[];
  status: ItemStatus | string;
  channel: SourceChannel | string;
  collectibleSeries?: "shf" | "sic" | null;
};

export type InventoryQualityAssessment = {
  eligible: boolean;
  reason: InventoryQualityReason | null;
  evidenceCount: number;
  strongIdentity: boolean;
  bulkValueException: boolean;
};

const explicitToyIdentity =
  /(?:S\.H\.Figuarts|\bSHF\b|真骨彫|真骨雕|S\.?\s*I\.?\s*C\.?|DX|CSM|ベルト|ドライバー|フィギュア|ソフビ|変身(?:アイテム|玩具|ベルト)?|可動(?:人形|フィギュア)?|ガシャット|プログライズキー|ライドウォッチ|ロックシード|フルボトル|バックル|メモリ|メダル|ゴチゾウ|ウルトラレプリカ|怪獣|人形|玩具|おもちゃ)/iu;

const explicitFranchiseIdentity =
  /(?:仮面ライダー|假面骑士|ウルトラマン|奥特曼|スーパー戦隊|戦隊|哥斯拉|ゴジラ)/iu;

function finitePositive(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function rejected(
  reason: InventoryQualityReason,
  evidenceCount = 0,
  strongIdentity = false,
  bulkValueException = false,
): InventoryQualityAssessment {
  return {
    eligible: false,
    reason,
    evidenceCount,
    strongIdentity,
    bulkValueException,
  };
}

/**
 * Deterministic admission gate for searched marketplace inventory. It rejects
 * keyword-only associations while preserving clearly identified low-unit-cost
 * bundles. User-imported links are handled separately and are never discarded
 * by this policy merely because marketplace facts are incomplete.
 */
export function assessInventoryQuality(
  item: InventoryQualityCandidate,
  options: { scope?: "toys" | "general" } = {},
): InventoryQualityAssessment {
  const description = item.descriptionRaw?.trim() ?? "";
  if (
    item.categoryToyType === "card" ||
    isExcludedCollectibleText(item.titleRaw, description)
  )
    return rejected("excluded_collectible");
  if (item.channel !== "online" || !["active", "unknown"].includes(item.status))
    return rejected("offline_or_terminal");
  if (
    finitePositive(item.priceCurrent) == null ||
    !/^https:\/\//i.test(item.sourceUrl)
  )
    return rejected("invalid_listing");

  const series =
    item.collectibleSeries ??
    classifyCollectibleSeries({
      titleRaw: item.titleRaw,
      descriptionRaw: description,
      categoryIp: item.categoryIp,
    });
  const recognizedFranchise = !["unknown", "other", ""].includes(
    String(item.categoryIp),
  );
  const recognizedToy = !["unknown", "other", "card", ""].includes(
    String(item.categoryToyType),
  );
  const titleHasToyIdentity = explicitToyIdentity.test(item.titleRaw);
  const titleHasFranchiseIdentity = explicitFranchiseIdentity.test(
    item.titleRaw,
  );
  const strongIdentity = Boolean(
    options.scope === "general" ||
      series ||
      (recognizedFranchise && (recognizedToy || titleHasToyIdentity)) ||
      (titleHasFranchiseIdentity && titleHasToyIdentity),
  );
  if (!strongIdentity) return rejected("weak_product_identity");

  const quantity = finitePositive(item.quantityEst);
  const landedCost =
    item.priceCurrent +
    (typeof item.shippingFee === "number" && item.shippingFee >= 0
      ? item.shippingFee
      : 0);
  const unitCost = quantity ? landedCost / quantity : null;
  const bulkValueException = Boolean(
    quantity && quantity >= 5 && unitCost != null && unitCost <= 1_500,
  );
  if (item.conditionGrade === "junk")
    return rejected("junk_condition", 0, strongIdentity, bulkValueException);
  if (item.conditionGrade === "stained_or_damaged" && !bulkValueException)
    return rejected(
      "damaged_without_bundle_value",
      0,
      strongIdentity,
      bulkValueException,
    );

  const imageCount = Math.max(
    0,
    item.imageCount ?? item.imageUrls?.filter(Boolean).length ?? 0,
  );
  const evidence = [
    imageCount > 0,
    description.length >= 24,
    item.conditionGrade !== "unknown",
    item.manufacturer !== "unknown",
    quantity != null,
    item.shippingFee != null,
  ];
  const evidenceCount = evidence.filter(Boolean).length;
  const minimumEvidence =
    item.conditionGrade === "unknown" || item.shippingFee == null ? 3 : 2;
  if (
    evidenceCount < minimumEvidence &&
    !(bulkValueException && imageCount > 0)
  )
    return rejected(
      "insufficient_listing_evidence",
      evidenceCount,
      strongIdentity,
      bulkValueException,
    );
  return {
    eligible: true,
    reason: null,
    evidenceCount,
    strongIdentity,
    bulkValueException,
  };
}
