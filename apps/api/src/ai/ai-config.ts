// AI configuration, single source of truth.
//
// Every AI constant that more than one module needs lives here: the active
// provider ids, the per-provider model definitions, the task lists the
// scoped route serves, the extended scopes and their opt-in flag, and the
// Zhipu gift resource package limits. The catalog, provider registry,
// router and Zhipu policy all read from this file instead of restating
// their own copies.
//
// To add a provider or a model: add the provider id to AI_PROVIDER_IDS and
// its models to AI_MODELS here, then add the provider's runtime spec
// (endpoint, credential env names, request shaping) in
// ai-provider-registry.ts. Nothing else should need a new copy of the
// provider or model names.

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

export type AiTask = "bulk_filter" | "translation" | "classification" | "image_analysis" | "seller_analysis" | "bundle_negotiation" | "complex_analysis" | "cross_validation" | "market_analysis" | "crawler_diagnosis" | "logistics_analysis" | "assistant_chat";
export const AI_TASKS: readonly AiTask[] = ["bulk_filter", "translation", "classification", "image_analysis", "seller_analysis", "bundle_negotiation", "complex_analysis", "cross_validation", "market_analysis", "crawler_diagnosis", "logistics_analysis", "assistant_chat"];
export const AI_ROUTE_REVISION = "zhipu-scoped-20261009-v1";

// Tasks the scoped route serves on the gift resource package.
export const AI_SCOPED_TASKS: readonly AiTask[] = ["translation", "classification", "image_analysis", "complex_analysis", "assistant_chat"];
// Scoped tasks that additionally need the product_reading purpose.
export const AI_PRODUCT_READING_TASKS: readonly AiTask[] = ["complex_analysis", "image_analysis", "classification"];
// Extended scopes stay off unless the operator explicitly opts in; the gift
// resource package is only approved for product reading, translation and chat.
export const AI_EXTENDED_TASKS: readonly AiTask[] = ["seller_analysis", "bundle_negotiation"];

// Routing tiers. Bulk work is exactly the scoped set above (the title_parsing
// operation rides on the classification task, so it is bulk through it);
// high-value work is exactly the extended scopes. Tasks in neither list have
// no tier and no route.
export type AiTaskTier = "bulk" | "high_value";
export const AI_BULK_TASKS: readonly AiTask[] = AI_SCOPED_TASKS;
export const AI_HIGH_VALUE_TASKS: readonly AiTask[] = AI_EXTENDED_TASKS;
export function extendedAiScopesEnabled() {
  const value = process.env.AI_EXTENDED_SCOPES_ENABLED;
  return value === "true" || value === "1";
}

// Zhipu gift resource package (zhipu-gift-20261009). The code clamps operator
// settings to these ceilings; the package expiry can only move earlier.
export const ZHIPU_GIFT_GROUP = "zhipu-gift-20261009";
export const ZHIPU_GIFT_TOKEN_LIMIT = 14_000_000;
export const ZHIPU_GIFT_DAILY_TOKEN_LIMIT = 200_000;
export const ZHIPU_GIFT_EXPIRES_AT = "2026-11-09T14:35:56+08:00";
export const ZHIPU_GIFT_ALLOWED_USES: readonly string[] = ["商品读取", "商品翻译", "AI 聊天"];
export const ZHIPU_MAX_IMAGES_PER_REQUEST = 2;
