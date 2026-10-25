import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonitoringService } from "./monitoring.service.js";

describe("MonitoringService overview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T03:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("returns full-library market aggregates without inventing missing days", async () => {
    const itemCount = vi
      .fn()
      .mockResolvedValueOnce(26_002)
      .mockResolvedValueOnce(17_221)
      .mockResolvedValueOnce(814);
    const itemGroupBy = vi
      .fn()
      .mockResolvedValueOnce([
        { categoryIp: "kamen_rider", _count: { _all: 13_654 } },
        { categoryIp: "ultraman", _count: { _all: 2_297 } },
        { categoryIp: "unknown", _count: { _all: 1_270 } },
      ])
      .mockResolvedValueOnce([
        {
          collectibleSeries: "shf",
          categoryIp: "kamen_rider",
          _count: { _all: 1_900 },
        },
        {
          collectibleSeries: "shf",
          categoryIp: "ultraman",
          _count: { _all: 284 },
        },
        {
          collectibleSeries: "sic",
          categoryIp: "kamen_rider",
          _count: { _all: 126 },
        },
      ])
      .mockResolvedValueOnce([
        { listingType: "auction", _count: { _all: 12_345 } },
        { listingType: "direct", _count: { _all: 4_864 } },
        { listingType: "unknown", _count: { _all: 12 } },
      ])
      .mockResolvedValueOnce([
        { sourceId: "source-yahoo", _count: { _all: 12_177 } },
        { sourceId: "source-mercari", _count: { _all: 2_312 } },
      ]);
    const prisma = {
      crawlJob: { findMany: vi.fn().mockResolvedValue([]) },
      source: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "source-yahoo",
            key: "yahoo_auctions",
            displayName: "Yahoo auctions",
            enabled: true,
            circuitOpenAt: null,
            failureCount: 0,
            _count: { items: 12_500 },
          },
          {
            id: "source-mercari",
            key: "mercari",
            displayName: "Mercari",
            enabled: true,
            circuitOpenAt: null,
            failureCount: 0,
            _count: { items: 2_500 },
          },
        ]),
      },
      item: {
        count: itemCount,
        groupBy: itemGroupBy,
        findMany: vi.fn().mockResolvedValue([]),
      },
      product: { count: vi.fn().mockResolvedValue(8_000) },
      reviewQueue: { count: vi.fn().mockResolvedValue(40) },
      inventoryOrder: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { remainingQuantity: 18 } }),
      },
      $queryRaw: vi.fn().mockResolvedValue([
        { date: "2026-09-03", count: 120 },
        { date: "2026-09-05", count: 90 },
      ]),
      $transaction: vi.fn((queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };

    const result = await new MonitoringService(prisma as never).overview();

    expect(result.market.activeTotal).toBe(17_221);
    expect(result.market.valueKingTotal).toBe(0);
    expect(result.market.activeTotal).toBe(
      result.market.listingTypes.reduce((sum, entry) => sum + entry.count, 0),
    );
    expect(result.market.categories[0]).toEqual({
      key: "kamen_rider",
      count: 13_654,
    });
    expect(result.market.collections).toEqual([
      { key: "shf", categoryIp: "kamen_rider", count: 1_900 },
      { key: "shf", categoryIp: "ultraman", count: 284 },
      { key: "sic", categoryIp: "kamen_rider", count: 126 },
    ]);
    expect(itemGroupBy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          collectibleSeries: { not: null },
        }),
      }),
    );
    expect(result.market.listingTypes).toEqual(
      expect.arrayContaining([
        { key: "auction", count: 12_345 },
        { key: "direct", count: 4_864 },
      ]),
    );
    expect(result.market.sources[0]).toEqual({
      key: "yahoo_auctions",
      displayName: "Yahoo!オークション",
      count: 12_177,
    });
    expect(result.market.discoveryTrend).toHaveLength(7);
    expect(result.market.discoveryTrend).toEqual(
      expect.arrayContaining([
        { date: "2026-09-03", count: 120 },
        { date: "2026-09-04", count: 0 },
        { date: "2026-09-05", count: 90 },
      ]),
    );
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    const discoveryTrendSql = (
      prisma.$queryRaw.mock.calls[0]?.[0] as { strings?: string[] }
    ).strings?.join(" ");
    expect(discoveryTrendSql).toContain(
      `item."detectedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tokyo'`,
    );
    expect(discoveryTrendSql).toContain(`item."listingType"::text <> 'auction'`);
    expect(discoveryTrendSql).toContain(`item."auctionEndAt" IS NULL`);
    expect(discoveryTrendSql).toContain(`item."auctionEndAt" >`);
    expect((prisma.$queryRaw.mock.calls[0]?.[0] as { values?: unknown[] }).values)
      .toContainEqual(new Date("2026-09-05T03:00:00.000Z"));
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(itemCount).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          lifecycleStatus: "live",
          ignored: false,
          channel: "online",
          NOT: expect.arrayContaining([
            {
              titleRaw: {
                contains: "カードダス",
                mode: "insensitive",
              },
            },
          ]),
        }),
      }),
    );
    const activeWhere = itemCount.mock.calls[1][0]?.where;
    expect(itemGroupBy.mock.calls.map(([query]) => query.where)).toEqual([
      activeWhere,
      expect.objectContaining({
        ...activeWhere,
        collectibleSeries: { not: null },
      }),
      activeWhere,
      activeWhere,
    ]);
  });

  it("counts only candidates that pass the current value-king evidence contract", async () => {
    vi.stubEnv("CHINA_MARKET_COMPARISON_ENABLED", "true");
    vi.stubEnv("CHINA_MARKET_COMPARISON_AUTHORIZED", "true");
    vi.stubEnv("XIANYU_COMPARISON_ENABLED", "true");
    vi.stubEnv("XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED", "true");
    const now = new Date("2026-09-05T03:00:00.000Z");
    const observedAt = new Date(now.getTime() - 60 * 60_000);
    const opportunity = (acquisitionCostJpy: number) => ({
      status: "ready",
      xianyuReferencePriceCny: 1_200,
      jpyToCnyRate: 0.05,
      acquisitionCostJpy,
      grossSpreadCny: 1_025,
      grossSpreadRatio: 0.85,
      netProfitJpy: 12_000,
      netMarginRatio: 0.6,
      missingFacts: [],
      rejectionReason: null,
      listingObservedAt: observedAt,
      comparisonObservedAt: observedAt,
      exchangeRateFetchedAt: observedAt,
      evidenceExpiresAt: new Date(now.getTime() + 60 * 60_000),
      evaluatedAt: observedAt,
      comparison: {
        status: "ready",
        matchedCount: 3,
        confidence: 0.95,
        referencePriceCny: 1_200,
        referenceUrl: "https://www.goofish.com/item?id=value-king",
        observedAt,
        lastError: null,
        source: { key: "xianyu" },
      },
    });
    const candidate = (id: string, acquisitionCostJpy: number) => ({
      id,
      listingType: "direct",
      status: "active",
      archivedAt: null,
      ignored: false,
      purchaseRecord: null,
      priceCurrent: 3_000,
      shippingFee: 500,
      quantityEst: 5,
      conditionGrade: "used",
      crossMarketOpportunities: [opportunity(acquisitionCostJpy)],
    });
    const findValueKings = vi
      .fn()
      .mockResolvedValue([
        candidate("current", 3_500),
        candidate("stale-cost", 4_000),
      ]);
    const prisma = {
      crawlJob: { findMany: vi.fn().mockResolvedValue([]) },
      source: { findMany: vi.fn().mockResolvedValue([]) },
      item: {
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: findValueKings,
      },
      product: { count: vi.fn().mockResolvedValue(0) },
      reviewQueue: { count: vi.fn().mockResolvedValue(0) },
      inventoryOrder: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { remainingQuantity: 0 } }),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn((queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };

    const result = await new MonitoringService(prisma as never).overview();

    expect(result.market.valueKingTotal).toBe(1);
    expect(findValueKings).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          listingType: "direct",
          status: "active",
          shippingFee: { not: null },
          quantityEst: { not: null },
        }),
        select: expect.objectContaining({
          crossMarketOpportunities: expect.objectContaining({ take: 3 }),
        }),
      }),
    );
    expect(findValueKings.mock.calls[0][0].where).not.toHaveProperty('crossMarketOpportunities');
  });
});
