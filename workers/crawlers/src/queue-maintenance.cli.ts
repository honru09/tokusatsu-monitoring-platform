import {
  aiOperationsQueue,
  chinaMarketComparisonQueue,
  classificationQueue,
  compactPendingClassificationJobs,
  connection,
  detailTranslationQueue,
  dislikedMaintenanceQueue,
  maintenanceQueue,
  marketIntelQueue,
  searchQueue,
  sellerBackfillQueue,
  statusQueue,
  titleTranslationQueue,
  urlAnalysisQueue,
} from "./queues.js";
import { cleanTerminalQueueHistory } from "./queue-maintenance.js";

function numericArgument(name: string, fallback: number) {
  const prefix = `--${name}=`;
  const raw = process.argv.slice(2).find((value) => value.startsWith(prefix));
  if (!raw) return fallback;
  const parsed = Number(raw.slice(prefix.length));
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new Error(`Invalid positive --${name} value`);
  return parsed;
}

const apply = process.argv.includes("--apply");
const compactClassificationPending = process.argv.includes(
  "--classification-pending",
);
const graceHours = numericArgument("grace-hours", 24);
const batchSize = numericArgument("batch-size", 1_000);
const maxPassesPerState = numericArgument("max-passes", 100);

const queues = [
  searchQueue,
  classificationQueue,
  statusQueue,
  sellerBackfillQueue,
  urlAnalysisQueue,
  maintenanceQueue,
  dislikedMaintenanceQueue,
  marketIntelQueue,
  chinaMarketComparisonQueue,
  titleTranslationQueue,
  detailTranslationQueue,
  aiOperationsQueue,
];

async function main() {
  const terminalHistory = [];
  for (const queue of queues)
    terminalHistory.push(
      await cleanTerminalQueueHistory(queue, {
        apply,
        graceMs: graceHours * 60 * 60_000,
        batchSize,
        maxPassesPerState,
      }),
    );

  let classificationPending:
    | Awaited<ReturnType<typeof compactPendingClassificationJobs>>
    | { mode: "dry-run"; skipped: string }
    | undefined;
  if (compactClassificationPending) {
    if (!apply) {
      classificationPending = {
        mode: "dry-run",
        skipped: "add --apply to compact stale/duplicate pending jobs",
      };
    } else {
      const active = await classificationQueue.getActiveCount();
      if (active > 0)
        throw new Error(
          `Refusing pending compaction while ${active} classification job(s) are active; stop the worker first`,
        );
      const wasPaused = await classificationQueue.isPaused();
      if (!wasPaused) await classificationQueue.pause();
      try {
        const activeAfterPause = await classificationQueue.getActiveCount();
        if (activeAfterPause > 0)
          throw new Error(
            `Refusing pending compaction because ${activeAfterPause} classification job(s) remained active after pause`,
          );
        classificationPending = await compactPendingClassificationJobs();
      } finally {
        if (!wasPaused) await classificationQueue.resume();
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        event: "crawler_queue_maintenance",
        mode: apply ? "apply" : "dry-run",
        terminalHistory,
        ...(classificationPending ? { classificationPending } : {}),
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} finally {
  await Promise.allSettled(queues.map((queue) => queue.close()));
  await connection.quit().catch(() => undefined);
}
