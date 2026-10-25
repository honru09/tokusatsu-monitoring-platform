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

function headersFor(apiKey: string, json: boolean) {
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  if (json) headers["content-type"] = "application/json";
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

type RuntimePrimaryCredential = {
  key?: string;
  environmentName: string;
  configuredApiUrl?: string;
};

function runtimePrimaryCredential(
  spec: ProviderSpec,
): RuntimePrimaryCredential {
  return {
    key: process.env[spec.keyEnv]?.trim(),
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
    if (url.protocol !== "https:") return undefined;
    const officialHost = spec.officialHosts.includes(url.host.toLowerCase());
    if (!officialHost && !customEndpointAuthorized(spec)) return undefined;
    return resolved.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function catalogueUrlFor(apiUrl: string) {
  return `${apiUrl}/models`;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function catalogueModelIds(payload: unknown) {
  const record = recordOf(payload);
  const entries = record?.data;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    const model = recordOf(entry)?.id;
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
  // A runtime explicitly configured as a free account is a stronger spending
  // boundary than the model definition. Live catalogue checks still gate
  // whether a model can actually be called, while a static paid
  // classification continues to win above.
  if (apiTier === "free" && staticTier !== "paid") return "free";
  return staticTier;
}

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
    catalogueUrl: catalogueUrlFor(apiUrl),
    apiTier,
    quotaScope: spec.quotaScope,
    wireApi: spec.wireApi,
    staticModelIds: spec.staticModelIds,
    catalogueFallbackModelIds:
      configuredCatalogueFallbacks.size > 0
        ? [...configuredCatalogueFallbacks]
        : spec.catalogueFallbackModelIds,
    credentialQuotaGroup: (credentialId) =>
      spec.quotaScope === "credential" ? credentialId : "shared",
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
      return headersFor(selected?.key ?? apiKey, json);
    },
    extractCatalogueModelIds: (payload) => catalogueModelIds(payload),
    normalizeCatalogueModelId: (modelId) => modelId,
    normalizeRequestBody: (body) => {
      if (spec.id === "zhipu") return { ...body, model: ZHIPU_MODEL, stream: false, response_format: { type: "json_object" }, thinking: { type: "enabled" }, reasoning_effort: "low" };
      return body;
    },
    allowsDataClass: (dataClass) => {
      if (dataClass === "public_market") return true;
      if (!booleanEnvironment(spec.privateDataAuthorizationEnv)) return false;
      return true;
    },
    costTierFor: (modelId) => effectiveCostTier(spec.id, modelId, apiTier),
  };
}

export function configuredProviderRuntimes(
  order: readonly AiProvider[] = AI_PROVIDER_IDS,
) {
  return order.flatMap((provider) => {
    const spec = PROVIDER_SPECS[provider];
    if (!spec) return [];
    const runtime = runtimeFor(spec);
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

function credentialConfiguredFor(spec: ProviderSpec) {
  const primary = runtimePrimaryCredential(spec);
  return Boolean(
    primary.key ||
      (spec.translationKeyEnv && process.env[spec.translationKeyEnv]?.trim()) ||
      (spec.secondaryKeyEnv && process.env[spec.secondaryKeyEnv]?.trim()),
  );
}

function activationReason(spec: ProviderSpec) {
  const primary = runtimePrimaryCredential(spec);
  const credentialConfigured = credentialConfiguredFor(spec);
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
