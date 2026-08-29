import { Queue } from "bullmq";
import { prisma } from "@tokusatsu/db";
import { Redis } from "ioredis";
import { removePendingAdapterJobs } from "./queue-maintenance.js";

export const connection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  { maxRetriesPerRequest: null },
);
export const searchQueue = new Queue("source-search", { connection });
export const classificationQueue = new Queue("image-classification", {
  connection,
});
export const statusQueue = new Queue("item-status-refresh", { connection });
export const urlAnalysisQueue = new Queue("url-analysis", { connection });
export const maintenanceQueue = new Queue("inventory-maintenance", {
  connection,
});

const DEFAULT_MARKET_KEYWORDS = [
  "仮面ライダー",
  "仮面ライダー まとめ売り",
  "仮面ライダー DX",
  "仮面ライダー ベルト",
  "仮面ライダー ソフビ",
  "仮面ライダー 食玩",
  "仮面ライダー ガシャポン",
  "ウルトラマン",
  "特撮 まとめ売り",
];

function marketKeywords() {
  const configured = process.env.MARKET_KEYWORDS?.split("|")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  return configured?.length ? configured : DEFAULT_MARKET_KEYWORDS;
}

async function removeRepeatJobs(
  prefixes: string[],
  adapterKeys: string[] = [],
) {
  const repeats = await searchQueue.getRepeatableJobs();
  for (const repeat of repeats) {
    let shouldRemove = prefixes.some((prefix) => repeat.id?.startsWith(prefix));

    // BullMQ's RepeatableJob shape exposes the repeat key, but not the
    // original jobId. Read the stored repeat definition so disabled adapters
    // can be removed after a restart instead of continuing to emit failures.
    if (!shouldRemove && adapterKeys.length > 0) {
      const raw = await connection.hget(
        `bull:${searchQueue.name}:repeat:${repeat.key}`,
        "data",
      );
      if (raw) {
        try {
          const data = JSON.parse(raw) as { adapterKey?: string };
          shouldRemove = adapterKeys.includes(data.adapterKey ?? "");
        } catch {
          // Ignore malformed legacy definitions; normal queue scheduling will
          // replace them on the next startup.
        }
      }
    }

    if (shouldRemove) await searchQueue.removeRepeatableByKey(repeat.key);
  }
}

