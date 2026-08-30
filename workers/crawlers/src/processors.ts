import { classifyImages } from "@tokusatsu/classification";
import { prisma, Prisma } from "@tokusatsu/db";
import { matchOrCreateProduct } from "@tokusatsu/product-intelligence";
import {
  auctionRefreshDelay,
  isExcludedNormalizedItem,
} from "@tokusatsu/shared";
import type {
  NormalizedItem,
  SearchQuery,
  SearchResult,
  SourceAdapter,
} from "@tokusatsu/shared";
import type { Job } from "bullmq";
import { createHash } from "node:crypto";
import { ApifyEcommerceAdapter } from "./adapters/apify-ecommerce.adapter.js";
import { FirecrawlMarketplaceAdapter } from "./adapters/firecrawl-market.adapter.js";
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
import { YahooFleamarketAdapter } from "./adapters/yahoo-fleamarket.adapter.js";
import { YahooShoppingAdapter } from "./adapters/yahoo-shopping.adapter.js";
import { classificationQueue, connection, statusQueue } from "./queues.js";

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

type SearchMetrics = {
  candidates: number;
  inserted: number;
  skippedKnown: number;
  imagesBackfilled: number;
  recordsEnriched: number;
  detailFailed: number;
  pageStart: number;
  pages: number;
  scanMode: "incremental" | "backfill";
  errors: string[];
};

function sourceBaseUrl(adapterKey: string): string {
  if (adapterKey === "mandarake") return "https://order.mandarake.co.jp";
  if (adapterKey === "mercari") return "https://jp.mercari.com";
  if (adapterKey === "yahoo_auctions") return "https://auctions.yahoo.co.jp";
  if (adapterKey === "yahoo_fleamarket")
    return "https://paypayfleamarket.yahoo.co.jp";
  if (adapterKey === "rakuma") return "https://fril.jp";
  if (adapterKey === "surugaya") return "https://www.suruga-ya.jp";
  if (adapterKey === "firecrawl_market") return "https://api.firecrawl.dev";
  if (adapterKey === "apify_ecommerce") return "https://api.apify.com";
  if (adapterKey === "public_page") return "https://public.example";
  return "https://example.com/mock";
}

async function resolveSearchQuery(adapterKey: string, query: SearchQuery) {
  if (!query.rotatePages) return query;
  const pages = Math.max(1, Math.min(query.pages ?? 1, 8));
  const maxPages = Math.max(
    pages,
    Number(process.env.MARKET_BACKFILL_MAX_PAGES ?? 80),
  );
  const digest = createHash("sha256")
    .update(`${adapterKey}:${query.keyword}`)
    .digest("hex")
    .slice(0, 20);
  const key = `market-backfill-cursor:${digest}`;
  const storedCursor = await connection.get(key);
  const current = Number(storedCursor ?? query.pageStart ?? 0);
  const pageStart = Number.isFinite(current) ? current % maxPages : 0;
  await connection.set(key, String((pageStart + pages) % maxPages));
  return { ...query, pageStart };
}

