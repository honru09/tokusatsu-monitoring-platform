import { AI_BULK_TASKS, AI_EXTENDED_TASKS, AI_HIGH_VALUE_TASKS, AI_MODELS, AI_PROVIDER_IDS, AI_SCOPED_TASKS, AI_TASKS, PROVIDER_MODEL_ALLOWLIST, ZHIPU_MODEL, extendedAiScopesEnabled, modelStateKey, type AiProvider, type AiCostPolicy, type AiTask, type AiTaskTier } from "./ai-model-catalog.js";
export * from "./ai-model-catalog.js";
export type { AiTask, AiTaskTier };
export const AI_MODEL_ALLOWLIST = PROVIDER_MODEL_ALLOWLIST.zhipu;
const scopedTasks = new Set<AiTask>(AI_SCOPED_TASKS);
const extendedTasks = new Set<AiTask>(AI_EXTENDED_TASKS);
const bulkTasks = new Set<AiTask>(AI_BULK_TASKS);
const highValueTasks = new Set<AiTask>(AI_HIGH_VALUE_TASKS);
function isRoutableTask(task: AiTask) { return scopedTasks.has(task) || (extendedAiScopesEnabled() && extendedTasks.has(task)); }
export function taskTier(task: AiTask): AiTaskTier | undefined {
  if (bulkTasks.has(task)) return "bulk";
  if (highValueTasks.has(task)) return "high_value";
  return undefined;
}
export const modelRoleLabels = Object.fromEntries(AI_MODELS.map(entry => [modelStateKey(entry.provider, entry.id), entry.role]));
export function routeFor(task: AiTask) { return routeForProvider(task, "zhipu"); }
export function routeForProvider(task: AiTask, provider: AiProvider) {
  if (provider === "zhipu" && isRoutableTask(task)) return [ZHIPU_MODEL];
  return [];
}
export function routeUsesLiveCatalogue(_task: AiTask, _provider: AiProvider) { return false; }
export function providerOrder(_task?: AiTask): AiProvider[] { return [...AI_PROVIDER_IDS]; }
export type AiRouteCandidate = { provider: AiProvider; model: string; costTier: "free" | "promotion" | "unknown" | "paid" };
export function candidatesForTask(task: AiTask, providers: readonly AiProvider[], options: { costPolicy: AiCostPolicy; requiresVision: boolean; rotationSeed?: string; availableModels?: ReadonlyMap<AiProvider, ReadonlySet<string>>; costTierFor?: (provider: AiProvider, model: string) => AiRouteCandidate["costTier"]; }): AiRouteCandidate[] {
  const scoped: AiRouteCandidate[] = (() => {
    if (!providers.includes("zhipu") || !isRoutableTask(task)) return [];
    const tier = options.costTierFor?.("zhipu", ZHIPU_MODEL) ?? "promotion";
    if (tier !== "promotion" && tier !== "free") return [];
    return [{ provider: "zhipu", model: ZHIPU_MODEL, costTier: tier }];
  })();
  return scoped;
}
export function allConfiguredModels() { return [ZHIPU_MODEL]; }
export function allConfiguredModelRefs() { return [{ provider: "zhipu" as AiProvider, model: ZHIPU_MODEL, stateKey: modelStateKey("zhipu", ZHIPU_MODEL) }]; }
export function routesForDisplay() { return Object.fromEntries(AI_TASKS.map(task => [task, routeFor(task)])) as Record<AiTask, string[]>; }
export function providerRoutesForDisplay() { return { zhipu: routesForDisplay() } as Record<AiProvider, Record<AiTask, string[]>>; }
