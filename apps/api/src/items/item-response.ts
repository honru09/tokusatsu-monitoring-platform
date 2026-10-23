import {
  CrossMarketOpportunityStatus,
  MarketComparisonStatus,
  Prisma,
} from "@tokusatsu/db";
import { independentValueKing, type ValueKingListing } from './value-king.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DEFAULT_COMPARISON_INTERVAL_MS = 6 * HOUR_MS;
const DEFAULT_COMPARISON_MAX_STALE_MS = 4 * DEFAULT_COMPARISON_INTERVAL_MS;
const MAX_DERIVED_COMPARISON_STALE_MS = 7 * DAY_MS;
const MAX_CONFIGURED_COMPARISON_STALE_MS = 30 * DAY_MS;
const MAX_OBSERVATION_CLOCK_SKEW_MS = 5 * 60_000;
const XIANYU_SOURCE_KEY = "xianyu";
const XIANYU_DISPLAY_NAME = "闲鱼";

export const xianyuPriceBands = ["lt_300", "300_999", "gte_1000"] as const;
export type XianyuPriceBand = (typeof xianyuPriceBands)[number];

const chinaComparisonSelect = {
  status: true,
  matchedCount: true,
  minPriceCny: true,
  maxPriceCny: true,
  confidence: true,
  referencePriceCny: true,
  referenceUrl: true,
  observedAt: true,
  lastError: true,
  source: { select: { key: true, displayName: true } },
} satisfies Prisma.ProductMarketComparisonSelect;

const chinaComparisonOfferSelect = {
  sourceListingId: true,
  sourceUrl: true,
  titleRaw: true,
  priceCny: true,
  imageUrl: true,
  condition: true,
  status: true,
  matchConfidence: true,
  matchDecision: true,
  lastSeenAt: true,
} satisfies Prisma.ComparisonOfferSelect;

export const valueKingOpportunitySelect = {
  status: true,
  xianyuReferencePriceCny: true,
  jpyToCnyRate: true,
  acquisitionCostJpy: true,
  grossSpreadCny: true,
  grossSpreadRatio: true,
  netProfitJpy: true,
  netMarginRatio: true,
  missingFacts: true,
  rejectionReason: true,
  listingObservedAt: true,
  comparisonObservedAt: true,
  exchangeRateFetchedAt: true,
  evidenceExpiresAt: true,
  evaluatedAt: true,
  comparison: {
    select: {
      status: true,
      matchedCount: true,
      confidence: true,
      referencePriceCny: true,
      referenceUrl: true,
      observedAt: true,
      lastError: true,
      source: { select: { key: true } },
    },
  },
} satisfies Prisma.CrossMarketOpportunitySelect;

export const readyValueKingOpportunityRelation = {
  where: {
    status: CrossMarketOpportunityStatus.ready,
    missingFacts: { isEmpty: true },
    rejectionReason: null,
  },
  select: valueKingOpportunitySelect,
  orderBy: [
    { netProfitJpy: { sort: "desc" as const, nulls: "last" as const } },
    { evaluatedAt: "desc" as const },
  ],
  take: 3,
} satisfies Prisma.CrossMarketOpportunityFindManyArgs;

/**
 * Shared nested relation for every item surface that exposes China-market
 * comparison data. Only a completed summary is public; failed or in-progress
 * refreshes stay available to operators without appearing as price evidence.
 */
export const readyChinaComparisonRelation = {
  where: {
    status: MarketComparisonStatus.ready,
    lastError: null,
    source: { key: XIANYU_SOURCE_KEY },
  },
  select: chinaComparisonSelect,
  orderBy: [{ observedAt: "desc" as const }, { updatedAt: "desc" as const }],
  take: 1,
} satisfies Prisma.ProductMarketComparisonFindManyArgs;

/** Detail-only evidence; list and discovery payloads retain the compact summary. */
export const readyChinaComparisonDetailRelation = {
  ...readyChinaComparisonRelation,
  select: {
    ...chinaComparisonSelect,
    offers: {
      where: {
        status: "active" as const,
        matchDecision: "auto_matched" as const,
        matchConfidence: { gte: 0.85 },
      },
      select: chinaComparisonOfferSelect,
      orderBy: [
        { priceCny: "asc" as const },
        { matchConfidence: "desc" as const },
        { sourceListingId: "asc" as const },
      ],
      take: 3,
    },
  },
} satisfies Prisma.ProductMarketComparisonFindManyArgs;

