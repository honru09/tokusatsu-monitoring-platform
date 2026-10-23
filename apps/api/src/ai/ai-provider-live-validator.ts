import { AI_PROVIDER_IDS, type AiProvider } from "./ai-model-catalog.js";
import {
  configuredProviderRuntimes,
  diagnosticProviderRuntimes,
  providerConfigurationStatuses,
  providerCredentialEnvironmentName,
  type ProviderConfigurationStatus,
  type ProviderRuntime,
} from "./ai-provider-registry.js";
import {
  routeForProvider,
  routeUsesLiveCatalogue,
  type AiTask,
} from "./ai-router.js";

const PROBE_TASKS: readonly AiTask[] = [
  "bulk_filter",
  "translation",
  "classification",
  "image_analysis",
  "seller_analysis",
  "complex_analysis",
  "cross_validation",
  "market_analysis",
  "crawler_diagnosis",
  "logistics_analysis",
  "assistant_chat",
];

type ProbeErrorCode =
  | "AUTH"
  | "CREDITS"
  | "RATE_LIMIT"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  | "NETWORK"
  | "INVALID_PROVIDER_JSON"
  | "EMPTY_CATALOGUE"
  | "NO_CONFIGURED_MODEL"
  | "EMPTY_RESPONSE"
  | "INVALID_RESPONSE_JSON"
  | "SKIPPED_INACTIVE"
  | "CONFIGURATION_BLOCKED";

export type ProbeStageResult = {
  ok: boolean;
  httpStatus?: number;
  latencyMs: number;
  errorCode?: ProbeErrorCode;
  modelCount?: number;
  eligibleModels?: string[];
  modelSamples?: string[];
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
};

export type CredentialProbeResult = {
  credentialName: string;
  credentialId: string;
  catalogue: ProbeStageResult;
  completion?: ProbeStageResult;
  success: boolean;
};

export type ProviderProbeResult = {
  provider: AiProvider;
  label: string;
  configured: boolean;
  configuredCredentialCount: number;
  runtimeActive: boolean;
  activationReason: ProviderConfigurationStatus["activationReason"];
  credentials: CredentialProbeResult[];
  errorCode?: "SKIPPED_INACTIVE" | "CONFIGURATION_BLOCKED";
};

export type LiveValidationReport = {
  generatedAt: string;
  completionRequested: boolean;
  providers: ProviderProbeResult[];
  summary: {
    configuredProviders: number;
    configuredCredentials: number;
    testedCredentials: number;
    successfulCredentials: number;
    failedCredentials: number;
    skippedCredentials: number;
  };
};

export type LiveValidationOptions = {
  providers?: readonly AiProvider[];
  completion?: boolean;
  includeInactive?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
  modelOverrides?: Partial<Record<AiProvider, string>>;
  fetch?: typeof globalThis.fetch;
  runtimes?: readonly ProviderRuntime[];
  statuses?: readonly ProviderConfigurationStatus[];
};

function elapsed(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function finiteNonnegative(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function errorCodeForStatus(status: number): ProbeErrorCode {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 402) return "CREDITS";
  if (status === 429) return "RATE_LIMIT";
  if (status === 400 || status === 422) return "INVALID_REQUEST";
  if (status === 404) return "NOT_FOUND";
  if (status >= 500) return "PROVIDER_ERROR";
  return "INVALID_REQUEST";
}

function cleanJson(content: string) {
  return content
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

function responseContent(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const outputText = (payload as { output_text?: unknown }).output_text;
  if (typeof outputText === "string" && outputText.trim())
    return outputText.trim();
  const output = (payload as { output?: unknown }).output;
  if (Array.isArray(output)) {
    const text = output
      .flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const content = (entry as { content?: unknown }).content;
        if (!Array.isArray(content)) return [];
        return content.flatMap((part) => {
          if (!part || typeof part !== "object") return [];
          const value = (part as { text?: unknown }).text;
          return typeof value === "string" ? [value] : [];
        });
      })
      .join("")
      .trim();
    if (text) return text;
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return undefined;
  const first = choices[0];
  if (!first || typeof first !== "object") return undefined;
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") return undefined;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content.trim() : undefined;
}

function responseUsage(payload: unknown) {
  if (!payload || typeof payload !== "object") return {};
  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return {};
  const record = usage as Record<string, unknown>;
  return {
    inputTokens: finiteNonnegative(
      record.prompt_tokens ?? record.input_tokens ?? record.inputTokens,
    ),
    outputTokens: finiteNonnegative(
      record.completion_tokens ?? record.output_tokens ?? record.outputTokens,
    ),
  };
}

/**
 * A provider catalogue is untrusted input.  Keep model IDs bounded and reject
 * malformed records before they can be written to the validation report.  The
 * credential values are only used for an in-memory comparison so a misbehaving
 * proxy cannot reflect a bearer token back through a model ID.
 */
function safeCatalogueModels(
  payload: unknown,
  blockedSecrets: readonly string[],
) {
  if (!payload || typeof payload !== "object") return undefined;
  const entries = (payload as { data?: unknown }).data;
  if (!Array.isArray(entries)) return undefined;
  const normalizedSecrets = blockedSecrets
    .filter((secret) => secret.length >= 8)
    .map((secret) => secret.toLocaleLowerCase("en-US"));
  const models: string[] = [];
  let malformed = false;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      malformed = true;
      continue;
    }
    const value = (entry as { id?: unknown }).id;
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.trim().length > 512 ||
      /[\u0000-\u001f\u007f-\u009f]/.test(value)
    ) {
      malformed = true;
      continue;
    }
    const model = value.trim();
    const normalizedModel = model.toLocaleLowerCase("en-US");
    if (
      normalizedSecrets.some(
        (secret) =>
          normalizedModel.includes(secret) || secret.includes(normalizedModel),
      )
    ) {
      malformed = true;
      continue;
    }
    models.push(model);
  }
  return { models: [...new Set(models)], malformed };
}

