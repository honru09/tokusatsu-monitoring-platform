import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configuredProviderRuntimes,
  providerConfigurationStatuses,
} from "./ai-provider-registry.js";

const originalEnvironment = { ...process.env };

describe("AI provider registry", () => {
  beforeEach(() => {
    for (const key of [
      "BAI_API_KEY",
      "BAI_API_TIER",
      "GEMINI_API_KEY",
      "GEMINI_API_TIER",
      "GROQ_API_KEY",
      "GROQ_API_TIER",
      "SILICONFLOW_API_KEY",
      "SILICONFLOW_API_URL",
      "SILICONFLOW_FREE_MODELS",
      "CEREBRAS_API_KEY",
      "CEREBRAS_API_TIER",
      "CEREBRAS_PRIVATE_DATA_AUTHORIZED",
      "CLOUDFLARE_AI_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_AI_API_TIER",
      "CLOUDFLARE_AI_ALLOW_OVERAGE",
      "CLOUDFLARE_AI_PRIVATE_DATA_AUTHORIZED",
      "COHERE_API_KEY",
      "COHERE_API_TIER",
      "COHERE_PRODUCTION_AUTHORIZED",
      "COHERE_INTERNAL_EVALUATION",
      "COHERE_PRIVATE_DATA_AUTHORIZED",
      "NVIDIA_API_KEY",
      "NVIDIA_API_TIER",
      "NVIDIA_PRODUCTION_AUTHORIZED",
      "NVIDIA_INTERNAL_EVALUATION",
      "NVIDIA_PRIVATE_DATA_AUTHORIZED",
      "NVIDIA_PRICING_VERIFIED_AT",
      "SENSENOVA_API_KEY",
      "SENSENOVA_TRANSLATION_API_KEY",
      "SENSENOVA_API_TIER",
      "SENSENOVA_PRIVATE_DATA_AUTHORIZED",
    ])
      delete process.env[key];
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnvironment)) delete process.env[key];
    }
    Object.assign(process.env, originalEnvironment);
  });

  it("keeps an explicit B.AI promotion eligible for live document verification", () => {
    process.env.BAI_API_KEY = "test-key";
    process.env.BAI_API_TIER = "promotion";
    const runtime = configuredProviderRuntimes(["bai"])[0];

    expect(runtime?.costTierFor("glm-5.3-flash")).toBe("promotion");
  });

  it("requires Gemini and Groq free tiers to be explicit", () => {
    process.env.GEMINI_API_KEY = "test-gemini";
    process.env.GROQ_API_KEY = "test-groq";
    const unknown = configuredProviderRuntimes(["gemini", "groq"]);
    process.env.GEMINI_API_TIER = "free";
    process.env.GROQ_API_TIER = "free";
    const free = configuredProviderRuntimes(["gemini", "groq"]);

    expect(
      unknown.map((provider) => provider.costTierFor("gemini-3.7-flash")),
    ).toContain("unknown");
    expect(free[0]?.costTierFor("gemini-3.7-flash")).toBe("free");
    expect(free[1]?.costTierFor("openai/gpt-oss-20b")).toBe("free");
  });

  it("uses SiliconFlow CN and only trusts an explicit free-model list", () => {
    process.env.SILICONFLOW_API_KEY = "test-silicon";
    let runtime = configuredProviderRuntimes(["siliconflow"])[0];
    expect(runtime?.apiUrl).toBe("https://api.siliconflow.cn/v1");
    expect(runtime?.costTierFor("Qwen/Qwen2.5-7B-Instruct")).toBe("unknown");

    process.env.SILICONFLOW_FREE_MODELS = "Qwen/Qwen2.5-7B-Instruct";
    runtime = configuredProviderRuntimes(["siliconflow"])[0];
    expect(runtime?.costTierFor("Qwen/Qwen2.5-7B-Instruct")).toBe("free");
  });

  it("requires explicit activation and paid authorization for NVIDIA", () => {
    process.env.NVIDIA_API_KEY = "test-nvidia";
    expect(configuredProviderRuntimes(["nvidia"])).toHaveLength(0);

    process.env.NVIDIA_INTERNAL_EVALUATION = "true";
    let runtime = configuredProviderRuntimes(["nvidia"])[0];
    expect(runtime?.apiUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(runtime?.allowsDataClass("public_market")).toBe(true);
    expect(runtime?.allowsDataClass("user_private")).toBe(false);

    process.env.NVIDIA_API_TIER = "paid";
    process.env.NVIDIA_PRODUCTION_AUTHORIZED = " TRUE ";
    process.env.NVIDIA_PRIVATE_DATA_AUTHORIZED = "True";
    runtime = configuredProviderRuntimes(["nvidia"])[0];
    expect(runtime?.allowsDataClass("user_private")).toBe(true);
    expect(runtime?.allowsDataClass("sensitive_image")).toBe(true);
  });

  it("uses explicit Cerebras free-tier classification", () => {
    process.env.CEREBRAS_API_KEY = "test-cerebras";
    let runtime = configuredProviderRuntimes(["cerebras"])[0];
    expect(runtime?.costTierFor("gpt-oss-120b")).toBe("unknown");

    process.env.CEREBRAS_API_TIER = "free";
    runtime = configuredProviderRuntimes(["cerebras"])[0];
    expect(runtime?.apiUrl).toBe("https://api.cerebras.ai/v1");
    expect(runtime?.costTierFor("gpt-oss-120b")).toBe("free");
  });

  it("builds the Cloudflare account endpoint and parses its model catalogue", () => {
    process.env.CLOUDFLARE_AI_API_TOKEN = "test-cloudflare";
    process.env.CLOUDFLARE_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
    process.env.CLOUDFLARE_AI_API_TIER = "free";
    const runtime = configuredProviderRuntimes(["cloudflare"])[0];

    expect(runtime?.apiUrl).toBe(
      "https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1",
    );
    expect(runtime?.catalogueUrl).toContain("/ai/models/search?");
    expect(
      runtime?.extractCatalogueModelIds({
        result: [
          { name: "@cf/zai-org/glm-4.7-flash" },
          { name: "@cf/openai/gpt-oss-120b" },
        ],
      }),
    ).toEqual(["@cf/zai-org/glm-4.7-flash", "@cf/openai/gpt-oss-120b"]);
    expect(runtime?.costTierFor("@cf/zai-org/glm-4.7-flash")).toBe("free");
  });

  it("keeps Cohere trial credentials out until evaluation or production is explicit", () => {
    process.env.COHERE_API_KEY = "test-cohere";
    expect(configuredProviderRuntimes(["cohere"])).toHaveLength(0);

    process.env.COHERE_INTERNAL_EVALUATION = "true";
    process.env.COHERE_API_TIER = "promotion";
    let runtime = configuredProviderRuntimes(["cohere"])[0];
    expect(runtime?.costTierFor("command-a-plus-05-2026")).toBe("promotion");
    expect(runtime?.allowsDataClass("user_private")).toBe(false);

    process.env.COHERE_PRODUCTION_AUTHORIZED = "true";
    process.env.COHERE_API_TIER = "paid";
    process.env.COHERE_PRIVATE_DATA_AUTHORIZED = "true";
    runtime = configuredProviderRuntimes(["cohere"])[0];
    expect(runtime?.allowsDataClass("user_private")).toBe(true);
  });

  it.each([
    {
      provider: "cohere" as const,
      key: "COHERE_API_KEY",
      evaluation: "COHERE_INTERNAL_EVALUATION",
      production: "COHERE_PRODUCTION_AUTHORIZED",
    },
    {
      provider: "nvidia" as const,
      key: "NVIDIA_API_KEY",
      evaluation: "NVIDIA_INTERNAL_EVALUATION",
      production: "NVIDIA_PRODUCTION_AUTHORIZED",
    },
  ])(
    "does not let $provider internal evaluation enable the production runtime",
    ({ provider, key, evaluation, production }) => {
      process.env.NODE_ENV = "production";
      process.env[key] = `test-${provider}`;
      process.env[evaluation] = "true";

      expect(configuredProviderRuntimes([provider])).toHaveLength(0);

      process.env[production] = "true";
      expect(configuredProviderRuntimes([provider])).toHaveLength(1);
    },
  );

  it("denies private data to every provider unless explicitly authorized", () => {
    process.env.BAI_API_KEY = "test-bai";
    let runtime = configuredProviderRuntimes(["bai"])[0];
    expect(runtime?.allowsDataClass("public_market")).toBe(true);
    expect(runtime?.allowsDataClass("user_private")).toBe(false);

    process.env.BAI_PRIVATE_DATA_AUTHORIZED = "true";
    runtime = configuredProviderRuntimes(["bai"])[0];
    expect(runtime?.allowsDataClass("user_private")).toBe(true);
  });

  it("uses safe SenseNova credential aliases and prefers the translation credential by task", () => {
    process.env.SENSENOVA_API_KEY = "test-main-secret";
    process.env.SENSENOVA_TRANSLATION_API_KEY = "test-translation-secret";
    const runtime = configuredProviderRuntimes(["sensenova"])[0];

    expect(runtime?.credentialIds("assistant_chat")).toEqual([
      "main",
      "translation",
    ]);
    expect(runtime?.credentialIds("translation")).toEqual([
      "translation",
      "main",
    ]);
    expect(runtime?.headers(true, "assistant_chat").authorization).toBe(
      "Bearer test-main-secret",
    );
    expect(runtime?.headers(true, "translation").authorization).toBe(
      "Bearer test-translation-secret",
    );
  });

  it("keeps SenseNova out of free-only routing unless its tier is explicitly verified", () => {
    process.env.SENSENOVA_API_KEY = "test-main-secret";
    let runtime = configuredProviderRuntimes(["sensenova"])[0];
    expect(runtime?.costTierFor("sensenova-6.8-flash-lite")).toBe("unknown");

    process.env.SENSENOVA_API_TIER = "promotion";
    runtime = configuredProviderRuntimes(["sensenova"])[0];
    expect(runtime?.costTierFor("sensenova-6.8-flash-lite")).toBe("promotion");
  });

  it("reports credential configuration without exposing credential values", () => {
    process.env.SENSENOVA_API_KEY = "test-main-secret";
    process.env.SENSENOVA_TRANSLATION_API_KEY = "test-translation-secret";
    process.env.COHERE_API_KEY = "test-cohere-secret";
    const statuses = providerConfigurationStatuses();
    const senseNova = statuses.find((entry) => entry.provider === "sensenova");
    const cohere = statuses.find((entry) => entry.provider === "cohere");
    const serialized = JSON.stringify(statuses);

    expect(senseNova).toEqual(
      expect.objectContaining({
        credentialConfigured: true,
        configuredCredentialCount: 2,
        active: true,
        activationReason: "ready",
        apiTier: "unknown",
      }),
    );
    expect(cohere).toEqual(
      expect.objectContaining({
        credentialConfigured: true,
        configuredCredentialCount: 1,
        active: false,
        activationReason: "evaluation_authorization_required",
      }),
    );
    expect(serialized).not.toContain("test-main-secret");
    expect(serialized).not.toContain("test-translation-secret");
    expect(serialized).not.toContain("test-cohere-secret");
  });
});
