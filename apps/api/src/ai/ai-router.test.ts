import { afterEach, describe, expect, it } from "vitest";
import {
  AI_MODEL_ALLOWLIST,
  AI_PROVIDER_IDS,
  PROVIDER_MODEL_ALLOWLIST,
  candidatesForTask,
  modelAcceptsImages,
  modelDefinition,
  modelStateKey,
  providerOrder,
  routeFor,
  routeForProvider,
  type AiProvider,
} from "./ai-router.js";
import { ZHIPU_MODEL } from "./ai-config.js";

const managedEnvironment = [
  "AI_PROVIDER_ORDER",
  "AI_PROVIDER_ORDER_ASSISTANT_CHAT",
  "AI_ROUTE_ASSISTANT_CHAT",
  "AI_ROUTE_OPENROUTER_ASSISTANT_CHAT",
  "AI_ROUTE_NVIDIA_ASSISTANT_CHAT",
  "AI_ROUTE_OVO_ASSISTANT_CHAT",
  "AI_ALLOW_PAID_MODELS",
  "AI_PAID_PROVIDER_ALLOWLIST",
  "GEMINI_MODEL",
  "AI_EXTENDED_SCOPES_ENABLED",
  "AI_PREMIUM_PROVIDER_ID",
] as const;

const originalEnvironment = new Map(
  managedEnvironment.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  for (const name of managedEnvironment) {
    const original = originalEnvironment.get(name);
    if (original == null) delete process.env[name];
    else process.env[name] = original;
  }
});

describe("assistant AI route", () => {
  it("resolves only the Zhipu provider", () => {
    expect(AI_PROVIDER_IDS).toEqual(["zhipu"]);
    expect(providerOrder()).toEqual(["zhipu"]);
    expect(providerOrder("assistant_chat")).toEqual(["zhipu"]);
  });

  it("ignores legacy provider-order configuration", () => {
    process.env.AI_PROVIDER_ORDER = "bai|invalid|openrouter|bai";
    process.env.AI_PROVIDER_ORDER_ASSISTANT_CHAT =
      "openrouter|siliconflow|groq";

    expect(providerOrder()).toEqual(["zhipu"]);
    expect(providerOrder("assistant_chat")).toEqual(["zhipu"]);
  });

  it("routes every scoped task to the single Zhipu model", () => {
    for (const task of [
      "translation",
      "classification",
      "image_analysis",
      "complex_analysis",
      "assistant_chat",
    ] as const) {
      expect(routeFor(task)).toEqual([ZHIPU_MODEL]);
      expect(routeForProvider(task, "zhipu")).toEqual([ZHIPU_MODEL]);
    }
  });

  it("routes no task to an unknown provider id", () => {
    // Removed providers are not part of the AiProvider type anymore; an id
    // arriving as a plain string (stale config, an old audit row) routes
    // nowhere.
    for (const provider of ["litellm", "bai", "gemini", "ovo"] as unknown as AiProvider[]) {
      expect(routeForProvider("assistant_chat", provider)).toEqual([]);
      expect(routeForProvider("translation", provider)).toEqual([]);
      expect(routeForProvider("image_analysis", provider)).toEqual([]);
    }
  });

  it("leaves tasks outside the scoped set unrouted", () => {
    for (const task of [
      "bulk_filter",
      "cross_validation",
      "market_analysis",
      "crawler_diagnosis",
      "logistics_analysis",
    ] as const) {
      expect(routeFor(task)).toEqual([]);
      expect(routeForProvider(task, "zhipu")).toEqual([]);
    }
  });

  it("keeps the extended scopes unrouted while the opt-in flag is off", () => {
    delete process.env.AI_EXTENDED_SCOPES_ENABLED;

    expect(routeFor("seller_analysis")).toEqual([]);
    expect(routeFor("bundle_negotiation")).toEqual([]);
    expect(
      candidatesForTask("seller_analysis", ["zhipu"], {
        costPolicy: "free_only",
        requiresVision: false,
      }),
    ).toEqual([]);
  });

  it("routes the extended scopes to Zhipu only after the explicit opt-in", () => {
    process.env.AI_EXTENDED_SCOPES_ENABLED = "true";

    expect(routeFor("seller_analysis")).toEqual([ZHIPU_MODEL]);
    expect(routeFor("bundle_negotiation")).toEqual([ZHIPU_MODEL]);
  });

  it("keeps every allowlist scoped to the Zhipu model", () => {
    expect(AI_MODEL_ALLOWLIST).toEqual(new Set([ZHIPU_MODEL]));
    expect(PROVIDER_MODEL_ALLOWLIST.zhipu).toEqual(new Set([ZHIPU_MODEL]));
    expect(Object.keys(PROVIDER_MODEL_ALLOWLIST)).toEqual(["zhipu"]);
  });

  it("describes the Zhipu model in the catalog", () => {
    expect(modelDefinition("zhipu", ZHIPU_MODEL)).toMatchObject({
      provider: "zhipu",
      id: ZHIPU_MODEL,
      costTier: "promotion",
      inputModalities: ["text", "image"],
    });
    expect(modelAcceptsImages("zhipu", ZHIPU_MODEL)).toBe(true);
    expect(modelDefinition("zhipu", "unlisted-model")).toBeUndefined();
  });

  it("offers only the Zhipu candidate for a scoped task", () => {
    expect(
      candidatesForTask("assistant_chat", ["zhipu"], {
        costPolicy: "free_only",
        requiresVision: false,
      }),
    ).toEqual([
      { provider: "zhipu", model: ZHIPU_MODEL, costTier: "promotion" },
    ]);
    expect(
      candidatesForTask("translation", ["zhipu"], {
        costPolicy: "free_first",
        requiresVision: false,
        costTierFor: () => "free",
      }),
    ).toEqual([{ provider: "zhipu", model: ZHIPU_MODEL, costTier: "free" }]);
  });

  it("offers no candidate when Zhipu is not among the providers", () => {
    expect(
      candidatesForTask("assistant_chat", ["gemini", "ovo"] as unknown as AiProvider[], {
        costPolicy: "paid_allowed",
        requiresVision: false,
      }),
    ).toEqual([]);
  });

  it("uses provider-qualified model state keys", () => {
    expect(modelStateKey("zhipu", ZHIPU_MODEL)).toBe(`zhipu:${ZHIPU_MODEL}`);
    expect(modelStateKey("zhipu", "shared/model")).toBe("zhipu:shared/model");
  });
});
