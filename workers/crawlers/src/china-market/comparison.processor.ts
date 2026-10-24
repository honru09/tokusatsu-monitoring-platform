import { createHash, randomUUID } from "node:crypto";
import { Prisma, prisma } from "@tokusatsu/db";
import type { Job } from "bullmq";
import {
  acceptCandidate,
  fallbackChineseKeywords,
  robustReferencePrice,
  scoreChinaCandidate,
  validatedChineseKeywords,
} from "./matching.js";
import { decideChinaCandidates, generateChineseSearchKeywords } from "./ai.js";
import {
  stableComparisonJobId,
  xianyuMarketProvider,
  xianyuComparisonEnabled,
} from "./xianyu.provider.js";
import type {
  AiCandidateDecision,
  ChinaProductReference,
  RawChinaMarketOffer,
} from "./types.js";
import { chinaMarketComparisonQueue } from "../queues.js";
import { safePublicHttpsImageUrl } from "./url-safety.js";
import { evaluateAndScheduleCrossMarketArbitrage } from "./arbitrage.js";

const SOURCE_KEY = "xianyu";
const SOURCE_NAME = "闲鱼";
const COMPARISON_METHOD = "xianyu-v2-special-series-condition";
const DEFAULT_INTERVAL_MS = 6 * 60 * 60_000;
const DEFAULT_REFRESH_LEASE_MS = 10 * 60_000;
const JAPAN_REFERENCE_SOURCE_KEYS = [
  "mandarake",
  "mercari",
  "yahoo_auctions",
  "yahoo_fleamarket",
  "yahoo_shopping",
  "rakuma",
  "surugaya",
] as const;

type ComparisonJobData = {
  productId?: string;
  sourceId?: string;
  comparisonId?: string;
  observedAt?: string;
  providerRuns?: Record<string, string>;
};

function positiveInteger(name: string, fallback: number, maximum?: number) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.floor(value), maximum ?? Number.MAX_SAFE_INTEGER);
}

function refreshIntervalMs() {
  return positiveInteger(
    "XIANYU_COMPARISON_INTERVAL_MS",
    DEFAULT_INTERVAL_MS,
    30 * 24 * 60 * 60_000,
  );
}

function refreshLeaseMs() {
  return positiveInteger(
    "XIANYU_COMPARISON_LEASE_MS",
    DEFAULT_REFRESH_LEASE_MS,
    60 * 60_000,
  );
}

function offerRetentionMs() {
  return (
    positiveInteger("XIANYU_COMPARISON_OFFER_RETENTION_DAYS", 30, 365) *
    24 *
    60 *
    60_000
  );
}

function maxStoredOffers() {
  // The current refresh may legitimately contribute the full 50-candidate
  // budget. Never prune those rows before the ready evidence transaction has
  // validated its sample and representative listing.
  return Math.max(
    50,
    positiveInteger("XIANYU_COMPARISON_MAX_STORED_OFFERS", 2_000, 10_000),
  );
}

function maxSearchKeywords() {
  return Math.max(3, positiveInteger("XIANYU_COMPARISON_MAX_KEYWORDS", 5, 8));
}

function crossMarketArbitrageEnabled() {
  return (
    process.env.XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED === "true" &&
    process.env.XIANYU_REVERSE_SEARCH_ENABLED === "true"
  );
}

function nextRefreshAt(now = new Date()) {
  return new Date(now.getTime() + refreshIntervalMs());
}

function isProviderRateLimitError(
  error: unknown,
): error is { code: string; retryAfterMs: number } {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "provider_rate_limited" &&
      "retryAfterMs" in error &&
      Number.isFinite((error as { retryAfterMs?: unknown }).retryAfterMs),
  );
}

function nextFailureRefreshAt(error?: unknown, now = new Date()) {
  const ordinaryDelay = Math.min(refreshIntervalMs(), 60 * 60_000);
  const delay = isProviderRateLimitError(error)
    ? Math.max(5 * 60_000, Math.min(error.retryAfterMs, 6 * 60 * 60_000))
    : ordinaryDelay;
  // Dispatches from multiple workers should not stampede the provider when a
  // shared Retry-After window ends.
  const jitter = Math.floor(delay * 0.1 * Math.random());
  return new Date(now.getTime() + delay + jitter);
}

function safeError(error: unknown) {
  // Adapter/transport exceptions can contain response bodies, credentialed
  // URLs, cookies or seller identities. Persist only fixed diagnostic labels;
  // regex-based token removal cannot safely allowlist an arbitrary payload.
  if (error instanceof RefreshLeaseLostError)
    return "refresh_lease_lost: 本次刷新租约已失效";
  if (isProviderBlockedError(error))
    return "provider_blocked: 搜索授权或平台验证需要人工处理";
  if (isProviderRateLimitError(error))
    return "provider_rate_limited: 搜索服务限流，已安排延后重试";
  if (error instanceof ProviderIntegrityError)
    return "provider_integrity: 搜索结果未通过完整性校验";
  const message = error instanceof Error ? error.message : "";
  if (/timeout|timed out|abort/i.test(message))
    return "provider_timeout: 搜索或发布超时";
  if (/provider unavailable/i.test(message))
    return "provider_unavailable: provider unavailable";
  return "comparison_failed: 本次比价刷新失败，原始错误内容未保存";
}

function isProviderBlockedError(error: unknown): error is { code: string } {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "provider_blocked",
  );
}

