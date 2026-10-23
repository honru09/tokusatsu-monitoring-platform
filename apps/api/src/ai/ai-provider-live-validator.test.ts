import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProviderConfigurationStatus,
  ProviderRuntime,
} from "./ai-provider-registry.js";
import { validateAiProviderCredentials } from "./ai-provider-live-validator.js";

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

function ovoRuntime(): ProviderRuntime {
  return {
    id: "ovo",
    label: "OVO GPT 特惠组",
    apiUrl: "https://ovo1.cn/v1",
    catalogueUrl: "https://ovo1.cn/v1/models",
    apiTier: "paid",
    quotaScope: "account",
    wireApi: "chat_completions",
    credentialIds: () => ["default"],
    headers: () => ({
      accept: "application/json",
      authorization: "Bearer secret-ovo",
      "content-type": "application/json",
    }),
    extractCatalogueModelIds: (payload) =>
      (payload as { data: Array<{ id: string }> }).data.map(
        (entry) => entry.id,
      ),
    normalizeCatalogueModelId: (model) => model,
    normalizeRequestBody: (body) => body,
    allowsDataClass: (dataClass) => dataClass === "public_market",
    costTierFor: () => "paid",
  };
}

function ovoStatus(): ProviderConfigurationStatus {
  return {
    provider: "ovo",
    label: "OVO GPT 特惠组",
    credentialEnvironmentNames: ["OVO_API_KEY"],
    credentialConfigured: true,
    configuredCredentialCount: 1,
    active: true,
    activationReason: "ready",
    apiTier: "paid",
    quotaScope: "account",
    publicMarketAllowed: true,
    privateDataAllowed: false,
    sensitiveImagesAllowed: false,
    modelAvailabilityEvidence: "live_catalogue",
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AI provider live validator", () => {
  it("discovers and probes whichever model the OVO account catalogue exposes", async () => {
    vi.stubEnv("AI_ROUTE_OVO_ASSISTANT_CHAT", "*");
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/models"))
          return Response.json({ data: [{ id: "ovo-account-model" }] });
        expect(String(input)).toBe("https://ovo1.cn/v1/chat/completions");
        expect(init?.method).toBe("POST");
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer secret-ovo");
        expect(headers.get("content-type")).toBe("application/json");
        expect(headers.get("originator")).toBeNull();
        expect(headers.get("version")).toBeNull();
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          model: "ovo-account-model",
          max_tokens: 256,
          temperature: 0,
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
        expect(body).not.toHaveProperty("reasoning");
        expect(body).not.toHaveProperty("max_output_tokens");
        return Response.json({
          model: "ovo-account-model",
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
      providers: ["ovo"],
      completion: true,
      fetch: fetchMock,
      runtimes: [ovoRuntime()],
      statuses: [ovoStatus()],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(report.providers[0]?.credentials[0]).toMatchObject({
      catalogue: {
        ok: true,
        modelCount: 1,
        eligibleModels: ["ovo-account-model"],
      },
      completion: {
        ok: true,
        model: "ovo-account-model",
        inputTokens: 8,
        outputTokens: 3,
      },
      success: true,
    });
    expect(JSON.stringify(report)).not.toContain("secret-ovo");
  });

  it("probes every configured credential without serializing its secret", async () => {
    const observedAuthorizations: string[] = [];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.redirect).toBe("error");
        const authorization = String(
          new Headers(init?.headers).get("authorization"),
        );
        observedAuthorizations.push(authorization);
        if (!init?.method)
          return Response.json({ data: [{ id: "sensenova-6.8-flash-lite" }] });
        expect(authorization).toMatch(
          /^Bearer secret-(?:main|translation|secondary)$/,
        );
        return Response.json({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 9, completion_tokens: 5 },
        });
      },
    );

    const report = await validateAiProviderCredentials({
      providers: ["sensenova"],
      completion: true,
      fetch: fetchMock,
      runtimes: [runtime()],
      statuses: [status()],
    });

    expect(report.summary).toEqual({
      configuredProviders: 1,
      configuredCredentials: 3,
      testedCredentials: 3,
      successfulCredentials: 3,
      failedCredentials: 0,
      skippedCredentials: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(observedAuthorizations).toEqual([
      "Bearer secret-main",
      "Bearer secret-main",
      "Bearer secret-translation",
      "Bearer secret-translation",
      "Bearer secret-secondary",
      "Bearer secret-secondary",
    ]);
    expect(
      report.providers[0]?.credentials.map(
        ({ credentialId, credentialName }) => ({
          credentialId,
          credentialName,
        }),
      ),
    ).toEqual([
      { credentialId: "main", credentialName: "SENSENOVA_API_KEY" },
      {
        credentialId: "translation",
        credentialName: "SENSENOVA_TRANSLATION_API_KEY",
      },
      {
        credentialId: "secondary",
        credentialName: "SENSENOVA_SECONDARY_API_KEY",
      },
    ]);
    expect(JSON.stringify(report)).not.toContain("secret-main");
    expect(JSON.stringify(report)).not.toContain("secret-translation");
    expect(JSON.stringify(report)).not.toContain("secret-secondary");
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
