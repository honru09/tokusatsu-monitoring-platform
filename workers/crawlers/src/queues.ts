import { Queue } from "bullmq";
import type { Job } from "bullmq";
import { prisma } from "@tokusatsu/db";
import {
  auctionRefreshDelay,
  SHF_SEARCH_KEYWORDS,
  SIC_SEARCH_KEYWORDS,
} from "@tokusatsu/shared";
import { Redis } from "ioredis";
import { removePendingAdapterJobs } from "./queue-maintenance.js";
import { xianyuComparisonEnabled } from "./china-market/xianyu.provider.js";
import {
  automaticClassificationContentVersion,
  classificationJobId,
  shouldAbortAiJobForItem,
  shouldQueueAutomaticClassification,
} from "./automatic-classification.js";
import {
  automaticBackgroundAiEnabled,
  automaticPaidAiEnabled,
} from "./background-ai-guard.js";
import { credentialedSourceEnabled } from "./source-activation.js";
import { STATUS_REFRESH_SLA_MS } from "./status-refresh-policy.js";
import { initializeMonitoringKeywordSources } from "./monitoring-keywords.js";

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
/**
 * China-market comparison jobs are intentionally isolated from source-search:
 * they read canonical Products and write only comparison tables.
 */
export const chinaMarketComparisonQueue = new Queue("china-market-comparison", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 60_000 },
  },
});
export const titleTranslationQueue = new Queue("title-translation", {
  connection,
});
export const detailTranslationQueue = new Queue("item-detail-translation", {
  connection,
});
export const aiOperationsQueue = new Queue("ai-operations", { connection });

function statusRefreshDelayBudget(
  auctionEndAt: Date | null | undefined,
  lastSeenAt: Date | null | undefined,
  now = Date.now(),
) {
  const interval = Math.min(
    auctionRefreshDelay(auctionEndAt),
    STATUS_REFRESH_SLA_MS,
  );
  const verifiedAt = lastSeenAt?.getTime();
  const age = Number.isFinite(verifiedAt)
    ? Math.max(0, now - verifiedAt!)
    : interval;
  // An overdue listing must not get another full cadence merely because the
  // worker restarted. Spread stale checks over at most five minutes.
  return age >= interval ? Math.min(interval, 5 * 60_000) : interval - age;
}

