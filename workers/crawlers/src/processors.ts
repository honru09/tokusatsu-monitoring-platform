import {
  classifyImages,
  isNonRetryableImageAnalysisError,
  selectImageAnalysisUrls,
} from "@tokusatsu/classification";
import { prisma, Prisma } from "@tokusatsu/db";
import {
  matchOrCreateProduct,
  mergeExtractionEvidence,
} from "@tokusatsu/product-intelligence";
import {
  assessProcurementCandidate,
  assessInventoryQuality,
  auctionRefreshDelay,
  categoryIps,
  classifyCollectibleSeries,
  classifyShfListing,
  classifyText,
  conditionGrades,
  extractQuantityEst,
  isExcludedNormalizedItem,
  manufacturers,
  procurementCategories,
  procurementCompactness,
  procurementConfigFromEnv,
  procurementLogisticsEvidence,
  rankProcurementCandidates,
  resolveListingType,
  toyTypes,
  xianyuReverseSearchEnabled,
} from "@tokusatsu/shared";
import type {
  CategoryIp,
  ConditionGrade,
  ItemStatusUpdate,
  ListingType,
  Manufacturer,
  NormalizedItem,
  ProcurementAssessment,
  SearchQuery,
  SearchResult,
  SourceAdapter,
  ToyType,
} from "@tokusatsu/shared";
import { UnrecoverableError, type Job } from "bullmq";
import { createHash } from "node:crypto";
import { ApifyEcommerceAdapter } from "./adapters/apify-ecommerce.adapter.js";
import { FirecrawlMarketplaceAdapter } from "./adapters/firecrawl-market.adapter.js";
import {
  extractLogisticsHints,
  type LogisticsHints,
} from "./adapters/logistics-hints.js";
import {
  extractProductImageUrls,
  sanitizeProductImageUrls,
} from "./adapters/images.js";
import { MandarakeAdapter } from "./adapters/mandarake.adapter.js";
import { MercariAdapter } from "./adapters/mercari.adapter.js";
import { MockAdapter } from "./adapters/mock.adapter.js";
import { PlaywrightPageAdapter } from "./adapters/playwright-page.adapter.js";
import { PublicPageAdapter } from "./adapters/public-page.adapter.js";
import { RakumaAdapter } from "./adapters/rakuma.adapter.js";
import { SurugayaAdapter } from "./adapters/surugaya.adapter.js";
import { YahooAuctionsAdapter } from "./adapters/yahoo-auctions.adapter.js";
import {
  YahooFleamarketAdapter,
  isYahooFleamarketPlaceholderSellerName,
} from "./adapters/yahoo-fleamarket.adapter.js";
import { YahooShoppingAdapter } from "./adapters/yahoo-shopping.adapter.js";
import {
  classificationQueue,
  connection,
  marketKeywordForRotation,
  statusQueue,
  type MarketKeywordRotation,
} from "./queues.js";
import {
  PRODUCT_AI_RESPONSE_SCHEMAS,
  executeProductAi,
  type ProductAiResponseSchemaReference,
} from "./product-ai.client.js";
import {
  automaticClassificationContentVersion,
  classificationJobId,
  shouldAbortAiJobForItem,
  shouldQueueAutomaticClassification,
} from "./automatic-classification.js";
import {
  automaticPaidAiEnabled,
  runAutomaticAiTask,
} from "./background-ai-guard.js";
import {
  refreshCrossMarketOpportunityForItem,
  refreshReadyCrossMarketOpportunitiesForItem,
  type ArbitrageSearchContext,
} from "./china-market/arbitrage.js";
import { isStatusRefreshEligible } from "./status-refresh-policy.js";
import { recordMonitoringKeywordMatch } from "./monitoring-keywords.js";

export {
  classificationJobId,
  shouldQueueAutomaticClassification,
} from "./automatic-classification.js";

const adapters: Record<string, SourceAdapter> = {
  mock: new MockAdapter(),
  mandarake: new MandarakeAdapter(),
  mercari: new MercariAdapter(),
  yahoo_auctions: new YahooAuctionsAdapter(),
  yahoo_fleamarket: new YahooFleamarketAdapter(),
  yahoo_shopping: new YahooShoppingAdapter(),
  rakuma: new RakumaAdapter(),
  surugaya: new SurugayaAdapter(),
  firecrawl_market: new FirecrawlMarketplaceAdapter(),
  apify_ecommerce: new ApifyEcommerceAdapter(),
  public_page: new PublicPageAdapter(),
  playwright_page: new PlaywrightPageAdapter(),
};

function safeBidCount(value: number | null | undefined) {
  return value != null &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 2_000_000
    ? Math.floor(value)
    : undefined;
}

const marketAvailabilitySelect = {
  id: true,
  updatedAt: true,
  status: true,
  archivedAt: true,
  auctionEndAt: true,
  listingType: true,
  priceCurrent: true,
  shippingFee: true,
  priceTotalEst: true,
  bidCount: true,
} satisfies Prisma.ItemSelect;
type MarketAvailabilitySnapshot = Prisma.ItemGetPayload<{
  select: typeof marketAvailabilitySelect;
}>;
type AuditedMarketUpdate = {
  itemId: string;
  where: Prisma.ItemWhereInput;
  data:
    | Prisma.ItemUpdateManyMutationInput
    | ((
        before: MarketAvailabilitySnapshot,
      ) => Prisma.ItemUpdateManyMutationInput);
  actor: string;
  reason: string;
};

function resolvedMarketSaleMode(
  update: { listingType?: ListingType | null; auctionEndAt?: Date | null },
  current: { listingType: ListingType | null; auctionEndAt: Date | null },
) {
  const auctionEndAt =
    update.listingType === "direct"
      ? null
      : Object.hasOwn(update, "auctionEndAt") &&
          update.auctionEndAt !== undefined
        ? update.auctionEndAt
        : current.auctionEndAt;
  return {
    auctionEndAt,
    listingType: resolveListingType(
      update.listingType,
      auctionEndAt,
      current.listingType,
    ),
  };
}

async function writeMarketUpdateWithAudit(
  tx: Prisma.TransactionClient,
  input: AuditedMarketUpdate,
) {
  const before = await tx.item.findUnique({
    where: { id: input.itemId },
    select: marketAvailabilitySelect,
  });
  if (!before) return { count: 0 };
  const data =
    typeof input.data === "function" ? input.data(before) : input.data;
  const changed = await tx.item.updateMany({
    where: {
      ...input.where,
      id: input.itemId,
      ...(before.updatedAt ? { updatedAt: before.updatedAt } : {}),
    },
    data,
  });
  if (!changed.count) return changed;
  const beforeData: Record<string, Prisma.InputJsonValue | null> = {};
  const afterData: Record<string, Prisma.InputJsonValue | null> = {};
  for (const field of Object.keys(marketAvailabilitySelect)) {
    if (field === "id" || field === "updatedAt") continue;
    const value = data[field as keyof typeof data];
    if (value === undefined) continue;
    const oldValue = before[field as keyof typeof before];
    const oldJson =
      oldValue instanceof Date ? oldValue.toISOString() : (oldValue ?? null);
    const newJson = value instanceof Date ? value.toISOString() : value;
    if (oldJson === newJson) continue;
    if (
      newJson !== null &&
      !["string", "number", "boolean"].includes(typeof newJson)
    )
      throw new Error(`Unsupported availability mutation: ${field}`);
    beforeData[field] = oldJson as Prisma.InputJsonValue | null;
    afterData[field] = newJson as Prisma.InputJsonValue | null;
  }
  if (Object.keys(afterData).length)
    await tx.manualReview.create({
      data: {
        itemId: input.itemId,
        actor: input.actor,
        reason: input.reason,
        beforeData,
        afterData,
      },
    });
  return changed;
}

function updateMarketWithAudit(input: AuditedMarketUpdate) {
  return prisma.$transaction((tx) => writeMarketUpdateWithAudit(tx, input), {
    timeout: 15_000,
  });
}

type SearchTerminalDetail = {
  status: "sold" | "ended";
  priceCurrent: number;
  shippingFee?: number | null;
  listingType?: ListingType | null;
  auctionEndAt?: Date | null;
  bidCount?: number | null;
};

/** Write the terminal state a search pass has already confirmed. */
async function markSearchItemTerminal(
  itemId: string,
  detail: SearchTerminalDetail,
) {
  const checkedAt = new Date();
  await updateMarketWithAudit({
    itemId,
    where: {
      archivedAt: null,
      ignored: false,
      purchaseRecord: null,
      status: { in: ["active", "unknown"] },
    },
    data: (before) => {
      const priceCurrent = Number.isFinite(detail.priceCurrent)
        ? detail.priceCurrent
        : before.priceCurrent;
      return {
        status: detail.status,
        archivedAt: checkedAt,
        lastSeenAt: checkedAt,
        priceCurrent,
        shippingFee: detail.shippingFee,
        priceTotalEst:
          priceCurrent + (detail.shippingFee ?? before.shippingFee ?? 0),
        ...resolvedMarketSaleMode(detail, before),
        bidCount: safeBidCount(detail.bidCount),
      };
    },
    actor: "market-search",
    reason: "search_detail_confirmed_terminal",
  });
}

type SearchMetrics = {
  candidates: number;
  duplicatesDropped: number;
  inserted: number;
  skippedKnown: number;
  imagesBackfilled: number;
  recordsEnriched: number;
  detailFailed: number;
  pageStart: number;
  pages: number;
  scanMode: "incremental" | "backfill";
  errors: string[];
  arbitrageReady: number;
  arbitrageRejected: number;
  arbitrageNeedsFacts: number;
  arbitrageIdentityMisses: number;
  qualityRejected: number;
};

type SearchJobData = {
  adapterKey: string;
  monitoringKeywordId?: string;
  query: SearchQuery;
  keywordRotation?: MarketKeywordRotation;
  arbitrageContext?: ArbitrageSearchContext;
};

const procurementConfig = procurementConfigFromEnv(process.env);

export const AUTOMATIC_CLASSIFICATION_SYSTEM_PROMPT = [
  "你是日本特摄中古商品自动分类器。只依据原始标题、卖家正文、品相和平台事实分类，不做翻译，不得把不知道的内容补成事实。",
  '输出 categoryIp、categoryToyType、manufacturer、conditionGrade、quantity、series、subSeries、bulkSale、needsImageAnalysis；每个字段必须为 {"value":值或null,"confidence":0到1,"evidence":["原文依据"]}。',
  `枚举只能使用 categoryIp=${categoryIps.join("|")}，categoryToyType=${toyTypes.join("|")}，manufacturer=${manufacturers.join("|")}，conditionGrade=${conditionGrades.join("|")}。`,
  'quantity 只有原文明确数量时才给精确正整数；估算必须另给 quantityEstimate {"exact":null,"estimatedRange":{"min":数字,"max":数字},"evidence":["依据"]}，不得把区间写成精确数量。',
  '还要输出 confidence（整体0到1）。书籍、杂志、漫画和卡片用 scope="excluded_card_or_book"。只输出 JSON。',
].join("");

type ProcurementFactsItem = {
  titleRaw: string;
  listingType?: ListingType | null;
  categoryToyType: ToyType;
  conditionGrade: ConditionGrade;
  priceCurrent: number;
  shippingFee: number | null;
  quantityEst: number | null;
  logistics: {
    lengthMm: number | null;
    widthMm: number | null;
    heightMm: number | null;
    volumeCm3: number | null;
    notes?: string | null;
  } | null;
};

/** Keep the rule result and its inputs separate from the model review. */
export function procurementFactsForClassification(item: ProcurementFactsItem) {
  const evidenceLogistics = procurementLogisticsEvidence(item.logistics);
  const logistics = evidenceLogistics
    ? {
        lengthMm: evidenceLogistics.lengthMm,
        widthMm: evidenceLogistics.widthMm,
        heightMm: evidenceLogistics.heightMm,
        volumeCm3: evidenceLogistics.volumeCm3,
      }
    : null;
  const knownFacts = {
    priceCurrentJpy: item.priceCurrent,
    listingType: item.listingType ?? "unknown",
    shippingFeeJpy: item.shippingFee,
    quantityEst: item.quantityEst,
    categoryToyType: item.categoryToyType,
    conditionGrade: item.conditionGrade,
    logistics,
  };
  const procurementLogistics = logistics?.volumeCm3 != null ? logistics : null;
  return {
    knownFacts,
    deterministicAssessment: assessProcurementCandidate(
      {
        titleRaw: item.titleRaw,
        listingType: item.listingType,
        categoryToyType: item.categoryToyType,
        conditionGrade: item.conditionGrade,
        priceCurrent: item.priceCurrent,
        shippingFee: item.shippingFee,
        quantityEst: item.quantityEst,
        logistics: procurementLogistics,
      },
      procurementConfig,
    ),
  };
}

