import {
  AI_MODELS,
  AI_PROVIDER_IDS,
  MODEL_DEFINITIONS_BY_PROVIDER,
  PROVIDER_MODEL_ALLOWLIST,
  isAiProvider,
  modelAcceptsImages,
  modelDefinition,
  modelIsFree,
  modelRole,
  modelStateKey,
  parseModelStateKey,
  providerForModel,
  type AiCostPolicy,
  type AiDataClass,
  type AiModelDefinition,
  type AiProvider,
} from "./ai-model-catalog.js";

export type AiTask =
  | "bulk_filter"
  | "translation"
  | "classification"
  | "image_analysis"
  | "seller_analysis"
  | "complex_analysis"
  | "cross_validation"
  | "market_analysis"
  | "crawler_diagnosis"
  | "logistics_analysis"
  | "assistant_chat";

export type { AiCostPolicy, AiDataClass, AiModelDefinition, AiProvider };
export {
  AI_PROVIDER_IDS,
  PROVIDER_MODEL_ALLOWLIST,
  isAiProvider,
  modelAcceptsImages,
  modelDefinition,
  modelIsFree,
  modelRole,
  modelStateKey,
  parseModelStateKey,
  providerForModel,
};

export const AI_ROUTE_REVISION = "multi-provider-20260831-v5";
export const AI_MODEL_ALLOWLIST = PROVIDER_MODEL_ALLOWLIST.bai;
export const OPENROUTER_MODEL_ALLOWLIST = PROVIDER_MODEL_ALLOWLIST.openrouter;
export const OPENROUTER_PAID_MODELS = new Set(
  MODEL_DEFINITIONS_BY_PROVIDER.openrouter
    .filter((entry) => entry.costTier === "paid")
    .map((entry) => entry.id),
);

const baiRoutes: Record<AiTask, string[]> = {
  bulk_filter: ["mimo-v2.5", "deepseek-v4-flash", "glm-5.3-flash"],
  translation: ["mimo-v2.5", "deepseek-v4-flash", "glm-5.3-flash"],
  classification: ["mimo-v2.5", "deepseek-v4-flash", "glm-5.3-flash"],
  image_analysis: [
    "deepseek-v4-flash-vision-exp",
    "qwen3.8-flash",
    "glm-5.3-flash",
    "mimo-v2.5",
  ],
  seller_analysis: ["mimo-v2.5", "deepseek-v4-flash", "glm-5.3-flash"],
  complex_analysis: ["glm-5.3-flash", "qwen3.8-flash", "mimo-v2.5"],
  cross_validation: ["glm-5.3-flash", "qwen3.8-flash", "mimo-v2.5"],
  market_analysis: ["glm-5.3-flash", "qwen3.8-flash", "mimo-v2.5"],
  crawler_diagnosis: ["hy3", "glm-5.3-flash", "qwen3.8-flash"],
  logistics_analysis: ["mimo-v2.5", "glm-5.3-flash", "deepseek-v4-flash"],
  assistant_chat: ["glm-5.3-flash", "qwen3.8-flash", "mimo-v2.5"],
};

const openRouterRoutes: Record<AiTask, string[]> = {
  bulk_filter: [
    "deepseek/deepseek-v4-flash",
    "z-ai/glm-5.2:free",
    "minimax/minimax-m3:free",
  ],
  translation: [
    "deepseek/deepseek-v4-flash",
    "z-ai/glm-5.2:free",
    "minimax/minimax-m3:free",
  ],
  classification: [
    "deepseek/deepseek-v4-flash",
    "z-ai/glm-5.2:free",
    "minimax/minimax-m3:free",
  ],
  image_analysis: ["deepseek/deepseek-v4-flash-vision-exp"],
  seller_analysis: [
    "deepseek/deepseek-v4-flash",
    "z-ai/glm-5.2:free",
    "minimax/minimax-m3:free",
  ],
  complex_analysis: [
    "deepseek/deepseek-v4-flash",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "minimax/minimax-m3:free",
  ],
  cross_validation: [
    "deepseek/deepseek-v4-flash",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "minimax/minimax-m3:free",
  ],
  market_analysis: [
    "deepseek/deepseek-v4-flash",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "z-ai/glm-5.2:free",
  ],
  crawler_diagnosis: [
    "qwen/qwen3-coder",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "z-ai/glm-5.2:free",
  ],
  logistics_analysis: [
    "deepseek/deepseek-v4-flash",
    "z-ai/glm-5.2:free",
    "minimax/minimax-m3:free",
  ],
  assistant_chat: [
    "deepseek/deepseek-v4-flash",
    "z-ai/glm-5.2:free",
    "minimax/minimax-m3:free",
  ],
};

