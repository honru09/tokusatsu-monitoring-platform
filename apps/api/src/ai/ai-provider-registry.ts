import {
  AI_PROVIDER_IDS,
  ZHIPU_MODEL,
  modelDefinition,
  type AiDataClass,
  type AiModelCostTier,
  type AiProvider,
} from "./ai-model-catalog.js";
import type { AiTask } from "./ai-router.js";

export type ProviderApiTier = "free" | "promotion" | "paid" | "unknown";

/**
 * The smallest safe scope at which a provider documents rate/quota state.
 *
 * This is deliberately separate from the credential alias.  A provider may
 * expose several keys while still sharing one account, project, or
 * organization bucket.  Unknown is fail-closed: a 429 must not be used as a
 * reason to try another key from the same runtime.
 */
export type ProviderQuotaScope =
  | "credential"
  | "account"
  | "project"
  | "organization"
  | "model"
  | "unknown";

export type ProviderWireApi = "chat_completions" | "responses";

export type ProviderRuntime = {
  id: AiProvider;
  label: string;
  apiUrl: string;
  catalogueUrl: string;
  apiTier: ProviderApiTier;
  quotaScope: ProviderQuotaScope;
  wireApi?: ProviderWireApi;
  staticModelIds?: readonly string[];
  catalogueFallbackModelIds?: readonly string[];
  credentialQuotaGroup?(credentialId: string): string;
  credentialIds(task?: AiTask): string[];
  headers(
    json: boolean,
    task?: AiTask,
    credentialId?: string,
  ): Record<string, string>;
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
  quotaScope: ProviderQuotaScope;
  officialHosts: readonly string[];
  customEndpointAuthorizationEnv: string;
  productionAuthorizationEnv?: string;
  evaluationAuthorizationEnv?: string;
  privateDataAuthorizationEnv: string;
  accountIdEnv?: string;
  translationKeyEnv?: string;
  secondaryKeyEnv?: string;
  wireApi?: ProviderWireApi;
  staticModelIds?: readonly string[];
  catalogueFallbackModelIds?: readonly string[];
};

export type ProviderConfigurationStatus = {
  provider: AiProvider;
  label: string;
  credentialEnvironmentNames: string[];
  credentialConfigured: boolean;
  configuredCredentialCount: number;
  active: boolean;
  activationReason:
    | "ready"
    | "missing_credentials"
    | "invalid_or_missing_account_id"
    | "invalid_or_unauthorized_api_url"
    | "production_authorization_required"
    | "evaluation_authorization_required";
  apiTier: ProviderApiTier;
  quotaScope: ProviderQuotaScope;
  publicMarketAllowed: boolean;
  privateDataAllowed: boolean;
  sensitiveImagesAllowed: boolean;
  modelAvailabilityEvidence: "live_catalogue" | "operator_static_route";
};