const procurementScopes = [
  "tokusatsu_toy",
  "excluded_card_or_book",
  "unrelated",
  "unknown",
] as const;
const procurementMissingFacts = [
  "price",
  "shipping_fee",
  "listing_type",
  "quantity",
  "volume",
  "condition",
] as const;
const procurementEvidenceFields = [
  "priceCurrentJpy",
  "shippingFeeJpy",
  "quantityEst",
  "categoryToyType",
  "conditionGrade",
  "logistics",
  "scope",
] as const;
const compactnessConservatism = {
  compact: 0,
  likely_compact: 1,
  unknown: 2,
  bulky: 3,
} as const;

function allowedValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
) {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

function allowedStringList<T extends string>(
  value: unknown,
  allowed: readonly T[],
) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (entry): entry is T =>
          typeof entry === "string" && allowed.includes(entry as T),
      ),
    ),
  ];
}

function evidenceStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 12);
}

/** Accept only the review surface. The model may lower confidence, but cannot
 * promote a rule assessment or erase a fact that the rule engine marked
 * missing. */
export function normalizeProcurementAiReview(
  value: Record<string, unknown>,
  deterministic: ProcurementAssessment,
) {
  const requestedCategory = allowedValue(
    value.procurementCategory,
    procurementCategories,
    deterministic.category,
  );
  const procurementCategory =
    procurementCategories.indexOf(requestedCategory) >=
    procurementCategories.indexOf(deterministic.category)
      ? requestedCategory
      : deterministic.category;
  const requestedCompactness = allowedValue(
    value.compactness,
    procurementCompactness,
    deterministic.compactness,
  );
  const compactness =
    compactnessConservatism[requestedCompactness] >=
    compactnessConservatism[deterministic.compactness]
      ? requestedCompactness
      : deterministic.compactness;
  const missingFacts = [
    ...new Set([
      ...deterministic.missingFacts,
      ...allowedStringList(value.missingFacts, procurementMissingFacts),
    ]),
  ];
  const contradictedFacts = Array.isArray(value.contradictedFacts)
    ? value.contradictedFacts.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
          return [];
        const record = entry as Record<string, unknown>;
        const field =
          typeof record.field === "string" &&
          procurementEvidenceFields.includes(
            record.field as (typeof procurementEvidenceFields)[number],
          )
            ? (record.field as (typeof procurementEvidenceFields)[number])
            : undefined;
        const evidence =
          typeof record.evidence === "string" ? record.evidence.trim() : "";
        return field && evidence
          ? [{ field, evidence: evidence.slice(0, 500) }]
          : [];
      })
    : [];
  return {
    scope: allowedValue(value.scope, procurementScopes, "unknown"),
    procurementCategory,
    compactness,
    verifiedFacts: allowedStringList(
      value.verifiedFacts,
      procurementEvidenceFields,
    ),
    contradictedFacts: contradictedFacts.slice(0, 12),
    missingFacts,
    shouldAnalyze:
      typeof value.shouldAnalyze === "boolean" ? value.shouldAnalyze : null,
    confidence: numberConfidence(value.confidence),
    evidence: evidenceStrings(value.evidence),
  };
}

export function shouldAnalyzeProcurementImages(
  imageCount: number,
  procurementReview: Record<string, unknown> | null | undefined,
  fallbackDecision: boolean,
) {
  if (imageCount <= 0) return false;
  return fallbackDecision || procurementReview?.shouldAnalyze === true;
}

/** Only package-scoped logistics evidence is safe for procurement ranking. */
export function procurementLogisticsFromHints(hints: LogisticsHints) {
  const packageDimensions = hints.dimensionBasis === "package";
  const packageVolume =
    hints.volumeBasis === "package" && hints.volumeCm3 != null;
  if (!packageDimensions && !packageVolume) return {};

  return {
    ...(packageDimensions
      ? {
          lengthMm: hints.lengthMm,
          widthMm: hints.widthMm,
          heightMm: hints.heightMm,
        }
      : {}),
    ...(packageVolume ? { volumeCm3: hints.volumeCm3 } : {}),
  };
}

export function logisticsColumnsForPersistence(hints: LogisticsHints) {
  const packageDimensions = hints.dimensionBasis === "package";
  const packageWeight = hints.weightBasis === "package";
  const packageVolume = hints.volumeBasis === "package";
  return {
    weightGrams: packageWeight ? undefined : hints.weightGrams,
    packageWeightGrams: packageWeight ? hints.weightGrams : undefined,
    lengthMm: packageDimensions ? hints.lengthMm : undefined,
    widthMm: packageDimensions ? hints.widthMm : undefined,
    heightMm: packageDimensions ? hints.heightMm : undefined,
    volumeCm3: packageVolume ? hints.volumeCm3 : undefined,
  };
}

function searchProcurementCandidate(result: SearchResult) {
  const raw = result.detailHint;
  const titleRaw = raw?.titleRaw ?? result.titleHint ?? "";
  const classification = classifyText(
    titleRaw,
    raw?.descriptionRaw,
    raw?.conditionRaw,
  );
  const hints = raw ? extractLogisticsHints(raw) : {};
  return {
    titleRaw,
    listingType: resolveListingType(raw?.listingType, raw?.auctionEndAt),
    categoryToyType: classification.categoryToyType,
    conditionGrade: classification.conditionGrade,
    priceCurrent: raw?.priceCurrent ?? Number.NaN,
    shippingFee: raw?.shippingFee,
    quantityEst: classification.quantityEst,
    logistics: procurementLogisticsFromHints(hints),
  };
}

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasFiniteNonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasMeaningfulPublicData(
  value: unknown,
  seen = new Set<object>(),
): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((entry) =>
    hasMeaningfulPublicData(entry, seen),
  );
}

/**
 * Ordered completeness facts. A lower-priority field can break a tie, but it
 * cannot outweigh a reliable price or shipping fact. This keeps malformed or
 * metadata-heavy rows from displacing rows that procurement ranking can use.
 */
function searchResultCompleteness(result: SearchResult): readonly number[] {
  const detail = result.detailHint;
  if (!detail)
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, hasText(result.titleHint) ? 1 : 0];

  const sellerFacts =
    [detail.sellerName, detail.sellerProfileUrl].filter(hasText).length +
    (detail.sellerType === "individual" || detail.sellerType === "store"
      ? 1
      : 0) +
    (hasMeaningfulPublicData(detail.sellerData) ? 1 : 0);
  const timeFacts = [detail.listedAt, detail.auctionEndAt].filter(
    (value) => value instanceof Date && Number.isFinite(value.getTime()),
  ).length;
  const otherFacts =
    (hasText(detail.locationText) ? 1 : 0) +
    (hasFiniteNonNegativeNumber(detail.bidCount) ? 1 : 0);
  const images = Array.isArray(detail.imageUrls)
    ? sanitizeProductImageUrls(
        detail.imageUrls.filter(
          (value): value is string => typeof value === "string",
        ),
      ).length
    : 0;

  return [
    hasFiniteNonNegativeNumber(detail.priceCurrent) ? 1 : 0,
    hasFiniteNonNegativeNumber(detail.shippingFee) ? 1 : 0,
    resolveListingType(detail.listingType, detail.auctionEndAt) !== "unknown"
      ? 1
      : 0,
    [detail.titleRaw, detail.descriptionRaw, detail.conditionRaw].filter(
      hasText,
    ).length,
    images,
    hasMeaningfulPublicData(detail.sourceData) ? 1 : 0,
    sellerFacts,
    timeFacts,
    otherFacts,
    hasText(result.titleHint) ? 1 : 0,
  ];
}

function isMoreCompleteSearchResult(
  candidate: SearchResult,
  existing: SearchResult,
) {
  const candidateFacts = searchResultCompleteness(candidate);
  const existingFacts = searchResultCompleteness(existing);
  for (let index = 0; index < candidateFacts.length; index += 1) {
    const difference = candidateFacts[index]! - existingFacts[index]!;
    if (difference !== 0) return difference > 0;
  }
  return false;
}

/**
 * Marketplace adapters are not trusted to deduplicate or order candidates in
 * the same way. Collapse duplicate IDs centrally, retain the richer row, then
 * spend detail-fetch capacity on the candidates closest to the procurement
 * objective. The original order remains the tie-breaker.
 */
export function prioritizeSearchResults(results: readonly SearchResult[]) {
  const unique = new Map<string, SearchResult>();
  for (const result of results) {
    const existing = unique.get(result.sourceItemId);
    if (!existing || isMoreCompleteSearchResult(result, existing))
      unique.set(result.sourceItemId, result);
  }
  const rows = [...unique.values()].map((result) => ({
    result,
    ...searchProcurementCandidate(result),
  }));
  return rankProcurementCandidates(rows, procurementConfig).map(
    ({ candidate }) => candidate.result,
  );
}

export function sourceBaseUrl(adapterKey: string): string {
  if (adapterKey === "mandarake") return "https://order.mandarake.co.jp";
  if (adapterKey === "mercari") return "https://jp.mercari.com";
  if (adapterKey === "yahoo_auctions") return "https://auctions.yahoo.co.jp";
  if (adapterKey === "yahoo_fleamarket")
    return "https://paypayfleamarket.yahoo.co.jp";
  if (adapterKey === "yahoo_shopping") return "https://shopping.yahoo.co.jp";
  if (adapterKey === "rakuma") return "https://fril.jp";
  if (adapterKey === "surugaya") return "https://www.suruga-ya.jp";
  if (adapterKey === "firecrawl_market") return "https://api.firecrawl.dev";
  if (adapterKey === "apify_ecommerce") return "https://api.apify.com";
  if (adapterKey === "public_page") return "https://public.example";
  if (adapterKey === "playwright_page") return "https://public.example";
  return "https://example.com/mock";
}

async function resolveSearchQuery(
  adapterKey: string,
  query: SearchQuery,
  keywordRotation?: MarketKeywordRotation,
  repeatCount?: number,
) {
  const keyword = marketKeywordForRotation(
    query.keyword,
    keywordRotation,
    repeatCount,
  );
  const keywordQuery =
    keyword === query.keyword ? query : { ...query, keyword };
  if (!keywordQuery.rotatePages) return keywordQuery;
  const pages = Math.max(1, Math.min(keywordQuery.pages ?? 1, 8));
  const maxPages = Math.max(
    pages,
    Number(process.env.MARKET_BACKFILL_MAX_PAGES ?? 80),
  );
  const digest = createHash("sha256")
    .update(`${adapterKey}:${keywordQuery.keyword}`)
    .digest("hex")
    .slice(0, 20);
  const key = `market-backfill-cursor:${digest}`;
  const storedCursor = await connection.get(key);
  const current = Number(storedCursor ?? keywordQuery.pageStart ?? 0);
  const pageStart = Number.isFinite(current) ? current % maxPages : 0;
  await connection.set(key, String((pageStart + pages) % maxPages));
  return { ...keywordQuery, pageStart };
}

async function recordReverseSearchOpportunity(
  itemId: string,
  context: ArbitrageSearchContext | undefined,
  metrics: SearchMetrics,
) {
  if (!context) return;
  const outcome = await refreshCrossMarketOpportunityForItem(
    itemId,
    context.comparisonId,
    context.trigger,
    context.productId,
  );
  if ("skipped" in outcome) metrics.arbitrageIdentityMisses += 1;
  else if (outcome.status === "ready") metrics.arbitrageReady += 1;
  else if (outcome.status === "rejected") metrics.arbitrageRejected += 1;
  else metrics.arbitrageNeedsFacts += 1;
}

export function emptySearchIsFailure(
  scanMode: "incremental" | "backfill",
  arbitrageContext?: ArbitrageSearchContext,
) {
  return scanMode === "incremental" && !arbitrageContext;
}

type CrawlJobHeartbeatUpdate = {
  where: { id: string; status: "running" };
  data: { updatedAt: Date };
};

type CrawlJobHeartbeatOptions = {
  intervalMs?: number;
  store?: {
    updateMany: (update: CrawlJobHeartbeatUpdate) => Promise<unknown>;
  };
};

/**
 * Keep the durable CrawlJob row fresh while a marketplace operation is still
 * alive. Maintenance closes only rows that miss this heartbeat for thirty
 * minutes, and the status predicate prevents a late tick from touching a run
 * that has already reached a terminal state.
 */
