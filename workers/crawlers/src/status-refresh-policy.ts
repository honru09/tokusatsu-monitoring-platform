export const STATUS_REFRESH_SLA_MS = 2 * 60 * 60_000;
const STATUS_REFRESH_SLA_MINUTES = STATUS_REFRESH_SLA_MS / 60_000;
const DEFAULT_STATUS_REFRESH_RPM = 120;
const DEFAULT_STATUS_REFRESH_JOB_MS = 15_000;

/** Keep the worker and queue maintenance aligned with the API's effective
 * market scope: an unknown marketplace state still needs another probe. */
export function isStatusRefreshEligible(status: unknown) {
  return status === "active" || status === "unknown";
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

/**
 * Models the status worker's current throughput so the two-hour inventory
 * contract can be tested without starting BullMQ workers or touching Redis.
 */
export function statusRefreshWorkerPlan(
  activeItems: number,
  env: Record<string, string | undefined> = process.env,
) {
  const normalizedActiveItems = Number.isFinite(activeItems)
    ? Math.max(0, Math.floor(activeItems))
    : 0;
  const requiredRpm = Math.max(
    1,
    Math.ceil(normalizedActiveItems / STATUS_REFRESH_SLA_MINUTES),
  );
  const configuredRpm = env.STATUS_REFRESH_RPM
    ? positiveInteger(env.STATUS_REFRESH_RPM, requiredRpm)
    : undefined;
  const rpm =
    configuredRpm ?? Math.max(DEFAULT_STATUS_REFRESH_RPM, requiredRpm);
  const averageJobMs = positiveInteger(
    env.STATUS_REFRESH_AVERAGE_JOB_MS,
    DEFAULT_STATUS_REFRESH_JOB_MS,
  );
  const requiredConcurrency = Math.max(
    1,
    Math.ceil((rpm * averageJobMs) / 60_000),
  );
  const configuredConcurrency = env.STATUS_REFRESH_CONCURRENCY
    ? positiveInteger(env.STATUS_REFRESH_CONCURRENCY, requiredConcurrency)
    : undefined;
  const concurrency = configuredConcurrency ?? requiredConcurrency;
  const rateCapacity = rpm * STATUS_REFRESH_SLA_MINUTES;
  const executionCapacity = Math.floor(
    (concurrency * STATUS_REFRESH_SLA_MS) / averageJobMs,
  );
  const cycleCapacity = Math.min(rateCapacity, executionCapacity);
  return {
    activeItems: normalizedActiveItems,
    requiredRpm,
    rpm,
    concurrency,
    averageJobMs,
    rateCapacity,
    executionCapacity,
    cycleCapacity,
    meetsSla: cycleCapacity >= normalizedActiveItems,
  };
}
