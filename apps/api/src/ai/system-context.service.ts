import { Injectable, Optional } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { PrismaService } from "../prisma.service.js";
import { configuredProviderRuntimes } from "./ai-provider-registry.js";
import { AiGatewayService } from "./ai-gateway.service.js";
import { isAiProvider } from "./ai-model-catalog.js";

const queueNames = [
  "source-search",
  "image-classification",
  "item-status-refresh",
  "seller-profile-backfill",
  "url-analysis",
  "inventory-maintenance",
  "disliked-maintenance",
  "market-intel-refresh",
  "title-translation",
  "item-detail-translation",
  "ai-operations",
];

@Injectable()
export class SystemContextService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly gateway?: AiGatewayService,
  ) {}

  async snapshot(options: { includePrivateActivity?: boolean } = {}) {
    const now = new Date();
    const configuredProviders = configuredProviderRuntimes();
    const since24h = new Date(now.getTime() - 24 * 60 * 60_000);
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const [
      inventoryCount,
      activeListings,
      newProducts24h,
      listingTypes,
      sources,
      crawlerJobs,
      aiTasks,
      aiModels,
      aiProviderStates,
      aiCacheEntries,
      marketSummary,
      recentErrors,
      recentUserActivity,
      queues,
    ] = await Promise.all([
      this.prisma.item.count(),
      this.prisma.item.count({
        where: { archivedAt: null, ignored: false, purchaseRecord: null },
      }),
      this.prisma.item.count({ where: { detectedAt: { gte: since24h } } }),
      this.prisma.item.groupBy({
        by: ["listingType"],
        where: { archivedAt: null, ignored: false, purchaseRecord: null },
        _count: { _all: true },
      }),
      this.prisma.source.findMany({
        where: { enabled: true },
        select: {
          key: true,
          displayName: true,
          failureCount: true,
          circuitOpenAt: true,
          updatedAt: true,
        },
        orderBy: { displayName: "asc" },
      }),
      this.prisma.crawlJob.groupBy({
        by: ["status"],
        where: { createdAt: { gte: since24h }, jobType: "search" },
        _count: { _all: true },
      }),
      this.prisma.aiRun.groupBy({
        by: ["task", "status"],
        where: { startedAt: { gte: startOfDay } },
        _count: { _all: true },
      }),
      this.prisma.aiModelState.findMany({
        select: {
          model: true,
          provider: true,
          role: true,
          status: true,
          cooldownUntil: true,
          quotaResetAt: true,
          consecutiveFailures: true,
          lastSuccessAt: true,
          lastFailureAt: true,
          lastErrorCode: true,
        },
        orderBy: { model: "asc" },
      }),
      this.prisma.aiProviderState.findMany({
        select: {
          provider: true,
          status: true,
          cooldownUntil: true,
          quotaResetAt: true,
          remainingRequests: true,
          remainingTokens: true,
          lastErrorCode: true,
          consecutiveFailures: true,
          updatedAt: true,
        },
        orderBy: { provider: "asc" },
      }),
      this.prisma.aiCache.count({
        where: { expiresAt: { gt: now }, provider: { not: null } },
      }),
      Promise.all([
        this.prisma.marketIntel.count({
          where: { detectedAt: { gte: since24h } },
        }),
        this.prisma.keywordInsight.findMany({
          where: { recommended: true },
          orderBy: { lastAnalyzedAt: "desc" },
          take: 8,
        }),
      ]),
      Promise.all([
        this.prisma.crawlJob.findMany({
          where: { status: "failed" },
          select: {
            id: true,
            errorText: true,
            createdAt: true,
            source: { select: { displayName: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 6,
        }),
        this.prisma.aiRun.findMany({
          where: { status: "failed" },
          select: {
            id: true,
            task: true,
            provider: true,
            requestedModel: true,
            attempt: true,
            errorCode: true,
            startedAt: true,
          },
          orderBy: { startedAt: "desc" },
          take: 6,
        }),
      ]),
      options.includePrivateActivity === false
        ? Promise.resolve(null)
        : Promise.all([
            this.prisma.item.count({
              where: { favorite: true, updatedAt: { gte: since24h } },
            }),
            this.prisma.purchaseRecord.count({
              where: { purchasedAt: { gte: since24h } },
            }),
            this.prisma.discoveryFeedback.groupBy({
              by: ["action"],
              where: { timestamp: { gte: since24h } },
              _count: { _all: true },
            }),
          ]),
      this.queueSnapshot(),
    ]);

    const liveAiStates = await this.liveProviderStates(now, aiModels);

    // Persisted cooldown rows are historical evidence. A recovered key or a
    // successful live catalogue must win for the assistant's current context,
    // otherwise it can report a provider as unavailable after recovery.
    const providerStates = this.mergeProviderStates(
      aiProviderStates,
      liveAiStates?.providers ?? null,
      now,
    );
    const modelStates = this.mergeModelStates(
      aiModels,
      liveAiStates?.models ?? null,
    );

    return {
      generatedAt: now.toISOString(),
      inventory: {
        totalListings: inventoryCount,
        activeListings,
        newProducts24h,
        listingTypes: Object.fromEntries(
          listingTypes.map((entry) => [entry.listingType, entry._count._all]),
        ),
      },
      crawlers: {
        jobs24h: Object.fromEntries(
          crawlerJobs.map((entry) => [entry.status, entry._count._all]),
        ),
        sources: sources.map((source) => ({
          ...source,
          healthy:
            source.failureCount === 0 ||
            !source.circuitOpenAt ||
            now.getTime() - source.circuitOpenAt.getTime() > 15 * 60_000,
        })),
      },
      ai: {
        providers: configuredProviders.map((provider) => ({
          id: provider.id,
          label: provider.label,
          tier: provider.apiTier,
        })),
        providerConfigured: configuredProviders.length > 0,
        providerStates,
        liveProviderStates: liveAiStates?.providers ?? null,
        liveModelStates: liveAiStates?.models ?? null,
        tasksToday: aiTasks,
        models: modelStates,
        cacheEntries: aiCacheEntries,
      },
      queues,
      market: {
        intel24h: marketSummary[0],
        keywords: marketSummary[1],
      },
      recentErrors: {
        crawler: recentErrors[0],
        ai: recentErrors[1],
      },
      ...(recentUserActivity
        ? {
            recentUserActivity: {
              favorites24h: recentUserActivity[0],
              purchases24h: recentUserActivity[1],
              discovery: recentUserActivity[2],
            },
          }
        : {}),
    };
  }

  private async liveProviderStates(
    now: Date,
    modelStates: Array<{
      provider: string;
      model: string;
      role: string;
      status: string;
      cooldownUntil: Date | null;
      quotaResetAt: Date | null;
      consecutiveFailures: number;
      lastSuccessAt: Date | null;
      lastFailureAt: Date | null;
      lastErrorCode: string | null;
    }>,
  ) {
    if (!this.gateway) return null;
    try {
      const [catalogues, configurations] = await Promise.all([
        this.gateway.providerCatalogueSnapshot(),
        Promise.resolve(this.gateway.providerConfigurations()),
      ]);
      const catalogueByProvider = new Map(catalogues.map((entry) => [entry.provider, entry]));
      const activeConfigurations = configurations.filter(
        (configuration) => configuration.credentialConfigured,
      );
      const providers = activeConfigurations.map((configuration) => {
        const probe = catalogueByProvider.get(configuration.provider);
        const catalogue = probe?.models;
        if (!configuration.active) {
          return {
            provider: configuration.provider,
            status: "not_configured",
            cooldownUntil: null,
            quotaResetAt: null,
            remainingRequests: null,
            remainingTokens: null,
            lastErrorCode: null,
            consecutiveFailures: 0,
            updatedAt: now,
            evidence: "inactive_configuration" as const,
            modelCount: 0,
          };
        }
        if (!catalogue) {
          return {
            provider: configuration.provider,
            status: "unverified",
            cooldownUntil: null,
            quotaResetAt: null,
            remainingRequests: null,
            remainingTokens: null,
            lastErrorCode: "AI_GATEWAY_CATALOGUE_UNAVAILABLE",
            consecutiveFailures: 0,
            updatedAt: now,
            evidence: "catalogue_unavailable" as const,
            modelCount: 0,
          };
        }
        const modelCount = catalogue.size;
        const catalogueVerified = probe?.evidence === "live_catalogue";
        const visibleModels = modelStates.filter(
          (state) => state.provider === configuration.provider && catalogue.has(state.model),
        );
        const completedModel = visibleModels.some(
          (state) =>
            state.status === "online" && state.lastSuccessAt !== null &&
            !(state.lastFailureAt && (!state.lastSuccessAt || state.lastFailureAt > state.lastSuccessAt)) &&
            !(state.cooldownUntil && state.cooldownUntil > now),
        );
        const online = catalogueVerified && completedModel;
        const failedModels = visibleModels.filter((state) =>
          state.status === "degraded" || Boolean(state.lastFailureAt &&
            (!state.lastSuccessAt || state.lastFailureAt > state.lastSuccessAt)));
        const latestFailure = failedModels.sort((left, right) =>
          (right.lastFailureAt?.getTime() ?? 0) - (left.lastFailureAt?.getTime() ?? 0))[0];
        const allModelsCooling = visibleModels.length === modelCount && modelCount > 0 &&
          visibleModels.every((state) => state.cooldownUntil && state.cooldownUntil > now);
        return {
          provider: configuration.provider,
          status: !catalogueVerified ? "unverified" : online ? "online" :
            modelCount === 0 ? "unavailable" : allModelsCooling ? "cooldown" :
            failedModels.length > 0 ? "degraded" : "ready",
          cooldownUntil: null,
          quotaResetAt: null,
          remainingRequests: null,
          remainingTokens: null,
          lastErrorCode: online ? null : latestFailure?.lastErrorCode ?? null,
          consecutiveFailures: online ? 0 : latestFailure?.consecutiveFailures ?? 0,
          updatedAt: now,
          evidence: probe?.evidence ?? "catalogue_unavailable",
          modelCount,
        };
      });
      const models = activeConfigurations.flatMap((configuration) => {
        const probe = catalogueByProvider.get(configuration.provider);
        const catalogue = probe?.models;
        const catalogueVerified = probe?.evidence === "live_catalogue";
        const providerModels = modelStates.filter(
          (state) => state.provider === configuration.provider,
        );
        if (!configuration.active) {
          return providerModels.map((state) => ({
            ...state,
            status: "not_configured",
            lastErrorCode: null,
          }));
        }
        if (!catalogue) {
          return providerModels.map((state) => ({
            ...state,
            status:
              state.cooldownUntil && state.cooldownUntil > now
                ? state.status
                : "unverified",
            lastErrorCode:
              state.cooldownUntil && state.cooldownUntil > now
                ? state.lastErrorCode
                : "AI_GATEWAY_CATALOGUE_UNAVAILABLE",
          }));
        }
        const liveModels = [...catalogue];
        const byModel = new Map(
          providerModels.map((state) => [state.model, state]),
        );
        const merged = liveModels.map((model) => {
          const state = byModel.get(model);
          if (!state)
            return {
              provider: configuration.provider,
              model,
              role: "实时目录模型",
              status: "unverified",
              cooldownUntil: null,
              quotaResetAt: null,
              consecutiveFailures: 0,
              lastSuccessAt: null,
              lastFailureAt: null,
              lastErrorCode: null,
            };
          const cooldownActive =
            state.cooldownUntil && state.cooldownUntil > now;
          const failureNewer = Boolean(state.lastFailureAt &&
            (!state.lastSuccessAt || state.lastFailureAt > state.lastSuccessAt));
          return {
            ...state,
            status: cooldownActive
              ? state.status === "online" ? "cooldown" : state.status
              : catalogueVerified && failureNewer
                ? "degraded"
              : catalogueVerified && state.lastSuccessAt
                ? state.status === "unavailable"
                  ? "ready"
                  : state.status
                : "unverified",
            lastErrorCode: cooldownActive || failureNewer ? state.lastErrorCode : null,
          };
        });
        return [
          ...merged,
          ...providerModels
            .filter((state) => !liveModels.includes(state.model))
            .map((state) => ({
              ...state,
              status: catalogueVerified ? "unavailable" : "unverified",
              lastErrorCode: catalogueVerified ? "MODEL_NOT_AVAILABLE" : state.lastErrorCode,
            })),
        ];
      });
      return { providers, models };
    } catch {
      // An optional status probe must never make chat fail.
      return null;
    }
  }

  private mergeProviderStates(
    persisted: Array<{ provider: string; [key: string]: unknown }>,
    live:
      | NonNullable<
          Awaited<ReturnType<SystemContextService["liveProviderStates"]>>
        >["providers"]
      | null,
    now: Date,
  ) {
    if (!live) return persisted.filter(state => isAiProvider(state.provider));
    const liveByProvider = new Map<string, (typeof live)[number]>(
      live.map((state) => [state.provider, state]),
    );
    const merged = persisted.filter(state => isAiProvider(state.provider)).map((state) => {
      const current = liveByProvider.get(state.provider);
      if (!current) return state;
      const cooldownUntil = state.cooldownUntil;
      const activeCooldown =
        cooldownUntil instanceof Date &&
        cooldownUntil.getTime() > now.getTime();
      // A live catalogue proves model visibility, not that a rate/credit
      // cooldown has ended. Keep active quota state while clearing stale
      // MODEL_NOT_AVAILABLE or old provider errors after recovery.
      return activeCooldown
        ? {
            ...state,
            ...current,
            status: state.status,
            cooldownUntil: state.cooldownUntil,
            quotaResetAt: state.quotaResetAt,
            remainingRequests: state.remainingRequests,
            remainingTokens: state.remainingTokens,
            lastErrorCode: state.lastErrorCode,
            consecutiveFailures: state.consecutiveFailures,
          }
        : { ...state, ...current };
    });
    for (const state of live) {
      if (!persisted.some((entry) => entry.provider === state.provider))
        merged.push(state);
    }
    return merged;
  }

  private mergeModelStates(
    persisted: Array<{
      provider: string;
      model: string;
      [key: string]: unknown;
    }>,
    live:
      | NonNullable<
          Awaited<ReturnType<SystemContextService["liveProviderStates"]>>
        >["models"]
      | null,
  ) {
    if (!live) return persisted.filter(state => isAiProvider(state.provider));
    const coveredProviders = new Set(live.map((state) => state.provider));
    return [
      ...persisted.filter((state) => isAiProvider(state.provider) && !coveredProviders.has(state.provider)),
      ...live,
    ];
  }

  private async queueSnapshot() {
    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      connectTimeout: 2_500,
    });
    const queues: Queue[] = [];
    try {
      await redis.connect();
      for (const name of queueNames)
        queues.push(new Queue(name, { connection: redis }));
      const counts = await Promise.all(
        queues.map(async (queue) => ({
          name: queue.name,
          ...(await queue.getJobCounts(
            "waiting",
            "active",
            "delayed",
            "failed",
            "completed",
          )),
        })),
      );
      return { status: "ok", counts };
    } catch (error) {
      return {
        status: "unavailable",
        error: error instanceof Error ? error.message.slice(0, 160) : "unknown",
        counts: [],
      };
    } finally {
      await Promise.all(
        queues.map((queue) => queue.close().catch(() => undefined)),
      );
      redis.disconnect();
    }
  }
}

export type SystemSnapshot = Awaited<
  ReturnType<SystemContextService["snapshot"]>
>;
