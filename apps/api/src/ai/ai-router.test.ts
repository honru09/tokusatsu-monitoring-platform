import { afterEach, describe, expect, it } from "vitest";
import {
  AI_PROVIDER_IDS,
  AI_MODEL_ALLOWLIST,
  OPENROUTER_MODEL_ALLOWLIST,
  PROVIDER_MODEL_ALLOWLIST,
  candidatesForTask,
  modelStateKey,
  providerOrder,
  routeFor,
  routeForProvider,
} from "./ai-router.js";

const originalRoute = process.env.AI_ROUTE_ASSISTANT_CHAT;
const originalOpenRouterRoute = process.env.AI_ROUTE_OPENROUTER_ASSISTANT_CHAT;
const originalProviderOrder = process.env.AI_PROVIDER_ORDER;
const originalAllowPaid = process.env.AI_ALLOW_PAID_MODELS;
const originalNvidiaRoute = process.env.AI_ROUTE_NVIDIA_ASSISTANT_CHAT;
const originalAssistantProviderOrder =
  process.env.AI_PROVIDER_ORDER_ASSISTANT_CHAT;

afterEach(() => {
  if (originalRoute == null) delete process.env.AI_ROUTE_ASSISTANT_CHAT;
  else process.env.AI_ROUTE_ASSISTANT_CHAT = originalRoute;
  if (originalOpenRouterRoute == null)
    delete process.env.AI_ROUTE_OPENROUTER_ASSISTANT_CHAT;
  else process.env.AI_ROUTE_OPENROUTER_ASSISTANT_CHAT = originalOpenRouterRoute;
  if (originalProviderOrder == null) delete process.env.AI_PROVIDER_ORDER;
  else process.env.AI_PROVIDER_ORDER = originalProviderOrder;
  if (originalAllowPaid == null) delete process.env.AI_ALLOW_PAID_MODELS;
  else process.env.AI_ALLOW_PAID_MODELS = originalAllowPaid;
  if (originalNvidiaRoute == null)
    delete process.env.AI_ROUTE_NVIDIA_ASSISTANT_CHAT;
  else process.env.AI_ROUTE_NVIDIA_ASSISTANT_CHAT = originalNvidiaRoute;
  if (originalAssistantProviderOrder == null)
    delete process.env.AI_PROVIDER_ORDER_ASSISTANT_CHAT;
  else
    process.env.AI_PROVIDER_ORDER_ASSISTANT_CHAT =
      originalAssistantProviderOrder;
});

