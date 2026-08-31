import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@tokusatsu/db";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma.service.js";
import {
  AI_ROUTE_REVISION,
  PROVIDER_MODEL_ALLOWLIST,
  candidatesForTask,
  isAiProvider,
  modelRole,
  modelStateKey,
  providerOrder,
  type AiCostPolicy,
  type AiDataClass,
  type AiProvider,
  type AiTask,
} from "./ai-router.js";
import {
  configuredProviderRuntimes,
  providerConfigurationStatuses,
  type ProviderRuntime,
} from "./ai-provider-registry.js";
import { verifiedBaiPromotionModels } from "./bai-promotions.js";

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
  dataClass?: AiDataClass;
  costPolicy?: AiCostPolicy;
  cacheTtlMs?: number;
  bypassCache?: boolean;
};

export type AiGatewayResult<T> = {
  data: T;
  provider: AiProvider;
  model: string;
  requestedModel: string;
  runId: string;
  cached: boolean;
  fallbackUsed: boolean;
  confidence: number | null;
};

type ChatPayload = {
  model?: string;
  provider?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    neurons?: number;
  };
};

type AttemptError = {
  provider: AiProvider;
  model: string;
  attempt: number;
  code: string;
};

type CatalogueCache = {
  expiresAt: number;
  models?: Set<string>;
};

type CredentialCooldown = {
  code: string;
  until: number;
};

type RateMetadata = {
  cooldownUntil?: Date;
  quotaResetAt?: Date;
  remainingRequests?: number;
  remainingTokens?: number;
};

class ModelCallError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly providerWide = false,
    readonly rate: RateMetadata = {},
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

function finiteInteger(value: string | null) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : undefined;
}

function finiteNonnegative(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function cloudflareErrorCode(responseText: string) {
  try {
    const payload = JSON.parse(responseText) as Record<string, unknown>;
    const error =
      payload.error && typeof payload.error === "object"
        ? (payload.error as Record<string, unknown>)
        : undefined;
    const firstError = Array.isArray(payload.errors)
      ? payload.errors.find((entry): entry is Record<string, unknown> =>
          Boolean(entry && typeof entry === "object"),
        )
      : undefined;
    const code = error?.code ?? firstError?.code;
    return typeof code === "string" || typeof code === "number"
      ? String(code)
      : undefined;
  } catch {
    return undefined;
  }
}

function firstHeader(headers: Headers, names: readonly string[]) {
  for (const name of names) {
    const value = headers.get(name);
    if (value != null) return value;
  }
  return null;
}

function durationMilliseconds(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const match = value.match(
    /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/i,
  );
  if (!match) return undefined;
  return (
    Number(match[1] ?? 0) * 3_600_000 +
    Number(match[2] ?? 0) * 60_000 +
    Number(match[3] ?? 0) * 1_000
  );
}

function isUniqueConflict(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002",
  );
}

const cloudflareNeuronRates: Record<string, { input: number; output: number }> =
  {
    "@cf/zai-org/glm-4.7-flash": { input: 5_500, output: 36_400 },
    "@cf/google/gemma-4-26b-a4b-it": { input: 9_100, output: 27_300 },
    "@cf/nvidia/nemotron-3-120b-a12b": {
      input: 45_500,
      output: 136_400,
    },
    "@cf/openai/gpt-oss-120b": { input: 31_900, output: 68_200 },
    "@cf/meta/llama-3.2-11b-vision-instruct": {
      input: 4_500,
      output: 62_000,
    },
  };

function nextUtcDay(now = new Date()) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
}

function utcDayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

@Injectable()
export class AiGatewayService {
  private readonly catalogues = new Map<AiProvider, CatalogueCache>();
  private readonly catalogueRequests = new Map<
    AiProvider,
    Promise<Set<string> | undefined>
  >();
  private readonly credentialCooldowns = new Map<string, CredentialCooldown>();
  private cloudflareReservationDay = "";
  private cloudflareReservedNeurons = 0;

  constructor(private readonly prisma: PrismaService) {}

  configured() {
    return this.providers().length > 0;
  }

  configuredProviderIds() {
    return this.providers().map((provider) => provider.id);
  }

  providerConfigurations() {
    return providerConfigurationStatuses();
  }

