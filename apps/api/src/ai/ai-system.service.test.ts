import { describe, expect, it, vi } from "vitest";
import {
  AI_CHAT_PROMPT_MAX_CHARS,
  AiSystemService,
} from "./ai-system.service.js";

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

  it("keeps anonymous assistant output inside the scoped token budget", async () => {
    const { service, gateway } = chatService();

    await service.chat({ message: "推荐几个值得看的商品", history: [] });

    const answerCall = gateway.executeJson.mock.calls.at(-1)?.[0];
    // Matches the assistant_chat floor in zhipu.policy: the scoped route
    // normalizes chat requests to at least 4096 output tokens.
    expect(answerCall.maxTokens).toBe(4_096);
  });
});
