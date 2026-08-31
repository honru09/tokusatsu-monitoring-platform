export const AI_PROVIDER_IDS = [
  "bai",
  "gemini",
  "groq",
  "siliconflow",
  "cerebras",
  "cloudflare",
  "cohere",
  "nvidia",
  "sensenova",
  "openrouter",
] as const;

export type AiProvider = (typeof AI_PROVIDER_IDS)[number];
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

function model(
  provider: AiProvider,
  id: string,
  role: string,
  costTier: AiModelCostTier = "unknown",
  inputModalities: readonly AiInputModality[] = ["text"],
  pricingVerifiedAt?: string,
): AiModelDefinition {
  return { provider, id, role, costTier, inputModalities, pricingVerifiedAt };
}

/** Curated model metadata; live provider catalogues still gate availability. */
export const AI_MODELS: readonly AiModelDefinition[] = [
  model(
    "bai",
    "mimo-v2.5",
    "商品流水线主模型",
    "promotion",
    ["text", "image"],
    "2026-08-31T13:08:00+09:00",
  ),
  model(
    "bai",
    "glm-5.3-flash",
    "中央智能大脑",
    "promotion",
    ["text", "image"],
    "2026-08-31T13:08:00+09:00",
  ),
  model(
    "bai",
    "deepseek-v4-flash-vision-exp",
    "商品视觉专家",
    "promotion",
    ["text", "image"],
    "2026-08-31T13:08:00+09:00",
  ),
  model(
    "bai",
    "qwen3.8-flash",
    "中央智能大脑备用",
    "promotion",
    ["text", "image"],
    "2026-08-31T13:08:00+09:00",
  ),
  model(
    "bai",
    "deepseek-v4-flash",
    "文本任务备用",
    "promotion",
    ["text"],
    "2026-08-31T13:08:00+09:00",
  ),
  model(
    "bai",
    "hy3",
    "系统诊断专家",
    "promotion",
    ["text"],
    "2026-08-31T13:08:00+09:00",
  ),

  model("openrouter", "deepseek/deepseek-v4-flash", "商品初筛员", "paid"),
  model(
    "openrouter",
    "deepseek/deepseek-v4-flash-vision-exp",
    "商品视觉备用",
    "paid",
    ["text", "image"],
  ),
  model("openrouter", "z-ai/glm-5.2:free", "翻译与数据管理员", "free"),
  model("openrouter", "minimax/minimax-m3:free", "商品图文总管理员", "free"),
  model(
    "openrouter",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "高级分析师",
    "free",
  ),
  model("openrouter", "qwen/qwen3-coder", "系统诊断技术员", "paid"),

  model("gemini", "gemini-3.5-flash-lite", "高速翻译与分类"),
  model("gemini", "gemini-flash-lite-latest", "高速通用备用"),
  model("gemini", "gemini-3.7-flash", "多模态分析专家", "unknown", [
    "text",
    "image",
  ]),

  model("groq", "openai/gpt-oss-20b", "低延迟文本专家"),
  model("groq", "openai/gpt-oss-120b", "复杂分析专家"),
  model("groq", "qwen/qwen3.8-27b", "低延迟视觉备用", "unknown", [
    "text",
    "image",
  ]),
  model("groq", "groq/compound", "联网分析专家"),

  model("siliconflow", "tencent/Hunyuan-MT-7B", "日中翻译专家"),
  model("siliconflow", "Qwen/Qwen2.5-7B-Instruct", "轻量数据处理"),
  model("siliconflow", "Qwen/Qwen3-VL-8B-Instruct", "视觉理解备用", "paid", [
    "text",
    "image",
  ]),
  model(
    "siliconflow",
    "deepseek-ai/DeepSeek-V4-Flash",
    "中文复杂分析备用",
    "paid",
  ),
  model(
    "siliconflow",
    "Qwen/Qwen3-Coder-30B-A3B-Instruct",
    "系统诊断备用",
    "paid",
  ),

  model("cerebras", "gpt-oss-120b", "高速复杂文本分析"),
  model("cerebras", "gemma-4-31b", "高速通用文本处理"),

  model("cloudflare", "@cf/zai-org/glm-4.7-flash", "中文与翻译主力"),
  model("cloudflare", "@cf/google/gemma-4-26b-a4b-it", "轻量通用处理"),
  model("cloudflare", "@cf/nvidia/nemotron-3-120b-a12b", "复杂推理备用"),
  model("cloudflare", "@cf/openai/gpt-oss-120b", "系统分析备用"),
  model(
    "cloudflare",
    "@cf/meta/llama-3.2-11b-vision-instruct",
    "商品视觉备用",
    "unknown",
    ["text", "image"],
  ),

  model("cohere", "command-a-plus-05-2026", "多语言图文分析", "unknown", [
    "text",
    "image",
  ]),
  model("cohere", "command-a-translate-08-2025", "专业日中翻译"),
  model("cohere", "command-a-reasoning-08-2025", "复杂推理分析"),

  model("nvidia", "nvidia/nemotron-3-nano-30b-a3b", "高速通用分析"),
  model("nvidia", "nvidia/nemotron-3-super-120b-a12b", "高级推理分析"),
  model("nvidia", "nvidia/riva-translate-4b-instruct-v2", "专业翻译备用"),

  model(
    "sensenova",
    "sensenova-6.8-flash-lite",
    "高速中文翻译与文本分析",
    "unknown",
    ["text"],
  ),
];