function credentialSecrets(runtime: ProviderRuntime, credentialId: string) {
  return Object.entries(runtime.headers(false, undefined, credentialId))
    .filter(([name]) => /authorization|api[-_]?key|token/i.test(name))
    .flatMap(([, value]) => [
      value.replace(/^Bearer\s+/i, "").trim(),
      value.trim(),
    ])
    .filter((value) => value.length >= 8);
}

function runtimeCredentialSecrets(runtime: ProviderRuntime) {
  return runtime
    .credentialIds()
    .flatMap((credentialId) => credentialSecrets(runtime, credentialId));
}

function isJsonObject(content: string) {
  try {
    const parsed = JSON.parse(cleanJson(content)) as unknown;
    return Boolean(
      parsed && typeof parsed === "object" && !Array.isArray(parsed),
    );
  } catch {
    return false;
  }
}

function configuredCandidates(
  provider: AiProvider,
  liveModels: readonly string[] = [],
) {
  return [
    ...new Set([
      ...PROBE_TASKS.flatMap((task) => routeForProvider(task, provider)),
      ...PROBE_TASKS.flatMap((task) =>
        routeUsesLiveCatalogue(task, provider) ? liveModels : [],
      ),
    ]),
  ];
}

async function fetchWithTimeout(
  fetchImplementation: typeof globalThis.fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const signal = AbortSignal.timeout(timeoutMs);
  return fetchImplementation(input, { ...init, signal, redirect: "error" });
}

async function catalogueProbe(
  runtime: ProviderRuntime,
  credentialId: string,
  fetchImplementation: typeof globalThis.fetch,
  timeoutMs: number,
) {
  const startedAt = performance.now();
  if (runtime.staticModelIds?.length) {
    const models = [
      ...new Set(
        runtime.staticModelIds.map((model) =>
          runtime.normalizeCatalogueModelId(model),
        ),
      ),
    ];
    const available = new Set(models);
    const eligibleModels = configuredCandidates(runtime.id, models).filter(
      (model) => available.has(model),
    );
    return {
      result: {
        ok: eligibleModels.length > 0,
        latencyMs: elapsed(startedAt),
        modelCount: models.length,
        eligibleModels,
        ...(eligibleModels.length
          ? {}
          : { errorCode: "NO_CONFIGURED_MODEL" as const }),
      } satisfies ProbeStageResult,
      models,
    };
  }
  try {
    const response = await fetchWithTimeout(
      fetchImplementation,
      runtime.catalogueUrl,
      { headers: runtime.headers(false, undefined, credentialId) },
      timeoutMs,
    );
    if (!response.ok)
      return {
        result: {
          ok: false,
          httpStatus: response.status,
          latencyMs: elapsed(startedAt),
          errorCode: errorCodeForStatus(response.status),
        } satisfies ProbeStageResult,
        models: [] as string[],
      };
    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      return {
        result: {
          ok: false,
          httpStatus: response.status,
          latencyMs: elapsed(startedAt),
          errorCode: "INVALID_PROVIDER_JSON",
        } satisfies ProbeStageResult,
        models: [] as string[],
      };
    }
    const extracted = runtime.extractCatalogueModelIds(payload);
    const parsed = safeCatalogueModels(
      { data: extracted.map((id) => ({ id })) },
      runtimeCredentialSecrets(runtime),
    );
    if (!parsed || parsed.malformed)
      return {
        result: {
          ok: false,
          httpStatus: response.status,
          latencyMs: elapsed(startedAt),
          errorCode: "INVALID_PROVIDER_JSON",
        } satisfies ProbeStageResult,
        models: [] as string[],
      };
    const models = [
      ...new Set(
        parsed.models.map((model) => runtime.normalizeCatalogueModelId(model)),
      ),
    ];
    if (!models.length) {
      for (const model of runtime.catalogueFallbackModelIds ?? [])
        models.push(runtime.normalizeCatalogueModelId(model));
    }
    if (!models.length)
      return {
        result: {
          ok: false,
          httpStatus: response.status,
          latencyMs: elapsed(startedAt),
          errorCode: "EMPTY_CATALOGUE",
          modelCount: 0,
        } satisfies ProbeStageResult,
        models,
      };
    const available = new Set(models);
    const eligibleModels = configuredCandidates(runtime.id, models).filter(
      (model) => available.has(model),
    );
    return {
      result: {
        ok: true,
        httpStatus: response.status,
        latencyMs: elapsed(startedAt),
        modelCount: models.length,
        eligibleModels,
        modelSamples: eligibleModels.length ? undefined : models.slice(0, 10),
      } satisfies ProbeStageResult,
      models,
    };
  } catch (error) {
    const timeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      result: {
        ok: false,
        latencyMs: elapsed(startedAt),
        errorCode: timeout ? "TIMEOUT" : "NETWORK",
      } satisfies ProbeStageResult,
      models: [] as string[],
    };
  }
}