export function startCrawlJobHeartbeat(
  crawlJobId: string,
  options: CrawlJobHeartbeatOptions = {},
) {
  const intervalMs = Math.max(1_000, options.intervalMs ?? 60_000);
  const updateMany =
    options.store?.updateMany ??
    ((update: CrawlJobHeartbeatUpdate) => prisma.crawlJob.updateMany(update));
  let stopped = false;
  let pending: Promise<unknown> | undefined;
  const heartbeat = () => {
    if (stopped || pending) return;
    pending = updateMany({
      where: { id: crawlJobId, status: "running" },
      data: { updatedAt: new Date() },
    })
      .catch((error) => {
        console.warn(
          JSON.stringify({
            event: "crawl_job_heartbeat_failed",
            crawlJobId,
            error: String(error).slice(0, 240),
          }),
        );
      })
      .finally(() => {
        pending = undefined;
      });
  };
  const timer = setInterval(heartbeat, intervalMs);
  timer.unref();

  return async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    const inFlight = pending;
    if (inFlight) await inFlight;
  };
}

export async function processSearch(job: Job<SearchJobData>) {
  let monitoringKeyword = job.data.monitoringKeywordId
    ? await prisma.monitoringKeyword.findUnique({
        where: { id: job.data.monitoringKeywordId },
        include: { category: true },
      })
    : null;
  if (job.data.monitoringKeywordId && !monitoringKeyword?.enabled)
    return { skipped: "monitoring_keyword_disabled" as const };
  const searchedKeyword = monitoringKeyword?.normalizedKeyword;
  const refreshMonitoringRule = async () => {
    if (!job.data.monitoringKeywordId) return true;
    const latest = await prisma.monitoringKeyword.findUnique({
      where: { id: job.data.monitoringKeywordId },
      include: { category: true },
    });
    if (!latest?.enabled || latest.normalizedKeyword !== searchedKeyword)
      return false;
    monitoringKeyword = latest;
    return true;
  };
  if (job.data.arbitrageContext && !xianyuReverseSearchEnabled(process.env))
    return {
      skipped: "cross_market_arbitrage_disabled" as const,
      adapter: job.data.adapterKey,
    };
  const adapter = adapters[job.data.adapterKey];
  if (!adapter) throw new Error(`Unknown adapter: ${job.data.adapterKey}`);
  const source = await prisma.source.upsert({
    where: { key: adapter.key },
    update: { displayName: adapter.displayName },
    create: {
      key: adapter.key,
      displayName: adapter.displayName,
      baseUrl: sourceBaseUrl(adapter.key),
      rateLimitMs: [
        "mandarake",
        "mercari",
        "yahoo_auctions",
        "yahoo_fleamarket",
        "yahoo_shopping",
        "rakuma",
        "surugaya",
        "firecrawl_market",
        "apify_ecommerce",
        "public_page",
        "playwright_page",
      ].includes(adapter.key)
        ? 3000
        : 0,
    },
  });
  const circuitRetryAt = openCircuitRetryAt(source.circuitOpenAt);
  if (
    monitoringKeyword &&
    (!source.enabled ||
      (monitoringKeyword.sourceKeys.length &&
        !monitoringKeyword.sourceKeys.includes(adapter.key)))
  )
    return { skipped: "monitoring_platform_disabled" as const };
  if (circuitRetryAt) {
    const skipped = {
      skipped: "circuit_open" as const,
      adapter: adapter.key,
      retryAt: circuitRetryAt.toISOString(),
    };
    console.log(JSON.stringify({ event: "search_skipped", ...skipped }));
    return skipped;
  }

  const effectiveQuery = await resolveSearchQuery(
    job.data.adapterKey,
    monitoringKeyword
      ? { ...job.data.query, keyword: monitoringKeyword.keyword }
      : job.data.query,
    job.data.keywordRotation,
    job.opts.repeat?.count,
  );
  const metrics: SearchMetrics = {
    candidates: 0,
    duplicatesDropped: 0,
    inserted: 0,
    skippedKnown: 0,
    imagesBackfilled: 0,
    recordsEnriched: 0,
    detailFailed: 0,
    pageStart: effectiveQuery.pageStart ?? 0,
    pages: effectiveQuery.pages ?? 1,
    scanMode: effectiveQuery.scanMode ?? "incremental",
    errors: [],
    arbitrageReady: 0,
    arbitrageRejected: 0,
    arbitrageNeedsFacts: 0,
    arbitrageIdentityMisses: 0,
    qualityRejected: 0,
  };
  const crawlJob = await prisma.crawlJob.create({
    data: {
      sourceId: source.id,
      queueJobId: String(job.id),
      jobType: "search",
      query: {
        ...effectiveQuery,
        ...(monitoringKeyword
          ? { monitoringKeywordId: monitoringKeyword.id }
          : {}),
        ...(job.data.arbitrageContext
          ? { arbitrageContext: job.data.arbitrageContext }
          : {}),
      } as unknown as Prisma.InputJsonValue,
      status: "running",
      startedAt: new Date(),
      attempt: job.attemptsMade + 1,
    },
  });
  const stopHeartbeat = startCrawlJobHeartbeat(crawlJob.id);
  try {
    const rawResults = await adapter.search(effectiveQuery);
    const results = prioritizeSearchResults(rawResults);
    metrics.candidates = results.length;
    metrics.duplicatesDropped = rawResults.length - results.length;
    if (
      results.length === 0 &&
      emptySearchIsFailure(metrics.scanMode, job.data.arbitrageContext)
    ) {
      throw new Error(
        `${adapter.displayName} incremental search returned zero candidates`,
      );
    }
    const existing = await prisma.item.findMany({
      where: {
        sourceId: source.id,
        sourceItemId: { in: results.map((result) => result.sourceItemId) },
      },
      select: {
        id: true,
        sourceItemId: true,
        status: true,
        archivedAt: true,
        ignored: true,
        purchaseRecord: { select: { id: true } },
        imageCount: true,
        sourceData: true,
        descriptionRaw: true,
        shippingFee: true,
        sellerId: true,
        monitoringCategory: { select: { scope: true } },
        seller: {
          select: {
            name: true,
            sourceSellerId: true,
            profileUrl: true,
            sourceData: true,
          },
        },
      },
    });
    const existingBySourceId = new Map(
      existing.map((item) => [item.sourceItemId, item]),
    );
    const existingIds = new Set(existingBySourceId.keys());
    metrics.skippedKnown = existingIds.size;
    if (existingIds.size > 0) {
      const confirmedActiveIds = results
        .filter((result) => result.detailHint?.status === "active")
        .map((result) => result.sourceItemId)
        .filter((sourceItemId) => existingIds.has(sourceItemId));
      if (confirmedActiveIds.length > 0) {
        // A marketplace search constrained to on-sale inventory is stronger
        // evidence than a stale page-shell status. Re-open only ordinary
        // listings; ignored and purchased records stay in their own areas.
        for (const sourceItemId of confirmedActiveIds) {
          const known = existingBySourceId.get(sourceItemId)!;
          if (known.status !== "unknown") continue;
          await updateMarketWithAudit({
            itemId: known.id,
            where: {
              archivedAt: null,
              status: "unknown",
              ignored: false,
              purchaseRecord: null,
            },
            data: { status: "active" },
            actor: "market-search",
            reason: "search_confirmed_active",
          });
        }
      }
    }
    let enrichmentBudget = job.data.arbitrageContext
      ? Math.min(effectiveQuery.limit ?? 30, 50)
      : 16;
    for (const result of results) {
      if (!(await refreshMonitoringRule())) break;
      const known = existingBySourceId.get(result.sourceItemId);
      if (known) {
        if (monitoringKeyword)
          await recordMonitoringKeywordMatch(
            known.id,
            monitoringKeyword.id,
            searchedKeyword,
          );
        if (
          known.archivedAt ||
          known.ignored ||
          known.purchaseRecord ||
          !isStatusRefreshEligible(known.status)
        )
          continue;
        // Some search responses already carry a sold/ended signal for a
        // stored listing. Act on it here instead of spending a detail
        // fetch on a listing that only needs its terminal state written.
        const hintedStatus = result.detailHint?.status;
        if (hintedStatus === "sold" || hintedStatus === "ended") {
          await markSearchItemTerminal(known.id, {
            ...result.detailHint!,
            status: hintedStatus,
          });
          continue;
        }
        const needsEnrichment =
          Boolean(job.data.arbitrageContext) ||
          known.imageCount <= 1 ||
          known.sourceData == null ||
          known.descriptionRaw == null ||
          known.shippingFee == null ||
          known.sellerId == null ||
          needsCompleteEnrichment(
            {
              sourceData: known.sourceData,
              descriptionRaw: known.descriptionRaw,
              sellerId: known.sellerId,
              seller: known.seller,
            },
            adapter.key,
          );
        let hasFreshReverseEvidence = !job.data.arbitrageContext;
        if (needsEnrichment && enrichmentBudget > 0) {
          enrichmentBudget -= 1;
          try {
            const raw = await adapter.fetchDetail(result);
            const normalized = await adapter.normalize(raw);
            if (!(await refreshMonitoringRule())) break;
            if (normalized.status === "sold" || normalized.status === "ended") {
              await markSearchItemTerminal(known.id, {
                ...normalized,
                status: normalized.status,
              });
              continue;
            }
            const scope =
              monitoringKeyword?.category.scope ??
              known.monitoringCategory?.scope;
            const quality = assessInventoryQuality(normalized, {
              scope: scope === "general" ? "general" : "toys",
            });
            if (!quality.eligible) {
              const archivedAt = new Date();
              const archived = await updateMarketWithAudit({
                itemId: known.id,
                where: {
                  archivedAt: null,
                  ignored: false,
                  favorite: false,
                  purchaseRecord: null,
                  cartItems: { none: {} },
                  negotiationCase: { is: null },
                },
                data: { archivedAt, lastSeenAt: archivedAt },
                actor: "inventory-quality-gate",
                reason: quality.reason ?? "quality_gate_rejected",
              });
              if (archived.count) {
                metrics.qualityRejected += 1;
                await prisma.itemImage.deleteMany({
                  where: {
                    itemId: known.id,
                    item: { collaborationMessages: { none: {} } },
                  },
                });
              }
              hasFreshReverseEvidence = true;
            } else {
              const added = await enrichKnownItem(
                source.id,
                known.id,
                normalized,
              );
              if (added > 0) metrics.imagesBackfilled += added;
              metrics.recordsEnriched += 1;
              hasFreshReverseEvidence = true;
            }
          } catch (error) {
            if (job.data.arbitrageContext) metrics.detailFailed += 1;
            if (metrics.errors.length < 8)
              metrics.errors.push(
                `${result.sourceItemId}: image backfill ${String(error).slice(0, 260)}`,
              );
          }
        }
        if (hasFreshReverseEvidence)
          await recordReverseSearchOpportunity(
            known.id,
            job.data.arbitrageContext,
            metrics,
          );
        continue;
      }
      try {
        const raw = await adapter.fetchDetail(result);
        const normalized = await adapter.normalize(raw);
        if (!(await refreshMonitoringRule())) break;
        const quality = assessInventoryQuality(normalized, {
          scope:
            monitoringKeyword?.category.scope === "general"
              ? "general"
              : "toys",
        });
        if (!quality.eligible || isExcludedNormalizedItem(normalized)) {
          metrics.qualityRejected += 1;
          continue;
        }
        const saved = await persistNormalized(
          source.id,
          normalized,
          false,
          "search",
          monitoringKeyword
            ? {
                id: monitoringKeyword.categoryId,
                scope: monitoringKeyword.category.scope,
              }
            : undefined,
        );
        if (monitoringKeyword)
          await recordMonitoringKeywordMatch(
            saved.id,
            monitoringKeyword.id,
            searchedKeyword,
          );
        await recordReverseSearchOpportunity(
          saved.id,
          job.data.arbitrageContext,
          metrics,
        );
        metrics.inserted += 1;
      } catch (error) {
        metrics.detailFailed += 1;
        if (metrics.errors.length < 8)
          metrics.errors.push(
            `${result.sourceItemId}: ${String(error).slice(0, 300)}`,
          );
      }
    }
    if (
      results.length > 0 &&
      metrics.inserted === 0 &&
      metrics.skippedKnown === 0 &&
      metrics.detailFailed > 0
    ) {
      throw new Error(
        `${adapter.displayName} found candidates but every detail failed`,
      );
    }
    const arbitrageEvaluated =
      metrics.arbitrageReady +
      metrics.arbitrageRejected +
      metrics.arbitrageNeedsFacts +
      metrics.arbitrageIdentityMisses;
    if (
      job.data.arbitrageContext &&
      results.length > 0 &&
      arbitrageEvaluated === 0 &&
      metrics.detailFailed > 0
    )
      throw new Error(
        `${adapter.displayName} reverse search found candidates but no detail could be evaluated`,
      );
    await prisma.$transaction([
      prisma.crawlJob.update({
        where: { id: crawlJob.id },
        data: {
          status: "succeeded",
          finishedAt: new Date(),
          metrics: metrics as unknown as Prisma.InputJsonValue,
          errorText:
            metrics.detailFailed > 0
              ? `${metrics.detailFailed} detail fetches failed; see metrics`
              : null,
        },
      }),
      prisma.source.update({
        where: { id: source.id },
        data: { failureCount: 0, circuitOpenAt: null },
      }),
    ]);
    console.log(
      JSON.stringify({
        event: "search_completed",
        adapter: adapter.key,
        keyword: effectiveQuery.keyword,
        ...metrics,
      }),
    );
    return metrics;
  } catch (error) {
    const failureCount = source.failureCount + 1;
    await prisma.$transaction([
      prisma.crawlJob.update({
        where: { id: crawlJob.id },
        data: {
          status: "failed",
          errorText: String(error),
          metrics: metrics as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      }),
      prisma.source.update({
        where: { id: source.id },
        data: {
          failureCount,
          circuitOpenAt: failureCount >= 5 ? new Date() : null,
        },
      }),
    ]);
    console.error(
      JSON.stringify({
        event: "search_failed",
        adapter: adapter.key,
        keyword: effectiveQuery.keyword,
        error: String(error),
        ...metrics,
      }),
    );
    throw error;
  } finally {
    await stopHeartbeat();
  }
}

export function openCircuitRetryAt(
  circuitOpenAt: Date | null | undefined,
  now = Date.now(),
) {
  if (!circuitOpenAt) return null;
  const retryAt = circuitOpenAt.getTime() + 15 * 60 * 1000;
  return retryAt > now ? new Date(retryAt) : null;
}

async function appendItemImages(itemId: string, imageUrls: string[]) {
  const urls = sanitizeProductImageUrls(imageUrls);
  if (urls.length === 0) return 0;
  await prisma.itemImage.createMany({
    data: urls.map((url, position) => ({ itemId, url, position })),
    skipDuplicates: true,
  });
  const imageCount = await prisma.itemImage.count({ where: { itemId } });
  await prisma.item.update({ where: { id: itemId }, data: { imageCount } });
  return urls.length;
}

/**
 * Restore galleries for historical rows written before ItemImage persistence
 * was enabled.  The raw public payload is retained for exactly this kind of
 * repair; archived non-purchase rows are intentionally left compact.
 */
export async function backfillMissingItemImages() {
  let cursor: string | undefined;
  let recovered = 0;
  let correctedEmpty = 0;
  for (;;) {
    const candidates = await prisma.item.findMany({
      where: {
        images: { none: {} },
        OR: [{ archivedAt: null }, { purchaseRecord: { isNot: null } }],
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, imageCount: true, sourceData: true },
      orderBy: { id: "asc" },
      take: 500,
    });
    if (!candidates.length) break;
    cursor = candidates.at(-1)?.id;
    for (const candidate of candidates) {
      const urls = extractProductImageUrls(candidate.sourceData);
      if (urls.length > 0) {
        await prisma.itemImage.createMany({
          data: urls.map((url, position) => ({
            itemId: candidate.id,
            url,
            position,
          })),
          skipDuplicates: true,
        });
        await prisma.item.update({
          where: { id: candidate.id },
          data: { imageCount: urls.length },
        });
        recovered += urls.length;
      } else if (candidate.imageCount !== 0) {
        await prisma.item.update({
          where: { id: candidate.id },
          data: { imageCount: 0 },
        });
        correctedEmpty += 1;
      }
    }
  }
  return { recovered, correctedEmpty };
}

/** Fill a missing Mercari public profile link from the source API's sellerId. */
export async function backfillExplicitMercariProfileUrls() {
  const candidates = await prisma.item.findMany({
    where: {
      source: { key: "mercari" },
      seller: {
        name: { startsWith: "Mercari 卖家" },
        OR: [{ profileUrl: null }, { profileUrl: "" }],
      },
      sourceData: { not: Prisma.JsonNull },
    },
    select: { id: true, sellerId: true, sourceData: true },
    take: 5000,
  });
  let updated = 0;
  const processedSellerIds = new Set<string>();
  for (const candidate of candidates) {
    const data =
      candidate.sourceData && typeof candidate.sourceData === "object"
        ? (candidate.sourceData as Record<string, unknown>)
        : undefined;
    const sellerId =
      typeof data?.sellerId === "string" && /^\d+$/.test(data.sellerId)
        ? data.sellerId
        : undefined;
    if (
      !sellerId ||
      !candidate.sellerId ||
      processedSellerIds.has(candidate.sellerId)
    )
      continue;
    processedSellerIds.add(candidate.sellerId);
    const profileUrl = `https://jp.mercari.com/user/profile/${sellerId}`;
    await prisma.$transaction([
      prisma.seller.updateMany({
        where: {
          id: candidate.sellerId,
          OR: [{ profileUrl: null }, { profileUrl: "" }],
        },
        data: {
          profileUrl,
          sourceData: {
            ...(typeof data === "object" && data ? data : {}),
            sellerProfileUrl: profileUrl,
            sellerId,
          } as Prisma.InputJsonValue,
        },
      }),
      prisma.item.update({
        where: { id: candidate.id },
        data: {
          sourceData: {
            ...(typeof data === "object" && data ? data : {}),
            sellerProfileUrl: profileUrl,
            sellerId,
          } as Prisma.InputJsonValue,
        },
      }),
    ]);
    updated += 1;
  }
  return updated;
}

/**
 * Keep the marketplace's public seller payload alongside the normalized
 * seller row.  Every adapter is allowed to expose a different shape, so we
 * deliberately retain the raw object instead of dropping fields that do not
 * fit our shared columns.  Credentials, cookies and private account fields
 * are never collected by the adapters.
 */
export function sellerMetadata(item: NormalizedItem) {
  const sourceData = item.sellerData ?? item.sourceData;
  if (!sourceData || typeof sourceData !== "object") {
    return {
      sourceData: undefined,
      profileUrl: item.sellerProfileUrl,
      sourceSellerId: undefined,
    };
  }
  const value = sourceData as Record<string, unknown>;
  const nestedSeller =
    value.seller && typeof value.seller === "object"
      ? (value.seller as Record<string, unknown>)
      : undefined;
  const profileUrl = [
    item.sellerProfileUrl,
    value.sellerProfileUrl,
    value.sellerUrl,
    value.profileUrl,
  ].find(
    (candidate): candidate is string =>
      typeof candidate === "string" && /^https?:\/\//i.test(candidate),
  );
  const sourceSellerId =
    item.sourcePlatform === "mercari"
      ? [value.sellerId, nestedSeller?.id, nestedSeller?.sellerId]
          .map((candidate) =>
            typeof candidate === "string" || typeof candidate === "number"
              ? String(candidate).trim()
              : "",
          )
          .find(Boolean)
      : item.sourcePlatform === "yahoo_fleamarket"
        ? [value.sellerId, nestedSeller?.id, nestedSeller?.sellerId]
            .map((candidate) =>
              typeof candidate === "string" || typeof candidate === "number"
                ? String(candidate).trim()
                : "",
            )
            .find(Boolean)
        : item.sourcePlatform === "yahoo_auctions"
          ? [value.aucUserId, nestedSeller?.aucUserId, value.sellerId]
              .map((candidate) =>
                typeof candidate === "string" || typeof candidate === "number"
                  ? String(candidate).trim()
                  : "",
              )
              .find(Boolean)
          : undefined;
  return {
    sourceData: sourceData as Prisma.InputJsonValue,
    profileUrl,
    sourceSellerId,
  };
}

async function upsertPublicSeller(sourceId: string, item: NormalizedItem) {
  const name = item.sellerName?.trim();
  if (
    !name ||
    (item.sourcePlatform === "yahoo_fleamarket" &&
      isYahooFleamarketPlaceholderSellerName(name))
  )
    return null;
  const metadata = sellerMetadata(item);
  const data = {
    name,
    sellerType: item.sellerType ?? "unknown",
    locationText: item.locationText,
    sourceData: metadata.sourceData,
    profileUrl: metadata.profileUrl,
  } as const;
  if (metadata.sourceSellerId) {
    return prisma.seller.upsert({
      where: {
        sourceId_sourceSellerId: {
          sourceId,
          sourceSellerId: metadata.sourceSellerId,
        },
      },
      update: data,
      create: {
        sourceId,
        sourceSellerId: metadata.sourceSellerId,
        ...data,
      },
    });
  }

  const existing = await prisma.seller.findFirst({
    where: { sourceId, name, sourceSellerId: null },
  });
  if (existing)
    return prisma.seller.update({ where: { id: existing.id }, data });
  try {
    return await prisma.seller.create({
      data: { sourceId, sourceSellerId: null, ...data },
    });
  } catch (error) {
    if ((error as { code?: unknown }).code !== "P2002") throw error;
    const raced = await prisma.seller.findFirst({
      where: { sourceId, name, sourceSellerId: null },
    });
    if (!raced) throw error;
    return prisma.seller.update({ where: { id: raced.id }, data });
  }
}

export function sellerIdForWrite(seller?: { id: string } | null) {
  return seller?.id;
}

export function resetItemTranslation() {
  return {
    titleZh: null,
    descriptionZh: null,
    conditionZh: null,
    shippingZh: null,
    detailsZh: Prisma.DbNull,
    translationStatus: "pending",
    translatedAt: null,
  } as const;
}

async function enrichKnownItem(
  sourceId: string,
  itemId: string,
  item: NormalizedItem,
) {
  const seller = await upsertPublicSeller(sourceId, item);
  const shf = classifyShfListing(item);
  const collectibleSeries = classifyCollectibleSeries(item);
  const changed = await updateMarketWithAudit({
    itemId,
    where: {
      archivedAt: null,
      ignored: false,
      purchaseRecord: null,
      status: { in: ["active", "unknown"] },
    },
    actor: "market-detail",
    reason: "public_detail_enriched",
    data: (before) => ({
      sourceUrl: item.sourceUrl,
      titleRaw: item.titleRaw,
      descriptionRaw: item.descriptionRaw,
      sellerId: sellerIdForWrite(seller),
      locationText: item.locationText,
      priceCurrent: item.priceCurrent,
      shippingFee: item.shippingFee,
      priceTotalEst: item.priceTotalEst,
      listedAt: item.listedAt,
      ...(item.status !== "unknown" ? { lastSeenAt: new Date() } : {}),
      ...resolvedMarketSaleMode(item, before),
      bidCount: safeBidCount(item.bidCount),
      conditionRaw: item.conditionRaw,
      categoryIp: item.categoryIp,
      categoryToyType: item.categoryToyType,
      shfLine: shf?.line ?? null,
      shfReleaseChannel: shf?.releaseChannel ?? null,
      shfEdition: shf?.edition ?? null,
      shfRegion: shf?.region ?? null,
      collectibleSeries,
      manufacturer: item.manufacturer,
      conditionGrade: item.conditionGrade,
      channel: item.channel,
      quantityEst: item.quantityEst,
      unitCostEst: item.unitCostEst,
      confidence: item.confidence,
      needsReview: item.needsReview,
      status: item.status,
      ...(item.status === "sold" || item.status === "ended"
        ? { archivedAt: new Date() }
        : {}),
      sourceData: item.sourceData as Prisma.InputJsonValue | undefined,
      ...resetItemTranslation(),
    }),
  });
  if (!changed.count) return 0;
  await persistLogisticsHints(itemId, item);
  const appended = await appendItemImages(itemId, item.imageUrls);
  await refreshReadyCrossMarketOpportunitiesForItem(itemId);
  return appended;
}

/** Persist dimensions/weight discovered in public structured data without
 * overwriting operator-entered logistics values. */
async function persistLogisticsHints(itemId: string, item: NormalizedItem) {
  const hints = extractLogisticsHints(item);
  const values = logisticsColumnsForPersistence(hints);
  if (!Object.values(values).some((value) => value != null)) return;
  const existing = await prisma.itemLogistics.findUnique({ where: { itemId } });
  const dimensions = [values.lengthMm, values.widthMm, values.heightMm];
  const volumeCm3 =
    values.volumeCm3 ??
    (dimensions.every((value) => value != null)
      ? Math.round((dimensions[0]! * dimensions[1]! * dimensions[2]!) / 1000)
      : undefined);
  await prisma.itemLogistics.upsert({
    where: { itemId },
    create: { itemId, ...values, volumeCm3 },
    update: {
      weightGrams: existing?.weightGrams ?? values.weightGrams,
      packageWeightGrams:
        existing?.packageWeightGrams ?? values.packageWeightGrams,
      lengthMm: existing?.lengthMm ?? values.lengthMm,
      widthMm: existing?.widthMm ?? values.widthMm,
      heightMm: existing?.heightMm ?? values.heightMm,
      volumeCm3: existing?.volumeCm3 ?? volumeCm3,
    },
  });
}

export async function processUrlAnalysis(
  job: Job<{
    adapterKey: string;
    sourceUrl: string;
    importId?: string;
    importOrigin?: "url" | "purchase";
  }>,
) {
  let adapter = adapters[job.data.adapterKey];
  if (!adapter) throw new Error(`Unknown adapter: ${job.data.adapterKey}`);
  const source = await prisma.source.upsert({
    where: { key: adapter.key },
    update: { displayName: adapter.displayName },
    create: {
      key: adapter.key,
      displayName: adapter.displayName,
      baseUrl: sourceBaseUrl(adapter.key),
      rateLimitMs: [
        "mandarake",
        "mercari",
        "yahoo_auctions",
        "yahoo_fleamarket",
        "yahoo_shopping",
        "rakuma",
        "surugaya",
        "firecrawl_market",
        "apify_ecommerce",
        "public_page",
        "playwright_page",
      ].includes(adapter.key)
        ? 3000
        : 0,
    },
  });
  const sourceItemId =
    new URL(job.data.sourceUrl).searchParams.get("itemCode") ??
    new URL(job.data.sourceUrl).pathname.split("/").filter(Boolean).at(-1) ??
    job.data.sourceUrl;
  const crawlJob = await prisma.crawlJob.create({
    data: {
      sourceId: source.id,
      queueJobId: String(job.id),
      jobType: "url_analysis",
      query: { sourceUrl: job.data.sourceUrl } as Prisma.InputJsonValue,
      status: "running",
      startedAt: new Date(),
      attempt: job.attemptsMade + 1,
    },
  });
  const stopHeartbeat = startCrawlJobHeartbeat(crawlJob.id);
  if (job.data.importId) {
    await prisma.urlImport.update({
      where: { id: job.data.importId },
      data: {
        status: "running",
        progress: 10,
        currentStep: "正在读取公开商品页",
        errorText: null,
        finishedAt: null,
        startedAt: new Date(),
      },
    });
  }
  try {
    let raw;
    try {
      raw = await adapter.fetchDetail({
        sourceItemId,
        sourceUrl: job.data.sourceUrl,
      });
    } catch (error) {
      const playwrightConfigured = Boolean(
        process.env.PLAYWRIGHT_WS_ENDPOINT ||
          process.env.PLAYWRIGHT_EXECUTABLE_PATH,
      );
      if (adapter.key !== "public_page" || !playwrightConfigured) throw error;
      adapter = adapters.playwright_page;
      if (job.data.importId)
        await prisma.urlImport.update({
          where: { id: job.data.importId },
          data: {
            progress: 35,
            currentStep: "普通读取失败，正在使用动态浏览器渲染",
          },
        });
      raw = await adapter.fetchDetail({
        sourceItemId,
        sourceUrl: job.data.sourceUrl,
      });
    }
    const normalized = await adapter.normalize(raw);
    if (isExcludedNormalizedItem(normalized))
      throw new Error("已过滤书籍或卡片类商品");
    if (job.data.importId)
      await prisma.urlImport.update({
        where: { id: job.data.importId },
        data: { progress: 75, currentStep: "商品已解析，正在写入链接专区" },
      });
    const saved = await persistNormalized(
      source.id,
      normalized,
      false,
      job.data.importOrigin ?? "url",
    );
    if (job.data.importOrigin === "purchase") {
      // Purchase-link analysis is a staging flow.  Keep the parsed listing
      // addressable from the BullMQ result, but do not leak it into the live
      // catalogue before the operator confirms the purchase and price.
      await prisma.item.update({
        where: { id: saved.id },
        data: { archivedAt: new Date() },
      });
    }
    await prisma.crawlJob.update({
      where: { id: crawlJob.id },
      data: { status: "succeeded", finishedAt: new Date() },
    });
    if (job.data.importId)
      await prisma.urlImport.update({
        where: { id: job.data.importId },
        data: {
          status: "succeeded",
          progress: 100,
          currentStep: "已完成",
          errorText: null,
          finishedAt: new Date(),
          itemId: saved.id,
        },
      });
    return { itemId: saved.id, title: saved.titleRaw, favorited: false };
  } catch (error) {
    await prisma.crawlJob.update({
      where: { id: crawlJob.id },
      data: {
        status: "failed",
        errorText: String(error),
        finishedAt: new Date(),
      },
    });
    if (job.data.importId)
      await prisma.urlImport.update({
        where: { id: job.data.importId },
        data: {
          status: "failed",
          progress: 100,
          currentStep: "分析失败",
          errorText: String(error).slice(0, 1000),
          finishedAt: new Date(),
        },
      });
    throw error;
  } finally {
    await stopHeartbeat();
  }
}

type EnrichmentCandidate = {
  sourceData?: unknown;
  descriptionRaw?: string | null;
  sellerId?: string | null;
  seller?: {
    name: string;
    sourceSellerId?: string | null;
    profileUrl?: string | null;
    sourceData?: unknown;
  } | null;
};

/**
 * Historical Yahoo listings may be assigned a provisional seller derived from
 * the public image path while the public profile is being recovered. Treat
 * those rows exactly like the legacy generic seller so the next detail crawl
 * can replace the placeholder with the real public seller payload.
 */
export function needsCompleteEnrichment(
  current: EnrichmentCandidate,
  adapterKey: string,
) {
  const sellerData = current.seller?.sourceData;
  const provisionalSeller =
    adapterKey === "yahoo_auctions" &&
    (current.seller?.name.includes("（公开资料回补中）") ||
      (sellerData != null &&
        typeof sellerData === "object" &&
        (sellerData as Record<string, unknown>).provisional === true));
  const genericMarketplaceSeller =
    (adapterKey === "mercari" &&
      !current.seller?.sourceSellerId &&
      !!current.seller?.name.match(/^Mercari 卖家(?: \d+)?$/)) ||
    (adapterKey === "yahoo_fleamarket" &&
      isYahooFleamarketPlaceholderSellerName(current.seller?.name)) ||
    (adapterKey === "rakuma" && current.seller?.name === "ラクマ出品者");
  return (
    current.sourceData == null ||
    current.descriptionRaw == null ||
    current.sellerId == null ||
    (adapterKey === "yahoo_auctions" &&
      (current.seller?.name === "Yahoo!オークション出品者" ||
        provisionalSeller)) ||
    genericMarketplaceSeller
  );
}

export function pickExactMercariBackfillResult(
  sourceItemId: string,
  results: SearchResult[],
) {
  return results.find((result) => result.sourceItemId === sourceItemId);
}

async function persistNormalized(
  sourceId: string,
  item: NormalizedItem,
  favorite = false,
  importOrigin: "search" | "url" | "purchase" = "search",
  monitoringCategory?: { id: string; scope: string },
) {
  const imageUrls = sanitizeProductImageUrls(item.imageUrls);
  const seller = await upsertPublicSeller(sourceId, item);
  const shf = classifyShfListing(item);
  const collectibleSeries = classifyCollectibleSeries(item);

  const saved = await prisma.item.upsert({
    where: {
      sourceId_sourceItemId: { sourceId, sourceItemId: item.sourceItemId },
    },
    update: {
      sourceUrl: item.sourceUrl,
      titleRaw: item.titleRaw,
      descriptionRaw: item.descriptionRaw,
      sellerId: sellerIdForWrite(seller),
      locationText: item.locationText,
      priceCurrent: item.priceCurrent,
      shippingFee: item.shippingFee,
      priceTotalEst: item.priceTotalEst,
      listedAt: item.listedAt,
      lastSeenAt: new Date(),
      auctionEndAt: item.auctionEndAt,
      listingType: resolveListingType(item.listingType, item.auctionEndAt),
      bidCount: safeBidCount(item.bidCount),
      conditionRaw: item.conditionRaw,
      categoryIp: item.categoryIp,
      categoryToyType: item.categoryToyType,
      shfLine: shf?.line ?? null,
      shfReleaseChannel: shf?.releaseChannel ?? null,
      shfEdition: shf?.edition ?? null,
      shfRegion: shf?.region ?? null,
      collectibleSeries,
      manufacturer: item.manufacturer,
      conditionGrade: item.conditionGrade,
      channel: item.channel,
      quantityEst: item.quantityEst,
      imageCount: imageUrls.length,
      unitCostEst: item.unitCostEst,
      confidence: item.confidence,
      needsReview: item.needsReview,
      status: item.status,
      sourceData: item.sourceData as Prisma.InputJsonValue | undefined,
      importOrigin,
      ...resetItemTranslation(),
      ...(favorite ? { favorite: true, ignored: false } : {}),
    },
    create: {
      sourceId,
      ...(monitoringCategory
        ? { monitoringCategoryId: monitoringCategory.id }
        : {}),
      sourceItemId: item.sourceItemId,
      sourceUrl: item.sourceUrl,
      titleRaw: item.titleRaw,
      descriptionRaw: item.descriptionRaw,
      sellerId: sellerIdForWrite(seller),
      locationText: item.locationText,
      priceCurrent: item.priceCurrent,
      shippingFee: item.shippingFee,
      priceTotalEst: item.priceTotalEst,
      listedAt: item.listedAt,
      detectedAt: new Date(),
      lastSeenAt: new Date(),
      auctionEndAt: item.auctionEndAt,
      listingType: resolveListingType(item.listingType, item.auctionEndAt),
      bidCount: safeBidCount(item.bidCount),
      conditionRaw: item.conditionRaw,
      categoryIp: item.categoryIp,
      categoryToyType: item.categoryToyType,
      shfLine: shf?.line ?? null,
      shfReleaseChannel: shf?.releaseChannel ?? null,
      shfEdition: shf?.edition ?? null,
      shfRegion: shf?.region ?? null,
      collectibleSeries,
      manufacturer: item.manufacturer,
      conditionGrade: item.conditionGrade,
      channel: item.channel,
      quantityEst: item.quantityEst,
      imageCount: imageUrls.length,
      unitCostEst: item.unitCostEst,
      confidence: item.confidence,
      needsReview: item.needsReview,
      status: item.status,
      sourceData: item.sourceData as Prisma.InputJsonValue | undefined,
      favorite,
      importOrigin,
    },
  });
  await persistLogisticsHints(saved.id, item);
  await prisma.itemImage.createMany({
    data: imageUrls.map((url, position) => ({
      itemId: saved.id,
      url,
      position,
    })),
    skipDuplicates: true,
  });
  const latest = await prisma.itemPriceHistory.findFirst({
    where: { itemId: saved.id },
    orderBy: { observedAt: "desc" },
  });
  if (
    !latest ||
    latest.priceCurrent !== item.priceCurrent ||
    latest.shippingFee !== item.shippingFee ||
    latest.bidCount !== safeBidCount(item.bidCount)
  ) {
    await prisma.itemPriceHistory.create({
      data: {
        itemId: saved.id,
        priceCurrent: item.priceCurrent,
        shippingFee: item.shippingFee,
        bidCount: safeBidCount(item.bidCount),
      },
    });
  }
  await prisma.itemClassification.create({
    data: {
      itemId: saved.id,
      classifierType: "text_rule",
      modelVersion: "rules-v1",
      confidence: item.confidence,
      conflict: item.needsReview,
      result: item as unknown as Prisma.InputJsonValue,
    },
  });
  await matchOrCreateProduct(saved.id);
  await refreshReadyCrossMarketOpportunitiesForItem(saved.id);
  // Purchase imports queue the same automatic classification as ordinary
  // imports (still gated by automaticPaidAiEnabled above), so quantityEst
  // and the title structure are settled before the operator confirms the
  // price instead of staying at the rules-only estimate.
  if (
    automaticPaidAiEnabled() &&
    monitoringCategory?.scope !== "general" &&
    (saved.status === "active" || saved.status === "unknown") &&
    !saved.ignored &&
    (!saved.archivedAt || importOrigin === "purchase") &&
    imageUrls.length > 0 &&
    shouldQueueAutomaticClassification({ ...item, imageUrls })
  ) {
    const version = automaticClassificationContentVersion({
      ...item,
      imageUrls,
    });
    await classificationQueue.add(
      "classify-images",
      { itemId: saved.id, version },
      {
        jobId: classificationJobId(saved.id, version),
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }
  await scheduleStatus(
    saved.id,
    saved.sourceItemId,
    saved.sourceUrl,
    saved.status,
    saved.auctionEndAt,
    item.sourcePlatform,
  );
  return saved;
}

/**
 * BullMQ treats the job id as the de-duplication key while a job is waiting
 * or delayed. Keep it stable for the item so a status refresh can never
 * enqueue another copy of the same listing when a search/detail pass touches
 * it again.
 */
export function statusJobId(itemId: string) {
  return `status-${itemId}`;
}

export async function scheduleStatus(
  itemId: string,
  sourceItemId: string,
  sourceUrl: string,
  status: string,
  auctionEndAt: Date | null,
  adapterKey: string,
  delayOverride?: number,
) {
  const delay = delayOverride ?? auctionRefreshDelay(auctionEndAt);
  const jobId = statusJobId(itemId);
  const existing = await statusQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    // Waiting/delayed/active jobs already represent the next refresh. A
    // completed/failed record can be replaced because terminal queue records
    // are only bookkeeping; the database stores the durable history.
    if (state !== "completed" && state !== "failed") return existing;
    await existing.remove().catch(() => undefined);
  }
  await statusQueue.add(
    "refresh-status",
    { itemId, sourceItemId, sourceUrl, status, auctionEndAt, adapterKey },
    {
      delay,
      jobId,
      attempts: 4,
      backoff: { type: "exponential", delay: 30_000 },
      // Remove terminal queue records so the stable id is available for the
      // next refresh cycle. The crawl/audit tables retain the real history.
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

/**
 * The shared AI guard serializes work across workers, so minutes can pass
 * between the stages of one classification job. Re-read the item before
 * the later stages and stop if a status refresh or an operator action
 * made the listing terminal, archived, ignored, or purchased in between.
 */
async function classificationItemStillEligible(itemId: string) {
  const fresh = await prisma.item.findUnique({
    where: { id: itemId },
    select: {
      status: true,
      archivedAt: true,
      ignored: true,
      importOrigin: true,
      purchaseRecord: { select: { id: true } },
    },
  });
  return (
    fresh != null &&
    !shouldAbortAiJobForItem(fresh, { allowArchivedPurchaseImport: true })
  );
}

export async function processClassification(
  job: Job<{ itemId: string; version?: string }>,
) {
  if (!automaticPaidAiEnabled())
    return { skipped: "paid_automation_not_authorized" } as const;
  const item = await prisma.item.findUnique({
    where: { id: job.data.itemId },
    include: {
      images: { orderBy: { position: "asc" } },
      logistics: true,
      monitoringCategory: { select: { scope: true } },
      purchaseRecord: { select: { id: true } },
      classifications: {
        where: { classifierType: "vision_ai_gateway" },
        orderBy: { createdAt: "desc" },
        select: { result: true },
      },
    },
  });
  if (!item) return { skipped: "missing_item" };
  if (item.monitoringCategory?.scope === "general")
    return { skipped: "custom_general_category" };
  // A purchase import is archived only as staging until the operator
  // confirms it, so that archive alone must not block classification;
  // once a purchase is recorded, the purchaseRecord check in this same
  // condition still keeps it out. Archived items from any other origin
  // stay skipped.
  if (
    shouldAbortAiJobForItem(item, { allowArchivedPurchaseImport: true }) ||
    item.categoryToyType === "card" ||
    item.images.length === 0
  )
    return { skipped: "automatic_classification_not_applicable" };
  const contentVersion = automaticClassificationContentVersion({
    ...item,
    imageUrls: item.images.map((image) => image.url),
  });
  if (job.data.version && job.data.version !== contentVersion)
    return { skipped: "stale_content_version" };
  const alreadyCompleted = item.classifications.some(({ result }) => {
    if (!job.data.version) return true;
    return (
      result != null &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      (result as Record<string, unknown>).automaticContentVersion ===
        contentVersion
    );
  });
  if (alreadyCompleted)
    return { skipped: "content_version_already_classified" };
  if (
    !shouldQueueAutomaticClassification({
      ...item,
      imageUrls: item.images.map((image) => image.url),
    })
  )
    return { skipped: "deterministic_evidence_sufficient" };
  let latestExtractionEvidence: unknown = item.extractionEvidence;
  const procurementFacts = procurementFactsForClassification(item);
  const bulkFilter = await executeProductOperation(
    "procurement_filter",
    PRODUCT_AI_RESPONSE_SCHEMAS.procurementReview,
    item.id,
    1_600,
    [
      {
        role: "system",
        content:
          '你是采购证据复核器，不是数据估算器。deterministicAssessment 是规则引擎根据 knownFacts 得出的基线。只核验 listingEvidence 是否支持 knownFacts，并复核采购分类、紧凑度和缺失事实。复核结果不得优于规则基线，也不得删除规则已列出的 missingFacts。任何 null、unknown 或 missingFacts 都必须保持未知，不得补数量、价格、运费、交易方式、尺寸、体积或品相；不得用图片数量推断商品数量，也不得把商品本体尺寸当成包装尺寸。shouldAnalyze 仅在现有商品图片可能核验身份、件数、品相或包装证据时为 true，图片不能核验运费、交易方式或可靠包装体积。只输出 JSON：{"scope":"tokusatsu_toy|excluded_card_or_book|unrelated|unknown","procurementCategory":"preferred|promising|needs_facts|deprioritized","compactness":"compact|likely_compact|bulky|unknown","verifiedFacts":["字段"],"contradictedFacts":[{"field":"字段","evidence":"原文依据"}],"missingFacts":["price|shipping_fee|listing_type|quantity|volume|condition"],"shouldAnalyze":true或false,"confidence":0到1,"evidence":["原文依据"]}。',
      },
      {
        role: "user",
        content: JSON.stringify({
          knownFacts: procurementFacts.knownFacts,
          deterministicAssessment: procurementFacts.deterministicAssessment,
          listingEvidence: {
            titleRaw: item.titleRaw,
            descriptionRaw: item.descriptionRaw,
            conditionRaw: item.conditionRaw,
            platformFacts: item.sourceData,
          },
          imageCount: item.images.length,
        }),
      },
    ],
  );
  const procurementReview = bulkFilter
    ? normalizeProcurementAiReview(
        bulkFilter.data,
        procurementFacts.deterministicAssessment,
      )
    : null;
  if (bulkFilter && procurementReview) {
    await prisma.itemClassification.create({
      data: {
        itemId: item.id,
        classifierType: "ai_bulk_filter",
        modelVersion: bulkFilter.model,
        result: {
          ...procurementFacts,
          ...procurementReview,
        } as unknown as Prisma.InputJsonValue,
        confidence: procurementReview.confidence,
        conflict: false,
      },
    });
    if (
      (procurementReview.scope === "excluded_card_or_book" ||
        procurementReview.scope === "unrelated") &&
      procurementReview.confidence >= 0.9
    )
      await upsertAiReview(
        item,
        `ai:采购范围待人工确认（${procurementReview.scope}）`,
        bulkFilter.data,
      );
  }

  const textClassification = await executeProductOperation(
    "automatic_classification",
    PRODUCT_AI_RESPONSE_SCHEMAS.automaticClassification,
    item.id,
    3_000,
    [
      {
        role: "system",
        content: AUTOMATIC_CLASSIFICATION_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: JSON.stringify({
          titleRaw: item.titleRaw,
          descriptionRaw: item.descriptionRaw,
          conditionRaw: item.conditionRaw,
          platformFacts: item.sourceData,
          currentDatabaseClassification: {
            ip: item.categoryIp,
            toyType: item.categoryToyType,
            manufacturer: item.manufacturer,
            condition: item.conditionGrade,
            quantity: item.quantityEst,
          },
        }),
      },
    ],
  );
  const textConfidence = textClassification
    ? numberConfidence(textClassification.data.confidence)
    : item.confidence;
  const classificationPatch = textClassification
    ? automaticClassificationPatch(item, textClassification.data)
    : { data: {}, fieldConfidences: {}, conflicts: [] };
  const shf = classifyShfListing({
    titleRaw: item.titleRaw,
    descriptionRaw: item.descriptionRaw,
    categoryIp: classificationPatch.data.categoryIp ?? item.categoryIp,
  });
  const collectibleSeries = classifyCollectibleSeries({
    titleRaw: item.titleRaw,
    descriptionRaw: item.descriptionRaw,
    categoryIp: classificationPatch.data.categoryIp ?? item.categoryIp,
  });
  if (textClassification) {
    const textEvidence = mergeExtractionEvidence(latestExtractionEvidence, {
      text: textClassification.data,
    });
    const hasVerifiedPatch =
      Object.keys(classificationPatch.fieldConfidences).length > 0;
    await prisma.$transaction([
      prisma.itemClassification.create({
        data: {
          itemId: item.id,
          classifierType: "ai_text_classification",
          modelVersion: textClassification.model,
          result: textClassification.data as Prisma.InputJsonValue,
          confidence: textConfidence,
          conflict: classificationPatch.conflicts.length > 0,
        },
      }),
      prisma.item.update({
        where: { id: item.id },
        data: {
          ...classificationPatch.data,
          shfLine: shf?.line ?? null,
          shfReleaseChannel: shf?.releaseChannel ?? null,
          shfEdition: shf?.edition ?? null,
          shfRegion: shf?.region ?? null,
          collectibleSeries,
          ...(hasVerifiedPatch
            ? {
                confidence: verifiedClassificationConfidence(
                  item.confidence,
                  textConfidence,
                  classificationPatch.fieldConfidences,
                ),
              }
            : {}),
          fieldConfidences:
            classificationPatch.fieldConfidences as Prisma.InputJsonValue,
          extractionEvidence: textEvidence as Prisma.InputJsonValue,
          needsReview:
            item.needsReview ||
            textConfidence < 0.9 ||
            classificationPatch.conflicts.length > 0,
        },
      }),
    ]);
    latestExtractionEvidence = textEvidence;
    if (Object.keys(classificationPatch.data).length) {
      const productMatch = await matchOrCreateProduct(item.id);
      latestExtractionEvidence = productMatch.extractionEvidence;
    }
    if (classificationPatch.conflicts.length)
      await upsertAiReview(
        item,
        `ai:自动分类与已知字段冲突（${classificationPatch.conflicts.join("、")}）`,
        textClassification.data,
      );
  }
  const descriptiveText = `${item.titleRaw} ${item.descriptionRaw ?? ""}`;
  const highValueThreshold = Number(
    process.env.AI_IMAGE_HIGH_VALUE_THRESHOLD_JPY ?? 20_000,
  );
  const effectiveQuantity =
    classificationPatch.data.quantityEst ?? item.quantityEst;
  const effectiveToyType =
    classificationPatch.data.categoryToyType ?? item.categoryToyType;
  const effectiveConfidence = verifiedClassificationConfidence(
    item.confidence,
    textConfidence,
    classificationPatch.fieldConfidences,
  );
  const fallbackImageDecision =
    item.titleRaw.trim().length < 24 ||
    /写真参照|画像参照|まとめ売り|大量|セット|一式|詳細不明/i.test(
      descriptiveText,
    ) ||
    (effectiveQuantity ?? 0) >= 5 ||
    effectiveToyType === "unknown" ||
    effectiveConfidence < 0.7 ||
    textConfidence < 0.7 ||
    evidenceBoolean(textClassification?.data.needsImageAnalysis) ||
    item.priceCurrent >= highValueThreshold;
  const requiresImageAnalysis = shouldAnalyzeProcurementImages(
    item.images.length,
    procurementReview,
    fallbackImageDecision,
  );
  if (textConfidence < 0.7) {
    await upsertAiReview(
      item,
      "text:低置信度，等待图片或高级模型复核",
      textClassification?.data,
    );
  }
  if (!(await classificationItemStillEligible(item.id)))
    return { skipped: "item_no_longer_eligible" };
  if (!requiresImageAnalysis) {
    await prisma.itemClassification.create({
      data: {
        itemId: item.id,
        classifierType: "vision_ai_gateway",
        modelVersion: "not_required_v1",
        result: {
          skipped: "text_evidence_sufficient",
          imageCount: item.images.length,
          automaticContentVersion: contentVersion,
        },
        confidence: item.confidence,
        conflict: false,
      },
    });
    return { skipped: "text_evidence_sufficient" };
  }
  let vision: Awaited<ReturnType<typeof classifyImages>>;
  try {
    vision = await runAutomaticAiTask(
      `vision:${item.id}:${automaticClassificationContentVersion({
        ...item,
        imageUrls: item.images.map((image) => image.url),
      })}`,
      () =>
        classifyImages({
          title: item.titleRaw,
          description: item.descriptionRaw,
          // The gateway reads at most two images. The content version above
          // still covers every image, so a changed gallery re-runs the job.
          imageUrls: selectImageAnalysisUrls(
            item.images.map((image) => image.url),
          ),
          itemId: item.id,
        }),
    );
  } catch (error) {
    // Gateway assertion failures (image-count limit, disabled scope) fail
    // identically on every attempt; do not burn the job's retries on them.
    if (isNonRetryableImageAnalysisError(error))
      throw new UnrecoverableError(
        error instanceof Error ? error.message : String(error),
      );
    throw error;
  }
  const { provider, result } = vision;
  const visionIps = result.franchise.value ?? [];
  const visionCondition = result.condition.value;
  const conflict =
    (visionIps.length > 0 && !visionIps.includes(item.categoryIp)) ||
    (visionCondition != null && visionCondition !== item.conditionGrade);
  const fieldConfidences = {
    franchise: result.franchise.confidence,
    series: result.series.confidence,
    character: result.characters.confidence,
    toyType: result.toyTypes.confidence,
    manufacturer: result.manufacturers.confidence,
    quantity: result.quantity.confidence,
    condition: result.condition.confidence,
  };
  const needsReview =
    conflict ||
    Object.values(fieldConfidences).some((confidence) => confidence < 0.9);
  const visionEvidence = mergeExtractionEvidence(latestExtractionEvidence, {
    vision: result,
  });
  await prisma.$transaction([
    prisma.itemClassification.create({
      data: {
        itemId: item.id,
        classifierType: "vision_ai_gateway",
        modelVersion: provider,
        result: {
          ...result,
          automaticContentVersion: contentVersion,
        } as unknown as Prisma.InputJsonValue,
        confidence: result.confidence,
        conflict,
      },
    }),
    prisma.item.update({
      where: { id: item.id },
      data: {
        needsReview: item.needsReview || needsReview,
        extractionEvidence: visionEvidence as Prisma.InputJsonValue,
      },
    }),
  ]);
  if (needsReview) {
    await prisma.reviewQueue.upsert({
      where: { itemId_status: { itemId: item.id, status: "pending" } },
      update: {
        reasons: [
          ...(conflict ? ["vision:与文本结果冲突"] : []),
          ...Object.entries(fieldConfidences)
            .filter(([, confidence]) => confidence < 0.9)
            .map(([field, confidence]) =>
              confidence < 0.7
                ? `vision:${field}:无法确认`
                : `vision:${field}:待确认`,
            ),
        ],
        fieldConfidences: fieldConfidences as unknown as Prisma.InputJsonValue,
        suggestedChanges: result as unknown as Prisma.InputJsonValue,
      },
      create: {
        itemId: item.id,
        productId: item.productId,
        reasons: [
          ...(conflict ? ["vision:与文本结果冲突"] : []),
          ...Object.entries(fieldConfidences)
            .filter(([, confidence]) => confidence < 0.9)
            .map(([field, confidence]) =>
              confidence < 0.7
                ? `vision:${field}:无法确认`
                : `vision:${field}:待确认`,
            ),
        ],
        fieldConfidences: fieldConfidences as unknown as Prisma.InputJsonValue,
        suggestedChanges: result as unknown as Prisma.InputJsonValue,
      },
    });
  }
  if (
    (conflict || item.priceCurrent >= highValueThreshold) &&
    (await classificationItemStillEligible(item.id))
  ) {
    const advanced = await executeProductOperation(
      "automatic_classification",
      PRODUCT_AI_RESPONSE_SCHEMAS.advancedClassification,
      item.id,
      4_000,
      [
        {
          role: "system",
          content:
            "你是高级商品分析与仲裁员。只依据输入区分 knownFacts、inferences、uncertainties、risks、evidence 和 recommendedAction，不得声称一定赚钱，不得把图片估算当成精确事实。若模型结果冲突，明确列出冲突字段与需要人工核验的证据。只输出 JSON，并给 confidence（0到1）。",
        },
        {
          role: "user",
          content: JSON.stringify({
            item: {
              title: item.titleRaw,
              description: item.descriptionRaw,
              priceCurrent: item.priceCurrent,
              shippingFee: item.shippingFee,
              quantity: item.quantityEst,
              condition: item.conditionRaw,
            },
            textAnalysis: textClassification?.data ?? null,
            imageAnalysis: result,
            conflict,
          }),
        },
      ],
    );
    if (advanced) {
      const advancedConfidence = numberConfidence(advanced.data.confidence);
      await prisma.itemClassification.create({
        data: {
          itemId: item.id,
          classifierType: conflict
            ? "ai_cross_validation"
            : "ai_complex_analysis",
          modelVersion: advanced.model,
          result: advanced.data as Prisma.InputJsonValue,
          confidence: advancedConfidence,
          conflict,
        },
      });
      if (conflict || advancedConfidence < 0.7)
        await upsertAiReview(
          item,
          conflict ? "ai:文本与图片判断冲突" : "ai:高级分析仍不确定",
          advanced.data,
        );
    }
  }
  return { provider, confidence: result.confidence, conflict, needsReview };
}

type ClassificationProductOperation =
  | "product_identification"
  | "procurement_filter"
  | "automatic_classification";

async function executeProductOperation(
  operation: ClassificationProductOperation,
  responseSchema: ProductAiResponseSchemaReference,
  itemId: string,
  maxTokens: number,
  messages: Array<{ role: "system" | "user"; content: string }>,
) {
  return executeProductAi<Record<string, unknown>>(
    { operation, ...responseSchema, itemId, maxTokens, messages },
    { softHttpFailure: true },
  );
}

function numberConfidence(value: unknown) {
  const confidence = Number(value);
  return Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
}

function evidenceBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as Record<string, unknown>).value === true;
}

type AutomaticClassificationItem = {
  titleRaw: string;
  descriptionRaw: string | null;
  conditionRaw: string | null;
  categoryIp: CategoryIp;
  categoryToyType: ToyType;
  manufacturer: Manufacturer;
  conditionGrade: ConditionGrade;
  quantityEst: number | null;
  listingType: ListingType;
  priceCurrent: number;
  shippingFee: number | null;
};

function normalizedEvidenceText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("ja-JP");
}

function verifiedSourceEvidence(
  record: Record<string, unknown>,
  sourceText: string,
) {
  const normalizedSource = normalizedEvidenceText(sourceText);
  return evidenceStrings(record.evidence).filter((entry) => {
    const normalized = normalizedEvidenceText(entry);
    return normalized.length >= 2 && normalizedSource.includes(normalized);
  });
}

function evidenceSuggestion<T extends string>(
  value: Record<string, unknown>,
  field: "categoryIp" | "categoryToyType" | "manufacturer" | "conditionGrade",
  allowed: readonly T[],
  sourceText: string,
) {
  const evidence = value[field];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence))
    return undefined;
  const record = evidence as Record<string, unknown>;
  const candidate = record.value;
  const confidence = numberConfidence(record.confidence);
  const verifiedEvidence = verifiedSourceEvidence(record, sourceText);
  const semanticallySupported =
    typeof candidate === "string" &&
    verifiedEvidence.some((entry) => classifyText(entry)[field] === candidate);
  return typeof candidate === "string" &&
    allowed.includes(candidate as T) &&
    candidate !== "unknown" &&
    confidence >= 0.9 &&
    semanticallySupported
    ? { value: candidate as T, confidence }
    : undefined;
}