type ChinaComparisonRow = Prisma.ProductMarketComparisonGetPayload<{
  select: typeof chinaComparisonSelect;
}>;

type ChinaComparisonOfferRow = Prisma.ComparisonOfferGetPayload<{
  select: typeof chinaComparisonOfferSelect;
}>;

function decimalNumber(value: unknown) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveFiniteNumber(value: string | undefined) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function comparisonMaxStaleMs() {
  const configuredMaxStale = process.env.XIANYU_COMPARISON_MAX_STALE_MS;
  if (configuredMaxStale != null) {
    return Math.min(
      positiveFiniteNumber(configuredMaxStale) ??
        DEFAULT_COMPARISON_MAX_STALE_MS,
      MAX_CONFIGURED_COMPARISON_STALE_MS,
    );
  }

  const configuredInterval = process.env.XIANYU_COMPARISON_INTERVAL_MS;
  if (configuredInterval == null) return DEFAULT_COMPARISON_MAX_STALE_MS;
  const interval = positiveFiniteNumber(configuredInterval);
  if (interval == null) return DEFAULT_COMPARISON_MAX_STALE_MS;
  return Math.min(interval * 3, MAX_DERIVED_COMPARISON_STALE_MS);
}

function chinaComparisonExposureEnabled() {
  return (
    process.env.CHINA_MARKET_COMPARISON_ENABLED === "true" &&
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED === "true" &&
    process.env.XIANYU_COMPARISON_ENABLED === "true"
  );
}

/**
 * The database predicate used by list and overview surfaces must match the
 * public response contract below. Otherwise an item can be counted or offered
 * as a filter result even though its stale or incomplete comparison is hidden
 * from the card.
 */
export function publicReadyChinaComparisonWhere(
  priceBand?: XianyuPriceBand,
  now = new Date(),
): Prisma.ProductMarketComparisonWhereInput | null {
  if (!chinaComparisonExposureEnabled()) return null;
  const referencePriceCny = priceBand
    ? priceBand === "lt_300"
      ? { gt: 0, lt: 300 }
      : priceBand === "300_999"
        ? { gte: 300, lt: 1_000 }
        : { gte: 1_000, lte: 1_000_000 }
    : { gt: 0, lte: 1_000_000 };
  return {
    status: MarketComparisonStatus.ready,
    lastError: null,
    matchedCount: { gte: 3 },
    confidence: { gte: 0.85, lte: 1 },
    referencePriceCny,
    referenceUrl: { not: null },
    observedAt: {
      gte: new Date(now.getTime() - comparisonMaxStaleMs()),
      lte: new Date(now.getTime() + MAX_OBSERVATION_CLOCK_SKEW_MS),
    },
    source: { key: XIANYU_SOURCE_KEY },
  };
}

export function publicValueKingOpportunityWhere(
  now = new Date(),
): Prisma.CrossMarketOpportunityWhereInput | null {
  const comparison = publicReadyChinaComparisonWhere(undefined, now);
  if (
    !comparison ||
    process.env.XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED !== "true"
  )
    return null;
  return {
    status: CrossMarketOpportunityStatus.ready,
    missingFacts: { isEmpty: true },
    rejectionReason: null,
    evidenceExpiresAt: { gt: now },
    acquisitionCostJpy: { gt: 0 },
    netProfitJpy: { gt: 0 },
    netMarginRatio: { gt: 0 },
    comparison: { is: comparison },
  };
}

export function publicValueKingOpportunityRelation(now = new Date()) {
  const where = publicValueKingOpportunityWhere(now);
  if (!where) return null;
  return {
    where,
    select: valueKingOpportunitySelect,
    orderBy: [
      { netProfitJpy: { sort: "desc" as const, nulls: "last" as const } },
      { evaluatedAt: "desc" as const },
    ],
    take: 3,
  } satisfies Prisma.CrossMarketOpportunityFindManyArgs;
}

function validListingId(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(value);
}

