import { describe, expect, it } from "vitest";
import {
  absenceCountAfterScan,
  absenceRecheckCrossed,
  completedRefreshHealth,
  directListingTtlHours,
  failedRefreshHealth,
  isAbsenceCountingScan,
  isStaleDirectListing,
  isStatusRefreshEligible,
  nextRefreshFailureCount,
  refreshFailureCountOf,
  shouldUseDetailRefresh,
  STATUS_REFRESH_SLA_MS,
  statusRefreshWorkerPlan,
} from "./status-refresh-policy.js";

describe("status refresh eligibility", () => {
  it("keeps both live and unresolved listings under monitoring", () => {
    expect(isStatusRefreshEligible("active")).toBe(true);
    expect(isStatusRefreshEligible("unknown")).toBe(true);
    expect(isStatusRefreshEligible("sold")).toBe(false);
    expect(isStatusRefreshEligible("ended")).toBe(false);
  });
});

describe("detail refresh escalation", () => {
  it("keeps the cheap probe below the default failure threshold", () => {
    expect(shouldUseDetailRefresh({ refreshFailureCount: 0 }, {})).toBe(false);
    expect(shouldUseDetailRefresh({ refreshFailureCount: 2 }, {})).toBe(false);
  });

  it("escalates to the detail path at and above the threshold", () => {
    expect(shouldUseDetailRefresh({ refreshFailureCount: 3 }, {})).toBe(true);
    expect(shouldUseDetailRefresh({ refreshFailureCount: 9 }, {})).toBe(true);
  });

  it("honours an env override and falls back on malformed values", () => {
    const env = { STATUS_REFRESH_DETAIL_ESCALATION_FAILURES: "1" };
    expect(shouldUseDetailRefresh({ refreshFailureCount: 1 }, env)).toBe(true);
    const broken = { STATUS_REFRESH_DETAIL_ESCALATION_FAILURES: "soon" };
    expect(shouldUseDetailRefresh({ refreshFailureCount: 2 }, broken)).toBe(
      false,
    );
    expect(shouldUseDetailRefresh({ refreshFailureCount: 3 }, broken)).toBe(
      true,
    );
    const zero = { STATUS_REFRESH_DETAIL_ESCALATION_FAILURES: "0" };
    expect(shouldUseDetailRefresh({ refreshFailureCount: 2 }, zero)).toBe(
      false,
    );
  });

  it("always takes the detail path for a forced recheck", () => {
    expect(
      shouldUseDetailRefresh({ refreshFailureCount: 0, forceDetail: true }, {}),
    ).toBe(true);
  });

  it("treats missing or malformed stored counts as zero", () => {
    expect(refreshFailureCountOf({})).toBe(0);
    expect(refreshFailureCountOf(null)).toBe(0);
    expect(refreshFailureCountOf({ refreshFailureCount: "3" })).toBe(0);
    expect(refreshFailureCountOf({ refreshFailureCount: 2.9 })).toBe(2);
  });
});

describe("refresh health transitions", () => {
  const checkedAt = new Date("2026-10-25T00:00:00.000Z");

  it("increments the consecutive failure count on a failed attempt", () => {
    expect(nextRefreshFailureCount(0)).toBe(1);
    expect(nextRefreshFailureCount(2)).toBe(3);
    expect(nextRefreshFailureCount(undefined)).toBe(1);
    expect(failedRefreshHealth(2, checkedAt)).toEqual({
      lastCheckedAt: checkedAt,
      refreshFailureCount: 3,
    });
  });

  it("resets the count and stamps the check on any completed refresh", () => {
    expect(completedRefreshHealth(checkedAt)).toEqual({
      lastCheckedAt: checkedAt,
      refreshFailureCount: 0,
    });
  });
});