export function automaticClassificationPatch(
  item: AutomaticClassificationItem,
  result: Record<string, unknown>,
) {
  const sourceText = [item.titleRaw, item.descriptionRaw, item.conditionRaw]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  const data: {
    categoryIp?: CategoryIp;
    categoryToyType?: ToyType;
    manufacturer?: Manufacturer;
    conditionGrade?: ConditionGrade;
    quantityEst?: number;
    unitCostEst?: number;
  } = {};
  const fieldConfidences: Record<string, number> = {};
  const conflicts: string[] = [];
  const applyEnum = <T extends string>(
    field: "categoryIp" | "categoryToyType" | "manufacturer" | "conditionGrade",
    current: T,
    suggestion: { value: T; confidence: number } | undefined,
  ) => {
    if (!suggestion) return;
    if (current === "unknown") {
      data[field] = suggestion.value as never;
      fieldConfidences[field] = suggestion.confidence;
    } else if (current !== suggestion.value) conflicts.push(field);
  };
  applyEnum(
    "categoryIp",
    item.categoryIp,
    evidenceSuggestion(result, "categoryIp", categoryIps, sourceText),
  );
  applyEnum(
    "categoryToyType",
    item.categoryToyType,
    evidenceSuggestion(result, "categoryToyType", toyTypes, sourceText),
  );
  applyEnum(
    "manufacturer",
    item.manufacturer,
    evidenceSuggestion(result, "manufacturer", manufacturers, sourceText),
  );
  applyEnum(
    "conditionGrade",
    item.conditionGrade,
    evidenceSuggestion(result, "conditionGrade", conditionGrades, sourceText),
  );
  const quantity = result.quantity;
  if (quantity && typeof quantity === "object" && !Array.isArray(quantity)) {
    const record = quantity as Record<string, unknown>;
    const candidate = Number(record.value);
    const evidence = verifiedSourceEvidence(record, sourceText);
    const sourceQuantity = extractQuantityEst(sourceText);
    const quantityIsVerified =
      Number.isInteger(candidate) &&
      candidate > 0 &&
      candidate <= 500 &&
      numberConfidence(record.confidence) >= 0.9 &&
      sourceQuantity === candidate &&
      evidence.some((entry) => extractQuantityEst(entry) === candidate);
    if (item.quantityEst == null && quantityIsVerified) {
      data.quantityEst = candidate;
      fieldConfidences.quantityEst = numberConfidence(record.confidence);
      if (
        Number.isFinite(item.priceCurrent) &&
        item.priceCurrent >= 0 &&
        item.shippingFee != null &&
        Number.isFinite(item.shippingFee) &&
        item.shippingFee >= 0 &&
        item.listingType === "direct"
      )
        data.unitCostEst = Math.round(
          (item.priceCurrent + item.shippingFee) / candidate,
        );
    } else if (
      item.quantityEst != null &&
      quantityIsVerified &&
      candidate !== item.quantityEst &&
      Number.isInteger(candidate)
    ) {
      conflicts.push("quantityEst");
    }
  }
  return { data, fieldConfidences, conflicts };
}