function goofishSourceUrl(value: string | null) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    const validProtocol = url.protocol === "https:";
    const validHostname =
      url.hostname === "goofish.com" || url.hostname.endsWith(".goofish.com");
    if (
      !validProtocol ||
      !validHostname ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return null;
    const queryIds = url.searchParams.getAll("id");
    const queryId = queryIds[0]?.trim();
    if (queryIds.length !== 1 || url.pathname !== "/item" || !queryId)
      return null;
    const id = queryId;
    if (!id || !validListingId(id)) return null;
    // Always expose the canonical item URL. This removes tracking fragments,
    // prevents an official-looking arbitrary path from becoming a link, and
    // keeps the browser contract identical to the provider's output.
    return `https://www.goofish.com/item?id=${encodeURIComponent(id)}`;
  } catch {
    return null;
  }
}

function publicXianyuSource(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as { key?: unknown; displayName?: unknown };
  if (
    source.key !== XIANYU_SOURCE_KEY ||
    typeof source.displayName !== "string" ||
    source.displayName.trim() !== XIANYU_DISPLAY_NAME
  )
    return null;
  return {
    key: XIANYU_SOURCE_KEY,
    displayName: XIANYU_DISPLAY_NAME,
  };
}

function publicHttpsImageUrl(value: string | null) {
  if (!value || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

function publicComparisonOffers(
  value: unknown,
  observedAtMs: number,
  referenceUrl: string,
) {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      const offer = entry as Partial<ChinaComparisonOfferRow>;
      const sourceUrl = goofishSourceUrl(offer.sourceUrl ?? null);
      const priceCny = decimalNumber(offer.priceCny);
      const matchConfidence = decimalNumber(offer.matchConfidence);
      const title =
        typeof offer.titleRaw === "string"
          ? offer.titleRaw.normalize("NFKC").replace(/\s+/g, " ").trim()
          : "";
      const lastSeenAtMs =
        offer.lastSeenAt instanceof Date
          ? offer.lastSeenAt.getTime()
          : Number.NaN;
      if (
        offer.status !== "active" ||
        offer.matchDecision !== "auto_matched" ||
        sourceUrl == null ||
        priceCny == null ||
        priceCny <= 0 ||
        priceCny > 1_000_000 ||
        matchConfidence == null ||
        matchConfidence < 0.85 ||
        matchConfidence > 1 ||
        !title ||
        title.length > 300 ||
        /[\u0000-\u001f\u007f]/u.test(title) ||
        !Number.isFinite(lastSeenAtMs) ||
        Math.abs(lastSeenAtMs - observedAtMs) > MAX_OBSERVATION_CLOCK_SKEW_MS
      )
        return [];
      const condition =
        typeof offer.condition === "string"
          ? offer.condition
              .normalize("NFKC")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 160)
          : "";
      return [
        {
          title,
          priceCny,
          condition: condition || null,
          imageUrl: publicHttpsImageUrl(offer.imageUrl ?? null),
          sourceUrl,
          isReference: sourceUrl === referenceUrl,
        },
      ];
    })
    .sort((left, right) => left.priceCny - right.priceCny)
    .slice(0, 3);
}

function chinaComparisonResponse(
  comparison?: ChinaComparisonRow,
  includeOffers = false,
) {
  if (
    !chinaComparisonExposureEnabled() ||
    !comparison ||
    comparison.status !== MarketComparisonStatus.ready ||
    comparison.lastError != null
  )
    return null;

  const referencePriceCny = decimalNumber(comparison.referencePriceCny);
  const referenceUrl = goofishSourceUrl(comparison.referenceUrl);
  const source = publicXianyuSource(comparison.source);
  const matchedCount = Number(comparison.matchedCount);
  const minimumPriceCny = decimalNumber(comparison.minPriceCny);
  const maximumPriceCny = decimalNumber(comparison.maxPriceCny);
  const confidence = decimalNumber(comparison.confidence);
  const observedAtMs =
    comparison.observedAt instanceof Date
      ? comparison.observedAt.getTime()
      : Number.NaN;
  if (
    referencePriceCny == null ||
    referencePriceCny <= 0 ||
    referencePriceCny > 1_000_000 ||
    !Number.isInteger(matchedCount) ||
    matchedCount < 3 ||
    minimumPriceCny == null ||
    minimumPriceCny <= 0 ||
    minimumPriceCny > 1_000_000 ||
    maximumPriceCny == null ||
    maximumPriceCny < minimumPriceCny ||
    maximumPriceCny > 1_000_000 ||
    referencePriceCny < minimumPriceCny ||
    referencePriceCny > maximumPriceCny ||
    confidence == null ||
    confidence < 0.85 ||
    confidence > 1 ||
    source == null ||
    referenceUrl == null ||
    !Number.isFinite(observedAtMs) ||
    observedAtMs > Date.now() + MAX_OBSERVATION_CLOCK_SKEW_MS ||
    Date.now() - observedAtMs > comparisonMaxStaleMs()
  ) {
    return null;
  }

  return {
    status: comparison.status,
    source,
    referencePriceCny,
    referenceUrl,
    observedAt: comparison.observedAt,
    expiresAt: new Date(observedAtMs + comparisonMaxStaleMs()),
    ...(includeOffers
      ? {
          offers: publicComparisonOffers(
            (comparison as ChinaComparisonRow & { offers?: unknown }).offers,
            observedAtMs,
            referenceUrl,
          ),
        }
      : {}),
  };
}