export const MODEL_DEFINITIONS_BY_PROVIDER = Object.fromEntries(
  AI_PROVIDER_IDS.map((provider) => [
    provider,
    AI_MODELS.filter((entry) => entry.provider === provider),
  ]),
) as Record<AiProvider, AiModelDefinition[]>;

export const PROVIDER_MODEL_ALLOWLIST = Object.fromEntries(
  AI_PROVIDER_IDS.map((provider) => [
    provider,
    new Set(MODEL_DEFINITIONS_BY_PROVIDER[provider].map((entry) => entry.id)),
  ]),
) as Record<AiProvider, Set<string>>;

export function isAiProvider(value: string): value is AiProvider {
  return (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

export function modelDefinition(provider: AiProvider, modelId: string) {
  return MODEL_DEFINITIONS_BY_PROVIDER[provider].find(
    (entry) => entry.id === modelId,
  );
}

export function modelStateKey(provider: AiProvider, modelId: string) {
  return `${provider}:${modelId}`;
}

export function parseModelStateKey(value: string): {
  provider?: AiProvider;
  model: string;
} {
  const separator = value.indexOf(":");
  if (separator <= 0) return { model: value };
  const possibleProvider = value.slice(0, separator);
  if (!isAiProvider(possibleProvider)) return { model: value };
  return { provider: possibleProvider, model: value.slice(separator + 1) };
}

export function providerForModel(
  value: string,
  providerHint?: AiProvider,
): AiProvider {
  if (providerHint) return providerHint;
  const parsed = parseModelStateKey(value);
  if (parsed.provider) return parsed.provider;
  return (
    AI_PROVIDER_IDS.find((provider) =>
      PROVIDER_MODEL_ALLOWLIST[provider].has(parsed.model),
    ) ?? "bai"
  );
}

export function modelRole(
  provider: AiProvider,
  modelId: string,
  fallback: string,
) {
  return modelDefinition(provider, modelId)?.role ?? fallback;
}

export function modelAcceptsImages(provider: AiProvider, modelId: string) {
  return Boolean(
    modelDefinition(provider, modelId)?.inputModalities.includes("image"),
  );
}

export function modelIsFree(provider: AiProvider, modelId: string) {
  const tier = modelDefinition(provider, modelId)?.costTier;
  return tier === "free" || tier === "promotion";
}