  async executeJson<T extends Record<string, unknown>>(
    request: AiGatewayRequest,
  ): Promise<AiGatewayResult<T>> {
    const gatewayDeadlineMs = this.gatewayDeadlineMs();
    const deadlineAt = Date.now() + gatewayDeadlineMs;
    const dataClass = request.dataClass ?? "user_private";
    const costPolicy = this.costPolicy(request.costPolicy);
    const configuredProviders = this.providers();
    if (!configuredProviders.length)
      throw new ServiceUnavailableException({
        code: "AI_GATEWAY_NOT_CONFIGURED",
        message: "AI 服务尚未配置，请添加至少一个模型服务凭证",
      });

    const privacyEligible = configuredProviders.filter((provider) =>
      provider.allowsDataClass(dataClass),
    );
    if (!privacyEligible.length)
      throw new ServiceUnavailableException({
        code: "AI_GATEWAY_DATA_POLICY_BLOCKED",
        message:
          "现有模型凭据不允许处理这类数据，请调整数据授权或改用公开商品信息",
        retryable: false,
        dataClass,
        costPolicy,
      });
    const providerReadiness = await Promise.all(
      privacyEligible.map(async (provider) => ({
        provider,
        ready: await this.providerReady(provider.id),
      })),
    );
    const providers = providerReadiness.flatMap(({ provider, ready }) =>
      ready ? [provider] : [],
    );
    if (!providers.length)
      throw new ServiceUnavailableException({
        code: "AI_GATEWAY_ALL_PROVIDERS_COOLDOWN",
        message: "AI 服务商正在额度或故障冷却中，系统会在恢复后自动继续",
        retryable: true,
        dataClass,
        costPolicy,
      });

    const input = {
      messages: request.messages,
      imageUrls: request.imageUrls ?? [],
      maxTokens: request.maxTokens,
      temperature: request.temperature ?? 0.1,
      dataClass,
      costPolicy,
    };
    const inputHash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const cacheKey = createHash("sha256")
      .update(`${request.task}:${inputHash}:${AI_ROUTE_REVISION}`)
      .digest("hex");

    if (!request.bypassCache) {
      const cachedResult = await this.cachedResult<T>(
        cacheKey,
        request,
        input,
        inputHash,
        providers,
        dataClass,
        costPolicy,
      );
      if (cachedResult) return cachedResult;
    }

    const catalogues = new Map<AiProvider, Set<string> | undefined>();
    await Promise.all(
      providers.map(async (provider) => {
        catalogues.set(
          provider.id,
          await this.availableModelIdsFor(provider, false, deadlineAt),
        );
      }),
    );

    const providerById = new Map(
      providers.map((provider) => [provider.id, provider]),
    );
    const candidates = candidatesForTask(
      request.task,
      providers.map((provider) => provider.id),
      {
        costPolicy,
        requiresVision: Boolean(request.imageUrls?.length),
        rotationSeed: inputHash,
        costTierFor: (provider, model) =>
          providerById.get(provider)?.costTierFor(model) ?? "unknown",
      },
    );
    if (!candidates.length) {
      throw new ServiceUnavailableException({
        code:
          costPolicy === "free_only"
            ? "AI_GATEWAY_NO_FREE_MODEL"
            : "AI_GATEWAY_NO_ELIGIBLE_MODEL",
        message:
          costPolicy === "free_only"
            ? "已配置的免费或促销模型目前不满足本次任务要求"
            : "当前任务或视觉能力要求下没有可用模型",
        retryable: false,
        dataClass,
        costPolicy,
      });
    }

    const errors: AttemptError[] = [];
    const disabledProviders = new Set<AiProvider>();
    const attemptedProviders = new Set<AiProvider>();
    let attempt = 0;

    for (const [candidateIndex, candidate] of candidates.entries()) {
      const provider = providerById.get(candidate.provider);
      if (!provider || disabledProviders.has(candidate.provider)) continue;
      attempt += 1;
      if (Date.now() >= deadlineAt) {
        errors.push({ ...candidate, attempt, code: "GATEWAY_DEADLINE" });
        break;
      }
      const fallbackUsed = attempt > 1;
      const catalogue = catalogues.get(provider.id);
      if (!catalogue) {
        errors.push({
          provider: provider.id,
          model: candidate.model,
          attempt,
          code: "CATALOGUE_UNAVAILABLE",
        });
        disabledProviders.add(provider.id);
        await this.recordCatalogueUnavailable(
          provider,
          candidate.model,
          request,
          input,
          inputHash,
          attempt,
          fallbackUsed,
        );
        continue;
      }
      if (!catalogue.has(candidate.model)) {
        errors.push({
          provider: provider.id,
          model: candidate.model,
          attempt,
          code: "MODEL_NOT_AVAILABLE",
        });
        await this.recordUnavailableModel(
          provider,
          candidate.model,
          request,
          input,
          inputHash,
          attempt,
          fallbackUsed,
        );
        continue;
      }
      if (await this.modelCooldown(provider.id, candidate.model)) {
        errors.push({
          provider: provider.id,
          model: candidate.model,
          attempt,
          code: "MODEL_COOLDOWN",
        });
        continue;
      }

      const untriedProviderCount = new Set(
        candidates
          .slice(candidateIndex + 1)
          .map((entry) => entry.provider)
          .filter(
            (id) =>
              id !== provider.id &&
              !attemptedProviders.has(id) &&
              !disabledProviders.has(id),
          ),
      ).size;
      attemptedProviders.add(provider.id);
      const candidateDeadlineAt = this.fairCandidateDeadline(
        deadlineAt,
        untriedProviderCount,
      );
      const attemptStartedAt = new Date();
      const run = await this.prisma.aiRun.create({
        data: {
          itemId: request.itemId,
          sellerId: request.sellerId,
          task: request.task,
          provider: provider.id,
          requestedModel: candidate.model,
          status: "running",
          inputHash,
          input: input as Prisma.InputJsonValue,
          fallbackUsed,
          attempt,
          startedAt: attemptStartedAt,
        },
      });
      const startedAt = Date.now();
      let providerBudgetReservation = 0;
      let responseProviderUsage: number | undefined;
      try {
        providerBudgetReservation = await this.reserveProviderBudget(
          provider,
          candidate.model,
          request,
        );
        const response = await this.callModel(
          provider,
          candidate.model,
          request,
          candidateDeadlineAt,
          deadlineAt,
        );
        responseProviderUsage =
          finiteNonnegative(response.usage?.neurons) ??
          (provider.id === "cloudflare" && providerBudgetReservation > 0
            ? providerBudgetReservation
            : undefined);
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

        const reportedModel = response.model?.trim();
        const normalizedReportedModel = reportedModel
          ? provider.normalizeCatalogueModelId(reportedModel)
          : undefined;
        const actualModel =
          normalizedReportedModel &&
          PROVIDER_MODEL_ALLOWLIST[provider.id].has(normalizedReportedModel)
            ? normalizedReportedModel
            : candidate.model;
        const confidence = confidenceOf(data);
        const completedAt = new Date();
        const expiresAt = new Date(
          Date.now() +
            (request.cacheTtlMs ?? this.defaultCacheTtl(request.task)),
        );
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
              providerUsage: responseProviderUsage,
              completedAt,
            },
          }),
          this.updateModelSuccess(
            provider.id,
            actualModel,
            request.task,
            attemptStartedAt,
          ),
          this.updateProviderSuccess(provider.id, attemptStartedAt),
          this.prisma.aiCache.upsert({
            where: { key: cacheKey },
            update: {
              provider: provider.id,
              model: actualModel,
              output: data as Prisma.InputJsonValue,
              confidence,
              expiresAt,
            },
            create: {
              key: cacheKey,
              task: request.task,
              inputHash,
              routeRevision: AI_ROUTE_REVISION,
              provider: provider.id,
              model: actualModel,
              output: data as Prisma.InputJsonValue,
              confidence,
              expiresAt,
            },
          }),
        ]);
        return {
          data,
          provider: provider.id,
          model: actualModel,
          requestedModel: candidate.model,
          runId: run.id,
          cached: false,
          fallbackUsed,
          confidence,
        };
      } catch (error) {
        const normalized = this.normalizeError(error);
        errors.push({
          provider: provider.id,
          model: candidate.model,
          attempt,
          code: normalized.code,
        });
        if (normalized.providerWide) disabledProviders.add(provider.id);
        if (
          normalized.code === "MODEL_NOT_AVAILABLE" ||
          normalized.code === "MODEL_CAPABILITY"
        )
          this.catalogues.delete(provider.id);
        await Promise.all([
          this.prisma.aiRun.update({
            where: { id: run.id },
            data: {
              status: "failed",
              latencyMs: Date.now() - startedAt,
              errorCode: normalized.code,
              errorMessage: normalized.message.slice(0, 500),
              providerUsage: responseProviderUsage,
              completedAt: new Date(),
            },
          }),
          this.updateModelFailure(
            provider.id,
            candidate.model,
            request.task,
            normalized,
          ),
          normalized.providerWide
            ? this.updateProviderFailure(provider.id, normalized)
            : Promise.resolve(),
        ]);
        if (normalized.code === "GATEWAY_DEADLINE") break;
      } finally {
        if (providerBudgetReservation > 0)
          this.releaseProviderBudget(provider.id, providerBudgetReservation);
      }
    }

    const deadlineExceeded =
      Date.now() >= deadlineAt ||
      errors.some((error) => error.code === "GATEWAY_DEADLINE");
    const errorCodes = new Set(errors.map((error) => error.code));
    const catalogueUnavailable =
      errors.length > 0 &&
      [...errorCodes].every((code) => code === "CATALOGUE_UNAVAILABLE");
    const quotaOrCooldown =
      errors.length > 0 &&
      [...errorCodes].every((code) =>
        [
          "RATE_LIMIT",
          "FREE_QUOTA_BUDGET",
          "MODEL_COOLDOWN",
          "CREDENTIAL_COOLDOWN",
          "CREDITS",
        ].includes(code),
      );
    const terminalCode = deadlineExceeded
      ? "AI_GATEWAY_DEADLINE_EXCEEDED"
      : catalogueUnavailable
        ? "AI_GATEWAY_CATALOGUE_UNAVAILABLE"
        : quotaOrCooldown
          ? "AI_GATEWAY_CAPACITY_COOLDOWN"
          : "AI_GATEWAY_UNAVAILABLE";
    const terminalMessage = deadlineExceeded
      ? "AI 模型池已达到本轮时间上限，请重试"
      : catalogueUnavailable
        ? "模型目录暂时无法验证，系统已停止向未知模型发送请求"
        : quotaOrCooldown
          ? "免费额度或请求频率正在恢复，系统会在冷却结束后自动继续"
          : "当前 AI 模型池均不可用，请稍后重试";
    throw new ServiceUnavailableException({
      code: terminalCode,
      message: terminalMessage,
      retryable: true,
      deadlineMs: gatewayDeadlineMs,
      dataClass,
      costPolicy,
      attempts: errors,
    });
  }

  async availableModelIds(force = false) {
    const providers = this.providers();
    const modelSets = await Promise.all(
      providers.map(async (provider) => ({
        provider: provider.id,
        models: await this.availableModelIdsFor(provider, force),
      })),
    );
    const available = modelSets.filter(
      (entry): entry is { provider: AiProvider; models: Set<string> } =>
        entry.models instanceof Set,
    );
    if (!available.length) return undefined;
    return new Set(
      available.flatMap(({ provider, models }) =>
        [...models].map((model) => modelStateKey(provider, model)),
      ),
    );
  }

  private providers() {
    return configuredProviderRuntimes(providerOrder());
  }

  private async cachedResult<T extends Record<string, unknown>>(
    cacheKey: string,
    request: AiGatewayRequest,
    input: Record<string, unknown>,
    inputHash: string,
    providers: ProviderRuntime[],
    dataClass: AiDataClass,
    costPolicy: AiCostPolicy,
  ): Promise<AiGatewayResult<T> | undefined> {
    const cached = await this.prisma.aiCache.findUnique({
      where: { key: cacheKey },
    });
    if (
      !cached ||
      cached.expiresAt <= new Date() ||
      !cached.provider ||
      !isAiProvider(cached.provider)
    )
      return undefined;
    const provider = providers.find((entry) => entry.id === cached.provider);
    if (!provider || !provider.allowsDataClass(dataClass)) return undefined;
    const tier = provider.costTierFor(cached.model);
    if (costPolicy === "free_only" && tier !== "free" && tier !== "promotion")
      return undefined;
    const run = await this.prisma.aiRun.create({
      data: {
        itemId: request.itemId,
        sellerId: request.sellerId,
        task: request.task,
        provider: provider.id,
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
      provider: provider.id,
      model: cached.model,
      requestedModel: cached.model,
      runId: run.id,
      cached: true,
      fallbackUsed: false,
      confidence: cached.confidence,
    };
  }

  private async availableModelIdsFor(
    provider: ProviderRuntime,
    force = false,
    deadlineAt?: number,
  ) {
    const cached = this.catalogues.get(provider.id);
    if (!force && cached && cached.expiresAt > Date.now()) return cached.models;
    const inFlight = this.catalogueRequests.get(provider.id);
    if (!force && inFlight) return inFlight;
    const request = this.fetchCatalogue(provider, deadlineAt).finally(() => {
      this.catalogueRequests.delete(provider.id);
    });
    this.catalogueRequests.set(provider.id, request);
    return request;
  }

  private async fetchCatalogue(
    provider: ProviderRuntime,
    deadlineAt?: number,
  ): Promise<Set<string> | undefined> {
    const configuredTimeout = Number(
      process.env.AI_CATALOG_TIMEOUT_MS ?? 5_000,
    );
    const catalogueTimeout = Math.max(
      500,
      Math.min(
        Number.isFinite(configuredTimeout) ? configuredTimeout : 5_000,
        15_000,
      ),
    );
    const remainingMs = deadlineAt
      ? Math.max(1, deadlineAt - Date.now())
      : catalogueTimeout;
    const allCredentialIds = provider.credentialIds();
    const credentialIds = allCredentialIds.filter((credentialId) =>
      this.credentialReady(provider.id, credentialId),
    );
    const models = new Set<string>();
    let catalogueSucceeded = false;
    let lastCredentialError: ModelCallError | undefined;
    for (const credentialId of credentialIds) {
      try {
        const response = await fetch(provider.catalogueUrl, {
          headers: provider.headers(false, undefined, credentialId),
          signal: AbortSignal.timeout(Math.min(catalogueTimeout, remainingMs)),
        });
        const text = await response.text().catch(() => "");
        if (!response.ok) {
          const error = this.responseError(
            provider,
            response.status,
            text,
            response.headers,
          );
          if (this.shouldFailoverCredential(error, allCredentialIds.length)) {
            this.cooldownCredential(provider.id, credentialId, error);
            lastCredentialError = error;
            continue;
          }
          throw error;
        }
        if (!text.trim()) throw new Error("empty catalogue");
        const payload = JSON.parse(text) as unknown;
        for (const modelId of provider.extractCatalogueModelIds(payload))
          models.add(provider.normalizeCatalogueModelId(modelId));
        catalogueSucceeded = true;
        this.clearCredentialCooldown(provider.id, credentialId);
      } catch (error) {
        const normalized = this.normalizeError(error);
        if (
          this.shouldFailoverCredential(normalized, allCredentialIds.length)
        ) {
          this.cooldownCredential(provider.id, credentialId, normalized);
          lastCredentialError = normalized;
          continue;
        }
        if (normalized.providerWide)
          await this.updateProviderFailure(provider.id, normalized);
        break;
      }
    }
    if (
      catalogueSucceeded &&
      provider.id === "bai" &&
      provider.apiTier === "promotion" &&
      process.env.NODE_ENV?.trim().toLowerCase() === "production"
    ) {
      try {
        const promotionUrl =
          process.env.BAI_PROMOTIONS_URL?.trim() ||
          "https://docs.b.ai/llmservice/promotions-and-pricing-notices/";
        const promotionResponse = await fetch(promotionUrl, {
          headers: { accept: "text/html" },
          signal: AbortSignal.timeout(Math.min(catalogueTimeout, remainingMs)),
        });
        if (!promotionResponse.ok)
          throw new Error(`B.AI promotion page ${promotionResponse.status}`);
        const verified = verifiedBaiPromotionModels(
          await promotionResponse.text(),
          models,
        );
        if (verified.size === 0)
          throw new Error("B.AI promotion page proves no free API models");
        models.clear();
        for (const modelId of verified) models.add(modelId);
      } catch {
        catalogueSucceeded = false;
        models.clear();
      }
    }
    if (catalogueSucceeded) {
      const configuredTtl = Number(
        process.env.AI_CATALOG_REFRESH_INTERVAL_MS ?? 6 * 60 * 60_000,
      );
      const ttl = Math.max(
        60_000,
        Number.isFinite(configuredTtl) ? configuredTtl : 6 * 60 * 60_000,
      );
      this.catalogues.set(provider.id, {
        expiresAt: Date.now() + ttl,
        models,
      });
      return models;
    }
    if (lastCredentialError && allCredentialIds.length > 1)
      await this.updateProviderFailure(
        provider.id,
        this.allCredentialsUnavailable(provider, lastCredentialError),
      );
    const configuredTtl = Number(
      process.env.AI_CATALOG_NEGATIVE_CACHE_MS ?? 60_000,
    );
    const ttl = Math.max(
      1_000,
      Number.isFinite(configuredTtl) ? configuredTtl : 60_000,
    );
    this.catalogues.set(provider.id, {
      expiresAt: Date.now() + ttl,
      models: undefined,
    });
    return undefined;
  }

  private async callModel(
    provider: ProviderRuntime,
    model: string,
    request: AiGatewayRequest,
    candidateDeadlineAt: number,
    gatewayDeadlineAt: number,
  ) {
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

    const maxAttempts = Math.max(
      1,
      Math.min(Number(process.env.AI_HTTP_RETRIES ?? 1), 2),
    );
    const allCredentialIds = provider.credentialIds(request.task);
    const credentialIds = allCredentialIds.filter((credentialId) =>
      this.credentialReady(provider.id, credentialId),
    );
    if (!credentialIds.length) throw this.allCredentialsCooling(provider);
    let lastError: ModelCallError | undefined;
    for (const credentialId of credentialIds) {
      let moveToNextCredential = false;
      for (let httpAttempt = 1; httpAttempt <= maxAttempts; httpAttempt += 1) {
        const deadlineAt = Math.min(candidateDeadlineAt, gatewayDeadlineAt);
        const remainingMs = deadlineAt - Date.now();
        if (remainingMs <= 0)
          throw gatewayDeadlineAt <= Date.now()
            ? this.deadlineError()
            : new ModelCallError("模型请求超时", "TIMEOUT", true);
        const timeoutMs = Math.max(
          1,
          Math.min(this.modelTimeoutMs(), remainingMs),
        );
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const body = provider.normalizeRequestBody({
            model,
            messages,
            max_tokens: request.maxTokens,
            temperature: request.temperature ?? 0.1,
          });
          const response = await fetch(`${provider.apiUrl}/chat/completions`, {
            method: "POST",
            headers: provider.headers(true, request.task, credentialId),
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          const responseText = await response.text().catch(() => "");
          if (!response.ok) {
            const normalized = this.responseError(
              provider,
              response.status,
              responseText,
              response.headers,
            );
            if (
              this.shouldFailoverCredential(normalized, allCredentialIds.length)
            ) {
              this.cooldownCredential(provider.id, credentialId, normalized);
              lastError = normalized;
              moveToNextCredential = true;
              break;
            }
            if (
              normalized.providerWide ||
              !normalized.retryable ||
              normalized.code === "RATE_LIMIT" ||
              httpAttempt === maxAttempts
            )
              throw normalized;
            lastError = normalized;
            const delayMs = 500 * httpAttempt;
            if (Date.now() + delayMs >= deadlineAt)
              throw new ModelCallError("模型请求超时", "TIMEOUT", true);
            await sleep(delayMs);
            continue;
          }
          if (!responseText.trim())
            throw new ModelCallError(
              "模型返回空响应体",
              "EMPTY_RESPONSE",
              true,
            );
          try {
            const payload = JSON.parse(responseText) as ChatPayload;
            this.clearCredentialCooldown(provider.id, credentialId);
            return payload;
          } catch {
            throw new ModelCallError(
              "模型返回了无法解析的响应体",
              "INVALID_PROVIDER_JSON",
              true,
            );
          }
        } catch (error) {
          const abortedAtGatewayBoundary =
            error instanceof Error &&
            (error.name === "AbortError" || error.name === "TimeoutError") &&
            candidateDeadlineAt >= gatewayDeadlineAt;
          const normalized =
            Date.now() >= gatewayDeadlineAt || abortedAtGatewayBoundary
              ? this.deadlineError()
              : this.normalizeError(error);
          if (
            this.shouldFailoverCredential(normalized, allCredentialIds.length)
          ) {
            this.cooldownCredential(provider.id, credentialId, normalized);
            lastError = normalized;
            moveToNextCredential = true;
            break;
          }
          if (
            normalized.providerWide ||
            !normalized.retryable ||
            normalized.code === "RATE_LIMIT" ||
            httpAttempt === maxAttempts
          )
            throw normalized;
          lastError = normalized;
          const delayMs = 500 * httpAttempt;
          if (Date.now() + delayMs >= candidateDeadlineAt)
            throw new ModelCallError("模型请求超时", "TIMEOUT", true);
          await sleep(delayMs);
        } finally {
          clearTimeout(timeout);
        }
      }
      if (moveToNextCredential) continue;
    }
    if (lastError && allCredentialIds.length > 1)
      throw this.allCredentialsUnavailable(provider, lastError);
    throw lastError ?? new ModelCallError("未知模型错误", "UNKNOWN", false);
  }

  private credentialStateKey(provider: AiProvider, credentialId: string) {
    if (!/^[a-z0-9_-]+$/i.test(credentialId))
      throw new Error("Invalid credential alias");
    return `${provider}:${credentialId}`;
  }

  private credentialReady(provider: AiProvider, credentialId: string) {
    const key = this.credentialStateKey(provider, credentialId);
    const state = this.credentialCooldowns.get(key);
    if (!state) return true;
    if (state.until > Date.now()) return false;
    this.credentialCooldowns.delete(key);
    return true;
  }

  private cooldownCredential(
    provider: AiProvider,
    credentialId: string,
    error: ModelCallError,
  ) {
    const fallback =
      error.code === "AUTH" || error.code === "CREDITS"
        ? 30 * 60_000
        : 5 * 60_000;
    const until = Math.max(
      Date.now() + fallback,
      error.rate.cooldownUntil?.getTime() ?? 0,
    );
    this.credentialCooldowns.set(
      this.credentialStateKey(provider, credentialId),
      { code: error.code, until },
    );
  }

  private clearCredentialCooldown(provider: AiProvider, credentialId: string) {
    this.credentialCooldowns.delete(
      this.credentialStateKey(provider, credentialId),
    );
  }

  private shouldFailoverCredential(
    error: ModelCallError,
    credentialCount: number,
  ) {
    if (credentialCount < 2) return false;
    if (error.code === "AUTH" || error.code === "CREDITS") return true;
    return error.code === "RATE_LIMIT" && !error.providerWide;
  }

  private credentialRecoveryAt(provider: AiProvider) {
    const prefix = `${provider}:`;
    const recoveries = [...this.credentialCooldowns.entries()]
      .filter(
        ([key, state]) => key.startsWith(prefix) && state.until > Date.now(),
      )
      .map(([, state]) => state.until);
    return recoveries.length ? Math.min(...recoveries) : undefined;
  }

  private allCredentialsCooling(provider: ProviderRuntime) {
    const recoveryAt = this.credentialRecoveryAt(provider.id);
    return new ModelCallError(
      `${provider.label} 的可用凭据正在冷却中`,
      "CREDENTIAL_COOLDOWN",
      false,
      true,
      {
        cooldownUntil: recoveryAt ? new Date(recoveryAt) : undefined,
      },
    );
  }

  private allCredentialsUnavailable(
    provider: ProviderRuntime,
    cause: ModelCallError,
  ) {
    const recoveryAt = this.credentialRecoveryAt(provider.id);
    return new ModelCallError(
      `${provider.label} 的全部可用凭据暂时不可用`,
      cause.code,
      cause.retryable,
      true,
      {
        ...cause.rate,
        cooldownUntil: recoveryAt
          ? new Date(recoveryAt)
          : cause.rate.cooldownUntil,
      },
    );
  }

  private responseError(
    provider: ProviderRuntime,
    status: number,
    responseText: string,
    headers: Headers,
  ) {
    if (
      provider.id === "cloudflare" &&
      status === 403 &&
      ["3041", "5016", "5018", "5035"].includes(
        cloudflareErrorCode(responseText) ?? "",
      )
    )
      return new ModelCallError(
        `${provider.label} 当前账号无法访问该模型`,
        "MODEL_NOT_AVAILABLE",
        false,
      );
    if (status === 401 || status === 403)
      return new ModelCallError(
        `${provider.label} 凭据未通过验证或无权访问`,
        "AUTH",
        false,
        true,
      );
    if (status === 402)
      return new ModelCallError(
        `${provider.label} 账户额度不足`,
        "CREDITS",
        false,
        true,
      );
    if (
      status === 404 ||
      (status === 400 &&
        /(?:invalid|unknown|not found).{0,30}model/i.test(responseText))
    )
      return new ModelCallError(
        `${provider.label} 当前目录中没有该模型`,
        "MODEL_NOT_AVAILABLE",
        false,
      );
    if (
      status === 400 &&
      /(?:unsupported|does not support|capabilit)/i.test(responseText)
    )
      return new ModelCallError(
        `${provider.label} 当前模型不支持所需能力`,
        "MODEL_CAPABILITY",
        false,
      );
    if (status === 429) {
      const retryAfterMs = durationMilliseconds(headers.get("retry-after"));
      const resetRequestsMs = durationMilliseconds(
        firstHeader(headers, [
          "x-ratelimit-reset-requests",
          "x-ratelimit-reset-requests-day",
          "x-ratelimit-reset-requests-month",
        ]),
      );
      const resetTokensMs = durationMilliseconds(
        firstHeader(headers, [
          "x-ratelimit-reset-tokens",
          "x-ratelimit-reset-tokens-minute",
          "x-ratelimit-reset-tokens-day",
        ]),
      );
      const resetMs = Math.max(
        retryAfterMs ?? 0,
        resetRequestsMs ?? 0,
        resetTokensMs ?? 0,
      );
      const providerWide =
        provider.id === "bai" ||
        provider.id === "gemini" ||
        (provider.id === "openrouter" &&
          /(?:daily|account|key|credit|requests per day)/i.test(
            responseText,
          )) ||
        (provider.id === "cloudflare" &&
          /(?:daily|account|credit|neurons)/i.test(responseText)) ||
        (provider.id === "cohere" &&
          /(?:monthly|account|key|requests per month)/i.test(responseText)) ||
        (provider.id === "cerebras" &&
          /(?:daily|account|organization|key|requests per day|tokens per day)/i.test(
            responseText,
          )) ||
        (provider.id === "nvidia" &&
          /(?:account|key|credit|daily)/i.test(responseText)) ||
        (provider.id === "sensenova" &&
          /(?:account|organization|project|daily|monthly|credit balance|quota exhausted)/i.test(
            responseText,
          ));
      const fallbackCooldown = providerWide ? 60_000 : 5 * 60_000;
      const cooldownUntil = new Date(
        Date.now() + Math.max(resetMs, fallbackCooldown),
      );
      return new ModelCallError(
        `${provider.label} 请求频率或免费额度已达限制`,
        "RATE_LIMIT",
        false,
        providerWide,
        {
          cooldownUntil,
          quotaResetAt: resetMs ? new Date(Date.now() + resetMs) : undefined,
          remainingRequests: finiteInteger(
            firstHeader(headers, [
              "x-ratelimit-remaining-requests",
              "x-ratelimit-remaining-requests-day",
              "x-ratelimit-remaining-requests-month",
            ]),
          ),
          remainingTokens: finiteInteger(
            firstHeader(headers, [
              "x-ratelimit-remaining-tokens",
              "x-ratelimit-remaining-tokens-minute",
              "x-ratelimit-remaining-tokens-day",
            ]),
          ),
        },
      );
    }
    const code = status >= 500 ? "PROVIDER_ERROR" : `HTTP_${status}`;
    if (status >= 500) {
      const configured = Number(
        process.env.AI_PROVIDER_5XX_COOLDOWN_MS ?? 15 * 60_000,
      );
      const cooldownMs = Math.max(
        60_000,
        Math.min(
          Number.isFinite(configured) ? configured : 15 * 60_000,
          24 * 60 * 60_000,
        ),
      );
      return new ModelCallError(
        `${provider.label} 服务端暂时不可用`,
        code,
        true,
        status === 502 || status === 503 || status === 504,
        { cooldownUntil: new Date(Date.now() + cooldownMs) },
      );
    }
    return new ModelCallError(
      `${provider.label} 请求失败（${code}）`,
      code,
      status >= 500,
    );
  }

  private normalizeError(error: unknown) {
    if (error instanceof ModelCallError) return error;
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    )
      return new ModelCallError("模型请求超时", "TIMEOUT", true);
    const message = error instanceof Error ? error.message : String(error);
    return new ModelCallError(message, "NETWORK", true);
  }

  private fairCandidateDeadline(deadlineAt: number, untriedProviders: number) {
    const now = Date.now();
    const remaining = Math.max(1, deadlineAt - now);
    const fairShare = Math.max(
      1,
      Math.floor(remaining / (untriedProviders + 1)),
    );
    return now + Math.min(this.modelTimeoutMs(), fairShare);
  }

  private modelTimeoutMs() {
    const legacyTimeout = Number(process.env.AI_TIMEOUT_MS ?? 30_000);
    const configured = Number(process.env.AI_MODEL_TIMEOUT_MS ?? legacyTimeout);
    return Math.max(
      5_000,
      Math.min(Number.isFinite(configured) ? configured : 30_000, 30_000),
    );
  }

  private gatewayDeadlineMs() {
    const configured = Number(process.env.AI_GATEWAY_DEADLINE_MS ?? 240_000);
    return Math.max(
      30_000,
      Math.min(Number.isFinite(configured) ? configured : 240_000, 240_000),
    );
  }

  private costPolicy(requested?: AiCostPolicy): AiCostPolicy {
    if (process.env.AI_ALLOW_PAID_MODELS?.trim().toLowerCase() !== "true")
      return "free_only";
    const configured = process.env.AI_COST_POLICY?.trim();
    const globalPolicy: AiCostPolicy =
      configured === "free_first" || configured === "paid_allowed"
        ? configured
        : "free_only";
    if (globalPolicy === "free_only" || requested === "free_only")
      return "free_only";
    if (globalPolicy === "free_first" || requested === "free_first")
      return "free_first";
    return "paid_allowed";
  }

  private async reserveProviderBudget(
    provider: ProviderRuntime,
    model: string,
    request: AiGatewayRequest,
  ) {
    if (provider.id !== "cloudflare" || provider.apiTier !== "free") return 0;
    const configuredBudget = Number(
      process.env.CLOUDFLARE_AI_DAILY_NEURON_BUDGET ?? 8_000,
    );
    const budget = Math.max(
      100,
      Math.min(
        Number.isFinite(configuredBudget) ? configuredBudget : 8_000,
        9_500,
      ),
    );
    const now = new Date();
    const day = utcDayKey(now);
    if (this.cloudflareReservationDay !== day) {
      this.cloudflareReservationDay = day;
      this.cloudflareReservedNeurons = 0;
    }
    const used = await this.prisma.aiRun.aggregate({
      where: {
        provider: "cloudflare",
        // A provider call is billable even when its content later fails our
        // validation, so every persisted usage value must consume the budget.
        providerUsage: { not: null },
        startedAt: {
          gte: new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
          ),
        },
      },
      _sum: { providerUsage: true },
    });
    const rates = cloudflareNeuronRates[model] ?? {
      input: 50_000,
      output: 150_000,
    };
    const inputCharacters = JSON.stringify(request.messages).length;
    const estimated = Math.max(
      1,
      Math.ceil(
        (inputCharacters * rates.input + request.maxTokens * rates.output) /
          1_000_000 +
          (request.imageUrls?.length ?? 0) * 500,
      ),
    );
    const consumed = Number(used._sum.providerUsage ?? 0);
    const remaining = budget - consumed - this.cloudflareReservedNeurons;
    if (estimated > remaining) {
      const resetAt = nextUtcDay(now);
      throw new ModelCallError(
        "Cloudflare Workers AI 免费日预算已保留完毕",
        "FREE_QUOTA_BUDGET",
        false,
        true,
        {
          cooldownUntil: resetAt,
          quotaResetAt: resetAt,
          remainingTokens: Math.max(0, Math.floor(remaining)),
        },
      );
    }
    this.cloudflareReservedNeurons += estimated;
    return estimated;
  }

  private releaseProviderBudget(provider: AiProvider, reservation: number) {
    if (provider !== "cloudflare") return;
    this.cloudflareReservedNeurons = Math.max(
      0,
      this.cloudflareReservedNeurons - reservation,
    );
  }

  private deadlineError() {
    return new ModelCallError(
      "AI Gateway execution deadline exceeded",
      "GATEWAY_DEADLINE",
      false,
    );
  }

  private async providerReady(provider: AiProvider) {
    const state = await this.prisma.aiProviderState.findUnique({
      where: { provider },
      select: { cooldownUntil: true },
    });
    return !state?.cooldownUntil || state.cooldownUntil <= new Date();
  }

  private async updateProviderSuccess(
    provider: AiProvider,
    attemptStartedAt: Date,
  ) {
    const updated = await this.prisma.aiProviderState.updateMany({
      where: { provider, updatedAt: { lte: attemptStartedAt } },
      data: {
        status: "online",
        cooldownUntil: null,
        quotaResetAt: null,
        lastErrorCode: null,
        consecutiveFailures: 0,
      },
    });
    if (updated.count > 0) return;
    try {
      await this.prisma.aiProviderState.create({
        data: { provider, status: "online" },
      });
    } catch (error) {
      // A newer failure state won the race after this attempt started. Preserve
      // its cooldown instead of letting this older success clear it.
      if (!isUniqueConflict(error)) throw error;
    }
  }

  private async updateProviderFailure(
    provider: AiProvider,
    error: ModelCallError,
  ) {
    const current = await this.prisma.aiProviderState.findUnique({
      where: { provider },
      select: { consecutiveFailures: true },
    });
    const defaultCooldown =
      error.code === "AUTH" || error.code === "CREDITS"
        ? 30 * 60_000
        : Number(process.env.AI_PROVIDER_CIRCUIT_COOLDOWN_MS ?? 60_000);
    const cooldownUntil =
      error.rate.cooldownUntil ??
      new Date(Date.now() + Math.max(10_000, defaultCooldown));
    await this.prisma.aiProviderState.upsert({
      where: { provider },
      update: {
        status: "cooldown",
        cooldownUntil,
        quotaResetAt: error.rate.quotaResetAt,
        remainingRequests: error.rate.remainingRequests,
        remainingTokens: error.rate.remainingTokens,
        lastErrorCode: error.code,
        consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
      },
      create: {
        provider,
        status: "cooldown",
        cooldownUntil,
        quotaResetAt: error.rate.quotaResetAt,
        remainingRequests: error.rate.remainingRequests,
        remainingTokens: error.rate.remainingTokens,
        lastErrorCode: error.code,
        consecutiveFailures: 1,
      },
    });
  }

  private async recordUnavailableModel(
    provider: ProviderRuntime,
    model: string,
    request: AiGatewayRequest,
    input: Record<string, unknown>,
    inputHash: string,
    attempt: number,
    fallbackUsed: boolean,
  ) {
    const error = new ModelCallError(
      `模型当前不在 ${provider.label} 账号目录中`,
      "MODEL_NOT_AVAILABLE",
      false,
    );
    await Promise.all([
      this.prisma.aiRun.create({
        data: {
          itemId: request.itemId,
          sellerId: request.sellerId,
          task: request.task,
          provider: provider.id,
          requestedModel: model,
          status: "failed",
          inputHash,
          input: input as Prisma.InputJsonValue,
          fallbackUsed,
          attempt,
          latencyMs: 0,
          errorCode: error.code,
          errorMessage: error.message,
          completedAt: new Date(),
        },
      }),
      this.updateModelFailure(provider.id, model, request.task, error),
    ]);
  }

  private async recordCatalogueUnavailable(
    provider: ProviderRuntime,
    model: string,
    request: AiGatewayRequest,
    input: Record<string, unknown>,
    inputHash: string,
    attempt: number,
    fallbackUsed: boolean,
  ) {
    await this.prisma.aiRun.create({
      data: {
        itemId: request.itemId,
        sellerId: request.sellerId,
        task: request.task,
        provider: provider.id,
        requestedModel: model,
        status: "failed",
        inputHash,
        input: input as Prisma.InputJsonValue,
        fallbackUsed,
        attempt,
        latencyMs: 0,
        errorCode: "CATALOGUE_UNAVAILABLE",
        errorMessage: `${provider.label} 模型目录暂不可用`,
        completedAt: new Date(),
      },
    });
  }

  private async updateModelSuccess(
    provider: AiProvider,
    model: string,
    task: AiTask,
    attemptStartedAt: Date,
  ) {
    const updated = await this.prisma.aiModelState.updateMany({
      where: { provider, model, updatedAt: { lte: attemptStartedAt } },
      data: {
        role: modelRole(provider, model, task),
        configured: true,
        status: "online",
        cooldownUntil: null,
        quotaResetAt: null,
        consecutiveFailures: 0,
        lastSuccessAt: new Date(),
        lastErrorCode: null,
        lastCheckedAt: new Date(),
      },
    });
    if (updated.count > 0) return;
    try {
      await this.prisma.aiModelState.create({
        data: {
          model,
          provider,
          role: modelRole(provider, model, task),
          configured: true,
          status: "online",
          lastSuccessAt: new Date(),
        },
      });
    } catch (error) {
      // See updateProviderSuccess: a unique conflict means a newer state must
      // remain authoritative for cooldown and quota decisions.
      if (!isUniqueConflict(error)) throw error;
    }
  }

  private async modelCooldown(provider: AiProvider, model: string) {
    const state = await this.prisma.aiModelState.findUnique({
      where: { provider_model: { provider, model } },
      select: { cooldownUntil: true },
    });
    return Boolean(state?.cooldownUntil && state.cooldownUntil > new Date());
  }

  private async updateModelFailure(
    provider: AiProvider,
    model: string,
    task: AiTask,
    error: ModelCallError,
  ) {
    const current = await this.prisma.aiModelState.findUnique({
      where: { provider_model: { provider, model } },
      select: { consecutiveFailures: true },
    });
    const fallbackCooldown =
      error.code === "MODEL_NOT_AVAILABLE"
        ? 24 * 60 * 60_000
        : error.code === "MODEL_CAPABILITY"
          ? 24 * 60 * 60_000
          : error.code === "INVALID_JSON" ||
              error.code === "INVALID_PROVIDER_JSON"
            ? 15 * 60_000
            : error.code === "RATE_LIMIT"
              ? 5 * 60_000
              : error.code === "AUTH" || error.code === "CREDITS"
                ? 30 * 60_000
                : error.code === "PROVIDER_ERROR" ||
                    error.code === "NETWORK" ||
                    error.code === "TIMEOUT"
                  ? 60_000
                  : 0;
    const cooldownUntil =
      error.rate.cooldownUntil ??
      (fallbackCooldown ? new Date(Date.now() + fallbackCooldown) : undefined);
    const status =
      error.code === "MODEL_NOT_AVAILABLE" ? "unavailable" : "degraded";
    await this.prisma.aiModelState.upsert({
      where: { provider_model: { provider, model } },
      update: {
        role: modelRole(provider, model, task),
        configured: true,
        status,
        cooldownUntil,
        quotaResetAt: error.rate.quotaResetAt,
        consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
        lastFailureAt: new Date(),
        lastErrorCode: error.code,
        lastCheckedAt: new Date(),
      },
      create: {
        model,
        provider,
        role: modelRole(provider, model, task),
        configured: true,
        status,
        cooldownUntil,
        quotaResetAt: error.rate.quotaResetAt,
        consecutiveFailures: 1,
        lastFailureAt: new Date(),
        lastErrorCode: error.code,
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
