import { classifyImages } from "@tokusatsu/classification";
import { prisma, Prisma } from "@tokusatsu/db";
import { matchOrCreateProduct } from "@tokusatsu/product-intelligence";
import {
  auctionRefreshDelay,
  isExcludedCollectibleText,
} from "@tokusatsu/shared";
import type {
  NormalizedItem,
  SearchQuery,
  SourceAdapter,
} from "@tokusatsu/shared";
import type { Job } from "bullmq";
import { createHash } from "node:crypto";
import { ApifyEcommerceAdapter } from "./adapters/apify-ecommerce.adapter.js";
import { FirecrawlMarketplaceAdapter } from "./adapters/firecrawl-market.adapter.js";
import { MandarakeAdapter } from "./adapters/mandarake.adapter.js";
import { MercariAdapter } from "./adapters/mercari.adapter.js";
import { MockAdapter } from "./adapters/mock.adapter.js";
import { PlaywrightPageAdapter } from "./adapters/playwright-page.adapter.js";
import { PublicPageAdapter } from "./adapters/public-page.adapter.js";
import { YahooAuctionsAdapter } from "./adapters/yahoo-auctions.adapter.js";
import { classificationQueue, connection, statusQueue } from "./queues.js";

const adapters: Record<string, SourceAdapter> = {
  mock: new MockAdapter(),
  mandarake: new MandarakeAdapter(),
  mercari: new MercariAdapter(),
  yahoo_auctions: new YahooAuctionsAdapter(),
  firecrawl_market: new FirecrawlMarketplaceAdapter(),
  apify_ecommerce: new ApifyEcommerceAdapter(),
  public_page: new PublicPageAdapter(),
  playwright_page: new PlaywrightPageAdapter(),
};

