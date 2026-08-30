import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@tokusatsu/db";
import { PrismaService } from "../prisma.service.js";
import { AiGatewayService } from "./ai-gateway.service.js";
import { SystemContextService } from "./system-context.service.js";
import { SystemToolRegistryService } from "./system-tool-registry.service.js";
import { providerLabel } from "./ai-provider-registry.js";
import {
  AI_PROVIDER_IDS,
  isAiProvider,
  modelRoleLabels,
  modelStateKey,
  providerRoutesForDisplay,
  type AiProvider,
} from "./ai-router.js";
import type {
  AiFeedbackDto,
  AssistantChatDto,
  ImageAnalysisDto,
} from "./ai.dto.js";
import { publicAiCostPolicy } from "./public-ai-access.guard.js";

const discoveryKeywords = [
  "まとめ売り",
  "大量",
  "処分",
  "ジャンク",
  "引退",
  "セット",
  "昔のおもちゃ",
  "おもちゃ箱",
  "子供が遊んでいた",
  "詳細不明",
  "写真のものが全て",
  "倉庫整理",
  "断捨離",
];

const periodDays = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
} as const;

export const AI_CHAT_PROMPT_MAX_CHARS = 28_000;

const ASSISTANT_SYSTEM_PROMPT =
  '你是“假面采购”的 Central AI Brain（中央智能大脑），不是独立聊天插件。你只能根据用户消息、Current System Snapshot 和本轮工具结果综合回答，不得虚构商品、卖家、库存、价格、平台或监控状态。分析市场变化时必须检查抓取完整性和来源健康；分析系统时要联系队列、Crawler 和模型状态。优先使用自然、完整且简洁的中文；不确定时明确说明缺少什么证据。涉及商品时把真实 id 仅写入 referencedItemIds，answerZh 正文中禁止显示 UUID，并说明每件商品为什么值得看；涉及卖家时结合公开资料但不得推断私密身份；涉及系统状态时引用 generatedAt。AI 只有只读分析权，不得声称已购买、删除、改配置或执行生产操作。不要输出评分、置信度或 Markdown 符号，只用纯文本和普通换行，answerZh 尽量控制在 1000 个汉字内。返回严格 JSON：{"answerZh":"可直接展示的纯文本中文答案","referencedItemIds":["真实商品id，最多8个"],"suggestions":["最多4个可继续追问的问题"]}。';

const itemContextTools = new Set([
  "search_products",
  "get_product",
  "get_recent_products",
  "get_product_history",
  "get_product_analysis",
  "favorites",
]);
const sellerContextTools = new Set([
  "seller_stats",
  "seller_products",
  "seller_history",
]);
const intelContextTools = new Set([
  "market_stats",
  "market_trend",
  "keyword_stats",
  "category_stats",
  "platform_stats",
]);
const purchaseContextTools = new Set(["purchases", "user_activity_summary"]);
const privateChatTools = new Set([
  "favorites",
  "purchases",
  "user_activity_summary",
  "recent_views",
  "feedback_summary",
  "search_inventory",
]);

type PromptMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function compactPromptValue(
  value: unknown,
  limits: { array: number; string: number; depth: number },
  depth = 0,
): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean")
    return value;
  if (typeof value === "string")
    return value.length <= limits.string
      ? value
      : `${value.slice(0, limits.string)}…`;
  if (value instanceof Date) return value.toISOString();
  if (depth >= limits.depth) return "[已压缩]";
  if (Array.isArray(value))
    return value
      .slice(0, limits.array)
      .map((entry) => compactPromptValue(entry, limits, depth + 1));
  const record = plainRecord(value);
  if (!record) return String(value).slice(0, limits.string);
  const toJson = record.toJSON;
  if (typeof toJson === "function") {
    try {
      return compactPromptValue(toJson.call(value), limits, depth + 1);
    } catch {
      return "[无法序列化]";
    }
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      compactPromptValue(entry, limits, depth + 1),
    ]),
  );
}

function compactContextToBudget(value: unknown, budget: number) {
  const profiles = [
    { array: 20, string: 900, depth: 8 },
    { array: 12, string: 500, depth: 7 },
    { array: 8, string: 300, depth: 6 },
    { array: 5, string: 180, depth: 5 },
    { array: 3, string: 100, depth: 4 },
  ];
  for (const profile of profiles) {
    const compacted = compactPromptValue(value, profile);
    if (JSON.stringify(compacted).length <= budget) return compacted;
  }
  const record = plainRecord(value);
  return {
    generatedAt: record?.generatedAt ?? new Date().toISOString(),
    toolsUsed: record?.toolsUsed ?? [],
    truncated: true,
    note: "上下文超过本轮预算，已保留实时生成时间和工具范围。",
  };
}

function privatePublicContextKey(key: string) {
  const normalized = key.replace(/[_-]/g, "").toLowerCase();
  return (
    normalized === "note" ||
    normalized === "notes" ||
    normalized === "recentuseractivity" ||
    normalized === "shoppingcart" ||
    normalized.startsWith("favorite") ||
    normalized.startsWith("purchase") ||
    normalized.startsWith("cart")
  );
}