type ValueKingOpportunityRow = Prisma.CrossMarketOpportunityGetPayload<{
  select: typeof valueKingOpportunitySelect;
}>;

function xianyuValueKingOpportunityResponse(
  item: {
    listingType?: string | null;
    status?: string | null;
    archivedAt?: Date | string | null;
    ignored?: boolean | null;
    purchaseRecord?: unknown;
    priceCurrent?: number | null;
    shippingFee?: number | null;
    quantityEst?: number | null;
    conditionGrade?: string | null;
    crossMarketOpportunities?: ValueKingOpportunityRow[];
  },
  now = new Date(),
) {
  if (
    !chinaComparisonExposureEnabled() ||
    process.env.XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED !== "true" ||
    item.listingType !== "direct" ||
    item.status !== "active" ||
    item.archivedAt ||
    item.ignored ||
    item.purchaseRecord ||
    item.shippingFee == null ||
    !Number.isFinite(item.shippingFee) ||
    item.shippingFee < 0 ||
    !Number.isFinite(item.priceCurrent) ||
    Number(item.priceCurrent) <= 0 ||
    !Number.isInteger(item.quantityEst) ||
    Number(item.quantityEst) <= 0 ||
    !["new_sealed", "like_new", "used"].includes(item.conditionGrade ?? "")
  )
    return null;

  const quantity = Number(item.quantityEst);
  const acquisitionCostJpy =
    Number(item.priceCurrent) + Number(item.shippingFee);
  const unitCostJpy = acquisitionCostJpy / quantity;
  const candidates = item.crossMarketOpportunities ?? [];
  for (const opportunity of candidates) {
    const expiresAt = opportunity.evidenceExpiresAt?.getTime();
    const referencePriceCny = decimalNumber(
      opportunity.xianyuReferencePriceCny,
    );
    const rate = decimalNumber(opportunity.jpyToCnyRate);
    const netProfitJpy = Number(opportunity.netProfitJpy);
    const netMarginRatio = Number(opportunity.netMarginRatio);
    const grossSpreadRatio = Number(opportunity.grossSpreadRatio);
    const persistedAcquisitionCost = Number(opportunity.acquisitionCostJpy);
    const comparison = opportunity.comparison;
    const comparisonObservedAt = comparison.observedAt?.getTime();
    const comparisonReferencePrice = decimalNumber(
      comparison.referencePriceCny,
    );
    if (
      opportunity.status !== CrossMarketOpportunityStatus.ready ||
      opportunity.missingFacts.length > 0 ||
      opportunity.rejectionReason != null ||
      expiresAt == null ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= now.getTime() ||
      referencePriceCny == null ||
      rate == null ||
      rate <= 0 ||
      !Number.isFinite(netProfitJpy) ||
      !Number.isFinite(netMarginRatio) ||
      !Number.isFinite(grossSpreadRatio) ||
      !Number.isFinite(persistedAcquisitionCost) ||
      Math.abs(persistedAcquisitionCost - acquisitionCostJpy) > 1 ||
      comparison.status !== MarketComparisonStatus.ready ||
      comparison.lastError != null ||
      comparison.source.key !== XIANYU_SOURCE_KEY ||
      comparison.matchedCount < 3 ||
      comparison.confidence == null ||
      comparison.confidence < 0.85 ||
      comparison.confidence > 1 ||
      comparisonReferencePrice == null ||
      Math.abs(comparisonReferencePrice - referencePriceCny) > 0.01 ||
      !comparison.referenceUrl ||
      comparisonObservedAt == null ||
      !Number.isFinite(comparisonObservedAt) ||
      comparisonObservedAt > now.getTime() + MAX_OBSERVATION_CLOCK_SKEW_MS ||
      now.getTime() - comparisonObservedAt > comparisonMaxStaleMs()
    )
      continue;
    const acquisitionCostCny = acquisitionCostJpy * rate;
    const highValueLowPrice =
      referencePriceCny >= 500 &&
      acquisitionCostCny <= referencePriceCny * 0.58 &&
      netProfitJpy >= 5_000 &&
      netMarginRatio >= 0.4 &&
      grossSpreadRatio >= 0.5;
    const ultraLowBundle =
      quantity >= 5 &&
      unitCostJpy <= 1_200 &&
      netProfitJpy >= 2_500 &&
      netMarginRatio >= 0.3 &&
      grossSpreadRatio >= 0.4;
    if (!highValueLowPrice && !ultraLowBundle) continue;
    return {
      kind: highValueLowPrice
        ? ("high_value_low_price" as const)
        : ("ultra_low_bundle" as const),
      label: highValueLowPrice ? "高价值低价" : "超低单价捆包",
      acquisitionCostJpy: Math.round(acquisitionCostJpy),
      unitCostJpy: Math.round(unitCostJpy),
      quantity,
      xianyuReferencePriceCny: referencePriceCny,
      netProfitJpy: Math.round(netProfitJpy),
      netMarginRatio,
      evidenceExpiresAt: opportunity.evidenceExpiresAt,
      facts: [
        `到手成本 ¥${Math.round(acquisitionCostJpy).toLocaleString("ja-JP")}`,
        `数量 ${quantity} 件 · 单件 ¥${Math.round(unitCostJpy).toLocaleString("ja-JP")}`,
        `闲鱼同款参考 ¥${Math.round(referencePriceCny).toLocaleString("zh-CN")}`,
        `扣除已知费用后净利润 ¥${Math.round(netProfitJpy).toLocaleString("ja-JP")}`,
      ],
    };
  }
  return null;
}