function phasedStatusRefreshDelay(
  itemId: string,
  auctionEndAt: Date | null | undefined,
  lastSeenAt: Date | null | undefined,
  now = Date.now(),
) {
  const interval = statusRefreshDelayBudget(auctionEndAt, lastSeenAt, now);
  let hash = 0;
  for (const character of itemId)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return Math.floor((hash / 0xffffffff) * interval);
}

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
  const malformed: Job[] = [];
  for (const job of jobs) {
    const itemId =
      job.data && typeof job.data === "object" && "itemId" in job.data
        ? String((job.data as { itemId?: unknown }).itemId ?? "")
        : "";
    if (!itemId) {
      malformed.push(job);
      continue;
    }
    const bucket = byItem.get(itemId) ?? [];
    bucket.push(job);
    byItem.set(itemId, bucket);
  }
  let removed = 0;
  let migrated = 0;
  for (const job of malformed) {
    await job.remove();
    removed += 1;
  }
  if (byItem.size === 0)
    return {
      inspected: jobs.length,
      uniqueItems: 0,
      removed,
      migrated,
    };

  const activeItemsById = new Map<
    string,
    { id: string; lastSeenAt: Date; auctionEndAt: Date | null; listingType: string }
  >();
  const pendingItemIds = [...byItem.keys()];
  for (let index = 0; index < pendingItemIds.length; index += 5000) {
    const activeItems = await prisma.item.findMany({
      where: {
        id: { in: pendingItemIds.slice(index, index + 5000) },
        archivedAt: null,
        ignored: false,
        status: { in: ["active", "unknown"] },
        channel: "online",
        purchaseRecord: null,
        categoryToyType: { not: "card" },
      },
      select: { id: true, lastSeenAt: true, auctionEndAt: true, listingType: true },
    });
    for (const item of activeItems) activeItemsById.set(item.id, item);
  }

  for (const [itemId, candidates] of byItem) {
    const item = activeItemsById.get(itemId);
    if (!item) {
      for (const job of candidates) {
        await job.remove();
        removed += 1;
      }
      continue;
    }
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
    const keepDueAt = keep.timestamp + Number(keep.opts.delay ?? 0);
    const now = Date.now();
    const auctionEndAt = item.listingType === "direct" ? null : item.auctionEndAt;
    const exceedsSla =
      keepDueAt > now + statusRefreshDelayBudget(auctionEndAt, item.lastSeenAt, now);
    if (keep.id !== stableId || exceedsSla) {
      // The old queue placed every listing into the same short time bucket.
      // Rephase the retained jobs deterministically across their new cadence
      // so thousands of records do not wake at once after a deployment.
      const delay = phasedStatusRefreshDelay(
        itemId,
        auctionEndAt,
        item.lastSeenAt,
        now,
      );
      const jobData = { ...keep.data, auctionEndAt, listingType: item.listingType };
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

/**
 * Repair gaps left by older schedulers. Queue jobs are ephemeral, so startup
 * verifies coverage against the durable catalogue and adds only missing work.
 */
async function repairStatusRefreshCoverage() {
  const existingJobs = await statusQueue.getJobs(
    ["waiting", "delayed", "prioritized", "active"],
    0,
    -1,
  );
  const coveredItemIds = new Set<string>();
  for (const job of existingJobs) {
    const itemId =
      job.data && typeof job.data === "object" && "itemId" in job.data
        ? String((job.data as { itemId?: unknown }).itemId ?? "")
        : "";
    if (itemId && job.name === "refresh-status" && job.id === `status-${itemId}`)
      coveredItemIds.add(itemId);
  }

  let cursor: string | undefined;
  let inspected = 0;
  let alreadyCovered = 0;
  let scheduled = 0;
  for (;;) {
    const items = await prisma.item.findMany({
      where: {
        archivedAt: null,
        ignored: false,
        status: { in: ["active", "unknown"] },
        channel: "online",
        purchaseRecord: null,
        categoryToyType: { not: "card" },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        id: true,
        sourceItemId: true,
        sourceUrl: true,
        status: true,
        auctionEndAt: true,
        lastSeenAt: true,
        listingType: true,
        source: { select: { key: true } },
      },
      orderBy: { id: "asc" },
      take: 1_000,
    });
    if (items.length === 0) break;
    inspected += items.length;
    cursor = items.at(-1)?.id;
    const missing = items.filter((item) => {
      if (coveredItemIds.has(item.id)) {
        alreadyCovered += 1;
        return false;
      }
      coveredItemIds.add(item.id);
      return true;
    });
    if (missing.length > 0) {
      await statusQueue.addBulk(
        missing.map((item) => ({
          name: "refresh-status",
          data: {
            itemId: item.id,
            sourceItemId: item.sourceItemId,
            sourceUrl: item.sourceUrl,
            status: item.status,
            auctionEndAt: item.listingType === "direct" ? null : item.auctionEndAt,
            listingType: item.listingType,
            adapterKey: item.source.key,
          },
          opts: {
            delay: phasedStatusRefreshDelay(
              item.id,
              item.listingType === "direct" ? null : item.auctionEndAt,
              item.lastSeenAt,
            ),
            jobId: `status-${item.id}`,
            attempts: 4,
            backoff: { type: "exponential" as const, delay: 30_000 },
            removeOnComplete: true,
            removeOnFail: true,
          },
        })),
      );
      scheduled += missing.length;
    }
    if (items.length < 1_000) break;
  }
  if (scheduled > 0)
    console.log(
      JSON.stringify({
        event: "status_queue_coverage_repaired",
        inspected,
        alreadyCovered,
        scheduled,
      }),
    );
  return { inspected, alreadyCovered, scheduled };
}

let statusCoverageRepair: ReturnType<typeof repairStatusRefreshCoverage> | undefined;

/** Startup and periodic repairs share one scan, so slow database/Redis work
 * cannot multiply scans or enqueue duplicate missing listings. */
export function ensureStatusRefreshCoverage() {
  if (!statusCoverageRepair) {
    const current = repairStatusRefreshCoverage();
    statusCoverageRepair = current;
    const clear = () => {
      if (statusCoverageRepair === current) statusCoverageRepair = undefined;
    };
    void current.then(clear, clear);
  }
  return statusCoverageRepair;
}

type PendingClassificationQueueJob = {
  id: string;
  itemId: string;
  version?: string;
  timestamp: number;
};

function completedAutomaticContentVersion(result: unknown) {
  return result != null &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    typeof (result as Record<string, unknown>).automaticContentVersion ===
      "string"
    ? String((result as Record<string, unknown>).automaticContentVersion)
    : undefined;
}

/**
 * Remove only pending BullMQ bookkeeping made redundant by repeated crawler
 * writes. Durable Items, purchases, credentials, classifications and audit
 * rows are read to decide eligibility and are never mutated here.
 *
 * The queue must be paused so a job cannot become active between inspection
 * and removal. Unknown job names/data are retained conservatively.
 */
export async function compactPendingClassificationJobs() {
  if (!(await classificationQueue.isPaused()))
    throw new Error(
      "Refusing to compact image-classification while the queue is running",
    );

  const states = ["waiting", "delayed", "prioritized"] as const;
  const before = await classificationQueue.getJobCounts(...states);
  const byItem = new Map<string, PendingClassificationQueueJob[]>();
  let inspected = 0;
  let retainedUnknown = 0;
  const pageSize = 1_000;
  for (let start = 0; ; start += pageSize) {
    const jobs = await classificationQueue.getJobs(
      [...states],
      start,
      start + pageSize - 1,
      true,
    );
    inspected += jobs.length;
    for (const job of jobs) {
      if (job.name !== "classify-images" || !job.id) {
        retainedUnknown += 1;
        continue;
      }
      const data =
        job.data && typeof job.data === "object"
          ? (job.data as { itemId?: unknown; version?: unknown })
          : undefined;
      const itemId = typeof data?.itemId === "string" ? data.itemId : "";
      if (!itemId) {
        retainedUnknown += 1;
        continue;
      }
      const entries = byItem.get(itemId) ?? [];
      entries.push({
        id: String(job.id),
        itemId,
        ...(typeof data?.version === "string" ? { version: data.version } : {}),
        timestamp: Number.isFinite(job.timestamp) ? job.timestamp : 0,
      });
      byItem.set(itemId, entries);
    }
    if (jobs.length < pageSize) break;
  }

  const currentItems = new Map<
    string,
    {
      applicable: boolean;
      contentVersion: string;
      completedVersions: Set<string>;
      hasAnyCompletion: boolean;
    }
  >();
  const itemIds = [...byItem.keys()];
  for (let start = 0; start < itemIds.length; start += 500) {
    const rows = await prisma.item.findMany({
      where: { id: { in: itemIds.slice(start, start + 500) } },
      select: {
        id: true,
        archivedAt: true,
        ignored: true,
        importOrigin: true,
        status: true,
        titleRaw: true,
        descriptionRaw: true,
        conditionRaw: true,
        categoryIp: true,
        categoryToyType: true,
        manufacturer: true,
        conditionGrade: true,
        quantityEst: true,
        priceCurrent: true,
        needsReview: true,
        purchaseRecord: { select: { id: true } },
        images: { orderBy: { position: "asc" }, select: { url: true } },
        classifications: {
          where: { classifierType: "vision_ai_gateway" },
          select: { result: true },
        },
      },
    });
    for (const row of rows) {
      const candidate = {
        ...row,
        imageUrls: row.images.map((image) => image.url),
      };
      const completedVersions = new Set(
        row.classifications
          .map(({ result }) => completedAutomaticContentVersion(result))
          .filter((version): version is string => Boolean(version)),
      );
      currentItems.set(row.id, {
        // Mirror the run-time gate in processClassification: a purchase
        // import stays applicable despite its staging archive, while
        // terminal, archived, ignored, and purchased rows do not.
        applicable:
          !shouldAbortAiJobForItem(row, {
            allowArchivedPurchaseImport: true,
          }) &&
          row.categoryToyType !== "card" &&
          row.images.length > 0 &&
          shouldQueueAutomaticClassification(candidate),
        contentVersion: automaticClassificationContentVersion(candidate),
        completedVersions,
        hasAnyCompletion: row.classifications.length > 0,
      });
    }
  }

  const removeIds: string[] = [];
  let uniquePendingItems = 0;
  let alreadyCompleted = 0;
  let inapplicable = 0;
  let staleVersions = 0;
  for (const [itemId, jobs] of byItem) {
    const current = currentItems.get(itemId);
    if (!current?.applicable) {
      removeIds.push(...jobs.map(({ id }) => id));
      inapplicable += 1;
      continue;
    }
    const viable = jobs.filter((job) => {
      if (!job.version) return !current.hasAnyCompletion;
      if (current.completedVersions.has(job.version)) {
        alreadyCompleted += 1;
        return false;
      }
      if (job.version !== current.contentVersion) {
        staleVersions += 1;
        return false;
      }
      return true;
    });
    // A legacy job reads current database content at execution time, so it is
    // a safe fallback when no content-versioned job from the new build exists.
    const keep = viable.sort((left, right) => {
      const leftCurrent = left.version === current.contentVersion ? 1 : 0;
      const rightCurrent = right.version === current.contentVersion ? 1 : 0;
      return rightCurrent - leftCurrent || right.timestamp - left.timestamp;
    })[0];
    if (keep) uniquePendingItems += 1;
    for (const job of jobs) if (job.id !== keep?.id) removeIds.push(job.id);
  }

  let removed = 0;
  let removalFailed = 0;
  for (let start = 0; start < removeIds.length; start += 100) {
    const results = await Promise.allSettled(
      removeIds
        .slice(start, start + 100)
        .map((jobId) => classificationQueue.remove(jobId)),
    );
    for (const result of results) {
      if (result.status === "fulfilled" && Number(result.value) > 0)
        removed += 1;
      else if (result.status === "rejected") removalFailed += 1;
    }
  }
  const after = await classificationQueue.getJobCounts(...states);
  const report = {
    before,
    after,
    inspected,
    uniqueItems: byItem.size,
    uniquePendingItems,
    removed,
    removalFailed,
    retainedUnknown,
    inapplicableItems: inapplicable,
    alreadyCompletedJobs: alreadyCompleted,
    staleVersionJobs: staleVersions,
  };
  console.log(
    JSON.stringify({ event: "classification_queue_compacted", ...report }),
  );
  return report;
}

const DEFAULT_PROCUREMENT_KEYWORDS = [
  "仮面ライダー まとめ売り",
  "ウルトラマン まとめ売り",
  "特撮 ガシャポン まとめ売り",
  "特撮 食玩 まとめ売り",
  "特撮 指人形 まとめ売り",
  "特撮 ミニフィギュア まとめ売り",
  ...SHF_SEARCH_KEYWORDS,
  ...SIC_SEARCH_KEYWORDS,
];

const DEFAULT_MARKET_KEYWORDS = [
  "仮面ライダー",
  "ウルトラマン",
  "仮面ライダー DX",
  "仮面ライダー ベルト",
  "仮面ライダー ソフビ",
  "仮面ライダー 食玩",
  "仮面ライダー ガシャポン",
  "特撮 まとめ売り",
];

function configuredKeywords(value: string | undefined, fallback: string[]) {
  const configured = value
    ?.split("|")
    .map((keyword) => keyword.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return configured?.length ? configured : fallback;
}

function marketKeywordPlan(env: Record<string, string | undefined>) {
  const procurement = [
    ...new Set(
      configuredKeywords(
        env.PROCUREMENT_SEARCH_KEYWORDS,
        DEFAULT_PROCUREMENT_KEYWORDS,
      ),
    ),
  ];
  const general = configuredKeywords(
    env.MARKET_KEYWORDS,
    DEFAULT_MARKET_KEYWORDS,
  );
  return {
    keywords: [...new Set([...procurement, ...general])],
    priorityCount: procurement.length,
  };
}

export function marketKeywords(
  env: Record<string, string | undefined> = process.env,
) {
  return marketKeywordPlan(env).keywords;
}

export type MarketKeywordRotation = {
  slot: number;
  capacity: number;
};

/**
 * Keep procurement searches dominant without permanently hiding keywords past
 * an adapter's request cap. When procurement fills the cap, one slot per round
 * visits the remaining keywords. With fewer procurement terms, those terms
 * stay fixed and the remaining slots rotate as a contiguous window.
 */
export function marketKeywordWindow(
  env: Record<string, string | undefined>,
  requestedCapacity: number,
  requestedRound: number,
) {
  const { keywords, priorityCount } = marketKeywordPlan(env);
  const normalizedCapacity = Number.isFinite(requestedCapacity)
    ? Math.max(1, Math.floor(requestedCapacity))
    : 1;
  const capacity = Math.min(keywords.length, normalizedCapacity);
  const round = Number.isFinite(requestedRound)
    ? Math.max(0, Math.floor(requestedRound))
    : 0;
  if (keywords.length <= capacity) return keywords;

  if (priorityCount < capacity) {
    const preferred = keywords.slice(0, priorityCount);
    const rotating = keywords.slice(priorityCount);
    const rotatingSlots = capacity - preferred.length;
    const start = (round * rotatingSlots) % rotating.length;
    return [
      ...preferred,
      ...Array.from(
        { length: rotatingSlots },
        (_, index) => rotating[(start + index) % rotating.length]!,
      ),
    ];
  }

  const preferred = keywords.slice(0, capacity);
  if (round === 0) return preferred;
  const rotating = keywords.slice(capacity);
  const replacementSlot = (round - 1) % capacity;
  preferred[replacementSlot] = rotating[(round - 1) % rotating.length]!;
  return preferred;
}

export function marketKeywordForRotation(
  fallback: string,
  rotation: MarketKeywordRotation | undefined,
  repeatCount: number | undefined,
  env: Record<string, string | undefined> = process.env,
) {
  if (!rotation) return fallback;
  const round =
    typeof repeatCount === "number" && Number.isFinite(repeatCount)
      ? Math.max(0, Math.floor(repeatCount) - 1)
      : 0;
  return (
    marketKeywordWindow(env, rotation.capacity, round)[rotation.slot] ??
    fallback
  );
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

/**
 * Revisit every active Mercari listing that still lacks a stable public seller
 * identity. Cursor pagination is intentional: the original one-shot `take`
 * repeatedly selected the same first 1,000 placeholders and could starve the
 * rest of a large historical catalogue.
 */
export async function scheduleMercariSellerBackfill() {
  const source = await prisma.source.findUnique({
    where: { key: "mercari" },
    select: { id: true },
  });
  if (!source) return { scheduled: 0 };

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
              name: { startsWith: "Mercari 卖家" },
              sourceSellerId: null,
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
            adapterKey: "mercari",
          },
          opts: {
            jobId: `seller-profile-backfill-mercari-${item.id}`,
            attempts: 4,
            backoff: { type: "exponential" as const, delay: 30_000 },
            // Unresolved public pages must be eligible for a later worker
            // restart instead of being pinned behind a retained terminal job.
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
        adapter: "mercari",
        jobs: scheduled,
      }),
    );
  return { scheduled };
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

/**
 * Remove a pending search job without calling Job.remove() on a BullMQ
 * repeatable child. Repeatable children are owned by the queue scheduler;
 * deleting one directly makes BullMQ throw and takes the worker down. The
 * scheduler definition is the durable thing to remove instead.
 */
async function removeSearchJobSafely(job: Job) {
  const repeatJobKey =
    typeof job.repeatJobKey === "string" && job.repeatJobKey.length > 0
      ? job.repeatJobKey
      : typeof job.id === "string" && /^repeat:[^:]+:\d+$/.test(job.id)
        ? job.id.replace(/:\d+$/, "")
        : null;
  if (repeatJobKey) {
    await searchQueue.removeRepeatableByKey(repeatJobKey);
    return "scheduler" as const;
  }
  await job.remove();
  return "job" as const;
}

async function removeChinaComparisonJobs() {
  for (const repeat of await chinaMarketComparisonQueue.getRepeatableJobs()) {
    if (
      repeat.name === "dispatch-due" ||
      repeat.id?.startsWith("repeat-china-comparison")
    )
      await chinaMarketComparisonQueue.removeRepeatableByKey(repeat.key);
  }
  // Scheduler jobs use fixed IDs, so startup cleanup can address them
  // directly instead of loading an unbounded product-job backlog into memory.
  // Include today's legacy dated ID for upgrades from the previous scheduler.
  const ownedJobIds = [
    "bootstrap-china-comparison-dispatch",
    `bootstrap-china-comparison-${new Date().toISOString().slice(0, 10)}`,
  ];
  for (const jobId of ownedJobIds) {
    const job = await chinaMarketComparisonQueue.getJob(jobId);
    if (job && !job.repeatJobKey && job.name === "dispatch-due")
      await job.remove();
  }
}

export function chinaComparisonDispatchIntervalMs(
  env: Record<string, string | undefined> = process.env,
) {
  const configured = Number(env.XIANYU_COMPARISON_DISPATCH_INTERVAL_MS);
  if (!Number.isFinite(configured) || configured < 1) return 15 * 60_000;
  // The dispatcher is a cheap due-index scan and crash-recovery loop. Keep it
  // independent from the 6-hour comparison cadence, but bounded so a newly
  // linked Product is discovered promptly without making every Product wake
  // on each dispatcher pass.
  return Math.max(60_000, Math.min(Math.floor(configured), 6 * 60 * 60_000));
}

export async function scheduleChinaComparisonJobs() {
  await removeChinaComparisonJobs();
  if (!xianyuComparisonEnabled())
    return { enabled: false, scheduled: 0 };
  const dispatchEvery = chinaComparisonDispatchIntervalMs();
  await chinaMarketComparisonQueue.add(
    "dispatch-due",
    {},
    {
      jobId: "repeat-china-comparison-dispatch",
      repeat: { every: dispatchEvery },
      removeOnComplete: 50,
      removeOnFail: 50,
    },
  );
  await chinaMarketComparisonQueue.add(
    "dispatch-due",
    { requestedAt: new Date().toISOString() },
    {
      jobId: "bootstrap-china-comparison-dispatch",
      removeOnComplete: true,
      removeOnFail: 10,
    },
  );
  return { enabled: true, scheduled: 1 };
}

/**
 * Cover the complete historical backlog in bounded database pages. Stable
 * content job IDs make this safe across restarts and while the queue is paused.
 */
export async function schedulePendingAutomaticClassifications() {
  if (!automaticPaidAiEnabled()) return { inspected: 0, scheduled: 0 };
  let cursor: string | undefined;
  let inspected = 0;
  let scheduled = 0;
  for (;;) {
    const items = await prisma.item.findMany({
      where: {
        archivedAt: null,
        ignored: false,
        purchaseRecord: null,
        status: { in: ["active", "unknown"] },
        categoryToyType: { not: "card" },
        images: { some: {} },
        classifications: {
          none: { classifierType: "vision_ai_gateway" },
        },
        // Custom general-scope items are skipped by the classification
        // processor itself; do not spend queue jobs on them here.
        OR: [
          { monitoringCategoryId: null },
          { monitoringCategory: { scope: { not: "general" } } },
        ],
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        id: true,
        titleRaw: true,
        descriptionRaw: true,
        conditionRaw: true,
        categoryIp: true,
        categoryToyType: true,
        manufacturer: true,
        conditionGrade: true,
        quantityEst: true,
        priceCurrent: true,
        needsReview: true,
        images: { orderBy: { position: "asc" }, select: { url: true } },
      },
      orderBy: { id: "asc" },
      take: 500,
    });
    if (items.length === 0) break;
    cursor = items.at(-1)?.id;
    inspected += items.length;
    const jobs = items
      .map((item) => ({
        ...item,
        imageUrls: item.images.map((image) => image.url),
      }))
      .filter(shouldQueueAutomaticClassification)
      .map((item) => {
        const version = automaticClassificationContentVersion(item);
        return {
          name: "classify-images",
          data: { itemId: item.id, version },
          opts: {
            jobId: classificationJobId(item.id, version),
            attempts: 4,
            backoff: { type: "exponential" as const, delay: 30_000 },
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        };
      });
    if (jobs.length > 0) {
      await classificationQueue.addBulk(jobs);
      scheduled += jobs.length;
    }
  }
  return { inspected, scheduled };
}

export async function scheduleJobs() {
  const paidAutomationEnabled = automaticPaidAiEnabled();
  const backgroundAiEnabled = automaticBackgroundAiEnabled();
  await compactPendingStatusJobs();
  await ensureStatusRefreshCoverage();
  await scheduleChinaComparisonJobs();
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
  await scheduleMercariSellerBackfill();
  await scheduleYahooFleamarketSellerBackfill();
  if (paidAutomationEnabled) await schedulePendingAutomaticClassifications();
  if (backgroundAiEnabled) {
    // Queue pause state is durable in Redis. A previous paid-automation
    // shutdown may therefore leave safe free-only translation work paused
    // across deployments until it is resumed explicitly.
    await Promise.all([
      titleTranslationQueue.resume(),
      detailTranslationQueue.resume(),
    ]);
  }
  for (const repeat of await titleTranslationQueue.getRepeatableJobs()) {
    if (
      repeat.name === "translate-existing-product-titles" ||
      repeat.id?.startsWith("repeat-title-translation")
    )
      await titleTranslationQueue.removeRepeatableByKey(repeat.key);
  }
  if (backgroundAiEnabled)
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
    if (
      repeat.name === "translate-existing-item-details" ||
      repeat.id?.startsWith("repeat-detail-translation")
    )
      await detailTranslationQueue.removeRepeatableByKey(repeat.key);
  }
  if (backgroundAiEnabled)
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
    backgroundAiEnabled &&
    (await prisma.item.count({
      where: {
        // Match the detail-translation backlog query: live listings, plus
        // purchased items whose inventory translation is still wanted.
        ignored: false,
        categoryToyType: { not: "card" },
        translationStatus: { not: "completed" },
        OR: [
          {
            archivedAt: null,
            status: { in: ["active", "unknown"] },
          },
          { purchaseRecord: { isNot: null } },
        ],
      },
    })) > 0
  ) {
    await detailTranslationQueue.add(
      "bootstrap-item-detail-translation",
      { reason: "pending-existing-item-details" },
      {
        jobId: "bootstrap-detail-translation",
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
  if (
    backgroundAiEnabled &&
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
        jobId: "bootstrap-title-translation",
        removeOnComplete: true,
        removeOnFail: true,
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
  for (const repeat of await aiOperationsQueue.getRepeatableJobs()) {
    if (
      repeat.name === "refresh-market-memory" ||
      repeat.id?.startsWith("repeat-ai-market-memory")
    )
      await aiOperationsQueue.removeRepeatableByKey(repeat.key);
  }
  if (paidAutomationEnabled) {
    await aiOperationsQueue.add(
      "refresh-market-memory",
      {},
      {
        jobId: "repeat-ai-market-memory",
        repeat: {
          every: Number(
            process.env.AI_MEMORY_REFRESH_INTERVAL_MS ?? 86_400_000,
          ),
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
        jobId: "bootstrap-ai-memory",
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
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
        jobId: `bootstrap-mock-${new Date().toISOString().slice(0, 10)}`,
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

  const { hasConfig } = await initializeMonitoringKeywordSources();
  if (hasConfig) {
    // DB-owned keywords replace only legacy static searches. Never discard
    // user keyword jobs, active work, or unrelated enrichment/maintenance.
    const realSources = new Set([
      "mandarake", "mercari", "yahoo_auctions", "yahoo_fleamarket",
      "yahoo_shopping", "rakuma", "surugaya", "firecrawl_market", "apify_ecommerce",
    ]);
    for (const job of await searchQueue.getJobs(["waiting", "delayed", "prioritized"], 0, -1)) {
      const data = job.data as { adapterKey?: string; monitoringKeywordId?: string };
      if (data.adapterKey && realSources.has(data.adapterKey) && !data.monitoringKeywordId)
        await removeSearchJobSafely(job);
    }
    return;
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
      const keywords = marketKeywordWindow(
        process.env,
        DEFAULT_PROCUREMENT_KEYWORDS.length,
        0,
      );
      for (const [index, keyword] of keywords.entries()) {
        await searchQueue.add(
          "mercari-search",
          {
            adapterKey: "mercari",
            keywordRotation: { slot: index, capacity: keywords.length },
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
      const incrementalKeywords = marketKeywordWindow(process.env, 4, 0);
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
            keywordRotation: {
              slot: index,
              capacity: incrementalKeywords.length,
            },
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
      const keywords = marketKeywordWindow(process.env, 4, 0);
      for (const [index, keyword] of keywords.entries()) {
        await searchQueue.add(
          "yahoo-fleamarket-search",
          {
            adapterKey: "yahoo_fleamarket",
            keywordRotation: { slot: index, capacity: keywords.length },
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
            keywordRotation: { slot: index, capacity: keywords.length },
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

    const yahooShoppingEnabled = credentialedSourceEnabled("yahoo_shopping");
    if (yahooShoppingEnabled) {
      await prisma.source.updateMany({
        where: { key: "yahoo_shopping" },
        data: { enabled: true, circuitOpenAt: null },
      });
      const every = Number(
        process.env.YAHOO_SHOPPING_SEARCH_INTERVAL_MS ?? 7_200_000,
      );
      const keywords = marketKeywordWindow(process.env, 4, 0);
      for (const [index, keyword] of keywords.entries()) {
        await searchQueue.add(
          "yahoo-shopping-search",
          {
            adapterKey: "yahoo_shopping",
            keywordRotation: { slot: index, capacity: keywords.length },
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
      const keywords = marketKeywordWindow(process.env, 3, 0);
      for (const [index, keyword] of keywords.entries()) {
        await searchQueue.add(
          "rakuma-search",
          {
            adapterKey: "rakuma",
            keywordRotation: { slot: index, capacity: keywords.length },
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
            keywordRotation: { slot: index, capacity: keywords.length },
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

    const firecrawlEnabled = credentialedSourceEnabled("firecrawl_market");
    if (firecrawlEnabled) {
      await prisma.source.updateMany({
        where: { key: "firecrawl_market" },
        data: { enabled: true, circuitOpenAt: null },
      });
      const keywords = marketKeywordWindow(process.env, 5, 0);
      const every = Number(
        process.env.FIRECRAWL_DISCOVERY_INTERVAL_MS ?? 7_200_000,
      );
      for (const [index, keyword] of keywords.entries()) {
        await searchQueue.add(
          "firecrawl-market-discovery",
          {
            adapterKey: "firecrawl_market",
            keywordRotation: { slot: index, capacity: keywords.length },
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

    const apifyEnabled = credentialedSourceEnabled("apify_ecommerce");
    if (apifyEnabled) {
      await prisma.source.updateMany({
        where: { key: "apify_ecommerce" },
        data: { enabled: true, circuitOpenAt: null },
      });
      const keywords = marketKeywordWindow(process.env, 4, 0);
      const every = Number(
        process.env.APIFY_DISCOVERY_INTERVAL_MS ?? 21_600_000,
      );
      for (const [index, keyword] of keywords.entries()) {
        await searchQueue.add(
          "apify-ecommerce-discovery",
          {
            adapterKey: "apify_ecommerce",
            keywordRotation: { slot: index, capacity: keywords.length },
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
