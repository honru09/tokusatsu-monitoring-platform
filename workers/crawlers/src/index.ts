import { Worker } from "bullmq";
import { prisma } from "@tokusatsu/db";
import {
  backfillUnmatchedListings,
  seedCatalogDictionary,
} from "@tokusatsu/product-intelligence";
import { connection, ensureStatusRefreshCoverage, scheduleJobs } from "./queues.js";
import { dispatchMonitoringKeywords } from "./monitoring-keywords.js";
import { startPeriodicTask } from "./periodic-task.js";
import { rescheduleCompletedStatusJob } from "./status-refresh-lifecycle.js";
import {
  processClassification,
  processSearch,
  processStatus,
  processUrlAnalysis,
  processCleanup,
  processDislikedCleanup,
  scheduleStatus,
} from "./processors.js";
import { processMarketIntel } from "./market-intel.processor.js";
import { processTitleTranslation } from "./title-translation.processor.js";
import { processDetailTranslation } from "./detail-translation.processor.js";
import { processAiOperations } from "./ai-operations.processor.js";
import { processChinaMarketComparison } from "./china-market/comparison.processor.js";
import {
  configureAutomaticAiCoordination,
  type AutomaticAiRedisClient,
} from "./background-ai-guard.js";
import {
  isStatusRefreshEligible,
  statusRefreshWorkerPlan,
} from "./status-refresh-policy.js";

// ioredis exposes overloaded command signatures, while the coordination layer
// deliberately depends on only the compatible get/set/eval subset.
configureAutomaticAiCoordination(
  connection as unknown as AutomaticAiRedisClient,
);
await seedCatalogDictionary();
await processCleanup();
await backfillUnmatchedListings();
await scheduleJobs();
await dispatchMonitoringKeywords();