export function verifiedClassificationConfidence(
  currentConfidence: number,
  modelConfidence: number,
  fieldConfidences: Record<string, number>,
) {
  const verified = Object.values(fieldConfidences).filter(
    (value) => Number.isFinite(value) && value >= 0 && value <= 1,
  );
  if (verified.length === 0) return currentConfidence;
  return Math.max(currentConfidence, Math.min(modelConfidence, ...verified));
}

async function upsertAiReview(
  item: {
    id: string;
    productId: string | null;
  },
  reason: string,
  suggestedChanges?: Record<string, unknown>,
) {
  await prisma.reviewQueue.upsert({
    where: { itemId_status: { itemId: item.id, status: "pending" } },
    update: {
      reasons: [reason],
      suggestedChanges: (suggestedChanges ?? {}) as Prisma.InputJsonValue,
    },
    create: {
      itemId: item.id,
      productId: item.productId,
      reasons: [reason],
      fieldConfidences: {},
      suggestedChanges: (suggestedChanges ?? {}) as Prisma.InputJsonValue,
    },
  });
}

export async function processStatus(
  job: Job<{
    itemId: string;
    sourceItemId: string;
    sourceUrl: string;
    status: string;
    auctionEndAt: string | Date | null;
    adapterKey: string;
  }>,
) {
  const adapter = adapters[job.data.adapterKey];
  if (!adapter) return { skipped: "adapter_unavailable" };
  const current = await prisma.item.findUnique({
    where: { id: job.data.itemId },
    include: {
      purchaseRecord: { select: { id: true } },
      seller: {
        select: {
          name: true,
          sourceSellerId: true,
          profileUrl: true,
          sourceData: true,
        },
      },
    },
  });
  if (!current) return { skipped: "missing_item" };
  if (
    current.archivedAt ||
    current.ignored ||
    current.purchaseRecord ||
    !isStatusRefreshEligible(current.status)
  )
    return { skipped: "inactive_item" };
  // Availability must come from a fresh marketplace probe, not the search
  // cache used for historical seller/detail enrichment.
  let update = await adapter.refreshStatus({
    sourceItemId: current.sourceItemId,
    sourceUrl: current.sourceUrl,
    status: current.status,
    listingType: current.listingType,
    auctionEndAt: current.auctionEndAt,
  });
  const shouldEnrich =
    job.name === "backfill-public-seller-profile" &&
    update.status === "active" &&
    needsCompleteEnrichment(current, job.data.adapterKey);
  if (shouldEnrich) {
    try {
      let detailCandidate: SearchResult = {
        sourceItemId: current.sourceItemId,
        sourceUrl: current.sourceUrl,
      };
      if (
        job.data.adapterKey === "mercari" &&
        !!current.seller?.name.match(/^Mercari 卖家(?: \d+)?$/)
      ) {
        const results = await adapter.search({
          keyword: current.titleRaw
            .replace(/\s+by\s+メルカリ\s*$/i, "")
            .slice(0, 160),
          highPriority: false,
          limit: 60,
          scanMode: "incremental",
        });
        detailCandidate =
          pickExactMercariBackfillResult(current.sourceItemId, results) ??
          detailCandidate;
      }
      const normalized = await adapter.normalize(
        await adapter.fetchDetail(detailCandidate),
      );
      if (isExcludedNormalizedItem(normalized)) {
        await updateMarketWithAudit({
          itemId: current.id,
          where: { archivedAt: null, ignored: false, purchaseRecord: null },
          data: { archivedAt: new Date(), lastSeenAt: new Date() },
          actor: "inventory-maintenance",
          reason: "excluded_collectible_archived",
        });
        return { skipped: "out_of_scope" };
      }
      if (normalized.status === "sold" || normalized.status === "ended") {
        update = {
          status: normalized.status,
          listingType: normalized.listingType,
          priceCurrent: normalized.priceCurrent,
          shippingFee: normalized.shippingFee,
          auctionEndAt: normalized.auctionEndAt,
          bidCount: safeBidCount(normalized.bidCount),
        };
      } else {
        // Seller-detail fallback is not an availability probe. Preserve the
        // fresh result when an enrichment payload has no authoritative status.
        await enrichKnownItem(current.sourceId, current.id, {
          ...normalized,
          status: update.status,
        });
        update = {
          ...update,
          priceCurrent: normalized.priceCurrent,
          shippingFee: normalized.shippingFee,
        };
      }
    } catch {
      // Seller backfill failure cannot discard the fresh availability result.
    }
  }
  let priceCurrent = update.priceCurrent ?? current.priceCurrent;
  let shippingFee = update.shippingFee ?? current.shippingFee;
  let { auctionEndAt, listingType } = resolvedMarketSaleMode(update, current);
  let bidCount = safeBidCount(update.bidCount) ?? current.bidCount;
  let previousPrice = current.priceCurrent;
  let previousShipping = current.shippingFee;
  let previousBids = current.bidCount;
  const checkedAt = new Date();
  const changed = await updateMarketWithAudit({
    itemId: current.id,
    where: {
      archivedAt: null,
      ignored: false,
      purchaseRecord: null,
      status: { in: ["active", "unknown"] },
    },
    actor: "market-status",
    reason: "availability_refreshed",
    data: (before) => {
      previousPrice = before.priceCurrent;
      previousShipping = before.shippingFee;
      previousBids = before.bidCount;
      priceCurrent = update.priceCurrent ?? before.priceCurrent;
      shippingFee = update.shippingFee ?? before.shippingFee;
      ({ auctionEndAt, listingType } = resolvedMarketSaleMode(update, before));
      bidCount = safeBidCount(update.bidCount) ?? before.bidCount;
      return {
        status: update.status,
        priceCurrent,
        shippingFee,
        priceTotalEst: priceCurrent + (shippingFee ?? 0),
        auctionEndAt,
        listingType,
        bidCount,
        ...(update.status !== "unknown" ? { lastSeenAt: checkedAt } : {}),
        ...(update.status === "sold" || update.status === "ended"
          ? { archivedAt: checkedAt }
          : {}),
      };
    },
  });
  if (!changed.count) return { skipped: "item_changed" };
  if (
    priceCurrent !== previousPrice ||
    shippingFee !== previousShipping ||
    bidCount !== previousBids
  ) {
    await prisma.itemPriceHistory.create({
      data: {
        itemId: current.id,
        priceCurrent,
        shippingFee,
        bidCount,
      },
    });
  }
  await refreshReadyCrossMarketOpportunitiesForItem(current.id);
  return { ...update, auctionEndAt, listingType };
}

