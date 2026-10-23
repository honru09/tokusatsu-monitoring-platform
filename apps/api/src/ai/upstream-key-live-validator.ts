export const UPSTREAM_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "deepseek",
] as const;

export type UpstreamProvider = (typeof UPSTREAM_PROVIDER_IDS)[number];

export type UpstreamValidationStatus =
  | "OK"
  | "NOT_CONFIGURED"
  | "AUTH"
  | "CREDITS"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "NETWORK"
  | "INVALID_REQUEST"
  | "PROVIDER_ERROR"
  | "INVALID_RESPONSE"
  | "EMPTY_CATALOGUE"
  | "MODEL_NOT_FOUND";

export type UpstreamCatalogueResult = {
  models: string[];
  status: UpstreamValidationStatus;
  latencyMs: number;
};

export type UpstreamCompletionResult = {
  model: string;
  status: UpstreamValidationStatus;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
};

export type UpstreamCredentialResult = {
  variableName: "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "DEEPSEEK_API_KEY";
  catalogue: UpstreamCatalogueResult;
  completion?: UpstreamCompletionResult;
};

export type UpstreamLiveValidationReport = {
  results: UpstreamCredentialResult[];
};

export type UpstreamLiveValidationOptions = {
  providers?: readonly UpstreamProvider[];
  completion?: boolean;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  credentials?: Partial<Record<UpstreamProvider, string>>;
  fetch?: typeof globalThis.fetch;
};

type ProviderSpec = {
  id: UpstreamProvider;
  variableName: UpstreamCredentialResult["variableName"];
  catalogueUrl: string;
  completionUrl: string;
  headers(apiKey: string, json: boolean): Record<string, string>;
  completionBody(model: string, maxTokens: number): Record<string, unknown>;
  completionPayloadValid(payload: unknown): boolean;
  usage(payload: unknown): {
    inputTokens?: number;
    outputTokens?: number;
  };
};

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function finiteNonnegative(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function hasNonemptyObjectArray(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => recordOf(entry) !== undefined)
  );
}

function standardUsage(payload: unknown) {
  const usage = recordOf(recordOf(payload)?.usage);
  return {
    inputTokens: finiteNonnegative(usage?.input_tokens),
    outputTokens: finiteNonnegative(usage?.output_tokens),
  };
}

function chatCompletionUsage(payload: unknown) {
  const usage = recordOf(recordOf(payload)?.usage);
  return {
    inputTokens: finiteNonnegative(usage?.prompt_tokens),
    outputTokens: finiteNonnegative(usage?.completion_tokens),
  };
}

const PROVIDERS: Record<UpstreamProvider, ProviderSpec> = {
  openai: {
    id: "openai",
    variableName: "OPENAI_API_KEY",
    catalogueUrl: "https://api.openai.com/v1/models",
    completionUrl: "https://api.openai.com/v1/responses",
    headers: (apiKey, json) => ({
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(json ? { "content-type": "application/json" } : {}),
    }),
    completionBody: (model, maxTokens) => ({
      model,
      input: "Reply with OK.",
      max_output_tokens: maxTokens,
      store: false,
    }),
    completionPayloadValid: (payload) =>
      hasNonemptyObjectArray(recordOf(payload)?.output),
    usage: standardUsage,
  },
  anthropic: {
    id: "anthropic",
    variableName: "ANTHROPIC_API_KEY",
    catalogueUrl: "https://api.anthropic.com/v1/models?limit=1000",
    completionUrl: "https://api.anthropic.com/v1/messages",
    headers: (apiKey, json) => ({
      accept: "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
      ...(json ? { "content-type": "application/json" } : {}),
    }),
    completionBody: (model, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: "Reply with OK." }],
    }),
    completionPayloadValid: (payload) =>
      hasNonemptyObjectArray(recordOf(payload)?.content),
    usage: standardUsage,
  },
  deepseek: {
    id: "deepseek",
    variableName: "DEEPSEEK_API_KEY",
    catalogueUrl: "https://api.deepseek.com/models",
    completionUrl: "https://api.deepseek.com/chat/completions",
    headers: (apiKey, json) => ({
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(json ? { "content-type": "application/json" } : {}),
    }),
    completionBody: (model, maxTokens) => ({
      model,
      messages: [{ role: "user", content: "Reply with OK." }],
      max_tokens: maxTokens,
      stream: false,
    }),
    completionPayloadValid: (payload) =>
      hasNonemptyObjectArray(recordOf(payload)?.choices),
    usage: chatCompletionUsage,
  },
};