describe("assistant AI route", () => {
  it("uses the Central AI Brain route from the approved B.AI model registry", () => {
    delete process.env.AI_ROUTE_ASSISTANT_CHAT;

    expect(routeFor("assistant_chat")).toEqual([
      "glm-5.3-flash",
      "qwen3.8-flash",
      "mimo-v2.5",
    ]);
  });

  it("rejects every model outside the six-model report allowlist", () => {
    process.env.AI_ROUTE_ASSISTANT_CHAT =
      "gpt-5.6-sol|unapproved/free|glm-5.3-flash|glm-5.3-flash|deepseek-v4-pro";

    expect(routeFor("assistant_chat")).toEqual(["glm-5.3-flash"]);
    expect(AI_MODEL_ALLOWLIST).toEqual(
      new Set([
        "mimo-v2.5",
        "glm-5.3-flash",
        "deepseek-v4-flash-vision-exp",
        "qwen3.8-flash",
        "deepseek-v4-flash",
        "hy3",
      ]),
    );
  });

  it("uses only implementation-guide models for OpenRouter fallback", () => {
    process.env.AI_ROUTE_OPENROUTER_ASSISTANT_CHAT =
      "openai/gpt-5|z-ai/glm-5.2:free|z-ai/glm-5.2:free|anthropic/claude-opus";

    expect(routeForProvider("assistant_chat", "openrouter")).toEqual([
      "z-ai/glm-5.2:free",
    ]);
    expect(OPENROUTER_MODEL_ALLOWLIST).toEqual(
      new Set([
        "deepseek/deepseek-v4-flash",
        "deepseek/deepseek-v4-flash-vision-exp",
        "z-ai/glm-5.2:free",
        "minimax/minimax-m3:free",
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "qwen/qwen3-coder",
      ]),
    );
  });

  it("rejects unknown providers and de-duplicates the provider order", () => {
    process.env.AI_PROVIDER_ORDER = "bai|invalid|openrouter|bai";

    expect(providerOrder()).toEqual(["bai", "openrouter"]);
  });

  it("uses the current paid report model first unless paid calls are disabled", () => {
    delete process.env.AI_ROUTE_OPENROUTER_ASSISTANT_CHAT;
    delete process.env.AI_ALLOW_PAID_MODELS;
    expect(routeForProvider("assistant_chat", "openrouter")[0]).toBe(
      "deepseek/deepseek-v4-flash",
    );

    process.env.AI_ALLOW_PAID_MODELS = "false";
    expect(routeForProvider("assistant_chat", "openrouter")).toEqual([
      "z-ai/glm-5.2:free",
      "minimax/minimax-m3:free",
    ]);
  });

  it("registers all ten providers and their isolated model allowlists", () => {
    expect(AI_PROVIDER_IDS).toEqual([
      "bai",
      "gemini",
      "groq",
      "siliconflow",
      "cerebras",
      "cloudflare",
      "cohere",
      "nvidia",
      "sensenova",
      "openrouter",
    ]);
    expect(PROVIDER_MODEL_ALLOWLIST.nvidia).toEqual(
      new Set([
        "nvidia/nemotron-3-nano-30b-a3b",
        "nvidia/nemotron-3-super-120b-a12b",
        "nvidia/riva-translate-4b-instruct-v2",
      ]),
    );
    expect(routeForProvider("assistant_chat", "nvidia")).toEqual([
      "nvidia/nemotron-3-nano-30b-a3b",
      "nvidia/nemotron-3-super-120b-a12b",
    ]);
    expect(routeForProvider("assistant_chat", "cerebras")).toEqual([
      "gpt-oss-120b",
      "gemma-4-31b",
    ]);
    expect(routeForProvider("image_analysis", "cloudflare")).toEqual([
      "@cf/meta/llama-3.2-11b-vision-instruct",
    ]);
    expect(routeForProvider("translation", "cohere")).toEqual([
      "command-a-translate-08-2025",
      "command-a-plus-05-2026",
    ]);
    expect(routeForProvider("translation", "sensenova")).toEqual([
      "SenseNova-V6-5-Turbo",
      "SenseNova-V6-5-Pro",
      "SenseChat-5",
    ]);
  });

  it("keeps NVIDIA Riva out of the generic JSON translation route", () => {
    expect(routeForProvider("translation", "nvidia")).not.toContain(
      "nvidia/riva-translate-4b-instruct-v2",
    );
  });

  it("interleaves providers and keeps OpenRouter paid models last", () => {
    process.env.AI_PROVIDER_ORDER_ASSISTANT_CHAT =
      "openrouter|siliconflow|groq";
    const candidates = candidatesForTask(
      "assistant_chat",
      ["openrouter", "siliconflow", "groq"],
      {
        costPolicy: "free_first",
        requiresVision: false,
        rotationSeed: "00000000",
        costTierFor: (provider, model) => {
          if (provider === "openrouter")
            return model.endsWith(":free") ? "free" : "paid";
          if (provider === "groq") return "free";
          return "unknown";
        },
      },
    );

    expect(candidates[0]?.costTier).toBe("free");
    expect(
      candidates.findIndex((entry) => entry.costTier === "unknown"),
    ).toBeGreaterThan(0);
    const firstPaid = candidates.findIndex(
      (entry) => entry.costTier === "paid",
    );
    expect(firstPaid).toBeGreaterThan(0);
    expect(candidates.slice(firstPaid).at(-1)?.provider).toBe("openrouter");
  });

  it("uses provider-qualified model state keys", () => {
    expect(modelStateKey("bai", "shared/model")).toBe("bai:shared/model");
    expect(modelStateKey("groq", "shared/model")).toBe("groq:shared/model");
  });
});