const geminiRoutes: Record<AiTask, string[]> = {
  bulk_filter: [
    "gemini-3.5-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3.7-flash",
  ],
  translation: [
    "gemini-3.5-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3.7-flash",
  ],
  classification: [
    "gemini-3.5-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3.7-flash",
  ],
  image_analysis: ["gemini-3.7-flash"],
  seller_analysis: ["gemini-3.7-flash", "gemini-3.5-flash-lite"],
  complex_analysis: ["gemini-3.7-flash", "gemini-3.5-flash-lite"],
  cross_validation: ["gemini-3.7-flash", "gemini-3.5-flash-lite"],
  market_analysis: ["gemini-3.7-flash", "gemini-3.5-flash-lite"],
  crawler_diagnosis: ["gemini-3.7-flash", "gemini-3.5-flash-lite"],
  logistics_analysis: ["gemini-3.5-flash-lite", "gemini-3.7-flash"],
  assistant_chat: ["gemini-3.7-flash", "gemini-3.5-flash-lite"],
};

const groqRoutes: Record<AiTask, string[]> = {
  bulk_filter: ["openai/gpt-oss-20b", "openai/gpt-oss-120b"],
  translation: ["openai/gpt-oss-20b", "qwen/qwen3.8-27b"],
  classification: ["openai/gpt-oss-20b", "openai/gpt-oss-120b"],
  image_analysis: ["qwen/qwen3.8-27b"],
  seller_analysis: [
    "groq/compound",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
  ],
  complex_analysis: [
    "openai/gpt-oss-120b",
    "groq/compound",
    "openai/gpt-oss-20b",
  ],
  cross_validation: ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
  market_analysis: [
    "groq/compound",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
  ],
  crawler_diagnosis: [
    "openai/gpt-oss-120b",
    "groq/compound",
    "openai/gpt-oss-20b",
  ],
  logistics_analysis: ["openai/gpt-oss-20b", "openai/gpt-oss-120b"],
  assistant_chat: [
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
    "groq/compound",
  ],
};

const siliconFlowRoutes: Record<AiTask, string[]> = {
  bulk_filter: ["Qwen/Qwen2.5-7B-Instruct", "deepseek-ai/DeepSeek-V4-Flash"],
  translation: [
    "tencent/Hunyuan-MT-7B",
    "Qwen/Qwen2.5-7B-Instruct",
    "deepseek-ai/DeepSeek-V4-Flash",
  ],
  classification: ["Qwen/Qwen2.5-7B-Instruct", "deepseek-ai/DeepSeek-V4-Flash"],
  image_analysis: ["Qwen/Qwen3-VL-8B-Instruct"],
  seller_analysis: [
    "deepseek-ai/DeepSeek-V4-Flash",
    "Qwen/Qwen3-Coder-30B-A3B-Instruct",
    "Qwen/Qwen2.5-7B-Instruct",
  ],
  complex_analysis: [
    "Qwen/Qwen3-Coder-30B-A3B-Instruct",
    "deepseek-ai/DeepSeek-V4-Flash",
    "Qwen/Qwen2.5-7B-Instruct",
  ],
  cross_validation: [
    "deepseek-ai/DeepSeek-V4-Flash",
    "Qwen/Qwen2.5-7B-Instruct",
  ],
  market_analysis: [
    "deepseek-ai/DeepSeek-V4-Flash",
    "Qwen/Qwen3-Coder-30B-A3B-Instruct",
    "Qwen/Qwen2.5-7B-Instruct",
  ],
  crawler_diagnosis: [
    "Qwen/Qwen3-Coder-30B-A3B-Instruct",
    "deepseek-ai/DeepSeek-V4-Flash",
    "Qwen/Qwen2.5-7B-Instruct",
  ],
  logistics_analysis: [
    "Qwen/Qwen2.5-7B-Instruct",
    "deepseek-ai/DeepSeek-V4-Flash",
  ],
  assistant_chat: [
    "deepseek-ai/DeepSeek-V4-Flash",
    "Qwen/Qwen2.5-7B-Instruct",
    "Qwen/Qwen3-Coder-30B-A3B-Instruct",
  ],
};

