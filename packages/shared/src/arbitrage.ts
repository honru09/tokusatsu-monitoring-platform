import {
  assessProcurementCandidate,
  procurementConfigFromEnv,
  procurementLogisticsEvidence,
  type ProcurementCandidate,
  type ProcurementConfig,
} from "./procurement.js";

export const crossMarketOpportunityStatuses = [
  "needs_facts",
  "rejected",
  "ready",
] as const;

export type CrossMarketOpportunityStatus =
  (typeof crossMarketOpportunityStatuses)[number];

export type CrossMarketOpportunityMissingFact =
  | "comparison_identity"
  | "comparison_freshness"
  | "exchange_rate"
  | "exchange_rate_freshness"
  | "listing_identity"
  | "listing_freshness"
  | "acquisition_cost"
  | "listing_type"
  | "shipping_fee"
  | "quantity"
  | "xianyu_quantity"
  | "volume"
  | "condition"
  | "platform_fee"
  | "international_shipping"
  | "china_fulfillment"
  | "configuration"
  | "financial_calculation";

export interface CrossMarketArbitrageConfig {
  minimumXianyuReferencePriceCny: number;
  minimumGrossSpreadCny: number;
  minimumGrossSpreadRatio: number;
  minimumNetProfitJpy: number;
  minimumNetMarginRatio: number;
  minimumMatchConfidence: number;
  maximumListingAgeMs: number;
  maximumComparisonAgeMs: number;
  maximumExchangeRateAgeMs: number;
  platformFeeRate?: number;
  internationalShippingJpy?: number;
  chinaFulfillmentCny?: number;
  procurement: ProcurementConfig;
}

export const DEFAULT_CROSS_MARKET_ARBITRAGE_CONFIG: Readonly<
  Omit<
    CrossMarketArbitrageConfig,
    | "platformFeeRate"
    | "internationalShippingJpy"
    | "chinaFulfillmentCny"
    | "procurement"
  >
> = Object.freeze({
  minimumXianyuReferencePriceCny: 300,
  minimumGrossSpreadCny: 150,
  minimumGrossSpreadRatio: 0.5,
  minimumNetProfitJpy: 5_000,
  minimumNetMarginRatio: 0.3,
  minimumMatchConfidence: 0.85,
  maximumListingAgeMs: 24 * 60 * 60_000,
  maximumComparisonAgeMs: 24 * 60 * 60_000,
  maximumExchangeRateAgeMs: 36 * 60 * 60_000,
});

export function crossMarketArbitrageEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return env.XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED === "true";
}

export function xianyuReverseSearchEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return (
    crossMarketArbitrageEnabled(env) &&
    env.XIANYU_REVERSE_SEARCH_ENABLED === "true"
  );
}

export interface CrossMarketOpportunityCandidate extends ProcurementCandidate {
  itemStatus?: "active" | "sold" | "ended" | "reserved" | "unknown";
  archived?: boolean;
  ignored?: boolean;
  listingMatchDecision?:
    | "unmatched"
    | "auto_matched"
    | "review_required"
    | "manually_matched";
  listingMatchConfidence?: number | null;
  listingObservedAt?: Date | null;
  xianyuReferencePriceCny?: number | null;
  xianyuMatchedCount?: number | null;
  xianyuMatchConfidence?: number | null;
  xianyuObservedAt?: Date | null;
  xianyuQuantity?: number | null;
  jpyToCnyRate?: number | null;
  exchangeRateFetchedAt?: Date | null;
  evaluatedAt?: Date;
}

export interface CrossMarketOpportunityAssessment {
  status: CrossMarketOpportunityStatus;
  reasons: string[];
  missingFacts: CrossMarketOpportunityMissingFact[];
  acquisitionCostJpy: number | null;
  grossRevenueJpy: number | null;
  grossSpreadCny: number | null;
  grossSpreadRatio: number | null;
  platformFeeJpy: number | null;
  internationalShippingJpy: number | null;
  chinaFulfillmentJpy: number | null;
  netProfitJpy: number | null;
  netMarginRatio: number | null;
}