function elapsed(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function statusForHttp(status: number): UpstreamValidationStatus {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 402) return "CREDITS";
  if (status === 408) return "TIMEOUT";
  if (status === 429) return "RATE_LIMIT";
  if (status >= 400 && status < 500) return "INVALID_REQUEST";
  return "PROVIDER_ERROR";
}

function statusForException(error: unknown): UpstreamValidationStatus {
  const name =
    error && typeof error === "object" && "name" in error
      ? (error as { name?: unknown }).name
      : undefined;
  return name === "TimeoutError" || name === "AbortError"
    ? "TIMEOUT"
    : "NETWORK";
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || !Number.isFinite(value) || value <= 0)
    throw new Error("INVALID_REQUEST");
  return Math.min(value, maximum);
}

async function safeFetch(
  fetchImplementation: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  return fetchImplementation(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function safeModelIds(payload: unknown, blockedSecrets: readonly string[]) {
  const data = recordOf(payload)?.data;
  if (!Array.isArray(data)) return undefined;
  const normalizedSecrets = blockedSecrets
    .filter(Boolean)
    .map((secret) => secret.toLocaleLowerCase("en-US"));
  let malformed = false;
  const models: string[] = [];
  for (const entry of data) {
    const id = recordOf(entry)?.id;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      id.trim().length > 512 ||
      /[\u0000-\u001f\u007f-\u009f]/.test(id)
    ) {
      malformed = true;
      continue;
    }
    const normalized = id.trim();
    const normalizedForComparison = normalized.toLocaleLowerCase("en-US");
    if (
      normalizedSecrets.some(
        (secret) =>
          normalizedForComparison.includes(secret) ||
          secret.includes(normalizedForComparison),
      )
    )
      continue;
    models.push(normalized);
  }
  return { models: [...new Set(models)], malformed };
}

async function catalogueProbe(
  spec: ProviderSpec,
  apiKey: string,
  blockedSecrets: readonly string[],
  fetchImplementation: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<UpstreamCatalogueResult> {
  const startedAt = performance.now();
  try {
    const response = await safeFetch(
      fetchImplementation,
      spec.catalogueUrl,
      { headers: spec.headers(apiKey, false) },
      timeoutMs,
    );
    if (!response.ok)
      return {
        models: [],
        status: statusForHttp(response.status),
        latencyMs: elapsed(startedAt),
      };
    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      return {
        models: [],
        status: "INVALID_RESPONSE",
        latencyMs: elapsed(startedAt),
      };
    }
    const parsed = safeModelIds(payload, blockedSecrets);
    if (!parsed || parsed.malformed)
      return {
        models: [],
        status: "INVALID_RESPONSE",
        latencyMs: elapsed(startedAt),
      };
    const models = parsed.models;
    return {
      models,
      status: models.length ? "OK" : "EMPTY_CATALOGUE",
      latencyMs: elapsed(startedAt),
    };
  } catch (error) {
    return {
      models: [],
      status: statusForException(error),
      latencyMs: elapsed(startedAt),
    };
  }
}

async function completionProbe(
  spec: ProviderSpec,
  apiKey: string,
  model: string,
  fetchImplementation: typeof globalThis.fetch,
  timeoutMs: number,
  maxTokens: number,
): Promise<UpstreamCompletionResult> {
  const startedAt = performance.now();
  try {
    const response = await safeFetch(
      fetchImplementation,
      spec.completionUrl,
      {
        method: "POST",
        headers: spec.headers(apiKey, true),
        body: JSON.stringify(spec.completionBody(model, maxTokens)),
      },
      timeoutMs,
    );
    if (!response.ok)
      return {
        model,
        status: statusForHttp(response.status),
        latencyMs: elapsed(startedAt),
      };
    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      return {
        model,
        status: "INVALID_RESPONSE",
        latencyMs: elapsed(startedAt),
      };
    }
    if (!spec.completionPayloadValid(payload))
      return {
        model,
        status: "INVALID_RESPONSE",
        latencyMs: elapsed(startedAt),
      };
    return {
      model,
      status: "OK",
      latencyMs: elapsed(startedAt),
      ...spec.usage(payload),
    };
  } catch (error) {
    return {
      model,
      status: statusForException(error),
      latencyMs: elapsed(startedAt),
    };
  }
}

