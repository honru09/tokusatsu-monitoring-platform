import { AI_MODELS, AI_PROVIDER_IDS, type AiModelDefinition, type AiProvider } from "./ai-config.js";
export * from "./ai-config.js";
export const MODEL_DEFINITIONS_BY_PROVIDER = Object.fromEntries(AI_PROVIDER_IDS.map(provider => [provider, AI_MODELS.filter(entry => entry.provider === provider)])) as Record<AiProvider, AiModelDefinition[]>;
export const PROVIDER_MODEL_ALLOWLIST = Object.fromEntries(AI_PROVIDER_IDS.map(provider => [provider, new Set(MODEL_DEFINITIONS_BY_PROVIDER[provider].map(entry => entry.id))])) as Record<AiProvider, Set<string>>;
export function isAiProvider(value: string): value is AiProvider { return (AI_PROVIDER_IDS as readonly string[]).includes(value); }
export function modelDefinition(provider: AiProvider, model: string) { return MODEL_DEFINITIONS_BY_PROVIDER[provider]?.find(entry => entry.id === model); }
export function modelStateKey(provider: AiProvider, model: string) { return `${provider}:${model}`; }
export function modelRole(provider: AiProvider, model: string, fallback: string) { return modelDefinition(provider, model)?.role ?? fallback; }
export function modelAcceptsImages(provider: AiProvider, model: string) { return Boolean(modelDefinition(provider, model)?.inputModalities.includes("image")); }
export function modelIsFree(provider: AiProvider, model: string) { const tier = modelDefinition(provider, model)?.costTier; return tier === "free" || tier === "promotion"; }
