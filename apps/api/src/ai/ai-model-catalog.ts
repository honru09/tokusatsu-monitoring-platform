// Historical provider names are retained only for reading existing audit records.
export const LEGACY_AI_PROVIDER_IDS = ["litellm", "bai", "gemini", "groq", "siliconflow", "cerebras", "cloudflare", "cohere", "nvidia", "sensenova", "openrouter", "ovo"] as const;
export type AiProvider = "zhipu" | (typeof LEGACY_AI_PROVIDER_IDS)[number];
export const AI_PROVIDER_IDS: readonly AiProvider[] = ["zhipu"];
export type AiDataClass = "public_market" | "user_private" | "sensitive_image";
export type AiCostPolicy = "free_only" | "free_first" | "paid_allowed";
export type AiModelCostTier = "free" | "promotion" | "unknown" | "paid";
export type AiInputModality = "text" | "image";
export type AiModelDefinition = {
  provider: AiProvider;
  id: string;
  role: string;
  costTier: AiModelCostTier;
  inputModalities: readonly AiInputModality[];
  pricingVerifiedAt?: string;
};
export const ZHIPU_MODEL = "glm-5.3-flash";
export const AI_MODELS: readonly AiModelDefinition[] = [{
  provider: "zhipu", id: ZHIPU_MODEL, role: "商品读取、日中翻译与聊天",
  costTier: "promotion", inputModalities: ["text", "image"],
}];
const auditProviderIds: readonly AiProvider[] = [...AI_PROVIDER_IDS, ...LEGACY_AI_PROVIDER_IDS];
export const MODEL_DEFINITIONS_BY_PROVIDER = Object.fromEntries(auditProviderIds.map(provider => [provider, AI_MODELS.filter(entry => entry.provider === provider)])) as Record<AiProvider, AiModelDefinition[]>;
export const PROVIDER_MODEL_ALLOWLIST = Object.fromEntries(auditProviderIds.map(provider => [provider, new Set(MODEL_DEFINITIONS_BY_PROVIDER[provider].map(entry => entry.id))])) as Record<AiProvider, Set<string>>;
export function isAiProvider(value: string): value is AiProvider { return (AI_PROVIDER_IDS as readonly string[]).includes(value); }
export function modelDefinition(provider: AiProvider, model: string) { return MODEL_DEFINITIONS_BY_PROVIDER[provider]?.find(entry => entry.id === model); }
export function modelStateKey(provider: AiProvider, model: string) { return `${provider}:${model}`; }
export function parseModelStateKey(value: string): { provider?: AiProvider; model: string } {
  const separator = value.indexOf(":");
  const provider = value.slice(0, separator);
  return separator > 0 && isAiProvider(provider) ? { provider, model: value.slice(separator + 1) } : { model: value };
}
export function providerForModel(_value: string, hint?: AiProvider): AiProvider { return hint ?? "zhipu"; }
export function modelRole(provider: AiProvider, model: string, fallback: string) { return modelDefinition(provider, model)?.role ?? fallback; }
export function modelAcceptsImages(provider: AiProvider, model: string) { return Boolean(modelDefinition(provider, model)?.inputModalities.includes("image")); }
export function modelIsFree(provider: AiProvider, model: string) { const tier = modelDefinition(provider, model)?.costTier; return tier === "free" || tier === "promotion"; }
