import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@tokusatsu/db";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma.service.js";
import {
  AI_ROUTE_REVISION,
  type AiTask,
  modelRoleLabels,
  routeFor,
} from "./ai-router.js";

export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiGatewayRequest = {
  task: AiTask;
  messages: AiMessage[];
  maxTokens: number;
  temperature?: number;
  imageUrls?: string[];
  itemId?: string;
  sellerId?: string;
  cacheTtlMs?: number;
  bypassCache?: boolean;
};

export type AiGatewayResult<T> = {
  data: T;
  model: string;
  requestedModel: string;
  runId: string;
  cached: boolean;
  fallbackUsed: boolean;
  confidence: number | null;
};

type BaiChatPayload = {
  model?: string;
  provider?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

class ModelCallError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ModelCallError";
  }
}

function cleanJson(content: string) {
  const stripped = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  return start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped;
}

function confidenceOf(value: Record<string, unknown>) {
  const confidence = Number(value.confidence);
  return Number.isFinite(confidence)
    ? Math.max(0, Math.min(1, confidence))
    : null;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

@Injectable()
export class AiGatewayService {
  private catalogue?: { expiresAt: number; models: Set<string> };

  constructor(private readonly prisma: PrismaService) {}

  configured() {
    return Boolean(process.env.BAI_API_KEY?.trim());
  }

  async executeJson<T extends Record<string, unknown>>(
    request: AiGatewayRequest,
  ): Promise<AiGatewayResult<T>> {
    const apiKey = process.env.BAI_API_KEY?.trim();
    if (!apiKey)
      throw new ServiceUnavailableException({
        code: "AI_GATEWAY_NOT_CONFIGURED",
        message: "B.AI API 尚未配置",
      });
    const input = {
      messages: request.messages,
      imageUrls: request.imageUrls ?? [],
      maxTokens: request.maxTokens,
      temperature: request.temperature ?? 0.1,
    };
    const inputHash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const cacheKey = createHash("sha256")
      .update(`${request.task}:${inputHash}:${AI_ROUTE_REVISION}`)
      .digest("hex");
    if (!request.bypassCache) {
      const cached = await this.prisma.aiCache.findUnique({
        where: { key: cacheKey },
      });
      if (cached && cached.expiresAt > new Date()) {
        const run = await this.prisma.aiRun.create({
          data: {
            itemId: request.itemId,
            sellerId: request.sellerId,
            task: request.task,
            provider: "bai",
            requestedModel: cached.model,
            actualModel: cached.model,
            status: "cached",
            inputHash,
            input: input as Prisma.InputJsonValue,
            output: cached.output as Prisma.InputJsonValue,
            confidence: cached.confidence,
            completedAt: new Date(),
          },
        });
        return {
          data: cached.output as T,
          model: cached.model,
          requestedModel: cached.model,
          runId: run.id,
          cached: true,
          fallbackUsed: false,
          confidence: cached.confidence,
        };
      }
    }

    const route = routeFor(request.task);
    const catalogue = await this.availableModelIds();
    const errors: Array<{ model: string; code: string }> = [];
    for (const [index, requestedModel] of route.entries()) {
      if (catalogue && !catalogue.has(requestedModel)) {
        errors.push({ model: requestedModel, code: "MODEL_NOT_AVAILABLE" });
        await Promise.all([
          this.prisma.aiRun.create({
            data: {
              itemId: request.itemId,
              sellerId: request.sellerId,
              task: request.task,
              provider: "bai",
              requestedModel,
              status: "failed",
              inputHash,
              input: input as Prisma.InputJsonValue,
              fallbackUsed: index > 0,
              attempt: index + 1,
              latencyMs: 0,
              errorCode: "MODEL_NOT_AVAILABLE",
              errorMessage: "模型当前不在 B.AI 当前账号目录中",
              completedAt: new Date(),
            },
          }),
          this.updateModelFailure(
            requestedModel,
            request.task,
            "MODEL_NOT_AVAILABLE",
            "unavailable",
          ),
        ]);
        continue;
      }

      const cooldown = await this.modelCooldown(requestedModel);
      if (cooldown) {
        errors.push({ model: requestedModel, code: "MODEL_COOLDOWN" });
        continue;
      }

      const run = await this.prisma.aiRun.create({
        data: {
          itemId: request.itemId,
          sellerId: request.sellerId,
          task: request.task,
          provider: "bai",
          requestedModel,
          status: "running",
          inputHash,
          input: input as Prisma.InputJsonValue,
          fallbackUsed: index > 0,
          attempt: index + 1,
        },
      });
      const startedAt = Date.now();
      try {
        const response = await this.callModel(apiKey, requestedModel, request);
        const content = response.choices?.[0]?.message?.content?.trim();
        if (!content)
          throw new ModelCallError("模型返回为空", "EMPTY_RESPONSE", true);
        let data: T;
        try {
          const parsed = JSON.parse(cleanJson(content)) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error("JSON root must be an object");
          data = parsed as T;
        } catch {
          throw new ModelCallError(
            "模型返回的 JSON 无法解析",
            "INVALID_JSON",
            true,
          );
        }
        const actualModel = response.model?.trim() || requestedModel;
        const confidence = confidenceOf(data);
        const completedAt = new Date();
        await Promise.all([
          this.prisma.aiRun.update({
            where: { id: run.id },
            data: {
              actualModel,
              status: "succeeded",
              output: data as Prisma.InputJsonValue,
              confidence,
              latencyMs: Date.now() - startedAt,
              inputTokens: response.usage?.prompt_tokens,
              outputTokens: response.usage?.completion_tokens,
              completedAt,
            },
          }),
          this.updateModelSuccess(actualModel, request.task),
          this.prisma.aiCache.upsert({
            where: { key: cacheKey },
            update: {
              model: actualModel,
              output: data as Prisma.InputJsonValue,
              confidence,
              expiresAt: new Date(
                Date.now() +
                  (request.cacheTtlMs ?? this.defaultCacheTtl(request.task)),
              ),
            },
            create: {
              key: cacheKey,
              task: request.task,
              inputHash,
              routeRevision: AI_ROUTE_REVISION,
              model: actualModel,
              output: data as Prisma.InputJsonValue,
              confidence,
              expiresAt: new Date(
                Date.now() +
                  (request.cacheTtlMs ?? this.defaultCacheTtl(request.task)),
              ),
            },
          }),
        ]);
        return {
          data,
          model: actualModel,
          requestedModel,
          runId: run.id,
          cached: false,
          fallbackUsed: index > 0,
          confidence,
        };
      } catch (error) {
        const normalized = this.normalizeError(error);
        errors.push({ model: requestedModel, code: normalized.code });
        await Promise.all([
          this.prisma.aiRun.update({
            where: { id: run.id },
            data: {
              status: "failed",
              latencyMs: Date.now() - startedAt,
              errorCode: normalized.code,
              errorMessage: normalized.message.slice(0, 500),
              completedAt: new Date(),
            },
          }),
          this.updateModelFailure(
            requestedModel,
            request.task,
            normalized.code,
            normalized.code === "MODEL_NOT_AVAILABLE"
              ? "unavailable"
              : "degraded",
          ),
        ]);
      }
    }
    throw new ServiceUnavailableException({
      code: "AI_GATEWAY_UNAVAILABLE",
      message: "当前 B.AI 模型路由均不可用，任务已保留等待后续重试",
      attempts: errors,
    });
  }

  async availableModelIds(force = false) {
    if (!force && this.catalogue && this.catalogue.expiresAt > Date.now())
      return this.catalogue.models;
    try {
      const apiUrl = (
        process.env.BAI_API_URL ?? "https://api.b.ai/v1"
      ).replace(/\/$/, "");
      const response = await fetch(`${apiUrl}/models`, {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${process.env.BAI_API_KEY?.trim() ?? ""}`,
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return undefined;
      const payload = (await response.json()) as {
        data?: Array<{ id?: unknown }>;
      };
      const models = new Set(
        (payload.data ?? []).flatMap((entry) =>
          typeof entry.id === "string" ? [entry.id] : [],
        ),
      );
      this.catalogue = { expiresAt: Date.now() + 10 * 60_000, models };
      return models;
    } catch {
      return undefined;
    }
  }

  private async callModel(
    apiKey: string,
    model: string,
    request: AiGatewayRequest,
  ) {
    const apiUrl = (
      process.env.BAI_API_URL ?? "https://api.b.ai/v1"
    ).replace(/\/$/, "");
    const messages: Array<Record<string, unknown>> = request.messages.map(
      (message) => ({ ...message }),
    );
    if (request.imageUrls?.length) {
      const lastUser = [...messages]
        .reverse()
        .find((message) => message.role === "user");
      if (lastUser) {
        const text = String(lastUser.content ?? "");
        lastUser.content = [
          { type: "text", text },
          ...request.imageUrls.map((url) => ({
            type: "image_url",
            image_url: { url },
          })),
        ];
      }
    }
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const controller = new AbortController();
      const timeoutMs = Math.max(
        20_000,
        Math.min(Number(process.env.AI_TIMEOUT_MS ?? 120_000), 240_000),
      );
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${apiUrl}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: request.maxTokens,
            temperature: request.temperature ?? 0.1,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          const code =
            response.status === 401 || response.status === 403
              ? "AUTH"
              : response.status === 402
                ? "CREDITS"
                : response.status === 404
                  ? "MODEL_NOT_AVAILABLE"
                  : response.status === 429
                    ? "RATE_LIMIT"
                    : response.status >= 500
                      ? "PROVIDER_ERROR"
                      : `HTTP_${response.status}`;
          const retryable = response.status === 429 || response.status >= 500;
          const error = new ModelCallError(
            `${code}${body ? `: ${body.slice(0, 200)}` : ""}`,
            code,
            retryable,
          );
          if (!retryable || attempt === 2) throw error;
          lastError = error;
          const retryAfter = Number(response.headers.get("retry-after"));
          await sleep(
            Number.isFinite(retryAfter)
              ? Math.max(1_000, retryAfter * 1_000)
              : 1_000 * attempt,
          );
          continue;
        }
        return (await response.json()) as BaiChatPayload;
      } catch (error) {
        const normalized = this.normalizeError(error);
        if (!normalized.retryable || attempt === 2) throw normalized;
        lastError = normalized;
        await sleep(1_000 * attempt);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError ?? new ModelCallError("未知模型错误", "UNKNOWN", false);
  }

  private normalizeError(error: unknown) {
    if (error instanceof ModelCallError) return error;
    if (error instanceof Error && error.name === "AbortError")
      return new ModelCallError("模型请求超时", "TIMEOUT", true);
    const message = error instanceof Error ? error.message : String(error);
    return new ModelCallError(message, "NETWORK", true);
  }

  private async updateModelSuccess(model: string, task: AiTask) {
    await this.prisma.aiModelState.upsert({
      where: { model },
      update: {
        provider: "bai",
        role: modelRoleLabels[model] ?? task,
        configured: true,
        status: "online",
        consecutiveFailures: 0,
        lastSuccessAt: new Date(),
        lastErrorCode: null,
        lastCheckedAt: new Date(),
      },
      create: {
        model,
        provider: "bai",
        role: modelRoleLabels[model] ?? task,
        configured: true,
        status: "online",
        lastSuccessAt: new Date(),
      },
    });
  }

  private async modelCooldown(model: string) {
    const state = await this.prisma.aiModelState.findUnique({
      where: { model },
      select: { lastFailureAt: true, lastErrorCode: true },
    });
    if (!state?.lastFailureAt || !state.lastErrorCode) return false;
    const cooldownMs =
      state.lastErrorCode === "MODEL_NOT_AVAILABLE"
        ? 24 * 60 * 60_000
        : state.lastErrorCode === "RATE_LIMIT"
        ? 5 * 60_000
        : state.lastErrorCode === "AUTH" || state.lastErrorCode === "CREDITS"
          ? 30 * 60_000
          : state.lastErrorCode === "PROVIDER_ERROR" ||
              state.lastErrorCode === "NETWORK" ||
              state.lastErrorCode === "TIMEOUT"
            ? 60_000
            : 0;
    return (
      cooldownMs > 0 && Date.now() - state.lastFailureAt.getTime() < cooldownMs
    );
  }

  private async updateModelFailure(
    model: string,
    task: AiTask,
    code: string,
    status: "degraded" | "unavailable",
  ) {
    const current = await this.prisma.aiModelState.findUnique({
      where: { model },
      select: { consecutiveFailures: true },
    });
    await this.prisma.aiModelState.upsert({
      where: { model },
      update: {
        provider: "bai",
        role: modelRoleLabels[model] ?? task,
        configured: true,
        status,
        consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
        lastFailureAt: new Date(),
        lastErrorCode: code,
        lastCheckedAt: new Date(),
      },
      create: {
        model,
        provider: "bai",
        role: modelRoleLabels[model] ?? task,
        configured: true,
        status,
        consecutiveFailures: 1,
        lastFailureAt: new Date(),
        lastErrorCode: code,
      },
    });
  }

  private defaultCacheTtl(task: AiTask) {
    if (task === "market_analysis" || task === "crawler_diagnosis")
      return 60 * 60_000;
    if (task === "seller_analysis") return 6 * 60 * 60_000;
    return 30 * 24 * 60 * 60_000;
  }
}