const PROVIDER_SPECS: Record<AiProvider, ProviderSpec> = {
  zhipu: {
    id: "zhipu", label: "智谱", keyEnv: "ZHIPU_API_KEY", urlEnv: "ZHIPU_API_URL",
    defaultUrl: "https://open.bigmodel.cn/api/paas/v4", tierEnv: "ZHIPU_API_TIER",
    defaultTier: "promotion", quotaScope: "account", officialHosts: ["open.bigmodel.cn"],
    customEndpointAuthorizationEnv: "ZHIPU_CUSTOM_ENDPOINT_AUTHORIZED",
    privateDataAuthorizationEnv: "ZHIPU_PRIVATE_DATA_AUTHORIZED",
    staticModelIds: [ZHIPU_MODEL],
  },
  litellm: {
    id: "litellm",
    label: "LiteLLM Gateway",
    keyEnv: "LITELLM_API_KEY",
    urlEnv: "LITELLM_API_URL",
    defaultUrl: "http://litellm:4000/v1",
    tierEnv: "LITELLM_API_TIER",
    defaultTier: "unknown",
    quotaScope: "credential",
    officialHosts: ["litellm:4000"],
    customEndpointAuthorizationEnv: "LITELLM_CUSTOM_ENDPOINT_AUTHORIZED",
    privateDataAuthorizationEnv: "LITELLM_PRIVATE_DATA_AUTHORIZED",
  },
  bai: {
    id: "bai",
    label: "B.AI",
    keyEnv: "BAI_API_KEY",
    urlEnv: "BAI_API_URL",
    defaultUrl: "https://api.b.ai/v1",
    tierEnv: "BAI_API_TIER",
    // Promotions are account/model-specific and time-limited.  Never infer a
    // promotion merely because a B.AI key exists; the live promotion page and
    // an explicit model list must establish it.
    defaultTier: "unknown",
    quotaScope: "account",
    officialHosts: ["api.b.ai"],
    customEndpointAuthorizationEnv: "BAI_CUSTOM_ENDPOINT_AUTHORIZED",
    productionAuthorizationEnv: "BAI_PRODUCTION_AUTHORIZED",
    evaluationAuthorizationEnv: "BAI_INTERNAL_EVALUATION",
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
    quotaScope: "account",
    officialHosts: ["openrouter.ai"],
    customEndpointAuthorizationEnv: "OPENROUTER_CUSTOM_ENDPOINT_AUTHORIZED",
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
    quotaScope: "project",
    officialHosts: ["generativelanguage.googleapis.com"],
    customEndpointAuthorizationEnv: "GEMINI_CUSTOM_ENDPOINT_AUTHORIZED",
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
    quotaScope: "organization",
    officialHosts: ["api.groq.com"],
    customEndpointAuthorizationEnv: "GROQ_CUSTOM_ENDPOINT_AUTHORIZED",
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
    quotaScope: "account",
    officialHosts: ["api.siliconflow.cn", "api.siliconflow.com"],
    customEndpointAuthorizationEnv: "SILICONFLOW_CUSTOM_ENDPOINT_AUTHORIZED",
    productionAuthorizationEnv: "SILICONFLOW_PRODUCTION_AUTHORIZED",
    evaluationAuthorizationEnv: "SILICONFLOW_INTERNAL_EVALUATION",
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
    quotaScope: "organization",
    officialHosts: ["api.cerebras.ai"],
    customEndpointAuthorizationEnv: "CEREBRAS_CUSTOM_ENDPOINT_AUTHORIZED",
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
    quotaScope: "account",
    officialHosts: ["api.cloudflare.com"],
    customEndpointAuthorizationEnv: "CLOUDFLARE_AI_CUSTOM_ENDPOINT_AUTHORIZED",
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
    quotaScope: "account",
    officialHosts: ["api.cohere.ai"],
    customEndpointAuthorizationEnv: "COHERE_CUSTOM_ENDPOINT_AUTHORIZED",
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
    quotaScope: "account",
    officialHosts: ["integrate.api.nvidia.com"],
    customEndpointAuthorizationEnv: "NVIDIA_CUSTOM_ENDPOINT_AUTHORIZED",
    productionAuthorizationEnv: "NVIDIA_PRODUCTION_AUTHORIZED",
    evaluationAuthorizationEnv: "NVIDIA_INTERNAL_EVALUATION",
    privateDataAuthorizationEnv: "NVIDIA_PRIVATE_DATA_AUTHORIZED",
  },
  sensenova: {
    id: "sensenova",
    label: "SenseNova 日日新",
    keyEnv: "SENSENOVA_API_KEY",
    translationKeyEnv: "SENSENOVA_TRANSLATION_API_KEY",
    secondaryKeyEnv: "SENSENOVA_SECONDARY_API_KEY",
    urlEnv: "SENSENOVA_API_URL",
    defaultUrl: "https://token.sensenova.cn/v1",
    tierEnv: "SENSENOVA_API_TIER",
    defaultTier: "unknown",
    quotaScope: "account",
    officialHosts: ["token.sensenova.cn"],
    customEndpointAuthorizationEnv: "SENSENOVA_CUSTOM_ENDPOINT_AUTHORIZED",
    productionAuthorizationEnv: "SENSENOVA_PRODUCTION_AUTHORIZED",
    evaluationAuthorizationEnv: "SENSENOVA_INTERNAL_EVALUATION",
    privateDataAuthorizationEnv: "SENSENOVA_PRIVATE_DATA_AUTHORIZED",
  },
  ovo: {
    id: "ovo",
    label: "OVO GPT 特惠组",
    keyEnv: "OVO_API_KEY",
    urlEnv: "OVO_API_URL",
    defaultUrl: "https://ovo1.cn/v1",
    tierEnv: "OVO_API_TIER",
    defaultTier: "paid",
    quotaScope: "account",
    officialHosts: ["ovo1.cn"],
    customEndpointAuthorizationEnv: "OVO_CUSTOM_ENDPOINT_AUTHORIZED",
    productionAuthorizationEnv: "OVO_PRODUCTION_AUTHORIZED",
    evaluationAuthorizationEnv: "OVO_INTERNAL_EVALUATION",
    privateDataAuthorizationEnv: "OVO_PRIVATE_DATA_AUTHORIZED",
    wireApi: "chat_completions",
    // OVO is intentionally catalogue-driven. The key's account group decides
    // which models exist; application configuration must not pin one model.
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

function validAccountId(spec: ProviderSpec) {
  if (!spec.accountIdEnv) return true;
  const accountId = process.env[spec.accountIdEnv]?.trim();
  return Boolean(accountId && /^[a-f0-9]{32}$/i.test(accountId));
}

function customEndpointAuthorized(spec: ProviderSpec) {
  return (
    booleanEnvironment(spec.customEndpointAuthorizationEnv) ||
    booleanEnvironment("AI_ALLOW_CUSTOM_PROVIDER_ENDPOINTS")
  );
}

function endpointUsesHost(value: string | undefined, host: string) {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value.trim());
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.host.toLowerCase() === host
    );
  } catch {
    return false;
  }
}

