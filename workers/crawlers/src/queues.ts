import { Queue } from "bullmq";
import type { Job } from "bullmq";
import { prisma } from "@tokusatsu/db";
import { auctionRefreshDelay } from "@tokusatsu/shared";
import { Redis } from "ioredis";
import { removePendingAdapterJobs } from "./queue-maintenance.js";

export const connection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  { maxRetriesPerRequest: null },
);
export const searchQueue = new Queue("source-search", {
  connection,
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: "exponential", delay: 30_000 },
  },
});
export const classificationQueue = new Queue("image-classification", {
  connection,
});
export const statusQueue = new Queue("item-status-refresh", { connection });
// Historical Yahoo seller recovery is isolated from ordinary status refreshes
// so a large backlog cannot starve terminal-state checks for live listings.
export const sellerBackfillQueue = new Queue("seller-profile-backfill", {
  connection,
});
export const urlAnalysisQueue = new Queue("url-analysis", { connection });
export const maintenanceQueue = new Queue("inventory-maintenance", {
  connection,
});
export const dislikedMaintenanceQueue = new Queue("disliked-maintenance", {
  connection,
});
export const marketIntelQueue = new Queue("market-intel-refresh", {
  connection,
});
export const titleTranslationQueue = new Queue("title-translation", {
  connection,
});
export const detailTranslationQueue = new Queue("item-detail-translation", {
  connection,
});
export const aiOperationsQueue = new Queue("ai-operations", { connection });

/**
 * Collapse status jobs left by older worker builds. Those builds encoded the
 * due-time bucket in the job id, so every refresh created another pending job
 * for the same item. Keep the earliest pending job per item and remove the
 * rest; queue records are ephemeral and the item/crawl tables remain intact.
 */
export async function compactPendingStatusJobs() {
  const jobs = await statusQueue.getJobs(
    ["waiting", "delayed", "prioritized"],
    0,
    -1,
  );
  const byItem = new Map<string, Job[]>();
  for (const job of jobs) {
    const itemId =
      job.data && typeof job.data === "object" && "itemId" in job.data
        ? String((job.data as { itemId?: unknown }).itemId ?? "")
        : "";
    if (!itemId) continue;
    const bucket = byItem.get(itemId) ?? [];
    bucket.push(job);
    byItem.set(itemId, bucket);
  }
  let removed = 0;
  let migrated = 0;
  for (const [itemId, candidates] of byItem) {
    candidates.sort((left, right) => {
      const leftDue = left.timestamp + Number(left.opts.delay ?? 0);
      const rightDue = right.timestamp + Number(right.opts.delay ?? 0);
      return leftDue - rightDue;
    });
    // Prefer the new stable id when it already exists; otherwise retain the
    // earliest old job and let the next schedule pass replace it.
    const keep =
      candidates.find((job) => job.id === `status-${itemId}`) ?? candidates[0];
    for (const job of candidates) {
      if (job.id === keep.id) continue;
      await job.remove();
      removed += 1;
    }
    const stableId = `status-${itemId}`;
    if (keep.id !== stableId) {
      const data = keep.data as {
        auctionEndAt?: string | Date | null;
      };
      const endAt = data.auctionEndAt ? new Date(data.auctionEndAt) : null;
      const interval = auctionRefreshDelay(endAt);
      // The old queue placed every listing into the same short time bucket.
      // Rephase the retained jobs deterministically across their new cadence
      // so thousands of records do not wake at once after a deployment.
      let hash = 0;
      for (const character of itemId)
        hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
      const delay = Math.floor((hash / 0xffffffff) * interval);
      const jobData = keep.data;
      await keep.remove();
      await statusQueue.add("refresh-status", jobData, {
        delay,
        jobId: stableId,
        attempts: 4,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: true,
      });
      migrated += 1;
    }
  }
  if (removed > 0 || migrated > 0)
    console.log(
      JSON.stringify({
        event: "status_queue_compacted",
        inspected: jobs.length,
        uniqueItems: byItem.size,
        removed,
        migrated,
      }),
    );
  return {
    inspected: jobs.length,
    uniqueItems: byItem.size,
    removed,
    migrated,
  };
}

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