/** Archives terminal listings every two hours while keeping purchase history intact. */
export async function archiveExcludedCollectibles(now = new Date()) {
  let archived = 0;
  let cursor: string | undefined;
  for (;;) {
    const candidates = await prisma.item.findMany({
      where: {
        archivedAt: null,
        purchaseRecord: null,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        id: true,
        titleRaw: true,
        descriptionRaw: true,
        categoryToyType: true,
        favorite: true,
        ignored: true,
        ignoredAt: true,
        archivedAt: true,
      },
      orderBy: { id: "asc" },
      take: 5000,
    });
    if (!candidates.length) break;
    cursor = candidates.at(-1)?.id;
    const excluded = candidates.filter((item) =>
      isExcludedNormalizedItem({
        ...item,
        descriptionRaw: item.descriptionRaw ?? undefined,
      }),
    );
    if (!excluded.length) continue;
    archived += await prisma.$transaction(async (tx) => {
      let batchArchived = 0;
      for (const item of excluded) {
        // Re-check the purchase relation in the write predicate. A purchase can
        // be recorded between the scan and this transaction and must always win.
        const updated = await tx.item.updateMany({
          where: {
            id: item.id,
            archivedAt: null,
            purchaseRecord: null,
          },
          data: { archivedAt: now },
        });
        if (!updated.count) continue;
        await tx.manualReview.create({
          data: {
            itemId: item.id,
            actor: "inventory-maintenance",
            reason: "excluded_collectible_archived",
            beforeData: { archivedAt: null },
            afterData: { archivedAt: now.toISOString() },
          },
        });
        batchArchived += 1;
      }
      return batchArchived;
    });
  }
  return archived;
}