function entityNames(
  entity:
    | { nameZh?: string | null; nameJa?: string | null; nameEn?: string | null }
    | null
    | undefined,
) {
  return [entity?.nameZh, entity?.nameJa, entity?.nameEn].filter(
    (value): value is string => Boolean(value?.trim()),
  );
}

function httpImageUrls(values: string[]) {
  return [
    ...new Set(
      values.flatMap((value) => {
        const url = safePublicHttpsImageUrl(value);
        return url ? [url] : [];
      }),
    ),
  ].slice(0, 8);
}

function verifiedOfferId(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(value);
}

function hasAuditedApifyAvailability(offer: RawChinaMarketOffer) {
  const provenance = offer.provenance;
  if (!provenance?.providerKey.startsWith("apify:")) return true;
  if (offer.status !== "active") return true;
  if (!provenance.providerRunId) return false;
  const sourceData = offer.sourceData;
  const detailStatus =
    typeof sourceData?.detailStatus === "string"
      ? sourceData.detailStatus.trim().toLowerCase()
      : "";
  if (detailStatus === "enriched") return true;
  if (
    detailStatus !== "summary" ||
    sourceData?.availabilityEvidence !== "apify_current_search_result" ||
    typeof sourceData.availabilityObservedAt !== "string"
  )
    return false;
  const observedAt = Date.parse(sourceData.availabilityObservedAt);
  const age = Date.now() - observedAt;
  return (
    Number.isFinite(observedAt) && age >= -5 * 60_000 && age <= 30 * 60_000
  );
}

function isCanonicalXianyuOffer(
  offer: RawChinaMarketOffer,
  validKeywords: ReadonlySet<string>,
) {
  const provenance = offer.provenance;
  if (
    offer.platform !== SOURCE_KEY ||
    !verifiedOfferId(offer.sourceListingId) ||
    !offer.titleRaw.trim() ||
    !Number.isFinite(offer.priceCny) ||
    offer.priceCny <= 0 ||
    !["active", "sold", "ended", "unknown"].includes(offer.status) ||
    !provenance ||
    !/^[A-Za-z0-9][A-Za-z0-9:~._-]{0,127}$/.test(provenance.providerKey) ||
    !validKeywords.has(provenance.queryKeyword) ||
    !hasAuditedApifyAvailability(offer) ||
    (provenance.providerRunId != null &&
      !/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(provenance.providerRunId))
  )
    return false;
  return (
    offer.sourceUrl ===
    `https://www.goofish.com/item?id=${encodeURIComponent(offer.sourceListingId)}`
  );
}

function deduplicateProviderOffers(
  offers: RawChinaMarketOffer[],
  keywords: string[],
) {
  const validKeywords = new Set(keywords);
  const unique = new Map<string, RawChinaMarketOffer>();
  const conflicts = new Set<string>();
  for (const offer of offers) {
    if (!isCanonicalXianyuOffer(offer, validKeywords)) continue;
    const key = `${offer.platform}:${offer.sourceListingId}`;
    if (conflicts.has(key)) continue;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, offer);
      continue;
    }
    if (
      existing.titleRaw !== offer.titleRaw ||
      existing.priceCny !== offer.priceCny ||
      existing.status !== offer.status ||
      existing.sourceUrl !== offer.sourceUrl
    ) {
      unique.delete(key);
      conflicts.add(key);
    }
  }
  return [...unique.values()];
}

class ProviderIntegrityError extends Error {
  constructor(message: string) {
    super(`Xianyu provider integrity failure: ${message}`);
    this.name = "ProviderIntegrityError";
  }
}

function nonNegativeInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}

function verifiedProviderOffers(
  result: Awaited<ReturnType<typeof xianyuMarketProvider.search>>,
  keywords: string[],
  candidateLimit: number,
) {
  if (!result || typeof result !== "object" || !Array.isArray(result.offers))
    throw new ProviderIntegrityError("missing offer array");
  const requestedKeywords = nonNegativeInteger(result.stats?.requestedKeywords);
  const attemptedKeywords = nonNegativeInteger(result.stats?.attemptedKeywords);
  const rejectedRows = nonNegativeInteger(result.stats?.rejectedRows);
  if (
    requestedKeywords !== keywords.length ||
    attemptedKeywords == null ||
    attemptedKeywords > requestedKeywords ||
    rejectedRows == null ||
    typeof result.complete !== "boolean" ||
    (result.complete && attemptedKeywords !== requestedKeywords)
  )
    throw new ProviderIntegrityError("invalid completion statistics");
  const offers = deduplicateProviderOffers(result.offers, keywords);
  if (result.offers.length > 0 && offers.length === 0)
    throw new ProviderIntegrityError("all returned offers failed validation");
  if (rejectedRows > 0 && offers.length < 3)
    throw new ProviderIntegrityError(
      "too few verified offers after provider row rejection",
    );
  if (!result.complete && offers.length < candidateLimit)
    throw new ProviderIntegrityError(
      "incomplete search did not exhaust the candidate budget",
    );
  return {
    offers,
    providerStats: {
      complete: result.complete,
      requestedKeywords,
      attemptedKeywords,
      rejectedRows,
    } satisfies Prisma.InputJsonObject,
  };
}

