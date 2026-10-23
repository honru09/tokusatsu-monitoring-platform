import type { ConditionGrade, ToyType } from "./types.js";

export const procurementCategories = [
  "preferred",
  "promising",
  "needs_facts",
  "deprioritized",
] as const;
export type ProcurementCategory = (typeof procurementCategories)[number];

export const procurementCompactness = [
  "compact",
  "likely_compact",
  "bulky",
  "unknown",
] as const;
export type ProcurementCompactness = (typeof procurementCompactness)[number];

export type ProcurementCompactnessBasis =
  | "provided_volume"
  | "calculated_dimensions"
  | "conflict"
  | "inference"
  | "unknown";

export type ProcurementCostBasis = "known" | "lower_bound";

export type ProcurementMissingFact =
  | "price"
  | "shipping_fee"
  | "listing_type"
  | "quantity"
  | "volume"
  | "condition";

export interface ProcurementLogisticsInput {
  volumeCm3?: number | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  notes?: string | null;
}

export const UNVERIFIED_AI_ESTIMATE_MARKER = "[AI_ESTIMATE_UNVERIFIED]";

/** AI logistics drafts remain useful to operators, but are not procurement
 * facts until their unverified marker is removed by an explicit confirmation
 * workflow. */
export function procurementLogisticsEvidence<
  T extends ProcurementLogisticsInput & { notes?: string | null },
>(logistics: T | null | undefined): T | null {
  if (!logistics) return null;
  return logistics.notes?.includes(UNVERIFIED_AI_ESTIMATE_MARKER)
    ? null
    : logistics;
}

export interface ProcurementCandidate {
  titleRaw: string;
  /** Only a fixed direct-sale price can be treated as a known landed cost. */
  listingType?: "auction" | "direct" | "unknown" | null;
  categoryToyType?: ToyType | null;
  conditionGrade?: ConditionGrade | null;
  priceCurrent: number;
  shippingFee?: number | null;
  quantityEst?: number | null;
  logistics?: ProcurementLogisticsInput | null;
}

export interface ProcurementConfig {
  minQuantity: number;
  targetQuantity: number;
  maxUnitCostJpy: number;
  maxVolumeCm3: number;
  maxUnitVolumeCm3: number;
}

export const DEFAULT_PROCUREMENT_CONFIG: Readonly<ProcurementConfig> =
  Object.freeze({
    minQuantity: 5,
    targetQuantity: 10,
    maxUnitCostJpy: 1_000,
    maxVolumeCm3: 10_000,
    maxUnitVolumeCm3: 1_000,
  });

export interface ProcurementAssessment {
  category: ProcurementCategory;
  compactness: ProcurementCompactness;
  compactnessBasis: ProcurementCompactnessBasis;
  costBasis: ProcurementCostBasis;
  facts: string[];
  reasons: string[];
  missingFacts: ProcurementMissingFact[];
}

export interface RankedProcurementCandidate<T extends ProcurementCandidate> {
  candidate: T;
  assessment: ProcurementAssessment;
}

type InternalEvaluation = {
  assessment: ProcurementAssessment;
  utility: number;
  quantity?: number;
  volumeCm3?: number;
  unitVolumeCm3?: number;
  unitCostJpy?: number;
};

type VolumeEvidence = {
  volumeCm3?: number;
  basis: ProcurementCompactnessBasis;
  conflict?: {
    providedVolumeCm3: number;
    calculatedVolumeCm3: number;
  };
};

const likelyCompactToyTypes = new Set<string>([
  "gashapon",
  "shokugan",
  "finger_puppet",
  "medal",
]);

const likelyCompactTitlePattern =
  /(?:ガシャポン|ガチャ|カプセル|食玩|指人形|フィンガー\s*パペット|メダル|ミニ(?:フィギュア|ソフビ)|プチフィギュア|gashapon|shokugan|finger\s*puppet|mini(?:ature)?\s*(?:figure|sofubi))/i;
const junkTitlePattern = /(?:ジャンク|\bjunk\b|故障|動作未確認)/i;

const categoryOrder: Record<ProcurementCategory, number> = {
  preferred: 0,
  promising: 1,
  needs_facts: 2,
  deprioritized: 3,
};

const compactnessOrder: Record<ProcurementCompactness, number> = {
  compact: 0,
  likely_compact: 1,
  unknown: 2,
  bulky: 3,
};

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function positiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