const nvidiaRoutes: Record<AiTask, string[]> = {
  bulk_filter: [
    "nvidia/nemotron-3-nano-30b-a3b",
    "nvidia/nemotron-3-super-120b-a12b",
  ],
  translation: [
    "nvidia/nemotron-3-nano-30b-a3b",
    "nvidia/nemotron-3-super-120b-a12b",
  ],
  classification: [
    "nvidia/nemotron-3-nano-30b-a3b",
    "nvidia/nemotron-3-super-120b-a12b",
  ],
  image_analysis: [],
  seller_analysis: [
    "nvidia/nemotron-3-super-120b-a12b",
    "nvidia/nemotron-3-nano-30b-a3b",
  ],
  complex_analysis: [
    "nvidia/nemotron-3-super-120b-a12b",
    "nvidia/nemotron-3-nano-30b-a3b",
  ],
  cross_validation: [
    "nvidia/nemotron-3-super-120b-a12b",
    "nvidia/nemotron-3-nano-30b-a3b",
  ],
  market_analysis: [
    "nvidia/nemotron-3-super-120b-a12b",
    "nvidia/nemotron-3-nano-30b-a3b",
  ],
  crawler_diagnosis: [
    "nvidia/nemotron-3-super-120b-a12b",
    "nvidia/nemotron-3-nano-30b-a3b",
  ],
  logistics_analysis: [
    "nvidia/nemotron-3-nano-30b-a3b",
    "nvidia/nemotron-3-super-120b-a12b",
  ],
  assistant_chat: [
    "nvidia/nemotron-3-nano-30b-a3b",
    "nvidia/nemotron-3-super-120b-a12b",
  ],
};

const cerebrasRoutes: Record<AiTask, string[]> = {
  bulk_filter: ["gemma-4-31b", "gpt-oss-120b"],
  translation: ["gemma-4-31b", "gpt-oss-120b"],
  classification: ["gemma-4-31b", "gpt-oss-120b"],
  image_analysis: [],
  seller_analysis: ["gpt-oss-120b", "gemma-4-31b"],
  complex_analysis: ["gpt-oss-120b", "gemma-4-31b"],
  cross_validation: ["gpt-oss-120b", "gemma-4-31b"],
  market_analysis: ["gpt-oss-120b", "gemma-4-31b"],
  crawler_diagnosis: ["gpt-oss-120b", "gemma-4-31b"],
  logistics_analysis: ["gemma-4-31b", "gpt-oss-120b"],
  assistant_chat: ["gpt-oss-120b", "gemma-4-31b"],
};

const cloudflareRoutes: Record<AiTask, string[]> = {
  bulk_filter: ["@cf/zai-org/glm-4.7-flash", "@cf/google/gemma-4-26b-a4b-it"],
  translation: ["@cf/zai-org/glm-4.7-flash", "@cf/google/gemma-4-26b-a4b-it"],
  classification: [
    "@cf/zai-org/glm-4.7-flash",
    "@cf/google/gemma-4-26b-a4b-it",
  ],
  image_analysis: ["@cf/meta/llama-3.2-11b-vision-instruct"],
  seller_analysis: [
    "@cf/nvidia/nemotron-3-120b-a12b",
    "@cf/zai-org/glm-4.7-flash",
    "@cf/openai/gpt-oss-120b",
  ],
  complex_analysis: [
    "@cf/openai/gpt-oss-120b",
    "@cf/nvidia/nemotron-3-120b-a12b",
    "@cf/zai-org/glm-4.7-flash",
  ],
  cross_validation: [
    "@cf/openai/gpt-oss-120b",
    "@cf/nvidia/nemotron-3-120b-a12b",
    "@cf/zai-org/glm-4.7-flash",
  ],
  market_analysis: [
    "@cf/nvidia/nemotron-3-120b-a12b",
    "@cf/openai/gpt-oss-120b",
    "@cf/zai-org/glm-4.7-flash",
  ],
  crawler_diagnosis: [
    "@cf/openai/gpt-oss-120b",
    "@cf/nvidia/nemotron-3-120b-a12b",
    "@cf/zai-org/glm-4.7-flash",
  ],
  logistics_analysis: [
    "@cf/zai-org/glm-4.7-flash",
    "@cf/google/gemma-4-26b-a4b-it",
    "@cf/nvidia/nemotron-3-120b-a12b",
  ],
  assistant_chat: [
    "@cf/zai-org/glm-4.7-flash",
    "@cf/nvidia/nemotron-3-120b-a12b",
    "@cf/openai/gpt-oss-120b",
  ],
};