function selectedCredentials(options: UpstreamLiveValidationOptions) {
  if (
    options.credentials !== undefined &&
    (options.credentials === null || typeof options.credentials !== "object")
  )
    throw new Error("INVALID_REQUEST");
  return Object.fromEntries(
    UPSTREAM_PROVIDER_IDS.map((provider) => {
      const spec = PROVIDERS[provider];
      const configured =
        options.credentials !== undefined
          ? options.credentials[provider]
          : process.env[spec.variableName];
      if (configured !== undefined && typeof configured !== "string")
        throw new Error("INVALID_REQUEST");
      return [provider, configured?.trim() || undefined];
    }),
  ) as Record<UpstreamProvider, string | undefined>;
}

function exactModelForCompletion(
  options: UpstreamLiveValidationOptions,
  providers: readonly UpstreamProvider[],
  credentials: Record<UpstreamProvider, string | undefined>,
) {
  if (!options.completion) {
    if (options.model != null) throw new Error("INVALID_REQUEST");
    return undefined;
  }
  if (providers.length !== 1) throw new Error("INVALID_REQUEST");
  if (options.model !== undefined && typeof options.model !== "string")
    throw new Error("INVALID_REQUEST");
  const model = options.model?.trim();
  if (
    !model ||
    model.length > 512 ||
    /[\u0000-\u001f\u007f-\u009f]/.test(model)
  )
    throw new Error("INVALID_REQUEST");
  for (const apiKey of Object.values(credentials)) {
    if (apiKey && (model.includes(apiKey) || apiKey.includes(model)))
      throw new Error("INVALID_REQUEST");
  }
  return model;
}

export function isUpstreamProvider(value: string): value is UpstreamProvider {
  return (UPSTREAM_PROVIDER_IDS as readonly string[]).includes(value);
}

export async function validateUpstreamApiKeys(
  options: UpstreamLiveValidationOptions = {},
): Promise<UpstreamLiveValidationReport> {
  if (options === null || typeof options !== "object")
    throw new Error("INVALID_REQUEST");
  if (
    options.completion !== undefined &&
    typeof options.completion !== "boolean"
  )
    throw new Error("INVALID_REQUEST");
  if (options.model !== undefined && typeof options.model !== "string")
    throw new Error("INVALID_REQUEST");
  if (options.providers !== undefined && !Array.isArray(options.providers))
    throw new Error("INVALID_REQUEST");
  if (options.fetch !== undefined && typeof options.fetch !== "function")
    throw new Error("INVALID_REQUEST");
  const requestedProviders = options.providers ?? UPSTREAM_PROVIDER_IDS;
  const providers = [...new Set(requestedProviders)];
  if (providers.length !== requestedProviders.length)
    throw new Error("INVALID_REQUEST");
  if (
    !providers.length ||
    providers.some(
      (provider) =>
        typeof provider !== "string" || !isUpstreamProvider(provider),
    )
  )
    throw new Error("INVALID_REQUEST");
  const validatedProviders = providers as UpstreamProvider[];
  const credentials = selectedCredentials(options);
  const exactModel = exactModelForCompletion(
    options,
    validatedProviders,
    credentials,
  );
  const timeoutMs = Math.max(
    500,
    boundedPositiveInteger(options.timeoutMs, 10_000, 180_000),
  );
  const maxTokens = boundedPositiveInteger(options.maxTokens, 16, 128);
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  const results = await Promise.all(
    validatedProviders.map(
      async (provider): Promise<UpstreamCredentialResult> => {
        const spec = PROVIDERS[provider];
        const apiKey = credentials[provider];
        if (!apiKey)
          return {
            variableName: spec.variableName,
            catalogue: {
              models: [],
              status: "NOT_CONFIGURED",
              latencyMs: 0,
            },
          };
        const catalogue = await catalogueProbe(
          spec,
          apiKey,
          Object.values(credentials).filter(
            (credential): credential is string => Boolean(credential),
          ),
          fetchImplementation,
          timeoutMs,
        );
        if (!options.completion || catalogue.status !== "OK" || !exactModel)
          return { variableName: spec.variableName, catalogue };
        if (!catalogue.models.includes(exactModel))
          return {
            variableName: spec.variableName,
            catalogue,
            completion: {
              model: exactModel,
              status: "MODEL_NOT_FOUND",
              latencyMs: 0,
            },
          };
        return {
          variableName: spec.variableName,
          catalogue,
          completion: await completionProbe(
            spec,
            apiKey,
            exactModel,
            fetchImplementation,
            timeoutMs,
            maxTokens,
          ),
        };
      },
    ),
  );
  return { results };
}