function resolveConfig(
  input: Partial<ProcurementConfig> = {},
): ProcurementConfig {
  const minQuantity = positiveInteger(
    input.minQuantity,
    DEFAULT_PROCUREMENT_CONFIG.minQuantity,
  );
  const requestedTarget = positiveInteger(
    input.targetQuantity,
    DEFAULT_PROCUREMENT_CONFIG.targetQuantity,
  );
  return {
    minQuantity,
    targetQuantity: Math.max(minQuantity, requestedTarget),
    maxUnitCostJpy: positiveInteger(
      input.maxUnitCostJpy,
      DEFAULT_PROCUREMENT_CONFIG.maxUnitCostJpy,
    ),
    maxVolumeCm3: positiveInteger(
      input.maxVolumeCm3,
      DEFAULT_PROCUREMENT_CONFIG.maxVolumeCm3,
    ),
    maxUnitVolumeCm3: positiveInteger(
      input.maxUnitVolumeCm3,
      DEFAULT_PROCUREMENT_CONFIG.maxUnitVolumeCm3,
    ),
  };
}

function envInteger(value: string | undefined): number | undefined {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Resolve operator thresholds without allowing malformed environment values
 * to disable a guard or turn an unknown value into a preferred candidate. */
export function procurementConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): ProcurementConfig {
  return resolveConfig({
    minQuantity: envInteger(env.PROCUREMENT_MIN_QUANTITY),
    targetQuantity: envInteger(env.PROCUREMENT_TARGET_QUANTITY),
    maxUnitCostJpy: envInteger(env.PROCUREMENT_MAX_UNIT_COST_JPY),
    maxVolumeCm3: envInteger(env.PROCUREMENT_MAX_VOLUME_CM3),
    maxUnitVolumeCm3: envInteger(env.PROCUREMENT_MAX_UNIT_VOLUME_CM3),
  });
}

function volumeEvidence(
  logistics: ProcurementLogisticsInput | null | undefined,
): VolumeEvidence {
  const provided = finitePositive(logistics?.volumeCm3);
  const lengthMm = finitePositive(logistics?.lengthMm);
  const widthMm = finitePositive(logistics?.widthMm);
  const heightMm = finitePositive(logistics?.heightMm);
  const calculated =
    lengthMm != null && widthMm != null && heightMm != null
      ? (lengthMm * widthMm * heightMm) / 1_000
      : undefined;
  if (provided != null && calculated != null) {
    const tolerance = Math.max(1, Math.max(provided, calculated) * 0.05);
    if (Math.abs(provided - calculated) > tolerance) {
      return {
        basis: "conflict",
        conflict: {
          providedVolumeCm3: provided,
          calculatedVolumeCm3: calculated,
        },
      };
    }
    return calculated > provided
      ? { volumeCm3: calculated, basis: "calculated_dimensions" }
      : { volumeCm3: provided, basis: "provided_volume" };
  }
  if (provided != null)
    return { volumeCm3: provided, basis: "provided_volume" };
  if (calculated == null) return { basis: "unknown" };
  return {
    volumeCm3: calculated,
    basis: "calculated_dimensions",
  };
}

function inferredCompact(input: ProcurementCandidate) {
  return (
    likelyCompactToyTypes.has(input.categoryToyType ?? "") ||
    likelyCompactTitlePattern.test(input.titleRaw)
  );
}