async function ensureXianyuSource() {
  return prisma.source.upsert({
    where: { key: SOURCE_KEY },
    update: {
      displayName: SOURCE_NAME,
      baseUrl: "https://www.goofish.com",
      channel: "online",
      enabled: false,
      comparisonOnly: true,
      rateLimitMs: positiveInteger("XIANYU_REQUEST_INTERVAL_MS", 3_000),
    },
    create: {
      key: SOURCE_KEY,
      displayName: SOURCE_NAME,
      baseUrl: "https://www.goofish.com",
      channel: "online",
      enabled: false,
      comparisonOnly: true,
      rateLimitMs: positiveInteger("XIANYU_REQUEST_INTERVAL_MS", 3_000),
    },
  });
}

async function loadProductReference(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      franchise: true,
      series: true,
      manufacturerEntity: true,
      toyTypeEntity: true,
      listings: {
        where: {
          archivedAt: null,
          ignored: false,
          status: { in: ["active", "unknown"] },
          source: { key: { in: [...JAPAN_REFERENCE_SOURCE_KEYS] } },
        },
        orderBy: [
          { updatedAt: "desc" as const },
          { detectedAt: "desc" as const },
        ],
        take: 4,
        include: {
          images: {
            orderBy: { position: "asc" as const },
            take: 4,
          },
        },
      },
    },
  });
  if (!product) return null;
  const listing = product.listings[0];
  const referenceImageUrls = httpImageUrls(
    product.listings.flatMap((item) => item.images.map((image) => image.url)),
  );
  const names = (values: string[]) => [...new Set(values)].slice(0, 8);
  return {
    product,
    reference: {
      productId: product.id,
      itemId: listing?.id,
      canonicalName: product.canonicalName,
      normalizedName: product.normalizedName,
      titleZh: product.titleZh,
      productLine: product.productLine,
      modelNumber: product.modelNumber,
      releaseYear: product.releaseYear,
      franchiseNames: names(entityNames(product.franchise)),
      seriesNames: names(entityNames(product.series)),
      manufacturerNames: names(entityNames(product.manufacturerEntity)),
      toyTypeNames: names(entityNames(product.toyTypeEntity)),
      categoryIp: listing?.categoryIp,
      collectibleSeries: listing?.collectibleSeries,
      shfLine: listing?.shfLine,
      shfReleaseChannel: listing?.shfReleaseChannel,
      shfEdition: listing?.shfEdition,
      shfRegion: listing?.shfRegion,
      conditionGrade: listing?.conditionGrade,
      listingTitleRaw: listing?.titleRaw ?? product.canonicalName,
      listingTitleZh: listing?.titleZh,
      listingDescription: listing?.descriptionRaw,
      listingCondition: listing?.conditionRaw,
      quantity: listing?.quantityEst,
      referenceImageUrls,
    } satisfies ChinaProductReference,
  };
}

function keywordIdentityHash(reference: ChinaProductReference) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        canonicalName: reference.canonicalName,
        normalizedName: reference.normalizedName,
        titleZh: reference.titleZh ?? null,
        productLine: reference.productLine ?? null,
        modelNumber: reference.modelNumber ?? null,
        releaseYear: reference.releaseYear ?? null,
        franchiseNames: reference.franchiseNames,
        seriesNames: reference.seriesNames,
        manufacturerNames: reference.manufacturerNames,
        toyTypeNames: reference.toyTypeNames,
        categoryIp: reference.categoryIp ?? null,
        collectibleSeries: reference.collectibleSeries ?? null,
        shfLine: reference.shfLine ?? null,
        shfReleaseChannel: reference.shfReleaseChannel ?? null,
        shfEdition: reference.shfEdition ?? null,
        shfRegion: reference.shfRegion ?? null,
        conditionGrade: reference.conditionGrade ?? null,
        listingTitleRaw: reference.listingTitleRaw,
        listingTitleZh: reference.listingTitleZh ?? null,
        quantity: reference.quantity ?? null,
      }),
    )
    .digest("hex");
}

function metadataObject(value: Record<string, unknown> | undefined) {
  if (!value) return undefined;
  const result: Record<string, string | boolean | string[]> = {};
  const stringKeys = [
    "detailStatus",
    "listingType",
    "categoryName",
    "categoryPath",
    "postedAt",
    "availabilityEvidence",
    "availabilityObservedAt",
  ];
  for (const key of stringKeys) {
    const entry = value[key];
    if (typeof entry === "string" && entry.trim())
      result[key] = entry.trim().slice(0, 240);
  }
  for (const key of ["freeShipping", "isAd", "isB2C", "isAuction"]) {
    const entry = value[key];
    if (typeof entry === "boolean") result[key] = entry;
  }
  if (Array.isArray(value.badges)) {
    const badges = value.badges
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 12);
    if (badges.length) result.badges = badges;
  }
  return Object.keys(result).length ? result : undefined;
}

function evidenceObject(
  deterministic: ReturnType<typeof scoreChinaCandidate>,
  ai: AiCandidateDecision | undefined,
) {
  const evidence: Record<string, Prisma.InputJsonValue> = {
    deterministic: {
      score: deterministic.score,
      factors: deterministic.factors,
      reasons: deterministic.reasons,
      excluded: deterministic.excluded,
    },
  };
  if (ai)
    evidence.ai = {
      sameProduct: ai.sameProduct,
      confidence: ai.confidence,
      accessoryOnly: Boolean(ai.accessoryOnly),
      damaged: Boolean(ai.damaged),
      quantityConflict: Boolean(ai.quantityConflict),
      modelConflict: Boolean(ai.modelConflict),
      versionConflict: Boolean(ai.versionConflict),
      scaleConflict: Boolean(ai.scaleConflict),
      evidence: ai.evidence,
    };
  return evidence;
}

