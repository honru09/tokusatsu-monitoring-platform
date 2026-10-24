import { ServiceUnavailableException, BadRequestException } from "@nestjs/common";
import { AI_EXTENDED_TASKS, AI_PRODUCT_READING_TASKS, ZHIPU_GIFT_ALLOWED_USES, ZHIPU_GIFT_DAILY_TOKEN_LIMIT, ZHIPU_GIFT_EXPIRES_AT, ZHIPU_GIFT_GROUP, ZHIPU_GIFT_TOKEN_LIMIT, ZHIPU_MAX_IMAGES_PER_REQUEST, ZHIPU_MODEL, extendedAiScopesEnabled, type AiTask } from "./ai-config.js";
export { extendedAiScopesEnabled };
export type AiPurpose = "product_reading" | "translation" | "assistant_chat";
export function assertAiScope(task: AiTask, purpose?: AiPurpose) {
  if (task === "translation" || task === "assistant_chat") return;
  if (purpose === "product_reading" && (AI_PRODUCT_READING_TASKS as readonly string[]).includes(task)) return;
  if (extendedAiScopesEnabled() && (AI_EXTENDED_TASKS as readonly string[]).includes(task)) return;
  throw new ServiceUnavailableException({ code: "AI_SCOPE_DISABLED", message: "当前 AI 仅用于商品读取、翻译和聊天", retryable: false });
}
export function zhipuResourcePolicy() {
  const bounded = (name: string, fallback: number, ceiling: number) => {
    const value = Number(process.env[name] ?? fallback);
    return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), ceiling) : 0;
  };
  const resourceExpiry = Date.parse(ZHIPU_GIFT_EXPIRES_AT);
  const configuredExpiry = Date.parse(process.env.ZHIPU_FREE_RESOURCE_EXPIRES_AT ?? ZHIPU_GIFT_EXPIRES_AT);
  return {
    group: ZHIPU_GIFT_GROUP,
    tokenLimit: bounded("ZHIPU_FREE_TOKEN_LIMIT", ZHIPU_GIFT_TOKEN_LIMIT, ZHIPU_GIFT_TOKEN_LIMIT),
    dailyTokenLimit: bounded("ZHIPU_DAILY_TOKEN_LIMIT", ZHIPU_GIFT_DAILY_TOKEN_LIMIT, ZHIPU_GIFT_DAILY_TOKEN_LIMIT),
    expiresAt: new Date(Number.isFinite(configuredExpiry) ? Math.min(configuredExpiry, resourceExpiry) : 0),
    model: ZHIPU_MODEL, allowedUses: [...ZHIPU_GIFT_ALLOWED_USES],
    accounting: "local_reservation", paidFallback: false, backgroundAi: false,
  };
}
export function normalizeScopedRequest<T extends { task: AiTask; messages: { role: "system" | "user" | "assistant"; content: string }[]; maxTokens: number; imageUrls?: string[]; purpose?: AiPurpose }>(request: T): T {
  assertAiScope(request.task, request.purpose);
  if ((request.imageUrls?.length ?? 0) > ZHIPU_MAX_IMAGES_PER_REQUEST) throw new BadRequestException("一次最多读取两张商品图片");
  const contextChars = request.messages.reduce((n, m) => n + m.content.length, 0);
  if (request.messages.length > 24 || contextChars > 60_000)
    throw new BadRequestException("上下文过长，请缩短问题或重新开启聊天");
  // Small translation batches (a title plus a few short fields) cannot produce
  // anywhere near 4k output tokens; the full floor is kept for large batches.
  const translationFloor = contextChars <= 2000 ? 1024 : 4096;
  const floor = request.task === "translation" ? translationFloor : request.task === "assistant_chat" ? 4096 : 6144;
  const maxTokens = Math.min(8192, Math.max(floor, Number.isFinite(request.maxTokens) ? request.maxTokens : floor));
  const messages = request.messages.map(m => ({ ...m, content: m.content.replace(/\b[a-f\d]{32}\.[A-Za-z\d]{16,}\b/gi, "[已隐藏密钥]") }));
  return { ...request, messages, maxTokens };
}
// Per-image reservation, charged only until the provider's real usage lands
// (the gateway overwrites the reservation on success). The old 65,536 figure
// was far above this model's actual per-image cost: two images alone reserved
// ~131k of the 200k daily budget. 8,192 is a calibrated estimate that still
// stays above the real cost of a typical product photo; override with
// ZHIPU_IMAGE_RESERVATION_TOKENS when measured usage says otherwise.
export function imageReservationTokens() {
  const value = Number(process.env.ZHIPU_IMAGE_RESERVATION_TOKENS ?? 8192);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 65_536) : 8192;
}
export function conservativeTokenReservation(messages: { content: string }[], maxTokens: number, imageCount: number) {
  // Keep a pessimistic charge on timeout/restart. No automatic replay or refund.
  return Buffer.byteLength(JSON.stringify(messages), "utf8") + maxTokens + 1024 + imageCount * imageReservationTokens();
}