async function scheduleYahooSellerBackfill() {
  const yahooSource = await prisma.source.findUnique({
    where: { key: "yahoo_auctions" },
    select: { id: true },
  });
  if (!yahooSource) return;
  const ungrouped = await prisma.item.findMany({
    where: {
      sourceId: yahooSource.id,
      seller: { name: "Yahoo!オークション出品者" },
      archivedAt: null,
      status: { in: ["active", "unknown"] },
    },
    select: {
      id: true,
      images: { orderBy: { position: "asc" }, take: 1, select: { url: true } },
    },
    take: 5000,
  });
  const publicImageGroups = new Map<string, string[]>();
  for (const item of ungrouped) {
    const accountHash = item.images[0]?.url.match(
      /\/users?\/([a-f0-9]{32,})\//i,
    )?.[1];
    if (!accountHash) continue;
    const ids = publicImageGroups.get(accountHash) ?? [];
    ids.push(item.id);
    publicImageGroups.set(accountHash, ids);
  }
  // Yahoo image URLs expose a stable public /user/<hash>/ directory. Use it
  // only as a provisional grouping key: it accurately separates historical
  // sellers immediately, while the rate-limited detail queue replaces the
  // placeholder with the public display name/profile. No identity is guessed.
  for (const [accountHash, itemIds] of publicImageGroups) {
    const name = `Yahoo!出品者 ${accountHash}（公开资料回补中）`;
    const existing = await prisma.seller.findFirst({
      where: { sourceId: yahooSource.id, name, sourceSellerId: null },
      select: { id: true },
    });
    const seller =
      existing ??
      (await prisma.seller.create({
        data: {
          sourceId: yahooSource.id,
          name,
          sellerType: "unknown",
          sourceData: {
            provisional: true,
            publicImageAccountHash: accountHash,
          },
        },
        select: { id: true },
      }));
    await prisma.item.updateMany({
      where: { id: { in: itemIds } },
      data: { sellerId: seller.id },
    });
  }
  if (publicImageGroups.size > 0)
    console.log(
      JSON.stringify({
        event: "seller_history_grouped_from_public_image_paths",
        sellers: publicImageGroups.size,
        items: [...publicImageGroups.values()].reduce(
          (total, ids) => total + ids.length,
          0,
        ),
      }),
    );
  const sellers = await prisma.seller.findMany({
    where: { source: { key: "yahoo_auctions" } },
    select: {
      id: true,
      name: true,
      sourceData: true,
      items: {
        where: {
          archivedAt: null,
          status: { in: ["active", "unknown"] },
        },
        orderBy: { lastSeenAt: "desc" },
        take: 1,
        select: {
          id: true,
          sourceItemId: true,
          sourceUrl: true,
          status: true,
          auctionEndAt: true,
        },
      },
    },
  });
  const representativeItems = sellers
    .filter((seller) => {
      const data =
        seller.sourceData && typeof seller.sourceData === "object"
          ? (seller.sourceData as Record<string, unknown>)
          : undefined;
      return !data || typeof data.aucUserId !== "string";
    })
    .flatMap((seller) => seller.items);
  const genericItems = await prisma.item.findMany({
    where: {
      source: { key: "yahoo_auctions" },
      seller: { name: "Yahoo!オークション出品者" },
      archivedAt: null,
      status: { in: ["active", "unknown"] },
    },
    select: {
      id: true,
      sourceItemId: true,
      sourceUrl: true,
      status: true,
      auctionEndAt: true,
    },
    take: 5000,
  });
  const unique = new Map(
    [...genericItems, ...representativeItems].map((item) => [item.id, item]),
  );
  const jobs = [...unique.values()].map((item, index) => ({
    name: "backfill-public-seller-profile",
    data: {
      itemId: item.id,
      sourceItemId: item.sourceItemId,
      sourceUrl: item.sourceUrl,
      status: item.status,
      auctionEndAt: item.auctionEndAt,
      adapterKey: "yahoo_auctions",
    },
    opts: {
      // The dedicated queue's limiter controls the crawl pace. Keeping jobs
      // immediately visible lets the queue drain predictably instead of
      // hiding thousands of records behind multi-hour delay timestamps.
      jobId: `seller-profile-backfill-${item.id}`,
      attempts: 4,
      backoff: { type: "exponential" as const, delay: 30_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  }));
  // Remove legacy copies that were scheduled on the shared status queue by
  // older worker builds. Only this exact job name is removed; normal status
  // refreshes remain untouched.
  const legacy = await statusQueue.getJobs(
    ["waiting", "delayed", "prioritized"],
    0,
    -1,
  );
  for (const job of legacy) {
    if (job.name === "backfill-public-seller-profile") await job.remove();
  }
  const staleBackfill = await sellerBackfillQueue.getJobs(
    ["waiting", "delayed", "prioritized"],
    0,
    -1,
  );
  for (const job of staleBackfill) await job.remove();
  // Early Mercari imports predated public seller extraction and were grouped
  // under one generic seller. Revisit each public listing so historical rows
  // receive the same seller ID, profile URL and source payload as new data.
  const mercariSource = await prisma.source.findUnique({
    where: { key: "mercari" },
    select: { id: true },
  });
  if (!mercariSource) return;
  const genericMercariItems = await prisma.item.findMany({
    where: {
      sourceId: mercariSource.id,
      // Early imports used both the plain placeholder and an ID-suffixed
      // placeholder ("Mercari 卖家 123456").  Revisit every active listing
      // carrying either form so historical rows converge on the real public
      // seller instead of leaving a split, incomplete seller directory.
      seller: { name: { startsWith: "Mercari 卖家" } },
      archivedAt: null,
      status: { in: ["active", "unknown"] },
    },
    select: {
      id: true,
      sourceItemId: true,
      sourceUrl: true,
      status: true,
      auctionEndAt: true,
    },
    take: 1000,
  });
  if (genericMercariItems.length > 0) {
    await sellerBackfillQueue.addBulk(
      genericMercariItems.map((item) => ({
        name: "backfill-public-seller-profile",
        data: {
          itemId: item.id,
          sourceItemId: item.sourceItemId,
          sourceUrl: item.sourceUrl,
          status: item.status,
          auctionEndAt: item.auctionEndAt,
          adapterKey: "mercari",
        },
        opts: {
          jobId: `seller-profile-backfill-mercari-${item.id}`,
          attempts: 4,
          backoff: { type: "exponential" as const, delay: 30_000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      })),
    );
    console.log(
      JSON.stringify({
        event: "seller_profile_backfill_scheduled",
        adapter: "mercari",
        jobs: genericMercariItems.length,
      }),
    );
  }
  for (let index = 0; index < jobs.length; index += 250) {
    await sellerBackfillQueue.addBulk(jobs.slice(index, index + 250));
  }
  if (jobs.length > 0)
    console.log(
      JSON.stringify({
        event: "seller_profile_backfill_scheduled",
        jobs: jobs.length,
      }),
    );
}

async function scheduleYahooFleamarketSellerBackfill() {
  const source = await prisma.source.findUnique({
    where: { key: "yahoo_fleamarket" },
    select: { id: true },
  });
  if (!source) return;

  let cursor: string | undefined;
  let scheduled = 0;
  for (;;) {
    const candidates = await prisma.item.findMany({
      where: {
        sourceId: source.id,
        OR: [
          { sellerId: null },
          {
            seller: {
              OR: [
                {
                  name: {
                    in: [
                      "Yahoo!フリマ",
                      "Yahoo！フリマ",
                      "Yahoo!フリマ出品者",
                      "Yahoo！フリマ出品者",
                      "Yahoo!フリマ卖家",
                      "Yahoo！フリマ卖家",
                    ],
                  },
                },
                { name: { startsWith: "Yahoo!フリマ出品者 " } },
                { name: { startsWith: "Yahoo！フリマ出品者 " } },
                { name: { startsWith: "Yahoo!フリマ卖家 " } },
                { name: { startsWith: "Yahoo！フリマ卖家 " } },
              ],
            },
          },
        ],
        archivedAt: null,
        status: { in: ["active", "unknown"] },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        id: true,
        sourceItemId: true,
        sourceUrl: true,
        status: true,
        auctionEndAt: true,
      },
      orderBy: { id: "asc" },
      take: 1000,
    });
    if (!candidates.length) break;
    cursor = candidates.at(-1)?.id;
    for (let index = 0; index < candidates.length; index += 250) {
      const batch = candidates.slice(index, index + 250);
      await sellerBackfillQueue.addBulk(
        batch.map((item) => ({
          name: "backfill-public-seller-profile",
          data: {
            itemId: item.id,
            sourceItemId: item.sourceItemId,
            sourceUrl: item.sourceUrl,
            status: item.status,
            auctionEndAt: item.auctionEndAt,
            adapterKey: "yahoo_fleamarket",
          },
          opts: {
            jobId: `seller-profile-backfill-yahoo-fleamarket-${item.id}`,
            attempts: 4,
            backoff: { type: "exponential" as const, delay: 30_000 },
            // A listing can remain seller-less after a transient detail-page
            // failure. Remove the terminal BullMQ record so the next worker
            // startup can enqueue the same listing again with this stable ID.
            removeOnComplete: true,
            removeOnFail: true,
          },
        })),
      );
      scheduled += batch.length;
    }
  }
  if (scheduled > 0)
    console.log(
      JSON.stringify({
        event: "seller_profile_backfill_scheduled",
        adapter: "yahoo_fleamarket",
        jobs: scheduled,
      }),
    );
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
  await compactPendingStatusJobs();
  // Repeatable jobs created by older worker builds may already have a child
  // instance persisted with attempts=0. BullMQ does not rewrite that child
  // when only the queue defaults change, so rebuild the repeat definitions we
  // own before registering the current schedules. This removes only the
  // delayed repeat instances; active jobs continue uninterrupted.
  await removeRepeatJobs(
    [],
    [
      "mandarake",
      "mercari",
      "yahoo_auctions",
      "yahoo_fleamarket",
      "yahoo_shopping",
      "rakuma",
      "surugaya",
      "firecrawl_market",
      "apify_ecommerce",
    ],
  );
  await scheduleYahooSellerBackfill();
  await scheduleYahooFleamarketSellerBackfill();
  const pendingAiClassification = await prisma.item.findMany({
    where: {
      archivedAt: null,
      ignored: false,
      purchaseRecord: null,
      categoryToyType: { not: "card" },
      images: { some: {} },
      classifications: {
        none: { classifierType: "vision_ai_gateway" },
      },
    },
    select: { id: true, updatedAt: true },
    orderBy: { detectedAt: "desc" },
    take: 10_000,
  });
  for (let index = 0; index < pendingAiClassification.length; index += 500) {
    await classificationQueue.addBulk(
      pendingAiClassification.slice(index, index + 500).map((item) => ({
        name: "classify-images",
        data: { itemId: item.id },
        opts: {
          jobId: `ai-guide-v1-${item.id}-${item.updatedAt.getTime()}`,
          attempts: 4,
          backoff: { type: "exponential" as const, delay: 30_000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      })),
    );
  }
  await titleTranslationQueue.add(
    "translate-existing-product-titles",
    {},
    {
      jobId: "repeat-title-translation",
      repeat: {
        every: Number(process.env.TITLE_TRANSLATION_INTERVAL_MS ?? 15_000),
      },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );
  for (const repeat of await detailTranslationQueue.getRepeatableJobs()) {
    if (repeat.id?.startsWith("repeat-detail-translation"))
      await detailTranslationQueue.removeRepeatableByKey(repeat.key);
  }
  await detailTranslationQueue.add(
    "translate-existing-item-details",
    {},
    {
      jobId: "repeat-detail-translation",
      repeat: {
        every: Number(process.env.DETAIL_TRANSLATION_INTERVAL_MS ?? 15_000),
      },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );
  if (
    (await prisma.item.count({
      where: {
        archivedAt: null,
        ignored: false,
        categoryToyType: { not: "card" },
        translationStatus: { not: "completed" },
      },
    })) > 0
  ) {
    await detailTranslationQueue.add(
      "bootstrap-item-detail-translation",
      { reason: "pending-existing-item-details" },
      {
        jobId: `bootstrap-detail-translation-${new Date().toISOString().slice(0, 13)}`,
        removeOnComplete: 20,
        removeOnFail: 20,
      },
    );
  }
  if (
    (await prisma.item.count({
      where: {
        titleZh: null,
        archivedAt: null,
        ignored: false,
        purchaseRecord: null,
        status: { in: ["active", "unknown"] },
      },
    })) > 0
  ) {
    await titleTranslationQueue.add(
      "bootstrap-title-translation",
      { reason: "pending-existing-items" },
      {
        jobId: `bootstrap-title-translation-${new Date().toISOString().slice(0, 13)}`,
        removeOnComplete: 20,
        removeOnFail: 20,
      },
    );
  }
  await marketIntelQueue.add(
    "refresh-public-market-intelligence",
    {},
    {
      jobId: "repeat-market-intel-hourly",
      repeat: {
        every: Number(process.env.MARKET_INTEL_INTERVAL_MS ?? 3_600_000),
      },
      removeOnComplete: 50,
      removeOnFail: 50,
    },
  );
  await aiOperationsQueue.add(
    "refresh-market-memory",
    {},
    {
      jobId: "repeat-ai-market-memory",
      repeat: {
        every: Number(process.env.AI_MEMORY_REFRESH_INTERVAL_MS ?? 86_400_000),
      },
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: 30,
      removeOnFail: 30,
    },
  );
  await aiOperationsQueue.add(
    "bootstrap-market-memory",
    { requestedAt: new Date().toISOString() },
    {
      jobId: `bootstrap-ai-memory-${new Date().toISOString().slice(0, 10)}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: 10,
      removeOnFail: 10,
    },
  );
  // Repeat jobs wait for their first interval.  An empty installation should
  // populate the intelligence workspace immediately instead of showing an
  // empty screen for the first hour.
  if ((await prisma.marketIntel.count()) === 0) {
    await marketIntelQueue.add(
      "bootstrap-public-market-intelligence",
      { requestedAt: new Date().toISOString(), reason: "empty-database" },
      {
        jobId: "bootstrap-market-intel-initial-v1",
        removeOnComplete: 50,
        removeOnFail: 50,
      },
    );
  }
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
  await dislikedMaintenanceQueue.add(
    "purge-disliked-warehouse",
    {},
    {
      jobId: "repeat-disliked-cleanup",
      repeat: { every: 86_400_000 },
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

    if (process.env.MERCARI_SEARCH_ENABLED !== "false") {
      await prisma.source.updateMany({
        where: { key: "mercari" },
        data: { enabled: true, circuitOpenAt: null },
      });
      const mercariEvery = Number(
        process.env.MERCARI_SEARCH_INTERVAL_MS ?? 1_800_000,
      );
      const keywords = marketKeywords().slice(0, 6);
      for (const [index, keyword] of keywords.entries()) {
        await searchQueue.add(
          "mercari-search",
          {
            adapterKey: "mercari",
            query: {
              keyword,
              highPriority: false,
              limit: 30,
              scanMode: "incremental",
            },
          },
          {
            jobId: `repeat-mercari-${index}`,
            repeat: {
              every: mercariEvery,
              offset: Math.floor((index * mercariEvery) / keywords.length),
            },
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        );
      }
      await searchQueue.add(
        "mercari-bootstrap",
        {
          adapterKey: "mercari",
          query: {
            keyword: "仮面ライダー",
            highPriority: true,
            limit: 30,
            scanMode: "incremental",
          },
        },
        {
          jobId: `bootstrap-mercari-${new Date().toISOString().slice(0, 10)}`,
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      );
    } else {
      await prisma.source.updateMany({
        where: { key: "mercari" },
        data: { enabled: false, circuitOpenAt: null, failureCount: 0 },
      });
      await removeRepeatJobs(["repeat-mercari-"], ["mercari"]);
      await removePendingAdapterJobs(searchQueue, ["mercari"]);
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

    if (process.env.YAHOO_FLEAMARKET_SEARCH_ENABLED !== "false") {
      await prisma.source.updateMany({
        where: { key: "yahoo_fleamarket" },
        data: { enabled: true, circuitOpenAt: null },
      });
      const every = Number(
        process.env.YAHOO_FLEAMARKET_SEARCH_INTERVAL_MS ?? 3_600_000,
      );
      const keywords = marketKeywords().slice(0, 4);
      for (const [index, keyword] of keywords.entries()) {
        await searchQueue.add(
          "yahoo-fleamarket-search",
          {
            adapterKey: "yahoo_fleamarket",
            query: {
              keyword,
              highPriority: index === 0,
              limit: 30,
              pages: 1,
              scanMode: "incremental",
            },
          },
          {
            jobId: `repeat-yahoo-fleamarket-${index}`,
            repeat: {
              every,
              offset: Math.floor((index * every) / keywords.length),
            },
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        );
      }
      const fleaBackfillEvery = Number(
        process.env.YAHOO_FLEAMARKET_BACKFILL_INTERVAL_MS ?? 21_600_000,
      );
      for (const [index, keyword] of keywords.entries()) {
        await searchQueue.add(
          "yahoo-fleamarket-backfill",
          {
            adapterKey: "yahoo_fleamarket",
            query: {
              keyword,
              highPriority: false,
              limit: 20,
              pages: 1,
              scanMode: "backfill",
              rotatePages: true,
            },
          },
          {
            jobId: `repeat-yahoo-fleamarket-backfill-${index}`,
            repeat: {
              every: fleaBackfillEvery,
              offset: Math.floor((index * fleaBackfillEvery) / keywords.length),
            },
            removeOnComplete: 200,
            removeOnFail: 200,
          },
        );
      }
      await searchQueue.add(
        "yahoo-fleamarket-bootstrap",
        {
          adapterKey: "yahoo_fleamarket",
          query: {
            keyword: "仮面ライダー",
            highPriority: true,
            limit: 24,
            pages: 1,
            scanMode: "incremental",
          },
        },
        {
          jobId: `bootstrap-yahoo-fleamarket-${new Date().toISOString().slice(0, 10)}`,
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      );
    } else {
      await prisma.source.updateMany({
        where: { key: "yahoo_fleamarket" },
        data: { enabled: false, circuitOpenAt: null, failureCount: 0 },
      });
      await removeRepeatJobs(
        ["repeat-yahoo-fleamarket-"],
        ["yahoo_fleamarket"],
      );
      await removePendingAdapterJobs(searchQueue, ["yahoo_fleamarket"]);
    }

    const yahooShoppingEnabled =
      process.env.YAHOO_SHOPPING_SEARCH_ENABLED !== "false" &&
      Boolean(process.env.YAHOO_SHOPPING_CLIENT_ID?.trim());
    if (yahooShoppingEnabled) {
      await prisma.source.updateMany({
        where: { key: "yahoo_shopping" },
        data: { enabled: true, circuitOpenAt: null },
      });
      const every = Number(
        process.env.YAHOO_SHOPPING_SEARCH_INTERVAL_MS ?? 7_200_000,
      );
      const keywords = marketKeywords().slice(0, 4);
      for (const [index, keyword] of keywords.entries()) {
        await searchQueue.add(
          "yahoo-shopping-search",
          {
            adapterKey: "yahoo_shopping",
            query: {
              keyword,
              highPriority: index === 0,
              limit: 50,
              pages: 1,
              scanMode: "incremental",
            },
          },
          {
            jobId: `repeat-yahoo-shopping-${index}`,
            repeat: {
              every,
              offset: Math.floor((index * every) / keywords.length),
            },
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        );
      }
      await searchQueue.add(
        "yahoo-shopping-bootstrap",
        {
          adapterKey: "yahoo_shopping",
          query: {
            keyword: "仮面ライダー",
            highPriority: true,
            limit: 50,
            pages: 1,
            scanMode: "incremental",
          },
        },
        {
          jobId: `bootstrap-yahoo-shopping-${new Date().toISOString().slice(0, 10)}`,
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      );
    } else {
      await prisma.source.updateMany({
        where: { key: "yahoo_shopping" },
        data: { enabled: false, circuitOpenAt: null, failureCount: 0 },
      });
      await removeRepeatJobs(["repeat-yahoo-shopping-"], ["yahoo_shopping"]);
      await removePendingAdapterJobs(searchQueue, ["yahoo_shopping"]);
    }

    if (process.env.RAKUMA_SEARCH_ENABLED !== "false") {
      await prisma.source.updateMany({
        where: { key: "rakuma" },
        data: { enabled: true, circuitOpenAt: null },
      });
      const every = Number(process.env.RAKUMA_SEARCH_INTERVAL_MS ?? 7_200_000);
      const keywords = marketKeywords().slice(0, 3);
      for (const [index, keyword] of keywords.entries()) {
        await searchQueue.add(
          "rakuma-search",
          {
            adapterKey: "rakuma",
            query: {
              keyword,
              highPriority: index === 0,
              limit: 24,
              pages: 1,
              scanMode: "incremental",
            },
          },
          {
            jobId: `repeat-rakuma-${index}`,
            repeat: {
              every,
              offset: Math.floor((index * every) / keywords.length),
            },
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        );
      }
      const rakumaBackfillEvery = Number(
        process.env.RAKUMA_BACKFILL_INTERVAL_MS ?? 28_800_000,
      );
      for (const [index, keyword] of keywords.entries()) {
        await searchQueue.add(
          "rakuma-backfill",
          {
            adapterKey: "rakuma",
            query: {
              keyword,
              highPriority: false,
              limit: 16,
              pages: 1,
              scanMode: "backfill",
              rotatePages: true,
            },
          },
          {
            jobId: `repeat-rakuma-backfill-${index}`,
            repeat: {
              every: rakumaBackfillEvery,
              offset: Math.floor(
                (index * rakumaBackfillEvery) / keywords.length,
              ),
            },
            removeOnComplete: 200,
            removeOnFail: 200,
          },
        );
      }
      await searchQueue.add(
        "rakuma-bootstrap",
        {
          adapterKey: "rakuma",
          query: {
            keyword: "仮面ライダー",
            highPriority: true,
            limit: 20,
            pages: 1,
            scanMode: "incremental",
          },
        },
        {
          jobId: `bootstrap-rakuma-${new Date().toISOString().slice(0, 10)}`,
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      );
    } else {
      await prisma.source.updateMany({
        where: { key: "rakuma" },
        data: { enabled: false, circuitOpenAt: null, failureCount: 0 },
      });
      await removeRepeatJobs(["repeat-rakuma-"], ["rakuma"]);
      await removePendingAdapterJobs(searchQueue, ["rakuma"]);
    }

    if (process.env.SURUGAYA_SEARCH_ENABLED !== "false") {
      await prisma.source.updateMany({
        where: { key: "surugaya" },
        data: { enabled: true, circuitOpenAt: null },
      });
      const every = Number(
        process.env.SURUGAYA_SEARCH_INTERVAL_MS ?? 10_800_000,
      );
      const keywords = [
        "仮面ライダー",
        "仮面ライダー まとめ売り",
        "ウルトラマン",
      ];
      for (const [index, keyword] of keywords.entries()) {
        await searchQueue.add(
          "surugaya-catalogue-search",
          {
            adapterKey: "surugaya",
            query: {
              keyword,
              highPriority: index === 0,
              limit: 40,
              pages: 1,
              scanMode: "backfill",
              rotatePages: true,
            },
          },
          {
            jobId: `repeat-surugaya-${index}`,
            repeat: {
              every,
              offset: Math.floor((index * every) / keywords.length),
            },
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        );
      }
      await searchQueue.add(
        "surugaya-bootstrap",
        {
          adapterKey: "surugaya",
          query: {
            keyword: "仮面ライダー",
            highPriority: true,
            limit: 30,
            pages: 1,
            pageStart: 0,
            scanMode: "incremental",
          },
        },
        {
          jobId: `bootstrap-surugaya-${new Date().toISOString().slice(0, 10)}`,
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      );
    } else {
      await prisma.source.updateMany({
        where: { key: "surugaya" },
        data: { enabled: false, circuitOpenAt: null, failureCount: 0 },
      });
      await removeRepeatJobs(["repeat-surugaya-"], ["surugaya"]);
      await removePendingAdapterJobs(searchQueue, ["surugaya"]);
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

    const apifyEnabled =
      process.env.APIFY_ECOMMERCE_ENABLED === "true" &&
      Boolean(process.env.APIFY_TOKEN);
    if (apifyEnabled) {
      await prisma.source.updateMany({
        where: { key: "apify_ecommerce" },
        data: { enabled: true, circuitOpenAt: null },
      });
      const keywords = marketKeywords().slice(0, 4);
      const every = Number(
        process.env.APIFY_DISCOVERY_INTERVAL_MS ?? 21_600_000,
      );
      for (const [index, keyword] of keywords.entries()) {
        await searchQueue.add(
          "apify-ecommerce-discovery",
          {
            adapterKey: "apify_ecommerce",
            query: { keyword, limit: 30, scanMode: "incremental" },
          },
          {
            jobId: `repeat-apify-ecommerce-${index}`,
            repeat: {
              every,
              offset: Math.floor((index * every) / keywords.length),
            },
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        );
      }
    } else {
      await prisma.source.updateMany({
        where: { key: "apify_ecommerce" },
        data: { enabled: false, circuitOpenAt: null, failureCount: 0 },
      });
      await removeRepeatJobs(["repeat-apify-ecommerce-"], ["apify_ecommerce"]);
      await removePendingAdapterJobs(searchQueue, ["apify_ecommerce"]);
    }
  }
}
