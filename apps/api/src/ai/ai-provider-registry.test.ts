import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configuredProviderRuntimes,
  providerConfigurationStatuses,
  providerCredentialEnvironmentName,
} from "./ai-provider-registry.js";
import { ZHIPU_MODEL, type AiProvider } from "./ai-config.js";

const originalEnvironment = { ...process.env };

const managedEnvironment = [
  "ZHIPU_API_KEY",
  "ZHIPU_API_URL",
  "ZHIPU_API_TIER",
  "ZHIPU_CUSTOM_ENDPOINT_AUTHORIZED",
  "ZHIPU_PRIVATE_DATA_AUTHORIZED",
  "AI_ALLOW_CUSTOM_PROVIDER_ENDPOINTS",
  "LITELLM_API_KEY",
  "LITELLM_API_URL",
  "LITELLM_CUSTOM_ENDPOINT_AUTHORIZED",
  "BAI_API_KEY",
  "BAI_API_URL",
  "BAI_INTERNAL_EVALUATION",
  "BAI_PRODUCTION_AUTHORIZED",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "GEMINI_API_URL",
  "GROQ_API_KEY",
  "GROQ_API_URL",
  "GROQ_CUSTOM_ENDPOINT_AUTHORIZED",
  "SILICONFLOW_API_KEY",
  "SILICONFLOW_INTERNAL_EVALUATION",
  "CEREBRAS_API_KEY",
  "CLOUDFLARE_AI_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "COHERE_API_KEY",
  "COHERE_INTERNAL_EVALUATION",
  "NVIDIA_API_KEY",
  "NVIDIA_INTERNAL_EVALUATION",
  "SENSENOVA_API_KEY",
  "SENSENOVA_INTERNAL_EVALUATION",
  "OVO_API_KEY",
  "OVO_API_URL",
  "OVO_INTERNAL_EVALUATION",
  "OVO_PRODUCTION_AUTHORIZED",
];