export async function processSearch(
  job: Job<{ adapterKey: string; query: SearchQuery }>,
) {
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
  if (
    source.circuitOpenAt &&
    Date.now() - source.circuitOpenAt.getTime() < 15 * 60 * 1000
  ) {
    throw new Error(`Circuit open for ${adapter.key}`);
  }

  const effectiveQuery = await resolveSearchQuery(
    job.data.adapterKey,
    job.data.query,
  );
  const metrics: SearchMetrics = {
    candidates: 0,
    inserted: 0,
    skippedKnown: 0,
    imagesBackfilled: 0,
    recordsEnriched: 0,
    detailFailed: 0,
    pageStart: effectiveQuery.pageStart ?? 0,
    pages: effectiveQuery.pages ?? 1,
    scanMode: effectiveQuery.scanMode ?? "incremental",
    errors: [],
  };
  const crawlJob = await prisma.crawlJob.create({
    data: {
      sourceId: source.id,
      queueJobId: String(job.id),
      jobType: "search",
      query: effectiveQuery as unknown as Prisma.InputJsonValue,
      status: "running",
      startedAt: new Date(),
      attempt: job.attemptsMade + 1,
    },
  });
  try {
    const results = await adapter.search(effectiveQuery);
    metrics.candidates = results.length;
    if (results.length === 0 && metrics.scanMode === "incremental") {
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
        imageCount: true,
        sourceData: true,
        descriptionRaw: true,
        shippingFee: true,
        sellerId: true,
        seller: { select: { name: true, profileUrl: true, sourceData: true } },
      },
    });
    const existingBySourceId = new Map(
      existing.map((item) => [item.sourceItemId, item]),
    );
    const existingIds = new Set(existingBySourceId.keys());
    metrics.skippedKnown = existingIds.size;
    if (existingIds.size > 0) {
      await prisma.item.updateMany({
        where: {
          sourceId: source.id,
          sourceItemId: { in: [...existingIds] },
        },
        data: { lastSeenAt: new Date() },
      });
      const confirmedActiveIds = results
        .filter((result) => result.detailHint?.status === "active")
        .map((result) => result.sourceItemId)
        .filter((sourceItemId) => existingIds.has(sourceItemId));
      if (confirmedActiveIds.length > 0) {
        // A marketplace search constrained to on-sale inventory is stronger
        // evidence than a stale page-shell status. Re-open only ordinary
        // listings; ignored and purchased records stay in their own areas.
        await prisma.item.updateMany({
          where: {
            sourceId: source.id,
            sourceItemId: { in: confirmedActiveIds },
            ignored: false,
            purchaseRecord: null,
          },
          data: {
            status: "active",
            archivedAt: null,
            lastSeenAt: new Date(),
          },
        });
      }
    }
    let enrichmentBudget = 16;
    for (const result of results) {
      const known = existingBySourceId.get(result.sourceItemId);
      if (known) {
        const needsEnrichment =
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
        if (needsEnrichment && enrichmentBudget > 0) {
          enrichmentBudget -= 1;
          try {
            const raw = await adapter.fetchDetail(result);
            const normalized = await adapter.normalize(raw);
            if (isExcludedNormalizedItem(normalized)) {
              await prisma.item.update({
                where: { id: known.id },
                data: { archivedAt: new Date(), lastSeenAt: new Date() },
              });
            } else {
              const added = await enrichKnownItem(
                source.id,
                known.id,
                normalized,
              );
              if (added > 0) metrics.imagesBackfilled += added;
              metrics.recordsEnriched += 1;
            }
          } catch (error) {
            if (metrics.errors.length < 8)
              metrics.errors.push(
                `${result.sourceItemId}: image backfill ${String(error).slice(0, 260)}`,
              );
          }
        }
        continue;
      }
      try {
        const raw = await adapter.fetchDetail(result);
        const normalized = await adapter.normalize(raw);
        if (isExcludedNormalizedItem(normalized)) {
          continue;
        }
        await persistNormalized(source.id, normalized);
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
  }
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
function sellerMetadata(item: NormalizedItem) {
  const sourceData = item.sellerData ?? item.sourceData;
  if (!sourceData || typeof sourceData !== "object") {
    return { sourceData: undefined, profileUrl: undefined };
  }
  const value = sourceData as Record<string, unknown>;
  const profileUrl = [
    item.sellerProfileUrl,
    value.sellerProfileUrl,
    value.sellerUrl,
    value.profileUrl,
  ].find(
    (candidate): candidate is string =>
      typeof candidate === "string" && /^https?:\/\//i.test(candidate),
  );
  return {
    sourceData: sourceData as Prisma.InputJsonValue,
    profileUrl,
  };
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
  const sellerMeta = sellerMetadata(item);
  const seller = item.sellerName
    ? await prisma.seller.upsert({
        where: { sourceId_name: { sourceId, name: item.sellerName } },
        update: {
          sellerType: item.sellerType ?? "unknown",
          locationText: item.locationText,
          sourceData: sellerMeta.sourceData,
          profileUrl: sellerMeta.profileUrl,
        },
        create: {
          sourceId,
          name: item.sellerName,
          sellerType: item.sellerType ?? "unknown",
          locationText: item.locationText,
          sourceData: sellerMeta.sourceData,
          profileUrl: sellerMeta.profileUrl,
        },
      })
    : null;
  await prisma.item.update({
    where: { id: itemId },
    data: {
      sourceUrl: item.sourceUrl,
      titleRaw: item.titleRaw,
      descriptionRaw: item.descriptionRaw,
      sellerId: seller?.id,
      locationText: item.locationText,
      priceCurrent: item.priceCurrent,
      shippingFee: item.shippingFee,
      priceTotalEst: item.priceTotalEst,
      listedAt: item.listedAt,
      lastSeenAt: new Date(),
      auctionEndAt: item.auctionEndAt,
      listingType: item.auctionEndAt ? "auction" : "direct",
      bidCount: safeBidCount(item.bidCount),
      conditionRaw: item.conditionRaw,
      categoryIp: item.categoryIp,
      categoryToyType: item.categoryToyType,
      manufacturer: item.manufacturer,
      conditionGrade: item.conditionGrade,
      channel: item.channel,
      quantityEst: item.quantityEst,
      unitCostEst: item.unitCostEst,
      confidence: item.confidence,
      needsReview: item.needsReview,
      status: item.status,
      sourceData: item.sourceData as Prisma.InputJsonValue | undefined,
      ...resetItemTranslation(),
    },
  });
  await persistLogisticsHints(itemId, item.sourceData);
  return appendItemImages(itemId, item.imageUrls);
}

function positiveNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined;
}

