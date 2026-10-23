export const GEMINI_OPENAI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/";

export const GEMINI_PREFERRED_MODELS = [
  {
    label: "Gemma 4 26B",
    canonicalId: "gemma-4-26b-a4b-it",
    matches: (id: string) => /^gemma-4-26b(?:-|$)/i.test(id),
  },
  {
    label: "Gemma 4 31B",
    canonicalId: "gemma-4-31b-it",
    matches: (id: string) => /^gemma-4-31b(?:-|$)/i.test(id),
  },
  {
    label: "Gemini 3.1 Flash Lite",
    canonicalId: "gemini-3.1-flash-lite",
    matches: (id: string) => /^gemini-3\.1-flash-lite(?:-|$)/i.test(id),
  },
] as const;

type PreferredModelLabel = (typeof GEMINI_PREFERRED_MODELS)[number]["label"];

export type GeminiProbeFailure = {
  status?: number;
  code?: string;
  type?: string;
  message: string;
  quotaMetric?: string;
  retryDelay?: string;
};

export type GeminiCandidateProbe = {
  label: PreferredModelLabel;
  model?: string;
  available: boolean;
  ok: boolean;
  response?: string;
  failure?: GeminiProbeFailure;
};

export type GeminiProbeReport = {
  configured: boolean;
  baseUrl: string;
  catalogueOk: boolean;
  modelCount: number;
  preferred: Array<{
    label: PreferredModelLabel;
    available: boolean;
    model?: string;
  }>;
  candidates: GeminiCandidateProbe[];
  selectedModel?: string;
  response?: string;
  catalogueFailure?: GeminiProbeFailure;
};

type GeminiProbeOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
  maxRetries?: number;
  maxRetryDelayMs?: number;
};

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function normalizeGeminiModelId(modelId: string) {
  return modelId.trim().replace(/^models\//i, "");
}

export function preferredGeminiModels(modelIds: readonly string[]) {
  const normalized = [...new Set(modelIds.map(normalizeGeminiModelId))];
  return GEMINI_PREFERRED_MODELS.map((preference) => {
    const matches = normalized
      .filter(preference.matches)
      .sort((left, right) => {
        const score = (value: string) =>
          value === preference.canonicalId
            ? 0
            : /(?:preview|image|experimental|exp)/i.test(value)
              ? 2
              : 1;
        return score(left) - score(right) || left.localeCompare(right);
      });
    return {
      label: preference.label,
      available: matches.length > 0,
      ...(matches[0] ? { model: matches[0] } : {}),
    };
  });
}

function normalizeBaseUrl(value?: string) {
  const parsed = new URL(value?.trim() || GEMINI_OPENAI_BASE_URL);
  if (
    parsed.protocol !== "https:" ||
    parsed.host.toLowerCase() !== "generativelanguage.googleapis.com" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error("GEMINI_API_URL must use the official Google HTTPS host");
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}/`;
}

function retryDelayFromHeaders(headers: Headers) {
  const value = headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? Math.max(0, timestamp - Date.now())
    : undefined;
}

function retryDelayMs(attempt: number, random: () => number) {
  const base = 2_000 * 2 ** Math.max(0, Math.min(attempt, 3));
  const sample = Math.max(0, Math.min(1, random()));
  return Math.round(base * (0.8 + sample * 0.4));
}

function isRetryableStatus(status: number) {
  return status === 429 || [500, 502, 503, 504].includes(status);
}

async function requestWithRetry(
  url: string,
  init: RequestInit,
  options: Required<
    Pick<
      GeminiProbeOptions,
      | "fetch"
      | "sleep"
      | "random"
      | "timeoutMs"
      | "maxRetries"
      | "maxRetryDelayMs"
    >
  >,
) {
  let lastError: unknown;
  for (let retry = 0; retry <= options.maxRetries; retry += 1) {
    try {
      const response = await options.fetch(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!isRetryableStatus(response.status) || retry >= options.maxRetries)
        return response;
      const requestedDelay = retryDelayFromHeaders(response.headers);
      const delay = requestedDelay ?? retryDelayMs(retry, options.random);
      if (delay > options.maxRetryDelayMs) return response;
      await response.body?.cancel().catch(() => undefined);
      await options.sleep(delay);
    } catch (error) {
      lastError = error;
      if (retry >= options.maxRetries) throw error;
      await options.sleep(retryDelayMs(retry, options.random));
    }
  }
  throw lastError ?? new Error("Gemini request failed");
}

function stringsFromUnknown(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsFromUnknown);
  const record = recordOf(value);
  return record ? Object.values(record).flatMap(stringsFromUnknown) : [];
}

export async function geminiFailure(
  response: Response,
): Promise<GeminiProbeFailure> {
  let payload: unknown;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    return {
      status: response.status,
      message: response.statusText || "Gemini returned a non-JSON error",
      retryDelay: response.headers.get("retry-after") ?? undefined,
    };
  }
  const error = recordOf(recordOf(payload)?.error);
  const strings = stringsFromUnknown(error?.details);
  return {
    status: response.status,
    code:
      typeof error?.code === "string" || typeof error?.code === "number"
        ? String(error.code)
        : undefined,
    type: typeof error?.status === "string" ? error.status : undefined,
    message:
      typeof error?.message === "string"
        ? error.message
        : "Gemini request failed",
    quotaMetric: strings.find((value) => /quota|request|token/i.test(value)),
    retryDelay:
      strings.find((value) => /^\d+(?:\.\d+)?s$/i.test(value)) ??
      response.headers.get("retry-after") ??
      undefined,
  };
}

function catalogueModelIds(payload: unknown) {
  const data = recordOf(payload)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry) => {
    const id = recordOf(entry)?.id;
    return typeof id === "string" && id.trim() ? [id] : [];
  });
}

function completionContent(payload: unknown) {
  const choices = recordOf(payload)?.choices;
  if (!Array.isArray(choices)) return undefined;
  const content = recordOf(recordOf(choices[0])?.message)?.content;
  return typeof content === "string" ? content.trim() : undefined;
}

export async function runGeminiProbe(
  options: GeminiProbeOptions = {},
): Promise<GeminiProbeReport> {
  const apiKey = options.apiKey?.trim();
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (!apiKey)
    return {
      configured: false,
      baseUrl,
      catalogueOk: false,
      modelCount: 0,
      preferred: preferredGeminiModels([]),
      candidates: [],
    };
  const requestOptions = {
    fetch: options.fetch ?? globalThis.fetch,
    sleep:
      options.sleep ??
      ((milliseconds: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds))),
    random: options.random ?? Math.random,
    timeoutMs: Math.max(1_000, Math.min(options.timeoutMs ?? 60_000, 180_000)),
    maxRetries: Math.max(0, Math.min(options.maxRetries ?? 4, 4)),
    maxRetryDelayMs: Math.max(
      2_000,
      Math.min(options.maxRetryDelayMs ?? 60_000, 5 * 60_000),
    ),
  };
  const headers = { authorization: `Bearer ${apiKey}` };
  let catalogueResponse: Response;
  try {
    catalogueResponse = await requestWithRetry(
      `${baseUrl}models`,
      { headers },
      requestOptions,
    );
  } catch (error) {
    return {
      configured: true,
      baseUrl,
      catalogueOk: false,
      modelCount: 0,
      preferred: preferredGeminiModels([]),
      candidates: [],
      catalogueFailure: {
        message: error instanceof Error ? error.message : "Network failure",
      },
    };
  }
  if (!catalogueResponse.ok)
    return {
      configured: true,
      baseUrl,
      catalogueOk: false,
      modelCount: 0,
      preferred: preferredGeminiModels([]),
      candidates: [],
      catalogueFailure: await geminiFailure(catalogueResponse),
    };
  let cataloguePayload: unknown;
  try {
    cataloguePayload = (await catalogueResponse.json()) as unknown;
  } catch {
    return {
      configured: true,
      baseUrl,
      catalogueOk: false,
      modelCount: 0,
      preferred: preferredGeminiModels([]),
      candidates: [],
      catalogueFailure: {
        message: "Gemini returned an invalid model catalogue",
      },
    };
  }
  const modelIds = catalogueModelIds(cataloguePayload);
  const preferred = preferredGeminiModels(modelIds);
  const candidates: GeminiCandidateProbe[] = [];
  for (const candidate of preferred) {
    if (!candidate.model) {
      candidates.push({ ...candidate, ok: false });
      continue;
    }
    let response: Response;
    try {
      response = await requestWithRetry(
        `${baseUrl}chat/completions`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            model: candidate.model,
            messages: [
              { role: "user", content: "Reply exactly with: MODEL_OK" },
            ],
          }),
        },
        requestOptions,
      );
    } catch (error) {
      candidates.push({
        ...candidate,
        ok: false,
        failure: {
          message: error instanceof Error ? error.message : "Network failure",
        },
      });
      continue;
    }
    if (!response.ok) {
      candidates.push({
        ...candidate,
        ok: false,
        failure: await geminiFailure(response),
      });
      continue;
    }
    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      candidates.push({
        ...candidate,
        ok: false,
        failure: { status: response.status, message: "Invalid JSON response" },
      });
      continue;
    }
    const content = completionContent(payload);
    const ok = content === "MODEL_OK";
    candidates.push({
      ...candidate,
      ok,
      response: content,
      ...(ok
        ? {}
        : {
            failure: {
              status: response.status,
              message: "Response did not equal MODEL_OK",
            },
          }),
    });
    if (ok)
      return {
        configured: true,
        baseUrl,
        catalogueOk: true,
        modelCount: modelIds.length,
        preferred,
        candidates,
        selectedModel: candidate.model,
        response: content,
      };
  }
  return {
    configured: true,
    baseUrl,
    catalogueOk: true,
    modelCount: modelIds.length,
    preferred,
    candidates,
  };
}
