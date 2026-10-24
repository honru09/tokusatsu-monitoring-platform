import { createHash } from "node:crypto";
import { Prisma, prisma } from "@tokusatsu/db";
import {
  assessCrossMarketOpportunity,
  crossMarketArbitrageEnabled,
  crossMarketArbitrageConfigFromEnv,
  xianyuReverseSearchEnabled,
} from "@tokusatsu/shared";
import { searchQueue } from "../queues.js";
import { explicitCandidateQuantity } from "./matching.js";

export type CrossMarketOpportunityTrigger =
  | "japan_listing"
  | "xianyu_reverse_search";

export type ArbitrageSearchContext = {
  productId: string;
  comparisonId: string;
  trigger: "xianyu_reverse_search";
};

type JapanReverseSearchReference = {
  canonicalName: string;
  normalizedName: string;
  titleZh?: string | null;
  productLine?: string | null;
  modelNumber?: string | null;
  franchiseNames: string[];
  seriesNames: string[];
  manufacturerNames: string[];
  toyTypeNames: string[];
  listingTitles: string[];
};

const REVERSE_QUERY_FORBIDDEN =
  /(?:https?:\/\/|www\.|求购|收购|高价收|换物|定金|订金|补款|尾款|预售|代购|仅空盒|空盒|零件|单配件|仅配件|拆卖|散件|包邮|秒发|现货|正品|低价|好价|可小刀|不议价)/i;
const JAPANESE_SCRIPT =
  /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const JAPAN_PROCUREMENT_SOURCE_KEYS = new Set([
  "mandarake",
  "mercari",
  "yahoo_auctions",
  "yahoo_fleamarket",
  "yahoo_shopping",
  "rakuma",
  "surugaya",
]);

function finitePositive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function roundedInteger(value: number | null) {
  return value == null ||
    !Number.isFinite(value) ||
    Math.abs(value) > 2_147_483_647
    ? null
    : Math.round(value);
}

function roundedDecimal(value: number | null) {
  return value == null || !Number.isFinite(value)
    ? null
    : Math.round(value * 100) / 100;
}

function entityNames(
  value:
    | { nameZh?: string | null; nameJa?: string | null; nameEn?: string | null }
    | null
    | undefined,
) {
  return [value?.nameJa, value?.nameZh, value?.nameEn].filter(
    (entry): entry is string => Boolean(entry?.trim()),
  );
}

function normalizedKeyword(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** Exact Japanese product identity phrases only. No value, condition or
 * marketing words are allowed to influence the reverse search. */
export function japanReverseSearchKeywords(
  reference: JapanReverseSearchReference,
) {
  const modelNumber = normalizedKeyword(reference.modelNumber ?? "");
  const values = [
    ...reference.listingTitles,
    reference.canonicalName,
    [reference.seriesNames[0], reference.productLine, modelNumber]
      .filter(Boolean)
      .join(" "),
    [reference.franchiseNames[0], reference.productLine, modelNumber]
      .filter(Boolean)
      .join(" "),
    [reference.manufacturerNames[0], reference.productLine, modelNumber]
      .filter(Boolean)
      .join(" "),
    [reference.toyTypeNames[0], modelNumber].filter(Boolean).join(" "),
  ];
  const keywords: string[] = [];
  for (const raw of values) {
    const value = normalizedKeyword(raw);
    if (
      value.length < 2 ||
      value.length > 120 ||
      REVERSE_QUERY_FORBIDDEN.test(value) ||
      (!JAPANESE_SCRIPT.test(value) &&
        (!modelNumber ||
          !value.toLowerCase().includes(modelNumber.toLowerCase())))
    )
      continue;
    if (!keywords.includes(value)) keywords.push(value);
    if (keywords.length === 4) break;
  }
  return keywords;
}

export function enabledJapanReverseSearchAdapters(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (env.REAL_ADAPTER_ENABLED !== "true" || !xianyuReverseSearchEnabled(env))
    return [];
  const adapters: string[] = [];
  if (env.MERCARI_SEARCH_ENABLED !== "false") adapters.push("mercari");
  if (env.YAHOO_AUCTIONS_SEARCH_ENABLED !== "false")
    adapters.push("yahoo_auctions");
  if (env.YAHOO_FLEAMARKET_SEARCH_ENABLED !== "false")
    adapters.push("yahoo_fleamarket");
  if (
    env.YAHOO_SHOPPING_SEARCH_ENABLED !== "false" &&
    Boolean(env.YAHOO_SHOPPING_CLIENT_ID?.trim())
  )
    adapters.push("yahoo_shopping");
  if (env.RAKUMA_SEARCH_ENABLED !== "false") adapters.push("rakuma");
  if (env.SURUGAYA_SEARCH_ENABLED !== "false") adapters.push("surugaya");
  if (env.MANDARAKE_SEARCH_ENABLED === "true") adapters.push("mandarake");
  return adapters;
}

async function loadJapanReverseSearchReference(productId: string) {
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
          deletedAt: null,
          ignored: false,
          status: { in: ["active", "unknown"] },
          source: { comparisonOnly: false },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: 4,
        select: { titleRaw: true },
      },
    },
  });
  if (!product) return null;
  return {
    canonicalName: product.canonicalName,
    normalizedName: product.normalizedName,
    titleZh: product.titleZh,
    productLine: product.productLine,
    modelNumber: product.modelNumber,
    franchiseNames: entityNames(product.franchise),
    seriesNames: entityNames(product.series),
    manufacturerNames: entityNames(product.manufacturerEntity),
    toyTypeNames: entityNames(product.toyTypeEntity),
    listingTitles: product.listings.map(({ titleRaw }) => titleRaw),
  } satisfies JapanReverseSearchReference;
}

