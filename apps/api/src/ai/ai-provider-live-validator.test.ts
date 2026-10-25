import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProviderConfigurationStatus,
  ProviderRuntime,
} from "./ai-provider-registry.js";
import { validateAiProviderCredentials } from "./ai-provider-live-validator.js";
import { ZHIPU_MODEL } from "./ai-config.js";

function runtime(): ProviderRuntime {
  return {
    id: "sensenova",
    label: "SenseNova",
    apiUrl: "https://provider.test/v1",
    catalogueUrl: "https://provider.test/v1/models",
    apiTier: "unknown",
    quotaScope: "account",
    credentialIds: () => ["main", "translation", "secondary"],
    headers: (_json, _task, credentialId) => ({
      authorization: `Bearer secret-${credentialId}`,
    }),
    extractCatalogueModelIds: (payload) =>
      (payload as { data: Array<{ id: string }> }).data.map(
        (entry) => entry.id,
      ),
    normalizeCatalogueModelId: (model) => model,
    normalizeRequestBody: (body) => body,
    allowsDataClass: () => true,
    costTierFor: () => "unknown",
  };
}

function status(): ProviderConfigurationStatus {
  return {
    provider: "sensenova",
    label: "SenseNova",
    credentialEnvironmentNames: [
      "SENSENOVA_API_KEY",
      "SENSENOVA_TRANSLATION_API_KEY",
      "SENSENOVA_SECONDARY_API_KEY",
    ],
    credentialConfigured: true,
    configuredCredentialCount: 3,
    active: true,
    activationReason: "ready",
    apiTier: "unknown",
    quotaScope: "account",
    publicMarketAllowed: true,
    privateDataAllowed: false,
    sensitiveImagesAllowed: false,
    modelAvailabilityEvidence: "live_catalogue",
  };
}

function zhipuRuntime(): ProviderRuntime {
  return {
    id: "zhipu",
    label: "智谱",
    apiUrl: "https://open.bigmodel.cn/api/paas/v4",
    catalogueUrl: "https://open.bigmodel.cn/api/paas/v4/models",
    apiTier: "promotion",
    quotaScope: "account",
    staticModelIds: [ZHIPU_MODEL],
    credentialIds: () => ["default"],
    headers: () => ({
      accept: "application/json",
      authorization: "Bearer secret-zhipu",
      "content-type": "application/json",
    }),
    extractCatalogueModelIds: (payload) =>
      (payload as { data: Array<{ id: string }> }).data.map(
        (entry) => entry.id,
      ),
    normalizeCatalogueModelId: (model) => model,
    // Mirrors the registry's Zhipu request shaping.
    normalizeRequestBody: (body) => ({
      ...body,
      model: ZHIPU_MODEL,
      stream: false,
      response_format: { type: "json_object" },
      thinking: { type: "enabled" },
      reasoning_effort: "low",
    }),
    allowsDataClass: () => true,
    costTierFor: () => "promotion",
  };
}