/** Re-evaluate historical search inventory with the same deterministic gate
 * used at ingestion. Explicit link imports, favorites, purchases, carts and
 * active negotiation cases stay intact; archived rows keep their audit trail. */
export async function archiveLowQualitySearchInventory(now = new Date()) {
  let archived = 0;
  let cursor: string | undefined;
  for (;;) {
    const candidates = await prisma.item.findMany({
      where: {
        importOrigin: "search",
        archivedAt: null,
        ignored: false,
        favorite: false,
        purchaseRecord: null,
        cartItems: { none: {} },
        negotiationCase: { is: null },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        id: true,
        titleRaw: true,
        descriptionRaw: true,
        sourceUrl: true,
        priceCurrent: true,
        shippingFee: true,
        categoryIp: true,
        categoryToyType: true,
        manufacturer: true,
        conditionGrade: true,
        quantityEst: true,
        imageCount: true,
        status: true,
        channel: true,
        collectibleSeries: true,
        monitoringCategoryId: true,
        monitoringCategory: { select: { scope: true } },
        collaborationMessages: { select: { id: true }, take: 1 },
      },
      orderBy: { id: "asc" },
      take: 2_000,
    });
    if (!candidates.length) break;
    cursor = candidates.at(-1)?.id;
    for (const item of candidates) {
      const quality = assessInventoryQuality(item, {
        scope:
          item.monitoringCategory?.scope === "general" ? "general" : "toys",
      });
      if (quality.eligible) continue;
      const changed = await prisma.$transaction(async (tx) => {
        const result = await tx.item.updateMany({
          where: {
            id: item.id,
            importOrigin: "search",
            monitoringCategoryId: item.monitoringCategoryId,
            archivedAt: null,
            ignored: false,
            favorite: false,
            purchaseRecord: null,
            cartItems: { none: {} },
            negotiationCase: { is: null },
          },
          data: { archivedAt: now },
        });
        if (!result.count) return 0;
        await tx.manualReview.create({
          data: {
            itemId: item.id,
            actor: "inventory-quality-maintenance",
            reason: quality.reason ?? "quality_gate_rejected",
            beforeData: {
              archivedAt: null,
              qualityEvidenceCount: quality.evidenceCount,
            },
            afterData: {
              archivedAt: now.toISOString(),
              qualityReason: quality.reason,
              qualityEvidenceCount: quality.evidenceCount,
            },
          },
        });
        // Product references in chat keep their thumbnail. Unreferenced stale
        // inventory releases image rows while the canonical item and audit stay.
        if (!item.collaborationMessages.length)
          await tx.itemImage.deleteMany({ where: { itemId: item.id } });
        return 1;
      });
      archived += changed;
    }
  }
  return archived;
}

