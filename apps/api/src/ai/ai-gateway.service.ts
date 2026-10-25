import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@tokusatsu/db";
import {
  EmptyResponseBodyError,
  InvalidArgumentError,
  InvalidPromptError,
  InvalidResponseDataError,
  JSONParseError,
  NoOutputGeneratedError,
  NoSuchModelError,
  UnsupportedFunctionalityError,
  UnsupportedModelVersionError,
} from "ai";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma.service.js";
import { normalizeScopedRequest, conservativeTokenReservation, zhipuResourcePolicy, type AiPurpose } from "./zhipu.policy.js";
import {
  AI_ROUTE_REVISION,
  candidatesForTask,
  isAiProvider,
  modelRole,
  modelStateKey,
  providerOrder,
  routeUsesLiveCatalogue,
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
import {
  AiSdkHttpError,
  AiSdkModelClient,
  isSafeExternalImageUrl,
} from "./ai-sdk-model.client.js";
import {
  responseSchemaIdentity,
  responseSchemaIdentityHash,
  type ResponseSchema,
  type ResponseSchemaIssue,
  type ResponseValidationResult,
} from "./ai-response-schema.js";

export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiGatewayRequest<
  T extends Record<string, unknown> = Record<string, unknown>,
> = {
  task: AiTask;
  purpose?: AiPurpose;
  messages: AiMessage[];
  maxTokens: number;
  responseSchema: ResponseSchema<T>;
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

export function modelTimeoutForTask(task: AiTask) {
  const background = task === "translation" || task === "classification";
  const legacyTimeout = Number(process.env.AI_TIMEOUT_MS ?? 30_000);
  const configured = Number(
    background
      ? (process.env.AI_BACKGROUND_MODEL_TIMEOUT_MS ?? 45_000)
      : (process.env.AI_MODEL_TIMEOUT_MS ?? legacyTimeout),
  );
  const fallback = background ? 45_000 : 30_000;
  const ceiling = background ? 60_000 : 30_000;
  return Math.max(
    5_000,
    Math.min(Number.isFinite(configured) ? configured : fallback, ceiling),
  );
}

type ChatPayload = {
  model?: string;
  provider?: string;
  choices?: Array<{
    message?: {
      content?: unknown;
      reasoning?: unknown;
      reasoning_content?: unknown;
    };
  }>;
  output_text?: unknown;
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

export type ProviderCatalogueEvidence =
  | "live_catalogue"
  | "configured_fallback"
  | "operator_static_route"
  | "catalogue_unavailable";

export type ProviderCatalogueSnapshot = {
  provider: AiProvider;
  models: Set<string> | undefined;
  evidence: ProviderCatalogueEvidence;
};

type CatalogueCache = {
  expiresAt: number;
  models?: Set<string>;
  evidence: ProviderCatalogueEvidence;
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

type CooldownState = {
  cooldownUntil?: Date | null;
  lastErrorCode?: string | null;
};

type ProviderSlotWaiter = {
  timer: ReturnType<typeof setTimeout>;
  resolve: (release: () => void) => void;
  reject: (error: ModelCallError) => void;
};

type ProviderConcurrencyGate = {
  active: number;
  waiters: ProviderSlotWaiter[];
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

/**
 * OpenAI-compatible providers do not agree on the shape of message content.
 * Keep only actual textual content; reasoning-only responses are deliberately
 * treated as empty so the gateway can fall through to another model.
 */
function responseContent(response: ChatPayload) {
  const raw = response.choices?.[0]?.message?.content;
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) {
    const text = raw
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        const value = (part as { text?: unknown }).text;
        return typeof value === "string" ? value : "";
      })
      .join("")
      .trim();
    if (text) return text;
  }
  const outputText = response.output_text;
  return typeof outputText === "string" ? outputText.trim() : "";
}

const AUDIT_MODEL_ID_PATTERN = /^[a-z0-9@][a-z0-9._:/@+-]{0,199}$/i;

/**
 * Provider response metadata is untrusted audit input. Keep useful upstream
 * identities without allowing control characters or unbounded values into
 * logs and database tooling.
 */
function auditedModelId(reportedModel: unknown, routedModel: string) {
  if (typeof reportedModel !== "string") return routedModel;
  const value = reportedModel.trim();
  return AUDIT_MODEL_ID_PATTERN.test(value) ? value : routedModel;
}

const NON_PROBE_COOLDOWN_CODES = new Set([
  "AUTH",
  "CREDITS",
  "RATE_LIMIT",
  "FREE_QUOTA_BUDGET",
  "FREE_RESOURCE_EXPIRED",
  "CREDENTIAL_COOLDOWN",
  "MODEL_NOT_AVAILABLE",
  "MODEL_CAPABILITY",
]);

/**
 * Cerebras Gemma 4 accepts only PNG/JPEG base64 data URIs for vision. Its free
 * trial also caps a request at two images and 10 MB. This gateway intentionally
 * accepts only external HTTPS image URLs, so that model stays catalogued but is
 * not eligible for the current product image transport.
 */
const URL_IMAGE_INCOMPATIBLE_MODELS = new Set(["cerebras:gemma-4-31b"]);

function confidenceOf(value: Record<string, unknown>) {
  const confidence = Number(value.confidence);
  return Number.isFinite(confidence)
    ? Math.max(0, Math.min(1, confidence))
    : null;
}

function effectiveRouteRevision<T extends Record<string, unknown>>(
  schema: ResponseSchema<T>,
) {
  return `${AI_ROUTE_REVISION}:${responseSchemaIdentityHash(
    schema.id,
    schema.version,
  ).slice(0, 24)}`;
}

function schemaIssuesSummary(issues: readonly ResponseSchemaIssue[]) {
  return issues
    .slice(0, 8)
    .map((entry) => `${entry.path}:${entry.code}`)
    .join(", ")
    .slice(0, 300);
}

/**
 * Public marketplace payloads remain auditable. Private prompts and image URLs
 * are represented only by non-content metadata; the content-addressed hash is
 * stored separately on AiRun and is sufficient to correlate attempts.
 */
function persistedInput(
  input: Record<string, unknown>,
  dataClass: AiDataClass,
): Prisma.InputJsonValue {
  if (dataClass === "public_market") return input as Prisma.InputJsonValue;
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const imageUrls = Array.isArray(input.imageUrls) ? input.imageUrls : [];
  return {
    redacted: true,
    dataClass,
    messageCount: messages.length,
    imageCount: imageUrls.length,
    maxTokens: typeof input.maxTokens === "number" ? input.maxTokens : null,
    temperature:
      typeof input.temperature === "number" ? input.temperature : null,
    costPolicy: typeof input.costPolicy === "string" ? input.costPolicy : null,
  };
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function providerRequestSpacingMs(
  provider: AiProvider,
  environment: Record<string, string | undefined> = process.env,
) {
  if (provider === "zhipu") return 5_000;
  const environmentName = `AI_PROVIDER_RPM_${provider.toUpperCase()}`;
  const configured = Number(environment[environmentName]);
  if (!Number.isFinite(configured)) return 0;
  const rpm = Math.max(0, Math.min(Math.floor(configured), 10_000));
  return rpm ? Math.ceil(60_000 / rpm) : 0;
}

/**
 * Keep the short in-provider retry staggered without allowing an unexpectedly
 * large random value or attempt number to consume the gateway deadline.
 */
export function httpRetryDelayMs(
  httpAttempt: number,
  randomSample = Math.random(),
) {
  const normalizedAttempt = Number.isFinite(httpAttempt)
    ? Math.floor(httpAttempt)
    : 1;
  const normalizedSample = Number.isFinite(randomSample) ? randomSample : 0.5;
  const boundedAttempt = Math.max(1, Math.min(2, normalizedAttempt));
  const boundedSample = Math.max(0, Math.min(1, normalizedSample));
  const baseDelayMs = 500 * boundedAttempt;
  return Math.round(baseDelayMs * (0.8 + boundedSample * 0.4));
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
export class AiGatewayService implements OnApplicationBootstrap {
  private readonly pending = new Map<string, Promise<AiGatewayResult<Record<string, unknown>>>>();
  private readonly logger = new Logger(AiGatewayService.name);
  private readonly catalogues = new Map<AiProvider, CatalogueCache>();
  private readonly catalogueRequests = new Map<
    AiProvider,
    Promise<Set<string> | undefined>
  >();
  private readonly credentialCooldowns = new Map<string, CredentialCooldown>();
  /**
   * A transient provider/model cooldown must not make the whole product
   * permanently unavailable.  Probes are process-local and rate-limited; the
   * persisted cooldown remains the source of truth for normal traffic.
   */
  private readonly cooldownProbeAt = new Map<string, number>();
  private readonly providerConcurrencyGates = new Map<
    AiProvider,
    ProviderConcurrencyGate
  >();
  private readonly providerNextRequestAt = new Map<AiProvider, number>();
  private cloudflareReservationDay = "";
  private cloudflareReservedNeurons = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly aiSdk = new AiSdkModelClient(),
  ) {}

  async onApplicationBootstrap() {
    const recovered = await this.reconcileInterruptedRuns();
    if (recovered.count > 0)
      this.logger.warn(`Recovered ${recovered.count} interrupted AI runs`);
  }

  async reconcileInterruptedRuns(now = new Date()) {
    const graceMs = Math.max(5 * 60_000, this.gatewayDeadlineMs() + 60_000);
    return this.prisma.aiRun.updateMany({
      where: {
        status: "running",
        startedAt: { lt: new Date(now.getTime() - graceMs) },
      },
      data: {
        status: "failed",
        errorCode: "PROCESS_INTERRUPTED",
        errorMessage: "API 进程中断，已在启动时自动回收",
        completedAt: now,
      },
    });
  }

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
    request: AiGatewayRequest<T>,
  ): Promise<AiGatewayResult<T>> {
    const scoped = normalizeScopedRequest(request);
    scoped.costPolicy = "free_only";
    const key = createHash("sha256").update(JSON.stringify({ ...scoped, responseSchema: responseSchemaIdentity(scoped.responseSchema.id, scoped.responseSchema.version) })).digest("hex");
    const pending = this.pending.get(key);
    if (pending) return pending as Promise<AiGatewayResult<T>>;
    const execution = this.executeScopedJson(scoped);
    this.pending.set(key, execution);
    try { return await execution; } finally { this.pending.delete(key); }
  }

  async resourceStatus() {
    const policy = zhipuResourcePolicy();
    const day = new Date(); day.setUTCHours(0, 0, 0, 0);
    const [total, today] = await Promise.all([
      this.prisma.aiRun.aggregate({ where: { quotaGroup: policy.group }, _sum: { quotaReservation: true } }),
      this.prisma.aiRun.aggregate({ where: { quotaGroup: policy.group, startedAt: { gte: day } }, _sum: { quotaReservation: true } }),
    ]);
    const accountedTokens = Number(total._sum.quotaReservation ?? 0);
    const todayTokens = Number(today._sum.quotaReservation ?? 0);
    return { ...policy, expiresAt: Number.isFinite(policy.expiresAt.getTime()) ? policy.expiresAt.toISOString() : null,
      configured: this.configured(), accountedTokens, todayTokens,
      remainingLocalBudget: Math.max(0, policy.tokenLimit - accountedTokens),
      available: this.configured() && policy.expiresAt > new Date() && accountedTokens < policy.tokenLimit && todayTokens < policy.dailyTokenLimit,
      note: "本系统统计，不代表智谱账号实时余额；账号其他调用会共用资源包。",
    };
  }

  private async executeScopedJson<T extends Record<string, unknown>>(
    request: AiGatewayRequest<T>,
  ): Promise<AiGatewayResult<T>> {
    if (request.imageUrls?.some((url) => !isSafeExternalImageUrl(url)))
      throw new BadRequestException({
        code: "AI_IMAGE_URL_INVALID",
        message: "图片地址必须是无凭据的公网 HTTPS URL",
        retryable: false,
      });
    const gatewayDeadlineMs = this.gatewayDeadlineMs();
    const deadlineAt = Date.now() + gatewayDeadlineMs;
    const dataClass = request.dataClass ?? "user_private";
    const costPolicy = this.costPolicy(request.costPolicy);
    const responseSchema = request.responseSchema;
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
    const input = {
      messages: request.messages,
      imageUrls: request.imageUrls ?? [],
      maxTokens: request.maxTokens,
      temperature: request.temperature ?? 0.1,
      dataClass,
      costPolicy,
      responseSchema: responseSchemaIdentity(
        responseSchema.id,
        responseSchema.version,
      ),
    };
    const inputHash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const routeRevision = effectiveRouteRevision(responseSchema);
    const cacheKey = createHash("sha256")
      .update(`${request.task}:${inputHash}:${routeRevision}`)
      .digest("hex");

    if (!request.bypassCache && dataClass === "public_market") {
      const cachedResult = await this.cachedResult<T>(
        cacheKey,
        request,
        input,
        inputHash,
        routeRevision,
        privacyEligible,
        dataClass,
        costPolicy,
      );
      if (cachedResult) return cachedResult;
    }

    // A validated public-market cache remains usable while its upstream is in
    // cooldown. Only fresh generation needs provider/model readiness; checking
    // cooldown first made already-paid translations disappear during outages.
    const providerReadiness = await Promise.all(
      privacyEligible.map(async (provider) => {
        const state = await this.providerState(provider.id);
        return {
          provider,
          state,
          ready: !state?.cooldownUntil || state.cooldownUntil <= new Date(),
        };
      }),
    );
    const readyProviders = providerReadiness.flatMap(({ provider, ready }) =>
      ready ? [provider] : [],
    );
    const providers = [...readyProviders];
    if (!providers.length) {
      const probe = providerReadiness.find(
        ({ provider, state }) =>
          Boolean(state?.cooldownUntil && state.cooldownUntil > new Date()) &&
          this.canProbeCooldown(`provider:${provider.id}`, state),
      );
      if (probe) {
        providers.push(probe.provider);
        this.markCooldownProbe(`provider:${probe.provider.id}`);
      }
    }
    if (!providers.length) {
      const accountGroupUnavailable = providerReadiness.every(
        ({ state }) => state?.lastErrorCode === "MODEL_NOT_AVAILABLE",
      );
      throw new ServiceUnavailableException({
        code: "AI_GATEWAY_ALL_PROVIDERS_COOLDOWN",
        message: accountGroupUnavailable
          ? "AI 密钥已配置，但上游账号组当前没有可调度模型；系统已暂停重复请求并等待上游恢复"
          : "AI 服务商正在额度或故障冷却中，系统会在恢复后自动继续",
        retryable: true,
        dataClass,
        costPolicy,
      });
    }

    const catalogues = new Map<AiProvider, Set<string> | undefined>();
    await Promise.all(
      providers.map(async (provider) => {
        catalogues.set(
          provider.id,
          await this.availableModelIdsFor(
            provider,
            false,
            deadlineAt,
            routeUsesLiveCatalogue(request.task, provider.id),
          ),
        );
      }),
    );

    const providerById = new Map(
      providers.map((provider) => [provider.id, provider]),
    );
    const availableModels = new Map<AiProvider, ReadonlySet<string>>();
    for (const [provider, models] of catalogues) {
      if (models) availableModels.set(provider, models);
    }
    const candidates = candidatesForTask(
      request.task,
      providers.map((provider) => provider.id),
      {
        costPolicy,
        requiresVision: Boolean(request.imageUrls?.length),
        rotationSeed: inputHash,
        availableModels,
        costTierFor: (provider, model) =>
          providerById.get(provider)?.costTierFor(model) ?? "unknown",
      },
    ).filter(
      (candidate) =>
        !request.imageUrls?.length ||
        !URL_IMAGE_INCOMPATIBLE_MODELS.has(
          modelStateKey(candidate.provider, candidate.model),
        ),
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

    // If every candidate model is cooling, allow at most one controlled probe
    // for a transient (non-quota) failure.  This is what lets an interaction
    // recover from a stale/background cooldown without hammering a provider.
    const modelStates = new Map<string, CooldownState | null>();
    await Promise.all(
      candidates.map(async (candidate) => {
        modelStates.set(
          modelStateKey(candidate.provider, candidate.model),
          await this.modelState(candidate.provider, candidate.model),
        );
      }),
    );
    const hasReadyModel = candidates.some((candidate) => {
      const state = modelStates.get(
        modelStateKey(candidate.provider, candidate.model),
      );
      return !state?.cooldownUntil || state.cooldownUntil <= new Date();
    });
    let modelProbeKey: string | undefined;
    if (!hasReadyModel) {
      const probe = candidates.find((candidate) => {
        const key = modelStateKey(candidate.provider, candidate.model);
        const state = modelStates.get(key);
        return Boolean(
          state?.cooldownUntil &&
            state.cooldownUntil > new Date() &&
            this.canProbeCooldown(`model:${key}`, state),
        );
      });
      if (probe) {
        modelProbeKey = modelStateKey(probe.provider, probe.model);
        this.markCooldownProbe(`model:${modelProbeKey}`);
      }
    }

    const errors: AttemptError[] = [];
    const disabledProviders = new Set<AiProvider>();
    const attemptedProviders = new Set<AiProvider>();
    const providerDeadlines = new Map<AiProvider, number>();
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
      const modelKey = modelStateKey(provider.id, candidate.model);
      const modelState = await this.modelState(provider.id, candidate.model);
      modelStates.set(modelKey, modelState);
      const selectedProbeStillAllowed =
        modelKey === modelProbeKey &&
        (!modelState?.lastErrorCode ||
          !NON_PROBE_COOLDOWN_CODES.has(modelState.lastErrorCode));
      if (
        modelState?.cooldownUntil &&
        modelState.cooldownUntil > new Date() &&
        !selectedProbeStillAllowed
      ) {
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
      const candidateDeadlineAt =
        providerDeadlines.get(provider.id) ??
        this.fairCandidateDeadline(
          deadlineAt,
          untriedProviderCount,
          request.task,
        );
      providerDeadlines.set(provider.id, candidateDeadlineAt);
      if (Date.now() >= candidateDeadlineAt) {
        // Candidates are provider-major. Every model behind one upstream must
        // share that upstream's fair slice, otherwise a provider with many
        // configured models can consume nearly the entire gateway deadline.
        errors.push({
          provider: provider.id,
          model: candidate.model,
          attempt,
          code: "TIMEOUT",
        });
        disabledProviders.add(provider.id);
        continue;
      }
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
          input: persistedInput(input, dataClass),
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
          run.id,
        );
        const response = await this.callModel(
          provider,
          candidate.model,
          request,
          candidateDeadlineAt,
          deadlineAt,
        );
        if (provider.id === "zhipu") {
          const inputTokens = finiteNonnegative(response.usage?.prompt_tokens);
          const outputTokens = finiteNonnegative(response.usage?.completion_tokens);
          const usage = inputTokens !== undefined && outputTokens !== undefined ? Math.ceil(inputTokens + outputTokens) : providerBudgetReservation;
          await this.prisma.aiRun.update({ where: { id: run.id }, data: { quotaReservation: usage, inputTokens, outputTokens } });
        }
        responseProviderUsage =
          finiteNonnegative(response.usage?.neurons) ??
          (provider.id === "cloudflare" && providerBudgetReservation > 0
            ? providerBudgetReservation
            : undefined);
        const content = responseContent(response);
        if (!content)
          throw new ModelCallError("模型返回为空", "EMPTY_RESPONSE", true);

        let parsed: Record<string, unknown>;
        try {
          const value = JSON.parse(cleanJson(content)) as unknown;
          if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("JSON root must be an object");
          parsed = value as Record<string, unknown>;
        } catch {
          throw new ModelCallError(
            "模型返回的 JSON 无法解析",
            "INVALID_JSON",
            true,
          );
        }

        let validation: ResponseValidationResult<T>;
        try {
          validation = responseSchema.validate(parsed);
        } catch {
          throw new ModelCallError(
            "服务端响应校验器执行失败",
            "RESPONSE_VALIDATOR_ERROR",
            false,
          );
        }
        if (!validation.success)
          throw new ModelCallError(
            `模型输出不符合响应契约（${schemaIssuesSummary(validation.issues)}）`,
            "OUTPUT_SCHEMA_INVALID",
            true,
          );
        const data = validation.value;

        const actualModel = auditedModelId(response.model, candidate.model);
        const confidence = confidenceOf(data);
        const completedAt = new Date();
        const expiresAt = new Date(
          Date.now() +
            (request.cacheTtlMs ?? this.defaultCacheTtl(request.task)),
        );
        const persistenceWrites: Promise<unknown>[] = [
          this.prisma.aiRun.update({
            where: { id: run.id },
            data: {
              actualModel,
              status: "succeeded",
              ...(dataClass === "public_market"
                ? { output: data as Prisma.InputJsonValue }
                : {}),
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
            candidate.model,
            request.task,
            attemptStartedAt,
          ),
          this.updateProviderSuccess(provider.id, attemptStartedAt),
        ];
        if (dataClass === "public_market")
          persistenceWrites.push(
            this.prisma.aiCache.upsert({
              where: { key: cacheKey },
              update: {
                task: request.task,
                inputHash,
                routeRevision,
                provider: provider.id,
                model: candidate.model,
                output: data as Prisma.InputJsonValue,
                confidence,
                expiresAt,
              },
              create: {
                key: cacheKey,
                task: request.task,
                inputHash,
                routeRevision,
                provider: provider.id,
                model: candidate.model,
                output: data as Prisma.InputJsonValue,
                confidence,
                expiresAt,
              },
            }),
          );
        await Promise.all(persistenceWrites);
        this.clearCooldownProbe(provider.id, candidate.model);
        return {
          data,
          provider: provider.id,
          model: candidate.model,
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
        if (
          normalized.code === "GATEWAY_DEADLINE" ||
          normalized.code === "RESPONSE_VALIDATOR_ERROR"
        )
          break;
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
    const modelSets = await this.providerCatalogueSnapshot(force);
    const available = modelSets.filter(
      (entry): entry is ProviderCatalogueSnapshot & { models: Set<string> } =>
        entry.models instanceof Set,
    );
    if (!available.length) return undefined;
    return new Set(
      available.flatMap(({ provider, models }) =>
        [...models].map((model) => modelStateKey(provider, model)),
      ),
    );
  }

  async providerCatalogueSnapshot(force = false): Promise<ProviderCatalogueSnapshot[]> {
    return Promise.all(this.providers().map(async (provider) => {
      const models = await this.availableModelIdsFor(provider, force);
      return {
        provider: provider.id,
        // Return a copy so status consumers cannot alter execution's cache.
        models: models ? new Set(models) : undefined,
        evidence: provider.staticModelIds?.length
          ? "operator_static_route"
          : this.catalogues.get(provider.id)?.evidence ?? "catalogue_unavailable",
      };
    }));
  }

  private providers() {
    return configuredProviderRuntimes(providerOrder());
  }

  private async cachedResult<T extends Record<string, unknown>>(
    cacheKey: string,
    request: AiGatewayRequest<T>,
    input: Record<string, unknown>,
    inputHash: string,
    routeRevision: string,
    providers: ProviderRuntime[],
    dataClass: AiDataClass,
    costPolicy: AiCostPolicy,
  ): Promise<AiGatewayResult<T> | undefined> {
    if (dataClass !== "public_market") return undefined;
    const cached = await this.prisma.aiCache.findUnique({
      where: { key: cacheKey },
    });
    if (
      !cached ||
      cached.expiresAt <= new Date() ||
      cached.routeRevision !== routeRevision ||
      !cached.provider ||
      !isAiProvider(cached.provider)
    )
      return undefined;
    const provider = providers.find((entry) => entry.id === cached.provider);
    if (!provider || !provider.allowsDataClass(dataClass)) return undefined;
    const tier = provider.costTierFor(cached.model);
    if (costPolicy === "free_only" && tier !== "free" && tier !== "promotion")
      return undefined;
    let validation: ResponseValidationResult<T>;
    try {
      validation = request.responseSchema.validate(cached.output);
    } catch {
      return undefined;
    }
    if (!validation.success) return undefined;
    const data = validation.value;
    const confidence = confidenceOf(data);
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
        input: persistedInput(input, dataClass),
        output: data as Prisma.InputJsonValue,
        confidence,
        completedAt: new Date(),
      },
    });
    return {
      data,
      provider: provider.id,
      model: cached.model,
      requestedModel: cached.model,
      runId: run.id,
      cached: true,
      fallbackUsed: false,
      confidence,
    };
  }

  private async availableModelIdsFor(
    provider: ProviderRuntime,
    force = false,
    deadlineAt?: number,
    useLiveCatalogue = false,
  ) {
    if (provider.staticModelIds?.length && !useLiveCatalogue)
      return new Set(
        provider.staticModelIds.map((modelId) =>
          provider.normalizeCatalogueModelId(modelId),
        ),
      );
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
      // A previous alias can place its entire documented quota group into
      // cooldown. Re-check here because credentialIds is an initial snapshot.
      if (!this.credentialReady(provider.id, credentialId)) continue;
      try {
        const response = await fetch(provider.catalogueUrl, {
          headers: provider.headers(false, undefined, credentialId),
          redirect: "error",
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
          if (
            this.shouldFailoverCredential(
              provider,
              error,
              allCredentialIds.length,
            )
          ) {
            this.cooldownCredentialScope(
              provider,
              credentialId,
              allCredentialIds,
              error,
            );
            lastCredentialError = error;
            continue;
          }
          throw error;
        }
        if (!text.trim()) throw new Error("empty catalogue");
        const payload = JSON.parse(text) as unknown;
        for (const modelId of provider.extractCatalogueModelIds(payload))
          models.add(provider.normalizeCatalogueModelId(modelId));
        if (models.size === 0) {
          for (const modelId of provider.catalogueFallbackModelIds ?? [])
            models.add(provider.normalizeCatalogueModelId(modelId));
        }
        catalogueSucceeded = true;
        this.clearCredentialCooldown(provider.id, credentialId);
      } catch (error) {
        const normalized = this.normalizeError(error);
        if (
          this.shouldFailoverCredential(
            provider,
            normalized,
            allCredentialIds.length,
          )
        ) {
          this.cooldownCredentialScope(
            provider,
            credentialId,
            allCredentialIds,
            normalized,
          );
          lastCredentialError = normalized;
          continue;
        }
        // A successful alias already proved that the provider catalogue is
        // usable for this runtime. Do not let a later account-specific fetch
        // place the whole provider into cooldown while returning that result.
        if (normalized.providerWide && !catalogueSucceeded)
          await this.updateProviderFailure(provider.id, normalized);
        break;
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
        evidence: "live_catalogue",
      });
      return models;
    }

    // A provider catalogue is the normal source of truth.  A short network
    // outage must not take down an explicitly configured production route,
    // though.  Operators can opt in to a narrowly scoped fallback list per
    // provider.  The fallback is never inferred from a wildcard route and is
    // therefore still fail-closed for unknown models.
    const configuredFallbackEnabled =
      process.env.AI_ALLOW_CONFIGURED_CATALOGUE_FALLBACK?.trim().toLowerCase() ===
      "true";
    const configuredFallbackModels = configuredFallbackEnabled
      ? (process.env[
          `AI_${provider.id.toUpperCase()}_CATALOGUE_FALLBACK_MODELS`
        ] ?? "")
          .split(/[|,]/)
          .map((modelId) => modelId.trim())
          .filter(Boolean)
          .map((modelId) => provider.normalizeCatalogueModelId(modelId))
          .filter((modelId) =>
            provider.catalogueFallbackModelIds?.includes(modelId),
          )
      : [];
    if (configuredFallbackModels.length > 0) {
      const fallbackModels = new Set(configuredFallbackModels);
      const configuredTtl = Number(
        process.env.AI_CATALOG_REFRESH_INTERVAL_MS ?? 6 * 60 * 60_000,
      );
      const ttl = Math.max(
        60_000,
        Number.isFinite(configuredTtl) ? configuredTtl : 6 * 60 * 60_000,
      );
      this.catalogues.set(provider.id, {
        expiresAt: Date.now() + ttl,
        models: fallbackModels,
        evidence: "configured_fallback",
      });
      this.logger.warn(
        `Using configured AI catalogue fallback for ${provider.id}: ${[
          ...fallbackModels,
        ].join(", ")}`,
      );
      return fallbackModels;
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
      evidence: "catalogue_unavailable",
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
    const release = await this.acquireProviderSlot(
      provider.id,
      Math.min(candidateDeadlineAt, gatewayDeadlineAt),
    );
    try {
      return await this.callModelWithoutConcurrencyGate(
        provider,
        model,
        request,
        candidateDeadlineAt,
        gatewayDeadlineAt,
      );
    } finally {
      release();
    }
  }

  private async callModelWithoutConcurrencyGate(
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

    const maxAttempts = provider.id === "zhipu" ? 1 : Math.max(
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
      // Another credential attempted earlier in this loop may have cooled the
      // whole account/project group represented by this alias.
      if (!this.credentialReady(provider.id, credentialId)) continue;
      let moveToNextCredential = false;
      for (let httpAttempt = 1; httpAttempt <= maxAttempts; httpAttempt += 1) {
        const deadlineAt = Math.min(candidateDeadlineAt, gatewayDeadlineAt);
        await this.waitForProviderRateSlot(provider.id, deadlineAt);
        const remainingMs = deadlineAt - Date.now();
        if (remainingMs <= 0)
          throw gatewayDeadlineAt <= Date.now()
            ? this.deadlineError()
            : new ModelCallError("模型请求超时", "TIMEOUT", true);
        const timeoutMs = Math.max(
          1,
          Math.min(modelTimeoutForTask(request.task), remainingMs),
        );
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          if (provider.id === "litellm" || provider.wireApi === "responses") {
            const response = await this.aiSdk.generate(
              provider,
              model,
              request,
              credentialId,
              controller.signal,
            );
            this.clearCredentialCooldown(provider.id, credentialId);
            return response;
          }
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
            redirect: "error",
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
              this.shouldFailoverCredential(
                provider,
                normalized,
                allCredentialIds.length,
              )
            ) {
              this.cooldownCredentialScope(
                provider,
                credentialId,
                allCredentialIds,
                normalized,
              );
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
            const delayMs = httpRetryDelayMs(httpAttempt);
            if (Date.now() + delayMs >= deadlineAt)
              throw deadlineAt >= gatewayDeadlineAt
                ? this.deadlineError()
                : new ModelCallError("模型请求超时", "TIMEOUT", true);
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
              : error instanceof AiSdkHttpError && error.statusCode
                ? error.statusCode >= 200 && error.statusCode < 300
                  ? new ModelCallError(
                      "模型返回了无法解析的响应体",
                      "INVALID_PROVIDER_JSON",
                      true,
                    )
                  : this.responseError(
                      provider,
                      error.statusCode,
                      error.responseBody,
                      error.responseHeaders,
                    )
                : this.normalizeError(error);
          if (
            this.shouldFailoverCredential(
              provider,
              normalized,
              allCredentialIds.length,
            )
          ) {
            this.cooldownCredentialScope(
              provider,
              credentialId,
              allCredentialIds,
              normalized,
            );
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
          const delayMs = httpRetryDelayMs(httpAttempt);
          if (Date.now() + delayMs >= candidateDeadlineAt)
            throw candidateDeadlineAt >= gatewayDeadlineAt
              ? this.deadlineError()
              : new ModelCallError("模型请求超时", "TIMEOUT", true);
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

  private cooldownCredentialScope(
    provider: ProviderRuntime,
    credentialId: string,
    credentialIds: readonly string[],
    error: ModelCallError,
  ) {
    const quotaGroupFailure =
      !error.providerWide &&
      (error.code === "CREDITS" || error.code === "RATE_LIMIT");
    const failedGroup = this.credentialQuotaGroup(provider, credentialId);
    const affectedCredentialIds = quotaGroupFailure
      ? credentialIds.filter(
          (candidateId) =>
            this.credentialQuotaGroup(provider, candidateId) === failedGroup,
        )
      : [credentialId];
    for (const affectedCredentialId of affectedCredentialIds)
      this.cooldownCredential(provider.id, affectedCredentialId, error);
  }

  private clearCredentialCooldown(provider: AiProvider, credentialId: string) {
    this.credentialCooldowns.delete(
      this.credentialStateKey(provider, credentialId),
    );
  }

  private shouldFailoverCredential(
    provider: ProviderRuntime,
    error: ModelCallError,
    credentialCount: number,
  ) {
    if (credentialCount < 2) return false;
    if (error.code === "AUTH") return true;
    if (
      (error.code !== "CREDITS" && error.code !== "RATE_LIMIT") ||
      error.providerWide
    )
      return false;
    // Quota failures may move only to a separately documented account/project
    // group. Multiple aliases inside one group must never bypass a shared pool.
    return this.hasIndependentCredentialQuotaGroups(provider);
  }

  private hasIndependentCredentialQuotaGroups(provider: ProviderRuntime) {
    return (
      new Set(
        provider
          .credentialIds()
          .map((credentialId) =>
            this.credentialQuotaGroup(provider, credentialId),
          ),
      ).size > 1
    );
  }

  private credentialQuotaGroup(
    provider: ProviderRuntime,
    credentialId: string,
  ) {
    return (
      provider.credentialQuotaGroup?.(credentialId) ??
      (provider.quotaScope === "credential" ? credentialId : "shared")
    );
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
        !this.hasIndependentCredentialQuotaGroups(provider),
      );
    if (
      provider.id === "ovo" &&
      /(?:model[_ -]?not[_ -]?found|upstream_404_model_not_found|no available.{0,80}(?:account|model)|not supported.{0,80}(?:account|group))/i.test(
        responseText,
      )
    )
      return new ModelCallError(
        `${provider.label} 当前账号组不支持所请求模型`,
        "MODEL_NOT_AVAILABLE",
        false,
        true,
        { cooldownUntil: new Date(Date.now() + 30 * 60_000) },
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
      // A 429 is only credential-scoped when the provider explicitly says so.
      // Account/project/organization and unknown scopes are shared buckets;
      // trying another alias would merely bypass the provider's limit and can
      // violate its terms.  The registry carries the conservative scope so
      // this decision does not depend on an error body being descriptive.
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
      const senseNovaAccountWide = provider.id === "sensenova";
      const providerWide =
        provider.id === "ovo" ||
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
        // SenseNova keys share quota inside one account. A separately declared
        // account group is independent, so only a single-group runtime is
        // provider-wide here.
        (senseNovaAccountWide &&
          !this.hasIndependentCredentialQuotaGroups(provider));
      const fallbackCooldown =
        providerWide || senseNovaAccountWide ? 60_000 : 5 * 60_000;
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
      EmptyResponseBodyError.isInstance(error) ||
      NoOutputGeneratedError.isInstance(error)
    )
      return new ModelCallError("模型返回为空", "EMPTY_RESPONSE", true);
    if (
      InvalidResponseDataError.isInstance(error) ||
      JSONParseError.isInstance(error)
    )
      return new ModelCallError(
        "模型返回了无法解析的响应体",
        "INVALID_PROVIDER_JSON",
        true,
      );
    if (
      UnsupportedFunctionalityError.isInstance(error) ||
      error instanceof UnsupportedModelVersionError
    )
      return new ModelCallError(
        "当前模型不支持所需能力或协议版本",
        "MODEL_CAPABILITY",
        false,
      );
    if (NoSuchModelError.isInstance(error))
      return new ModelCallError(
        "当前模型不存在或不可用",
        "MODEL_NOT_AVAILABLE",
        false,
      );
    if (
      InvalidArgumentError.isInstance(error) ||
      InvalidPromptError.isInstance(error)
    )
      return new ModelCallError("模型调用参数无效", "INVALID_REQUEST", false);
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    )
      return new ModelCallError("模型请求超时", "TIMEOUT", true);
    return new ModelCallError("模型服务网络请求失败", "NETWORK", true);
  }

  private fairCandidateDeadline(
    deadlineAt: number,
    untriedProviders: number,
    task: AiTask,
  ) {
    const now = Date.now();
    const remaining = Math.max(1, deadlineAt - now);
    const fairShare = Math.max(
      1,
      Math.floor(remaining / (untriedProviders + 1)),
    );
    return now + Math.min(modelTimeoutForTask(task), fairShare);
  }

  private providerConcurrencyLimit(provider: AiProvider) {
    if (provider === "zhipu") return 1;
    const environmentName = `AI_PROVIDER_MAX_CONCURRENCY_${provider.toUpperCase()}`;
    const configured = Number(process.env[environmentName]);
    const fallback = provider === "ovo" ? 1 : 64;
    const maximum = provider === "ovo" ? 1 : 64;
    return Math.max(
      1,
      Math.min(
        Number.isFinite(configured) ? Math.floor(configured) : fallback,
        maximum,
      ),
    );
  }

  private async waitForProviderRateSlot(
    provider: AiProvider,
    deadlineAt: number,
  ) {
    const spacingMs = providerRequestSpacingMs(provider);
    if (!spacingMs) return;
    const now = Date.now();
    const scheduledAt = Math.max(
      now,
      this.providerNextRequestAt.get(provider) ?? now,
    );
    if (scheduledAt >= deadlineAt) throw this.deadlineError();
    this.providerNextRequestAt.set(provider, scheduledAt + spacingMs);
    const delay = scheduledAt - now;
    if (delay > 0) await sleep(delay);
  }

  private acquireProviderSlot(
    provider: AiProvider,
    deadlineAt: number,
  ): Promise<() => void> {
    let gate = this.providerConcurrencyGates.get(provider);
    if (!gate) {
      gate = { active: 0, waiters: [] };
      this.providerConcurrencyGates.set(provider, gate);
    }
    if (gate.active < this.providerConcurrencyLimit(provider)) {
      gate.active += 1;
      return Promise.resolve(this.providerSlotRelease(provider, gate));
    }
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) return Promise.reject(this.deadlineError());
    return new Promise<() => void>((resolve, reject) => {
      const waiter: ProviderSlotWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = gate!.waiters.indexOf(waiter);
          if (index >= 0) gate!.waiters.splice(index, 1);
          if (gate!.active === 0 && gate!.waiters.length === 0)
            this.providerConcurrencyGates.delete(provider);
          reject(this.deadlineError());
        }, remainingMs),
      };
      gate!.waiters.push(waiter);
    });
  }

  private providerSlotRelease(
    provider: AiProvider,
    gate: ProviderConcurrencyGate,
  ) {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      gate.active = Math.max(0, gate.active - 1);
      const waiter = gate.waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        gate.active += 1;
        waiter.resolve(this.providerSlotRelease(provider, gate));
        return;
      }
      if (gate.active === 0) this.providerConcurrencyGates.delete(provider);
    };
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
    runId?: string,
  ) {
    if (provider.id === "zhipu") {
      const policy = zhipuResourcePolicy();
      if (!Number.isFinite(policy.expiresAt.getTime()) || policy.expiresAt <= new Date() || !policy.tokenLimit || !policy.dailyTokenLimit)
        throw new ModelCallError("赠送资源已到期或额度规则无效，AI 调用已停止", "FREE_RESOURCE_EXPIRED", false, true);
      if (!runId) throw new ModelCallError("缺少额度预留记录", "FREE_QUOTA_BUDGET", false, true);
      const estimated = conservativeTokenReservation(request.messages, request.maxTokens, request.imageUrls?.length ?? 0);
      return this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(610092000)`;
        const day = new Date(); day.setUTCHours(0, 0, 0, 0);
        const total = await tx.aiRun.aggregate({ where: { quotaGroup: policy.group }, _sum: { quotaReservation: true } });
        const today = await tx.aiRun.aggregate({ where: { quotaGroup: policy.group, startedAt: { gte: day } }, _sum: { quotaReservation: true } });
        const remaining = Math.min(policy.tokenLimit - Number(total._sum.quotaReservation ?? 0), policy.dailyTokenLimit - Number(today._sum.quotaReservation ?? 0));
        if (estimated > remaining) throw new ModelCallError("赠送资源的本地预算已用尽，暂停调用", "FREE_QUOTA_BUDGET", false, true, { cooldownUntil: nextUtcDay(new Date()), quotaResetAt: nextUtcDay(new Date()), remainingTokens: Math.max(0, remaining) });
        await tx.aiRun.update({ where: { id: runId }, data: { quotaReservation: estimated, quotaGroup: policy.group } });
        return estimated;
      });
    }
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

  private async providerState(
    provider: AiProvider,
  ): Promise<CooldownState | null> {
    return this.prisma.aiProviderState.findUnique({
      where: { provider },
      select: { cooldownUntil: true, lastErrorCode: true },
    });
  }

  private async modelState(
    provider: AiProvider,
    model: string,
  ): Promise<CooldownState | null> {
    return this.prisma.aiModelState.findUnique({
      where: { provider_model: { provider, model } },
      select: { cooldownUntil: true, lastErrorCode: true },
    });
  }

  private cooldownProbeIntervalMs() {
    const configured = Number(
      process.env.AI_COOLDOWN_PROBE_INTERVAL_MS ?? 60_000,
    );
    return Math.max(
      5_000,
      Math.min(Number.isFinite(configured) ? configured : 60_000, 10 * 60_000),
    );
  }

  private canProbeCooldown(key: string, state: CooldownState | null) {
    if (!state?.cooldownUntil || state.cooldownUntil <= new Date())
      return false;
    // Never use a probe to bypass a known quota/credential boundary.  The
    // persisted recovery timestamp remains authoritative for those cases.
    if (
      state.lastErrorCode &&
      NON_PROBE_COOLDOWN_CODES.has(state.lastErrorCode)
    )
      return false;
    const lastProbeAt = this.cooldownProbeAt.get(key);
    return (
      lastProbeAt === undefined ||
      Date.now() - lastProbeAt >= this.cooldownProbeIntervalMs()
    );
  }

  private markCooldownProbe(key: string) {
    this.cooldownProbeAt.set(key, Date.now());
  }

  private clearCooldownProbe(provider: AiProvider, model: string) {
    this.cooldownProbeAt.delete(`provider:${provider}`);
    this.cooldownProbeAt.delete(`model:${modelStateKey(provider, model)}`);
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
    const defaultCooldown =
      error.code === "AUTH" || error.code === "CREDITS"
        ? 30 * 60_000
        : Number(process.env.AI_PROVIDER_CIRCUIT_COOLDOWN_MS ?? 60_000);
    const cooldownUntil =
      error.rate.cooldownUntil ??
      new Date(Date.now() + Math.max(10_000, defaultCooldown));
    const update = {
      status: "cooldown",
      cooldownUntil,
      quotaResetAt: error.rate.quotaResetAt,
      remainingRequests: error.rate.remainingRequests,
      remainingTokens: error.rate.remainingTokens,
      lastErrorCode: error.code,
      consecutiveFailures: { increment: 1 },
    } satisfies Prisma.AiProviderStateUpdateManyMutationInput;
    const updated = await this.prisma.aiProviderState.updateMany({
      where: { provider },
      data: update,
    });
    if (updated.count > 0) return;
    try {
      await this.prisma.aiProviderState.create({
        data: {
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
    } catch (createError) {
      if (!isUniqueConflict(createError)) throw createError;
      // Another request created the row between updateMany and create. Use an
      // atomic increment so concurrent failures are all retained.
      await this.prisma.aiProviderState.updateMany({
        where: { provider },
        data: update,
      });
    }
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
          input: persistedInput(input, request.dataClass ?? "user_private"),
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
        input: persistedInput(input, request.dataClass ?? "user_private"),
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
    const state = await this.modelState(provider, model);
    return Boolean(state?.cooldownUntil && state.cooldownUntil > new Date());
  }

  private async updateModelFailure(
    provider: AiProvider,
    model: string,
    task: AiTask,
    error: ModelCallError,
  ) {
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
                    error.code === "TIMEOUT" ||
                    error.code === "EMPTY_RESPONSE"
                  ? 60_000
                  : 0;
    const cooldownUntil =
      error.rate.cooldownUntil ??
      (fallbackCooldown ? new Date(Date.now() + fallbackCooldown) : undefined);
    const status =
      error.code === "MODEL_NOT_AVAILABLE" ? "unavailable" : "degraded";
    const now = new Date();
    const update = {
      role: modelRole(provider, model, task),
      configured: true,
      status,
      cooldownUntil,
      quotaResetAt: error.rate.quotaResetAt,
      consecutiveFailures: { increment: 1 },
      lastFailureAt: now,
      lastErrorCode: error.code,
      lastCheckedAt: now,
    } satisfies Prisma.AiModelStateUpdateManyMutationInput;
    const updated = await this.prisma.aiModelState.updateMany({
      where: { provider, model },
      data: update,
    });
    if (updated.count > 0) return;
    try {
      await this.prisma.aiModelState.create({
        data: {
          model,
          provider,
          role: modelRole(provider, model, task),
          configured: true,
          status,
          cooldownUntil,
          quotaResetAt: error.rate.quotaResetAt,
          consecutiveFailures: 1,
          lastFailureAt: now,
          lastErrorCode: error.code,
        },
      });
    } catch (createError) {
      if (!isUniqueConflict(createError)) throw createError;
      await this.prisma.aiModelState.updateMany({
        where: { provider, model },
        data: update,
      });
    }
  }

  private defaultCacheTtl(task: AiTask) {
    if (task === "market_analysis" || task === "crawler_diagnosis")
      return 60 * 60_000;
    if (task === "seller_analysis") return 6 * 60 * 60_000;
    return 30 * 24 * 60 * 60_000;
  }
}
