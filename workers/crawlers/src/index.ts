import { Worker } from "bullmq";
import { prisma } from "@tokusatsu/db";
import {
  backfillUnmatchedListings,
  seedCatalogDictionary,
} from "@tokusatsu/product-intelligence";
import { connection, scheduleJobs } from "./queues.js";
import {
  processClassification,
  processSearch,
  processStatus,
  processUrlAnalysis,
  processCleanup,
  processDislikedCleanup,
} from "./processors.js";

await seedCatalogDictionary();
await processCleanup();
await backfillUnmatchedListings();
await scheduleJobs();

const workers = [
  new Worker("source-search", processSearch, {
    connection,
    concurrency: 2,
    limiter: { max: 6, duration: 60_000 },
  }),
  new Worker("image-classification", processClassification, {
    connection,
    concurrency: 2,
    limiter: { max: 10, duration: 60_000 },
  }),
  new Worker("item-status-refresh", processStatus, {
    connection,
    concurrency: 3,
    limiter: { max: 20, duration: 60_000 },
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
];

for (const worker of workers) {
  worker.on("failed", (job, error) =>
    console.error(
      JSON.stringify({
        event: "job_failed",
        queue: worker.name,
        jobId: job?.id,
        error: error.message,
      }),
    ),
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
  await Promise.all(workers.map((worker) => worker.close()));
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