export async function processCleanup() {
  const now = new Date();
  // A process/container restart can leave the historical CrawlJob row in
  // `running` forever. updatedAt is the durable heartbeat, so a job with no
  // write activity for thirty minutes is no longer represented by a live run.
  const staleRunning = await prisma.crawlJob.updateMany({
    where: {
      status: "running",
      updatedAt: { lt: new Date(now.getTime() - 30 * 60_000) },
    },
    data: {
      status: "failed",
      errorText: "worker heartbeat expired; run was closed by maintenance",
      finishedAt: now,
    },
  });
  let archived = 0;
  for (;;) {
    const terminal = await prisma.item.findMany({
      where: {
        archivedAt: null,
        purchaseRecord: null,
        OR: [
          { status: { in: ["sold", "ended"] } },
          {
            listingType: "auction",
            auctionEndAt: { lte: now },
          },
        ],
      },
      select: { id: true },
      take: 500,
    });
    if (!terminal.length) break;
    archived += await prisma.$transaction(
      async (tx) => {
        const ids: string[] = [];
        for (const item of terminal) {
          const changed = await writeMarketUpdateWithAudit(tx, {
            itemId: item.id,
            where: {
              archivedAt: null,
              purchaseRecord: null,
              OR: [
                { status: { in: ["sold", "ended"] } },
                { listingType: "auction", auctionEndAt: { lte: now } },
              ],
            },
            data: { archivedAt: now },
            actor: "inventory-maintenance",
            reason: "terminal_or_expired_listing_archived",
          });
          if (changed.count) ids.push(item.id);
        }
        if (ids.length)
          await tx.itemImage.deleteMany({
            where: {
              itemId: { in: ids },
              item: {
                purchaseRecord: null,
                favorite: false,
                collaborationMessages: { none: {} },
              },
            },
          });
        return ids.length;
      },
      { timeout: 60_000 },
    );
  }
  const archivedExcluded = await archiveExcludedCollectibles(now);
  const archivedLowQuality = await archiveLowQualitySearchInventory(now);
  const orphanProducts = await prisma.product.deleteMany({
    where: { listings: { none: {} }, inventory: null },
  });
  const images = await backfillMissingItemImages();
  const sellerProfiles = await backfillExplicitMercariProfileUrls();
  return {
    staleRunsClosed: staleRunning.count,
    archived,
    archivedExcluded,
    archivedLowQuality,
    removedOrphanProducts: orphanProducts.count,
    imagesBackfilled: images.recovered,
    imageRowsCorrected: images.correctedEmpty,
    mercariProfilesBackfilled: sellerProfiles,
    cleanedAt: now.toISOString(),
  };
}

/**
 * Removes stale entries from the visible not-interested warehouse after one
 * day without deleting their durable discovery history. DiscoveryFeedback
 * intentionally retains its required listingId relation, so the owning Item
 * is archived instead of deleted.
 */
export async function processDislikedCleanup() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const failedNegotiations = await prisma.negotiationCase.findMany({
    where: {
      status: "failed",
      statusChangedAt: { lt: cutoff },
      item: {
        archivedAt: null,
        ignored: false,
        purchaseRecord: null,
      },
    },
    select: { itemId: true },
    take: 5000,
  });
  if (failedNegotiations.length) {
    const itemIds = failedNegotiations.map((entry) => entry.itemId);
    await prisma.$transaction([
      prisma.item.updateMany({
        where: {
          id: { in: itemIds },
          archivedAt: null,
          ignored: false,
          purchaseRecord: null,
        },
        data: {
          favorite: false,
          ignored: true,
          ignoredAt: now,
          ignoredReason: "negotiation_failed",
        },
      }),
      prisma.negotiationCase.updateMany({
        where: {
          itemId: { in: itemIds },
          status: "failed",
          statusChangedAt: { lt: cutoff },
        },
        data: { status: "moved_to_disliked", statusChangedAt: now },
      }),
    ]);
  }
  let archived = 0;
  let cursor: string | undefined;
  for (;;) {
    const stale = await prisma.item.findMany({
      where: {
        ignored: true,
        ignoredAt: { lt: cutoff },
        archivedAt: null,
        purchaseRecord: null,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 5000,
    });
    if (!stale.length) break;
    cursor = stale.at(-1)?.id;
    const result = await prisma.item.updateMany({
      where: {
        id: { in: stale.map((item) => item.id) },
        ignored: true,
        ignoredAt: { lt: cutoff },
        archivedAt: null,
        purchaseRecord: null,
      },
      data: { archivedAt: now },
    });
    archived += result.count;
  }
  return {
    failedNegotiationsMoved: failedNegotiations.length,
    // Keep the existing metric for queue consumers: these rows were removed
    // from the user-visible warehouse, even though their audit owner remains.
    removed: archived,
    archived,
    cleanedAt: now.toISOString(),
  };
}