function acceptedOffer(
  offer: RawChinaMarketOffer,
  deterministic: ReturnType<typeof scoreChinaCandidate>,
  ai: AiCandidateDecision | undefined,
) {
  const result = acceptCandidate(deterministic, ai);
  return result.accepted
    ? { ...offer, matchConfidence: result.confidence }
    : null;
}

function completeAiDecisionSet(
  decisions: AiCandidateDecision[],
  expectedIds: string[],
) {
  if (decisions.length !== expectedIds.length) return [];
  const expected = new Set(expectedIds);
  const seen = new Set<string>();
  for (const decision of decisions) {
    if (
      !expected.has(decision.sourceListingId) ||
      seen.has(decision.sourceListingId)
    )
      return [];
    seen.add(decision.sourceListingId);
  }
  return decisions;
}

function offerDecision(
  deterministic: ReturnType<typeof scoreChinaCandidate>,
  ai: AiCandidateDecision | undefined,
  accepted: boolean,
  pricingExcluded = false,
) {
  if (pricingExcluded) return "unmatched" as const;
  if (accepted) return "auto_matched" as const;
  if (!ai && !deterministic.excluded && deterministic.score >= 0.65)
    return "review_required" as const;
  return "unmatched" as const;
}

export async function dispatchChinaMarketComparisons() {
  if (!xianyuComparisonEnabled())
    return { skipped: "china_market_comparison_disabled", scheduled: 0 };
  const source = await ensureXianyuSource();
  const now = new Date();
  // A crashed refresh must be recoverable independently of the ordinary
  // six-hour comparison cadence.
  const stale = new Date(now.getTime() - 60 * 60_000);
  const batchSize = Math.max(
    2,
    positiveInteger("XIANYU_COMPARISON_BATCH_SIZE", 20, 100),
  );
  const newProductQuota = Math.min(
    batchSize - 1,
    positiveInteger(
      "XIANYU_COMPARISON_NEW_PRODUCT_QUOTA",
      Math.max(1, Math.ceil(batchSize / 4)),
      batchSize - 1,
    ),
  );
  const listingEvidence: Prisma.ItemWhereInput = {
    archivedAt: null,
    ignored: false,
    status: { in: ["active", "unknown"] },
    source: { key: { in: [...JAPAN_REFERENCE_SOURCE_KEYS] } },
  };
  const specialListingEvidence: Prisma.ItemWhereInput = {
    ...listingEvidence,
    collectibleSeries: { in: ["shf", "sic"] },
    categoryIp: { in: ["kamen_rider", "ultraman"] },
  };
  const dueWhere = (
    special: boolean,
  ): Prisma.ProductMarketComparisonWhereInput => ({
    sourceId: source.id,
    product: {
      listings: special
        ? { some: specialListingEvidence }
        : { some: listingEvidence, none: specialListingEvidence },
    },
    AND: [
      {
        OR: [
          { nextRefreshAt: { lte: now } },
          { nextRefreshAt: null },
          { status: "refreshing", updatedAt: { lt: stale } },
          { refreshLeaseUntil: { lte: now } },
        ],
      },
      {
        OR: [{ refreshLeaseUntil: null }, { refreshLeaseUntil: { lte: now } }],
      },
    ],
  });
  const dueOrder = [
    { nextRefreshAt: { sort: "asc" as const, nulls: "first" as const } },
    { updatedAt: "asc" as const },
    { productId: "asc" as const },
  ];
  const newWhere = (special: boolean): Prisma.ProductWhereInput => ({
    listings: special
      ? { some: specialListingEvidence }
      : { some: listingEvidence, none: specialListingEvidence },
    marketComparisons: { none: { sourceId: source.id } },
  });
  const [priorityDue, regularDue, priorityNew, regularNew] = await Promise.all([
    prisma.productMarketComparison.findMany({
      where: dueWhere(true),
      select: { productId: true },
      orderBy: dueOrder,
      take: batchSize,
    }),
    prisma.productMarketComparison.findMany({
      where: dueWhere(false),
      select: { productId: true },
      orderBy: dueOrder,
      take: batchSize,
    }),
    prisma.product.findMany({
      where: newWhere(true),
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: batchSize,
    }),
    prisma.product.findMany({
      where: newWhere(false),
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: batchSize,
    }),
  ]);
  const uniqueIds = <T extends { id: string }>(values: T[]) => [
    ...new Map(values.map((value) => [value.id, value])).values(),
  ];
  // Special collections advance before the rest of the catalog. Product-level
  // evidence is then shared by every linked Japanese listing of that same
  // product, avoiding duplicate provider searches for identical stock rows.
  const dueComparisons = uniqueIds(
    [...priorityDue, ...regularDue].map(({ productId }) => ({ id: productId })),
  );
  const newProducts = uniqueIds([...priorityNew, ...regularNew]);
  const due = dueComparisons.map(({ id }) => ({
    id,
    cohort: "due" as const,
  }));
  const unseen = newProducts.map(({ id }) => ({
    id,
    cohort: "new" as const,
  }));
  const dueQuota = batchSize - newProductQuota;
  const selected = [
    ...due.slice(0, dueQuota),
    ...unseen.slice(0, newProductQuota),
  ];
  for (const candidate of [
    ...due.slice(dueQuota),
    ...unseen.slice(newProductQuota),
  ]) {
    if (selected.length >= batchSize) break;
    selected.push(candidate);
  }

  let scheduled = 0;
  let alreadyQueued = 0;
  const scheduledByCohort = { due: 0, new: 0 };
  for (const product of selected) {
    const jobId = stableComparisonJobId(product.id);
    const existing = await chinaMarketComparisonQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "failed" || state === "completed") {
        // Terminal BullMQ records retain diagnostics, but a stable ID must be
        // released once the durable comparison row becomes due again.
        await existing.remove();
      } else {
        alreadyQueued += 1;
        continue;
      }
    }
    await chinaMarketComparisonQueue.add(
      "refresh-product",
      {
        productId: product.id,
        sourceId: source.id,
      } satisfies ComparisonJobData,
      {
        jobId,
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
    scheduled += 1;
    scheduledByCohort[product.cohort] += 1;
  }
  return {
    scheduled,
    alreadyQueued,
    scheduledByCohort,
    sourceId: source.id,
  };
}