function compactnessFor(
  input: ProcurementCandidate,
  quantity: number | undefined,
  volume: VolumeEvidence,
  config: ProcurementConfig,
): {
  compactness: ProcurementCompactness;
  basis: ProcurementCompactnessBasis;
  unitVolumeCm3?: number;
} {
  if (volume.basis === "conflict")
    return { compactness: "unknown", basis: "conflict" };
  if (volume.volumeCm3 != null) {
    if (volume.volumeCm3 > config.maxVolumeCm3)
      return { compactness: "bulky", basis: volume.basis };

    if (quantity != null) {
      const unitVolumeCm3 = volume.volumeCm3 / quantity;
      return unitVolumeCm3 <= config.maxUnitVolumeCm3
        ? { compactness: "compact", basis: volume.basis, unitVolumeCm3 }
        : { compactness: "bulky", basis: volume.basis, unitVolumeCm3 };
    }

    if (volume.volumeCm3 <= config.maxUnitVolumeCm3)
      return { compactness: "compact", basis: volume.basis };
    if (inferredCompact(input))
      return { compactness: "likely_compact", basis: "inference" };
    return { compactness: "unknown", basis: volume.basis };
  }

  if (inferredCompact(input))
    return { compactness: "likely_compact", basis: "inference" };
  return { compactness: "unknown", basis: "unknown" };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function money(value: number) {
  return `¥${formatNumber(value)}`;
}

function addMissing(
  missingFacts: ProcurementMissingFact[],
  fact: ProcurementMissingFact,
) {
  if (!missingFacts.includes(fact)) missingFacts.push(fact);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function evaluate(
  input: ProcurementCandidate,
  config: ProcurementConfig,
): InternalEvaluation {
  const facts: string[] = [];
  const reasons: string[] = [];
  const missingFacts: ProcurementMissingFact[] = [];
  const priceCurrent = finiteNonNegative(input.priceCurrent);
  const shippingFee = finiteNonNegative(input.shippingFee);
  const quantity = finitePositive(input.quantityEst);
  const volume = volumeEvidence(input.logistics);
  const compact = compactnessFor(input, quantity, volume, config);
  const costBasis: ProcurementCostBasis =
    priceCurrent != null &&
    shippingFee != null &&
    input.listingType === "direct"
      ? "known"
      : "lower_bound";
  const landedCost =
    priceCurrent == null ? undefined : priceCurrent + (shippingFee ?? 0);
  const unitCostJpy =
    landedCost != null && quantity != null ? landedCost / quantity : undefined;

  if (input.listingType !== "direct" && input.listingType !== "auction")
    addMissing(missingFacts, "listing_type");

  if (priceCurrent == null) {
    addMissing(missingFacts, "price");
    reasons.push("当前价无效，无法判断成本。");
  } else if (shippingFee == null) {
    addMissing(missingFacts, "shipping_fee");
    facts.push(`商品价 ${money(priceCurrent)}，运费未知。`);
    reasons.push("运费未知，当前成本只能作为下限，不能视为最终低价。");
  } else if (input.listingType === "direct") {
    facts.push(
      `到手总价 ${money(landedCost!)}，其中运费 ${money(shippingFee)}。`,
    );
  } else if (input.listingType === "auction") {
    facts.push(
      `当前竞价加已知运费为 ${money(landedCost!)}，其中运费 ${money(shippingFee)}。`,
    );
    reasons.push("拍卖尚未成交，当前竞价只能作为成本下限，不能视为最终低价。");
  } else {
    facts.push(
      `当前标价加已知运费为 ${money(landedCost!)}，其中运费 ${money(shippingFee)}。`,
    );
    reasons.push("成交方式未知，当前金额只能作为成本下限。");
  }

  if (quantity == null) {
    addMissing(missingFacts, "quantity");
    reasons.push("数量未知，无法计算可靠的单件成本和单件体积。");
  } else {
    facts.push(`数量估算 ${formatNumber(quantity)} 件。`);
    if (quantity >= config.targetQuantity)
      reasons.push(`数量达到目标 ${config.targetQuantity} 件。`);
    else if (quantity >= config.minQuantity)
      reasons.push(
        `数量达到最低条件 ${config.minQuantity} 件，但未达到目标 ${config.targetQuantity} 件。`,
      );
    else reasons.push(`数量低于最低条件 ${config.minQuantity} 件。`);
  }

  if (unitCostJpy != null) {
    facts.push(
      costBasis === "known"
        ? `含运费单件成本 ${money(unitCostJpy)}。`
        : `单件成本下限 ${money(unitCostJpy)}。`,
    );
    if (unitCostJpy <= config.maxUnitCostJpy)
      reasons.push(
        costBasis === "known"
          ? `含运费单件成本不高于 ${money(config.maxUnitCostJpy)}。`
          : `单件成本下限不高于 ${money(config.maxUnitCostJpy)}，${shippingFee == null ? "仍需补齐运费" : input.listingType === "auction" ? "仍需等待最终成交价" : "仍需确认固定成交价"}。`,
      );
    else
      reasons.push(
        `${costBasis === "known" ? "含运费单件成本" : "单件成本下限"}高于 ${money(config.maxUnitCostJpy)}。`,
      );
  }

  if (volume.conflict) {
    addMissing(missingFacts, "volume");
    reasons.push(
      `已提供总体积 ${formatNumber(volume.conflict.providedVolumeCm3)} cm³，与三维尺寸计算的 ${formatNumber(volume.conflict.calculatedVolumeCm3)} cm³ 冲突。`,
    );
  } else if (volume.volumeCm3 == null) {
    addMissing(missingFacts, "volume");
  } else {
    facts.push(
      `${volume.basis === "calculated_dimensions" ? "按已提供尺寸计算" : "已提供"}总体积 ${formatNumber(volume.volumeCm3)} cm³。`,
    );
    if (compact.unitVolumeCm3 != null)
      facts.push(
        `按估算数量计算单件体积 ${formatNumber(compact.unitVolumeCm3)} cm³。`,
      );
  }

  if (compact.compactness === "compact")
    reasons.push("已知体积同时满足总体积和单件体积条件。");
  else if (compact.compactness === "likely_compact") {
    if (volume.volumeCm3 == null) addMissing(missingFacts, "volume");
    reasons.push(
      "品类或标题通常对应小件商品，只能标记为可能紧凑，依据是推断而不是已知体积。",
    );
  } else if (compact.compactness === "bulky")
    reasons.push("已知总体积或单件体积超过体积条件。");
  else if (compact.basis === "conflict")
    reasons.push("体积证据相互冲突，不能把商品判定为小体积。");
  else reasons.push("缺少足够体积事实，不能把商品判定为小体积。");

  const condition = input.conditionGrade;
  const junk = condition === "junk" || junkTitlePattern.test(input.titleRaw);
  const damaged = condition === "stained_or_damaged";
  if (!condition || condition === "unknown") {
    addMissing(missingFacts, "condition");
    reasons.push("品相未知，采购前仍需核验损坏和缺件。");
  } else {
    facts.push(`品相分类 ${condition}。`);
    if (junk) reasons.push("商品属于故障或未确认状态，采购风险高。");
    else if (damaged) reasons.push("商品有污损、破损或缺件风险。");
  }

  const tooFew = quantity != null && quantity < config.minQuantity;
  const definitelyTooExpensive =
    unitCostJpy != null && unitCostJpy > config.maxUnitCostJpy;
  const hardNegative =
    junk || compact.compactness === "bulky" || tooFew || definitelyTooExpensive;
  const quantityQualified = quantity != null && quantity >= config.minQuantity;
  const quantityPreferred =
    quantity != null && quantity >= config.targetQuantity;
  const costQualified =
    unitCostJpy != null && unitCostJpy <= config.maxUnitCostJpy;
  const compactQualified =
    compact.compactness === "compact" ||
    compact.compactness === "likely_compact";
  const fullyKnownPreferred =
    quantityPreferred &&
    costQualified &&
    costBasis === "known" &&
    compact.compactness === "compact" &&
    !damaged &&
    condition != null &&
    condition !== "unknown";

  let category: ProcurementCategory;
  if (hardNegative) category = "deprioritized";
  else if (fullyKnownPreferred) category = "preferred";
  else if (quantityQualified && costQualified && compactQualified)
    category = "promising";
  else category = "needs_facts";

  if (category === "preferred")
    reasons.push("体积、数量和含运费单件成本均达到首选条件。");
  else if (category === "promising")
    reasons.push(
      "三项条件已有正向证据，但仍含推断、缺失事实或未达到目标数量。",
    );
  else if (category === "needs_facts")
    reasons.push("关键事实不足，补齐后才能判断采购优先级。");
  else reasons.push("至少一项已知事实不符合采购条件，降低优先级。");

  const volumeUtility =
    compact.compactness === "compact" && volume.volumeCm3 != null
      ? 1 + clamp(1 - volume.volumeCm3 / config.maxVolumeCm3, 0, 1)
      : compact.compactness === "likely_compact"
        ? 0.5
        : compact.compactness === "bulky"
          ? -1
          : 0;
  const unitVolumeUtility =
    compact.unitVolumeCm3 == null
      ? 0
      : clamp(1 - compact.unitVolumeCm3 / config.maxUnitVolumeCm3, -1, 1);
  const quantityUtility =
    quantity == null
      ? -1
      : Math.log1p(quantity) / Math.log1p(config.targetQuantity);
  const costUtility =
    unitCostJpy == null
      ? -1
      : clamp(1 - unitCostJpy / config.maxUnitCostJpy, -2, 1) -
        (costBasis === "lower_bound" ? 0.5 : 0);
  const conditionPenalty = junk ? 2 : damaged ? 0.5 : 0;
  const utility =
    volumeUtility +
    unitVolumeUtility +
    quantityUtility +
    costUtility -
    conditionPenalty -
    missingFacts.length * 0.15;

  return {
    assessment: {
      category,
      compactness: compact.compactness,
      compactnessBasis: compact.basis,
      costBasis,
      facts,
      reasons,
      missingFacts,
    },
    utility,
    quantity,
    volumeCm3: volume.volumeCm3,
    unitVolumeCm3: compact.unitVolumeCm3,
    unitCostJpy,
  };
}

/** Classify one candidate using only supplied facts and explicit inferences. */
export function assessProcurementCandidate(
  input: ProcurementCandidate,
  config: Partial<ProcurementConfig> = {},
): ProcurementAssessment {
  return evaluate(input, resolveConfig(config)).assessment;
}

function compareEvaluations(
  left: InternalEvaluation,
  right: InternalEvaluation,
) {
  const categoryDifference =
    categoryOrder[left.assessment.category] -
    categoryOrder[right.assessment.category];
  if (categoryDifference) return categoryDifference;

  // A live bid or a price with unknown shipping is only a lower bound. Keep
  // it behind a fixed landed cost inside the same rule category, regardless
  // of how attractive the provisional number looks.
  if (left.assessment.costBasis !== right.assessment.costBasis)
    return left.assessment.costBasis === "known" ? -1 : 1;

  const utilityDifference = right.utility - left.utility;
  if (Math.abs(utilityDifference) > 1e-9) return utilityDifference;

  const compactnessDifference =
    compactnessOrder[left.assessment.compactness] -
    compactnessOrder[right.assessment.compactness];
  if (compactnessDifference) return compactnessDifference;

  const leftVolume = left.volumeCm3 ?? Number.POSITIVE_INFINITY;
  const rightVolume = right.volumeCm3 ?? Number.POSITIVE_INFINITY;
  if (leftVolume !== rightVolume) return leftVolume - rightVolume;

  const leftUnitVolume = left.unitVolumeCm3 ?? Number.POSITIVE_INFINITY;
  const rightUnitVolume = right.unitVolumeCm3 ?? Number.POSITIVE_INFINITY;
  if (leftUnitVolume !== rightUnitVolume)
    return leftUnitVolume - rightUnitVolume;

  const leftQuantity = left.quantity ?? Number.NEGATIVE_INFINITY;
  const rightQuantity = right.quantity ?? Number.NEGATIVE_INFINITY;
  if (leftQuantity !== rightQuantity) return rightQuantity - leftQuantity;

  const leftUnitCost = left.unitCostJpy ?? Number.POSITIVE_INFINITY;
  const rightUnitCost = right.unitCostJpy ?? Number.POSITIVE_INFINITY;
  if (leftUnitCost !== rightUnitCost) return leftUnitCost - rightUnitCost;
  return 0;
}

/** Standard Array.sort comparator. A negative result means `left` is the
 * stronger procurement candidate. No internal utility is exposed. */
export function compareProcurementCandidates(
  left: ProcurementCandidate,
  right: ProcurementCandidate,
  config: Partial<ProcurementConfig> = {},
) {
  const resolved = resolveConfig(config);
  return compareEvaluations(
    evaluate(left, resolved),
    evaluate(right, resolved),
  );
}

/** Return candidates in deterministic procurement order without mutating the
 * input list. Equal candidates retain their original order. */
export function rankProcurementCandidates<T extends ProcurementCandidate>(
  candidates: readonly T[],
  config: Partial<ProcurementConfig> = {},
): RankedProcurementCandidate<T>[] {
  const resolved = resolveConfig(config);
  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      evaluation: evaluate(candidate, resolved),
    }))
    .sort(
      (left, right) =>
        compareEvaluations(left.evaluation, right.evaluation) ||
        left.index - right.index,
    )
    .map(({ candidate, evaluation }) => ({
      candidate,
      assessment: evaluation.assessment,
    }));
}