describe("AI provider registry", () => {
  beforeEach(() => {
    for (const key of managedEnvironment) delete process.env[key];
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnvironment)) delete process.env[key];
    }
    Object.assign(process.env, originalEnvironment);
  });

  it("registers the Zhipu runtime from its credential", () => {
    process.env.ZHIPU_API_KEY = "test-zhipu-secret";

    const runtime = configuredProviderRuntimes()[0];

    expect(configuredProviderRuntimes().map(({ id }) => id)).toEqual([
      "zhipu",
    ]);
    expect(runtime).toMatchObject({
      id: "zhipu",
      label: "智谱",
      apiUrl: "https://open.bigmodel.cn/api/paas/v4",
      catalogueUrl: "https://open.bigmodel.cn/api/paas/v4/models",
      apiTier: "promotion",
      quotaScope: "account",
      staticModelIds: [ZHIPU_MODEL],
    });
    expect(runtime?.credentialIds()).toEqual(["default"]);
    expect(runtime?.headers(true)).toEqual({
      accept: "application/json",
      authorization: "Bearer test-zhipu-secret",
      "content-type": "application/json",
    });
    expect(runtime?.costTierFor(ZHIPU_MODEL)).toBe("promotion");
    expect(runtime?.allowsDataClass("public_market")).toBe(true);
    expect(
      runtime?.extractCatalogueModelIds({
        data: [{ id: ZHIPU_MODEL }, { id: "other-model" }, {}],
      }),
    ).toEqual([ZHIPU_MODEL, "other-model"]);
    expect(providerCredentialEnvironmentName("zhipu", "default")).toBe(
      "ZHIPU_API_KEY",
    );
  });

  it("shapes Zhipu request bodies around the single scoped model", () => {
    process.env.ZHIPU_API_KEY = "test-zhipu-secret";
    const runtime = configuredProviderRuntimes()[0];

    expect(
      runtime?.normalizeRequestBody({ model: "anything", messages: [] }),
    ).toMatchObject({
      model: ZHIPU_MODEL,
      stream: false,
      response_format: { type: "json_object" },
      thinking: { type: "enabled" },
      reasoning_effort: "low",
    });
  });

  it("keeps Zhipu private data behind its explicit authorization", () => {
    process.env.ZHIPU_API_KEY = "test-zhipu-secret";

    expect(
      configuredProviderRuntimes()[0]?.allowsDataClass("user_private"),
    ).toBe(false);
    expect(
      configuredProviderRuntimes()[0]?.allowsDataClass("sensitive_image"),
    ).toBe(false);

    process.env.ZHIPU_PRIVATE_DATA_AUTHORIZED = "true";
    expect(
      configuredProviderRuntimes()[0]?.allowsDataClass("user_private"),
    ).toBe(true);
    expect(
      configuredProviderRuntimes()[0]?.allowsDataClass("sensitive_image"),
    ).toBe(true);
  });

  it("registers no runtime without the Zhipu credential", () => {
    expect(configuredProviderRuntimes()).toEqual([]);
  });

  it("never registers a legacy provider, even with credentials and authorizations set", () => {
    process.env.LITELLM_API_KEY = "test-litellm-secret";
    process.env.LITELLM_API_URL = "https://litellm.test/v1/";
    process.env.LITELLM_CUSTOM_ENDPOINT_AUTHORIZED = "true";
    process.env.BAI_API_KEY = "test-bai-secret";
    process.env.BAI_INTERNAL_EVALUATION = "true";
    process.env.OPENROUTER_API_KEY = "test-openrouter-secret";
    process.env.GEMINI_API_KEY = "test-gemini-secret";
    process.env.GROQ_API_KEY = "test-groq-secret";
    process.env.SILICONFLOW_API_KEY = "test-siliconflow-secret";
    process.env.SILICONFLOW_INTERNAL_EVALUATION = "true";
    process.env.CEREBRAS_API_KEY = "test-cerebras-secret";
    process.env.CLOUDFLARE_AI_API_TOKEN = "test-cloudflare-secret";
    process.env.CLOUDFLARE_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
    process.env.COHERE_API_KEY = "test-cohere-secret";
    process.env.COHERE_INTERNAL_EVALUATION = "true";
    process.env.NVIDIA_API_KEY = "test-nvidia-secret";
    process.env.NVIDIA_INTERNAL_EVALUATION = "true";
    process.env.SENSENOVA_API_KEY = "test-sensenova-secret";
    process.env.SENSENOVA_INTERNAL_EVALUATION = "true";
    process.env.OVO_API_KEY = "test-ovo-secret";
    process.env.OVO_INTERNAL_EVALUATION = "true";

    expect(configuredProviderRuntimes()).toEqual([]);
    // Removed provider ids are not part of the AiProvider type anymore;
    // passed as plain strings they are simply not configured.
    expect(
      configuredProviderRuntimes([
        "litellm",
        "bai",
        "gemini",
        "ovo",
      ] as unknown as AiProvider[]),
    ).toEqual([]);
    expect(providerConfigurationStatuses().map(({ provider }) => provider)).toEqual(
      ["zhipu"],
    );
  });

  it("rejects credentials in URLs and insecure Zhipu endpoints", () => {
    process.env.ZHIPU_API_KEY = "test-zhipu-secret";
    process.env.ZHIPU_API_URL =
      "https://user:password@open.bigmodel.cn/api/paas/v4";
    expect(configuredProviderRuntimes()).toHaveLength(0);

    process.env.ZHIPU_API_URL = "http://open.bigmodel.cn/api/paas/v4";
    process.env.ZHIPU_CUSTOM_ENDPOINT_AUTHORIZED = "true";
    expect(configuredProviderRuntimes()).toHaveLength(0);
  });

  it("rejects an unofficial Zhipu host, even with a custom-endpoint authorization", () => {
    process.env.ZHIPU_API_KEY = "test-zhipu-secret";
    process.env.ZHIPU_API_URL = "https://zhipu-proxy.test/api/paas/v4";

    expect(configuredProviderRuntimes()).toHaveLength(0);
    expect(providerConfigurationStatuses()[0]).toMatchObject({
      provider: "zhipu",
      active: false,
      activationReason: "invalid_or_unauthorized_api_url",
    });

    // The Zhipu endpoint is pinned to the canonical host and path; the
    // generic custom-endpoint authorization does not loosen it.
    process.env.ZHIPU_CUSTOM_ENDPOINT_AUTHORIZED = "true";
    expect(configuredProviderRuntimes()).toHaveLength(0);
  });

  it("rejects the official host with a non-canonical Zhipu path", () => {
    process.env.ZHIPU_API_KEY = "test-zhipu-secret";
    process.env.ZHIPU_API_URL = "https://open.bigmodel.cn/api/paas/v3";
    process.env.ZHIPU_CUSTOM_ENDPOINT_AUTHORIZED = "true";

    expect(configuredProviderRuntimes()).toHaveLength(0);
  });

  it("reports the Zhipu configuration status without exposing the credential", () => {
    expect(providerConfigurationStatuses()).toEqual([
      expect.objectContaining({
        provider: "zhipu",
        label: "智谱",
        credentialEnvironmentNames: ["ZHIPU_API_KEY"],
        credentialConfigured: false,
        configuredCredentialCount: 0,
        active: false,
        activationReason: "missing_credentials",
        apiTier: "promotion",
        quotaScope: "account",
        publicMarketAllowed: false,
        modelAvailabilityEvidence: "operator_static_route",
      }),
    ]);

    process.env.ZHIPU_API_KEY = "test-zhipu-secret";
    const statuses = providerConfigurationStatuses();

    expect(statuses).toEqual([
      expect.objectContaining({
        provider: "zhipu",
        credentialConfigured: true,
        configuredCredentialCount: 1,
        active: true,
        activationReason: "ready",
        publicMarketAllowed: true,
        privateDataAllowed: false,
      }),
    ]);
    expect(JSON.stringify(statuses)).not.toContain("test-zhipu-secret");
  });
});
