import { afterEach, describe, expect, it } from "vitest";
import {
  AI_PROVIDER_IDS,
  AI_MODEL_ALLOWLIST,
  OPENROUTER_MODEL_ALLOWLIST,
  PROVIDER_MODEL_ALLOWLIST,
  candidatesForTask,
  modelAcceptsImages,
  modelDefinition,
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
const originalOvoRoute = process.env.AI_ROUTE_OVO_ASSISTANT_CHAT;
const originalPaidProviderAllowlist = process.env.AI_PAID_PROVIDER_ALLOWLIST;
const originalAssistantProviderOrder =
  process.env.AI_PROVIDER_ORDER_ASSISTANT_CHAT;
const originalGeminiModel = process.env.GEMINI_MODEL;

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
  if (originalOvoRoute == null) delete process.env.AI_ROUTE_OVO_ASSISTANT_CHAT;
  else process.env.AI_ROUTE_OVO_ASSISTANT_CHAT = originalOvoRoute;
  if (originalPaidProviderAllowlist == null)
    delete process.env.AI_PAID_PROVIDER_ALLOWLIST;
  else process.env.AI_PAID_PROVIDER_ALLOWLIST = originalPaidProviderAllowlist;
  if (originalAssistantProviderOrder == null)
    delete process.env.AI_PROVIDER_ORDER_ASSISTANT_CHAT;
  else
    process.env.AI_PROVIDER_ORDER_ASSISTANT_CHAT =
      originalAssistantProviderOrder;
  if (originalGeminiModel == null) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = originalGeminiModel;
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

  it("prefers the live-verified free OpenRouter model and filters paid calls", () => {
    delete process.env.AI_ROUTE_OPENROUTER_ASSISTANT_CHAT;
    delete process.env.AI_ALLOW_PAID_MODELS;
    expect(routeForProvider("assistant_chat", "openrouter")[0]).toBe(
      "minimax/minimax-m3:free",
    );

    process.env.AI_ALLOW_PAID_MODELS = "false";
    expect(routeForProvider("assistant_chat", "openrouter")).toEqual([
      "minimax/minimax-m3:free",
      "z-ai/glm-5.2:free",
    ]);
  });

  it("registers LiteLLM before direct providers with isolated allowlists", () => {
    expect(AI_PROVIDER_IDS).toEqual([
      "litellm",
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
      "ovo",
    ]);
    expect(PROVIDER_MODEL_ALLOWLIST.litellm).toEqual(
      new Set(["fast", "smart", "vision", "ocr"]),
    );
    expect(routeForProvider("translation", "litellm")).toEqual([
      "fast",
      "smart",
    ]);
    expect(routeForProvider("image_analysis", "litellm")).toEqual([
      "vision",
      "ocr",
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
    expect(routeForProvider("image_analysis", "cerebras")).toEqual([
      "gemma-4-31b",
    ]);
    expect(routeForProvider("image_analysis", "cloudflare")).toEqual([
      "@cf/meta/llama-3.2-11b-vision-instruct",
      "@cf/google/gemma-4-26b-a4b-it",
    ]);
    expect(routeForProvider("translation", "cohere")).toEqual([
      "command-a-translate-08-2025",
      "command-a-plus-05-2026",
    ]);
    expect(routeForProvider("translation", "sensenova")).toEqual([
      "sensenova-6.8-flash-lite",
    ]);
    expect(routeForProvider("image_analysis", "sensenova")).toEqual([
      "sensenova-6.8-flash-lite",
    ]);
    expect(modelAcceptsImages("sensenova", "sensenova-6.8-flash-lite")).toBe(
      true,
    );
    expect(PROVIDER_MODEL_ALLOWLIST.ovo).toEqual(new Set(["gpt-5.6-luna"]));
    expect(routeForProvider("translation", "ovo")).toEqual(["gpt-5.6-luna"]);
    expect(routeForProvider("image_analysis", "ovo")).toEqual(["gpt-5.6-luna"]);
  });

  it("scopes the global paid switch to the explicitly authorized provider", () => {
    process.env.AI_ALLOW_PAID_MODELS = "true";
    process.env.AI_PAID_PROVIDER_ALLOWLIST = "ovo";

    expect(routeForProvider("assistant_chat", "ovo")).toEqual(["gpt-5.6-luna"]);
    expect(routeForProvider("assistant_chat", "openrouter")).toEqual([
      "minimax/minimax-m3:free",
      "z-ai/glm-5.2:free",
    ]);
  });

  it("uses only the live OVO catalogue without injecting a preferred model", () => {
    process.env.AI_ROUTE_OVO_ASSISTANT_CHAT = "*";
    process.env.AI_ALLOW_PAID_MODELS = "true";
    process.env.AI_PAID_PROVIDER_ALLOWLIST = "ovo";

    const candidates = candidatesForTask("assistant_chat", ["ovo"], {
      costPolicy: "paid_allowed",
      requiresVision: false,
      rotationSeed: "00000000",
      availableModels: new Map([
        ["ovo", new Set(["gpt-6-astra", "gpt-5.6-terra"])],
      ]),
      costTierFor: () => "paid",
    });

    expect(candidates.map((candidate) => candidate.model)).toEqual([
      "gpt-6-astra",
      "gpt-5.6-terra",
    ]);
  });

  it("limits static B.AI promotion evidence to the four documented active models", () => {
    for (const model of [
      "mimo-v2.5",
      "deepseek-v4-flash-vision-exp",
      "qwen3.8-flash",
      "deepseek-v4-flash",
    ]) {
      expect(modelDefinition("bai", model)?.costTier).toBe("promotion");
    }
    expect(modelDefinition("bai", "glm-5.3-flash")?.costTier).toBe("unknown");
    expect(modelDefinition("bai", "hy3")?.costTier).toBe("unknown");
  });

  it("uses the current NVIDIA Riva Chat Completions translation model", () => {
    expect(routeForProvider("translation", "nvidia")).toContain(
      "nvidia/riva-translate-4b-instruct-v2",
    );
  });

  it("uses the live-probed Gemini model as the single text-task source", () => {
    process.env.GEMINI_MODEL = "gemini-3.1-flash-lite";

    expect(routeForProvider("translation", "gemini")).toEqual([
      "gemini-3.1-flash-lite",
    ]);
    expect(routeForProvider("assistant_chat", "gemini")).toEqual([
      "gemini-3.1-flash-lite",
    ]);
    expect(routeForProvider("image_analysis", "gemini")).toEqual([
      "gemini-3.7-flash",
    ]);
  });

  it("tracks current SiliconFlow pricing and vision capability", () => {
    expect(PROVIDER_MODEL_ALLOWLIST.siliconflow).not.toContain(
      "tencent/Hunyuan-MT-7B",
    );
    expect(routeForProvider("translation", "siliconflow")).not.toContain(
      "tencent/Hunyuan-MT-7B",
    );
    expect(
      modelDefinition("siliconflow", "Qwen/Qwen2.5-7B-Instruct")?.costTier,
    ).toBe("paid");
    expect(modelAcceptsImages("cerebras", "gemma-4-31b")).toBe(true);
    expect(
      modelAcceptsImages("cloudflare", "@cf/google/gemma-4-26b-a4b-it"),
    ).toBe(true);
  });

  it("exhausts same-tier models before switching provider and keeps OpenRouter paid models last", () => {
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
    expect(candidates.slice(0, 2).map((entry) => entry.provider)).toEqual([
      "openrouter",
      "openrouter",
    ]);
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