/** Persist dimensions/weight discovered in public structured data without
 * overwriting operator-entered logistics values. */
async function persistLogisticsHints(itemId: string, sourceData: unknown) {
  if (!sourceData || typeof sourceData !== "object") return;
  const root = sourceData as Record<string, unknown>;
  const hints =
    root.logisticsHints && typeof root.logisticsHints === "object"
      ? (root.logisticsHints as Record<string, unknown>)
      : null;
  if (!hints) return;
  const values = {
    weightGrams: positiveNumber(hints.weightGrams),
    lengthMm: positiveNumber(hints.lengthMm),
    widthMm: positiveNumber(hints.widthMm),
    heightMm: positiveNumber(hints.heightMm),
  };
  if (!Object.values(values).some((value) => value != null)) return;
  const existing = await prisma.itemLogistics.findUnique({ where: { itemId } });
  const dimensions = [values.lengthMm, values.widthMm, values.heightMm];
  const volumeCm3 = dimensions.every((value) => value != null)
    ? Math.round((dimensions[0]! * dimensions[1]! * dimensions[2]!) / 1000)
    : undefined;
  await prisma.itemLogistics.upsert({
    where: { itemId },
    create: { itemId, ...values, volumeCm3 },
    update: {
      weightGrams: existing?.weightGrams ?? values.weightGrams,
      lengthMm: existing?.lengthMm ?? values.lengthMm,
      widthMm: existing?.widthMm ?? values.widthMm,
      heightMm: existing?.heightMm ?? values.heightMm,
      volumeCm3: existing?.volumeCm3 ?? volumeCm3,
    },
  });
}