export async function scheduleJobs() {
  await maintenanceQueue.add(
    "archive-stale-items",
    {},
    {
      jobId: "repeat-inventory-cleanup",
      repeat: {
        every: Number(process.env.INVENTORY_CLEANUP_INTERVAL_MS ?? 7_200_000),
      },
      removeOnComplete: 20,
      removeOnFail: 20,
    },
  );
  if (process.env.MOCK_ADAPTER_ENABLED === "true") {
    await prisma.source.updateMany({
      where: { key: "mock" },
      data: { enabled: true, circuitOpenAt: null },
    });
    const mockEvery = Number(process.env.MOCK_SEARCH_INTERVAL_MS ?? 900_000);
    await searchQueue.add(
      "scheduled-search",
      {
        adapterKey: "mock",
        query: { keyword: "仮面ライダー", highPriority: false, limit: 50 },
      },
      {
        jobId: "repeat-mock-normal",
        repeat: { every: mockEvery },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
    await searchQueue.add(
      "bootstrap-search",
      {
        adapterKey: "mock",
        query: { keyword: "仮面ライダー", highPriority: true, limit: 50 },
      },
      {
        jobId: `bootstrap-mock-${Date.now()}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  } else {
    await prisma.source.updateMany({
      where: { key: "mock" },
      data: { enabled: false, circuitOpenAt: null, failureCount: 0 },
    });
    await removeRepeatJobs(["repeat-mock-"], ["mock"]);
    await removePendingAdapterJobs(searchQueue, ["mock"]);
  }

  if (process.env.REAL_ADAPTER_ENABLED === "true") {
    const highEvery = Number(
      process.env.REAL_HIGH_PRIORITY_INTERVAL_MS ?? 600_000,
    );
    const normalEvery = Number(
      process.env.REAL_SEARCH_INTERVAL_MS ?? 1_800_000,
    );
    if (process.env.MANDARAKE_SEARCH_ENABLED === "true") {
      await prisma.source.updateMany({
        where: { key: "mandarake" },
        data: { enabled: true, circuitOpenAt: null },
      });
      await searchQueue.add(
        "scheduled-search",
        {
          adapterKey: "mandarake",
          query: {
            keyword:
              process.env.MANDARAKE_SEARCH_KEYWORD ?? "仮面ライダー まとめ売り",
            highPriority: true,
            limit: 30,
            scanMode: "incremental",
          },
        },
        {
          jobId: "repeat-mandarake-high",
          repeat: { every: highEvery },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );
      await searchQueue.add(
        "scheduled-search",
        {
          adapterKey: "mandarake",
          query: {
            keyword: process.env.MANDARAKE_NORMAL_KEYWORD ?? "仮面ライダー",
            highPriority: false,
            limit: 50,
            scanMode: "incremental",
          },
        },
        {
          jobId: "repeat-mandarake-normal",
          repeat: { every: normalEvery },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );
    } else {
      await prisma.source.updateMany({
        where: { key: "mandarake" },
        data: { enabled: false, circuitOpenAt: null, failureCount: 0 },
      });
      await removeRepeatJobs(["repeat-mandarake-"], ["mandarake"]);
      await removePendingAdapterJobs(searchQueue, ["mandarake"]);
    }

    if (process.env.YAHOO_AUCTIONS_SEARCH_ENABLED !== "false") {
      await prisma.source.updateMany({
        where: { key: "yahoo_auctions" },
        data: { enabled: true, circuitOpenAt: null },
      });
      const keywords = marketKeywords();
      const incrementalKeywords = keywords.slice(
        0,
        Math.min(4, keywords.length),
      );
      const incrementalEvery = Number(
        process.env.MARKET_INCREMENTAL_INTERVAL_MS ?? 900_000,
      );
      const backfillEvery = Number(
        process.env.MARKET_BACKFILL_INTERVAL_MS ?? 10_800_000,
      );
      for (const [index, keyword] of incrementalKeywords.entries()) {
        await searchQueue.add(
          "market-incremental-search",
          {
            adapterKey: "yahoo_auctions",
            query: {
              keyword,
              highPriority: true,
              limit: 30,
              pages: 1,
              pageStart: 0,
              scanMode: "incremental",
            },
          },
          {
            jobId: `repeat-yahoo-incremental-${index}`,
            repeat: {
              every: incrementalEvery,
              offset: Math.floor(
                (index * incrementalEvery) / incrementalKeywords.length,
              ),
            },
            removeOnComplete: 200,
            removeOnFail: 200,
          },
        );
      }
      for (const [index, keyword] of keywords.entries()) {
        await searchQueue.add(
          "market-backfill-search",
          {
            adapterKey: "yahoo_auctions",
            query: {
              keyword,
              highPriority: false,
              limit: 80,
              pages: 2,
              scanMode: "backfill",
              rotatePages: true,
            },
          },
          {
            jobId: `repeat-yahoo-backfill-${index}`,
            repeat: {
              every: backfillEvery,
              offset: Math.floor((index * backfillEvery) / keywords.length),
            },
            removeOnComplete: 300,
            removeOnFail: 300,
          },
        );
      }
      const bootstrapDate = new Date().toISOString().slice(0, 10);
      await searchQueue.add(
        "bootstrap-market-search",
        {
          adapterKey: "yahoo_auctions",
          query: {
            keyword: "仮面ライダー まとめ売り",
            highPriority: true,
            limit: 24,
            pages: 1,
            pageStart: 0,
            scanMode: "incremental",
          },
        },
        {
          jobId: `bootstrap-yahoo-${bootstrapDate}`,
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      );
      for (const [index, keyword] of keywords.entries()) {
        await searchQueue.add(
          "bootstrap-market-backfill",
          {
            adapterKey: "yahoo_auctions",
            query: {
              keyword,
              highPriority: false,
              limit: 50,
              pages: 1,
              pageStart: index < incrementalKeywords.length ? 1 : 0,
              scanMode: "backfill",
              rotatePages: true,
            },
          },
          {
            jobId: `bootstrap-yahoo-backfill-${bootstrapDate}-${index}`,
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        );
      }
    } else {
      await prisma.source.updateMany({
        where: { key: "yahoo_auctions" },
        data: { enabled: false, circuitOpenAt: null, failureCount: 0 },
      });
      await removeRepeatJobs(["repeat-yahoo-"], ["yahoo_auctions"]);
      await removePendingAdapterJobs(searchQueue, ["yahoo_auctions"]);
    }

    const firecrawlEnabled =
      process.env.FIRECRAWL_DISCOVERY_ENABLED === "true" &&
      Boolean(process.env.FIRECRAWL_API_KEY);
    if (firecrawlEnabled) {
      await prisma.source.updateMany({
        where: { key: "firecrawl_market" },
        data: { enabled: true, circuitOpenAt: null },
      });
      const keywords = marketKeywords().slice(0, 5);
      const every = Number(
        process.env.FIRECRAWL_DISCOVERY_INTERVAL_MS ?? 7_200_000,
      );
      for (const [index, keyword] of keywords.entries()) {
        await searchQueue.add(
          "firecrawl-market-discovery",
          {
            adapterKey: "firecrawl_market",
            query: {
              keyword,
              highPriority: false,
              limit: 20,
              scanMode: "incremental",
            },
          },
          {
            jobId: `repeat-firecrawl-market-${index}`,
            repeat: {
              every,
              offset: Math.floor((index * every) / keywords.length),
            },
            removeOnComplete: 200,
            removeOnFail: 200,
          },
        );
      }
    } else {
      await prisma.source.updateMany({
        where: { key: "firecrawl_market" },
        data: { enabled: false, circuitOpenAt: null, failureCount: 0 },
      });
      await removeRepeatJobs(
        ["repeat-firecrawl-market-"],
        ["firecrawl_market"],
      );
      await removePendingAdapterJobs(searchQueue, ["firecrawl_market"]);
    }
  }
}
