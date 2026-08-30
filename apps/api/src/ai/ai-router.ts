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

export const AI_ROUTE_REVISION = "bai-brain-20260830-v1";

export const AI_MODEL_ALLOWLIST = new Set([
  "mimo-v2.5",
  "glm-5.3-flash",
  "deepseek-v4-flash-vision-exp",
  "qwen3.8-flash",
  "deepseek-v4-flash",
  "hy3",
]);

const defaultRoutes: Record<AiTask, string[]> = {
  bulk_filter: ["mimo-v2.5", "deepseek-v4-flash", "glm-5.3-flash"],
  translation: ["mimo-v2.5", "deepseek-v4-flash", "glm-5.3-flash"],
  classification: ["mimo-v2.5", "deepseek-v4-flash", "glm-5.3-flash"],
  image_analysis: [
    "deepseek-v4-flash-vision-exp",
    "mimo-v2.5",
    "glm-5.3-flash",
  ],
  seller_analysis: ["mimo-v2.5", "deepseek-v4-flash", "glm-5.3-flash"],
  complex_analysis: ["glm-5.3-flash", "qwen3.8-flash", "mimo-v2.5"],
  cross_validation: ["glm-5.3-flash", "qwen3.8-flash", "mimo-v2.5"],
  market_analysis: ["glm-5.3-flash", "qwen3.8-flash", "mimo-v2.5"],
  crawler_diagnosis: ["hy3", "glm-5.3-flash", "qwen3.8-flash"],
  logistics_analysis: ["mimo-v2.5", "glm-5.3-flash", "deepseek-v4-flash"],
  assistant_chat: ["glm-5.3-flash", "qwen3.8-flash", "mimo-v2.5"],
};

export const modelRoleLabels: Record<string, string> = {
  "mimo-v2.5": "商品流水线主模型",
  "glm-5.3-flash": "中央智能大脑",
  "deepseek-v4-flash-vision-exp": "商品视觉专家",
  "qwen3.8-flash": "中央智能大脑备用",
  "deepseek-v4-flash": "文本任务备用",
  hy3: "系统诊断专家",
};

function envKey(task: AiTask) {
  return `AI_ROUTE_${task.toUpperCase()}`;
}

export function routeFor(task: AiTask) {
  const configured = process.env[envKey(task)]
    ?.split("|")
    .map((model) => model.trim())
    .filter(Boolean);
  const approvedConfigured = configured?.filter((model) =>
    AI_MODEL_ALLOWLIST.has(model),
  );
  const route = configured?.length
    ? (approvedConfigured ?? [])
    : defaultRoutes[task];
  return route.filter(
    (model, index, values) =>
      values.indexOf(model) === index && AI_MODEL_ALLOWLIST.has(model),
  );
}

export function allConfiguredModels() {
  return [
    ...new Set(
      Object.keys(defaultRoutes).flatMap((task) => routeFor(task as AiTask)),
    ),
  ];
}

export function routesForDisplay() {
  return Object.fromEntries(
    (Object.keys(defaultRoutes) as AiTask[]).map((task) => [
      task,
      routeFor(task),
    ]),
  ) as Record<AiTask, string[]>;
}