export async function scheduleJapanReverseSearch(
  productId: string,
  comparisonId: string,
) {
  if (!xianyuReverseSearchEnabled(process.env))
    return { skipped: "reverse_search_disabled" as const, scheduled: 0 };
  const config = crossMarketArbitrageConfigFromEnv(process.env);
  const [comparison, reference] = await Promise.all([
    prisma.productMarketComparison.findUnique({
      where: { id: comparisonId },
      select: {
        id: true,
        productId: true,
        status: true,
        referencePriceCny: true,
        observedAt: true,
        source: { select: { key: true, comparisonOnly: true } },
      },
    }),
    loadJapanReverseSearchReference(productId),
  ]);
  if (
    !comparison ||
    comparison.productId !== productId ||
    comparison.status !== "ready" ||
    comparison.source.key !== "xianyu" ||
    !comparison.source.comparisonOnly
  )
    return { skipped: "comparison_not_ready" as const, scheduled: 0 };

  const referencePriceCny = finitePositive(comparison.referencePriceCny);
  const adapters = enabledJapanReverseSearchAdapters();
  const keywords = reference ? japanReverseSearchKeywords(reference) : [];
  let reason: string | null = null;
  if (referencePriceCny == null)
    reason = "闲鱼参考价不可用，未触发日本反向搜索";
  else if (referencePriceCny < config.minimumXianyuReferencePriceCny)
    reason = `闲鱼参考价低于 ${config.minimumXianyuReferencePriceCny} CNY 触发门槛`;
  else if (!keywords.length) reason = "缺少可验证的日本商品身份检索词";
  else if (!adapters.length) reason = "日本真实来源爬虫未启用";

  if (reason) {
    await prisma.productMarketComparison.update({
      where: { id: comparison.id },
      data: {
        japanSearchStatus: "skipped",
        japanSearchKeywords: keywords,
        japanSearchTriggeredAt: null,
        japanSearchReason: reason,
      },
    });
    return { skipped: reason, scheduled: 0 };
  }

  const context: ArbitrageSearchContext = {
    productId,
    comparisonId,
    trigger: "xianyu_reverse_search",
  };
  const observedAt = comparison.observedAt?.getTime() ?? Date.now();
  const jobs = adapters.flatMap((adapterKey) =>
    keywords.map((keyword) => {
      const digest = createHash("sha256")
        .update(`${comparisonId}:${observedAt}:${adapterKey}:${keyword}`)
        .digest("hex")
        .slice(0, 24);
      return {
        name: "xianyu-reverse-japan-search",
        data: {
          adapterKey,
          arbitrageContext: context,
          query: {
            keyword,
            highPriority: true,
            limit: 30,
            pages: 1,
            pageStart: 0,
            scanMode: "incremental" as const,
          },
        },
        opts: {
          jobId: `xianyu-reverse-${digest}`,
          attempts: 4,
          backoff: { type: "exponential" as const, delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      };
    }),
  );
  try {
    if (!xianyuReverseSearchEnabled(process.env))
      return { skipped: "reverse_search_disabled" as const, scheduled: 0 };
    await searchQueue.addBulk(jobs);
    await prisma.productMarketComparison.update({
      where: { id: comparison.id },
      data: {
        japanSearchStatus: "scheduled",
        japanSearchKeywords: keywords,
        japanSearchTriggeredAt: new Date(),
        japanSearchReason: `闲鱼参考价 ${referencePriceCny} CNY 达到反向寻货门槛`,
      },
    });
    return { scheduled: jobs.length, adapters, keywords };
  } catch (error) {
    await prisma.productMarketComparison
      .update({
        where: { id: comparison.id },
        data: {
          japanSearchStatus: "failed",
          japanSearchKeywords: keywords,
          japanSearchTriggeredAt: null,
          japanSearchReason: String(error).replace(/\s+/g, " ").slice(0, 500),
        },
      })
      .catch(() => undefined);
    throw error;
  }
}

export async function refreshCrossMarketOpportunityForItem(
  itemId: string,
  comparisonId: string,
  trigger: CrossMarketOpportunityTrigger,
  expectedProductId?: string,
) {
  if (!crossMarketArbitrageEnabled(process.env))
    return { skipped: "cross_market_arbitrage_disabled" as const };
  return prisma.$transaction(async (tx) => {
    // The comparison, both source identities and the Japan listing are one
    // evidence set. Hold shared row locks until the opportunity write commits;
    // an invalidating update must therefore happen before these reads (and be
    // observed below) or after this commit (and invalidate the new row).
    await tx.$queryRaw(
      Prisma.sql`
        SELECT comparison."id"
        FROM "product_market_comparisons" AS comparison
        JOIN "Source" AS comparison_source
          ON comparison_source."id" = comparison."source_id"
        JOIN "Item" AS item ON item."id" = ${itemId}
        JOIN "Source" AS item_source
          ON item_source."id" = item."sourceId"
        WHERE comparison."id" = ${comparisonId}
        FOR SHARE OF comparison, comparison_source, item, item_source
      `,
    );
    await tx.$queryRaw(
      Prisma.sql`
        SELECT offer."id"
        FROM "comparison_offers" AS offer
        JOIN "product_market_comparisons" AS comparison
          ON comparison."id" = offer."comparison_id"
        WHERE comparison."id" = ${comparisonId}
          AND offer."last_seen_at" = comparison."observed_at"
        FOR SHARE OF offer
      `,
    );
    await tx.$queryRaw(
      Prisma.sql`
        SELECT "id"
        FROM "item_logistics"
        WHERE "item_id" = ${itemId}
        FOR SHARE
      `,
    );
    await tx.$queryRaw(
      Prisma.sql`
        SELECT "pair"
        FROM "exchange_rates"
        WHERE "pair" = 'JPY_CNY'
        FOR SHARE
      `,
    );

    const [item, comparison, exchangeRate] = await Promise.all([
      tx.item.findUnique({
        where: { id: itemId },
        include: {
          logistics: true,
          source: { select: { key: true, comparisonOnly: true } },
        },
      }),
      tx.productMarketComparison.findUnique({
        where: { id: comparisonId },
        include: { source: { select: { key: true, comparisonOnly: true } } },
      }),
      tx.exchangeRate.findUnique({ where: { pair: "JPY_CNY" } }),
    ]);
    if (!item || !comparison)
      return { skipped: "missing_item_or_comparison" as const };
    if (
      !item.productId ||
      item.productId !== comparison.productId ||
      (expectedProductId != null && item.productId !== expectedProductId) ||
      item.source.comparisonOnly ||
      !JAPAN_PROCUREMENT_SOURCE_KEYS.has(item.source.key) ||
      comparison.status !== "ready" ||
      comparison.lastError != null ||
      comparison.source.key !== "xianyu" ||
      !comparison.source.comparisonOnly ||
      comparison.comparisonMethod == null ||
      comparison.keywordIdentityHash == null ||
      comparison.providerStats == null ||
      comparison.observedAt == null
    )
      return { skipped: "cross_market_identity_not_verified" as const };

    const comparisonRun = await tx.chinaMarketComparisonRun.findFirst({
      where: {
        comparisonId,
        status: "ready",
        observedAt: comparison.observedAt,
      },
      orderBy: [{ completedAt: "desc" }, { id: "asc" }],
    });
    if (
      !comparisonRun ||
      comparisonRun.referencePriceCny?.toString() !==
        comparison.referencePriceCny?.toString() ||
      comparisonRun.referenceUrl !== comparison.referenceUrl ||
      comparisonRun.comparisonMethod !== comparison.comparisonMethod ||
      comparisonRun.candidateCount !== comparison.candidateCount ||
      comparisonRun.matchedCount !== comparison.matchedCount
    )
      return { skipped: "comparison_run_not_verified" as const };

    const xianyuReferencePriceCny = finitePositive(
      comparison.referencePriceCny,
    );
    if (xianyuReferencePriceCny == null)
      return { skipped: "missing_reference_price" as const };

    const assessedAt = new Date();
    const config = crossMarketArbitrageConfigFromEnv(process.env);
    const assessment = assessCrossMarketOpportunity(
      {
        titleRaw: item.titleRaw,
        listingType: item.listingType,
        categoryToyType: item.categoryToyType,
        conditionGrade: item.conditionGrade,
        priceCurrent: item.priceCurrent,
        shippingFee: item.shippingFee,
        quantityEst: item.quantityEst,
        logistics: item.logistics,
        itemStatus: item.status,
        archived: item.archivedAt != null,
        ignored: item.ignored,
        listingObservedAt: item.lastSeenAt,
        listingMatchDecision: item.matchDecision,
        listingMatchConfidence: item.matchConfidence,
        xianyuReferencePriceCny,
        xianyuMatchedCount: comparison.matchedCount,
        xianyuMatchConfidence: comparison.confidence,
        xianyuObservedAt: comparison.observedAt,
        xianyuQuantity: explicitCandidateQuantity(
          comparison.referenceTitle ?? "",
        ),
        jpyToCnyRate: finitePositive(exchangeRate?.rate),
        exchangeRateFetchedAt: exchangeRate?.fetchedAt,
        evaluatedAt: assessedAt,
      },
      config,
    );
    const expiryTimes = [
      item.lastSeenAt.getTime() + config.maximumListingAgeMs,
      comparison.observedAt.getTime() + config.maximumComparisonAgeMs,
      exchangeRate
        ? exchangeRate.fetchedAt.getTime() + config.maximumExchangeRateAgeMs
        : Number.NaN,
    ];
    const evidenceExpiryMs = Math.min(...expiryTimes);
    const evidenceExpiresAt = Number.isFinite(evidenceExpiryMs)
      ? new Date(evidenceExpiryMs)
      : null;
    const evidence = {
      assessmentVersion: "cross-market-opportunity-v1",
      reasons: assessment.reasons,
      listing: {
        sourceKey: item.source.key,
        sourceItemId: item.sourceItemId,
        sourceUrl: item.sourceUrl,
        titleRaw: item.titleRaw,
        priceCurrent: item.priceCurrent,
        shippingFee: item.shippingFee,
        listingType: item.listingType,
        categoryToyType: item.categoryToyType,
        conditionGrade: item.conditionGrade,
        status: item.status,
        archived: item.archivedAt != null,
        ignored: item.ignored,
        matchDecision: item.matchDecision,
        matchConfidence: item.matchConfidence,
        quantity: item.quantityEst,
        observedAt: item.lastSeenAt.toISOString(),
      },
      comparison: {
        method: comparison.comparisonMethod,
        keywordIdentityHash: comparison.keywordIdentityHash,
        searchKeywords: comparison.searchKeywords,
        candidateCount: comparison.candidateCount,
        matchedCount: comparison.matchedCount,
        confidence: comparison.confidence,
        providerStats: comparison.providerStats,
        observedAt: comparison.observedAt?.toISOString() ?? null,
        referencePriceCny: xianyuReferencePriceCny,
        referenceUrl: comparison.referenceUrl,
        referenceTitle: comparison.referenceTitle,
      },
      exchangeRate: exchangeRate
        ? {
            pair: exchangeRate.pair,
            rate: finitePositive(exchangeRate.rate),
            source: exchangeRate.source,
            referenceDate: exchangeRate.referenceDate
              .toISOString()
              .slice(0, 10),
            fetchedAt: exchangeRate.fetchedAt.toISOString(),
          }
        : null,
      configuration: {
        minimumMatchConfidence: config.minimumMatchConfidence,
        maximumListingAgeMs: config.maximumListingAgeMs,
        maximumComparisonAgeMs: config.maximumComparisonAgeMs,
        maximumExchangeRateAgeMs: config.maximumExchangeRateAgeMs,
      },
    } satisfies Prisma.InputJsonObject;
    const values = {
      productId: item.productId,
      comparisonRunId: comparisonRun.id,
      status: assessment.status,
      xianyuReferencePriceCny,
      jpyToCnyRate: finitePositive(exchangeRate?.rate) ?? null,
      acquisitionCostJpy: roundedInteger(assessment.acquisitionCostJpy),
      grossRevenueJpy: roundedInteger(assessment.grossRevenueJpy),
      grossSpreadCny: roundedDecimal(assessment.grossSpreadCny),
      grossSpreadRatio: Number.isFinite(assessment.grossSpreadRatio)
        ? assessment.grossSpreadRatio
        : null,
      platformFeeJpy: roundedInteger(assessment.platformFeeJpy),
      internationalShippingJpy: roundedInteger(
        assessment.internationalShippingJpy,
      ),
      chinaFulfillmentJpy: roundedInteger(assessment.chinaFulfillmentJpy),
      netProfitJpy: roundedInteger(assessment.netProfitJpy),
      netMarginRatio: Number.isFinite(assessment.netMarginRatio)
        ? assessment.netMarginRatio
        : null,
      missingFacts: assessment.missingFacts,
      rejectionReason:
        assessment.status === "rejected" ? assessment.reasons.join("；") : null,
      evidence,
      listingObservedAt: item.lastSeenAt,
      comparisonObservedAt: comparison.observedAt!,
      exchangeRateFetchedAt: exchangeRate?.fetchedAt ?? null,
      evidenceExpiresAt,
      evaluatedAt: assessedAt,
    };
    if (!crossMarketArbitrageEnabled(process.env))
      return { skipped: "cross_market_arbitrage_disabled" as const };
    const opportunity = await tx.crossMarketOpportunity.upsert({
      where: {
        japanItemId_comparisonId: { japanItemId: item.id, comparisonId },
      },
      update: {
        ...values,
        ...(trigger === "xianyu_reverse_search" ? { trigger } : {}),
      },
      create: {
        japanItemId: item.id,
        comparisonId,
        trigger,
        ...values,
      },
    });
    return { status: opportunity.status, opportunityId: opportunity.id };
  });
}

export async function refreshCrossMarketOpportunitiesForProduct(
  productId: string,
  comparisonId: string,
) {
  if (!crossMarketArbitrageEnabled(process.env))
    return {
      ready: 0,
      rejected: 0,
      needsFacts: 0,
      skipped: 0,
      disabled: true,
    };
  let cursor: string | undefined;
  const counts = { ready: 0, rejected: 0, needsFacts: 0, skipped: 0 };
  for (;;) {
    const items = await prisma.item.findMany({
      where: {
        productId,
        archivedAt: null,
        deletedAt: null,
        ignored: false,
        status: { in: ["active", "unknown"] },
        source: {
          key: { in: [...JAPAN_PROCUREMENT_SOURCE_KEYS] },
          comparisonOnly: false,
        },
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!items.length) break;
    for (const item of items) {
      const outcome = await refreshCrossMarketOpportunityForItem(
        item.id,
        comparisonId,
        "japan_listing",
        productId,
      );
      if ("skipped" in outcome) counts.skipped += 1;
      else if (outcome.status === "ready") counts.ready += 1;
      else if (outcome.status === "rejected") counts.rejected += 1;
      else counts.needsFacts += 1;
    }
    cursor = items.at(-1)!.id;
    if (items.length < 500) break;
  }
  return counts;
}

export async function refreshReadyCrossMarketOpportunitiesForItem(
  itemId: string,
) {
  if (!crossMarketArbitrageEnabled(process.env))
    return { refreshed: 0, disabled: true };
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: {
      productId: true,
      archivedAt: true,
      deletedAt: true,
      ignored: true,
      status: true,
      source: { select: { key: true, comparisonOnly: true } },
    },
  });
  if (
    !item?.productId ||
    item.archivedAt != null ||
    item.deletedAt != null ||
    item.ignored ||
    !["active", "unknown"].includes(item.status) ||
    item.source.comparisonOnly ||
    !JAPAN_PROCUREMENT_SOURCE_KEYS.has(item.source.key)
  )
    return { refreshed: 0 };
  const comparisons = await prisma.productMarketComparison.findMany({
    where: {
      productId: item.productId,
      status: "ready",
      source: { key: "xianyu", comparisonOnly: true },
    },
    select: { id: true },
    orderBy: [{ observedAt: "desc" }, { id: "asc" }],
  });
  for (const comparison of comparisons)
    await refreshCrossMarketOpportunityForItem(
      itemId,
      comparison.id,
      "japan_listing",
      item.productId,
    );
  return { refreshed: comparisons.length };
}

export async function evaluateAndScheduleCrossMarketArbitrage(
  productId: string,
  comparisonId: string,
) {
  if (!crossMarketArbitrageEnabled(process.env))
    return {
      skipped: "cross_market_arbitrage_disabled" as const,
      opportunities: null,
      reverseSearch: null,
    };
  const opportunities = await refreshCrossMarketOpportunitiesForProduct(
    productId,
    comparisonId,
  );
  const reverseSearch = await scheduleJapanReverseSearch(
    productId,
    comparisonId,
  );
  return { opportunities, reverseSearch };
}
