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

export const DEFAULT_STATUS_REFRESH_DETAIL_ESCALATION_FAILURES = 3;
export const ABSENCE_RECHECK_THRESHOLD = 2;
export const DEFAULT_DIRECT_LISTING_TTL_HOURS = 72;

/** Counters arrive from rows that may predate the health columns, so any
 * missing or malformed value reads as zero instead of throwing. */
export function nonNegativeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function counterOf(item: unknown, field: string): number {
  if (!item || typeof item !== "object") return 0;
  return nonNegativeCount((item as Record<string, unknown>)[field]);
}

export function refreshFailureCountOf(item: unknown): number {
  return counterOf(item, "refreshFailureCount");
}

export function consecutiveAbsenceCountOf(item: unknown): number {
  return counterOf(item, "consecutiveAbsenceCount");
}

export function statusRefreshDetailEscalationFailures(
  env: Record<string, string | undefined> = process.env,
): number {
  return positiveInteger(
    env.STATUS_REFRESH_DETAIL_ESCALATION_FAILURES,
    DEFAULT_STATUS_REFRESH_DETAIL_ESCALATION_FAILURES,
  );
}

/**
 * The cheap status probe is the default. A listing whose probe keeps
 * failing switches to the full detail path so a marketplace change that
 * broke the cheap probe cannot freeze the listing in its last known
 * state, and a forced recheck (search absence, operator tooling) always
 * takes the detail path regardless of the failure count.
 */
export function shouldUseDetailRefresh(
  input: { refreshFailureCount?: unknown; forceDetail?: boolean },
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (input.forceDetail) return true;
  return (
    nonNegativeCount(input.refreshFailureCount) >=
    statusRefreshDetailEscalationFailures(env)
  );
}

export function nextRefreshFailureCount(current: unknown): number {
  return nonNegativeCount(current) + 1;
}

/** Health stamped on every completed refresh, whatever it concluded. */
export function completedRefreshHealth(checkedAt: Date) {
  return { lastCheckedAt: checkedAt, refreshFailureCount: 0 };
}

/** Health stamped when a refresh attempt throws before concluding. */
export function failedRefreshHealth(current: unknown, checkedAt: Date) {
  return {
    lastCheckedAt: checkedAt,
    refreshFailureCount: nextRefreshFailureCount(current),
  };
}

/**
 * Only a non-rotating backfill pass can count absences. Incremental
 * one-page passes see a slice of the catalogue, and the scheduled
 * backfill jobs rotate their page window on every run, so a listing
 * missing from either kind of pass may simply sit on another page.
 */
export function isAbsenceCountingScan(query: {
  scanMode?: string | null;
  rotatePages?: boolean | null;
}): boolean {
  return query.scanMode === "backfill" && query.rotatePages !== true;
}

export function absenceCountAfterScan(
  current: unknown,
  present: boolean,
): number {
  return present ? 0 : nonNegativeCount(current) + 1;
}

/** The forced recheck fires once, on the scan that reaches the threshold. */
export function absenceRecheckCrossed(previous: unknown, next: unknown): boolean {
  return (
    nonNegativeCount(previous) < ABSENCE_RECHECK_THRESHOLD &&
    nonNegativeCount(next) >= ABSENCE_RECHECK_THRESHOLD
  );
}

export function directListingTtlHours(
  env: Record<string, string | undefined> = process.env,
): number {
  const parsed = Number(env.DIRECT_LISTING_TTL_HOURS);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_DIRECT_LISTING_TTL_HOURS;
}

export type StaleDirectListingCandidate = {
  listingType?: string | null;
  status?: string | null;
  lastSeenAt?: Date | string | null;
  consecutiveAbsenceCount?: unknown;
};

/**
 * TTL backstop for buy-now listings: auctions keep their own end-time
 * handling, and a listing may only expire when status probes never
 * resolved it (unknown), search backfills repeatedly stopped surfacing
 * it, and it has not been seen for the whole TTL window.
 */
export function isStaleDirectListing(
  candidate: StaleDirectListingCandidate,
  now: Date,
  ttlHours: number,
): boolean {
  if (candidate.listingType === "auction") return false;
  if (candidate.status !== "unknown") return false;
  if (
    nonNegativeCount(candidate.consecutiveAbsenceCount) <
    ABSENCE_RECHECK_THRESHOLD
  )
    return false;
  const lastSeenAt =
    candidate.lastSeenAt instanceof Date
      ? candidate.lastSeenAt
      : candidate.lastSeenAt
        ? new Date(candidate.lastSeenAt)
        : null;
  if (!lastSeenAt || Number.isNaN(lastSeenAt.getTime())) return false;
  return lastSeenAt.getTime() < now.getTime() - ttlHours * 60 * 60_000;
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