const cohereRoutes: Record<AiTask, string[]> = {
  bulk_filter: ["command-a-plus-05-2026"],
  translation: ["command-a-translate-08-2025", "command-a-plus-05-2026"],
  classification: ["command-a-plus-05-2026"],
  image_analysis: ["command-a-plus-05-2026"],
  seller_analysis: ["command-a-plus-05-2026", "command-a-reasoning-08-2025"],
  complex_analysis: ["command-a-reasoning-08-2025", "command-a-plus-05-2026"],
  cross_validation: ["command-a-reasoning-08-2025", "command-a-plus-05-2026"],
  market_analysis: ["command-a-reasoning-08-2025", "command-a-plus-05-2026"],
  crawler_diagnosis: ["command-a-reasoning-08-2025", "command-a-plus-05-2026"],
  logistics_analysis: ["command-a-plus-05-2026"],
  assistant_chat: ["command-a-plus-05-2026", "command-a-reasoning-08-2025"],
};

const senseNovaRoutes: Record<AiTask, string[]> = {
  bulk_filter: ["SenseNova-V6-5-Turbo", "SenseChat-5"],
  translation: ["SenseNova-V6-5-Turbo", "SenseNova-V6-5-Pro", "SenseChat-5"],
  classification: ["SenseNova-V6-5-Turbo", "SenseChat-5"],
  image_analysis: ["SenseNova-V6-5-Pro", "SenseNova-V6-5-Turbo"],
  seller_analysis: ["SenseNova-V6-5-Pro", "SenseNova-V6-5-Turbo"],
  complex_analysis: ["SenseNova-V6-5-Pro", "SenseNova-V6-5-Turbo"],
  cross_validation: ["SenseNova-V6-5-Pro", "SenseNova-V6-5-Turbo"],
  market_analysis: ["SenseNova-V6-5-Pro", "SenseNova-V6-5-Turbo"],
  crawler_diagnosis: ["SenseNova-V6-5-Pro", "SenseNova-V6-5-Turbo"],
  logistics_analysis: ["SenseNova-V6-5-Turbo", "SenseNova-V6-5-Pro"],
  assistant_chat: ["SenseNova-V6-5-Pro", "SenseNova-V6-5-Turbo"],
};

const defaultRoutes: Record<AiProvider, Record<AiTask, string[]>> = {
  bai: baiRoutes,
  openrouter: openRouterRoutes,
  gemini: geminiRoutes,
  groq: groqRoutes,
  siliconflow: siliconFlowRoutes,
  cerebras: cerebrasRoutes,
  cloudflare: cloudflareRoutes,
  cohere: cohereRoutes,
  nvidia: nvidiaRoutes,
  sensenova: senseNovaRoutes,
};

export const modelRoleLabels = Object.fromEntries(
  AI_MODELS.map((entry) => [
    modelStateKey(entry.provider, entry.id),
    entry.role,
  ]),
) as Record<string, string>;

function envKey(task: AiTask, provider: AiProvider) {
  return provider === "bai"
    ? `AI_ROUTE_${task.toUpperCase()}`
    : `AI_ROUTE_${provider.toUpperCase()}_${task.toUpperCase()}`;
}

export function routeFor(task: AiTask) {
  return routeForProvider(task, "bai");
}

export function routeForProvider(task: AiTask, provider: AiProvider) {
  const configured = process.env[envKey(task, provider)]
    ?.split("|")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowlist = PROVIDER_MODEL_ALLOWLIST[provider];
  const source = configured?.length
    ? configured
    : defaultRoutes[provider][task];
  return source.filter(
    (modelId, index, values) =>
      values.indexOf(modelId) === index &&
      allowlist.has(modelId) &&
      !(
        process.env.AI_ALLOW_PAID_MODELS === "false" &&
        modelDefinition(provider, modelId)?.costTier === "paid"
      ),
  );
}

export function providerOrder(task?: AiTask): AiProvider[] {
  const taskValue = task
    ? process.env[`AI_PROVIDER_ORDER_${task.toUpperCase()}`]
    : undefined;
  const configured = (taskValue ?? process.env.AI_PROVIDER_ORDER)
    ?.split("|")
    .map((provider) => provider.trim().toLowerCase())
    .filter(isAiProvider);
  const order = configured?.length ? configured : [...AI_PROVIDER_IDS];
  return [...new Set(order)];
}

export type AiRouteCandidate = {
  provider: AiProvider;
  model: string;
  costTier: "free" | "promotion" | "unknown" | "paid";
};

