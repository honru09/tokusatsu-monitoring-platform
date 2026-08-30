import {
  AI_PROVIDER_IDS,
  modelDefinition,
  type AiDataClass,
  type AiModelCostTier,
  type AiProvider,
} from "./ai-model-catalog.js";

export type ProviderApiTier = "free" | "promotion" | "paid" | "unknown";

export type ProviderRuntime = {
  id: AiProvider;
  label: string;
  apiKey: string;
  apiUrl: string;
  catalogueUrl: string;
  apiTier: ProviderApiTier;
  headers(json: boolean): Record<string, string>;
  extractCatalogueModelIds(payload: unknown): string[];
  normalizeCatalogueModelId(modelId: string): string;
  normalizeRequestBody(body: Record<string, unknown>): Record<string, unknown>;
  allowsDataClass(dataClass: AiDataClass): boolean;
  costTierFor(modelId: string): AiModelCostTier;
};

type ProviderSpec = {
  id: AiProvider;
  label: string;
  keyEnv: string;
  urlEnv: string;
  defaultUrl: string;
  tierEnv: string;
  defaultTier: ProviderApiTier;
  productionAuthorizationEnv?: string;
  evaluationAuthorizationEnv?: string;
  privateDataAuthorizationEnv: string;
  accountIdEnv?: string;
};

const PROVIDER_SPECS: Record<AiProvider, ProviderSpec> = {
  bai: {
    id: "bai",
    label: "B.AI",
    keyEnv: "BAI_API_KEY",
    urlEnv: "BAI_API_URL",
    defaultUrl: "https://api.b.ai/v1",
    tierEnv: "BAI_API_TIER",
    defaultTier: "promotion",
    privateDataAuthorizationEnv: "BAI_PRIVATE_DATA_AUTHORIZED",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    keyEnv: "OPENROUTER_API_KEY",
    urlEnv: "OPENROUTER_API_URL",
    defaultUrl: "https://openrouter.ai/api/v1",
    tierEnv: "OPENROUTER_API_TIER",
    defaultTier: "unknown",
    privateDataAuthorizationEnv: "OPENROUTER_PRIVATE_DATA_AUTHORIZED",
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    keyEnv: "GEMINI_API_KEY",
    urlEnv: "GEMINI_API_URL",
    defaultUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    tierEnv: "GEMINI_API_TIER",
    defaultTier: "unknown",
    privateDataAuthorizationEnv: "GEMINI_PRIVATE_DATA_AUTHORIZED",
  },
  groq: {
    id: "groq",
    label: "GroqCloud",
    keyEnv: "GROQ_API_KEY",
    urlEnv: "GROQ_API_URL",
    defaultUrl: "https://api.groq.com/openai/v1",
    tierEnv: "GROQ_API_TIER",
    defaultTier: "unknown",
    privateDataAuthorizationEnv: "GROQ_PRIVATE_DATA_AUTHORIZED",
  },
  siliconflow: {
    id: "siliconflow",
    label: "SiliconFlow CN",
    keyEnv: "SILICONFLOW_API_KEY",
    urlEnv: "SILICONFLOW_API_URL",
    defaultUrl: "https://api.siliconflow.cn/v1",
    tierEnv: "SILICONFLOW_API_TIER",
    defaultTier: "unknown",
    privateDataAuthorizationEnv: "SILICONFLOW_PRIVATE_DATA_AUTHORIZED",
  },
  cerebras: {
    id: "cerebras",
    label: "Cerebras Cloud",
    keyEnv: "CEREBRAS_API_KEY",
    urlEnv: "CEREBRAS_API_URL",
    defaultUrl: "https://api.cerebras.ai/v1",
    tierEnv: "CEREBRAS_API_TIER",
    defaultTier: "unknown",
    privateDataAuthorizationEnv: "CEREBRAS_PRIVATE_DATA_AUTHORIZED",
  },
  cloudflare: {
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    keyEnv: "CLOUDFLARE_AI_API_TOKEN",
    urlEnv: "CLOUDFLARE_AI_API_URL",
    defaultUrl:
      "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
    tierEnv: "CLOUDFLARE_AI_API_TIER",
    defaultTier: "unknown",
    privateDataAuthorizationEnv: "CLOUDFLARE_AI_PRIVATE_DATA_AUTHORIZED",
    accountIdEnv: "CLOUDFLARE_ACCOUNT_ID",
  },
  cohere: {
    id: "cohere",
    label: "Cohere",
    keyEnv: "COHERE_API_KEY",
    urlEnv: "COHERE_API_URL",
    defaultUrl: "https://api.cohere.ai/compatibility/v1",
    tierEnv: "COHERE_API_TIER",
    defaultTier: "unknown",
    productionAuthorizationEnv: "COHERE_PRODUCTION_AUTHORIZED",
    evaluationAuthorizationEnv: "COHERE_INTERNAL_EVALUATION",
    privateDataAuthorizationEnv: "COHERE_PRIVATE_DATA_AUTHORIZED",
  },
  nvidia: {
    id: "nvidia",
    label: "NVIDIA NIM",
    keyEnv: "NVIDIA_API_KEY",
    urlEnv: "NVIDIA_API_URL",
    defaultUrl: "https://integrate.api.nvidia.com/v1",
    tierEnv: "NVIDIA_API_TIER",
    defaultTier: "unknown",
    productionAuthorizationEnv: "NVIDIA_PRODUCTION_AUTHORIZED",
    evaluationAuthorizationEnv: "NVIDIA_INTERNAL_EVALUATION",
    privateDataAuthorizationEnv: "NVIDIA_PRIVATE_DATA_AUTHORIZED",
  },
};

