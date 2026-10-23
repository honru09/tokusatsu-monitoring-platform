import type { Queue } from "bullmq";

export type TerminalQueueState = "completed" | "failed";

export type TerminalQueueMaintenanceOptions = {
  /** Terminal records newer than this are retained for diagnostics. */
  graceMs?: number;
  /** Maximum records BullMQ may delete in one bounded pass. */
  batchSize?: number;
  /** Hard ceiling so one invocation never becomes an unbounded Redis loop. */
  maxPassesPerState?: number;
  /** Defaults to false. A dry run never calls Queue.clean. */
  apply?: boolean;
};

type TerminalCleanableQueue = Pick<
  Queue,
  "name" | "getJobCounts" | "getRepeatableJobs" | "clean"
>;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(Math.floor(value!), maximum));
}

/**
 * Delete only old BullMQ terminal bookkeeping. Queue.clean is deliberately
 * restricted to completed/failed states: active, waiting, delayed, prioritized
 * and paused jobs are never candidates, and repeat definitions are not touched.
 * Durable crawler, purchase and audit data lives in PostgreSQL and is outside
 * this function's dependency surface.
 */
export async function cleanTerminalQueueHistory(
  queue: TerminalCleanableQueue,
  options: TerminalQueueMaintenanceOptions = {},
) {
  const graceMs = boundedInteger(
    options.graceMs,
    24 * 60 * 60_000,
    60_000,
    90 * 24 * 60 * 60_000,
  );
  const batchSize = boundedInteger(options.batchSize, 1_000, 1, 10_000);
  const maxPassesPerState = boundedInteger(
    options.maxPassesPerState,
    100,
    1,
    1_000,
  );
  const apply = options.apply === true;
  const before = await queue.getJobCounts("completed", "failed");
  const repeatDefinitions = (await queue.getRepeatableJobs()).length;
  const removed: Record<TerminalQueueState, number> = {
    completed: 0,
    failed: 0,
  };
  const capped: Record<TerminalQueueState, boolean> = {
    completed: false,
    failed: false,
  };

  if (apply) {
    for (const state of ["completed", "failed"] as const) {
      for (let pass = 0; pass < maxPassesPerState; pass += 1) {
        const removedIds = await queue.clean(graceMs, batchSize, state);
        removed[state] += removedIds.length;
        if (removedIds.length < batchSize) break;
        if (pass === maxPassesPerState - 1) capped[state] = true;
      }
    }
  }

  const after = apply
    ? await queue.getJobCounts("completed", "failed")
    : before;
  return {
    queue: queue.name,
    mode: apply ? ("apply" as const) : ("dry-run" as const),
    graceMs,
    batchSize,
    maxPassesPerState,
    repeatDefinitions,
    before,
    removed,
    capped,
    after,
  };
}

export async function removePendingAdapterJobs(
  queue: Pick<Queue, "getJobs">,
  adapterKeys: string[],
) {
  const pending = await queue.getJobs(
    ["waiting", "delayed", "prioritized"],
    0,
    -1,
  );

  for (const job of pending) {
    // Removing a repeat definition does not remove the already materialized
    // child for its next run. Once an adapter is disabled that child is just
    // as stale as an ordinary bootstrap job, so match by the persisted job
    // data rather than preserving it merely because BullMQ attached a repeat
    // key. The state query deliberately excludes active jobs, and the adapter
    // key guard preserves every enabled/unknown source.
    if (adapterKeys.includes(job.data?.adapterKey)) await job.remove();
  }
}