type SearchMetrics = {
  candidates: number;
  inserted: number;
  skippedKnown: number;
  imagesBackfilled: number;
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
      select: { id: true, sourceItemId: true, imageCount: true },
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
    }
    for (const result of results) {
      const known = existingBySourceId.get(result.sourceItemId);
      if (known) {
        if (known.imageCount <= 1) {
          try {
            const raw = await adapter.fetchDetail(result);
            const normalized = await adapter.normalize(raw);
            if (
              !isExcludedCollectibleText(
                normalized.titleRaw,
                normalized.descriptionRaw,
              )
            ) {
              const added = await appendItemImages(
                known.id,
                normalized.imageUrls,
              );
              if (added > 0) metrics.imagesBackfilled += added;
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
        if (
          isExcludedCollectibleText(
            normalized.titleRaw,
            normalized.descriptionRaw,
          )
        )
          continue;
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
  const urls = imageUrls.filter(
    (url, index, all) => url && all.indexOf(url) === index,
  );
  if (urls.length === 0) return 0;
  await prisma.itemImage.createMany({
    data: urls.map((url, position) => ({ itemId, url, position })),
    skipDuplicates: true,
  });
  const imageCount = await prisma.itemImage.count({ where: { itemId } });
  await prisma.item.update({ where: { id: itemId }, data: { imageCount } });
  return urls.length;
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
    if (
      isExcludedCollectibleText(normalized.titleRaw, normalized.descriptionRaw)
    )
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

async function persistNormalized(
  sourceId: string,
  item: NormalizedItem,
  favorite = false,
  importOrigin: "search" | "url" = "search",
) {
  const seller = item.sellerName
    ? await prisma.seller.upsert({
        where: { sourceId_name: { sourceId, name: item.sellerName } },
        update: {
          sellerType: item.sellerType ?? "unknown",
          locationText: item.locationText,
        },
        create: {
          sourceId,
          name: item.sellerName,
          sellerType: item.sellerType ?? "unknown",
          locationText: item.locationText,
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
      bidCount: item.bidCount,
      conditionRaw: item.conditionRaw,
      categoryIp: item.categoryIp,
      categoryToyType: item.categoryToyType,
      manufacturer: item.manufacturer,
      conditionGrade: item.conditionGrade,
      channel: item.channel,
      quantityEst: item.quantityEst,
      imageCount: item.imageUrls.length,
      unitCostEst: item.unitCostEst,
      confidence: item.confidence,
      needsReview: item.needsReview,
      status: item.status,
      importOrigin,
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
      bidCount: item.bidCount,
      conditionRaw: item.conditionRaw,
      categoryIp: item.categoryIp,
      categoryToyType: item.categoryToyType,
      manufacturer: item.manufacturer,
      conditionGrade: item.conditionGrade,
      channel: item.channel,
      quantityEst: item.quantityEst,
      imageCount: item.imageUrls.length,
      unitCostEst: item.unitCostEst,
      confidence: item.confidence,
      needsReview: item.needsReview,
      status: item.status,
      favorite,
      importOrigin,
    },
  });
  await prisma.itemImage.createMany({
    data: item.imageUrls.map((url, position) => ({
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
    latest.bidCount !== item.bidCount
  ) {
    await prisma.itemPriceHistory.create({
      data: {
        itemId: saved.id,
        priceCurrent: item.priceCurrent,
        shippingFee: item.shippingFee,
        bidCount: item.bidCount,
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

async function scheduleStatus(
  itemId: string,
  sourceItemId: string,
  sourceUrl: string,
  status: string,
  auctionEndAt: Date | null,
  adapterKey: string,
) {
  const delay = auctionRefreshDelay(auctionEndAt);
  await statusQueue.add(
    "refresh-status",
    { itemId, sourceItemId, sourceUrl, status, auctionEndAt, adapterKey },
    {
      delay,
      jobId: `status-${itemId}-${Math.floor((Date.now() + delay) / 30_000)}`,
      attempts: 4,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );
}

export async function processClassification(job: Job<{ itemId: string }>) {
  const item = await prisma.item.findUnique({
    where: { id: job.data.itemId },
    include: { images: { orderBy: { position: "asc" } } },
  });
  if (!item) return { skipped: "missing_item" };
  const { provider, result } = await classifyImages({
    title: item.titleRaw,
    description: item.descriptionRaw,
    imageUrls: item.images.map((image) => image.url),
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
        classifierType: "vision",
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
  return { provider, confidence: result.confidence, conflict, needsReview };
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
  });
  if (!current) return { skipped: "missing_item" };
  const update = await adapter.refreshStatus({
    sourceItemId: job.data.sourceItemId,
    sourceUrl: job.data.sourceUrl,
    status: job.data.status as "active",
    auctionEndAt: job.data.auctionEndAt
      ? new Date(job.data.auctionEndAt)
      : null,
  });
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
      bidCount: update.bidCount ?? current.bidCount,
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
        bidCount: update.bidCount ?? current.bidCount,
      },
    });
  }
  if (update.status === "active")
    await scheduleStatus(
      current.id,
      current.sourceItemId,
      current.sourceUrl,
      update.status,
      auctionEndAt,
      job.data.adapterKey,
    );
  return update;
}

/** Archives terminal listings every two hours while keeping purchase history intact. */
export async function processCleanup() {
  const now = new Date();
  const terminal = await prisma.item.findMany({
    where: {
      archivedAt: null,
      OR: [
        { status: { in: ["sold", "ended"] } },
        { auctionEndAt: { lt: new Date(now.getTime() - 2 * 60 * 60 * 1000) } },
      ],
    },
    select: { id: true },
    take: 5000,
  });
  const terminalIds = terminal.map((item) => item.id);
  if (terminalIds.length) {
    await prisma.$transaction([
      prisma.item.updateMany({
        where: { id: { in: terminalIds } },
        data: { archivedAt: now },
      }),
      prisma.itemImage.deleteMany({
        where: { itemId: { in: terminalIds }, item: { purchaseRecord: null } },
      }),
    ]);
  }
  const exclusionCandidates = await prisma.item.findMany({
    where: {
      purchaseRecord: null,
    },
    select: {
      id: true,
      titleRaw: true,
      descriptionRaw: true,
      categoryToyType: true,
    },
    take: 5000,
  });
  const excludedIds = exclusionCandidates
    .filter(
      (item) =>
        item.categoryToyType === "card" ||
        isExcludedCollectibleText(item.titleRaw, item.descriptionRaw ?? ""),
    )
    .map((item) => item.id);
  if (excludedIds.length)
    await prisma.item.deleteMany({
      where: { id: { in: excludedIds } },
    });
  const orphanProducts = await prisma.product.deleteMany({
    where: { listings: { none: {} }, inventory: null },
  });
  return {
    archived: terminalIds.length,
    removedExcluded: excludedIds.length,
    removedOrphanProducts: orphanProducts.count,
    cleanedAt: now.toISOString(),
  };
}

/** Permanently removes the separate not-interested warehouse after one day. */
export async function processDislikedCleanup() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stale = await prisma.item.findMany({
    where: {
      ignored: true,
      ignoredAt: { lt: cutoff },
      purchaseRecord: null,
    },
    select: { id: true },
    take: 5000,
  });
  const ids = stale.map((item) => item.id);
  if (!ids.length) return { removed: 0, cleanedAt: new Date().toISOString() };
  const result = await prisma.item.deleteMany({ where: { id: { in: ids } } });
  return { removed: result.count, cleanedAt: new Date().toISOString() };
}
