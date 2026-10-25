import { Injectable } from "@nestjs/common";
import { Prisma } from "@tokusatsu/db";
import { PrismaService } from "../prisma.service.js";
import {
  configuredProviderRuntimes,
  providerLabel,
} from "./ai-provider-registry.js";
import {
  AI_PROVIDER_IDS,
  isAiProvider,
  providerRoutesForDisplay,
  type AiProvider,
} from "./ai-router.js";
import {
  SystemContextService,
  type SystemSnapshot,
} from "./system-context.service.js";

export const SYSTEM_TOOL_CATALOG = [
  ["search_products", "按中日文标题、描述和卖家搜索商品"],
  ["get_product", "读取一个商品实体及当前在售记录"],
  ["get_recent_products", "读取最近入库商品"],
  ["get_product_history", "读取商品价格和状态历史"],
  ["get_product_analysis", "读取商品分类、图片与物流分析"],
  ["inventory_summary", "汇总当前库存和在售记录"],
  ["inventory_breakdown", "按拍卖、直购、类别和平台拆分库存"],
  ["search_inventory", "搜索已购入的实际库存实体"],
  ["inventory_changes", "比较近期库存变化"],
  ["market_stats", "读取市场统计快照"],
  ["market_trend", "读取价格和供应趋势"],
  ["keyword_stats", "读取关键词洞察"],
  ["category_stats", "按 IP 和玩具类型汇总"],
  ["platform_stats", "按真实来源平台汇总"],
  ["seller_stats", "汇总卖家类型和数量"],
  ["seller_products", "搜索卖家及其全部公开商品"],
  ["seller_history", "读取卖家近期商品历史"],
  ["user_activity_summary", "汇总收藏与购买"],
  ["favorites", "读取收藏商品"],
  ["purchases", "读取购买记录"],
  ["feedback_summary", "汇总 AI 反馈"],
  ["crawler_status", "读取各来源抓取健康状态"],
  ["crawler_errors", "读取最近抓取错误"],
  ["crawler_statistics", "汇总抓取任务和入库量"],
  ["crawler_recent_activity", "读取最近抓取活动"],
  ["ai_system_status", "读取 AI Provider、模型路由和任务状态"],
  ["ai_model_health", "读取模型健康状态"],
  ["ai_task_queue", "读取 AI 任务和队列积压"],
  ["ai_error_summary", "读取最近 AI 错误"],
  ["ai_usage_stats", "读取模型调用量和 token 用量"],
  ["ai_cache_stats", "读取 AI 缓存状态"],
  ["system_health", "读取数据库、Redis 和关键业务状态"],
  ["worker_status", "读取后台 Worker 关联队列状态"],
  ["queue_status", "读取全部 BullMQ 队列状态"],
  ["service_status", "读取 API、数据库和缓存服务状态"],
  ["recent_system_errors", "读取最近系统级错误"],
] as const;

export type SystemToolName = (typeof SYSTEM_TOOL_CATALOG)[number][0];

const toolNames = new Set<SystemToolName>(
  SYSTEM_TOOL_CATALOG.map(([name]) => name),
);