/**
 * The user's paid OVO credential predates the dedicated OVO_* variables and
 * is intentionally kept in BAI_API_KEY/BAI_API_URL. The endpoint, not the key
 * shape, is the safe discriminator. When it targets ovo1.cn the credential is
 * owned exclusively by the OVO runtime and must never also register as B.AI.
 */
function baiEnvironmentTargetsOvo() {
  return endpointUsesHost(process.env.BAI_API_URL, "ovo1.cn");
}

type RuntimePrimaryCredential = {
  key?: string;
  environmentName: string;
  configuredApiUrl?: string;
};

function runtimePrimaryCredential(
  spec: ProviderSpec,
): RuntimePrimaryCredential {
  if (spec.id === "bai" && baiEnvironmentTargetsOvo())
    return { environmentName: spec.keyEnv };
  const direct = process.env[spec.keyEnv]?.trim();
  if (spec.id !== "ovo" || direct)
    return {
      key: direct,
      environmentName: spec.keyEnv,
      configuredApiUrl: process.env[spec.urlEnv]?.trim(),
    };
  if (baiEnvironmentTargetsOvo())
    return {
      key: process.env.BAI_API_KEY?.trim(),
      environmentName: "BAI_API_KEY",
      configuredApiUrl: process.env.BAI_API_URL?.trim(),
    };
  return {
    environmentName: spec.keyEnv,
    configuredApiUrl: process.env[spec.urlEnv]?.trim(),
  };
}