export async function processUrlAnalysis(
  job: Job<{ adapterKey: string; sourceUrl: string; importId?: string }>,
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
  if (job.data.importId) {
    await prisma.urlImport.update({
      where: { id: job.data.importId },
      data: {
        status: "running",
        progress: 10,
        currentStep: "正在读取公开商品页",
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
    const saved = await persistNormalized(source.id, normalized, false, "url");
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
  }
}

type EnrichmentCandidate = {
  sourceData?: unknown;
  descriptionRaw?: string | null;
  sellerId?: string | null;
  seller?: {
    name: string;
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
      !!current.seller?.name.match(/^Mercari 卖家(?: \d+)?$/)) ||
    (adapterKey === "yahoo_fleamarket" &&
      current.seller?.name === "Yahoo!フリマ出品者") ||
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
  importOrigin: "search" | "url" = "search",
) {
  const imageUrls = sanitizeProductImageUrls(item.imageUrls);
  const sellerMeta = sellerMetadata(item);
  const seller = item.sellerName
    ? await prisma.seller.upsert({
        where: { sourceId_name: { sourceId, name: item.sellerName } },
        update: {
          sellerType: item.sellerType ?? "unknown",
          locationText: item.locationText,
          sourceData: sellerMeta.sourceData,
          profileUrl: sellerMeta.profileUrl,
        },
        create: {
          sourceId,
          name: item.sellerName,
          sellerType: item.sellerType ?? "unknown",
          locationText: item.locationText,
          sourceData: sellerMeta.sourceData,
          profileUrl: sellerMeta.profileUrl,
        },
      })
    : null;

  const saved = await prisma.item.upsert({
    where: {
      sourceId_sourceItemId: { sourceId, sourceItemId: item.sourceItemId },
    },
    update: {
      sourceUrl: item.sourceUrl,
      titleRaw: item.titleRaw,
      descriptionRaw: item.descriptionRaw,
      sellerId: seller?.id,
      locationText: item.locationText,
      priceCurrent: item.priceCurrent,
      shippingFee: item.shippingFee,
      priceTotalEst: item.priceTotalEst,
      listedAt: item.listedAt,
      lastSeenAt: new Date(),
      auctionEndAt: item.auctionEndAt,
      listingType: item.auctionEndAt ? "auction" : "direct",
      bidCount: safeBidCount(item.bidCount),
      conditionRaw: item.conditionRaw,
      categoryIp: item.categoryIp,
      categoryToyType: item.categoryToyType,
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
      sourceItemId: item.sourceItemId,
      sourceUrl: item.sourceUrl,
      titleRaw: item.titleRaw,
      descriptionRaw: item.descriptionRaw,
      sellerId: seller?.id,
      locationText: item.locationText,
      priceCurrent: item.priceCurrent,
      shippingFee: item.shippingFee,
      priceTotalEst: item.priceTotalEst,
      listedAt: item.listedAt,
      detectedAt: new Date(),
      lastSeenAt: new Date(),
      auctionEndAt: item.auctionEndAt,
      listingType: item.auctionEndAt ? "auction" : "direct",
      bidCount: safeBidCount(item.bidCount),
      conditionRaw: item.conditionRaw,
      categoryIp: item.categoryIp,
      categoryToyType: item.categoryToyType,
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
  await persistLogisticsHints(saved.id, item.sourceData);
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
  await classificationQueue.add(
    "classify-images",
    { itemId: saved.id },
    {
      jobId: `vision-${saved.id}-${saved.updatedAt.getTime()}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );
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

export async function processClassification(job: Job<{ itemId: string }>) {
  const item = await prisma.item.findUnique({
    where: { id: job.data.itemId },
    include: { images: { orderBy: { position: "asc" } } },
  });
  if (!item) return { skipped: "missing_item" };
  const bulkFilter = await executeAiTask("bulk_filter", item.id, 1_200, [
    {
      role: "system",
      content:
        '你是特摄中古商品初筛员。仅依据输入判断是否属于假面骑士、奥特曼或其他特摄玩具，是否为批量出售、书籍、杂志、漫画、卡片或明显无关商品。不得猜测。只输出 JSON：{"relevant":true或false,"scope":"tokusatsu_toy|excluded_card_or_book|unrelated|unknown","bulkSale":true或false或null,"productType":"...或unknown","quantity":数字或null,"informationCompleteness":"complete|partial|poor","shouldAnalyze":true或false,"confidence":0到1,"evidence":["依据"]}。',
    },
    {
      role: "user",
      content: JSON.stringify({
        title: item.titleRaw,
        description: item.descriptionRaw,
        priceJpy: item.priceCurrent,
        imageCount: item.images.length,
      }),
    },
  ]);
  if (bulkFilter) {
    await prisma.itemClassification.create({
      data: {
        itemId: item.id,
        classifierType: "ai_bulk_filter",
        modelVersion: bulkFilter.model,
        result: bulkFilter.data as Prisma.InputJsonValue,
        confidence: numberConfidence(bulkFilter.data.confidence),
        conflict: false,
      },
    });
    if (
      bulkFilter.data.scope === "excluded_card_or_book" &&
      numberConfidence(bulkFilter.data.confidence) >= 0.9
    ) {
      await prisma.item.update({
        where: { id: item.id },
        data: { archivedAt: new Date(), needsReview: false },
      });
      return { skipped: "ai_out_of_scope", model: bulkFilter.model };
    }
  }

  const textClassification = await executeAiTask(
    "classification",
    item.id,
    3_000,
    [
      {
        role: "system",
        content:
          '你是日本特摄中古商品数据管理员。完整翻译并结构化输入，不得把不知道的内容补成事实。输出 titleZh、descriptionZh，以及 series、subSeries、productType、brand、condition、bulkSale、quantity、needsImageAnalysis；结构字段必须为 {"value":值或null,"confidence":0到1,"evidence":["原文依据"]}。quantity 若为估算必须另给 quantityEstimate {"exact":null,"estimatedRange":{"min":数字,"max":数字},"evidence":["依据"]}，不得把估算范围写成精确数量。还要输出 confidence（整体0到1）。书籍、杂志、漫画和卡片用 scope="excluded_card_or_book"。只输出 JSON。',
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
  if (textClassification) {
    await prisma.$transaction([
      prisma.itemClassification.create({
        data: {
          itemId: item.id,
          classifierType: "ai_text_classification",
          modelVersion: textClassification.model,
          result: textClassification.data as Prisma.InputJsonValue,
          confidence: textConfidence,
          conflict: false,
        },
      }),
      prisma.item.update({
        where: { id: item.id },
        data: {
          titleZh:
            typeof textClassification.data.titleZh === "string" &&
            textClassification.data.titleZh.trim()
              ? textClassification.data.titleZh.trim()
              : item.titleZh,
          descriptionZh:
            typeof textClassification.data.descriptionZh === "string" &&
            textClassification.data.descriptionZh.trim()
              ? textClassification.data.descriptionZh.trim()
              : item.descriptionZh,
          fieldConfidences: textFieldConfidences(textClassification.data),
          extractionEvidence: {
            text: textClassification.data,
            previous: item.extractionEvidence ?? null,
          } as Prisma.InputJsonValue,
          needsReview: item.needsReview || textConfidence < 0.9,
        },
      }),
    ]);
  }
  const descriptiveText = `${item.titleRaw} ${item.descriptionRaw ?? ""}`;
  const highValueThreshold = Number(
    process.env.AI_IMAGE_HIGH_VALUE_THRESHOLD_JPY ?? 20_000,
  );
  const requiresImageAnalysis =
    item.images.length > 0 &&
    (item.titleRaw.trim().length < 24 ||
      /写真参照|画像参照|まとめ売り|大量|セット|一式|詳細不明/i.test(
        descriptiveText,
      ) ||
      (item.quantityEst ?? 0) >= 5 ||
      item.categoryToyType === "unknown" ||
      item.confidence < 0.7 ||
      textConfidence < 0.7 ||
      evidenceBoolean(textClassification?.data.needsImageAnalysis) ||
      item.priceCurrent >= highValueThreshold);
  if (
    textClassification?.data.scope === "excluded_card_or_book" &&
    textConfidence >= 0.9
  ) {
    await prisma.item.update({
      where: { id: item.id },
      data: { archivedAt: new Date(), needsReview: false },
    });
    return { skipped: "ai_out_of_scope", model: textClassification.model };
  }
  if (textConfidence < 0.7) {
    await upsertAiReview(
      item,
      "text:低置信度，等待图片或高级模型复核",
      textClassification?.data,
    );
  }
  if (!requiresImageAnalysis) {
    await prisma.itemClassification.create({
      data: {
        itemId: item.id,
        classifierType: "vision_ai_gateway",
        modelVersion: "not_required_v1",
        result: {
          skipped: "text_evidence_sufficient",
          imageCount: item.images.length,
        },
        confidence: item.confidence,
        conflict: false,
      },
    });
    return { skipped: "text_evidence_sufficient" };
  }
  const { provider, result } = await classifyImages({
    title: item.titleRaw,
    description: item.descriptionRaw,
    imageUrls: item.images.map((image) => image.url),
    itemId: item.id,
  });
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
  await prisma.$transaction([
    prisma.itemClassification.create({
      data: {
        itemId: item.id,
        classifierType: "vision_ai_gateway",
        modelVersion: provider,
        result: result as unknown as Prisma.InputJsonValue,
        confidence: result.confidence,
        conflict,
      },
    }),
    prisma.item.update({
      where: { id: item.id },
      data: {
        needsReview: item.needsReview || needsReview,
        extractionEvidence: {
          text: item.extractionEvidence ?? null,
          vision: result,
        } as unknown as Prisma.InputJsonValue,
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
  if (conflict || item.priceCurrent >= highValueThreshold) {
    const advanced = await executeAiTask(
      conflict ? "cross_validation" : "complex_analysis",
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

type AiTaskName =
  | "bulk_filter"
  | "classification"
  | "complex_analysis"
  | "cross_validation";

async function executeAiTask(
  task: AiTaskName,
  itemId: string,
  maxTokens: number,
  messages: Array<{ role: "system" | "user"; content: string }>,
) {
  const token = process.env.AI_INTERNAL_TOKEN?.trim();
  if (!token) return null;
  const apiBase = (
    process.env.API_INTERNAL_URL ?? "http://localhost:3001"
  ).replace(/\/$/, "");
  const response = await fetch(`${apiBase}/ai/internal/execute`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ai-internal-token": token,
    },
    body: JSON.stringify({ task, itemId, maxTokens, messages }),
    signal: AbortSignal.timeout(
      Math.max(30_000, Number(process.env.AI_TIMEOUT_MS ?? 120_000) + 15_000),
    ),
  });
  if (!response.ok) return null;
  return (await response.json()) as {
    data: Record<string, unknown>;
    model: string;
  };
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

function textFieldConfidences(value: Record<string, unknown>) {
  return Object.fromEntries(
    [
      "series",
      "subSeries",
      "productType",
      "brand",
      "condition",
      "bulkSale",
      "quantity",
      "needsImageAnalysis",
    ].map((field) => {
      const raw = value[field];
      const confidence =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? numberConfidence((raw as Record<string, unknown>).confidence)
          : 0;
      return [field, confidence];
    }),
  ) as Prisma.InputJsonValue;
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
      seller: { select: { name: true, profileUrl: true, sourceData: true } },
    },
  });
  if (!current) return { skipped: "missing_item" };
  const shouldEnrich = needsCompleteEnrichment(current, job.data.adapterKey);
  let update;
  if (shouldEnrich) {
    try {
      let detailCandidate: SearchResult = {
        sourceItemId: job.data.sourceItemId,
        sourceUrl: job.data.sourceUrl,
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
          pickExactMercariBackfillResult(job.data.sourceItemId, results) ??
          detailCandidate;
      }
      const normalized = await adapter.normalize(
        await adapter.fetchDetail(detailCandidate),
      );
      if (isExcludedNormalizedItem(normalized)) {
        await prisma.item.update({
          where: { id: current.id },
          data: { archivedAt: new Date(), lastSeenAt: new Date() },
        });
        return { skipped: "out_of_scope" };
      }
      await enrichKnownItem(current.sourceId, current.id, normalized);
      update = {
        status: normalized.status,
        priceCurrent: normalized.priceCurrent,
        shippingFee: normalized.shippingFee,
        auctionEndAt: normalized.auctionEndAt,
        bidCount: safeBidCount(normalized.bidCount),
      };
    } catch {
      // Terminal detail pages often no longer contain enough data for a full
      // enrichment. Let the adapter's status contract turn public 404/410 or
      // missing-price pages into sold/ended instead of retrying forever.
      update = await adapter.refreshStatus({
        sourceItemId: job.data.sourceItemId,
        sourceUrl: job.data.sourceUrl,
        status: job.data.status as "active",
        auctionEndAt: job.data.auctionEndAt
          ? new Date(job.data.auctionEndAt)
          : null,
      });
    }
  } else {
    update = await adapter.refreshStatus({
      sourceItemId: job.data.sourceItemId,
      sourceUrl: job.data.sourceUrl,
      status: job.data.status as "active",
      auctionEndAt: job.data.auctionEndAt
        ? new Date(job.data.auctionEndAt)
        : null,
    });
  }
  const priceCurrent = update.priceCurrent ?? current.priceCurrent;
  const shippingFee = update.shippingFee ?? current.shippingFee;
  const auctionEndAt = update.auctionEndAt ?? current.auctionEndAt;
  await prisma.item.update({
    where: { id: current.id },
    data: {
      status: update.status,
      priceCurrent,
      shippingFee,
      priceTotalEst: priceCurrent + (shippingFee ?? 0),
      auctionEndAt,
      bidCount: safeBidCount(update.bidCount) ?? current.bidCount,
      lastSeenAt: new Date(),
    },
  });
  if (
    priceCurrent !== current.priceCurrent ||
    shippingFee !== current.shippingFee ||
    update.bidCount !== current.bidCount
  ) {
    await prisma.itemPriceHistory.create({
      data: {
        itemId: current.id,
        priceCurrent,
        shippingFee,
        bidCount: safeBidCount(update.bidCount) ?? current.bidCount,
      },
    });
  }
  return update;
}

/** Archives terminal listings every two hours while keeping purchase history intact. */
export async function processCleanup() {
  const now = new Date();
  // A process/container restart can leave the historical CrawlJob row in
  // `running` forever.  No supported crawl should run for multiple hours;
  // close only clearly stale rows so the monitoring dashboard reflects the
  // actual worker state without touching a legitimate long backfill.
  const staleRunning = await prisma.crawlJob.updateMany({
    where: {
      status: "running",
      startedAt: { lt: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
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
        OR: [
          { status: { in: ["sold", "ended"] } },
          {
            auctionEndAt: { lt: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
          },
        ],
      },
      select: { id: true },
      take: 5000,
    });
    if (!terminal.length) break;
    const ids = terminal.map((item) => item.id);
    await prisma.$transaction([
      prisma.item.updateMany({
        where: { id: { in: ids } },
        data: { archivedAt: now },
      }),
      prisma.itemImage.deleteMany({
        where: { itemId: { in: ids }, item: { purchaseRecord: null } },
      }),
    ]);
    archived += ids.length;
  }
  let removedExcluded = 0;
  let exclusionCursor: string | undefined;
  for (;;) {
    const exclusionCandidates = await prisma.item.findMany({
      where: {
        purchaseRecord: null,
        ...(exclusionCursor ? { id: { gt: exclusionCursor } } : {}),
      },
      select: {
        id: true,
        titleRaw: true,
        descriptionRaw: true,
        categoryToyType: true,
      },
      orderBy: { id: "asc" },
      take: 5000,
    });
    if (!exclusionCandidates.length) break;
    exclusionCursor = exclusionCandidates.at(-1)?.id;
    const excludedIds = exclusionCandidates
      .filter((item) =>
        isExcludedNormalizedItem({
          ...item,
          descriptionRaw: item.descriptionRaw ?? undefined,
        }),
      )
      .map((item) => item.id);
    if (excludedIds.length) {
      const result = await prisma.item.deleteMany({
        where: { id: { in: excludedIds } },
      });
      removedExcluded += result.count;
    }
  }
  const orphanProducts = await prisma.product.deleteMany({
    where: { listings: { none: {} }, inventory: null },
  });
  const images = await backfillMissingItemImages();
  const sellerProfiles = await backfillExplicitMercariProfileUrls();
  return {
    staleRunsClosed: staleRunning.count,
    archived,
    removedExcluded,
    removedOrphanProducts: orphanProducts.count,
    imagesBackfilled: images.recovered,
    imageRowsCorrected: images.correctedEmpty,
    mercariProfilesBackfilled: sellerProfiles,
    cleanedAt: now.toISOString(),
  };
}

/** Permanently removes the separate not-interested warehouse after one day. */
export async function processDislikedCleanup() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let removed = 0;
  let cursor: string | undefined;
  for (;;) {
    const stale = await prisma.item.findMany({
      where: {
        ignored: true,
        ignoredAt: { lt: cutoff },
        purchaseRecord: null,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 5000,
    });
    if (!stale.length) break;
    cursor = stale.at(-1)?.id;
    const result = await prisma.item.deleteMany({
      where: { id: { in: stale.map((item) => item.id) } },
    });
    removed += result.count;
  }
  return { removed, cleanedAt: new Date().toISOString() };
}
