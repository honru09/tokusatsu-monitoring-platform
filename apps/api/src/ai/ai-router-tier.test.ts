import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  candidatesForTask,
  routeFor,
  routeForProvider,
  taskTier,
  type AiTask,
} from "./ai-router.js";

const TOUCHED_ENV = [
  "AI_EXTENDED_SCOPES_ENABLED",
  "AI_PREMIUM_PROVIDER_ID",
  "GEMINI_API_KEY",
  "AI_GEMINI_CATALOGUE_FALLBACK_MODELS",
  "ZHIPU_API_KEY",
  "OVO_API_KEY",
] as const;
const originalEnv = new Map(TOUCHED_ENV.map((name) => [name, process.env[name]]));

beforeEach(() => {
  for (const name of TOUCHED_ENV) delete process.env[name];
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const name of TOUCHED_ENV) {
    const original = originalEnv.get(name);
    if (original == null) delete process.env[name];
    else process.env[name] = original;
  }
});

const ALL_TASKS: AiTask[] = [
  "bulk_filter", "translation", "classification", "image_analysis",
  "seller_analysis", "bundle_negotiation", "complex_analysis",
  "cross_validation", "market_analysis", "crawler_diagnosis",
  "logistics_analysis", "assistant_chat",
];
const ZHIPU_CANDIDATE = [{ provider: "zhipu", model: "glm-5.3-flash", costTier: "promotion" }] as const;

// Candidate lists captured from the router as it stood before tiered
// routing, keyed by task, for the two flag states with no premium provider
// configured.
const PRE_TIER_FLAG_OFF: Record<AiTask, unknown> = {
  bulk_filter: [], translation: ZHIPU_CANDIDATE, classification: ZHIPU_CANDIDATE,
  image_analysis: ZHIPU_CANDIDATE, seller_analysis: [], bundle_negotiation: [],
  complex_analysis: ZHIPU_CANDIDATE, cross_validation: [], market_analysis: [],
  crawler_diagnosis: [], logistics_analysis: [], assistant_chat: ZHIPU_CANDIDATE,
};
const PRE_TIER_FLAG_ON: Record<AiTask, unknown> = {
  ...PRE_TIER_FLAG_OFF,
  seller_analysis: ZHIPU_CANDIDATE, bundle_negotiation: ZHIPU_CANDIDATE,
};

function configureGeminiPremium() {
  vi.stubEnv("AI_PREMIUM_PROVIDER_ID", "gemini");
  vi.stubEnv("GEMINI_API_KEY", "fixture");
  vi.stubEnv("AI_GEMINI_CATALOGUE_FALLBACK_MODELS", "gemini-3.1-flash-lite");
}

describe("task tiers", () => {
  it("classes the scoped product-reading tasks as bulk and the extended scopes as high-value", () => {
    for (const task of ["translation", "classification", "image_analysis", "complex_analysis", "assistant_chat"] as const)
      expect(taskTier(task)).toBe("bulk");
    for (const task of ["seller_analysis", "bundle_negotiation"] as const)
      expect(taskTier(task)).toBe("high_value");
    for (const task of ["bulk_filter", "cross_validation", "market_analysis", "crawler_diagnosis", "logistics_analysis"] as const)
      expect(taskTier(task)).toBeUndefined();
  });
});

describe("tiered routing equivalence with no premium provider configured", () => {
  it("matches the pre-tier candidate lists for every task when the flag is off", () => {
    for (const task of ALL_TASKS)
      expect(candidatesForTask(task, ["zhipu"], { costPolicy: "free_first", requiresVision: false })).toEqual(PRE_TIER_FLAG_OFF[task]);
  });

  it("matches the pre-tier candidate lists for every task when the flag is on", () => {
    vi.stubEnv("AI_EXTENDED_SCOPES_ENABLED", "true");
    for (const task of ALL_TASKS)
      expect(candidatesForTask(task, ["zhipu"], { costPolicy: "free_first", requiresVision: false })).toEqual(PRE_TIER_FLAG_ON[task]);
    for (const task of ALL_TASKS)
      expect(routeFor(task)).toEqual((PRE_TIER_FLAG_ON[task] as unknown[]).length > 0 ? ["glm-5.3-flash"] : []);
  });

  it("stays equivalent even when a premium provider is named but the flag is off", () => {
    configureGeminiPremium();
    for (const task of ALL_TASKS)
      expect(candidatesForTask(task, ["zhipu", "gemini"], { costPolicy: "free_first", requiresVision: false })).toEqual(PRE_TIER_FLAG_OFF[task]);
    expect(routeForProvider("seller_analysis", "gemini")).toEqual([]);
  });
});