async function completionProbe(
  runtime: ProviderRuntime,
  credentialId: string,
  models: readonly string[],
  fetchImplementation: typeof globalThis.fetch,
  timeoutMs: number,
  maxTokens: number,
  modelOverride?: string,
) {
  const startedAt = performance.now();
  const available = new Set(models);
  const requestedModel = modelOverride?.trim();
  const unsafeRequestedModel =
    requestedModel &&
    runtimeCredentialSecrets(runtime).some(
      (secret) =>
        requestedModel.includes(secret) || secret.includes(requestedModel),
    );
  if (unsafeRequestedModel)
    return {
      ok: false,
      latencyMs: elapsed(startedAt),
      errorCode: "INVALID_REQUEST",
    } satisfies ProbeStageResult;
  const model = requestedModel
    ? available.has(requestedModel)
      ? requestedModel
      : undefined
    : configuredCandidates(runtime.id, models).find((candidate) =>
        available.has(candidate),
      );
  if (!model)
    return {
      ok: false,
      latencyMs: elapsed(startedAt),
      errorCode: "NO_CONFIGURED_MODEL",
      model: modelOverride,
    } satisfies ProbeStageResult;
  try {
    const body = runtime.normalizeRequestBody(
      runtime.wireApi === "responses"
        ? {
            model,
            instructions: "Return one JSON object only. Do not use Markdown.",
            input: [
              {
                type: "message",
                role: "user",
                content: [
                  { type: "input_text", text: 'Reply exactly {"ok":true}.' },
                ],
              },
            ],
            max_output_tokens: maxTokens,
            store: false,
            stream: false,
          }
        : {
            model,
            messages: [
              {
                role: "system",
                content: "Return one JSON object only. Do not use Markdown.",
              },
              { role: "user", content: 'Reply exactly {"ok":true}.' },
            ],
            max_tokens: maxTokens,
            temperature: 0,
          },
    );
    const response = await fetchWithTimeout(
      fetchImplementation,
      `${runtime.apiUrl}/${
        runtime.wireApi === "responses" ? "responses" : "chat/completions"
      }`,
      {
        method: "POST",
        headers: runtime.headers(true, "bulk_filter", credentialId),
        body: JSON.stringify(body),
      },
      timeoutMs,
    );
    if (!response.ok)
      return {
        ok: false,
        httpStatus: response.status,
        latencyMs: elapsed(startedAt),
        errorCode: errorCodeForStatus(response.status),
        model,
      } satisfies ProbeStageResult;
    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      return {
        ok: false,
        httpStatus: response.status,
        latencyMs: elapsed(startedAt),
        errorCode: "INVALID_PROVIDER_JSON",
        model,
      } satisfies ProbeStageResult;
    }
    const content = responseContent(payload);
    if (!content)
      return {
        ok: false,
        httpStatus: response.status,
        latencyMs: elapsed(startedAt),
        errorCode: "EMPTY_RESPONSE",
        model,
        ...responseUsage(payload),
      } satisfies ProbeStageResult;
    if (!isJsonObject(content))
      return {
        ok: false,
        httpStatus: response.status,
        latencyMs: elapsed(startedAt),
        errorCode: "INVALID_RESPONSE_JSON",
        model,
        ...responseUsage(payload),
      } satisfies ProbeStageResult;
    return {
      ok: true,
      httpStatus: response.status,
      latencyMs: elapsed(startedAt),
      model,
      ...responseUsage(payload),
    } satisfies ProbeStageResult;
  } catch (error) {
    const timeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      ok: false,
      latencyMs: elapsed(startedAt),
      errorCode: timeout ? "TIMEOUT" : "NETWORK",
      model,
    } satisfies ProbeStageResult;
  }
}