@Injectable()
export class SystemToolRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: SystemContextService,
  ) {}

  manifest() {
    return SYSTEM_TOOL_CATALOG.map(([name, description]) => ({
      name,
      description,
    }));
  }

  validateSelection(values: unknown) {
    if (!Array.isArray(values)) return [];
    return [
      ...new Set(
        values.filter(
          (value): value is SystemToolName =>
            typeof value === "string" && toolNames.has(value as SystemToolName),
        ),
      ),
    ].slice(0, 8);
  }

  fallbackSelection(question: string): SystemToolName[] {
    const selected = new Set<SystemToolName>();
    const asksAi =
      /AI|provider|API|接口|模型(?:池|状态|调用|服务|额度|配额|切换)|翻译(?:模型|接口|服务)/i.test(
        question,
      );
    const asksInventoryAggregate =
      /(?:系统|库存).*(?:总数|数量|多少|统计|概况)|(?:总数|数量|多少).*(?:商品|库存)/i.test(
        question,
      );
    const asksProducts =
      /商品|找|腰带|软胶|手办|玩具|批量|价格|拍卖|直购/i.test(question) ||
      (/模型/i.test(question) && !asksAi);
    if (asksProducts && !asksInventoryAggregate) {
      selected.add("search_products");
      selected.add("get_product_analysis");
    }
    if (/库存|新增|入库|变化|商品总数|在售数量/i.test(question)) {
      selected.add("inventory_summary");
      selected.add("inventory_changes");
      selected.add("platform_stats");
    }
    if (/市场|趋势|关键词|便宜|行情|价格/i.test(question)) {
      selected.add("market_trend");
      selected.add("keyword_stats");
    }
    if (/卖家|商家|店铺|出品者/i.test(question)) {
      selected.add("seller_stats");
      selected.add("seller_products");
    }
    if (/收藏|购买|买过|浏览|偏好|反馈/i.test(question)) {
      selected.add("user_activity_summary");
      selected.add("favorites");
      selected.add("purchases");
    }
    if (/爬虫|抓取|来源|crawler|监控/i.test(question)) {
      selected.add("crawler_status");
      selected.add("crawler_errors");
    }
    if (asksAi || /任务|积压|缓存/i.test(question)) {
      selected.add("ai_system_status");
    }
    if (/AI.*(?:任务|积压|队列)|(?:任务|积压|队列).*AI/i.test(question)) {
      selected.add("ai_task_queue");
    }
    if (
      /系统|健康|服务/i.test(question) ||
      (/现在怎么样/i.test(question) && !asksAi)
    ) {
      selected.add("system_health");
    }
    if (/队列|worker/i.test(question)) {
      selected.add("queue_status");
    }
    if (/异常|错误|失败/i.test(question)) {
      selected.add("recent_system_errors");
    }
    if (!selected.size) {
      selected.add("system_health");
    }
    return [...selected].slice(0, 8);
  }

  async execute(
    names: SystemToolName[],
    question: string,
    snapshot?: SystemSnapshot | Promise<SystemSnapshot>,
  ) {
    return Promise.all(
      names.map(async (name) => {
        try {
          return {
            name,
            ok: true,
            data: await this.executeOne(name, question, snapshot),
          };
        } catch (error) {
          return {
            name,
            ok: false,
            error:
              error instanceof Error ? error.message.slice(0, 300) : "unknown",
          };
        }
      }),
    );
  }

  private async executeOne(
    name: SystemToolName,
    question: string,
    snapshot?: SystemSnapshot | Promise<SystemSnapshot>,
  ) {
    const since24h = new Date(Date.now() - 24 * 60 * 60_000);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60_000);
    const terms = this.searchTerms(question);
    const listingWhere = this.listingWhere(terms);
    switch (name) {
      case "search_products":
        return this.prisma.item.findMany({
          where: listingWhere,
          orderBy: [{ detectedAt: "desc" }, { priceCurrent: "asc" }],
          take: 20,
          select: this.itemProjection(),
        });
      case "get_product":
        return this.prisma.product.findFirst({
          where: terms.length
            ? {
                OR: terms.flatMap((term) => [
                  {
                    canonicalName: {
                      contains: term,
                      mode: "insensitive" as const,
                    },
                  },
                  { titleZh: { contains: term, mode: "insensitive" as const } },
                ]),
              }
            : undefined,
          include: {
            series: true,
            manufacturerEntity: true,
            toyTypeEntity: true,
            listings: {
              where: { archivedAt: null, deletedAt: null },
              take: 12,
              select: this.itemProjection(),
            },
          },
        });
      case "get_recent_products":
        return this.prisma.item.findMany({
          where: { ...listingWhere, detectedAt: { gte: since24h } },
          orderBy: { detectedAt: "desc" },
          take: 24,
          select: this.itemProjection(),
        });
      case "get_product_history":
        return this.prisma.item.findFirst({
          where: listingWhere,
          orderBy: { detectedAt: "desc" },
          select: {
            ...this.itemProjection(),
            priceHistory: { orderBy: { observedAt: "desc" }, take: 30 },
          },
        });
      case "get_product_analysis":
        return this.prisma.item.findMany({
          where: listingWhere,
          orderBy: { detectedAt: "desc" },
          take: 12,
          select: {
            ...this.itemProjection(),
            classifications: { orderBy: { createdAt: "desc" }, take: 3 },
            logistics: true,
          },
        });
      case "inventory_summary":
        return Promise.all([
          this.prisma.inventoryOrder.aggregate({
            _sum: { remainingQuantity: true },
            _count: { _all: true },
          }),
          this.prisma.item.count({
            where: { lifecycleStatus: "live" },
          }),
          this.prisma.purchaseRecord.count(),
        ]);
      case "inventory_breakdown":
        return Promise.all([
          this.prisma.item.groupBy({
            by: ["listingType"],
            where: { lifecycleStatus: "live" },
            _count: { _all: true },
          }),
          this.prisma.item.groupBy({
            by: ["categoryIp", "categoryToyType"],
            where: { lifecycleStatus: "live" },
            _count: { _all: true },
            orderBy: { _count: { categoryIp: "desc" } },
            take: 30,
          }),
        ]);
      case "search_inventory":
        return this.prisma.inventoryOrder.findMany({
          where: terms.length
            ? {
                name: { contains: terms[0], mode: "insensitive" },
              }
            : undefined,
          orderBy: { updatedAt: "desc" },
          take: 30,
        });
      case "inventory_changes":
        return Promise.all([
          this.prisma.item.count({ where: { detectedAt: { gte: since24h } } }),
          this.prisma.item.count({ where: { detectedAt: { gte: since7d } } }),
          this.prisma.purchaseRecord.count({
            where: { purchasedAt: { gte: since7d } },
          }),
        ]);
      case "market_stats":
      case "market_trend":
        return this.prisma.marketSnapshot.findMany({
          where: { windowDays: { in: [7, 30] } },
          include: {
            product: { select: { canonicalName: true, titleZh: true } },
          },
          orderBy: { snapshotDate: "desc" },
          take: 30,
        });
      case "keyword_stats":
        return this.prisma.keywordInsight.findMany({
          orderBy: [{ recommended: "desc" }, { lastAnalyzedAt: "desc" }],
          take: 30,
        });
      case "category_stats":
        return this.prisma.item.groupBy({
          by: ["categoryIp", "categoryToyType"],
          where: { archivedAt: null, deletedAt: null, ignored: false },
          _count: { _all: true },
          _avg: { priceCurrent: true, quantityEst: true },
          orderBy: { _count: { categoryIp: "desc" } },
          take: 30,
        });
      case "platform_stats":
        return this.prisma.source.findMany({
          where: { enabled: true },
          select: {
            key: true,
            displayName: true,
            failureCount: true,
            _count: { select: { items: true } },
          },
          orderBy: { displayName: "asc" },
        });
      case "seller_stats":
        return this.prisma.seller.groupBy({
          by: ["sellerType"],
          _count: { _all: true },
        });
      case "seller_products":
      case "seller_history":
        return this.prisma.seller.findMany({
          where: terms.length
            ? { name: { contains: terms[0], mode: "insensitive" } }
            : undefined,
          select: {
            id: true,
            name: true,
            sellerType: true,
            locationText: true,
            profileUrl: true,
            source: { select: { displayName: true } },
            items: {
              orderBy: { detectedAt: "desc" },
              take: 30,
              select: this.itemProjection(),
            },
          },
          orderBy: { updatedAt: "desc" },
          take: 12,
        });
      case "user_activity_summary":
        return Promise.all([
          this.prisma.item.count({ where: { favorite: true } }),
          this.prisma.purchaseRecord.count(),
        ]);
      case "favorites":
        return this.prisma.item.findMany({
          where: { favorite: true, categoryToyType: { not: "card" } },
          orderBy: { updatedAt: "desc" },
          take: 30,
          select: this.itemProjection(),
        });
      case "purchases":
        return this.prisma.purchaseRecord.findMany({
          include: { item: { select: this.itemProjection() } },
          orderBy: { purchasedAt: "desc" },
          take: 30,
        });
      case "feedback_summary":
        return this.prisma.aiFeedback.groupBy({
          by: ["action"],
          _count: { _all: true },
        });
      case "ai_system_status": {
        // The context snapshot is the single source of truth for the live
        // catalogue probe.  Falling back to the persisted rows is retained
        // only for callers that do not provide a snapshot (for example older
        // integrations and isolated unit tests).
        const current = await this.resolveSnapshot(snapshot);
        return this.aiSystemStatus(since24h, current);
      }
      case "crawler_status": {
        const current = await this.resolveSnapshot(snapshot);
        return { generatedAt: current.generatedAt, ...current.crawlers };
      }
      case "system_health": {
        const current = await this.resolveSnapshot(snapshot);
        return {
          generatedAt: current.generatedAt,
          inventory: current.inventory,
          crawlerJobs24h: current.crawlers.jobs24h,
          sourceHealth: current.crawlers.sources,
          ai: current.ai,
          queues: current.queues,
          recentErrors: current.recentErrors,
        };
      }
      case "worker_status":
      case "queue_status": {
        const current = await this.resolveSnapshot(snapshot);
        return { generatedAt: current.generatedAt, ...current.queues };
      }
      case "service_status": {
        const current = await this.resolveSnapshot(snapshot);
        return {
          generatedAt: current.generatedAt,
          database: "ok",
          redis: current.queues.status,
          aiConfigured: current.ai.providerConfigured,
          configuredProviders: current.ai.providers,
        };
      }
      case "ai_task_queue": {
        const current = await this.resolveSnapshot(snapshot);
        return {
          generatedAt: current.generatedAt,
          tasksToday: current.ai.tasksToday,
          queues: current.queues.counts.filter((queue) =>
            [
              "ai-operations",
              "title-translation",
              "item-detail-translation",
              "image-classification",
            ].includes(queue.name),
          ),
        };
      }
      case "crawler_errors":
      case "recent_system_errors":
        return this.prisma.crawlJob.findMany({
          where: { status: "failed" },
          select: {
            id: true,
            jobType: true,
            status: true,
            errorText: true,
            createdAt: true,
            source: { select: { displayName: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 8,
        });
      case "crawler_statistics":
        return this.prisma.crawlJob.groupBy({
          by: ["status", "jobType"],
          where: { createdAt: { gte: since7d } },
          _count: { _all: true },
        });
      case "crawler_recent_activity":
        return this.prisma.crawlJob.findMany({
          include: { source: { select: { displayName: true } } },
          orderBy: { createdAt: "desc" },
          take: 30,
        });
      case "ai_model_health": {
        const current = await this.resolveSnapshot(snapshot).catch(
          () => undefined,
        );
        const liveModels = current?.ai.liveModelStates ?? current?.ai.models;
        // `liveModelStates` is catalogue-normalized and therefore does not
        // resurrect stale preferred aliases (e.g. an OVO wildcard route).
        // It is safe to expose the persisted model rows only when no live
        // snapshot is available.
        if (liveModels) return liveModels;
        return this.prisma.aiModelState.findMany({ orderBy: { model: "asc" } });
      }
      case "ai_error_summary":
        return this.prisma.aiRun.findMany({
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
          take: 12,
        });
      case "ai_usage_stats":
        return this.prisma.aiRun.groupBy({
          by: ["provider", "requestedModel", "status"],
          where: { startedAt: { gte: since7d } },
          _count: { _all: true },
          _sum: { inputTokens: true, outputTokens: true, latencyMs: true },
        });
      case "ai_cache_stats":
        const activeCacheWhere = {
          provider: { not: null },
          expiresAt: { gt: new Date() },
        } satisfies Prisma.AiCacheWhereInput;
        return Promise.all([
          this.prisma.aiCache.count({
            where: activeCacheWhere,
          }),
          this.prisma.aiCache.groupBy({
            by: ["provider", "task"],
            where: activeCacheWhere,
            _count: { _all: true },
          }),
        ]);
    }
  }

  private resolveSnapshot(
    snapshot?: SystemSnapshot | Promise<SystemSnapshot>,
  ): Promise<SystemSnapshot> {
    return snapshot ? Promise.resolve(snapshot) : this.context.snapshot();
  }

  private async aiSystemStatus(since24h: Date, current?: SystemSnapshot) {
    type RegistryProviderState = {
      provider: string;
      status?: string | null;
      cooldownUntil?: Date | null;
      quotaResetAt?: Date | null;
      remainingRequests?: number | null;
      remainingTokens?: number | null;
      lastErrorCode?: string | null;
      consecutiveFailures?: number | null;
      updatedAt?: Date | null;
      evidence?: string;
    };
    type RegistryModelState = {
      provider: string;
      model: string;
      role?: string | null;
      status?: string | null;
      cooldownUntil?: Date | null;
      quotaResetAt?: Date | null;
      consecutiveFailures?: number | null;
      lastSuccessAt?: Date | null;
      lastFailureAt?: Date | null;
      lastErrorCode?: string | null;
    };
    const configured = configuredProviderRuntimes();
    const configuredIds = new Set(configured.map((provider) => provider.id));
    const routes = providerRoutesForDisplay() as Record<
      string,
      Record<string, string[]>
    >;
    const tasksPromise = this.prisma.aiRun.groupBy({
      by: ["provider", "task", "status"],
      where: { startedAt: { gte: since24h } },
      _count: { _all: true },
    });
    let providerStates: RegistryProviderState[];
    let models: RegistryModelState[];
    let tasks: unknown[];
    if (current) {
      providerStates = (current.ai.providerStates ??
        current.ai.liveProviderStates ??
        []) as RegistryProviderState[];
      models = (current.ai.liveModelStates ??
        current.ai.models ??
        []) as RegistryModelState[];
      tasks = (await tasksPromise) as unknown[];
    } else {
      [providerStates, models, tasks] = (await Promise.all([
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
        this.prisma.aiModelState.findMany({
          select: {
            provider: true,
            model: true,
            role: true,
            status: true,
            cooldownUntil: true,
            quotaResetAt: true,
            consecutiveFailures: true,
            lastSuccessAt: true,
            lastFailureAt: true,
            lastErrorCode: true,
          },
          orderBy: [{ provider: "asc" }, { model: "asc" }],
        }),
        tasksPromise,
      ])) as [RegistryProviderState[], RegistryModelState[], unknown[]];
    }
    const stateByProvider = new Map(
      providerStates.map((state) => [state.provider, state]),
    );
    const configuredSnapshotIds = new Set(
      current?.ai.providers?.map((provider) => provider.id) ?? [],
    );
    const liveModels = current?.ai.liveModelStates;
    const usingLiveCatalogue = liveModels != null;
    const liveProviderStates = current?.ai.liveProviderStates ?? [];
    const liveStateByProvider = new Map<string, RegistryProviderState>(
      (liveProviderStates as RegistryProviderState[]).map((state) => [
        state.provider,
        state,
      ]),
    );
    const providerIds = [
      ...new Set([
        ...AI_PROVIDER_IDS,
        ...configured.map((provider) => provider.id),
        ...configuredSnapshotIds,
        ...providerStates.map((state) => state.provider),
        ...models.map((model) => model.provider),
      ]),
    ];
    return {
      generatedAt: new Date().toISOString(),
      providers: providerIds.map((provider) => {
        const state = stateByProvider.get(provider);
        const providerConfigured =
          configuredIds.has(provider as AiProvider) ||
          configuredSnapshotIds.has(provider as AiProvider);
        const providerRuntime = configured.find(
          (runtime) => runtime.id === provider,
        );
        const now = Date.now();
        const providerCooldownActive = Boolean(
          state?.cooldownUntil && state.cooldownUntil.getTime() > now,
        );
        // A live catalogue (including a wildcard OVO route) is authoritative.
        // Never compare it against the stale static preferred-model alias.
        const routedModelIds = usingLiveCatalogue
          ? new Set(
              models
                .filter((model) => model.provider === provider)
                .map((model) => model.model),
            )
          : new Set(Object.values(routes[provider] ?? {}).flat());
        const routedModels = models.filter(
          (model) =>
            model.provider === provider && routedModelIds.has(model.model),
        );
        const allRoutedModelsUnavailable =
          routedModels.length > 0 &&
          routedModels.every((model) => model.status === "unavailable");
        const staticRouteUnverified = Boolean(
          providerRuntime?.staticModelIds?.length &&
            routedModelIds.size > 0 &&
            routedModels.length === 0,
        );
        const allRoutedModelsCooling =
          routedModels.length > 0 &&
          routedModels.every(
            (model) =>
              model.status === "unavailable" ||
              Boolean(
                model.cooldownUntil && model.cooldownUntil.getTime() > now,
              ),
          );
        const liveProvider = liveStateByProvider.get(provider);
        const catalogueUnavailable =
          liveProvider?.evidence === "catalogue_unavailable" ||
          (!usingLiveCatalogue &&
            state?.lastErrorCode === "AI_GATEWAY_CATALOGUE_UNAVAILABLE");
        const successfulLiveModel =
          usingLiveCatalogue &&
          routedModels.some((model) => model.status === "online");
        return {
          provider,
          label: isAiProvider(provider)
            ? providerLabel(provider as AiProvider)
            : provider,
          configured: providerConfigured,
          status: catalogueUnavailable
            ? "unverified"
            : !providerConfigured
              ? (state?.status ?? "not_configured")
              : successfulLiveModel
                ? "online"
                : routedModelIds.size === 0 || allRoutedModelsUnavailable
                  ? "unavailable"
                  : providerCooldownActive
                    ? "cooldown"
                    : staticRouteUnverified
                      ? "unverified"
                      : allRoutedModelsCooling
                        ? "cooldown"
                        : state?.status === "cooldown"
                          ? "degraded"
                          : (state?.status ?? "ready"),
          cooldownUntil: state?.cooldownUntil ?? null,
          quotaResetAt: state?.quotaResetAt ?? null,
          remainingRequests: state?.remainingRequests ?? null,
          remainingTokens: state?.remainingTokens ?? null,
          lastErrorCode: state?.lastErrorCode ?? null,
          consecutiveFailures: state?.consecutiveFailures ?? 0,
          updatedAt: state?.updatedAt ?? null,
        };
      }),
      models,
      tasks24h: tasks,
    };
  }

  private searchTerms(question: string) {
    return [
      ...new Set(
        question
          .replace(/[，。！？、；：,.!?;:\n\r()[\]{}]/g, " ")
          .split(/\s+/)
          .map((term) => term.trim())
          .filter(
            (term) =>
              term.length >= 2 &&
              !/^(现在|当前|系统|商品|分析|查看|什么|哪些|怎么|情况|一下)$/.test(
                term,
              ),
          ),
      ),
    ].slice(0, 8);
  }

  private listingWhere(terms: string[]): Prisma.ItemWhereInput {
    return {
      archivedAt: null,
      deletedAt: null,
      ignored: false,
      channel: "online",
      categoryToyType: { not: "card" },
      ...(terms.length
        ? {
            OR: terms.flatMap((term) => [
              { titleRaw: { contains: term, mode: "insensitive" as const } },
              { titleZh: { contains: term, mode: "insensitive" as const } },
              {
                descriptionRaw: {
                  contains: term,
                  mode: "insensitive" as const,
                },
              },
              {
                descriptionZh: { contains: term, mode: "insensitive" as const },
              },
            ]),
          }
        : {}),
    };
  }

  private itemProjection() {
    return {
      id: true,
      productId: true,
      titleRaw: true,
      titleZh: true,
      sourceUrl: true,
      priceCurrent: true,
      shippingFee: true,
      priceTotalEst: true,
      quantityEst: true,
      listingType: true,
      auctionEndAt: true,
      conditionRaw: true,
      conditionZh: true,
      status: true,
      favorite: true,
      detectedAt: true,
      source: { select: { key: true, displayName: true } },
      seller: { select: { id: true, name: true, sellerType: true } },
      images: {
        orderBy: { position: "asc" as const },
        take: 3,
        select: { url: true, position: true },
      },
    } satisfies Prisma.ItemSelect;
  }
}
