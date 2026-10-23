import { createHash } from "node:crypto";
import { prisma } from "@tokusatsu/db";
import { searchQueue, connection } from "./queues.js";
import { credentialedSourceEnabled } from "./source-activation.js";

const sources = [
  [
    "mandarake",
    "Mandarake",
    "https://order.mandarake.co.jp",
    "MANDARAKE_SEARCH_ENABLED",
  ],
  ["mercari", "Mercari", "https://jp.mercari.com", "MERCARI_SEARCH_ENABLED"],
  [
    "yahoo_auctions",
    "Yahoo! 拍卖",
    "https://auctions.yahoo.co.jp",
    "YAHOO_AUCTIONS_SEARCH_ENABLED",
  ],
  [
    "yahoo_fleamarket",
    "Yahoo! フリマ",
    "https://paypayfleamarket.yahoo.co.jp",
    "YAHOO_FLEAMARKET_SEARCH_ENABLED",
  ],
  ["rakuma", "Rakuma", "https://fril.jp", "RAKUMA_SEARCH_ENABLED"],
  ["surugaya", "骏河屋", "https://www.suruga-ya.jp", "SURUGAYA_SEARCH_ENABLED"],
  ["yahoo_shopping", "Yahoo! Shopping", "https://shopping.yahoo.co.jp", ""],
  ["firecrawl_market", "Firecrawl", "https://api.firecrawl.dev", ""],
  ["apify_ecommerce", "Apify", "https://api.apify.com", ""],
] as const;

export function monitoringSearchJobId(
  keyword: { id: string; updatedAt: Date; intervalMinutes: number },
  sourceKey: string,
  now = Date.now(),
) {
  const revision = createHash("sha256")
    .update(keyword.updatedAt.toISOString())
    .digest("hex")
    .slice(0, 12);
  return `monitor-${keyword.id}-${sourceKey}-${revision}-${Math.floor(now / (keyword.intervalMinutes * 60_000))}`;
}

export async function initializeMonitoringKeywordSources() {
  const hasConfig = (await prisma.monitoringKeyword.count()) > 0;
  if (!hasConfig) return { hasConfig };
  for (const [key, displayName, baseUrl, flag] of sources) {
    const credentialed =
      key === "yahoo_shopping" ||
      key === "firecrawl_market" ||
      key === "apify_ecommerce";
    const enabled =
      process.env.REAL_ADAPTER_ENABLED === "true" &&
      (credentialed
        ? credentialedSourceEnabled(key)
        : key === "mandarake"
          ? process.env[flag] === "true"
          : process.env[flag] !== "false");
    await prisma.source.upsert({
      where: { key },
      update: { enabled },
      create: { key, displayName, baseUrl, enabled, rateLimitMs: 3_000 },
    });
  }
  return { hasConfig };
}

/** Bounded durable queue: at most one pending job per keyword/platform, even
 * when an interval elapses before a previous crawl finishes. */
export async function dispatchMonitoringKeywords() {
  const keywords = await prisma.monitoringKeyword.findMany({
    where: { enabled: true },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
  });
  if (!keywords.length) return { queued: 0, skipped: 0 };
  const enabledSources = await prisma.source.findMany({
    where: {
      enabled: true,
      channel: "online",
      comparisonOnly: false,
      key: { in: sources.map(([key]) => key) },
    },
    select: { key: true },
  });
  const pending = await searchQueue.getJobs(
    ["waiting", "delayed", "prioritized", "active"],
    0,
    -1,
  );
  const covered = new Set(
    pending
      .filter((job) => job.data.monitoringKeywordId)
      .map((job) => `${job.data.monitoringKeywordId}:${job.data.adapterKey}`),
  );
  let queued = 0,
    skipped = 0;
  for (const keyword of keywords) {
    for (const source of enabledSources) {
      if (keyword.sourceKeys.length && !keyword.sourceKeys.includes(source.key))
        continue;
      const pair = `${keyword.id}:${source.key}`;
      if (covered.has(pair)) {
        skipped += 1;
        continue;
      }
      const jobId = monitoringSearchJobId(keyword, source.key);
      const cadenceKey = `monitor-cadence-${keyword.id}-${source.key}-${createHash("sha256").update(keyword.updatedAt.toISOString()).digest("hex").slice(0, 12)}`;
      if (await connection.get(cadenceKey)) {
        skipped += 1;
        continue;
      }
      if (await searchQueue.getJob(jobId)) {
        skipped += 1;
        continue;
      }
      await searchQueue.add(
        "search",
        {
          adapterKey: source.key,
          monitoringKeywordId: keyword.id,
          query: {
            keyword: keyword.keyword,
            limit: 100,
            scanMode: "incremental",
            highPriority: true,
          },
        },
        {
          jobId,
          priority: 10,
          attempts: 3,
          backoff: { type: "exponential", delay: 60_000 },
          removeOnComplete: 1_000,
          removeOnFail: 1_000,
        },
      );
      await connection.set(
        cadenceKey,
        "scheduled",
        "PX",
        keyword.intervalMinutes * 60_000,
      );
      covered.add(pair);
      queued += 1;
    }
  }
  return { queued, skipped };
}

/** Re-read configuration in the transaction: a category edit during a crawl
 * cannot send its result to the old destination. A newer matching rule wins. */
export async function recordMonitoringKeywordMatch(
  itemId: string,
  keywordId: string,
  expectedKeyword?: string,
) {
  return prisma.$transaction(async (tx) => {
    const keyword = await tx.monitoringKeyword.findUnique({
      where: { id: keywordId },
    });
    if (!keyword?.enabled) return null;
    if (
      expectedKeyword !== undefined &&
      keyword.normalizedKeyword !== expectedKeyword
    )
      return null;
    await tx.monitoringKeywordMatch.upsert({
      where: { itemId_keywordId: { itemId, keywordId } },
      create: { itemId, keywordId, matchedKeyword: keyword.keyword },
      update: { matchedKeyword: keyword.keyword, matchedAt: new Date() },
    });
    const winner = await tx.monitoringKeywordMatch.findFirst({
      where: { itemId, keyword: { enabled: true } },
      include: { keyword: true },
      orderBy: [{ keyword: { updatedAt: "desc" } }, { keywordId: "asc" }],
    });
    if (!winner) return null;
    await tx.item.update({
      where: { id: itemId },
      data: { monitoringCategoryId: winner.keyword.categoryId },
    });
    return winner.keyword.categoryId;
  });
}