function resolveApiUrl(spec: ProviderSpec, configuredApiUrl?: string) {
  const configured = configuredApiUrl || spec.defaultUrl;
  if (!validAccountId(spec)) return undefined;
  const accountId = spec.accountIdEnv
    ? process.env[spec.accountIdEnv]?.trim()
    : undefined;
  const resolved = accountId
    ? configured.replaceAll("{account_id}", accountId)
    : configured;
  try {
    const url = new URL(resolved);
    if (spec.id === "zhipu" && (url.origin !== "https://open.bigmodel.cn" || url.pathname.replace(/\/+$/, "") !== "/api/paas/v4")) return undefined;
    if (url.username || url.password || url.search || url.hash)
      return undefined;
    const https = url.protocol === "https:";
    const permittedLiteLlmHttp =
      spec.id === "litellm" && url.protocol === "http:";
    if (!https && !permittedLiteLlmHttp) return undefined;
    const officialHost = spec.officialHosts.includes(url.host.toLowerCase());
    if (!officialHost && !customEndpointAuthorized(spec)) return undefined;
    return resolved.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function catalogueUrlFor(provider: AiProvider, apiUrl: string) {
  if (provider === "cloudflare") {
    return `${apiUrl.replace(/\/ai\/v1$/, "/ai")}/models/search?task=Text%20Generation&hide_experimental=true&per_page=100`;
  }
  if (provider === "cohere") {
    if (new URL(apiUrl).host === "api.cohere.ai")
      return "https://api.cohere.ai/v1/models?endpoint=chat";
    // A custom compatibility proxy may use a different credential. Keep that
    // credential on its explicitly authorized host instead of sending it to
    // Cohere's catalogue endpoint.
    return `${apiUrl}/models`;
  }
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

type DynamicCostConfiguration = {
  free?: string;
  promotion?: string;
  paid?: string;
  verifiedAt: string;
};

/** Model-level price evidence for providers whose public offers change. */
const DYNAMIC_COST_CONFIGURATION: Partial<
  Record<AiProvider, DynamicCostConfiguration>
> = {
  bai: {
    promotion: "BAI_PROMOTION_MODELS",
    verifiedAt: "BAI_PRICING_VERIFIED_AT",
  },
  openrouter: {
    free: "OPENROUTER_FREE_MODELS",
    promotion: "OPENROUTER_PROMOTION_MODELS",
    paid: "OPENROUTER_PAID_MODELS",
    verifiedAt: "OPENROUTER_PRICING_VERIFIED_AT",
  },
  gemini: {
    free: "GEMINI_FREE_MODELS",
    promotion: "GEMINI_PROMOTION_MODELS",
    paid: "GEMINI_PAID_MODELS",
    verifiedAt: "GEMINI_PRICING_VERIFIED_AT",
  },
  groq: {
    free: "GROQ_FREE_MODELS",
    promotion: "GROQ_PROMOTION_MODELS",
    paid: "GROQ_PAID_MODELS",
    verifiedAt: "GROQ_PRICING_VERIFIED_AT",
  },
  siliconflow: {
    free: "SILICONFLOW_FREE_MODELS",
    promotion: "SILICONFLOW_PROMOTION_MODELS",
    paid: "SILICONFLOW_PAID_MODELS",
    verifiedAt: "SILICONFLOW_PRICING_VERIFIED_AT",
  },
  cerebras: {
    free: "CEREBRAS_FREE_MODELS",
    promotion: "CEREBRAS_PROMOTION_MODELS",
    paid: "CEREBRAS_PAID_MODELS",
    verifiedAt: "CEREBRAS_PRICING_VERIFIED_AT",
  },
  cloudflare: {
    free: "CLOUDFLARE_AI_FREE_MODELS",
    promotion: "CLOUDFLARE_AI_PROMOTION_MODELS",
    paid: "CLOUDFLARE_AI_PAID_MODELS",
    verifiedAt: "CLOUDFLARE_AI_PRICING_VERIFIED_AT",
  },
  cohere: {
    free: "COHERE_FREE_MODELS",
    promotion: "COHERE_PROMOTION_MODELS",
    paid: "COHERE_PAID_MODELS",
    verifiedAt: "COHERE_PRICING_VERIFIED_AT",
  },
  nvidia: {
    free: "NVIDIA_FREE_MODELS",
    promotion: "NVIDIA_PROMOTION_MODELS",
    paid: "NVIDIA_PAID_MODELS",
    verifiedAt: "NVIDIA_PRICING_VERIFIED_AT",
  },
  sensenova: {
    free: "SENSENOVA_FREE_MODELS",
    promotion: "SENSENOVA_PROMOTION_MODELS",
    paid: "SENSENOVA_PAID_MODELS",
    verifiedAt: "SENSENOVA_PRICING_VERIFIED_AT",
  },
};

function pricingVerificationIsFresh(verifiedAtEnv: string) {
  const verifiedAt = Date.parse(process.env[verifiedAtEnv] ?? "");
  if (!Number.isFinite(verifiedAt)) return false;
  const configuredAge = Number(
    process.env.AI_PRICING_VERIFICATION_MAX_AGE_MS ?? 24 * 60 * 60_000,
  );
  const maximumAge = Math.max(
    60_000,
    Number.isFinite(configuredAge) ? configuredAge : 24 * 60 * 60_000,
  );
  // A clock-skew allowance avoids accepting a malformed far-future stamp.
  return (
    verifiedAt <= Date.now() + 5 * 60_000 &&
    Date.now() - verifiedAt <= maximumAge
  );
}

function dynamicCostTier(
  provider: AiProvider,
  modelId: string,
  apiTier: ProviderApiTier,
  staticTier: AiModelCostTier,
) {
  const configuration = DYNAMIC_COST_CONFIGURATION[provider];
  if (!configuration) return staticTier;

  // An explicitly paid account/model must never be admitted as free because
  // a stale free list is still present in the environment.
  if (apiTier === "paid") return "paid" as const;
  if (
    configuration.paid &&
    configuredModelList(configuration.paid).has(modelId)
  )
    return "paid" as const;
  if (staticTier === "paid") return "paid" as const;

  if (!pricingVerificationIsFresh(configuration.verifiedAt)) return "unknown";
  if (
    configuration.free &&
    configuredModelList(configuration.free).has(modelId) &&
    (apiTier === "free" || apiTier === "promotion" || apiTier === "unknown")
  )
    return "free" as const;
  if (
    configuration.promotion &&
    configuredModelList(configuration.promotion).has(modelId) &&
    (apiTier === "promotion" || apiTier === "unknown")
  )
    return "promotion" as const;
  return "unknown" as const;
}

function effectiveCostTier(
  provider: AiProvider,
  modelId: string,
  apiTier: ProviderApiTier,
): AiModelCostTier {
  const definition = modelDefinition(provider, modelId);
  const staticTier = definition?.costTier ?? "unknown";
  // OpenRouter defines `:free` as a zero-cost routing contract carried by the
  // model identifier itself. Unlike a manually maintained promotion list, it
  // does not become ambiguous when local pricing-verification timestamps age.
  if (provider === "openrouter" && modelId.endsWith(":free")) return "free";
  if (provider === "litellm") {
    if (configuredModelList("LITELLM_FREE_MODELS").has(modelId)) return "free";
    if (configuredModelList("LITELLM_PROMOTION_MODELS").has(modelId))
      return "promotion";
    if (configuredModelList("LITELLM_PAID_MODELS").has(modelId)) return "paid";
    return apiTier === "paid" ? "paid" : "unknown";
  }
  if (provider === "cloudflare" && apiTier === "paid") {
    // Overage is an explicit billing decision; a paid tier without the switch
    // remains unknown so a caller cannot accidentally incur charges.
    return booleanEnvironment("CLOUDFLARE_AI_ALLOW_OVERAGE")
      ? "paid"
      : "unknown";
  }
  // A runtime explicitly configured as a free account is a stronger spending
  // boundary than the short-lived model-price snapshot. Live catalogue checks
  // still gate whether a model can actually be called, while static or explicit
  // paid classifications continue to win above. This keeps the free provider
  // pool usable after pricing evidence ages without admitting a paid model.
  if (apiTier === "free" && staticTier !== "paid") return "free";
  return dynamicCostTier(provider, modelId, apiTier, staticTier);
}

/**
 * Dynamic providers publish model-specific prices, promotions, or lifecycle
 * states.  A provider-level `free`/`promotion` label is therefore not enough
 * to admit every model into `free_only`; only an explicitly verified model
 * list may do that.  Paid remains safe to classify at provider scope because
 * it can only make free-only routing more conservative.
 */

function runtimeFor(
  spec: ProviderSpec,
  options: { bypassActivationGate?: boolean } = {},
): ProviderRuntime | undefined {
  if (!(AI_PROVIDER_IDS as readonly string[]).includes(spec.id)) return undefined;
  const primary = runtimePrimaryCredential(spec);
  const primaryApiKey = primary.key;
  const translationApiKey = spec.translationKeyEnv
    ? process.env[spec.translationKeyEnv]?.trim()
    : undefined;
  const secondaryApiKey = spec.secondaryKeyEnv
    ? process.env[spec.secondaryKeyEnv]?.trim()
    : undefined;
  const apiKey = primaryApiKey || translationApiKey || secondaryApiKey;
  if (!apiKey) return undefined;
  const productionAuthorized = spec.productionAuthorizationEnv
    ? booleanEnvironment(spec.productionAuthorizationEnv)
    : true;
  const productionRuntime =
    process.env.NODE_ENV?.trim().toLowerCase() === "production";
  const evaluationAuthorized =
    !productionRuntime && booleanEnvironment(spec.evaluationAuthorizationEnv);
  if (
    !options.bypassActivationGate &&
    spec.productionAuthorizationEnv &&
    (productionRuntime ? !productionAuthorized : !evaluationAuthorized)
  )
    return undefined;
  const apiTier = readApiTier(process.env[spec.tierEnv], spec.defaultTier);
  const apiUrl = resolveApiUrl(spec, primary.configuredApiUrl);
  if (!apiUrl) return undefined;
  const credentials = [
    ...(primaryApiKey
      ? [
          {
            id: spec.translationKeyEnv ? "main" : "default",
            key: primaryApiKey,
          },
        ]
      : []),
    ...(translationApiKey
      ? [{ id: "translation", key: translationApiKey }]
      : []),
    ...(secondaryApiKey ? [{ id: "secondary", key: secondaryApiKey }] : []),
  ];
  const configuredCatalogueFallbacks = configuredModelList(
    `AI_${spec.id.toUpperCase()}_CATALOGUE_FALLBACK_MODELS`,
  );
  return {
    id: spec.id,
    label: spec.label,
    apiUrl,
    catalogueUrl: catalogueUrlFor(spec.id, apiUrl),
    apiTier,
    quotaScope: spec.quotaScope,
    wireApi: spec.wireApi,
    staticModelIds: spec.staticModelIds,
    catalogueFallbackModelIds:
      configuredCatalogueFallbacks.size > 0
        ? [...configuredCatalogueFallbacks]
        : spec.catalogueFallbackModelIds,
    credentialQuotaGroup: (credentialId) => {
      if (spec.id === "sensenova") {
        if (credentialId === "main" || credentialId === "translation")
          return "account-primary";
        if (credentialId === "secondary") return "account-secondary";
        return "shared";
      }
      return spec.quotaScope === "credential" ? credentialId : "shared";
    },
    credentialIds: (task) => {
      const ids = credentials.map((credential) => credential.id);
      return task === "translation" && ids.includes("translation")
        ? ["translation", ...ids.filter((id) => id !== "translation")]
        : ids;
    },
    headers: (json, task, credentialId) => {
      const preferredIds =
        task === "translation" &&
        credentials.some(({ id }) => id === "translation")
          ? ["translation", "main", "default", "secondary"]
          : ["main", "default", "translation", "secondary"];
      const selected = credentialId
        ? credentials.find(({ id }) => id === credentialId)
        : preferredIds.flatMap((id) =>
            credentials.filter((credential) => credential.id === id),
          )[0];
      return headersFor(spec.id, selected?.key ?? apiKey, json);
    },
    extractCatalogueModelIds: (payload) =>
      catalogueModelIds(spec.id, payload).map((modelId) =>
        spec.id === "gemini" ? modelId.replace(/^models\//, "") : modelId,
      ),
    normalizeCatalogueModelId: (modelId) =>
      spec.id === "gemini" ? modelId.replace(/^models\//, "") : modelId,
    normalizeRequestBody: (body) => {
      if (spec.id === "zhipu") return { ...body, model: ZHIPU_MODEL, stream: false, response_format: { type: "json_object" }, thinking: { type: "enabled" }, reasoning_effort: "low" };
      if (spec.id === "groq") return { ...body, temperature: 0 };
      if (spec.id === "cerebras" || spec.id === "cohere")
        return { ...body, response_format: { type: "json_object" } };
      return body;
    },
    allowsDataClass: (dataClass) => {
      if (dataClass === "public_market") return true;
      // OVO is intentionally public-market-only. Purchase receipts, private
      // profiles, credentials and sensitive images must never be sent even if
      // an obsolete deployment still has OVO_PRIVATE_DATA_AUTHORIZED=true.
      if (spec.id === "ovo") return false;
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

/**
 * Builds credential runtimes for an explicit operator-run connectivity probe.
 * This bypasses only the evaluation/production activation switch; application
 * routing continues to use configuredProviderRuntimes and remains fail closed.
 */
export function diagnosticProviderRuntimes(
  order: readonly AiProvider[] = AI_PROVIDER_IDS,
) {
  return order.flatMap((provider) => {
    const runtime = runtimeFor(PROVIDER_SPECS[provider], {
      bypassActivationGate: true,
    });
    return runtime ? [runtime] : [];
  });
}

export function providerCredentialEnvironmentName(
  provider: AiProvider,
  credentialId: string,
) {
  const spec = PROVIDER_SPECS[provider];
  if (credentialId === "translation" && spec.translationKeyEnv)
    return spec.translationKeyEnv;
  if (credentialId === "secondary" && spec.secondaryKeyEnv)
    return spec.secondaryKeyEnv;
  return runtimePrimaryCredential(spec).environmentName;
}

function activationReason(spec: ProviderSpec) {
  const primary = runtimePrimaryCredential(spec);
  const credentialConfigured = Boolean(
    primary.key ||
      (spec.translationKeyEnv && process.env[spec.translationKeyEnv]?.trim()) ||
      (spec.secondaryKeyEnv && process.env[spec.secondaryKeyEnv]?.trim()),
  );
  if (!credentialConfigured) return "missing_credentials" as const;
  if (!validAccountId(spec)) return "invalid_or_missing_account_id" as const;
  if (!resolveApiUrl(spec, primary.configuredApiUrl))
    return "invalid_or_unauthorized_api_url" as const;
  if (!spec.productionAuthorizationEnv) return "ready" as const;
  const productionRuntime =
    process.env.NODE_ENV?.trim().toLowerCase() === "production";
  if (productionRuntime && !booleanEnvironment(spec.productionAuthorizationEnv))
    return "production_authorization_required" as const;
  if (
    !productionRuntime &&
    !booleanEnvironment(spec.evaluationAuthorizationEnv)
  )
    return "evaluation_authorization_required" as const;
  return "ready" as const;
}

/** Safe operational metadata. Credential values and prefixes never leave here. */
export function providerConfigurationStatuses(): ProviderConfigurationStatus[] {
  return AI_PROVIDER_IDS.map((provider) => {
    const spec = PROVIDER_SPECS[provider];
    const primary = runtimePrimaryCredential(spec);
    const runtime = runtimeFor(spec);
    const reason = activationReason(spec);
    const configuredCredentialCount = [
      primary.key,
      spec.translationKeyEnv
        ? process.env[spec.translationKeyEnv]?.trim()
        : undefined,
      spec.secondaryKeyEnv
        ? process.env[spec.secondaryKeyEnv]?.trim()
        : undefined,
    ].filter(Boolean).length;
    return {
      provider,
      label: spec.label,
      credentialEnvironmentNames: [
        spec.keyEnv,
        ...(spec.id === "ovo" ? ["BAI_API_KEY"] : []),
        ...(spec.translationKeyEnv ? [spec.translationKeyEnv] : []),
        ...(spec.secondaryKeyEnv ? [spec.secondaryKeyEnv] : []),
      ],
      credentialConfigured: reason !== "missing_credentials",
      configuredCredentialCount,
      active: Boolean(runtime),
      activationReason: runtime ? "ready" : reason,
      apiTier: readApiTier(process.env[spec.tierEnv], spec.defaultTier),
      quotaScope: spec.quotaScope,
      publicMarketAllowed: runtime?.allowsDataClass("public_market") ?? false,
      privateDataAllowed: runtime?.allowsDataClass("user_private") ?? false,
      sensitiveImagesAllowed:
        runtime?.allowsDataClass("sensitive_image") ?? false,
      modelAvailabilityEvidence: spec.staticModelIds?.length
        ? "operator_static_route"
        : "live_catalogue",
    };
  });
}

export function providerLabel(provider: AiProvider) {
  return PROVIDER_SPECS[provider].label;
}