function finiteNonNegative(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function finitePositive(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function finiteRatio(value: unknown) {
  const parsed = finiteNonNegative(value);
  return parsed != null && parsed <= 1 ? parsed : undefined;
}

function positiveInteger(value: unknown) {
  const parsed = finitePositive(value);
  return parsed != null && Number.isSafeInteger(parsed) ? parsed : undefined;
}

const maximumPersistedJpy = 2_147_483_647;

function envNonNegative(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized || !/^\d+(?:\.\d+)?$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function envPositive(value: string | undefined) {
  const parsed = envNonNegative(value);
  return parsed != null && parsed > 0 ? parsed : undefined;
}

function envRatio(value: string | undefined) {
  const parsed = envNonNegative(value);
  return parsed != null && parsed <= 1 ? parsed : undefined;
}

export function crossMarketArbitrageConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): CrossMarketArbitrageConfig {
  return {
    minimumXianyuReferencePriceCny:
      envPositive(env.XIANYU_ARBITRAGE_MIN_REFERENCE_PRICE_CNY) ??
      DEFAULT_CROSS_MARKET_ARBITRAGE_CONFIG.minimumXianyuReferencePriceCny,
    minimumGrossSpreadCny:
      envPositive(env.XIANYU_ARBITRAGE_MIN_GROSS_SPREAD_CNY) ??
      DEFAULT_CROSS_MARKET_ARBITRAGE_CONFIG.minimumGrossSpreadCny,
    minimumGrossSpreadRatio:
      envRatio(env.XIANYU_ARBITRAGE_MIN_GROSS_SPREAD_RATIO) ??
      DEFAULT_CROSS_MARKET_ARBITRAGE_CONFIG.minimumGrossSpreadRatio,
    minimumNetProfitJpy:
      envPositive(env.XIANYU_ARBITRAGE_MIN_NET_PROFIT_JPY) ??
      DEFAULT_CROSS_MARKET_ARBITRAGE_CONFIG.minimumNetProfitJpy,
    minimumNetMarginRatio:
      envRatio(env.XIANYU_ARBITRAGE_MIN_NET_MARGIN_RATIO) ??
      DEFAULT_CROSS_MARKET_ARBITRAGE_CONFIG.minimumNetMarginRatio,
    minimumMatchConfidence:
      envRatio(env.XIANYU_ARBITRAGE_MIN_MATCH_CONFIDENCE) ??
      DEFAULT_CROSS_MARKET_ARBITRAGE_CONFIG.minimumMatchConfidence,
    maximumListingAgeMs:
      envPositive(env.XIANYU_ARBITRAGE_MAX_LISTING_AGE_MS) ??
      DEFAULT_CROSS_MARKET_ARBITRAGE_CONFIG.maximumListingAgeMs,
    maximumComparisonAgeMs:
      envPositive(env.XIANYU_ARBITRAGE_MAX_COMPARISON_AGE_MS) ??
      DEFAULT_CROSS_MARKET_ARBITRAGE_CONFIG.maximumComparisonAgeMs,
    maximumExchangeRateAgeMs:
      envPositive(env.XIANYU_ARBITRAGE_MAX_EXCHANGE_RATE_AGE_MS) ??
      DEFAULT_CROSS_MARKET_ARBITRAGE_CONFIG.maximumExchangeRateAgeMs,
    platformFeeRate: envRatio(env.XIANYU_ARBITRAGE_PLATFORM_FEE_RATE),
    internationalShippingJpy: envNonNegative(
      env.XIANYU_ARBITRAGE_INTERNATIONAL_SHIPPING_JPY,
    ),
    chinaFulfillmentCny: envNonNegative(
      env.XIANYU_ARBITRAGE_CHINA_FULFILLMENT_CNY,
    ),
    procurement: procurementConfigFromEnv(env),
  };
}

function addMissing(
  missingFacts: CrossMarketOpportunityMissingFact[],
  value: CrossMarketOpportunityMissingFact,
) {
  if (!missingFacts.includes(value)) missingFacts.push(value);
}

function emptyFinancials(): Omit<
  CrossMarketOpportunityAssessment,
  "status" | "reasons" | "missingFacts"
> {
  return {
    acquisitionCostJpy: null,
    grossRevenueJpy: null,
    grossSpreadCny: null,
    grossSpreadRatio: null,
    platformFeeJpy: null,
    internationalShippingJpy: null,
    chinaFulfillmentJpy: null,
    netProfitJpy: null,
    netMarginRatio: null,
  };
}

function result(
  status: CrossMarketOpportunityStatus,
  reasons: string[],
  missingFacts: CrossMarketOpportunityMissingFact[],
  financials: ReturnType<typeof emptyFinancials>,
): CrossMarketOpportunityAssessment {
  const jpyValues = [
    financials.acquisitionCostJpy,
    financials.grossRevenueJpy,
    financials.platformFeeJpy,
    financials.internationalShippingJpy,
    financials.chinaFulfillmentJpy,
    financials.netProfitJpy,
  ];
  const hasInvalidCalculation =
    Object.values(financials).some(
      (value) => value != null && !Number.isFinite(value),
    ) ||
    jpyValues.some(
      (value) => value != null && Math.abs(value) > maximumPersistedJpy,
    );
  if (hasInvalidCalculation) {
    addMissing(missingFacts, "financial_calculation");
    return {
      status: "needs_facts",
      reasons: [...reasons, "金额计算超出可验证范围，暂不保存或宣称利润。"],
      missingFacts,
      ...Object.fromEntries(
        Object.entries(financials).map(([key, value]) => [
          key,
          value != null && Number.isFinite(value) ? value : null,
        ]),
      ),
    } as CrossMarketOpportunityAssessment;
  }
  return { status, reasons, missingFacts, ...financials };
}

export function assessCrossMarketOpportunity(
  input: CrossMarketOpportunityCandidate,
  config: CrossMarketArbitrageConfig,
): CrossMarketOpportunityAssessment {
  const now = input.evaluatedAt ?? new Date();
  const reasons: string[] = [];
  const missingFacts: CrossMarketOpportunityMissingFact[] = [];
  const financials = emptyFinancials();

  if (
    input.archived ||
    input.ignored ||
    !["active", "unknown"].includes(input.itemStatus ?? "unknown")
  )
    return result(
      "rejected",
      ["日本商品已下架、忽略或不可采购。"],
      missingFacts,
      financials,
    );

  const evaluatedAt = now.getTime();
  const minimumReferencePrice = finitePositive(
    config.minimumXianyuReferencePriceCny,
  );
  const minimumGrossSpread = finiteNonNegative(config.minimumGrossSpreadCny);
  const minimumGrossSpreadRatio = finiteRatio(config.minimumGrossSpreadRatio);
  const minimumNetProfit = finiteNonNegative(config.minimumNetProfitJpy);
  const minimumNetMarginRatio = finiteRatio(config.minimumNetMarginRatio);
  const minimumMatchConfidence = finiteRatio(config.minimumMatchConfidence);
  const maximumListingAgeMs = finitePositive(config.maximumListingAgeMs);
  const maximumComparisonAgeMs = finitePositive(config.maximumComparisonAgeMs);
  const maximumExchangeRateAgeMs = finitePositive(
    config.maximumExchangeRateAgeMs,
  );
  const validProcurementConfig = [
    config.procurement.minQuantity,
    config.procurement.targetQuantity,
    config.procurement.maxUnitCostJpy,
    config.procurement.maxVolumeCm3,
    config.procurement.maxUnitVolumeCm3,
  ].every((value) => positiveInteger(value) != null);
  if (
    !Number.isFinite(evaluatedAt) ||
    minimumReferencePrice == null ||
    minimumGrossSpread == null ||
    minimumGrossSpreadRatio == null ||
    minimumNetProfit == null ||
    minimumNetMarginRatio == null ||
    minimumMatchConfidence == null ||
    maximumListingAgeMs == null ||
    maximumComparisonAgeMs == null ||
    maximumExchangeRateAgeMs == null ||
    !validProcurementConfig
  ) {
    addMissing(missingFacts, "configuration");
    return result(
      "needs_facts",
      ["套利阈值或评估时间无效，暂不计算利润。"],
      missingFacts,
      financials,
    );
  }

  const listingObservedAt = input.listingObservedAt?.getTime();
  if (listingObservedAt == null || !Number.isFinite(listingObservedAt))
    addMissing(missingFacts, "listing_freshness");
  else if (
    listingObservedAt > evaluatedAt + 5 * 60_000 ||
    evaluatedAt - listingObservedAt > maximumListingAgeMs
  )
    addMissing(missingFacts, "listing_freshness");

  const referencePriceCny = finitePositive(input.xianyuReferencePriceCny);
  if (referencePriceCny == null) {
    addMissing(missingFacts, "comparison_identity");
  } else if (referencePriceCny < minimumReferencePrice) {
    return result(
      "rejected",
      [`闲鱼参考价低于反向寻货门槛 ${minimumReferencePrice} CNY。`],
      missingFacts,
      financials,
    );
  }

  const matchedCount = finiteNonNegative(input.xianyuMatchedCount);
  const xianyuConfidence = finiteRatio(input.xianyuMatchConfidence);
  if (
    matchedCount == null ||
    matchedCount < 3 ||
    xianyuConfidence == null ||
    xianyuConfidence < minimumMatchConfidence
  )
    addMissing(missingFacts, "comparison_identity");

  const comparisonObservedAt = input.xianyuObservedAt?.getTime();
  if (comparisonObservedAt == null || !Number.isFinite(comparisonObservedAt))
    addMissing(missingFacts, "comparison_freshness");
  else if (
    comparisonObservedAt > evaluatedAt + 5 * 60_000 ||
    evaluatedAt - comparisonObservedAt > maximumComparisonAgeMs
  )
    addMissing(missingFacts, "comparison_freshness");

  const listingIdentityVerified =
    input.listingMatchDecision === "manually_matched" ||
    (input.listingMatchDecision === "auto_matched" &&
      finiteRatio(input.listingMatchConfidence) != null &&
      Number(input.listingMatchConfidence) >= minimumMatchConfidence);
  if (!listingIdentityVerified) addMissing(missingFacts, "listing_identity");

  const quantity = finitePositive(input.quantityEst);
  if (quantity == null) addMissing(missingFacts, "quantity");
  else if (quantity < config.procurement.minQuantity)
    return result(
      "rejected",
      [`数量低于最低采购条件 ${config.procurement.minQuantity} 件。`],
      missingFacts,
      financials,
    );

  const xianyuQuantity = finitePositive(input.xianyuQuantity);
  if (quantity != null && quantity > 1) {
    if (xianyuQuantity == null) addMissing(missingFacts, "xianyu_quantity");
    else if (xianyuQuantity !== quantity)
      return result(
        "rejected",
        ["闲鱼报价与日本商品的明确数量不一致。"],
        missingFacts,
        financials,
      );
  }

  const procurement = assessProcurementCandidate(
    { ...input, logistics: procurementLogisticsEvidence(input.logistics) },
    config.procurement,
  );
  if (procurement.compactness === "bulky")
    return result(
      "rejected",
      ["已知总体积或单件体积不符合小体积条件。"],
      missingFacts,
      financials,
    );
  if (procurement.compactness !== "compact") addMissing(missingFacts, "volume");
  if (
    input.conditionGrade === "junk" ||
    input.conditionGrade === "stained_or_damaged"
  )
    return result(
      "rejected",
      ["日本商品品相存在故障、污损或缺件风险。"],
      missingFacts,
      financials,
    );
  if (!input.conditionGrade || input.conditionGrade === "unknown")
    addMissing(missingFacts, "condition");

  const priceCurrentJpy = finiteNonNegative(input.priceCurrent);
  const shippingFeeJpy = finiteNonNegative(input.shippingFee);
  if (input.listingType !== "direct") addMissing(missingFacts, "listing_type");
  if (shippingFeeJpy == null) addMissing(missingFacts, "shipping_fee");

  const jpyToCnyRate = finitePositive(input.jpyToCnyRate);
  if (jpyToCnyRate == null) addMissing(missingFacts, "exchange_rate");
  const rateFetchedAt = input.exchangeRateFetchedAt?.getTime();
  if (rateFetchedAt == null || !Number.isFinite(rateFetchedAt))
    addMissing(missingFacts, "exchange_rate_freshness");
  else if (
    rateFetchedAt > evaluatedAt + 5 * 60_000 ||
    evaluatedAt - rateFetchedAt > maximumExchangeRateAgeMs
  )
    addMissing(missingFacts, "exchange_rate_freshness");

  if (
    referencePriceCny != null &&
    jpyToCnyRate != null &&
    priceCurrentJpy != null
  ) {
    const acquisitionLowerBoundJpy = priceCurrentJpy + (shippingFeeJpy ?? 0);
    const acquisitionLowerBoundCny = acquisitionLowerBoundJpy * jpyToCnyRate;
    const grossSpreadCny = referencePriceCny - acquisitionLowerBoundCny;
    const grossSpreadRatio =
      acquisitionLowerBoundCny > 0
        ? grossSpreadCny / acquisitionLowerBoundCny
        : null;
    financials.grossRevenueJpy = referencePriceCny / jpyToCnyRate;
    financials.grossSpreadCny = grossSpreadCny;
    financials.grossSpreadRatio = grossSpreadRatio;
    if (grossSpreadRatio == null) addMissing(missingFacts, "acquisition_cost");
    else if (
      grossSpreadCny < minimumGrossSpread ||
      grossSpreadRatio < minimumGrossSpreadRatio
    )
      return result(
        "rejected",
        ["日本采购成本下限与闲鱼参考价之间的价差不足。"],
        missingFacts,
        financials,
      );
  }

  const platformFeeRate = finiteRatio(config.platformFeeRate);
  const internationalShippingJpy = finiteNonNegative(
    config.internationalShippingJpy,
  );
  const chinaFulfillmentCny = finiteNonNegative(config.chinaFulfillmentCny);
  if (platformFeeRate == null) addMissing(missingFacts, "platform_fee");
  if (internationalShippingJpy == null)
    addMissing(missingFacts, "international_shipping");
  if (chinaFulfillmentCny == null)
    addMissing(missingFacts, "china_fulfillment");

  if (
    missingFacts.length ||
    referencePriceCny == null ||
    jpyToCnyRate == null ||
    priceCurrentJpy == null ||
    shippingFeeJpy == null ||
    platformFeeRate == null ||
    internationalShippingJpy == null ||
    chinaFulfillmentCny == null
  ) {
    reasons.push("缺少同款、数量、体积、汇率或费用事实，暂不宣称利润。");
    return result("needs_facts", reasons, missingFacts, financials);
  }

  const acquisitionCostJpy = priceCurrentJpy + shippingFeeJpy;
  const grossRevenueJpy = referencePriceCny / jpyToCnyRate;
  const platformFeeJpy = (referencePriceCny * platformFeeRate) / jpyToCnyRate;
  const chinaFulfillmentJpy = chinaFulfillmentCny / jpyToCnyRate;
  const totalCostJpy =
    acquisitionCostJpy +
    platformFeeJpy +
    internationalShippingJpy +
    chinaFulfillmentJpy;
  const netProfitJpy = grossRevenueJpy - totalCostJpy;
  const netMarginRatio =
    grossRevenueJpy > 0 ? netProfitJpy / grossRevenueJpy : 0;
  Object.assign(financials, {
    acquisitionCostJpy,
    grossRevenueJpy,
    platformFeeJpy,
    internationalShippingJpy,
    chinaFulfillmentJpy,
    netProfitJpy,
    netMarginRatio,
  });

  if (netProfitJpy < minimumNetProfit || netMarginRatio < minimumNetMarginRatio)
    return result(
      "rejected",
      ["扣除确定性费用后的净利润或利润率不足。"],
      missingFacts,
      financials,
    );

  return result(
    "ready",
    ["同款、数量、体积、汇率和全部费用均有确定性证据，净利润达到门槛。"],
    missingFacts,
    financials,
  );
}