function positiveIntegerEnvironment(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

// Background enrichment must leave request headroom for interactive translation
// and assistant chat. Each queue remains continuous, but its default RPM is kept
// below the combined free-tier limits used by the shared provider pool.
const imageClassificationRpm = positiveIntegerEnvironment(
  "IMAGE_CLASSIFICATION_RPM",
  2,
);
const titleTranslationRpm = positiveIntegerEnvironment(
  "TITLE_TRANSLATION_RPM",
  2,
);
const detailTranslationRpm = positiveIntegerEnvironment(
  "DETAIL_TRANSLATION_RPM",
  1,
);
// Keep comparison work serial so provider requests and database writes never
// fan out unexpectedly. Deployments with a larger catalog may raise the start
// rate deliberately, but the hard ceiling protects the marketplace and host
// from an accidental high value.
const chinaComparisonRpm = Math.min(
  positiveIntegerEnvironment("XIANYU_COMPARISON_RPM", 1),
  10,
);
const activeStatusItems = await prisma.item.count({
  where: {
    archivedAt: null,
    deletedAt: null,
    ignored: false,
    status: { in: ["active", "unknown"] },
    channel: "online",
    purchaseRecord: null,
    categoryToyType: { not: "card" },
  },
});
const statusRefreshPlan = statusRefreshWorkerPlan(activeStatusItems);
console.log(
  JSON.stringify({ event: "status_refresh_worker_plan", ...statusRefreshPlan }),
);

const workers = [
  new Worker("source-search", processSearch, {
    connection,
    concurrency: 2,
    limiter: { max: 6, duration: 60_000 },
  }),
  new Worker("image-classification", processClassification, {
    connection,
    concurrency: 1,
    limiter: { max: imageClassificationRpm, duration: 60_000 },
  }),
  new Worker("item-status-refresh", processStatus, {
    connection,
    concurrency: statusRefreshPlan.concurrency,
    limiter: { max: statusRefreshPlan.rpm, duration: 60_000 },
  }),
  new Worker("seller-profile-backfill", processStatus, {
    connection,
    concurrency: 1,
    // Yahoo's detail adapter enforces a three-second request gap. The
    // limiter leaves headroom for normal status refreshes while draining the
    // historical seller queue independently.
    limiter: { max: 18, duration: 60_000 },
  }),
  new Worker("url-analysis", processUrlAnalysis, {
    connection,
    concurrency: 2,
    limiter: { max: 6, duration: 60_000 },
  }),
  new Worker("inventory-maintenance", processCleanup, {
    connection,
    concurrency: 1,
  }),
  new Worker("disliked-maintenance", processDislikedCleanup, {
    connection,
    concurrency: 1,
  }),
  new Worker("market-intel-refresh", processMarketIntel, {
    connection,
    concurrency: 1,
    limiter: { max: 1, duration: 60_000 },
  }),
  new Worker("china-market-comparison", processChinaMarketComparison, {
    connection,
    concurrency: 1,
    limiter: { max: chinaComparisonRpm, duration: 60_000 },
  }),
  new Worker("title-translation", processTitleTranslation, {
    connection,
    concurrency: 1,
    limiter: { max: titleTranslationRpm, duration: 60_000 },
  }),
  new Worker("item-detail-translation", processDetailTranslation, {
    connection,
    concurrency: 1,
    limiter: { max: detailTranslationRpm, duration: 60_000 },
  }),
  new Worker("ai-operations", processAiOperations, {
    connection,
    concurrency: 1,
    limiter: { max: 1, duration: 60_000 },
  }),
];

const periodicTasks = [
  startPeriodicTask({
    intervalMs: 10 * 60_000,
    task: ensureStatusRefreshCoverage,
    onError: (error) => console.error(JSON.stringify({ event: "status_coverage_repair_failed", error: String(error) })),
  }),
  startPeriodicTask({
    intervalMs: 60_000,
    task: dispatchMonitoringKeywords,
    onError: (error) => console.error(JSON.stringify({ event: "monitoring_keyword_dispatch_failed", error: String(error) })),
  }),
];

for (const worker of workers) {
  worker.on("completed", (job) => {
    if (worker.name !== "item-status-refresh" || job.name !== "refresh-status")
      return;
    const data = job.data as {
      itemId?: string;
      sourceItemId?: string;
      sourceUrl?: string;
      status?: string;
      auctionEndAt?: string | Date | null;
      adapterKey?: string;
      listingType?: string;
    };
    const result = job.returnvalue as {
      status?: string;
      auctionEndAt?: string | Date | null;
      listingType?: string;
    } | undefined;
    // The current job is removed on completion. Scheduling from the
    // completion event therefore creates the next stable-id job without the
    // self-deduplication race that occurs when scheduling inside processStatus.
    void rescheduleCompletedStatusJob(data, result, scheduleStatus).catch((error) =>
      console.error(
        JSON.stringify({
          event: "status_reschedule_failed",
          itemId: data.itemId,
          error: String(error),
        }),
      ),
    );
  });
  worker.on(
    "failed",
    (job, error) =>
      void (async () => {
        console.error(
          JSON.stringify({
            event: "job_failed",
            queue: worker.name,
            jobId: job?.id,
            error: error.message,
          }),
        );
        if (
          worker.name !== "item-status-refresh" ||
          !job ||
          job.name !== "refresh-status" ||
          job.attemptsMade < Number(job.opts.attempts ?? 1)
        )
          return;
        const data = job.data as {
          itemId?: string;
          sourceItemId?: string;
          sourceUrl?: string;
          status?: string;
          auctionEndAt?: string | Date | null;
          adapterKey?: string;
        };
        if (
          !isStatusRefreshEligible(data.status) ||
          !data.itemId ||
          !data.sourceItemId ||
          !data.sourceUrl ||
          !data.adapterKey
        )
          return;
        // A transient outage must not permanently stop status monitoring for an
        // item. Replace the terminal failed job with a delayed retry using the
        // same stable id; scheduleStatus removes the terminal record first.
        const retryDelay = Math.min(
          60 * 60 * 1000,
          5 * 60 * 1000 * 2 ** Math.max(0, job.attemptsMade - 4),
        );
        await scheduleStatus(
          data.itemId,
          data.sourceItemId,
          data.sourceUrl,
          data.status,
          data.auctionEndAt ? new Date(data.auctionEndAt) : null,
          data.adapterKey,
          retryDelay,
        ).catch((rescheduleError) =>
          console.error(
            JSON.stringify({
              event: "status_retry_schedule_failed",
              itemId: data.itemId,
              error: String(rescheduleError),
            }),
          ),
        );
      })(),
  );
  worker.on("error", (error) =>
    console.error(
      JSON.stringify({
        event: "worker_error",
        queue: worker.name,
        error: error.message,
      }),
    ),
  );
}

console.log(
  JSON.stringify({
    event: "worker_ready",
    realAdapterEnabled: process.env.REAL_ADAPTER_ENABLED === "true",
  }),
);

async function shutdown(signal: string) {
  console.log(JSON.stringify({ event: "worker_shutdown", signal }));
  await Promise.all(periodicTasks.map((task) => task.stop()));
  await Promise.all(workers.map((worker) => worker.close()));
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