class RefreshLeaseLostError extends Error {
  constructor() {
    super("China comparison refresh lease was superseded");
    this.name = "RefreshLeaseLostError";
  }
}

type PreparedOffer = {
  offer: RawChinaMarketOffer;
  deterministic: ReturnType<typeof scoreChinaCandidate>;
  ai?: AiCandidateDecision;
  acceptedValue: ReturnType<typeof acceptedOffer>;
  pricingExcluded: boolean;
};

type RefreshSummary = {
  status: "ready" | "insufficient";
  searchKeywords: string[];
  candidateCount: number;
  matchedCount: number;
  referencePriceCny: number | null;
  minPriceCny: number | null;
  maxPriceCny: number | null;
  referenceUrl: string | null;
  referenceTitle: string | null;
  confidence: number | null;
  comparisonMethod: string;
  keywordIdentityHash: string | null;
  providerStats: Prisma.InputJsonObject | typeof Prisma.DbNull;
  observedAt: Date;
  nextRefreshAt: Date;
  lastError: string | null;
};

type RefreshProgress = Pick<
  RefreshSummary,
  "searchKeywords" | "candidateCount" | "matchedCount" | "providerStats"
> & { observedAt: Date | null };

async function acquireRefresh(productId: string, sourceId: string) {
  const refreshToken = randomUUID();
  const now = new Date();
  const refreshLeaseUntil = new Date(now.getTime() + refreshLeaseMs());
  return prisma.$transaction(async (tx) => {
    const comparison = await tx.productMarketComparison.upsert({
      where: { productId_sourceId: { productId, sourceId } },
      update: {},
      create: {
        productId,
        sourceId,
        status: "refreshing",
        refreshToken,
        refreshLeaseUntil,
      },
    });
    if (comparison.refreshToken !== refreshToken) {
      const acquired = await tx.productMarketComparison.updateMany({
        where: {
          id: comparison.id,
          OR: [
            { refreshLeaseUntil: null },
            { refreshLeaseUntil: { lte: now } },
          ],
        },
        data: {
          refreshToken,
          refreshLeaseUntil,
          lastError: null,
        },
      });
      if (acquired.count !== 1) return null;
    }
    // A provider call must never begin without a durable attempt record, and a
    // failure to create that record must not leave a newly acquired lease behind.
    await tx.chinaMarketComparisonRun.create({
      data: {
        comparisonId: comparison.id,
        refreshToken,
        status: "refreshing",
        comparisonMethod: COMPARISON_METHOD,
        startedAt: now,
      },
    });
    return { comparison, refreshToken };
  });
}

async function renewRefreshLease(comparisonId: string, refreshToken: string) {
  const now = new Date();
  const result = await prisma.productMarketComparison.updateMany({
    where: {
      id: comparisonId,
      refreshToken,
      refreshLeaseUntil: { gt: now },
    },
    data: {
      refreshLeaseUntil: new Date(now.getTime() + refreshLeaseMs()),
    },
  });
  return result.count === 1;
}