function interleave(
  routes: Map<AiProvider, AiRouteCandidate[]>,
  order: AiProvider[],
) {
  const result: AiRouteCandidate[] = [];
  const maximum = Math.max(
    0,
    ...[...routes.values()].map((route) => route.length),
  );
  for (let index = 0; index < maximum; index += 1) {
    for (const provider of order) {
      const candidate = routes.get(provider)?.[index];
      if (candidate) result.push(candidate);
    }
  }
  return result;
}

export function candidatesForTask(
  task: AiTask,
  providers: readonly AiProvider[],
  options: {
    costPolicy: AiCostPolicy;
    requiresVision: boolean;
    rotationSeed?: string;
    costTierFor?: (
      provider: AiProvider,
      model: string,
    ) => AiRouteCandidate["costTier"];
  },
) {
  const preferredOrder = providerOrder(task).filter((provider) =>
    providers.includes(provider),
  );
  const order = rotateProviderOrder(preferredOrder, options.rotationSeed);
  const routes = new Map<AiProvider, AiRouteCandidate[]>();
  for (const provider of order) {
    const candidates = routeForProvider(task, provider).flatMap((modelId) => {
      const definition = modelDefinition(provider, modelId);
      if (!definition) return [];
      if (options.requiresVision && !modelAcceptsImages(provider, modelId))
        return [];
      const costTier =
        options.costTierFor?.(provider, modelId) ?? definition.costTier;
      if (
        options.costPolicy === "free_only" &&
        costTier !== "free" &&
        costTier !== "promotion"
      )
        return [];
      return [{ provider, model: modelId, costTier }];
    });
    routes.set(provider, candidates);
  }
  if (options.costPolicy !== "free_first") return interleave(routes, order);
  const tiers: AiRouteCandidate["costTier"][] = [
    "free",
    "promotion",
    "unknown",
    "paid",
  ];
  return tiers.flatMap((tier) => {
    const tierRoutes = new Map<AiProvider, AiRouteCandidate[]>();
    for (const provider of order) {
      tierRoutes.set(
        provider,
        (routes.get(provider) ?? []).filter((entry) => entry.costTier === tier),
      );
    }
    const candidates = interleave(tierRoutes, order);
    return tier === "paid"
      ? [
          ...candidates.filter((entry) => entry.provider !== "openrouter"),
          ...candidates.filter((entry) => entry.provider === "openrouter"),
        ]
      : candidates;
  });
}

function rotateProviderOrder(order: AiProvider[], seed?: string) {
  if (!seed || order.length < 2) return order;
  const numericSeed = Number.parseInt(seed.slice(0, 8), 16);
  if (!Number.isFinite(numericSeed)) return order;
  // Earlier task preferences retain more weight, while stable rotation shares
  // traffic across every eligible provider for different inputs.
  const totalWeight = (order.length * (order.length + 1)) / 2;
  let slot = numericSeed % totalWeight;
  let chosenIndex = 0;
  for (let index = 0; index < order.length; index += 1) {
    const weight = order.length - index;
    if (slot < weight) {
      chosenIndex = index;
      break;
    }
    slot -= weight;
  }
  return [...order.slice(chosenIndex), ...order.slice(0, chosenIndex)];
}

export function allConfiguredModels() {
  return [
    ...new Set(
      AI_PROVIDER_IDS.flatMap((provider) =>
        (Object.keys(defaultRoutes[provider]) as AiTask[]).flatMap((task) =>
          routeForProvider(task, provider),
        ),
      ),
    ),
  ];
}

export function allConfiguredModelRefs() {
  return AI_PROVIDER_IDS.flatMap((provider) =>
    [
      ...new Set(
        (Object.keys(defaultRoutes[provider]) as AiTask[]).flatMap((task) =>
          routeForProvider(task, provider),
        ),
      ),
    ].map((model) => ({
      provider,
      model,
      stateKey: modelStateKey(provider, model),
    })),
  );
}

export function routesForDisplay() {
  return Object.fromEntries(
    (Object.keys(baiRoutes) as AiTask[]).map((task) => [task, routeFor(task)]),
  ) as Record<AiTask, string[]>;
}

export function providerRoutesForDisplay() {
  return Object.fromEntries(
    AI_PROVIDER_IDS.map((provider) => [
      provider,
      Object.fromEntries(
        (Object.keys(defaultRoutes[provider]) as AiTask[]).map((task) => [
          task,
          routeForProvider(task, provider),
        ]),
      ),
    ]),
  ) as Record<AiProvider, Record<AiTask, string[]>>;
}
