import { ServiceUnavailableException, BadRequestException } from "@nestjs/common";
import type { AiTask } from "./ai-router.js";
export type AiPurpose = "product_reading" | "translation" | "assistant_chat";
export function assertAiScope(task: AiTask, purpose?: AiPurpose) {
  if (task === "translation" || task === "assistant_chat") return;
  if (purpose === "product_reading" && ["complex_analysis", "image_analysis", "classification"].includes(task)) return;
  throw new ServiceUnavailableException({ code: "AI_SCOPE_DISABLED", message: "当前 AI 仅用于商品读取、翻译和聊天", retryable: false });
}
export function zhipuResourcePolicy() {
  const bounded = (name: string, fallback: number, ceiling: number) => {
    const value = Number(process.env[name] ?? fallback);
    return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), ceiling) : 0;
  };
  const resourceExpiry = Date.parse("2026-11-09T14:35:56+08:00");
  const configuredExpiry = Date.parse(process.env.ZHIPU_FREE_RESOURCE_EXPIRES_AT ?? "2026-11-09T14:35:56+08:00");
  return {
    group: "zhipu-gift-20261009",
    tokenLimit: bounded("ZHIPU_FREE_TOKEN_LIMIT", 14_000_000, 14_000_000),
    dailyTokenLimit: bounded("ZHIPU_DAILY_TOKEN_LIMIT", 200_000, 200_000),
    expiresAt: new Date(Number.isFinite(configuredExpiry) ? Math.min(configuredExpiry, resourceExpiry) : 0),
    model: "glm-5.3-flash", allowedUses: ["商品读取", "商品翻译", "AI 聊天"],
    accounting: "local_reservation", paidFallback: false, backgroundAi: false,
  };
}
export function normalizeScopedRequest<T extends { task: AiTask; messages: { role: "system" | "user" | "assistant"; content: string }[]; maxTokens: number; imageUrls?: string[]; purpose?: AiPurpose }>(request: T): T {
  assertAiScope(request.task, request.purpose);
  if ((request.imageUrls?.length ?? 0) > 2) throw new BadRequestException("一次最多读取两张商品图片");
  if (request.messages.length > 24 || request.messages.reduce((n, m) => n + m.content.length, 0) > 60_000)
    throw new BadRequestException("上下文过长，请缩短问题或重新开启聊天");
  const floor = request.task === "translation" ? 4096 : request.task === "assistant_chat" ? 4096 : 6144;
  const maxTokens = Math.min(8192, Math.max(floor, Number.isFinite(request.maxTokens) ? request.maxTokens : floor));
  const messages = request.messages.map(m => ({ ...m, content: m.content.replace(/\b[a-f\d]{32}\.[A-Za-z\d]{16,}\b/gi, "[已隐藏密钥]") }));
  return { ...request, messages, maxTokens };
}
export function conservativeTokenReservation(messages: { content: string }[], maxTokens: number, imageCount: number) {
  // Keep a pessimistic charge on timeout/restart. No automatic replay or refund.
  return Buffer.byteLength(JSON.stringify(messages), "utf8") + maxTokens + 1024 + imageCount * 65_536;
}