export function valueKingOpportunityResponse(item: Parameters<typeof xianyuValueKingOpportunityResponse>[0] & ValueKingListing, now=new Date()) {
  const china=xianyuValueKingOpportunityResponse(item,now);
  return china?{...china,referenceBasis:'xianyu' as const,referencePriceJpy:null,referenceSampleCount:3,savingsJpy:null}:independentValueKing(item,now);
}

/**
 * Adds the stable top-level `chinaComparison` contract and removes the nested
 * persistence-only relations. Item list, detail and discovery all pass through
 * this function so their response shapes cannot drift apart. Profit and
 * candidate-level audit evidence intentionally remain internal.
 */
export function itemResponseWithChinaComparison<T>(
  item: T,
  options: { includeOffers?: boolean } = {},
) {
  const value = item as T & ValueKingListing & {
    crossMarketOpportunities?: ValueKingOpportunityRow[];
    product?:
      | ({ marketComparisons?: ChinaComparisonRow[] } & Record<string, unknown>)
      | null;
  };
  const comparisons = value.product?.marketComparisons;
  const {
    crossMarketOpportunities: _crossMarketOpportunities,
    ...itemWithoutOpportunityRelation
  } = value;
  const response: Record<string, unknown> = {
    ...(itemWithoutOpportunityRelation as Record<string, unknown>),
    chinaComparison: chinaComparisonResponse(
      comparisons?.[0],
      options.includeOffers === true,
    ),
    valueKing: valueKingOpportunityResponse(value),
  };

  if (value.product) {
    const { marketComparisons: _marketComparisons, listings: _valueKingPeers, ...product } = value.product;
    response.product = product;
  }

  return response as Omit<T, "product" | "crossMarketOpportunities"> & {
    product: T extends { product: infer P } ? P : never;
    chinaComparison: ReturnType<typeof chinaComparisonResponse>;
    valueKing: ReturnType<typeof valueKingOpportunityResponse>;
  };
}
