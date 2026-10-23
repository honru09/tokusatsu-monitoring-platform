import { describe, expect, it } from "vitest";
import {
  isStatusRefreshEligible,
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