function readApiTier(value: string | undefined, fallback: ProviderApiTier) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "free" ||
    normalized === "promotion" ||
    normalized === "paid" ||
    normalized === "unknown"
    ? normalized
    : fallback;
}

function configuredModelList(name: string) {
  return new Set(
    (process.env[name] ?? "")
      .split(/[|,]/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function headersFor(provider: AiProvider, apiKey: string, json: boolean) {
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  if (json) headers["content-type"] = "application/json";
  if (provider === "openrouter") {
    const siteUrl = process.env.OPENROUTER_SITE_URL?.trim();
    if (siteUrl) headers["HTTP-Referer"] = siteUrl;
    headers["X-Title"] =
      process.env.OPENROUTER_APP_NAME?.trim() || "Kamen Procurement";
  }
  if (provider === "cohere") headers["X-Client-Name"] = "Kamen Procurement";
  return headers;
}

function booleanEnvironment(name: string | undefined) {
  return Boolean(name && process.env[name]?.trim().toLowerCase() === "true");
}

function resolveApiUrl(spec: ProviderSpec) {
  const configured = process.env[spec.urlEnv]?.trim() || spec.defaultUrl;
  if (!spec.accountIdEnv) return configured.replace(/\/$/, "");
  const accountId = process.env[spec.accountIdEnv]?.trim();
  if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId)) return undefined;
  const resolved = configured.includes("{account_id}")
    ? configured.replaceAll("{account_id}", accountId)
    : configured;
  return resolved.replace(/\/$/, "");
}

function catalogueUrlFor(provider: AiProvider, apiUrl: string) {
  if (provider === "cloudflare") {
    return `${apiUrl.replace(/\/ai\/v1$/, "/ai")}/models/search?task=Text%20Generation&hide_experimental=true&per_page=100`;
  }
  if (provider === "cohere")
    return "https://api.cohere.ai/v1/models?endpoint=chat";
  return `${apiUrl}/models`;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function catalogueModelIds(provider: AiProvider, payload: unknown) {
  const record = recordOf(payload);
  const entries =
    provider === "cloudflare"
      ? record?.result
      : provider === "cohere"
        ? record?.models
        : record?.data;
  if (!Array.isArray(entries)) return [];
  const field =
    provider === "cloudflare" || provider === "cohere" ? "name" : "id";
  return entries.flatMap((entry) => {
    const model = recordOf(entry)?.[field];
    return typeof model === "string" && model.trim() ? [model.trim()] : [];
  });
}

function effectiveCostTier(
  provider: AiProvider,
  modelId: string,
  apiTier: ProviderApiTier,
): AiModelCostTier {
  const definition = modelDefinition(provider, modelId);
  const staticTier = definition?.costTier ?? "unknown";
  if (provider === "openrouter") return staticTier;
  if (provider === "siliconflow") {
    if (configuredModelList("SILICONFLOW_FREE_MODELS").has(modelId))
      return "free";
    return apiTier === "paid" ? "paid" : "unknown";
  }
  if (provider === "bai") {
    if (apiTier !== "promotion") return apiTier;
    const verifiedAt = Date.parse(definition?.pricingVerifiedAt ?? "");
    const configuredAge = Number(
      process.env.AI_PRICING_VERIFICATION_MAX_AGE_MS ?? 24 * 60 * 60_000,
    );
    const maximumAge = Math.max(
      60_000,
      Number.isFinite(configuredAge) ? configuredAge : 24 * 60 * 60_000,
    );
    return Number.isFinite(verifiedAt) && Date.now() - verifiedAt <= maximumAge
      ? "promotion"
      : "unknown";
  }
  if (provider === "gemini" || provider === "groq")
    return apiTier === "free" ? "free" : apiTier;
  if (provider === "cerebras" || provider === "cohere")
    return apiTier === "free" || apiTier === "promotion" || apiTier === "paid"
      ? apiTier
      : "unknown";
  if (provider === "cloudflare") {
    if (apiTier === "free") return "free";
    if (apiTier === "paid" && booleanEnvironment("CLOUDFLARE_AI_ALLOW_OVERAGE"))
      return "paid";
    return "unknown";
  }
  if (provider === "nvidia") {
    if (apiTier === "paid") return "paid";
    if (apiTier !== "promotion") return "unknown";
    const verifiedAt = Date.parse(process.env.NVIDIA_PRICING_VERIFIED_AT ?? "");
    const configuredAge = Number(
      process.env.AI_PRICING_VERIFICATION_MAX_AGE_MS ?? 24 * 60 * 60_000,
    );
    const maximumAge = Math.max(
      60_000,
      Number.isFinite(configuredAge) ? configuredAge : 24 * 60 * 60_000,
    );
    return Number.isFinite(verifiedAt) && Date.now() - verifiedAt <= maximumAge
      ? "promotion"
      : "unknown";
  }
  return staticTier;
}

function runtimeFor(spec: ProviderSpec): ProviderRuntime | undefined {
  const apiKey = process.env[spec.keyEnv]?.trim();
  if (!apiKey) return undefined;
  const productionAuthorized = spec.productionAuthorizationEnv
    ? booleanEnvironment(spec.productionAuthorizationEnv)
    : true;
  const productionRuntime =
    process.env.NODE_ENV?.trim().toLowerCase() === "production";
  const evaluationAuthorized =
    !productionRuntime && booleanEnvironment(spec.evaluationAuthorizationEnv);
  if (
    spec.productionAuthorizationEnv &&
    !productionAuthorized &&
    !evaluationAuthorized
  )
    return undefined;
  const apiTier = readApiTier(process.env[spec.tierEnv], spec.defaultTier);
  const apiUrl = resolveApiUrl(spec);
  if (!apiUrl) return undefined;
  return {
    id: spec.id,
    label: spec.label,
    apiKey,
    apiUrl,
    catalogueUrl: catalogueUrlFor(spec.id, apiUrl),
    apiTier,
    headers: (json) => headersFor(spec.id, apiKey, json),
    extractCatalogueModelIds: (payload) =>
      catalogueModelIds(spec.id, payload).map((modelId) =>
        spec.id === "gemini" ? modelId.replace(/^models\//, "") : modelId,
      ),
    normalizeCatalogueModelId: (modelId) =>
      spec.id === "gemini" ? modelId.replace(/^models\//, "") : modelId,
    normalizeRequestBody: (body) => {
      if (spec.id === "groq") return { ...body, temperature: 0 };
      if (spec.id === "cerebras" || spec.id === "cohere")
        return { ...body, response_format: { type: "json_object" } };
      return body;
    },
    allowsDataClass: (dataClass) => {
      if (dataClass === "public_market") return true;
      if (!booleanEnvironment(spec.privateDataAuthorizationEnv)) return false;
      if (spec.id === "gemini" && apiTier === "free") return false;
      if (spec.id === "nvidia" || spec.id === "cohere")
        return apiTier === "paid" && productionAuthorized;
      return true;
    },
    costTierFor: (modelId) => effectiveCostTier(spec.id, modelId, apiTier),
  };
}

export function configuredProviderRuntimes(
  order: readonly AiProvider[] = AI_PROVIDER_IDS,
) {
  return order.flatMap((provider) => {
    const runtime = runtimeFor(PROVIDER_SPECS[provider]);
    return runtime ? [runtime] : [];
  });
}

export function providerLabel(provider: AiProvider) {
  return PROVIDER_SPECS[provider].label;
}
