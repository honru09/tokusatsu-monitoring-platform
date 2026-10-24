import { AI_MODELS, AI_PROVIDER_IDS, PROVIDER_MODEL_ALLOWLIST, ZHIPU_MODEL, modelStateKey, type AiProvider, type AiCostPolicy } from "./ai-model-catalog.js";
import { extendedAiScopesEnabled } from "./zhipu.policy.js";
export * from "./ai-model-catalog.js";
export type AiTask = "bulk_filter" | "translation" | "classification" | "image_analysis" | "seller_analysis" | "bundle_negotiation" | "complex_analysis" | "cross_validation" | "market_analysis" | "crawler_diagnosis" | "logistics_analysis" | "assistant_chat";
export const AI_ROUTE_REVISION = "zhipu-scoped-20261009-v1";
export const AI_MODEL_ALLOWLIST = PROVIDER_MODEL_ALLOWLIST.zhipu;
export const OPENROUTER_MODEL_ALLOWLIST = new Set<string>();
export const OPENROUTER_PAID_MODELS = new Set<string>();
const tasks: AiTask[] = ["bulk_filter", "translation", "classification", "image_analysis", "seller_analysis", "bundle_negotiation", "complex_analysis", "cross_validation", "market_analysis", "crawler_diagnosis", "logistics_analysis", "assistant_chat"];
const scopedTasks = new Set<AiTask>(["translation", "classification", "image_analysis", "complex_analysis", "assistant_chat"]);
const extendedTasks = new Set<AiTask>(["seller_analysis", "bundle_negotiation"]);
function isRoutableTask(task: AiTask) { return scopedTasks.has(task) || (extendedAiScopesEnabled() && extendedTasks.has(task)); }
export const modelRoleLabels = Object.fromEntries(AI_MODELS.map(entry => [modelStateKey(entry.provider, entry.id), entry.role]));
export function routeFor(task: AiTask) { return routeForProvider(task, "zhipu"); }
export function routeForProvider(task: AiTask, provider: AiProvider) { return provider === "zhipu" && isRoutableTask(task) ? [ZHIPU_MODEL] : []; }
export function routeUsesLiveCatalogue(_task: AiTask, _provider: AiProvider) { return false; }
export function providerOrder(_task?: AiTask): AiProvider[] { return [...AI_PROVIDER_IDS]; }
export type AiRouteCandidate = { provider: AiProvider; model: string; costTier: "free" | "promotion" | "unknown" | "paid" };
export function candidatesForTask(task: AiTask, providers: readonly AiProvider[], options: { costPolicy: AiCostPolicy; requiresVision: boolean; rotationSeed?: string; availableModels?: ReadonlyMap<AiProvider, ReadonlySet<string>>; costTierFor?: (provider: AiProvider, model: string) => AiRouteCandidate["costTier"]; }): AiRouteCandidate[] {
  if (!providers.includes("zhipu") || !isRoutableTask(task)) return [];
  const tier = options.costTierFor?.("zhipu", ZHIPU_MODEL) ?? "promotion";
  if (tier !== "promotion" && tier !== "free") return [];
  return [{ provider: "zhipu", model: ZHIPU_MODEL, costTier: tier }];
}
export function allConfiguredModels() { return [ZHIPU_MODEL]; }
export function allConfiguredModelRefs() { return [{ provider: "zhipu" as AiProvider, model: ZHIPU_MODEL, stateKey: modelStateKey("zhipu", ZHIPU_MODEL) }]; }
export function routesForDisplay() { return Object.fromEntries(tasks.map(task => [task, routeFor(task)])) as Record<AiTask, string[]>; }
export function providerRoutesForDisplay() { return { zhipu: routesForDisplay() } as Record<AiProvider, Record<AiTask, string[]>>; }
