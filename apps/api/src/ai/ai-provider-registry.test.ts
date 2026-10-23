import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configuredProviderRuntimes,
  diagnosticProviderRuntimes,
  providerCredentialEnvironmentName,
  providerConfigurationStatuses,
} from "./ai-provider-registry.js";

const originalEnvironment = { ...process.env };

describe("AI provider registry", () => {
  beforeEach(() => {
    for (const key of [
      "LITELLM_API_KEY",
      "LITELLM_API_URL",
      "LITELLM_API_TIER",
      "LITELLM_FREE_MODELS",
      "LITELLM_PROMOTION_MODELS",
      "LITELLM_PAID_MODELS",
      "LITELLM_PRIVATE_DATA_AUTHORIZED",
      "LITELLM_CUSTOM_ENDPOINT_AUTHORIZED",
      "AI_ALLOW_CUSTOM_PROVIDER_ENDPOINTS",
      "BAI_API_KEY",
      "BAI_API_URL",
      "BAI_API_TIER",
      "BAI_PROMOTION_MODELS",
      "BAI_PRICING_VERIFIED_AT",
      "BAI_CUSTOM_ENDPOINT_AUTHORIZED",
      "BAI_INTERNAL_EVALUATION",
      "BAI_PRODUCTION_AUTHORIZED",
      "BAI_PRIVATE_DATA_AUTHORIZED",
      "OPENROUTER_API_KEY",
      "OPENROUTER_API_URL",
      "OPENROUTER_API_TIER",
      "OPENROUTER_FREE_MODELS",
      "OPENROUTER_PROMOTION_MODELS",
      "OPENROUTER_PAID_MODELS",
      "OPENROUTER_PRICING_VERIFIED_AT",
      "OPENROUTER_CUSTOM_ENDPOINT_AUTHORIZED",
      "GEMINI_API_KEY",
      "GEMINI_API_URL",
      "GEMINI_API_TIER",
      "GEMINI_FREE_MODELS",
      "GEMINI_PROMOTION_MODELS",
      "GEMINI_PAID_MODELS",
      "GEMINI_PRICING_VERIFIED_AT",
      "GEMINI_CUSTOM_ENDPOINT_AUTHORIZED",
      "GROQ_API_KEY",
      "GROQ_API_URL",
      "GROQ_API_TIER",
      "GROQ_FREE_MODELS",
      "GROQ_PROMOTION_MODELS",
      "GROQ_PAID_MODELS",
      "GROQ_PRICING_VERIFIED_AT",
      "GROQ_CUSTOM_ENDPOINT_AUTHORIZED",
      "SILICONFLOW_API_KEY",
      "SILICONFLOW_API_URL",
      "SILICONFLOW_API_TIER",
      "SILICONFLOW_FREE_MODELS",
      "SILICONFLOW_PROMOTION_MODELS",
      "SILICONFLOW_PAID_MODELS",
      "SILICONFLOW_PRICING_VERIFIED_AT",
      "SILICONFLOW_CUSTOM_ENDPOINT_AUTHORIZED",
      "SILICONFLOW_INTERNAL_EVALUATION",
      "SILICONFLOW_PRODUCTION_AUTHORIZED",
      "SILICONFLOW_PRIVATE_DATA_AUTHORIZED",
      "CEREBRAS_API_KEY",
      "CEREBRAS_API_URL",
      "CEREBRAS_API_TIER",
      "CEREBRAS_FREE_MODELS",
      "CEREBRAS_PROMOTION_MODELS",
      "CEREBRAS_PAID_MODELS",
      "CEREBRAS_PRICING_VERIFIED_AT",
      "CEREBRAS_PRIVATE_DATA_AUTHORIZED",
      "CEREBRAS_CUSTOM_ENDPOINT_AUTHORIZED",
      "CLOUDFLARE_AI_API_TOKEN",
      "CLOUDFLARE_AI_API_URL",
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_AI_API_TIER",
      "CLOUDFLARE_AI_FREE_MODELS",
      "CLOUDFLARE_AI_PROMOTION_MODELS",
      "CLOUDFLARE_AI_PAID_MODELS",
      "CLOUDFLARE_AI_PRICING_VERIFIED_AT",
      "CLOUDFLARE_AI_ALLOW_OVERAGE",
      "CLOUDFLARE_AI_PRIVATE_DATA_AUTHORIZED",
      "CLOUDFLARE_AI_CUSTOM_ENDPOINT_AUTHORIZED",
      "COHERE_API_KEY",
      "COHERE_API_URL",
      "COHERE_API_TIER",
      "COHERE_FREE_MODELS",
      "COHERE_PROMOTION_MODELS",
      "COHERE_PAID_MODELS",
      "COHERE_PRICING_VERIFIED_AT",
      "COHERE_PRODUCTION_AUTHORIZED",
      "COHERE_INTERNAL_EVALUATION",
      "COHERE_PRIVATE_DATA_AUTHORIZED",
      "COHERE_CUSTOM_ENDPOINT_AUTHORIZED",
      "NVIDIA_API_KEY",
      "NVIDIA_API_URL",
      "NVIDIA_API_TIER",
      "NVIDIA_PRODUCTION_AUTHORIZED",
      "NVIDIA_INTERNAL_EVALUATION",
      "NVIDIA_PRIVATE_DATA_AUTHORIZED",
      "NVIDIA_PRICING_VERIFIED_AT",
      "NVIDIA_FREE_MODELS",
      "NVIDIA_PROMOTION_MODELS",
      "NVIDIA_PAID_MODELS",
      "NVIDIA_CUSTOM_ENDPOINT_AUTHORIZED",
      "SENSENOVA_API_KEY",
      "SENSENOVA_TRANSLATION_API_KEY",
      "SENSENOVA_SECONDARY_API_KEY",
      "SENSENOVA_API_URL",
      "SENSENOVA_API_TIER",
      "SENSENOVA_FREE_MODELS",
      "SENSENOVA_PROMOTION_MODELS",
      "SENSENOVA_PAID_MODELS",
      "SENSENOVA_PRICING_VERIFIED_AT",
      "SENSENOVA_INTERNAL_EVALUATION",
      "SENSENOVA_PRODUCTION_AUTHORIZED",
      "SENSENOVA_PRIVATE_DATA_AUTHORIZED",
      "SENSENOVA_CUSTOM_ENDPOINT_AUTHORIZED",
      "OVO_API_KEY",
      "OVO_API_URL",
      "OVO_API_TIER",
      "OVO_INTERNAL_EVALUATION",
      "OVO_PRODUCTION_AUTHORIZED",
      "OVO_PRIVATE_DATA_AUTHORIZED",
      "OVO_CUSTOM_ENDPOINT_AUTHORIZED",
      "AI_PRICING_VERIFICATION_MAX_AGE_MS",
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

  it("treats LiteLLM model groups as the primary virtual provider", () => {
    process.env.LITELLM_API_KEY = "test-gateway-key";
    process.env.LITELLM_API_URL = "https://litellm.test/v1/";
    process.env.LITELLM_CUSTOM_ENDPOINT_AUTHORIZED = "true";
    process.env.LITELLM_FREE_MODELS = "fast|ocr";
    process.env.LITELLM_PAID_MODELS = "smart,vision";
    const runtime = configuredProviderRuntimes(["litellm"])[0];

    expect(runtime?.apiUrl).toBe("https://litellm.test/v1");
    expect(runtime?.catalogueUrl).toBe("https://litellm.test/v1/models");
    expect(runtime?.costTierFor("fast")).toBe("free");
    expect(runtime?.costTierFor("smart")).toBe("paid");
    expect(runtime?.costTierFor("vision")).toBe("paid");
    expect(runtime?.costTierFor("ocr")).toBe("free");
    expect(runtime?.allowsDataClass("public_market")).toBe(true);
    expect(runtime?.allowsDataClass("user_private")).toBe(false);

    process.env.LITELLM_PRIVATE_DATA_AUTHORIZED = "true";
    expect(
      configuredProviderRuntimes(["litellm"])[0]?.allowsDataClass(
        "user_private",
      ),
    ).toBe(true);
  });

  it("registers OVO as an explicitly authorized Chat Completions paid provider", () => {
    process.env.OVO_API_KEY = "test-ovo-key";

    expect(configuredProviderRuntimes(["ovo"])).toEqual([]);

    process.env.OVO_INTERNAL_EVALUATION = "true";
    const runtime = configuredProviderRuntimes(["ovo"])[0];

    expect(runtime).toMatchObject({
      id: "ovo",
      label: "OVO GPT 特惠组",
      apiUrl: "https://ovo1.cn/v1",
      apiTier: "paid",
      quotaScope: "account",
      wireApi: "chat_completions",
    });
    expect(runtime?.staticModelIds).toBeUndefined();
    expect(runtime?.catalogueFallbackModelIds).toBeUndefined();
    expect(runtime?.headers(true)).toEqual({
      accept: "application/json",
      authorization: "Bearer test-ovo-key",
      "content-type": "application/json",
    });
    expect(runtime?.costTierFor("gpt-5.6-luna")).toBe("paid");
    expect(runtime?.allowsDataClass("public_market")).toBe(true);
    expect(runtime?.allowsDataClass("user_private")).toBe(false);
    expect(runtime?.allowsDataClass("sensitive_image")).toBe(false);

    process.env.OVO_PRIVATE_DATA_AUTHORIZED = "true";
    expect(
      configuredProviderRuntimes(["ovo"])[0]?.allowsDataClass("user_private"),
    ).toBe(false);
    expect(
      configuredProviderRuntimes(["ovo"])[0]?.allowsDataClass(
        "sensitive_image",
      ),
    ).toBe(false);
  });

  it("maps the legacy BAI credential to OVO by endpoint without double registration", () => {
    process.env.BAI_API_KEY = "legacy-ovo-key";
    process.env.BAI_API_URL = "https://ovo1.cn/v1/";
    process.env.OVO_INTERNAL_EVALUATION = "true";

    const runtimes = configuredProviderRuntimes(["bai", "ovo"]);

    expect(runtimes).toHaveLength(1);
    expect(runtimes[0]).toMatchObject({
      id: "ovo",
      apiUrl: "https://ovo1.cn/v1",
      wireApi: "chat_completions",
    });
    expect(runtimes[0]?.staticModelIds).toBeUndefined();
    expect(runtimes[0]?.catalogueFallbackModelIds).toBeUndefined();
    expect(runtimes[0]?.headers(false).authorization).toBe(
      "Bearer legacy-ovo-key",
    );
    expect(providerCredentialEnvironmentName("ovo", "default")).toBe(
      "BAI_API_KEY",
    );
    const statuses = providerConfigurationStatuses();
    expect(statuses.find(({ provider }) => provider === "bai")).toMatchObject({
      credentialConfigured: false,
      configuredCredentialCount: 0,
      active: false,
    });
    expect(statuses.find(({ provider }) => provider === "ovo")).toMatchObject({
      credentialEnvironmentNames: ["OVO_API_KEY", "BAI_API_KEY"],
      credentialConfigured: true,
      configuredCredentialCount: 1,
      active: true,
    });
  });

  it("does not misclassify lookalike BAI hosts as OVO", () => {
    process.env.BAI_API_KEY = "bai-key";
    process.env.BAI_API_URL = "https://ovo1.cn.example.test/v1";
    process.env.BAI_CUSTOM_ENDPOINT_AUTHORIZED = "true";
    process.env.BAI_INTERNAL_EVALUATION = "true";
    process.env.OVO_INTERNAL_EVALUATION = "true";

    expect(
      configuredProviderRuntimes(["bai", "ovo"]).map(({ id }) => id),
    ).toEqual(["bai"]);
  });

  it("keeps an explicit B.AI promotion eligible for live document verification", () => {
    process.env.BAI_API_KEY = "test-key";
    process.env.BAI_INTERNAL_EVALUATION = "true";
    process.env.BAI_API_TIER = "promotion";
    process.env.BAI_PROMOTION_MODELS = "glm-5.3-flash";
    process.env.AI_PRICING_VERIFICATION_MAX_AGE_MS = "60000";
    process.env.BAI_PRICING_VERIFIED_AT = new Date(
      Date.now() - 120_000,
    ).toISOString();
    let runtime = configuredProviderRuntimes(["bai"])[0];

    expect(runtime?.costTierFor("glm-5.3-flash")).toBe("unknown");

    process.env.BAI_PRICING_VERIFIED_AT = new Date().toISOString();
    runtime = configuredProviderRuntimes(["bai"])[0];

    expect(runtime?.costTierFor("glm-5.3-flash")).toBe("promotion");
  });

  it("does not infer a B.AI promotion from a key alone", () => {
    process.env.BAI_API_KEY = "test-key";
    process.env.BAI_INTERNAL_EVALUATION = "true";
    const runtime = configuredProviderRuntimes(["bai"])[0];

    expect(runtime?.apiTier).toBe("unknown");
    expect(runtime?.costTierFor("mimo-v2.5")).toBe("unknown");
  });

  it("keeps OpenRouter :free variants eligible without expiring manual price evidence", () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    const runtime = configuredProviderRuntimes(["openrouter"])[0];

    expect(runtime?.costTierFor("minimax/minimax-m3:free")).toBe("free");
    expect(runtime?.costTierFor("deepseek/deepseek-v4-flash")).toBe("paid");
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

  it("never admits a statically paid model through a free account tier", () => {
    process.env.SILICONFLOW_API_KEY = "test-silicon";
    process.env.SILICONFLOW_INTERNAL_EVALUATION = "true";
    process.env.SILICONFLOW_API_TIER = "free";
    const runtime = configuredProviderRuntimes(["siliconflow"])[0];

    expect(runtime?.costTierFor("Qwen/Qwen2.5-7B-Instruct")).toBe("paid");
  });

  it("keeps a catalogued paid SiliconFlow model paid despite a free-list override", () => {
    process.env.SILICONFLOW_API_KEY = "test-silicon";
    process.env.SILICONFLOW_INTERNAL_EVALUATION = "true";
    let runtime = configuredProviderRuntimes(["siliconflow"])[0];
    expect(runtime?.apiUrl).toBe("https://api.siliconflow.cn/v1");
    expect(runtime?.costTierFor("Qwen/Qwen2.5-7B-Instruct")).toBe("paid");

    process.env.SILICONFLOW_FREE_MODELS = "Qwen/Qwen2.5-7B-Instruct";
    process.env.SILICONFLOW_PRICING_VERIFIED_AT = new Date().toISOString();
    runtime = configuredProviderRuntimes(["siliconflow"])[0];
    expect(runtime?.costTierFor("Qwen/Qwen2.5-7B-Instruct")).toBe("paid");
  });

  it("accepts only official provider hosts unless a custom endpoint is explicitly authorized", () => {
    process.env.BAI_API_KEY = "test-key";
    process.env.BAI_INTERNAL_EVALUATION = "true";
    process.env.BAI_API_URL = "https://api.b.ai.attacker.test/v1";

    expect(configuredProviderRuntimes(["bai"])).toHaveLength(0);
    expect(
      providerConfigurationStatuses().find((entry) => entry.provider === "bai"),
    ).toMatchObject({
      active: false,
      activationReason: "invalid_or_unauthorized_api_url",
    });

    process.env.BAI_API_URL = "https://trusted-proxy.test/v1";
    expect(configuredProviderRuntimes(["bai"])).toHaveLength(0);

    process.env.BAI_CUSTOM_ENDPOINT_AUTHORIZED = " TRUE ";
    expect(configuredProviderRuntimes(["bai"])[0]?.apiUrl).toBe(
      "https://trusted-proxy.test/v1",
    );

    delete process.env.BAI_CUSTOM_ENDPOINT_AUTHORIZED;
    process.env.AI_ALLOW_CUSTOM_PROVIDER_ENDPOINTS = "true";
    expect(configuredProviderRuntimes(["bai"])[0]?.apiUrl).toBe(
      "https://trusted-proxy.test/v1",
    );
  });

  it("keeps custom Cohere credentials on their explicitly authorized host", () => {
    process.env.COHERE_API_KEY = "test-key";
    process.env.COHERE_INTERNAL_EVALUATION = "true";
    process.env.COHERE_API_URL = "https://cohere-proxy.test/v1";
    process.env.COHERE_CUSTOM_ENDPOINT_AUTHORIZED = "true";

    const runtime = configuredProviderRuntimes(["cohere"])[0];
    expect(runtime?.apiUrl).toBe("https://cohere-proxy.test/v1");
    expect(runtime?.catalogueUrl).toBe("https://cohere-proxy.test/v1/models");
  });

  it("rejects credentials in URLs and insecure direct-provider endpoints", () => {
    process.env.GROQ_API_KEY = "test-key";
    process.env.GROQ_API_URL = "https://user:password@api.groq.com/openai/v1";
    expect(configuredProviderRuntimes(["groq"])).toHaveLength(0);

    process.env.GROQ_API_URL = "http://api.groq.com/openai/v1";
    process.env.GROQ_CUSTOM_ENDPOINT_AUTHORIZED = "true";
    expect(configuredProviderRuntimes(["groq"])).toHaveLength(0);
  });

  it("allows an explicitly authorized HTTP endpoint only for self-hosted LiteLLM", () => {
    process.env.LITELLM_API_KEY = "test-key";
    process.env.LITELLM_API_URL = "http://gateway.internal:4000/v1";
    expect(configuredProviderRuntimes(["litellm"])).toHaveLength(0);

    process.env.LITELLM_CUSTOM_ENDPOINT_AUTHORIZED = "true";
    expect(configuredProviderRuntimes(["litellm"])[0]?.apiUrl).toBe(
      "http://gateway.internal:4000/v1",
    );
  });

  it("accepts both official SiliconFlow API hosts", () => {
    process.env.SILICONFLOW_API_KEY = "test-key";
    process.env.SILICONFLOW_INTERNAL_EVALUATION = "true";
    process.env.SILICONFLOW_API_URL = "https://api.siliconflow.com/v1";

    expect(configuredProviderRuntimes(["siliconflow"])[0]?.apiUrl).toBe(
      "https://api.siliconflow.com/v1",
    );
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

  it("uses explicit Cerebras Free Trial promotion classification", () => {
    process.env.CEREBRAS_API_KEY = "test-cerebras";
    let runtime = configuredProviderRuntimes(["cerebras"])[0];
    expect(runtime?.costTierFor("gpt-oss-120b")).toBe("unknown");

    process.env.CEREBRAS_API_TIER = "promotion";
    process.env.CEREBRAS_PROMOTION_MODELS = "gpt-oss-120b";
    process.env.CEREBRAS_PRICING_VERIFIED_AT = new Date().toISOString();
    runtime = configuredProviderRuntimes(["cerebras"])[0];
    expect(runtime?.apiUrl).toBe("https://api.cerebras.ai/v1");
    expect(runtime?.costTierFor("gpt-oss-120b")).toBe("promotion");
  });

  it("builds the Cloudflare account endpoint and parses its model catalogue", () => {
    process.env.CLOUDFLARE_AI_API_TOKEN = "test-cloudflare";
    process.env.CLOUDFLARE_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
    process.env.CLOUDFLARE_AI_API_TIER = "free";
    process.env.CLOUDFLARE_AI_FREE_MODELS = "@cf/zai-org/glm-4.7-flash";
    process.env.CLOUDFLARE_AI_PRICING_VERIFIED_AT = new Date().toISOString();
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

  it("reports Cloudflare account and endpoint failures separately", () => {
    process.env.CLOUDFLARE_AI_API_TOKEN = "test-cloudflare";
    process.env.CLOUDFLARE_ACCOUNT_ID = "not-an-account-id";
    expect(
      providerConfigurationStatuses().find(
        (entry) => entry.provider === "cloudflare",
      ),
    ).toMatchObject({ activationReason: "invalid_or_missing_account_id" });

    process.env.CLOUDFLARE_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
    process.env.CLOUDFLARE_AI_API_URL =
      "https://cloudflare-proxy.test/accounts/{account_id}/ai/v1";
    expect(
      providerConfigurationStatuses().find(
        (entry) => entry.provider === "cloudflare",
      ),
    ).toMatchObject({
      activationReason: "invalid_or_unauthorized_api_url",
    });

    process.env.CLOUDFLARE_AI_CUSTOM_ENDPOINT_AUTHORIZED = "true";
    expect(configuredProviderRuntimes(["cloudflare"])).toHaveLength(1);
  });

  it("keeps Cohere trial credentials out until evaluation or production is explicit", () => {
    process.env.COHERE_API_KEY = "test-cohere";
    expect(configuredProviderRuntimes(["cohere"])).toHaveLength(0);

    process.env.COHERE_INTERNAL_EVALUATION = "true";
    process.env.COHERE_API_TIER = "promotion";
    process.env.COHERE_PROMOTION_MODELS = "command-a-plus-05-2026";
    process.env.COHERE_PRICING_VERIFIED_AT = new Date().toISOString();
    let runtime = configuredProviderRuntimes(["cohere"])[0];
    expect(runtime?.costTierFor("command-a-plus-05-2026")).toBe("promotion");
    expect(runtime?.allowsDataClass("user_private")).toBe(false);

    process.env.COHERE_PRODUCTION_AUTHORIZED = "true";
    process.env.COHERE_API_TIER = "paid";
    process.env.COHERE_PRIVATE_DATA_AUTHORIZED = "true";
    runtime = configuredProviderRuntimes(["cohere"])[0];
    expect(runtime?.allowsDataClass("user_private")).toBe(true);
  });

  it("allows explicit diagnostics without activating restricted providers", () => {
    process.env.COHERE_API_KEY = "test-cohere";
    process.env.NVIDIA_API_KEY = "test-nvidia";

    expect(configuredProviderRuntimes(["cohere", "nvidia"])).toHaveLength(0);
    expect(
      diagnosticProviderRuntimes(["cohere", "nvidia"]).map(
        (runtime) => runtime.id,
      ),
    ).toEqual(["cohere", "nvidia"]);
    expect(configuredProviderRuntimes(["cohere", "nvidia"])).toHaveLength(0);
  });

  it.each([
    {
      provider: "bai" as const,
      key: "BAI_API_KEY",
      evaluation: "BAI_INTERNAL_EVALUATION",
      production: "BAI_PRODUCTION_AUTHORIZED",
      privateAuthorization: "BAI_PRIVATE_DATA_AUTHORIZED",
    },
    {
      provider: "siliconflow" as const,
      key: "SILICONFLOW_API_KEY",
      evaluation: "SILICONFLOW_INTERNAL_EVALUATION",
      production: "SILICONFLOW_PRODUCTION_AUTHORIZED",
      privateAuthorization: "SILICONFLOW_PRIVATE_DATA_AUTHORIZED",
    },
    {
      provider: "sensenova" as const,
      key: "SENSENOVA_API_KEY",
      evaluation: "SENSENOVA_INTERNAL_EVALUATION",
      production: "SENSENOVA_PRODUCTION_AUTHORIZED",
      privateAuthorization: "SENSENOVA_PRIVATE_DATA_AUTHORIZED",
    },
  ])(
    "requires environment-specific authorization for $provider and keeps private data separate",
    ({ provider, key, evaluation, production, privateAuthorization }) => {
      process.env[key] = `test-${provider}`;

      expect(configuredProviderRuntimes([provider])).toHaveLength(0);
      expect(
        providerConfigurationStatuses().find(
          (entry) => entry.provider === provider,
        ),
      ).toMatchObject({
        active: false,
        activationReason: "evaluation_authorization_required",
        privateDataAllowed: false,
      });

      process.env[production] = "true";
      expect(configuredProviderRuntimes([provider])).toHaveLength(0);

      process.env[evaluation] = "true";
      expect(configuredProviderRuntimes([provider])).toHaveLength(1);
      expect(
        providerConfigurationStatuses().find(
          (entry) => entry.provider === provider,
        ),
      ).toMatchObject({
        active: true,
        activationReason: "ready",
        privateDataAllowed: false,
      });

      process.env[privateAuthorization] = "true";
      expect(
        providerConfigurationStatuses().find(
          (entry) => entry.provider === provider,
        )?.privateDataAllowed,
      ).toBe(true);

      process.env.NODE_ENV = "production";
      delete process.env[production];
      expect(configuredProviderRuntimes([provider])).toHaveLength(0);
      expect(
        providerConfigurationStatuses().find(
          (entry) => entry.provider === provider,
        ),
      ).toMatchObject({
        active: false,
        activationReason: "production_authorization_required",
      });

      process.env[production] = "true";
      expect(configuredProviderRuntimes([provider])).toHaveLength(1);
    },
  );

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
    process.env.BAI_INTERNAL_EVALUATION = "true";
    let runtime = configuredProviderRuntimes(["bai"])[0];
    expect(runtime?.allowsDataClass("public_market")).toBe(true);
    expect(runtime?.allowsDataClass("user_private")).toBe(false);

    process.env.BAI_PRIVATE_DATA_AUTHORIZED = "true";
    runtime = configuredProviderRuntimes(["bai"])[0];
    expect(runtime?.allowsDataClass("user_private")).toBe(true);
  });

  it("uses safe SenseNova credential aliases, account groups, and task ordering", () => {
    process.env.SENSENOVA_API_KEY = "test-main-secret";
    process.env.SENSENOVA_TRANSLATION_API_KEY = "test-translation-secret";
    process.env.SENSENOVA_SECONDARY_API_KEY = "test-secondary-secret";
    process.env.SENSENOVA_INTERNAL_EVALUATION = "true";
    const runtime = configuredProviderRuntimes(["sensenova"])[0];

    expect(runtime?.quotaScope).toBe("account");
    expect(runtime?.credentialIds("assistant_chat")).toEqual([
      "main",
      "translation",
      "secondary",
    ]);
    expect(runtime?.credentialIds("translation")).toEqual([
      "translation",
      "main",
      "secondary",
    ]);
    expect(runtime?.credentialQuotaGroup?.("main")).toBe("account-primary");
    expect(runtime?.credentialQuotaGroup?.("translation")).toBe(
      "account-primary",
    );
    expect(runtime?.credentialQuotaGroup?.("secondary")).toBe(
      "account-secondary",
    );
    expect(runtime?.credentialQuotaGroup?.("unknown")).toBe("shared");
    expect(runtime?.headers(true, "assistant_chat").authorization).toBe(
      "Bearer test-main-secret",
    );
    expect(runtime?.headers(true, "translation").authorization).toBe(
      "Bearer test-translation-secret",
    );
    expect(
      runtime?.headers(true, "assistant_chat", "secondary").authorization,
    ).toBe("Bearer test-secondary-secret");
    expect(providerCredentialEnvironmentName("sensenova", "main")).toBe(
      "SENSENOVA_API_KEY",
    );
    expect(providerCredentialEnvironmentName("sensenova", "translation")).toBe(
      "SENSENOVA_TRANSLATION_API_KEY",
    );
    expect(providerCredentialEnvironmentName("sensenova", "secondary")).toBe(
      "SENSENOVA_SECONDARY_API_KEY",
    );
  });

  it("keeps non-credential quota scopes in one fail-closed group", () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    process.env.LITELLM_API_KEY = "test-litellm";
    const [openrouter, litellm] = configuredProviderRuntimes([
      "openrouter",
      "litellm",
    ]);

    expect(openrouter?.credentialQuotaGroup?.("alias-a")).toBe("shared");
    expect(litellm?.credentialQuotaGroup?.("alias-a")).toBe("alias-a");
  });

  it("keeps SenseNova out of free-only routing unless its tier is explicitly verified", () => {
    process.env.SENSENOVA_API_KEY = "test-main-secret";
    process.env.SENSENOVA_INTERNAL_EVALUATION = "true";
    let runtime = configuredProviderRuntimes(["sensenova"])[0];
    expect(runtime?.costTierFor("sensenova-6.8-flash-lite")).toBe("unknown");

    process.env.SENSENOVA_API_TIER = "promotion";
    process.env.SENSENOVA_PROMOTION_MODELS = "sensenova-6.8-flash-lite";
    process.env.SENSENOVA_PRICING_VERIFIED_AT = new Date().toISOString();
    runtime = configuredProviderRuntimes(["sensenova"])[0];
    expect(runtime?.costTierFor("sensenova-6.8-flash-lite")).toBe("promotion");
  });

  it("reports credential configuration without exposing credential values", () => {
    process.env.SENSENOVA_API_KEY = "test-main-secret";
    process.env.SENSENOVA_TRANSLATION_API_KEY = "test-translation-secret";
    process.env.SENSENOVA_SECONDARY_API_KEY = "test-secondary-secret";
    process.env.SENSENOVA_INTERNAL_EVALUATION = "true";
    process.env.COHERE_API_KEY = "test-cohere-secret";
    const statuses = providerConfigurationStatuses();
    const senseNova = statuses.find((entry) => entry.provider === "sensenova");
    const cohere = statuses.find((entry) => entry.provider === "cohere");
    const serialized = JSON.stringify(statuses);

    expect(senseNova).toEqual(
      expect.objectContaining({
        credentialConfigured: true,
        configuredCredentialCount: 3,
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
    expect(serialized).not.toContain("test-secondary-secret");
    expect(serialized).not.toContain("test-cohere-secret");
  });
});

describe("AI secret synchronization contract", () => {
  const source = readFileSync(
    new URL("../../../../scripts/sync-ai-secrets.ps1", import.meta.url),
    "utf8",
  );

  it("keeps synchronized text routes Gemini-first and image analysis OVO-only", () => {
    const orders = [
      ...source.matchAll(
        /Set-EnvValue \$content '(AI_PROVIDER_ORDER(?:_[A-Z_]+)?)' '([^']*)'/g,
      ),
    ].map((match) => ({ name: match[1], value: match[2] }));

    expect(orders).toHaveLength(12);
    expect(
      orders.find(({ name }) => name === "AI_PROVIDER_ORDER_IMAGE_ANALYSIS")
        ?.value,
    ).toBe("ovo");
    expect(
      orders
        .filter(({ name }) => name !== "AI_PROVIDER_ORDER_IMAGE_ANALYSIS")
        .every(({ value }) => value === "gemini|ovo"),
    ).toBe(true);
  });

  it("preserves upstream credentials but pauses every non-OVO restricted provider", () => {
    expect(source).not.toMatch(/Remove-Env\w*[^\r\n]*DEEPSEEK/i);
    for (const name of [
      "BAI_INTERNAL_EVALUATION",
      "BAI_PRODUCTION_AUTHORIZED",
      "SILICONFLOW_INTERNAL_EVALUATION",
      "SILICONFLOW_PRODUCTION_AUTHORIZED",
      "SENSENOVA_INTERNAL_EVALUATION",
      "SENSENOVA_PRODUCTION_AUTHORIZED",
      "COHERE_INTERNAL_EVALUATION",
      "COHERE_PRODUCTION_AUTHORIZED",
      "NVIDIA_INTERNAL_EVALUATION",
      "NVIDIA_PRODUCTION_AUTHORIZED",
    ]) {
      expect(source).toContain(`Set-EnvValue $content '${name}' 'false'`);
    }
    expect(source).toContain(
      "Set-EnvValue $content 'OVO_PRODUCTION_AUTHORIZED' 'true'",
    );
    expect(source).toContain(
      "Set-EnvValue $content 'OVO_PRIVATE_DATA_AUTHORIZED' 'false'",
    );
  });

  it("discovers the legacy OVO console-adjacent key without accepting lookalike hosts or ambiguous values", () => {
    expect(source).toContain(
      "$ovoConsoleKey = Read-SecretAfterConsoleUrl `\n  'OVO'",
    );
    expect(source).toContain("https://ovo1\\.cn/?(?=$|");
    expect(source).toContain("'^sk-[A-Za-z0-9_-]{20,}$'");
    expect(source).toContain("$ovoLabeledKey -ne $ovoConsoleKey");
    expect(source).toContain(
      "$ovoKey = if ($ovoLabeledKey) { $ovoLabeledKey } else { $ovoConsoleKey }",
    );
  });

  it("keeps SenseNova endpoint and task routes aligned with the registry", () => {
    expect(source).toContain(
      "Set-EnvValue $content 'SENSENOVA_API_URL' 'https://token.sensenova.cn/v1'",
    );
    expect(source).toContain(
      "Set-EnvValue $content 'AI_ROUTE_SENSENOVA_IMAGE_ANALYSIS' 'sensenova-6.8-flash-lite'",
    );
    const taskRoutes = [
      ...source.matchAll(
        /Set-EnvValue \$content 'AI_ROUTE_SENSENOVA_[A-Z_]+' '([^']*)'/g,
      ),
    ];
    expect(taskRoutes).toHaveLength(11);
    expect(
      taskRoutes.every((match) => match[1] === "sensenova-6.8-flash-lite"),
    ).toBe(true);
  });

  it("reports only the number of direct providers synchronized in this run", () => {
    expect(source).toContain("synced_direct_provider_count=");
    expect(source).not.toContain("credentials_complete=");
    expect(source).not.toMatch(/；provider_count=/);
  });
});