function sanitizePublicContext(value: unknown): unknown {
  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitizePublicContext);
  const record = plainRecord(value);
  if (!record) return value;
  const toJson = record.toJSON;
  if (typeof toJson === "function") {
    try {
      return sanitizePublicContext(toJson.call(value));
    } catch {
      return "[无法序列化]";
    }
  }
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, entry]) =>
      privatePublicContextKey(key) ? [] : [[key, sanitizePublicContext(entry)]],
    ),
  );
}

const additionalProviderLabels: Record<string, string> = {
  nvidia: "NVIDIA NIM",
};

const displayProvider = (provider: string) =>
  isAiProvider(provider)
    ? providerLabel(provider)
    : (additionalProviderLabels[provider] ?? provider);

@Injectable()
export class AiSystemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGatewayService,
    private readonly systemContext: SystemContextService,
    private readonly toolRegistry: SystemToolRegistryService,
  ) {}

  async overview() {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const routes = providerRoutesForDisplay() as Record<
      string,
      Record<string, string[]>
    >;
    const [
      catalogue,
      states,
      providerStates,
      modelCalls,
      taskCalls,
      errors,
      cacheEntries,
      backlogs,
      latestBriefs,
    ] = await Promise.all([
      this.gateway.availableModelIds(),
      this.prisma.aiModelState.findMany(),
      this.prisma.aiProviderState.findMany(),
      this.prisma.aiRun.groupBy({
        by: ["provider", "requestedModel"],
        where: { startedAt: { gte: startOfDay } },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true },
      }),
      this.prisma.aiRun.groupBy({
        by: ["task", "status"],
        where: { startedAt: { gte: startOfDay } },
        _count: { _all: true },
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
        take: 12,
      }),
      this.prisma.aiCache.count({
        where: {
          expiresAt: { gt: new Date() },
          provider: { not: null },
        },
      }),
      Promise.all([
        this.prisma.item.count({
          where: {
            archivedAt: null,
            ignored: false,
            translationStatus: { not: "completed" },
            categoryToyType: { not: "card" },
          },
        }),
        this.prisma.reviewQueue.count({ where: { status: "pending" } }),
      ]),
      this.prisma.aiBrief.findMany({
        orderBy: { createdAt: "desc" },
        distinct: ["period"],
        take: 5,
      }),
    ]);
    const stateByProviderModel = new Map(
      states.map((state) => [
        modelStateKey(state.provider as AiProvider, state.model),
        state,
      ]),
    );
    const callsByProviderModel = new Map(
      modelCalls.map((entry) => [
        modelStateKey(entry.provider as AiProvider, entry.requestedModel),
        entry,
      ]),
    );
    const configuredProviders = this.gateway.configuredProviderIds();
    const configuredProviderSet = new Set<string>(configuredProviders);
    const configured = configuredProviders.length > 0;
    const providerModels = new Map<
      string,
      { provider: string; model: string }
    >();
    for (const [provider, taskRoutes] of Object.entries(routes)) {
      for (const models of Object.values(taskRoutes)) {
        for (const model of models) {
          providerModels.set(modelStateKey(provider as AiProvider, model), {
            provider,
            model,
          });
        }
      }
    }
    for (const state of states) {
      providerModels.set(
        modelStateKey(state.provider as AiProvider, state.model),
        {
          provider: state.provider,
          model: state.model,
        },
      );
    }
    for (const usage of modelCalls) {
      providerModels.set(
        modelStateKey(usage.provider as AiProvider, usage.requestedModel),
        { provider: usage.provider, model: usage.requestedModel },
      );
    }
    const models = [...providerModels.values()].map(({ provider, model }) => {
      const key = modelStateKey(provider as AiProvider, model);
      const state = stateByProviderModel.get(key);
      const inCatalogue = catalogue?.has(key);
      const usage = callsByProviderModel.get(key);
      return {
        key,
        model,
        provider,
        role: modelRoleLabels[key] ?? state?.role ?? "备用模型",
        status: !configuredProviderSet.has(provider)
          ? "not_configured"
          : inCatalogue === false
            ? "unavailable"
            : (state?.status ?? "ready"),
        callsToday: usage?._count._all ?? 0,
        inputTokensToday: usage?._sum.inputTokens ?? 0,
        outputTokensToday: usage?._sum.outputTokens ?? 0,
        consecutiveFailures: state?.consecutiveFailures ?? 0,
        cooldownUntil: state?.cooldownUntil ?? null,
        quotaResetAt: state?.quotaResetAt ?? null,
        lastSuccessAt: state?.lastSuccessAt ?? null,
        lastFailureAt: state?.lastFailureAt ?? null,
        lastErrorCode:
          inCatalogue === false
            ? "MODEL_NOT_AVAILABLE"
            : (state?.lastErrorCode ?? null),
      };
    });
    const providerStateById = new Map(
      providerStates.map((state) => [state.provider, state]),
    );
    const providerIds = [
      ...new Set([
        ...AI_PROVIDER_IDS,
        "nvidia",
        ...Object.keys(routes),
        ...configuredProviders,
        ...providerStates.map((state) => state.provider),
      ]),
    ];
    const now = Date.now();
    const providers = providerIds.map((provider) => {
      const state = providerStateById.get(provider);
      const providerConfigured = configuredProviderSet.has(provider);
      const cooldownActive = Boolean(
        state?.cooldownUntil && state.cooldownUntil.getTime() > now,
      );
      const usage = modelCalls.filter((entry) => entry.provider === provider);
      return {
        provider,
        label: displayProvider(provider),
        configured: providerConfigured,
        status: !providerConfigured
          ? "not_configured"
          : cooldownActive
            ? "cooldown"
            : (state?.status ?? "ready"),
        modelCount: models.filter((model) => model.provider === provider)
          .length,
        callsToday: usage.reduce((sum, entry) => sum + entry._count._all, 0),
        inputTokensToday: usage.reduce(
          (sum, entry) => sum + (entry._sum.inputTokens ?? 0),
          0,
        ),
        outputTokensToday: usage.reduce(
          (sum, entry) => sum + (entry._sum.outputTokens ?? 0),
          0,
        ),
        cooldownUntil: state?.cooldownUntil ?? null,
        quotaResetAt: state?.quotaResetAt ?? null,
        remainingRequests: state?.remainingRequests ?? null,
        remainingTokens: state?.remainingTokens ?? null,
        lastErrorCode: state?.lastErrorCode ?? null,
        consecutiveFailures: state?.consecutiveFailures ?? 0,
      };
    });
    return {
      configured,
      provider:
        configuredProviders.map(displayProvider).join(" + ") || "未配置",
      configuredProviders,
      providers,
      routes,
      toolRegistry: this.toolRegistry.manifest(),
      models,
      tasks: taskCalls.map((entry) => ({
        task: entry.task,
        status: entry.status,
        count: entry._count._all,
      })),
      errors,
      cacheEntries,
      backlogs: { translation: backlogs[0], review: backlogs[1] },
      latestBriefs,
      generatedAt: new Date().toISOString(),
    };
  }

  async analyzeImages(body: ImageAnalysisDto, itemId?: string) {
    let dataClass: "public_market" | "sensitive_image" = "sensitive_image";
    if (itemId) {
      const item = await this.prisma.item.findUnique({
        where: { id: itemId },
        select: {
          images: {
            select: { url: true },
          },
        },
      });
      if (!item) throw new NotFoundException("Item not found");
      const itemImageUrls = new Set(item.images.map((image) => image.url));
      const foreignImage = body.imageUrls.find(
        (url) => !itemImageUrls.has(url),
      );
      if (foreignImage)
        throw new BadRequestException(
          "Image URL does not belong to the requested item",
        );
      dataClass = "public_market";
    }
    return this.gateway.executeJson({
      task: "image_analysis",
      itemId,
      dataClass,
      costPolicy: "free_first",
      imageUrls: body.imageUrls,
      maxTokens: 5_000,
      messages: [
        {
          role: "system",
          content:
            '你是日本特摄中古商品图文分析员。必须分析全部输入图片，逐字段列出证据，区分“图片可确认”与“AI估算”，不知道就用 null，不得把估算当事实。返回字段 franchise、series、characters、toyTypes、manufacturers、quantity、sealedCount、packaging、condition、visibleDamage、missingParts、backMarkings、year、modelNumber、copyrightText，每个字段必须为 {"value":任意值或null,"confidence":0到1,"evidence":["具体依据"]}。另返回 confidence（整体0到1）和 breakdown；批量商品精确数量用 exact，区间估算用 estimatedRange。只输出 JSON 对象，不得省略上述字段。',
        },
        {
          role: "user",
          content: JSON.stringify({
            title: body.title,
            description: body.description ?? null,
            imageCount: body.imageUrls.length,
          }),
        },
      ],
    });
  }

  async chat(body: AssistantChatDto) {
    const message = body.message.trim();
    let selectedTools = this.toolRegistry.fallbackSelection(message);
    // Deterministic routing avoids spending one complete model call before the
    // actual answer. An operator can opt into the LLM planner for experiments.
    if (process.env.AI_CHAT_PLANNER_ENABLED === "true") {
      try {
        const plan = await this.gateway.executeJson<{
          selectedTools?: unknown;
          reasonZh?: unknown;
        }>({
          task: "assistant_chat",
          dataClass: "public_market",
          costPolicy: publicAiCostPolicy(),
          maxTokens: 800,
          temperature: 0.1,
          bypassCache: true,
          messages: [
            {
              role: "system",
              content:
                '你是“假面采购”中央智能大脑的只读工具规划器。根据用户问题从给定注册表选择最少且足够的工具，最多8个。市场判断必须同时考虑抓取完整性；系统问题必须包含系统或队列工具。禁止选择注册表外名称。只输出 JSON：{"selectedTools":["工具名"],"reasonZh":"简短原因"}。',
            },
            {
              role: "user",
              content: JSON.stringify({
                question: message,
                toolRegistry: this.toolRegistry.manifest(),
              }),
            },
          ],
        });
        const planned = this.toolRegistry.validateSelection(
          plan.data.selectedTools,
        );
        if (planned.length) selectedTools = planned;
      } catch {
        // Keep the deterministic selection if the optional planner is down.
      }
    }
    const needsCart = /购物车|待结算|合单/i.test(message);
    const usesPrivateContext =
      selectedTools.some((name) => privateChatTools.has(name)) ||
      needsCart ||
      /购买|买过|已购|付款|订单|凭证|收藏|心愿|我的库存/i.test(message);
    const chatDataClass = usesPrivateContext
      ? ("user_private" as const)
      : ("public_market" as const);
    const systemSnapshotPromise = this.systemContext.snapshot();
    const [systemSnapshot, toolResults] = await Promise.all([
      systemSnapshotPromise,
      this.toolRegistry.execute(selectedTools, message, systemSnapshotPromise),
    ]);
    const snapshotToolNames = new Set([
      "crawler_status",
      "system_health",
      "worker_status",
      "queue_status",
      "service_status",
      "ai_task_queue",
    ]);
    const promptToolResults = toolResults.map((result) =>
      result.ok && snapshotToolNames.has(result.name)
        ? {
            name: result.name,
            ok: true,
            data: { coveredBy: "currentSystemSnapshot" },
          }
        : result,
    );
    const needsItems = selectedTools.some((name) => itemContextTools.has(name));
    const needsSellers = selectedTools.some((name) =>
      sellerContextTools.has(name),
    );
    const needsIntel =
      selectedTools.some((name) => intelContextTools.has(name)) ||
      /资讯|新闻|论坛|讨论|行情/i.test(message);
    const needsPurchases =
      selectedTools.some((name) => purchaseContextTools.has(name)) ||
      /购买记录|买过|已购买/i.test(message);
    const terms =
      needsItems || needsSellers || needsIntel
        ? this.chatSearchTerms(message)
        : [];
    const asksAuction = /拍卖|竞拍|倒计时|auction|オークション/i.test(message);
    const asksDirect = /直购|一口价|立即购买|direct|即決/i.test(message);
    const asksFavorite = /收藏|心愿/i.test(message);
    const asksCheap = /便宜|最低|低价|性价比|划算|预算|价格/i.test(message);
    const itemWhere: Prisma.ItemWhereInput = {
      archivedAt: null,
      ignored: false,
      channel: "online",
      purchaseRecord: null,
      categoryToyType: { not: "card" },
      ...(asksAuction && !asksDirect ? { listingType: "auction" } : {}),
      ...(asksDirect && !asksAuction ? { listingType: "direct" } : {}),
      ...(asksFavorite ? { favorite: true } : {}),
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
                descriptionZh: {
                  contains: term,
                  mode: "insensitive" as const,
                },
              },
              {
                seller: {
                  name: { contains: term, mode: "insensitive" as const },
                },
              },
            ]),
          }
        : {}),
    };
    const relevantItemsPromise = needsItems
      ? this.prisma.item.findMany({
          where: itemWhere,
          orderBy: asksCheap
            ? [{ priceTotalEst: "asc" }, { detectedAt: "desc" }]
            : [{ detectedAt: "desc" }, { listedAt: "desc" }],
          take: 24,
          select: {
            id: true,
            titleRaw: true,
            titleZh: true,
            descriptionZh: true,
            sourceUrl: true,
            priceCurrent: true,
            shippingFee: true,
            priceTotalEst: true,
            quantityEst: true,
            listingType: true,
            auctionEndAt: true,
            conditionZh: true,
            conditionRaw: true,
            favorite: true,
            note: true,
            detectedAt: true,
            source: { select: { key: true, displayName: true } },
            seller: { select: { id: true, name: true, sellerType: true } },
            images: {
              orderBy: { position: "asc" },
              take: 3,
              select: { url: true, position: true },
            },
            logistics: {
              select: {
                weightGrams: true,
                packageWeightGrams: true,
                lengthMm: true,
                widthMm: true,
                heightMm: true,
                estimatedSalePriceYen: true,
                estimatedProfitYen: true,
                notes: true,
              },
            },
          },
        })
      : Promise.resolve([]);
    const relevantSellersPromise = needsSellers
      ? this.prisma.seller.findMany({
          where: terms.length
            ? {
                OR: terms.map((term) => ({
                  name: { contains: term, mode: "insensitive" as const },
                })),
              }
            : undefined,
          orderBy: { updatedAt: "desc" },
          take: 8,
          select: {
            id: true,
            name: true,
            sellerType: true,
            locationText: true,
            sourceData: true,
            source: { select: { key: true, displayName: true } },
            _count: { select: { items: true } },
          },
        })
      : Promise.resolve([]);
    const latestIntelPromise = needsIntel
      ? this.prisma.marketIntel.findMany({
          where: terms.length
            ? {
                OR: terms.flatMap((term) => [
                  {
                    titleRaw: {
                      contains: term,
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    titleZh: {
                      contains: term,
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    bodyRaw: {
                      contains: term,
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    bodyZh: {
                      contains: term,
                      mode: "insensitive" as const,
                    },
                  },
                ]),
              }
            : undefined,
          orderBy: [{ publishedAt: "desc" }, { detectedAt: "desc" }],
          take: 8,
          select: {
            id: true,
            kind: true,
            sourcePlatform: true,
            titleZh: true,
            titleRaw: true,
            bodyZh: true,
            publishedAt: true,
          },
        })
      : Promise.resolve([]);
    const cartPromise = needsCart
      ? this.prisma.shoppingCart.findUnique({
          where: { key: "shared-procurement-workspace" },
          select: {
            _count: { select: { items: true } },
            updatedAt: true,
            items: {
              orderBy: { createdAt: "desc" },
              take: 12,
              select: {
                item: {
                  select: {
                    id: true,
                    titleRaw: true,
                    titleZh: true,
                    priceCurrent: true,
                    shippingFee: true,
                    source: { select: { displayName: true } },
                  },
                },
              },
            },
          },
        })
      : Promise.resolve(null);
    const recentPurchasesPromise = needsPurchases
      ? this.prisma.purchaseRecord.findMany({
          orderBy: { purchasedAt: "desc" },
          take: 12,
          select: {
            id: true,
            purchaseAmount: true,
            purchasedAt: true,
            note: true,
            verifiedAt: true,
            item: {
              select: {
                id: true,
                titleRaw: true,
                titleZh: true,
                source: { select: { displayName: true } },
              },
            },
          },
        })
      : Promise.resolve([]);
    const [relevantItems, relevantSellers, latestIntel, cart, recentPurchases] =
      await Promise.all([
        relevantItemsPromise,
        relevantSellersPromise,
        latestIntelPromise,
        cartPromise,
        recentPurchasesPromise,
      ]);

    const context = {
      generatedAt: systemSnapshot.generatedAt,
      currentSystemSnapshot: systemSnapshot,
      toolsUsed: selectedTools,
      toolResults: promptToolResults,
      ...(needsItems
        ? {
            relevantItems: relevantItems.map((item) => {
              const publicLogistics = item.logistics
                ? {
                    weightGrams: item.logistics.weightGrams,
                    packageWeightGrams: item.logistics.packageWeightGrams,
                    lengthMm: item.logistics.lengthMm,
                    widthMm: item.logistics.widthMm,
                    heightMm: item.logistics.heightMm,
                    estimatedSalePriceYen: item.logistics.estimatedSalePriceYen,
                    estimatedProfitYen: item.logistics.estimatedProfitYen,
                  }
                : null;
              const publicItem = {
                id: item.id,
                title: item.titleZh ?? item.titleRaw,
                originalTitle: item.titleRaw,
                description: item.descriptionZh?.slice(0, 500) ?? null,
                platform: item.source.displayName,
                priceYen: item.priceCurrent,
                shippingYen: item.shippingFee,
                totalYen: item.priceTotalEst,
                quantity: item.quantityEst,
                listingType: item.listingType,
                auctionEndAt: item.auctionEndAt,
                condition: item.conditionZh ?? item.conditionRaw,
                seller: item.seller,
                logistics: publicLogistics,
                detectedAt: item.detectedAt,
              };
              return usesPrivateContext
                ? {
                    ...publicItem,
                    favorite: item.favorite,
                    note: item.note,
                    logistics: item.logistics,
                  }
                : publicItem;
            }),
          }
        : {}),
      ...(needsSellers ? { relevantSellers } : {}),
      ...(needsIntel ? { latestIntel } : {}),
      ...(needsPurchases ? { recentPurchases } : {}),
      ...(needsCart
        ? { cartItems: cart?.items.map((entry) => entry.item) ?? [] }
        : {}),
    };
    const promptContext = usesPrivateContext
      ? context
      : (sanitizePublicContext(context) as Record<string, unknown>);
    const promptMessages = this.buildAssistantPrompt(
      body,
      message,
      promptContext,
      usesPrivateContext,
    );
    const response = await this.gateway.executeJson<{
      answerZh?: unknown;
      referencedItemIds?: unknown;
      suggestions?: unknown;
    }>({
      task: "assistant_chat",
      dataClass: chatDataClass,
      costPolicy: publicAiCostPolicy(),
      maxTokens: 4_000,
      temperature: 0.2,
      bypassCache: true,
      messages: promptMessages,
    });
    const ids = Array.isArray(response.data.referencedItemIds)
      ? response.data.referencedItemIds
          .filter((value): value is string => typeof value === "string")
          .slice(0, 8)
      : [];
    const itemById = new Map(relevantItems.map((item) => [item.id, item]));
    const selected = (
      ids.length ? ids : relevantItems.slice(0, 4).map((item) => item.id)
    ).flatMap((id) => {
      const item = itemById.get(id);
      return item ? [item] : [];
    });
    return {
      answerZh:
        typeof response.data.answerZh === "string"
          ? response.data.answerZh
          : "AI 已完成检索，但没有生成可展示的文字答案。",
      items: selected.map((item) => ({
        id: item.id,
        titleRaw: item.titleRaw,
        titleZh: item.titleZh,
        sourceUrl: item.sourceUrl,
        priceCurrent: item.priceCurrent,
        shippingFee: item.shippingFee,
        priceTotalEst: item.priceTotalEst,
        quantityEst: item.quantityEst,
        listingType: item.listingType,
        auctionEndAt: item.auctionEndAt,
        source: item.source,
        seller: item.seller,
        images: item.images,
      })),
      suggestions: Array.isArray(response.data.suggestions)
        ? response.data.suggestions
            .filter((value): value is string => typeof value === "string")
            .slice(0, 4)
        : [],
      model: response.model,
      provider: response.provider,
      fallbackUsed: response.fallbackUsed,
      generatedAt: context.generatedAt,
      toolsUsed: selectedTools,
    };
  }

  private buildAssistantPrompt(
    body: AssistantChatDto,
    message: string,
    context: Record<string, unknown>,
    includeHistory: boolean,
  ): PromptMessage[] {
    let question = message.slice(0, 4_000);
    const history: PromptMessage[] = includeHistory
      ? (body.history ?? []).slice(-12).map((entry) => ({
          role: entry.role,
          content: entry.content.slice(0, 1_600),
        }))
      : [];
    for (;;) {
      const fixedCharacters =
        ASSISTANT_SYSTEM_PROMPT.length +
        question.length +
        history.reduce((sum, entry) => sum + entry.content.length, 0) +
        320;
      const contextBudget = Math.max(
        600,
        AI_CHAT_PROMPT_MAX_CHARS - fixedCharacters,
      );
      const realtimeContext = compactContextToBudget(context, contextBudget);
      const userContent = JSON.stringify({ question, realtimeContext });
      const messages: PromptMessage[] = [
        { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
        ...history,
        { role: "user", content: userContent },
      ];
      const characters = messages.reduce(
        (sum, entry) => sum + entry.content.length,
        0,
      );
      if (characters <= AI_CHAT_PROMPT_MAX_CHARS) return messages;
      if (history.length) {
        history.shift();
        continue;
      }
      if (question.length > 500) {
        question = `${question.slice(0, Math.max(500, question.length / 2))}…`;
        continue;
      }
      return [
        { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            question,
            realtimeContext: {
              generatedAt: context.generatedAt,
              toolsUsed: context.toolsUsed,
              truncated: true,
            },
          }),
        },
      ];
    }
  }

  private chatSearchTerms(message: string) {
    const domainTerms = [
      "假面骑士",
      "奥特曼",
      "超级战队",
      "变身腰带",
      "腰带",
      "变身器",
      "软胶",
      "手办",
      "模型",
      "扭蛋",
      "食玩",
      "套装",
      "批量",
      "特摄",
      "仮面ライダー",
      "ウルトラマン",
      "スーパー戦隊",
      "ベルト",
      "ソフビ",
      "フィギュア",
    ].filter((term) => message.includes(term));
    const normalized = message
      .replace(
        /帮我|请问|请|找一下|找出|查一下|查看|看看|有没有|有哪些|哪些|什么|推荐|分析|比较|当前|现在|系统|商品|一个|这个|那个|可以|我想要|我需要/g,
        " ",
      )
      .replace(/[，。！？、；：,.!?;:\n\r()[\]{}]/g, " ");
    return [
      ...new Set([
        ...domainTerms,
        ...normalized
          .split(/\s+/)
          .map((term) => term.trim())
          .filter((term) => term.length >= 2),
      ]),
    ].slice(0, 8);
  }

  async feedback(itemId: string, body: AiFeedbackDto) {
    const item = await this.prisma.item.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        aiRuns: {
          orderBy: { startedAt: "desc" },
          take: 1,
          select: { id: true },
        },
      },
    });
    if (!item) throw new NotFoundException("Item not found");
    const feedback = await this.prisma.aiFeedback.create({
      data: {
        itemId,
        aiRunId: item.aiRuns[0]?.id,
        action: body.action,
        note: body.note?.trim(),
      },
    });
    return { feedback };
  }

  async productMemory(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        canonicalName: true,
        titleZh: true,
        marketSnapshots: {
          orderBy: [{ snapshotDate: "desc" }, { windowDays: "asc" }],
          take: 16,
        },
      },
    });
    if (!product) throw new NotFoundException("Product not found");
    return { product };
  }

  async diagnose(sourceKey?: string) {
    const jobs = await this.prisma.crawlJob.findMany({
      where: {
        jobType: "search",
        ...(sourceKey ? { source: { key: sourceKey } } : {}),
      },
      include: { source: { select: { key: true, displayName: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const result = await this.gateway.executeJson({
      task: "crawler_diagnosis",
      dataClass: "user_private",
      costPolicy: publicAiCostPolicy(),
      maxTokens: 3_000,
      cacheTtlMs: 15 * 60_000,
      messages: [
        {
          role: "system",
          content:
            '你是商品监控系统诊断技术员。只分析问题并生成可验证的修复方案，不得修改生产代码，不得虚构日志。请区分事实、可能原因、验证方法、修复建议和风险；只输出 JSON：{"summary":"...","facts":["..."],"hypotheses":[{"cause":"...","evidence":"...","verification":"..."}],"recommendedPatch":"...","tests":["..."],"requiresHumanApproval":true}。',
        },
        {
          role: "user",
          content: JSON.stringify(
            jobs.map((job) => ({
              source: job.source?.displayName ?? job.source?.key ?? "unknown",
              status: job.status,
              query: job.query,
              metrics: job.metrics,
              error: job.errorText?.slice(0, 500) ?? null,
              startedAt: job.startedAt,
              finishedAt: job.finishedAt,
            })),
          ),
        },
      ],
    });
    return result;
  }

  async refreshOperationalMemory() {
    const snapshotDate = new Date();
    snapshotDate.setUTCHours(0, 0, 0, 0);
    for (const days of Object.values(periodDays)) {
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO "market_snapshots" (
          "id", "product_id", "window_days", "snapshot_date",
          "observed_count", "sold_count", "active_count",
          "price_min", "price_max", "price_average", "price_median",
          "average_sell_hours", "price_trend_pct", "created_at"
        )
        SELECT
          i."product_id" || ':' || ${days}::text || ':' || CURRENT_DATE::text,
          i."product_id",
          ${days},
          CURRENT_DATE,
          count(*)::integer,
          count(*) FILTER (WHERE i."status" IN ('sold', 'ended'))::integer,
          count(*) FILTER (WHERE i."status" IN ('active', 'unknown'))::integer,
          min(i."priceCurrent")::numeric(12,2),
          max(i."priceCurrent")::numeric(12,2),
          avg(i."priceCurrent")::numeric(12,2),
          percentile_cont(0.5) WITHIN GROUP (ORDER BY i."priceCurrent")::numeric(12,2),
          avg(extract(epoch FROM (i."lastSeenAt" - i."detectedAt")) / 3600)
            FILTER (WHERE i."status" IN ('sold', 'ended'))::numeric(12,2),
          CASE
            WHEN avg(i."priceCurrent") FILTER (
              WHERE i."detectedAt" >= now() - (${Math.max(1, days / 2)} * interval '1 day')
            ) IS NULL OR avg(i."priceCurrent") FILTER (
              WHERE i."detectedAt" < now() - (${Math.max(1, days / 2)} * interval '1 day')
            ) IS NULL OR avg(i."priceCurrent") FILTER (
              WHERE i."detectedAt" < now() - (${Math.max(1, days / 2)} * interval '1 day')
            ) = 0 THEN NULL
            ELSE (
              100 * (
                avg(i."priceCurrent") FILTER (
                  WHERE i."detectedAt" >= now() - (${Math.max(1, days / 2)} * interval '1 day')
                ) / avg(i."priceCurrent") FILTER (
                  WHERE i."detectedAt" < now() - (${Math.max(1, days / 2)} * interval '1 day')
                ) - 1
              )
            )::numeric(8,2)
          END,
          now()
        FROM "Item" i
        WHERE i."product_id" IS NOT NULL
          AND i."detectedAt" >= now() - (${days} * interval '1 day')
        GROUP BY i."product_id"
        ON CONFLICT ("product_id", "window_days", "snapshot_date") DO UPDATE SET
          "observed_count" = EXCLUDED."observed_count",
          "sold_count" = EXCLUDED."sold_count",
          "active_count" = EXCLUDED."active_count",
          "price_min" = EXCLUDED."price_min",
          "price_max" = EXCLUDED."price_max",
          "price_average" = EXCLUDED."price_average",
          "price_median" = EXCLUDED."price_median",
          "average_sell_hours" = EXCLUDED."average_sell_hours",
          "price_trend_pct" = EXCLUDED."price_trend_pct"
      `);
    }

    for (const keyword of discoveryKeywords) {
      const [stats] = await this.prisma.$queryRaw<
        Array<{
          listing_count: bigint;
          average_price: Prisma.Decimal | null;
          low_price_ratio: Prisma.Decimal | null;
          purchase_ratio: Prisma.Decimal | null;
          high_value_ratio: Prisma.Decimal | null;
        }>
      >(Prisma.sql`
        SELECT
          count(*) AS listing_count,
          avg(i."priceCurrent")::numeric(12,2) AS average_price,
          avg(CASE WHEN i."priceCurrent" <= 3000 THEN 1 ELSE 0 END)::numeric(8,4) AS low_price_ratio,
          avg(CASE WHEN pr."id" IS NOT NULL THEN 1 ELSE 0 END)::numeric(8,4) AS purchase_ratio,
          avg(CASE WHEN i."favorite" OR (i."quantityEst" >= 10 AND i."unitCostEst" <= 1000) THEN 1 ELSE 0 END)::numeric(8,4) AS high_value_ratio
        FROM "Item" i
        LEFT JOIN "PurchaseRecord" pr ON pr."itemId" = i."id"
        WHERE (i."titleRaw" ILIKE ${`%${keyword}%`} OR i."descriptionRaw" ILIKE ${`%${keyword}%`})
      `);
      const listingCount = Number(stats?.listing_count ?? 0);
      const lowPriceRatio = Number(stats?.low_price_ratio ?? 0);
      const purchaseRatio = Number(stats?.purchase_ratio ?? 0);
      const highValueRatio = Number(stats?.high_value_ratio ?? 0);
      const recommended =
        listingCount >= 5 &&
        (lowPriceRatio >= 0.25 || purchaseRatio > 0 || highValueRatio >= 0.1);
      await this.prisma.keywordInsight.upsert({
        where: { keyword },
        update: {
          listingCount,
          averagePrice: stats?.average_price,
          lowPriceRatio,
          purchaseRatio,
          highValueRatio,
          recommended,
          rationale: `${listingCount} 件记录；低价比例 ${(lowPriceRatio * 100).toFixed(1)}%；购买比例 ${(purchaseRatio * 100).toFixed(1)}%。`,
          lastAnalyzedAt: new Date(),
        },
        create: {
          keyword,
          listingCount,
          averagePrice: stats?.average_price,
          lowPriceRatio,
          purchaseRatio,
          highValueRatio,
          recommended,
          rationale: `${listingCount} 件记录；低价比例 ${(lowPriceRatio * 100).toFixed(1)}%；购买比例 ${(purchaseRatio * 100).toFixed(1)}%。`,
        },
      });
    }

    const briefs = [];
    for (const [period, days] of Object.entries(periodDays)) {
      const periodStart = new Date(snapshotDate);
      periodStart.setUTCDate(periodStart.getUTCDate() - days);
      const facts = await this.briefFacts(days);
      try {
        const result = await this.gateway.executeJson({
          task: "market_analysis",
          dataClass: "user_private",
          costPolicy: "free_first",
          maxTokens: 4_000,
          cacheTtlMs: 6 * 60 * 60_000,
          messages: [
            {
              role: "system",
              content:
                '你是日本特摄中古市场分析师。只依据输入统计，输出已知事实、AI推测、不确定因素、风险和可执行建议；不得声称一定赚钱，不得生成数字评分。分析异常低价/高价、新增、供应变化、成交速度、卖家和用户采购偏好。只输出 JSON：{"facts":["..."],"inferences":["..."],"uncertainties":["..."],"risks":["..."],"actions":["..."]}。',
            },
            { role: "user", content: JSON.stringify({ period, ...facts }) },
          ],
        });
        await this.prisma.aiBrief.upsert({
          where: { period_periodStart: { period, periodStart } },
          update: {
            periodEnd: new Date(),
            model: result.model,
            result: result.data as Prisma.InputJsonValue,
          },
          create: {
            period,
            periodStart,
            periodEnd: new Date(),
            model: result.model,
            result: result.data as Prisma.InputJsonValue,
          },
        });
        briefs.push({ period, model: result.model });
      } catch {
        briefs.push({ period, model: null });
      }
    }
    return { snapshotDate, keywords: discoveryKeywords.length, briefs };
  }

  private async briefFacts(days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);
    const [items, purchases, favorites, feedback, keywords] = await Promise.all(
      [
        this.prisma.item.aggregate({
          where: {
            detectedAt: { gte: since },
            categoryToyType: { not: "card" },
          },
          _count: { _all: true },
          _avg: { priceCurrent: true, quantityEst: true, unitCostEst: true },
          _min: { priceCurrent: true, unitCostEst: true },
          _max: { priceCurrent: true, quantityEst: true },
        }),
        this.prisma.purchaseRecord.count({
          where: { purchasedAt: { gte: since } },
        }),
        this.prisma.item.count({
          where: { favorite: true, updatedAt: { gte: since } },
        }),
        this.prisma.discoveryFeedback.groupBy({
          by: ["action"],
          where: { timestamp: { gte: since } },
          _count: { _all: true },
        }),
        this.prisma.keywordInsight.findMany({
          where: { recommended: true },
          orderBy: { highValueRatio: "desc" },
          take: 10,
        }),
      ],
    );
    return { items, purchases, favorites, feedback, keywords };
  }
}
