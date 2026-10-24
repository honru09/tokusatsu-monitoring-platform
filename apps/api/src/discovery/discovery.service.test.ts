import { DiscoveryAction, Prisma } from "@tokusatsu/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma.service.js";
import { activeMarketItemWhere } from "../items/active-market-scope.js";
import { DiscoveryService } from "./discovery.service.js";
import { ItemsService } from "../items/items.service.js";

function serviceWith(overrides: Record<string, unknown> = {}) {
  const prisma = {
    manualReview: {
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
    },
    discoveryFeedback: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    item: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn(),
      groupBy: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(async (input: unknown) => {
      if (Array.isArray(input)) return Promise.all(input);
      return (input as (tx: unknown) => Promise<unknown>)(prisma);
    }),
    ...overrides,
  };
  return {
    prisma,
    service: new DiscoveryService(prisma as unknown as PrismaService),
  };
}

describe("DiscoveryService", () => {
  it("coalesces concurrent feeds and reuses a short-lived full-library ranking", async () => {
    const { prisma, service } = serviceWith();
    const candidate = { id: "direct-1", listingType: "direct" };
    let releaseRanking!: () => void;
    const rankingGate = new Promise<void>((resolve) => {
      releaseRanking = resolve;
    });
    let rankingQueries = 0;
    prisma.item.findMany.mockImplementation(async (query) => {
      if (query.select?.crossMarketOpportunities) {
        rankingQueries += 1;
        await rankingGate;
      }
      return [candidate];
    });
    prisma.item.count.mockResolvedValue(1);

    const concurrent = Array.from({ length: 8 }, () =>
      service.feed(12, "direct"),
    );
    await vi.waitFor(() => expect(rankingQueries).toBe(1));
    releaseRanking();
    const results = await Promise.all(concurrent);
    const cached = await service.feed(12, "direct");

    expect(
      results.every((result) => result.items[0]?.id === candidate.id),
    ).toBe(true);
    expect(cached.items[0]?.id).toBe(candidate.id);
    expect(rankingQueries).toBe(1);
  });

  it("bounds simultaneous full-library scans across discovery layers", async () => {
    vi.stubEnv("DISCOVERY_MAX_CONCURRENT_SCANS", "1");
    const { prisma, service } = serviceWith();
    let activeScans = 0;
    let maximumActiveScans = 0;
    prisma.item.findMany.mockImplementation(async (query) => {
      if (query.select?.crossMarketOpportunities) {
        activeScans += 1;
        maximumActiveScans = Math.max(maximumActiveScans, activeScans);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeScans -= 1;
      }
      return [];
    });

    await Promise.all([
      service.feed(12),
      service.feed(12, "auction"),
      service.feed(12, "direct"),
      service.feed(12, "unknown"),
    ]);

    expect(maximumActiveScans).toBe(1);
  });

  it("rejects excess distinct scan work instead of growing an unbounded queue", async () => {
    vi.stubEnv("DISCOVERY_MAX_CONCURRENT_SCANS", "1");
    vi.stubEnv("DISCOVERY_MAX_QUEUED_SCANS", "1");
    const { prisma, service } = serviceWith();
    let releaseRanking!: () => void;
    const rankingGate = new Promise<void>((resolve) => {
      releaseRanking = resolve;
    });
    let rankingQueries = 0;
    prisma.item.findMany.mockImplementation(async (query) => {
      if (query.select?.crossMarketOpportunities) {
        rankingQueries += 1;
        await rankingGate;
      }
      return [];
    });

    const active = service.feed(12, "direct");
    await vi.waitFor(() => expect(rankingQueries).toBe(1));
    const queued = service.feed(12, "auction");
    const rejected = service.feed(12, "unknown");

    await expect(rejected).rejects.toThrow("发现流正在更新");
    releaseRanking();
    await Promise.all([active, queued]);
    expect(rankingQueries).toBe(2);
  });

  it("does not serve a cached card after an external collaborative preference change", async () => {
    const { prisma, service } = serviceWith();
    const candidate = { id: "direct-1", listingType: "direct" };
    let favorite = false;
    let rankingQueries = 0;
    prisma.item.findMany.mockImplementation(async (query) => {
      if (query.select?.crossMarketOpportunities) rankingQueries += 1;
      return favorite ? [] : [candidate];
    });

    const first = await service.feed(12, "direct");
    favorite = true;
    const second = await service.feed(12, "direct");

    expect(first.items[0]?.id).toBe(candidate.id);
    expect(second.items).toEqual([]);
    expect(rankingQueries).toBe(2);
  });

  it("invalidates cached rankings after favorite feedback and its undo", async () => {
    const { prisma, service } = serviceWith();
    const listingId = "89a6ce89-a2d9-4ad8-8cb5-8f6d130c1c62";
    const candidate = {
      id: listingId,
      productId: null,
      sourceUrl: "https://example.com/item",
      titleRaw: "テスト商品",
      titleZh: "测试商品",
      priceCurrent: 1_000,
      shippingFee: 0,
      priceTotalEst: 1_000,
      listedAt: null,
      detectedAt: new Date(),
      auctionEndAt: null,
      listingType: "direct",
      categoryIp: "kamen_rider",
      categoryToyType: "dx_belt",
      conditionGrade: "good",
      quantityEst: 1,
      unitCostEst: 1_000,
      note: null,
      logistics: null,
      source: { key: "test", displayName: "测试" },
      images: [],
      product: null,
      archivedAt: null,
      status: "active",
      purchaseRecord: null,
      ignored: false,
      ignoredAt: null,
      favorite: false,
      updatedAt: new Date(),
    };
    let current = { ...candidate };
    let activeFeedback = false;
    let rankingQueries = 0;
    prisma.discoveryFeedback.findMany.mockImplementation(async () =>
      activeFeedback ? [{ listingId }] : [],
    );
    prisma.discoveryFeedback.findUnique.mockResolvedValue({
      id: "feedback-cache",
      listingId,
      productId: null,
      action: DiscoveryAction.favorite,
      position: 0,
      undoEvents: [],
    });
    prisma.discoveryFeedback.create.mockImplementation(async ({ data }) => {
      if (data.action === DiscoveryAction.favorite) activeFeedback = true;
      if (data.action === DiscoveryAction.undo) activeFeedback = false;
      return {
        id:
          data.action === DiscoveryAction.undo
            ? "undo-cache"
            : "feedback-cache",
        ...data,
      };
    });
    prisma.manualReview.findFirst.mockResolvedValue({
      beforeData: { favorite: false, ignored: false, ignoredAt: null },
      afterData: { favorite: true, ignored: false, ignoredAt: null },
    });
    prisma.item.findUnique.mockImplementation(async () => ({ ...current }));
    prisma.item.update.mockImplementation(async ({ data }) => {
      current = { ...current, ...data, updatedAt: new Date() };
      return { ...current };
    });
    prisma.item.updateMany.mockImplementation(async ({ data }) => {
      current = { ...current, ...data, updatedAt: new Date() };
      return { count: 1 };
    });
    prisma.item.findMany.mockImplementation(async (query) => {
      if (query.select?.crossMarketOpportunities) rankingQueries += 1;
      return current.favorite ? [] : [{ ...current }];
    });

    expect((await service.feed(12, "direct")).items).toHaveLength(1);
    await service.feedback({ listingId, action: "favorite", position: 0 });
    expect((await service.feed(12, "direct")).items).toEqual([]);
    await service.undo("feedback-cache");
    expect((await service.feed(12, "direct")).items).toHaveLength(1);

    expect(rankingQueries).toBe(3);
  });

  it.each(["favorite", "dislike"] as const)(
    "publishes %s and undo through the shared collaboration cursor",
    async (action) => {
      const { prisma, service } = serviceWith();
      let current = {
        id: "listing-sync",
        productId: null,
        favorite: false,
        ignored: false,
        ignoredAt: null as Date | null,
        archivedAt: null,
        status: "active",
        purchaseRecord: null,
        note: "保留备注",
        updatedAt: new Date(),
      };
      const reviews: unknown[] = [];
      prisma.item.findUnique.mockImplementation(async () => ({ ...current }));
      prisma.item.update.mockImplementation(async ({ data }) => {
        current = { ...current, ...data, updatedAt: new Date() };
        return { ...current };
      });
      prisma.item.updateMany.mockImplementation(async ({ data }) => {
        current = { ...current, ...data, updatedAt: new Date() };
        return { count: 1 };
      });
      prisma.discoveryFeedback.create.mockResolvedValue({
        id: "feedback-sync",
        action,
      });
      prisma.manualReview.create.mockImplementation(async ({ data }) => {
        reviews.push({
          ...data,
          id: `change-${reviews.length}`,
          createdAt: new Date(),
        });
        return reviews.at(-1);
      });
      prisma.manualReview.findMany.mockImplementation(async () =>
        reviews.slice(-1),
      );
      prisma.manualReview.findFirst.mockImplementation(async ({ where }) =>
        reviews.find(
          (review) => (review as { reason?: string }).reason === where.reason,
        ),
      );
      const items = new ItemsService(prisma as unknown as PrismaService);

      await service.feedback({ listingId: current.id, action, position: 2 });
      const first = await items.changes("2020-01-01T00:00:00.000Z");
      expect(first.changes).toEqual([
        expect.objectContaining({
          id: current.id,
          favorite: action === "favorite",
          ignored: action === "dislike",
          note: "保留备注",
        }),
      ]);
      prisma.discoveryFeedback.findUnique.mockResolvedValue({
        id: "feedback-sync",
        listingId: current.id,
        productId: null,
        action,
        position: 2,
        undoEvents: [],
      });
      await service.undo("feedback-sync");
      const second = await items.changes(first.nextCursor);
      expect(second.changes).toEqual([
        expect.objectContaining({
          id: current.id,
          favorite: false,
          ignored: false,
          note: "保留备注",
        }),
      ]);
      expect(reviews).toHaveLength(2);
    },
  );
  beforeEach(() => {
    vi.stubEnv("CHINA_MARKET_COMPARISON_ENABLED", "true");
    vi.stubEnv("CHINA_MARKET_COMPARISON_AUTHORIZED", "true");
    vi.stubEnv("XIANYU_COMPARISON_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("excludes active consumed listings while keeping the requested preload", async () => {
    const { prisma, service } = serviceWith();
    prisma.discoveryFeedback.findMany.mockResolvedValue([
      { listingId: "consumed-listing" },
    ]);
    prisma.item.findMany.mockResolvedValue([{ id: "next-listing" }]);

    const result = await service.feed(12);

    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: "next-listing",
        chinaComparison: null,
        procurement: expect.objectContaining({
          category: "needs_facts",
          compactness: "unknown",
        }),
      }),
    ]);
    const expectedWhere = {
      ...activeMarketItemWhere(),
      id: { notIn: ["consumed-listing"] },
      favorite: false,
      listingType: undefined,
    };
    expect(prisma.item.count).not.toHaveBeenCalled();
    expect(prisma.item.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expectedWhere,
        select: expect.objectContaining({
          logistics: {
            select: {
              volumeCm3: true,
              lengthMm: true,
              widthMm: true,
              heightMm: true,
              notes: true,
            },
          },
        }),
      }),
    );
    expect(prisma.item.findMany.mock.calls[0]?.[0]).not.toHaveProperty("take");
    expect(prisma.item.findMany.mock.calls[0]?.[0]).not.toHaveProperty(
      "cursor",
    );
  });

  it("ranks the complete eligible library in one database projection", async () => {
    const { prisma, service } = serviceWith();
    const weakBatch = Array.from({ length: 500 }, (_, index) => ({
      id: `weak-${String(index).padStart(3, "0")}`,
      listingType: "direct",
      titleRaw: "大型ジャンク単品",
      priceCurrent: 20_000,
      shippingFee: 2_000,
      quantityEst: 1,
      categoryToyType: "dx_belt",
      conditionGrade: "junk",
      logistics: { volumeCm3: 50_000 },
    }));
    const olderStrong = {
      id: "older-compact-lot",
      listingType: "direct",
      titleRaw: "食玩 まとめ 20点",
      priceCurrent: 4_000,
      shippingFee: 0,
      quantityEst: 20,
      categoryToyType: "shokugan",
      conditionGrade: "used",
      logistics: { volumeCm3: 4_000 },
    };
    prisma.item.findMany
      .mockResolvedValueOnce([...weakBatch, olderStrong])
      .mockResolvedValueOnce([olderStrong, ...weakBatch.slice(0, 2)]);
    prisma.item.count.mockResolvedValue(501);

    const result = await service.feed(3, "direct");

    expect(result.items[0]).toEqual(
      expect.objectContaining({ id: "older-compact-lot" }),
    );
    const rankingQuery = prisma.item.findMany.mock.calls[0]?.[0];
    expect(rankingQuery).not.toHaveProperty("take");
    expect(rankingQuery).not.toHaveProperty("cursor");
    expect(rankingQuery).toMatchObject({
      orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
    });
    expect(prisma.item.findMany).toHaveBeenCalledTimes(2);
  });

  it("ranks compact high-quantity low-cost goods ahead of newer weak candidates", async () => {
    const { prisma, service } = serviceWith();
    prisma.item.findMany.mockResolvedValue([
      {
        id: "newer-bulky-single",
        listingType: "direct",
        titleRaw: "大型 DX 玩具 1件",
        priceCurrent: 12_000,
        shippingFee: 2_000,
        quantityEst: 1,
        categoryToyType: "dx_belt",
        conditionGrade: "used",
        logistics: {
          volumeCm3: 60_000,
          lengthMm: 600,
          widthMm: 400,
          heightMm: 250,
        },
      },
      {
        id: "compact-cheap-lot",
        listingType: "direct",
        titleRaw: "食玩 まとめ 10点",
        priceCurrent: 4_000,
        shippingFee: 1_000,
        quantityEst: 10,
        categoryToyType: "shokugan",
        conditionGrade: "used",
        logistics: {
          volumeCm3: 8_000,
          lengthMm: 200,
          widthMm: 200,
          heightMm: 200,
        },
      },
    ]);
    prisma.item.count.mockResolvedValue(2);

    const result = await service.feed(3, "direct");

    expect(result.items.map((item) => item.id)).toEqual([
      "compact-cheap-lot",
      "newer-bulky-single",
    ]);
    expect(result.items[0]).toMatchObject({
      procurement: {
        category: "preferred",
        compactness: "compact",
        compactnessBasis: "provided_volume",
        costBasis: "known",
        facts: expect.any(Array),
        reasons: expect.any(Array),
        missingFacts: [],
      },
    });
    expect(result.items[0]).not.toHaveProperty("logistics");
    expect(result.items[0].procurement).not.toHaveProperty("score");
    expect(result.items[0].procurement).not.toHaveProperty("utility");
  });

  it("retains a verified high-profit cross-market opportunity ahead of ordinary procurement rows", async () => {
    const { prisma, service } = serviceWith();
    const evaluatedAt = new Date();
    const opportunity = {
      status: "ready",
      trigger: "xianyu_reverse_search",
      xianyuReferencePriceCny: new Prisma.Decimal("1000"),
      acquisitionCostJpy: 5_500,
      grossRevenueJpy: 20_000,
      grossSpreadCny: new Prisma.Decimal("725"),
      grossSpreadRatio: 2.64,
      netProfitJpy: 11_600,
      netMarginRatio: 0.58,
      comparisonObservedAt: evaluatedAt,
      exchangeRateFetchedAt: evaluatedAt,
      evaluatedAt,
    };
    prisma.item.findMany.mockResolvedValue([
      {
        id: "ordinary-preferred",
        listingType: "direct",
        titleRaw: "食玩 まとめ 20点",
        priceCurrent: 2_000,
        shippingFee: 0,
        quantityEst: 20,
        categoryToyType: "shokugan",
        conditionGrade: "used",
        logistics: { volumeCm3: 3_000 },
        crossMarketOpportunities: [],
      },
      {
        id: "reverse-arbitrage",
        listingType: "direct",
        titleRaw: "指人形 まとめ 10点",
        priceCurrent: 5_000,
        shippingFee: 500,
        quantityEst: 10,
        categoryToyType: "finger_puppet",
        conditionGrade: "used",
        logistics: { volumeCm3: 5_000 },
        crossMarketOpportunities: [opportunity],
      },
    ]);
    prisma.item.count.mockResolvedValue(2);

    const result = await service.feed(2, "direct");

    expect(result.items.map((item) => item.id)).toEqual([
      "reverse-arbitrage",
      "ordinary-preferred",
    ]);
    expect(result.items[0]).not.toHaveProperty("crossMarketOpportunity");
    expect(result.items[0]).not.toHaveProperty("crossMarketOpportunities");
    const rankingCall = prisma.item.findMany.mock.calls[0]?.[0];
    const hydrationCall = prisma.item.findMany.mock.calls[1]?.[0];
    expect(rankingCall?.select?.crossMarketOpportunities).toMatchObject({
      where: { status: "ready" },
      select: { netProfitJpy: true, netMarginRatio: true },
      take: 1,
    });
    expect(hydrationCall?.select).not.toHaveProperty(
      "crossMarketOpportunities",
    );
  });

  it("keeps unknown shipping as a lower bound and unknown volume out of compact", async () => {
    const { prisma, service } = serviceWith();
    prisma.item.findMany.mockResolvedValue([
      {
        id: "missing-logistics",
        listingType: "direct",
        titleRaw: "特撮玩具 まとめ 10点",
        priceCurrent: 2_000,
        shippingFee: null,
        quantityEst: 10,
        categoryToyType: "other",
        conditionGrade: "used",
        logistics: null,
      },
    ]);
    prisma.item.count.mockResolvedValue(1);

    const result = await service.feed(3, "direct");

    expect(result.items[0].procurement).toMatchObject({
      category: "needs_facts",
      compactness: "unknown",
      compactnessBasis: "unknown",
      costBasis: "lower_bound",
      missingFacts: expect.arrayContaining(["shipping_fee", "volume"]),
    });
  });

  it("does not rank AI-estimated dimensions as verified compactness", async () => {
    const { prisma, service } = serviceWith();
    const candidate = {
      id: "ai-logistics-draft",
      listingType: "direct",
      titleRaw: "大型玩具 10点",
      priceCurrent: 2_000,
      shippingFee: 0,
      quantityEst: 10,
      categoryToyType: "other",
      conditionGrade: "used",
      logistics: {
        volumeCm3: 500,
        lengthMm: 100,
        widthMm: 100,
        heightMm: 50,
        notes: "[AI_ESTIMATE_UNVERIFIED]",
      },
    };
    prisma.item.findMany.mockResolvedValue([candidate]);
    prisma.item.count.mockResolvedValue(1);

    const result = await service.feed(3, "direct");

    expect(result.items[0].procurement).toMatchObject({
      compactness: "unknown",
      compactnessBasis: "unknown",
      missingFacts: expect.arrayContaining(["volume"]),
    });
  });

  it("returns the same ready China comparison contract with numeric prices", async () => {
    const { prisma, service } = serviceWith();
    const observedAt = new Date();
    const nextRefreshAt = new Date(observedAt.getTime() + 86_400_000);
    prisma.item.findMany.mockResolvedValue([
      {
        id: "listing-with-comparison",
        listingType: "direct",
        product: {
          canonicalName: "DX 测试商品",
          marketComparisons: [
            {
              id: "comparison-1",
              status: "ready",
              searchKeywords: ["DX 测试商品"],
              candidateCount: 9,
              matchedCount: 3,
              referencePriceCny: new Prisma.Decimal("329.90"),
              minPriceCny: new Prisma.Decimal("299.00"),
              maxPriceCny: new Prisma.Decimal("359.00"),
              referenceUrl: "https://www.goofish.com/item?id=offer-1",
              referenceTitle: "DX 测试商品 国行",
              confidence: 0.96,
              observedAt,
              nextRefreshAt,
              lastError: null,
              source: { key: "xianyu", displayName: "闲鱼" },
              offers: [
                {
                  id: "offer-1",
                  sourceListingId: "offer-1",
                  sourceUrl: "https://www.goofish.com/item?id=offer-1",
                  titleRaw: "DX 测试商品 国行",
                  priceCny: new Prisma.Decimal("329.90"),
                  currency: "CNY",
                  imageUrl: null,
                  location: null,
                  condition: "二手",
                  status: "active",
                  matchConfidence: 0.96,
                  matchDecision: "auto_matched",
                  lastSeenAt: observedAt,
                },
              ],
            },
          ],
        },
      },
    ]);
    prisma.item.count.mockResolvedValue(1);

    const result = await service.feed(1);

    expect(result.items[0].product).toEqual({
      canonicalName: "DX 测试商品",
    });
    expect(result.items[0].chinaComparison).toEqual({
      status: "ready",
      source: { key: "xianyu", displayName: "闲鱼" },
      referencePriceCny: 329.9,
      referenceUrl: "https://www.goofish.com/item?id=offer-1",
      observedAt,
      expiresAt: new Date(observedAt.getTime() + 86_400_000),
    });
    expect(result.items[0].product).not.toHaveProperty("marketComparisons");
    expect(prisma.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          product: {
            select: expect.objectContaining({
              marketComparisons: expect.objectContaining({
                where: {
                  status: "ready",
                  lastError: null,
                  source: { key: "xianyu" },
                },
              }),
            }),
          },
        }),
      }),
    );
  });

  it("keeps an auction with a countdown in the preloaded three-card stack", async () => {
    const { prisma, service } = serviceWith();
    prisma.item.findMany.mockResolvedValue([
      { id: "direct-1", listingType: "direct" },
      { id: "direct-2", listingType: "direct" },
      { id: "direct-3", listingType: "direct" },
      { id: "direct-4", listingType: "direct" },
      {
        id: "auction-1",
        listingType: "auction",
        auctionEndAt: new Date("2026-09-01T00:00:00Z"),
      },
    ]);
    prisma.item.count.mockResolvedValue(5);

    const result = await service.feed(12);

    expect(result.items.slice(0, 3).map((item) => item.listingType)).toContain(
      "auction",
    );
    expect(result.items[2]).toEqual(
      expect.objectContaining({
        id: "auction-1",
        auctionEndAt: new Date("2026-09-01T00:00:00Z"),
      }),
    );
    expect(result.items.map((item) => item.id)).toEqual([
      "direct-1",
      "direct-2",
      "auction-1",
      "direct-3",
      "direct-4",
    ]);
  });

  it("does not promote a deprioritized auction over preferred direct goods", async () => {
    const { prisma, service } = serviceWith();
    const preferred = (id: string) => ({
      id,
      listingType: "direct",
      titleRaw: `食玩まとめ ${id}`,
      categoryToyType: "shokugan",
      conditionGrade: "used",
      priceCurrent: 4_000,
      shippingFee: 0,
      quantityEst: 10,
      logistics: { volumeCm3: 5_000 },
    });
    prisma.item.findMany.mockResolvedValue([
      preferred("direct-1"),
      preferred("direct-2"),
      preferred("direct-3"),
      {
        id: "bad-auction",
        listingType: "auction",
        titleRaw: "大型ジャンク単品",
        categoryToyType: "dx_belt",
        conditionGrade: "junk",
        priceCurrent: 20_000,
        shippingFee: 2_000,
        quantityEst: 1,
        logistics: { volumeCm3: 50_000 },
        auctionEndAt: new Date("2026-09-02T00:00:00Z"),
      },
    ]);
    prisma.item.count.mockResolvedValue(4);

    const result = await service.feed(12);

    expect(result.items.slice(0, 3).map((item) => item.id)).toEqual([
      "direct-1",
      "direct-2",
      "direct-3",
    ]);
  });

  it("returns a type-specific total without mixing the discovery layers", async () => {
    const { prisma, service } = serviceWith();
    prisma.item.findMany.mockResolvedValue(
      Array.from({ length: 41 }, (_, index) => ({
        id: `direct-${index + 1}`,
        listingType: "direct",
      })),
    );

    const result = await service.feed(12, "direct");

    expect(result.total).toBe(41);
    expect(prisma.item.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ listingType: "direct" }),
      }),
    );
    expect(prisma.item.findMany.mock.calls[0]?.[0]).not.toHaveProperty("take");
    expect(prisma.item.findFirst).not.toHaveBeenCalled();
  });

  it("returns full eligible counts for every discovery layer in one response", async () => {
    const { prisma, service } = serviceWith();
    prisma.discoveryFeedback.findMany.mockResolvedValue([
      { listingId: "consumed-listing" },
    ]);
    prisma.item.findMany.mockResolvedValue([
      { id: "direct-1", listingType: "direct" },
    ]);
    prisma.item.groupBy.mockResolvedValue([
      { listingType: "direct", _count: { _all: 41 } },
      { listingType: "auction", _count: { _all: 23 } },
    ]);

    const result = await service.feed(12, "direct");

    expect(result.facets).toEqual({ direct: 41, auction: 23, unknown: 0 });
    expect(prisma.item.groupBy).toHaveBeenCalledWith({
      by: ["listingType"],
      where: {
        ...activeMarketItemWhere(),
        id: { notIn: ["consumed-listing"] },
        favorite: false,
        listingType: undefined,
      },
      _count: { _all: true },
    });
  });

  it("keeps unresolved transaction types reachable as their own discovery layer", async () => {
    const { prisma, service } = serviceWith();
    prisma.item.findMany.mockResolvedValue([
      { id: "unknown-1", listingType: "unknown" },
    ]);
    prisma.item.count.mockResolvedValue(1);

    const result = await service.feed(12, "unknown");

    expect(result.total).toBe(1);
    expect(prisma.item.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ listingType: "unknown" }),
      }),
    );
  });

  it("persists favorite feedback and synchronizes the listing favorite flag", async () => {
    const { prisma, service } = serviceWith();
    prisma.item.findUnique.mockResolvedValue({
      id: "89a6ce89-a2d9-4ad8-8cb5-8f6d130c1c62",
      productId: null,
      favorite: false,
      archivedAt: null,
    });
    prisma.discoveryFeedback.create.mockResolvedValue({
      id: "feedback-1",
      action: DiscoveryAction.favorite,
    });
    prisma.item.update.mockResolvedValue({});

    const result = await service.feedback({
      listingId: "89a6ce89-a2d9-4ad8-8cb5-8f6d130c1c62",
      action: "favorite",
      position: 4,
    });

    expect(result.feedback).toEqual({
      id: "feedback-1",
      action: DiscoveryAction.favorite,
    });
    expect(prisma.discoveryFeedback.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: DiscoveryAction.favorite,
        position: 4,
      }),
    });
    expect(prisma.item.update).toHaveBeenCalledWith({
      where: { id: "89a6ce89-a2d9-4ad8-8cb5-8f6d130c1c62" },
      data: { favorite: true },
      select: expect.any(Object),
    });
  });

  it("moves a disliked listing into the same ignored warehouse instead of deleting it", async () => {
    const { prisma, service } = serviceWith();
    prisma.item.findUnique.mockResolvedValue({
      id: "89a6ce89-a2d9-4ad8-8cb5-8f6d130c1c62",
      productId: null,
      favorite: true,
      ignored: false,
      ignoredAt: null,
      archivedAt: null,
    });
    prisma.discoveryFeedback.create.mockResolvedValue({
      id: "feedback-dislike",
      action: DiscoveryAction.dislike,
    });
    prisma.item.update.mockResolvedValue({});

    await service.feedback({
      listingId: "89a6ce89-a2d9-4ad8-8cb5-8f6d130c1c62",
      action: "dislike",
      position: 1,
    });

    expect(prisma.item.update).toHaveBeenCalledWith({
      where: { id: "89a6ce89-a2d9-4ad8-8cb5-8f6d130c1c62" },
      data: {
        favorite: false,
        ignored: true,
        ignoredAt: expect.any(Date),
        ignoredReason: "manual",
      },
      select: expect.any(Object),
    });
    expect(prisma.item.deleteMany).not.toHaveBeenCalled();
  });

  it("writes an undo event and restores a favorited listing", async () => {
    const { prisma, service } = serviceWith();
    let current = {
      id: "89a6ce89-a2d9-4ad8-8cb5-8f6d130c1c62",
      productId: null,
      favorite: true,
      ignored: false,
      ignoredAt: null,
      archivedAt: null,
      status: "active",
      purchaseRecord: null,
      note: null,
      updatedAt: new Date(),
    };
    prisma.discoveryFeedback.findUnique.mockResolvedValue({
      id: "feedback-1",
      listingId: current.id,
      productId: null,
      action: DiscoveryAction.favorite,
      position: 2,
      undoEvents: [],
    });
    prisma.manualReview.findFirst.mockResolvedValue({
      beforeData: {
        favorite: false,
        ignored: false,
        ignoredAt: null,
      },
      afterData: {
        favorite: true,
        ignored: false,
        ignoredAt: null,
      },
    });
    prisma.discoveryFeedback.create.mockResolvedValue({
      id: "undo-1",
      action: DiscoveryAction.undo,
    });
    prisma.item.findUnique.mockImplementation(async () => ({ ...current }));
    prisma.item.updateMany.mockImplementation(async ({ data }) => {
      current = { ...current, ...data, updatedAt: new Date() };
      return { count: 1 };
    });

    const result = await service.undo("feedback-1");

    expect(result.feedback).toEqual({
      id: "undo-1",
      action: DiscoveryAction.undo,
    });
    expect(prisma.discoveryFeedback.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: DiscoveryAction.undo,
        undoOfId: "feedback-1",
      }),
    });
    expect(prisma.item.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "89a6ce89-a2d9-4ad8-8cb5-8f6d130c1c62",
        favorite: true,
        ignored: false,
        ignoredAt: null,
        archivedAt: null,
        purchaseRecord: { is: null },
      }),
      data: { favorite: false, ignored: false, ignoredAt: null },
    });
  });

  it("restores the exact state from before dislike without returning an already-favorite item to discovery", async () => {
    const { prisma, service } = serviceWith();
    const ignoredAt = new Date("2026-09-05T08:00:00.000Z");
    let current = {
      id: "listing-restore-favorite",
      productId: null,
      favorite: false,
      ignored: true,
      ignoredAt,
      archivedAt: null,
      status: "active",
      purchaseRecord: null,
      note: "协作备注",
      updatedAt: new Date(),
    };
    prisma.discoveryFeedback.findUnique.mockResolvedValue({
      id: "feedback-dislike",
      listingId: current.id,
      productId: null,
      action: DiscoveryAction.dislike,
      position: 3,
      undoEvents: [],
    });
    prisma.manualReview.findFirst.mockResolvedValue({
      beforeData: {
        favorite: true,
        ignored: false,
        ignoredAt: null,
      },
      afterData: {
        favorite: false,
        ignored: true,
        ignoredAt: ignoredAt.toISOString(),
      },
    });
    prisma.discoveryFeedback.create.mockResolvedValue({
      id: "undo-dislike",
      action: DiscoveryAction.undo,
    });
    prisma.item.findUnique.mockImplementation(async () => ({ ...current }));
    prisma.item.updateMany.mockImplementation(async ({ data }) => {
      current = { ...current, ...data, updatedAt: new Date() };
      return { count: 1 };
    });

    const result = await service.undo("feedback-dislike");

    expect(result.item).toBeNull();
    expect(current).toMatchObject({
      favorite: true,
      ignored: false,
      ignoredAt: null,
      note: "协作备注",
    });
    expect(prisma.manualReview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reason: "discovery:undo-dislike:undo",
        beforeData: expect.objectContaining({
          favorite: false,
          ignored: true,
        }),
        afterData: expect.objectContaining({
          favorite: true,
          ignored: false,
        }),
      }),
    });
  });

  it("refuses to overwrite a later collaborator preference change", async () => {
    const { prisma, service } = serviceWith();
    prisma.discoveryFeedback.findUnique.mockResolvedValue({
      id: "feedback-stale",
      listingId: "listing-stale",
      productId: null,
      action: DiscoveryAction.favorite,
      position: 0,
      undoEvents: [],
    });
    prisma.manualReview.findFirst.mockResolvedValue({
      beforeData: {
        favorite: false,
        ignored: false,
        ignoredAt: null,
      },
      afterData: {
        favorite: true,
        ignored: false,
        ignoredAt: null,
      },
    });
    prisma.item.findUnique.mockResolvedValue({
      id: "listing-stale",
      productId: null,
      favorite: false,
      ignored: true,
      ignoredAt: new Date("2026-09-05T09:00:00.000Z"),
      archivedAt: null,
      status: "active",
      purchaseRecord: null,
      note: null,
      updatedAt: new Date(),
    });

    await expect(service.undo("feedback-stale")).rejects.toThrow(
      "不能覆盖后续修改",
    );
    expect(prisma.discoveryFeedback.create).not.toHaveBeenCalled();
    expect(prisma.item.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to guess the state for historical or no-op favorite feedback without a snapshot", async () => {
    const { prisma, service } = serviceWith();
    prisma.discoveryFeedback.findUnique.mockResolvedValue({
      id: "feedback-noop",
      listingId: "listing-already-favorite",
      productId: null,
      action: DiscoveryAction.favorite,
      position: 1,
      undoEvents: [],
    });
    prisma.manualReview.findFirst.mockResolvedValue(null);

    await expect(service.undo("feedback-noop")).rejects.toThrow(
      "缺少可验证的状态记录",
    );
    expect(prisma.discoveryFeedback.create).not.toHaveBeenCalled();
    expect(prisma.item.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["archived", { archivedAt: new Date("2026-09-05T10:00:00.000Z") }],
    ["ended", { status: "ended" }],
    ["purchased", { purchaseRecord: { id: "purchase-1" } }],
  ])("does not return a %s item to discovery", async (_case, override) => {
    const { prisma, service } = serviceWith();
    prisma.discoveryFeedback.findUnique.mockResolvedValue({
      id: "feedback-lifecycle",
      listingId: "listing-lifecycle",
      productId: null,
      action: DiscoveryAction.favorite,
      position: 1,
      undoEvents: [],
    });
    prisma.manualReview.findFirst.mockResolvedValue({
      beforeData: {
        favorite: false,
        ignored: false,
        ignoredAt: null,
      },
      afterData: {
        favorite: true,
        ignored: false,
        ignoredAt: null,
      },
    });
    prisma.item.findUnique.mockResolvedValue({
      id: "listing-lifecycle",
      productId: null,
      favorite: true,
      ignored: false,
      ignoredAt: null,
      archivedAt: null,
      status: "active",
      purchaseRecord: null,
      note: null,
      updatedAt: new Date(),
      ...override,
    });

    await expect(service.undo("feedback-lifecycle")).rejects.toThrow();
    expect(prisma.discoveryFeedback.create).not.toHaveBeenCalled();
    expect(prisma.item.updateMany).not.toHaveBeenCalled();
  });

  it("returns the existing undo event when two undo requests race", async () => {
    const { prisma, service } = serviceWith();
    const existingUndo = {
      id: "undo-winner",
      listingId: "listing-race",
      productId: null,
      action: DiscoveryAction.undo,
      position: 4,
      undoOfId: "feedback-race",
      timestamp: new Date(),
    };
    let originalRead = 0;
    let current = {
      id: "listing-race",
      productId: null,
      favorite: true,
      ignored: false,
      ignoredAt: null,
      archivedAt: null,
      status: "active",
      purchaseRecord: null,
      note: null,
      updatedAt: new Date(),
    };
    prisma.discoveryFeedback.findUnique.mockImplementation(async () => ({
      id: "feedback-race",
      listingId: current.id,
      productId: null,
      action: DiscoveryAction.favorite,
      position: 4,
      undoEvents: originalRead++ === 0 ? [] : [existingUndo],
    }));
    prisma.manualReview.findFirst.mockResolvedValue({
      beforeData: {
        favorite: false,
        ignored: false,
        ignoredAt: null,
      },
      afterData: {
        favorite: true,
        ignored: false,
        ignoredAt: null,
      },
    });
    prisma.discoveryFeedback.create.mockImplementation(async () => {
      current = { ...current, favorite: false, updatedAt: new Date() };
      throw { code: "P2002" };
    });
    prisma.item.findUnique.mockImplementation(async ({ select }) =>
      select.favorite
        ? { ...current }
        : {
            id: current.id,
            productId: null,
            sourceUrl: "https://example.com/item",
            titleRaw: "テスト商品",
            titleZh: "测试商品",
            priceCurrent: 1_000,
            shippingFee: 0,
            priceTotalEst: 1_000,
            listedAt: null,
            detectedAt: new Date(),
            auctionEndAt: null,
            listingType: "direct",
            categoryIp: "kamen_rider",
            categoryToyType: "dx_belt",
            conditionGrade: "good",
            quantityEst: 1,
            unitCostEst: 1_000,
            note: null,
            logistics: null,
            source: { key: "test", displayName: "测试" },
            images: [],
            product: null,
          },
    );

    const result = await service.undo("feedback-race");

    expect(result.feedback).toEqual(existingUndo);
    expect(originalRead).toBe(2);
    expect(prisma.discoveryFeedback.create).toHaveBeenCalledTimes(1);
    expect(prisma.item.updateMany).not.toHaveBeenCalled();
  });
});