function startRefreshLeaseHeartbeat(
  comparisonId: string,
  refreshToken: string,
) {
  // Keep the heartbeat short enough for a provider deadline of up to ten
  // minutes, while avoiding a timer per refresh that wakes excessively.
  const intervalMs = Math.min(
    60_000,
    Math.max(5_000, Math.floor(refreshLeaseMs() / 3)),
  );
  const timer = setInterval(() => {
    void renewRefreshLease(comparisonId, refreshToken).catch(() => undefined);
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function publishRefresh(
  comparisonId: string,
  refreshToken: string,
  prepared: PreparedOffer[],
  seenIds: string[],
  summary: RefreshSummary,
  now: Date,
) {
  return prisma.$transaction(async (tx) => {
    const owned = await tx.productMarketComparison.findFirst({
      where: {
        id: comparisonId,
        refreshToken,
        refreshLeaseUntil: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!owned) throw new RefreshLeaseLostError();

    for (const {
      offer,
      deterministic,
      ai,
      acceptedValue,
      pricingExcluded,
    } of prepared) {
      const provenance = offer.provenance;
      if (!provenance)
        throw new ProviderIntegrityError(
          "offer provenance was lost before publish",
        );
      const decision = offerDecision(
        deterministic,
        ai,
        Boolean(acceptedValue),
        pricingExcluded,
      );
      const sourceData = metadataObject(offer.sourceData);
      const data = {
        sourceUrl: offer.sourceUrl,
        titleRaw: offer.titleRaw,
        priceCny: offer.priceCny,
        currency: "CNY",
        imageUrl: offer.imageUrl,
        // Location is not required for identity or pricing and may contain
        // seller-identifying address data from third-party actors.
        location: null,
        condition: offer.conditionRaw,
        status: offer.status,
        matchConfidence: pricingExcluded
          ? null
          : (acceptedValue?.matchConfidence ??
            acceptCandidate(deterministic, ai).confidence),
        matchDecision: decision,
        rejectionReason: pricingExcluded
          ? "价格异常，未进入参考价样本"
          : acceptedValue
            ? null
            : deterministic.reasons.join("；") || null,
        matchEvidence: evidenceObject(deterministic, ai),
        sourceData,
        providerKey: provenance.providerKey,
        providerRunId: provenance.providerRunId,
        queryKeyword: provenance.queryKeyword,
        lastSeenAt: now,
      };
      await tx.comparisonOffer.upsert({
        where: {
          comparisonId_sourceListingId: {
            comparisonId,
            sourceListingId: offer.sourceListingId,
          },
        },
        update: data,
        create: {
          comparisonId,
          sourceListingId: offer.sourceListingId,
          ...data,
        },
      });
    }

    await tx.comparisonOffer.updateMany({
      where: {
        comparisonId,
        ...(seenIds.length ? { sourceListingId: { notIn: seenIds } } : {}),
      },
      data: {
        // A bounded relevance search cannot prove that an absent offer ended.
        // It only removes the offer from the current pricing sample.
        matchDecision: "unmatched",
        matchConfidence: null,
        rejectionReason: seenIds.length
          ? "本次有界搜索未采样"
          : "本次搜索无结果或参考信息不足",
      },
    });
    await tx.comparisonOffer.deleteMany({
      where: {
        comparisonId,
        matchDecision: "unmatched",
        lastSeenAt: { lt: new Date(now.getTime() - offerRetentionMs()) },
      },
    });
    const overflow = await tx.comparisonOffer.findMany({
      where: { comparisonId },
      select: { id: true },
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      skip: maxStoredOffers(),
    });
    if (overflow.length)
      await tx.comparisonOffer.deleteMany({
        where: { id: { in: overflow.map(({ id }) => id) } },
      });

    if (summary.status)
      await tx.crossMarketOpportunity.updateMany({
        where: { comparisonId, status: "ready" },
        data: {
          status: "needs_facts",
          missingFacts: [
            summary.status === "ready"
              ? "comparison_freshness"
              : "comparison_identity",
          ],
          rejectionReason: null,
          evaluatedAt: now,
        },
      });

    const published = await tx.productMarketComparison.updateMany({
      where: {
        id: comparisonId,
        refreshToken,
        refreshLeaseUntil: { gt: new Date() },
      },
      data: {
        ...summary,
        refreshToken: null,
        refreshLeaseUntil: null,
      },
    });
    if (published.count !== 1) throw new RefreshLeaseLostError();
    const completed = await tx.chinaMarketComparisonRun.updateMany({
      where: {
        comparisonId,
        refreshToken,
        status: "refreshing",
        completedAt: null,
      },
      data: {
        status: summary.status,
        searchKeywords: summary.searchKeywords,
        candidateCount: summary.candidateCount,
        matchedCount: summary.matchedCount,
        comparisonMethod: summary.comparisonMethod,
        providerStats: summary.providerStats,
        referencePriceCny: summary.referencePriceCny,
        referenceUrl: summary.referenceUrl,
        observedAt: summary.observedAt,
        completedAt: new Date(),
        sanitizedError: null,
      },
    });
    // A summary without its immutable evidence run is never a successful
    // publication. Throwing rolls back the representative offer and summary.
    if (completed.count !== 1) throw new RefreshLeaseLostError();
    return published;
  });
}

async function failRefresh(
  comparisonId: string,
  refreshToken: string,
  progress: RefreshProgress,
  error: unknown,
) {
  const now = new Date();
  const message = safeError(error);
  await prisma.$transaction(async (tx) => {
    // Do not invalidate a replacement worker's lease or overwrite its summary.
    // An already published run has no refreshToken and cannot be failed here.
    await tx.productMarketComparison.updateMany({
      where: { id: comparisonId, refreshToken },
      data: {
        status: "failed",
        nextRefreshAt: nextFailureRefreshAt(error, now),
        lastError: message,
        refreshToken: null,
        refreshLeaseUntil: null,
      },
    });
    // Losing the comparison lease still permits terminating this attempt, not
    // any other run; immutable completed runs are deliberately excluded.
    await tx.chinaMarketComparisonRun.updateMany({
      where: {
        comparisonId,
        refreshToken,
        status: "refreshing",
        completedAt: null,
      },
      data: {
        ...progress,
        status: "failed",
        comparisonMethod: COMPARISON_METHOD,
        referencePriceCny: null,
        referenceUrl: null,
        completedAt: now,
        sanitizedError: message,
      },
    });
  });
}

export async function refreshChinaMarketComparison(
  productId: string,
  providerContext?: Parameters<typeof xianyuMarketProvider.search>[2],
) {
  if (!xianyuComparisonEnabled())
    return { skipped: "china_market_comparison_disabled" };
  const source = await ensureXianyuSource();
  const acquired = await acquireRefresh(productId, source.id);
  if (!acquired) return { skipped: "refresh_already_in_progress" };
  const { comparison, refreshToken } = acquired;
  let published = false;
  const progress: RefreshProgress = {
    searchKeywords: [],
    candidateCount: 0,
    matchedCount: 0,
    providerStats: Prisma.DbNull,
    observedAt: null,
  };
  const stopLeaseHeartbeat = startRefreshLeaseHeartbeat(
    comparison.id,
    refreshToken,
  );
  try {
    const loaded = await loadProductReference(productId);
    // loadProductReference only returns listings that are still live
    // (not archived, not ignored, active/unknown). A queued refresh whose
    // product has lost every live listing is stale work: record it as
    // insufficient instead of spending a provider search or AI calls on
    // the product's canonical name alone. The dispatcher applies the same
    // live-listing requirement when it enqueues refreshes.
    if (
      !loaded ||
      loaded.product.listings.length === 0 ||
      !loaded.reference.listingTitleRaw.trim()
    ) {
      const now = new Date();
      await publishRefresh(
        comparison.id,
        refreshToken,
        [],
        [],
        {
          status: "insufficient",
          candidateCount: 0,
          matchedCount: 0,
          referencePriceCny: null,
          minPriceCny: null,
          maxPriceCny: null,
          referenceUrl: null,
          referenceTitle: null,
          confidence: null,
          comparisonMethod: COMPARISON_METHOD,
          keywordIdentityHash: null,
          providerStats: Prisma.DbNull,
          searchKeywords: [],
          observedAt: now,
          nextRefreshAt: nextRefreshAt(now),
          lastError: "没有可用于比价的日本来源商品参考",
        },
        now,
      );
      return {
        status: "insufficient",
        candidateCount: 0,
        matchedCount: 0,
        matched: 0,
      };
    }
    const currentKeywordIdentityHash = keywordIdentityHash(loaded.reference);
    const fallback = fallbackChineseKeywords(loaded.reference);
    const previousKeywords = validatedChineseKeywords(
      loaded.reference,
      Array.isArray(comparison.searchKeywords)
        ? comparison.searchKeywords.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    );
    const canReuseKeywords =
      comparison.comparisonMethod === COMPARISON_METHOD &&
      comparison.keywordIdentityHash === currentKeywordIdentityHash &&
      previousKeywords.length >= 3 &&
      previousKeywords.length <= maxSearchKeywords();
    let keywords = previousKeywords;
    if (!canReuseKeywords) {
      let generated: string[] = [];
      try {
        generated = await generateChineseSearchKeywords(
          loaded.reference,
          fallback,
        );
      } catch {
        // The deterministic vocabulary is safer than blocking the whole
        // refresh when the optional keyword model is unavailable.
      }
      const deterministicKeywords = validatedChineseKeywords(
        loaded.reference,
        fallback,
      );
      const generatedKeywords = validatedChineseKeywords(
        loaded.reference,
        Array.isArray(generated)
          ? generated.filter(
              (value): value is string => typeof value === "string",
            )
          : [],
      );
      // Reserve three exact deterministic queries. The model can add useful
      // Chinese variants, but cannot crowd all known identity phrases out of
      // the provider request with eight merely-valid broad phrases.
      keywords = [
        ...new Set([
          ...deterministicKeywords.slice(0, 3),
          ...generatedKeywords,
          ...deterministicKeywords.slice(3),
        ]),
      ].slice(0, maxSearchKeywords());
    }
    progress.searchKeywords = keywords;
    if (keywords.length < 3) {
      const now = new Date();
      await publishRefresh(
        comparison.id,
        refreshToken,
        [],
        [],
        {
          status: "insufficient",
          candidateCount: 0,
          matchedCount: 0,
          referencePriceCny: null,
          minPriceCny: null,
          maxPriceCny: null,
          referenceUrl: null,
          referenceTitle: null,
          confidence: null,
          comparisonMethod: COMPARISON_METHOD,
          keywordIdentityHash: currentKeywordIdentityHash,
          providerStats: Prisma.DbNull,
          searchKeywords: keywords,
          observedAt: now,
          nextRefreshAt: nextRefreshAt(now),
          lastError: "可用的中文检索词不足 3 组",
        },
        now,
      );
      return {
        status: "insufficient",
        candidateCount: 0,
        matchedCount: 0,
        matched: 0,
      };
    }
    const candidateLimit = positiveInteger(
      "XIANYU_COMPARISON_MAX_CANDIDATES",
      40,
      50,
    );
    const providerResult = await xianyuMarketProvider.search(
      keywords,
      candidateLimit,
      providerContext,
    );
    // Treat the provider as an untrusted adapter even though the built-in
    // parser already validates rows. This protects the comparison table when
    // an authorized search service is swapped or returns a malformed object.
    const { offers, providerStats } = verifiedProviderOffers(
      providerResult,
      keywords,
      candidateLimit,
    );
    progress.candidateCount = offers.length;
    progress.providerStats = providerStats;
    progress.observedAt = new Date();
    const ranked = offers
      .map((offer) => ({
        offer,
        deterministic: scoreChinaCandidate(loaded.reference, offer, keywords),
      }))
      .sort(
        (left, right) => right.deterministic.score - left.deterministic.score,
      );
    const aiInput = ranked
      .filter(({ deterministic }) => !deterministic.excluded)
      .slice(0, 12);
    let aiDecisions: AiCandidateDecision[] = [];
    try {
      aiDecisions = completeAiDecisionSet(
        await decideChinaCandidates(loaded.reference, aiInput),
        aiInput.map(({ offer }) => offer.sourceListingId),
      );
    } catch {
      aiDecisions = [];
    }
    const aiById = new Map(
      aiDecisions.map((decision) => [decision.sourceListingId, decision]),
    );
    const accepted = ranked.flatMap(({ offer, deterministic }) => {
      const ai = aiById.get(offer.sourceListingId);
      const value = acceptedOffer(offer, deterministic, ai);
      return value ? [value] : [];
    });
    const priced = robustReferencePrice(accepted);
    progress.matchedCount = priced.retained.length;
    const retainedIds = new Set(
      priced.retained.map((offer) => offer.sourceListingId),
    );
    const seenIds = offers.map((offer) => offer.sourceListingId);
    const now = new Date();
    const prepared = ranked.map(({ offer, deterministic }) => {
      const ai = aiById.get(offer.sourceListingId);
      const acceptedValue = acceptedOffer(offer, deterministic, ai);
      return {
        offer,
        deterministic,
        ai,
        acceptedValue,
        pricingExcluded: Boolean(
          acceptedValue && !retainedIds.has(offer.sourceListingId),
        ),
      };
    });
    if (priced.status === "ready") {
      const confidence =
        priced.retained.reduce((sum, offer) => sum + offer.matchConfidence, 0) /
        priced.retained.length;
      await publishRefresh(
        comparison.id,
        refreshToken,
        prepared,
        seenIds,
        {
          status: "ready",
          searchKeywords: keywords,
          candidateCount: offers.length,
          matchedCount: priced.retained.length,
          referencePriceCny: priced.referencePriceCny,
          minPriceCny: priced.minimumPriceCny,
          maxPriceCny: priced.maximumPriceCny,
          referenceUrl: priced.representative.sourceUrl,
          referenceTitle: priced.representative.titleRaw,
          confidence: Math.max(0, Math.min(1, confidence)),
          comparisonMethod: COMPARISON_METHOD,
          keywordIdentityHash: currentKeywordIdentityHash,
          providerStats,
          observedAt: now,
          nextRefreshAt: nextRefreshAt(now),
          lastError: null,
        },
        now,
      );
      published = true;
      if (crossMarketArbitrageEnabled())
        await chinaMarketComparisonQueue.add(
          "evaluate-arbitrage",
          {
            productId,
            comparisonId: comparison.id,
            observedAt: now.toISOString(),
          } satisfies ComparisonJobData,
          {
            jobId: `evaluate-arbitrage-${comparison.id}-${now.getTime()}`,
            attempts: 4,
            backoff: { type: "exponential", delay: 30_000 },
            removeOnComplete: true,
            removeOnFail: 100,
          },
        );
      return {
        status: "ready",
        candidateCount: offers.length,
        matchedCount: priced.retained.length,
        referencePriceCny: priced.referencePriceCny,
      };
    }
    await publishRefresh(
      comparison.id,
      refreshToken,
      prepared,
      seenIds,
      {
        status: "insufficient",
        searchKeywords: keywords,
        candidateCount: offers.length,
        matchedCount: priced.retained.length,
        referencePriceCny: null,
        minPriceCny: null,
        maxPriceCny: null,
        referenceUrl: null,
        referenceTitle: null,
        confidence: null,
        comparisonMethod: COMPARISON_METHOD,
        keywordIdentityHash: currentKeywordIdentityHash,
        providerStats,
        observedAt: now,
        nextRefreshAt: nextRefreshAt(now),
        lastError: "可信同款在售样本不足 3 条",
      },
      now,
    );
    return {
      status: "insufficient",
      candidateCount: offers.length,
      matchedCount: priced.retained.length,
    };
  } catch (error) {
    // Provider failures (including CAPTCHA/login/risk-control responses) are
    // intentionally terminal for this refresh. Do not mark prior offers as
    // ended: an empty/blocked response is not evidence that listings vanished.
    if (!published)
      await failRefresh(comparison.id, refreshToken, progress, error).catch(
        () => undefined,
      );
    throw error;
  } finally {
    stopLeaseHeartbeat();
  }
}

export async function processChinaMarketComparison(
  job: Job<ComparisonJobData>,
) {
  if (job.name === "dispatch-due") return dispatchChinaMarketComparisons();
  if (job.name === "evaluate-arbitrage") {
    if (!crossMarketArbitrageEnabled())
      return { skipped: "cross_market_arbitrage_disabled" };
    if (!job.data.productId || !job.data.comparisonId)
      return { skipped: "missing_arbitrage_identity" };
    return evaluateAndScheduleCrossMarketArbitrage(
      job.data.productId,
      job.data.comparisonId,
    );
  }
  if (!job.data.productId) return { skipped: "missing_product_id" };
  try {
    return await refreshChinaMarketComparison(job.data.productId, {
      resumeProviderRuns: job.data.providerRuns,
      onProviderRun: async (keyword, runId) => {
        const providerRuns = {
          ...(job.data.providerRuns ?? {}),
          [keyword]: runId,
        };
        job.data.providerRuns = providerRuns;
        await job.updateData({ ...job.data, providerRuns });
      },
      onProviderRunTerminal: async (keyword, runId) => {
        if (job.data.providerRuns?.[keyword] !== runId) return;
        const providerRuns = { ...job.data.providerRuns };
        delete providerRuns[keyword];
        job.data.providerRuns = providerRuns;
        await job.updateData({ ...job.data, providerRuns });
      },
    });
  } catch (error) {
    // Do not retry a provider challenge automatically. Retrying CAPTCHA/login
    // responses can amplify rate limits and would amount to challenge
    // automation; the next scheduled refresh can be attempted after an
    // operator fixes the authorized provider path.
    if (isProviderBlockedError(error) || isProviderRateLimitError(error))
      job.discard();
    throw error;
  }
}

export const chinaComparisonSourceKey = SOURCE_KEY;
