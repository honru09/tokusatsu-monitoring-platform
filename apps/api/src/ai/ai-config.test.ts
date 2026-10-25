import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_BULK_TASKS,
  AI_EXTENDED_TASKS,
  extendedAiScopesEnabled,
} from "./ai-config.js";

const originalExtendedScopes = process.env.AI_EXTENDED_SCOPES_ENABLED;

beforeEach(() => {
  delete process.env.AI_EXTENDED_SCOPES_ENABLED;
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (originalExtendedScopes == null)
    delete process.env.AI_EXTENDED_SCOPES_ENABLED;
  else process.env.AI_EXTENDED_SCOPES_ENABLED = originalExtendedScopes;
});

describe("AI task tiers in ai-config", () => {
  it("puts translation, classification and image analysis in the bulk (free) tier", () => {
    for (const task of ["translation", "classification", "image_analysis"] as const)
      expect(AI_BULK_TASKS).toContain(task);
  });

  it("keeps the extended scopes disjoint from the bulk tier", () => {
    const bulk = new Set<string>(AI_BULK_TASKS);
    expect(AI_EXTENDED_TASKS.filter((task) => bulk.has(task))).toEqual([]);
  });

  it("leaves the extended scopes off when the env is unset", () => {
    expect(process.env.AI_EXTENDED_SCOPES_ENABLED).toBeUndefined();
    expect(extendedAiScopesEnabled()).toBe(false);
  });
});