describe("DiscoveryService deleted listings", () => {
  const deletedListing = {
    id: "listing-deleted",
    productId: null,
    favorite: false,
    ignored: true,
    ignoredAt: new Date("2026-09-05T08:00:00.000Z"),
    archivedAt: null,
    deletedAt: new Date("2026-10-25T00:00:00.000Z"),
    status: "active",
    purchaseRecord: null,
    note: null,
    updatedAt: new Date(),
  };

  it("rejects feedback for a deleted listing without writing a feedback row", async () => {
    const { prisma, service } = serviceWith();
    prisma.item.findUnique.mockResolvedValue({ ...deletedListing });

    await expect(
      service.feedback({
        listingId: "listing-deleted",
        action: "dislike",
        position: 0,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.discoveryFeedback.create).not.toHaveBeenCalled();
  });

  it("keeps deleted listings out of the feed query", async () => {
    const { prisma, service } = serviceWith();
    prisma.item.findMany.mockResolvedValue([]);
    prisma.item.count.mockResolvedValue(0);

    await service.feed(12, "direct");

    const wheres = prisma.item.findMany.mock.calls
      .map(
        (call: unknown[]) =>
          (call[0] as { where?: unknown } | undefined)?.where,
      )
      .filter(Boolean);
    expect(wheres.length).toBeGreaterThan(0);
    for (const where of wheres)
      expect(where).toMatchObject({ deletedAt: null });
  });

  it("cannot undo a dislike back onto a deleted listing", async () => {
    const { prisma, service } = serviceWith();
    prisma.discoveryFeedback.findUnique.mockResolvedValue({
      id: "feedback-dislike",
      listingId: "listing-deleted",
      productId: null,
      action: DiscoveryAction.dislike,
      position: 3,
      undoEvents: [],
    });
    prisma.manualReview.findFirst.mockResolvedValue({
      beforeData: { favorite: false, ignored: false, ignoredAt: null },
      afterData: {
        favorite: false,
        ignored: true,
        ignoredAt: deletedListing.ignoredAt.toISOString(),
      },
    });
    prisma.item.findUnique.mockResolvedValue({ ...deletedListing });

    await expect(service.undo("feedback-dislike")).rejects.toThrow(
      "商品已被删除，不能恢复到发现页",
    );
    expect(prisma.item.updateMany).not.toHaveBeenCalled();
    expect(prisma.discoveryFeedback.create).not.toHaveBeenCalled();
  });
});