export async function validateAiProviderCredentials(
  options: LiveValidationOptions = {},
): Promise<LiveValidationReport> {
  const providers = [...new Set(options.providers ?? AI_PROVIDER_IDS)];
  const completionRequested = options.completion ?? false;
  const includeInactive = options.includeInactive ?? false;
  const timeoutMs = Math.max(
    500,
    Math.min(options.timeoutMs ?? 10_000, 180_000),
  );
  const maxTokens = Math.max(8, Math.min(options.maxTokens ?? 256, 512));
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const statuses = (options.statuses ?? providerConfigurationStatuses()).filter(
    (status) => providers.includes(status.provider),
  );
  const allowedProviders = statuses
    .filter((status) => includeInactive || status.active)
    .map((status) => status.provider);
  const runtimes =
    options.runtimes ??
    (includeInactive
      ? diagnosticProviderRuntimes(allowedProviders)
      : configuredProviderRuntimes(allowedProviders));
  const runtimeByProvider = new Map(
    runtimes.map((runtime) => [runtime.id, runtime]),
  );

  const providerResults: ProviderProbeResult[] = [];
  for (const status of statuses) {
    if (!status.credentialConfigured) {
      providerResults.push({
        provider: status.provider,
        label: status.label,
        configured: false,
        configuredCredentialCount: 0,
        runtimeActive: false,
        activationReason: status.activationReason,
        credentials: [],
      });
      continue;
    }
    if (!status.active && !includeInactive) {
      providerResults.push({
        provider: status.provider,
        label: status.label,
        configured: true,
        configuredCredentialCount: status.configuredCredentialCount,
        runtimeActive: false,
        activationReason: status.activationReason,
        credentials: [],
        errorCode: "SKIPPED_INACTIVE",
      });
      continue;
    }
    const runtime = runtimeByProvider.get(status.provider);
    if (!runtime) {
      providerResults.push({
        provider: status.provider,
        label: status.label,
        configured: true,
        configuredCredentialCount: status.configuredCredentialCount,
        runtimeActive: status.active,
        activationReason: status.activationReason,
        credentials: [],
        errorCode: "CONFIGURATION_BLOCKED",
      });
      continue;
    }
    const credentials: CredentialProbeResult[] = [];
    for (const credentialId of runtime.credentialIds()) {
      const catalogue = await catalogueProbe(
        runtime,
        credentialId,
        fetchImplementation,
        timeoutMs,
      );
      const completion = completionRequested
        ? catalogue.result.ok
          ? await completionProbe(
              runtime,
              credentialId,
              catalogue.models,
              fetchImplementation,
              timeoutMs,
              maxTokens,
              options.modelOverrides?.[runtime.id],
            )
          : {
              ok: false,
              latencyMs: 0,
              errorCode: catalogue.result.errorCode,
            }
        : undefined;
      credentials.push({
        credentialName: providerCredentialEnvironmentName(
          runtime.id,
          credentialId,
        ),
        credentialId,
        catalogue: catalogue.result,
        completion,
        success:
          catalogue.result.ok &&
          (!completionRequested || Boolean(completion?.ok)),
      });
    }
    providerResults.push({
      provider: status.provider,
      label: status.label,
      configured: true,
      configuredCredentialCount: status.configuredCredentialCount,
      runtimeActive: status.active,
      activationReason: status.activationReason,
      credentials,
    });
  }

  const configured = providerResults.filter((provider) => provider.configured);
  const credentialResults = providerResults.flatMap(
    (provider) => provider.credentials,
  );
  const configuredCredentials = configured.reduce(
    (total, provider) => total + provider.configuredCredentialCount,
    0,
  );
  return {
    generatedAt: new Date().toISOString(),
    completionRequested,
    providers: providerResults,
    summary: {
      configuredProviders: configured.length,
      configuredCredentials,
      testedCredentials: credentialResults.length,
      successfulCredentials: credentialResults.filter(
        (credential) => credential.success,
      ).length,
      failedCredentials: credentialResults.filter(
        (credential) => !credential.success,
      ).length,
      skippedCredentials: Math.max(
        0,
        configuredCredentials - credentialResults.length,
      ),
    },
  };
}
