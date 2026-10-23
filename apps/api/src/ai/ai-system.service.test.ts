import { describe, expect, it, vi } from "vitest";
import {
  AI_CHAT_PROMPT_MAX_CHARS,
  AiSystemService,
} from "./ai-system.service.js";

describe("AiSystemService overview", () => {
  it("reports a Gemini catalogue outage independently from a healthy OVO catalogue", async () => {
    vi.stubEnv("AI_ROUTE_OVO_ASSISTANT_CHAT", "*");
    vi.stubEnv("AI_ROUTE_GEMINI_ASSISTANT_CHAT", "*");
    const prisma = {
      aiModelState: { findMany: vi.fn().mockResolvedValue([{
        provider: "gemini", model: "gemini-3.1-flash-lite", status: "online",
        lastSuccessAt: new Date(), lastErrorCode: null, cooldownUntil: null,
      }]) },
      aiProviderState: { findMany: vi.fn().mockResolvedValue([]) },
      aiRun: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
      aiCache: { count: vi.fn().mockResolvedValue(0) },
      item: { count: vi.fn().mockResolvedValue(0) },
      reviewQueue: { count: vi.fn().mockResolvedValue(0) },
      aiBrief: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const gateway = {
      availableModelIds: vi.fn().mockResolvedValue(new Set(["ovo:Astra"])),
      providerCatalogueSnapshot: vi.fn().mockResolvedValue([
        { provider: "gemini", models: undefined, evidence: "catalogue_unavailable" },
        { provider: "ovo", models: new Set(["Astra"]), evidence: "live_catalogue" },
      ]),
      configuredProviderIds: vi.fn().mockReturnValue(["gemini", "ovo"]),
      providerConfigurations: vi.fn().mockReturnValue(["gemini", "ovo"].map((provider) => ({
        provider, active: true, credentialConfigured: true, modelAvailabilityEvidence: "live_catalogue",
      }))),
    };
    const service = new AiSystemService(prisma as never, gateway as never, {} as never,
      { manifest: vi.fn().mockReturnValue([]) } as never, {} as never);
    try {
      const overview = await service.overview();
      expect(overview.models).toEqual(expect.arrayContaining([
        expect.objectContaining({ provider: "gemini", model: "gemini-3.1-flash-lite", status: "unavailable", lastErrorCode: "AI_GATEWAY_CATALOGUE_UNAVAILABLE" }),
        expect.objectContaining({ provider: "ovo", model: "Astra", status: "unverified" }),
      ]));
      expect(overview.providers).toEqual(expect.arrayContaining([
        expect.objectContaining({ provider: "gemini", status: "unavailable", catalogueEvidence: "catalogue_unavailable" }),
        expect.objectContaining({ provider: "ovo", catalogueEvidence: "live_catalogue" }),
      ]));
    } finally { vi.unstubAllEnvs(); }
  });

  it("keeps health and usage isolated by provider:model", async () => {
    const future = new Date(Date.now() + 60_000);
    const modelStates = [
      {
        id: "bai-state",
        provider: "bai",
        model: "shared-model",
        role: "B.AI shared role",
        configured: true,
        status: "online",
        cooldownUntil: null,
        quotaResetAt: null,
        consecutiveFailures: 0,
        lastSuccessAt: new Date(),
        lastFailureAt: null,
        lastErrorCode: null,
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "gemini-state",
        provider: "gemini",
        model: "shared-model",
        role: "Gemini shared role",
        configured: true,
        status: "degraded",
        cooldownUntil: future,
        quotaResetAt: future,
        consecutiveFailures: 2,
        lastSuccessAt: null,
        lastFailureAt: new Date(),
        lastErrorCode: "RATE_LIMIT",
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "ovo-state",
        provider: "ovo",
        model: "gpt-5.6-luna",
        role: "付费主模型",
        configured: true,
        status: "unavailable",
        cooldownUntil: future,
        quotaResetAt: null,
        consecutiveFailures: 1,
        lastSuccessAt: null,
        lastFailureAt: new Date(),
        lastErrorCode: "MODEL_NOT_AVAILABLE",
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const modelGroupBy = vi
      .fn()
      .mockResolvedValueOnce([
        {
          provider: "bai",
          requestedModel: "shared-model",
          _count: { _all: 2 },
          _sum: { inputTokens: 10, outputTokens: 5 },
        },
        {
          provider: "gemini",
          requestedModel: "shared-model",
          _count: { _all: 3 },
          _sum: { inputTokens: 20, outputTokens: 7 },
        },
      ])
      .mockResolvedValueOnce([]);
    const cacheCount = vi.fn().mockResolvedValue(4);
    const prisma = {
      aiModelState: { findMany: vi.fn().mockResolvedValue(modelStates) },
      aiProviderState: {
        findMany: vi.fn().mockResolvedValue([
          {
            provider: "gemini",
            status: "degraded",
            cooldownUntil: future,
            quotaResetAt: future,
            remainingRequests: 0,
            remainingTokens: 120,
            lastErrorCode: "RATE_LIMIT",
            consecutiveFailures: 2,
          },
          {
            provider: "ovo",
            status: "cooldown",
            cooldownUntil: future,
            quotaResetAt: null,
            remainingRequests: null,
            remainingTokens: null,
            lastErrorCode: "MODEL_NOT_AVAILABLE",
            consecutiveFailures: 1,
          },
        ]),
      },
      aiRun: {
        groupBy: modelGroupBy,
        findMany: vi.fn().mockResolvedValue([]),
      },
      aiCache: { count: cacheCount },
      item: { count: vi.fn().mockResolvedValue(0) },
      reviewQueue: { count: vi.fn().mockResolvedValue(0) },
      aiBrief: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const gateway = {
      availableModelIds: vi
        .fn()
        .mockResolvedValue(
          new Set(["bai:shared-model", "gemini:shared-model"]),
        ),
      providerCatalogueSnapshot: vi.fn().mockResolvedValue([
        { provider: "bai", models: new Set(["shared-model"]), evidence: "live_catalogue" },
        { provider: "gemini", models: new Set(["shared-model"]), evidence: "live_catalogue" },
        { provider: "ovo", models: new Set(), evidence: "live_catalogue" },
      ]),
      configuredProviderIds: vi.fn().mockReturnValue(["bai", "gemini", "ovo"]),
      providerConfigurations: vi.fn().mockReturnValue([
        {
          provider: "bai",
          label: "B.AI",
          credentialEnvironmentNames: ["BAI_API_KEY"],
          credentialConfigured: true,
          configuredCredentialCount: 1,
          active: true,
          activationReason: "ready",
          apiTier: "promotion",
          quotaScope: "account",
          publicMarketAllowed: true,
          privateDataAllowed: false,
          sensitiveImagesAllowed: false,
        },
        {
          provider: "gemini",
          label: "Google Gemini",
          credentialEnvironmentNames: ["GEMINI_API_KEY"],
          credentialConfigured: true,
          configuredCredentialCount: 1,
          active: true,
          activationReason: "ready",
          apiTier: "free",
          quotaScope: "project",
          publicMarketAllowed: true,
          privateDataAllowed: false,
          sensitiveImagesAllowed: false,
        },
        {
          provider: "nvidia",
          label: "NVIDIA NIM",
          credentialEnvironmentNames: ["NVIDIA_API_KEY"],
          credentialConfigured: true,
          configuredCredentialCount: 1,
          active: false,
          activationReason: "evaluation_authorization_required",
          apiTier: "unknown",
          quotaScope: "account",
          publicMarketAllowed: false,
          privateDataAllowed: false,
          sensitiveImagesAllowed: false,
        },
        {
          provider: "ovo",
          label: "OVO GPT 特惠组",
          credentialEnvironmentNames: ["OVO_API_KEY"],
          credentialConfigured: true,
          configuredCredentialCount: 1,
          active: true,
          activationReason: "ready",
          apiTier: "paid",
          quotaScope: "account",
          publicMarketAllowed: true,
          privateDataAllowed: false,
          sensitiveImagesAllowed: false,
        },
      ]),
    };
    const service = new AiSystemService(
      prisma as never,
      gateway as never,
      {} as never,
      { manifest: vi.fn().mockReturnValue([]) } as never,
      { execute: vi.fn() } as never,
    );

    const overview = await service.overview();

    const sharedModels = overview.models.filter(
      (model) => model.model === "shared-model",
    );
    expect(sharedModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "bai:shared-model",
          provider: "bai",
          callsToday: 2,
          status: "online",
          role: "B.AI shared role",
        }),
        expect.objectContaining({
          key: "gemini:shared-model",
          provider: "gemini",
          callsToday: 3,
          status: "degraded",
          lastErrorCode: "RATE_LIMIT",
          role: "Gemini shared role",
        }),
      ]),
    );
    expect(overview.providers.map((entry) => entry.provider)).toEqual(
      expect.arrayContaining([
        "bai",
        "openrouter",
        "gemini",
        "groq",
        "siliconflow",
        "nvidia",
      ]),
    );
    expect(
      overview.providers.find((entry) => entry.provider === "gemini"),
    ).toEqual(expect.objectContaining({ status: "cooldown", callsToday: 3 }));
    expect(
      overview.providers.find((entry) => entry.provider === "ovo"),
    ).toEqual(expect.objectContaining({ status: "unavailable" }));
    expect(overview).toEqual(
      expect.objectContaining({
        configured: true,
        routable: false,
        verifiedOnline: false,
      }),
    );
    expect(
      overview.providers.find((entry) => entry.provider === "nvidia"),
    ).toEqual(
      expect.objectContaining({
        label: "NVIDIA NIM",
        configured: false,
        status: "not_configured",
        credentialConfigured: true,
        configuredCredentialCount: 1,
        activationReason: "evaluation_authorization_required",
        apiTier: "unknown",
        allowedDataClasses: {
          publicMarket: false,
          privateData: false,
          sensitiveImages: false,
        },
      }),
    );
    expect(cacheCount).toHaveBeenCalledWith({
      where: {
        expiresAt: { gt: expect.any(Date) },
        provider: { not: null },
      },
    });
  });

  it("keeps a fresh static OVO route unverified until a completion succeeds", async () => {
    vi.stubEnv("AI_ALLOW_PAID_MODELS", "true");
    vi.stubEnv("AI_PAID_PROVIDER_ALLOWLIST", "ovo");
    const prisma = {
      aiModelState: { findMany: vi.fn().mockResolvedValue([]) },
      aiProviderState: { findMany: vi.fn().mockResolvedValue([]) },
      aiRun: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      aiCache: { count: vi.fn().mockResolvedValue(0) },
      item: { count: vi.fn().mockResolvedValue(0) },
      reviewQueue: { count: vi.fn().mockResolvedValue(0) },
      aiBrief: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const gateway = {
      availableModelIds: vi
        .fn()
        .mockResolvedValue(new Set(["ovo:gpt-5.6-luna"])),
      providerCatalogueSnapshot: vi.fn().mockResolvedValue([
        { provider: "ovo", models: new Set(["gpt-5.6-luna"]), evidence: "operator_static_route" },
      ]),
      configuredProviderIds: vi.fn().mockReturnValue(["ovo"]),
      providerConfigurations: vi.fn().mockReturnValue([
        {
          provider: "ovo",
          label: "OVO GPT 特惠组",
          credentialEnvironmentNames: ["OVO_API_KEY"],
          credentialConfigured: true,
          configuredCredentialCount: 1,
          active: true,
          activationReason: "ready",
          apiTier: "paid",
          quotaScope: "account",
          publicMarketAllowed: true,
          privateDataAllowed: false,
          sensitiveImagesAllowed: false,
          modelAvailabilityEvidence: "operator_static_route",
        },
      ]),
    };
    const service = new AiSystemService(
      prisma as never,
      gateway as never,
      {} as never,
      { manifest: vi.fn().mockReturnValue([]) } as never,
      { execute: vi.fn() } as never,
    );

    try {
      const overview = await service.overview();

      expect(
        overview.models.find(
          (model) => model.provider === "ovo" && model.model === "gpt-5.6-luna",
        ),
      ).toEqual(expect.objectContaining({ status: "unverified" }));
      expect(
        overview.providers.find((provider) => provider.provider === "ovo"),
      ).toEqual(expect.objectContaining({ status: "unverified" }));
      expect(overview).toEqual(
        expect.objectContaining({
          configured: true,
          attemptable: true,
          routable: false,
          verifiedOnline: false,
        }),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("treats a live-catalogue route as unavailable without a catalogue and ignores stale model state", async () => {
    vi.stubEnv("AI_ROUTE_OVO_ASSISTANT_CHAT", "*");
    vi.stubEnv("AI_ALLOW_PAID_MODELS", "true");
    vi.stubEnv("AI_PAID_PROVIDER_ALLOWLIST", "ovo");

    const createFixture = (
      catalogue: Set<string> | undefined,
      completionVerified = false,
    ) => {
      const prisma = {
        aiModelState: {
          findMany: vi.fn().mockResolvedValue([
            {
              provider: "ovo",
              model: "gpt-5.6-luna",
              role: "付费主模型",
              configured: true,
              // This is intentionally stale: a wildcard route must not trust
              // it when the provider catalogue cannot be verified.
              status: "ready",
              cooldownUntil: null,
              quotaResetAt: null,
              consecutiveFailures: 0,
              lastSuccessAt: new Date(),
              lastFailureAt: null,
              lastErrorCode: null,
              lastCheckedAt: new Date(),
              updatedAt: new Date(),
            },
            ...(completionVerified
              ? [
                  {
                    provider: "ovo",
                    model: "Astra",
                    role: "备用模型",
                    configured: true,
                    status: "online",
                    cooldownUntil: null,
                    quotaResetAt: null,
                    consecutiveFailures: 0,
                    lastSuccessAt: new Date(),
                    lastFailureAt: null,
                    lastErrorCode: null,
                    lastCheckedAt: new Date(),
                    updatedAt: new Date(),
                  },
                ]
              : []),
          ]),
        },
        aiProviderState: {
          findMany: vi.fn().mockResolvedValue([
            {
              provider: "ovo",
              status: completionVerified ? "online" : "ready",
              cooldownUntil: null,
              quotaResetAt: null,
              remainingRequests: null,
              remainingTokens: null,
              lastErrorCode: null,
              consecutiveFailures: 0,
            },
          ]),
        },
        aiRun: {
          groupBy: vi.fn().mockResolvedValue([]),
          findMany: vi.fn().mockResolvedValue([]),
        },
        aiCache: { count: vi.fn().mockResolvedValue(0) },
        item: { count: vi.fn().mockResolvedValue(0) },
        reviewQueue: { count: vi.fn().mockResolvedValue(0) },
        aiBrief: { findMany: vi.fn().mockResolvedValue([]) },
      };
      const gateway = {
        availableModelIds: vi.fn().mockResolvedValue(catalogue),
        providerCatalogueSnapshot: vi.fn().mockResolvedValue([
          { provider: "ovo", models: catalogue ? new Set([...catalogue].map((model) => model.slice(4))) : undefined,
            evidence: catalogue ? "live_catalogue" : "catalogue_unavailable" },
        ]),
        configuredProviderIds: vi.fn().mockReturnValue(["ovo"]),
        providerConfigurations: vi.fn().mockReturnValue([
          {
            provider: "ovo",
            label: "OVO GPT 特惠组",
            credentialEnvironmentNames: ["OVO_API_KEY"],
            credentialConfigured: true,
            configuredCredentialCount: 1,
            active: true,
            activationReason: "ready",
            apiTier: "paid",
            quotaScope: "account",
            publicMarketAllowed: true,
            privateDataAllowed: false,
            sensitiveImagesAllowed: false,
            modelAvailabilityEvidence: "live_catalogue",
          },
        ]),
      };
      return {
        prisma,
        service: new AiSystemService(
          prisma as never,
          gateway as never,
          {} as never,
          { manifest: vi.fn().mockReturnValue([]) } as never,
          { execute: vi.fn() } as never,
        ),
      };
    };

    try {
      const unavailable = await createFixture(undefined).service.overview();
      expect(
        unavailable.models.find(
          (model) => model.provider === "ovo" && model.model === "gpt-5.6-luna",
        ),
      ).toEqual(expect.objectContaining({ status: "unavailable" }));
      expect(
        unavailable.providers.find((provider) => provider.provider === "ovo"),
      ).toEqual(expect.objectContaining({ status: "unavailable" }));
      expect(unavailable).toEqual(
        expect.objectContaining({ routable: false, attemptable: false }),
      );

      const catalogueOnly = await createFixture(
        new Set(["ovo:Astra"]),
      ).service.overview();
      expect(
        catalogueOnly.models.find(
          (model) => model.provider === "ovo" && model.model === "Astra",
        ),
      ).toEqual(expect.objectContaining({ status: "unverified" }));
      expect(catalogueOnly.verifiedOnline).toBe(false);

      const live = await createFixture(
        new Set(["ovo:Astra"]),
        true,
      ).service.overview();
      expect(
        live.models.find(
          (model) => model.provider === "ovo" && model.model === "Astra",
        ),
      ).toEqual(expect.objectContaining({ status: "online" }));
      expect(
        live.models.find(
          (model) => model.provider === "ovo" && model.model === "gpt-5.6-luna",
        ),
      ).toEqual(expect.objectContaining({ status: "unavailable" }));
      expect(live).toEqual(
        expect.objectContaining({
          routable: true,
          attemptable: true,
          verifiedOnline: true,
        }),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("AiSystemService image privacy", () => {
  const body = {
    title: "公开商品",
    description: "说明",
    imageUrls: ["https://images.example.test/item-1.jpg"],
  };

  function imageService(item: unknown) {
    const execute = vi.fn().mockResolvedValue({ data: {} });
    const prisma = {
      item: { findUnique: vi.fn().mockResolvedValue(item) },
    };
    return {
      execute,
      prisma,
      service: new AiSystemService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        { execute } as never,
      ),
    };
  }

  it("marks only database-owned item images as public market data", async () => {
    const { execute, prisma, service } = imageService({
      images: [{ url: body.imageUrls[0] }],
    });

    await service.analyzeImages(body, "item-1");

    expect(prisma.item.findUnique).toHaveBeenCalledWith({
      where: { id: "item-1" },
      select: { images: { select: { url: true } } },
    });
    expect(execute).toHaveBeenCalledWith(
      "image_analysis",
      expect.objectContaining({
        itemId: "item-1",
        imageUrls: body.imageUrls,
        dataClass: "public_market",
      }),
    );
  });

  it("rejects an image URL that is not owned by the requested item", async () => {
    const { execute, service } = imageService({
      images: [{ url: "https://images.example.test/other.jpg" }],
    });

    await expect(service.analyzeImages(body, "item-1")).rejects.toMatchObject({
      status: 400,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps image requests without an item private", async () => {
    const { execute, prisma, service } = imageService(null);

    await service.analyzeImages(body);

    expect(prisma.item.findUnique).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(
      "image_analysis",
      expect.objectContaining({ dataClass: "sensitive_image" }),
    );
  });
});

describe("AiSystemService chat context", () => {
  function chatService(options?: { huge?: boolean }) {
    const snapshot = {
      generatedAt: "2026-08-30T00:00:00.000Z",
      inventory: {
        totalListings: 20,
        activeListings: 18,
        newProducts24h: 2,
        listingTypes: { auction: 8, direct: 10 },
      },
      crawlers: { jobs24h: {}, sources: [] },
      ai: { tasksToday: [], models: [], providerStates: [] },
      queues: { status: "ok", counts: [] },
      market: { intel24h: 0, keywords: [] },
      recentErrors: { crawler: [], ai: [] },
      recentUserActivity: {
        favorites24h: 0,
        purchases24h: 0,
        discovery: [],
      },
      ...(options?.huge
        ? {
            oversized: Array.from({ length: 400 }, (_, index) => ({
              index,
              description: "很长的实时系统内容".repeat(80),
            })),
          }
        : {}),
    };
    const systemContext = { snapshot: vi.fn().mockResolvedValue(snapshot) };
    const toolRegistry = {
      fallbackSelection: vi.fn().mockReturnValue(["ai_system_status"]),
      manifest: vi.fn().mockReturnValue([]),
      validateSelection: vi.fn().mockReturnValue([]),
      execute: vi
        .fn()
        .mockImplementation(async (_names, _message, currentSnapshot) => [
          {
            name: "ai_system_status",
            ok: true,
            data: {
              snapshotGeneratedAt: (await currentSnapshot).generatedAt,
              oversized: options?.huge
                ? "工具返回的大段内容".repeat(5_000)
                : undefined,
            },
          },
        ]),
    };
    const gateway = {
      executeJson: vi.fn().mockResolvedValue({
        data: { answerZh: "模型池正常", referencedItemIds: [] },
        provider: "gemini",
        model: "test-model",
        fallbackUsed: false,
      }),
    };
    const prisma = {
      item: { findMany: vi.fn() },
      seller: { findMany: vi.fn() },
      marketIntel: { findMany: vi.fn() },
      purchaseRecord: { findMany: vi.fn() },
      shoppingCart: { findUnique: vi.fn() },
    };
    return {
      gateway,
      prisma,
      systemContext,
      toolRegistry,
      service: new AiSystemService(
        prisma as never,
        gateway as never,
        systemContext as never,
        toolRegistry as never,
        { execute: vi.fn() } as never,
      ),
    };
  }

  it.each(["你好", "AI 模型现在怎么样"])(
    "computes at most one system snapshot for %s",
    async (message) => {
      const { service, systemContext, toolRegistry } = chatService();

      await service.chat({ message, history: [] });

      expect(systemContext.snapshot).toHaveBeenCalledTimes(1);
      expect(toolRegistry.execute).toHaveBeenCalledWith(
        ["ai_system_status"],
        message,
        expect.objectContaining({ then: expect.any(Function) }),
      );
    },
  );

  it("does not search products or sellers for an AI provider question", async () => {
    const { service, prisma, gateway } = chatService();

    await service.chat({ message: "AI 模型现在怎么样", history: [] });

    expect(prisma.item.findMany).not.toHaveBeenCalled();
    expect(prisma.seller.findMany).not.toHaveBeenCalled();
    const answerCall = gateway.executeJson.mock.calls.at(-1)?.[0];
    const userMessage = answerCall.messages.at(-1).content as string;
    const payload = JSON.parse(userMessage) as {
      realtimeContext: Record<string, unknown>;
    };
    expect(payload.realtimeContext).not.toHaveProperty("relevantItems");
    expect(payload.realtimeContext).not.toHaveProperty("relevantSellers");
    expect(answerCall.dataClass).toBe("public_market");
  });

  it("uses public market routing and strips private fields from product context", async () => {
    const { service, prisma, gateway, toolRegistry, systemContext } =
      chatService();
    toolRegistry.fallbackSelection.mockReturnValue([
      "search_products",
      "get_product_analysis",
    ]);
    toolRegistry.execute.mockResolvedValue([
      {
        name: "search_products",
        ok: true,
        data: [
          {
            id: "item-1",
            favorite: true,
            note: "私人卡片备注",
            logistics: { notes: "私人物流备注" },
          },
        ],
      },
    ]);
    systemContext.snapshot.mockResolvedValue({
      generatedAt: "2026-08-30T00:00:00.000Z",
      inventory: { totalListings: 1, activeListings: 1, newProducts24h: 1 },
      crawlers: { jobs24h: {}, sources: [] },
      ai: { tasksToday: [], models: [], providerStates: [] },
      queues: { status: "ok", counts: [] },
      market: { intel24h: 0, keywords: [] },
      recentErrors: { crawler: [], ai: [] },
      recentUserActivity: {
        favorites24h: 1,
        purchases24h: 1,
        discovery: [],
      },
    });
    prisma.item.findMany.mockResolvedValue([
      {
        id: "item-1",
        titleRaw: "仮面ライダーベルト",
        titleZh: "假面骑士腰带",
        descriptionZh: "商品说明",
        sourceUrl: "https://example.test/item-1",
        priceCurrent: 1000,
        shippingFee: 500,
        priceTotalEst: 1500,
        quantityEst: 1,
        listingType: "direct",
        auctionEndAt: null,
        conditionZh: "二手",
        conditionRaw: "中古",
        favorite: true,
        note: "私人卡片备注",
        detectedAt: new Date(),
        source: { key: "test", displayName: "测试平台" },
        seller: null,
        images: [],
        logistics: {
          weightGrams: 500,
          packageWeightGrams: 600,
          lengthMm: 300,
          widthMm: 200,
          heightMm: 100,
          estimatedSalePriceYen: 3000,
          estimatedProfitYen: 1000,
          notes: "私人物流备注",
        },
      },
    ]);

    await service.chat({ message: "有什么便宜的假面骑士腰带", history: [] });

    const answerCall = gateway.executeJson.mock.calls.at(-1)?.[0];
    expect(answerCall.dataClass).toBe("public_market");
    const serializedPrompt = answerCall.messages
      .map((entry: { content: string }) => entry.content)
      .join("\n");
    expect(serializedPrompt).not.toContain("私人卡片备注");
    expect(serializedPrompt).not.toContain("私人物流备注");
    expect(serializedPrompt).not.toContain("recentUserActivity");
    expect(serializedPrompt).not.toContain('"favorite":true');
  });

  it.each([
    [["favorites"], "看看我的收藏"],
    [["purchases"], "查看我的购买记录"],
    [["user_activity_summary"], "总结我的活动"],
    [["recent_views"], "我最近看过什么"],
    [["feedback_summary"], "总结我的反馈"],
    [["search_inventory"], "搜索我的库存"],
    [[], "看看购物车和待结算商品"],
    [[], "我买过和收藏过哪些商品"],
  ])(
    "keeps anonymous chat away from private context for %s",
    async (tools, message) => {
      const { service, prisma, gateway, toolRegistry } = chatService();
      toolRegistry.fallbackSelection.mockReturnValue(tools);
      toolRegistry.execute.mockResolvedValue([]);
      prisma.item.findMany.mockResolvedValue([]);
      prisma.purchaseRecord.findMany.mockResolvedValue([]);
      prisma.shoppingCart.findUnique.mockResolvedValue(null);

      await service.chat({ message, history: [] });

      expect(toolRegistry.execute).toHaveBeenCalledWith(
        [],
        message,
        expect.objectContaining({ then: expect.any(Function) }),
      );
      expect(prisma.item.findMany).not.toHaveBeenCalled();
      expect(prisma.purchaseRecord.findMany).not.toHaveBeenCalled();
      expect(prisma.shoppingCart.findUnique).not.toHaveBeenCalled();
      expect(gateway.executeJson.mock.calls.at(-1)?.[0].dataClass).toBe(
        "public_market",
      );
    },
  );

  it("uses public market routing for the tool-only planner", async () => {
    const originalPlanner = process.env.AI_CHAT_PLANNER_ENABLED;
    process.env.AI_CHAT_PLANNER_ENABLED = "true";
    try {
      const { service, gateway } = chatService();
      gateway.executeJson
        .mockResolvedValueOnce({
          data: { selectedTools: ["ai_system_status"] },
          provider: "groq",
          model: "planner",
          fallbackUsed: false,
        })
        .mockResolvedValueOnce({
          data: { answerZh: "正常", referencedItemIds: [] },
          provider: "groq",
          model: "answer",
          fallbackUsed: false,
        });

      await service.chat({ message: "AI 模型现在怎么样", history: [] });

      expect(gateway.executeJson.mock.calls[0]?.[0].dataClass).toBe(
        "public_market",
      );
    } finally {
      if (originalPlanner === undefined)
        delete process.env.AI_CHAT_PLANNER_ENABLED;
      else process.env.AI_CHAT_PLANNER_ENABLED = originalPlanner;
    }
  });

  it("includes recent conversation history in the final assistant answer prompt", async () => {
    const { service, gateway } = chatService();
    const history = [
      { role: "user" as const, content: "先比较列表里的第一件和第二件商品" },
      {
        role: "assistant" as const,
        content: "第一件价格更低，第二件配件更完整。",
      },
    ];

    await service.chat({ message: "那第二件的卖家情况呢？", history });

    const answerCall = gateway.executeJson.mock.calls.at(-1)?.[0];
    expect(answerCall.messages.slice(1, 3)).toEqual(history);
    expect(JSON.parse(answerCall.messages.at(-1)?.content)).toMatchObject({
      question: "那第二件的卖家情况呢？",
    });
  });

  it("keeps the complete model prompt inside the hard character budget", async () => {
    const { service, gateway } = chatService({ huge: true });

    await service.chat({
      message: "AI 模型现在怎么样",
      history: Array.from({ length: 20 }, (_, index) => ({
        role: index % 2 ? ("assistant" as const) : ("user" as const),
        content: "很长的历史消息".repeat(1_000),
      })),
    });

    const answerCall = gateway.executeJson.mock.calls.at(-1)?.[0];
    const promptCharacters = answerCall.messages.reduce(
      (sum: number, entry: { content: string }) => sum + entry.content.length,
      0,
    );
    expect(promptCharacters).toBeLessThanOrEqual(AI_CHAT_PROMPT_MAX_CHARS);
  });

  it("keeps anonymous assistant output inside free-tier token budgets", async () => {
    const { service, gateway } = chatService();

    await service.chat({ message: "推荐几个值得看的商品", history: [] });

    const answerCall = gateway.executeJson.mock.calls.at(-1)?.[0];
    expect(answerCall.maxTokens).toBeLessThanOrEqual(1_200);
  });
});