function zhipuStatus(): ProviderConfigurationStatus {
  return {
    provider: "zhipu",
    label: "智谱",
    credentialEnvironmentNames: ["ZHIPU_API_KEY"],
    credentialConfigured: true,
    configuredCredentialCount: 1,
    active: true,
    activationReason: "ready",
    apiTier: "promotion",
    quotaScope: "account",
    publicMarketAllowed: true,
    privateDataAllowed: false,
    sensitiveImagesAllowed: false,
    modelAvailabilityEvidence: "operator_static_route",
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AI provider live validator", () => {
  it("probes the static Zhipu route model with a completion", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        // The Zhipu catalogue comes from the static route, so the only
        // network call is the completion probe itself.
        expect(String(input)).toBe(
          "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        );
        expect(init?.method).toBe("POST");
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer secret-zhipu");
        expect(headers.get("content-type")).toBe("application/json");
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          model: ZHIPU_MODEL,
          max_tokens: 256,
          temperature: 0,
          stream: false,
          response_format: { type: "json_object" },
        });
        expect(body.messages).toEqual([
          {
            role: "system",
            content: "Return one JSON object only. Do not use Markdown.",
          },
          {
            role: "user",
            content: 'Reply exactly {"ok":true}.',
          },
        ]);
        expect(body).not.toHaveProperty("input");
        expect(body).not.toHaveProperty("instructions");
        expect(body).not.toHaveProperty("max_output_tokens");
        return Response.json({
          model: ZHIPU_MODEL,
          choices: [
            {
              message: { role: "assistant", content: '{"ok":true}' },
            },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 3 },
        });
      },
    );

    const report = await validateAiProviderCredentials({
      providers: ["zhipu"],
      completion: true,
      fetch: fetchMock,
      runtimes: [zhipuRuntime()],
      statuses: [zhipuStatus()],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(report.providers[0]?.credentials[0]).toMatchObject({
      catalogue: {
        ok: true,
        modelCount: 1,
        eligibleModels: [ZHIPU_MODEL],
      },
      completion: {
        ok: true,
        model: ZHIPU_MODEL,
        inputTokens: 8,
        outputTokens: 3,
      },
      success: true,
    });
    expect(JSON.stringify(report)).not.toContain("secret-zhipu");
  });

  it("probes the configured Zhipu credential without serializing its secret", async () => {
    const observedAuthorizations: string[] = [];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.redirect).toBe("error");
        observedAuthorizations.push(
          String(new Headers(init?.headers).get("authorization")),
        );
        return Response.json({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 9, completion_tokens: 5 },
        });
      },
    );

    const report = await validateAiProviderCredentials({
      providers: ["zhipu"],
      completion: true,
      fetch: fetchMock,
      runtimes: [zhipuRuntime()],
      statuses: [zhipuStatus()],
    });

    expect(report.summary).toEqual({
      configuredProviders: 1,
      configuredCredentials: 1,
      testedCredentials: 1,
      successfulCredentials: 1,
      failedCredentials: 0,
      skippedCredentials: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(observedAuthorizations).toEqual(["Bearer secret-zhipu"]);
    expect(
      report.providers[0]?.credentials.map(
        ({ credentialId, credentialName }) => ({
          credentialId,
          credentialName,
        }),
      ),
    ).toEqual([{ credentialId: "default", credentialName: "ZHIPU_API_KEY" }]);
    expect(JSON.stringify(report)).not.toContain("secret-zhipu");
  });

  it("never falls back to another model when an exact model was requested", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ data: [{ id: "sensenova-6.8-flash-lite" }] }),
    );

    const report = await validateAiProviderCredentials({
      providers: ["sensenova"],
      completion: true,
      modelOverrides: { sensenova: "missing-exact-model" },
      fetch: fetchMock,
      runtimes: [runtime()],
      statuses: [status()],
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(report.providers[0]?.credentials[0]?.completion).toMatchObject({
      ok: false,
      errorCode: "NO_CONFIGURED_MODEL",
      model: "missing-exact-model",
    });
    expect(report.summary.failedCredentials).toBe(3);
  });

  it("classifies provider errors without retaining a response body", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { message: "invalid secret-main" } },
        { status: 401 },
      ),
    );

    const report = await validateAiProviderCredentials({
      providers: ["sensenova"],
      completion: true,
      fetch: fetchMock,
      runtimes: [runtime()],
      statuses: [status()],
    });

    expect(report.providers[0]?.credentials[0]?.catalogue).toMatchObject({
      ok: false,
      httpStatus: 401,
      errorCode: "AUTH",
    });
    expect(JSON.stringify(report)).not.toContain("invalid secret-main");
  });

  it("rejects a catalogue that tries to reflect a credential value", async () => {
    const reflected = "secret-main";
    const fetchMock = vi.fn(async () =>
      Response.json({ data: [{ id: reflected }] }),
    );

    const report = await validateAiProviderCredentials({
      providers: ["sensenova"],
      fetch: fetchMock,
      runtimes: [runtime()],
      statuses: [status()],
    });

    expect(report.providers[0]?.credentials[0]?.catalogue).toMatchObject({
      ok: false,
      errorCode: "INVALID_PROVIDER_JSON",
    });
    expect(JSON.stringify(report)).not.toContain(reflected);
  });

  it("does not serialize a secret supplied as the exact model override", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ data: [{ id: "sensenova-6.8-flash-lite" }] }),
    );

    const report = await validateAiProviderCredentials({
      providers: ["sensenova"],
      completion: true,
      modelOverrides: { sensenova: "secret-main" },
      fetch: fetchMock,
      runtimes: [runtime()],
      statuses: [status()],
    });

    expect(report.providers[0]?.credentials[0]?.completion).toMatchObject({
      ok: false,
      errorCode: "INVALID_REQUEST",
    });
    expect(JSON.stringify(report)).not.toContain("secret-main");
  });
});