describe("search absence counting", () => {
  it("only counts absences for a non-rotating backfill pass", () => {
    expect(isAbsenceCountingScan({ scanMode: "backfill" })).toBe(true);
    expect(
      isAbsenceCountingScan({ scanMode: "backfill", rotatePages: false }),
    ).toBe(true);
    expect(
      isAbsenceCountingScan({ scanMode: "backfill", rotatePages: true }),
    ).toBe(false);
    expect(isAbsenceCountingScan({ scanMode: "incremental" })).toBe(false);
    expect(isAbsenceCountingScan({})).toBe(false);
  });

  it("resets present listings and increments absent ones", () => {
    expect(absenceCountAfterScan(4, true)).toBe(0);
    expect(absenceCountAfterScan(0, false)).toBe(1);
    expect(absenceCountAfterScan(1, false)).toBe(2);
  });

  it("triggers the forced recheck only on the scan that crosses two", () => {
    expect(absenceRecheckCrossed(0, 1)).toBe(false);
    expect(absenceRecheckCrossed(1, 2)).toBe(true);
    expect(absenceRecheckCrossed(2, 3)).toBe(false);
    expect(absenceRecheckCrossed(3, 4)).toBe(false);
  });
});

describe("direct listing TTL predicate", () => {
  const now = new Date("2026-10-25T00:00:00.000Z");
  const stale = {
    listingType: "direct",
    status: "unknown",
    lastSeenAt: new Date(now.getTime() - 100 * 60 * 60_000),
    consecutiveAbsenceCount: 3,
  };

  it("expires a stale, repeatedly absent, unresolved direct listing", () => {
    expect(isStaleDirectListing(stale, now, 72)).toBe(true);
    expect(
      isStaleDirectListing({ ...stale, listingType: "unknown" }, now, 72),
    ).toBe(true);
  });

  it("excludes auctions, resolved statuses, low absence and fresh rows", () => {
    expect(
      isStaleDirectListing({ ...stale, listingType: "auction" }, now, 72),
    ).toBe(false);
    expect(isStaleDirectListing({ ...stale, status: "active" }, now, 72)).toBe(
      false,
    );
    expect(
      isStaleDirectListing(
        { ...stale, consecutiveAbsenceCount: 1 },
        now,
        72,
      ),
    ).toBe(false);
    expect(
      isStaleDirectListing(
        { ...stale, lastSeenAt: new Date(now.getTime() - 60 * 60_000) },
        now,
        72,
      ),
    ).toBe(false);
    expect(
      isStaleDirectListing({ ...stale, lastSeenAt: null }, now, 72),
    ).toBe(false);
  });

  it("parses the TTL hours env defensively", () => {
    expect(directListingTtlHours({})).toBe(72);
    expect(directListingTtlHours({ DIRECT_LISTING_TTL_HOURS: "24" })).toBe(24);
    expect(directListingTtlHours({ DIRECT_LISTING_TTL_HOURS: "-5" })).toBe(72);
    expect(directListingTtlHours({ DIRECT_LISTING_TTL_HOURS: "soon" })).toBe(
      72,
    );
  });
});

describe("status refresh SLA capacity", () => {
  it("can process the current active catalogue inside every two-hour cycle", () => {
    const currentActiveCatalogue = 12_838;
    const plan = statusRefreshWorkerPlan(currentActiveCatalogue, {});

    expect(STATUS_REFRESH_SLA_MS).toBe(2 * 60 * 60_000);
    expect(plan.cycleCapacity).toBeGreaterThanOrEqual(currentActiveCatalogue);
    expect(plan.meetsSla).toBe(true);
  });

  it("scales with a larger catalogue and exposes unsafe manual overrides", () => {
    const scaled = statusRefreshWorkerPlan(30_000, {});
    expect(scaled.requiredRpm).toBe(250);
    expect(scaled.rpm).toBe(250);
    expect(scaled.cycleCapacity).toBeGreaterThanOrEqual(30_000);
    expect(scaled.meetsSla).toBe(true);

    const undersized = statusRefreshWorkerPlan(30_000, {
      STATUS_REFRESH_RPM: "20",
      STATUS_REFRESH_CONCURRENCY: "3",
    });
    expect(undersized.meetsSla).toBe(false);
  });
});
