import { Prisma } from "@tokusatsu/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  itemResponseWithChinaComparison,
  readyChinaComparisonDetailRelation,
  readyChinaComparisonRelation,
} from "./item-response.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const NOW = new Date("2026-09-01T12:00:00.000Z");
const originalMaxStale = process.env.XIANYU_COMPARISON_MAX_STALE_MS;
const originalInterval = process.env.XIANYU_COMPARISON_INTERVAL_MS;
const originalComparisonEnabled = process.env.CHINA_MARKET_COMPARISON_ENABLED;
const originalComparisonAuthorized =
  process.env.CHINA_MARKET_COMPARISON_AUTHORIZED;
const originalXianyuEnabled = process.env.XIANYU_COMPARISON_ENABLED;
const originalArbitrageEnabled =
  process.env.XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED;

function comparison(overrides: Record<string, unknown> = {}) {
  return {
    id: "comparison-internal-id",
    status: "ready",
    searchKeywords: ["DX 测试商品"],
    candidateCount: 20,
    matchedCount: 4,
    referencePriceCny: new Prisma.Decimal("188.80"),
    minPriceCny: new Prisma.Decimal("168.00"),
    maxPriceCny: new Prisma.Decimal("208.00"),
    referenceUrl: "https://www.goofish.com/item?id=offer-1",
    referenceTitle: "内部候选标题",
    confidence: 0.97,
    observedAt: new Date(NOW.getTime() - 6 * HOUR_MS),
    nextRefreshAt: new Date(NOW.getTime() + 6 * HOUR_MS),
    lastError: null,
    source: { key: "xianyu", displayName: "闲鱼" },
    offers: [
      {
        id: "offer-internal-id",
        titleRaw: "不应公开的候选标题",
        priceCny: new Prisma.Decimal("188.80"),
        location: "上海",
        matchConfidence: 0.97,
      },
    ],
    ...overrides,
  };
}

function response(overrides: Record<string, unknown> = {}) {
  return itemResponseWithChinaComparison({
    id: "item-1",
    product: {
      id: "product-1",
      canonicalName: "DX 测试商品",
      marketComparisons: [comparison(overrides)],
    },
  });
}

function valueKingItem(
  itemOverrides: Record<string, unknown> = {},
  opportunityOverrides: Record<string, unknown> = {},
  comparisonOverrides: Record<string, unknown> = {},
) {
  const observedAt = new Date(NOW.getTime() - HOUR_MS);
  return {
    id: "item-king",
    listingType: "direct",
    status: "active",
    archivedAt: null,
    ignored: false,
    purchaseRecord: null,
    priceCurrent: 3_000,
    shippingFee: 500,
    quantityEst: 5,
    conditionGrade: "used",
    crossMarketOpportunities: [
      {
        status: "ready",
        xianyuReferencePriceCny: new Prisma.Decimal("1200"),
        jpyToCnyRate: new Prisma.Decimal("0.05"),
        acquisitionCostJpy: 3_500,
        grossSpreadCny: new Prisma.Decimal("1025"),
        grossSpreadRatio: 0.85,
        netProfitJpy: 12_000,
        netMarginRatio: 0.6,
        missingFacts: [],
        rejectionReason: null,
        listingObservedAt: observedAt,
        comparisonObservedAt: observedAt,
        exchangeRateFetchedAt: observedAt,
        evidenceExpiresAt: new Date(NOW.getTime() + HOUR_MS),
        evaluatedAt: observedAt,
        comparison: {
          status: "ready",
          matchedCount: 3,
          confidence: 0.95,
          referencePriceCny: new Prisma.Decimal("1200"),
          referenceUrl: "https://www.goofish.com/item?id=offer-king",
          observedAt,
          lastError: null,
          source: { key: "xianyu" },
          ...comparisonOverrides,
        },
        ...opportunityOverrides,
      },
    ],
    ...itemOverrides,
  };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value == null) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  process.env.CHINA_MARKET_COMPARISON_ENABLED = "true";
  process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
  process.env.XIANYU_COMPARISON_ENABLED = "true";
  process.env.XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED = "true";
  delete process.env.XIANYU_COMPARISON_MAX_STALE_MS;
  delete process.env.XIANYU_COMPARISON_INTERVAL_MS;
});

afterEach(() => {
  vi.useRealTimers();
  restoreEnv("XIANYU_COMPARISON_MAX_STALE_MS", originalMaxStale);
  restoreEnv("XIANYU_COMPARISON_INTERVAL_MS", originalInterval);
  restoreEnv("CHINA_MARKET_COMPARISON_ENABLED", originalComparisonEnabled);
  restoreEnv(
    "CHINA_MARKET_COMPARISON_AUTHORIZED",
    originalComparisonAuthorized,
  );
  restoreEnv("XIANYU_COMPARISON_ENABLED", originalXianyuEnabled);
  restoreEnv("XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED", originalArbitrageEnabled);
});

describe("itemResponseWithChinaComparison", () => {
  it.each([
    "CHINA_MARKET_COMPARISON_ENABLED",
    "CHINA_MARKET_COMPARISON_AUTHORIZED",
    "XIANYU_COMPARISON_ENABLED",
  ] as const)(
    "hides China-market evidence when %s is not enabled",
    (environmentKey) => {
      process.env[environmentKey] = "false";
      expect(response().chinaComparison).toBeNull();
    },
  );

  it("returns only validated public evidence and removes persistence relations", () => {
    const result = response();

    expect(readyChinaComparisonRelation.select).toEqual({
      status: true,
      matchedCount: true,
      minPriceCny: true,
      maxPriceCny: true,
      confidence: true,
      source: { select: { key: true, displayName: true } },
      referencePriceCny: true,
      referenceUrl: true,
      observedAt: true,
      lastError: true,
    });
    expect(readyChinaComparisonRelation.where).toEqual({
      status: "ready",
      lastError: null,
      source: { key: "xianyu" },
    });
    expect(result.chinaComparison).toEqual({
      status: "ready",
      source: { key: "xianyu", displayName: "闲鱼" },
      referencePriceCny: 188.8,
      referenceUrl: "https://www.goofish.com/item?id=offer-1",
      observedAt: new Date("2026-09-01T06:00:00.000Z"),
      expiresAt: new Date("2026-09-02T06:00:00.000Z"),
    });
    expect(result.product).toEqual({
      id: "product-1",
      canonicalName: "DX 测试商品",
    });
    expect(result.chinaComparison).not.toHaveProperty("nextRefreshAt");
    expect(result).not.toHaveProperty("crossMarketOpportunity");
  });

  it("publishes at most three current accepted detail offers without private fields", () => {
    const observedAt = new Date(NOW.getTime() - 6 * HOUR_MS);
    const acceptedOffer = (id: string, price: number) => ({
      sourceListingId: id,
      sourceUrl: `https://www.goofish.com/item?id=${id}&tracking=1`,
      titleRaw: `假面骑士同款 ${id}`,
      priceCny: new Prisma.Decimal(price),
      imageUrl: `https://img.example.com/${id}.jpg`,
      condition: "全新未拆",
      status: "active",
      matchConfidence: 0.93,
      matchDecision: "auto_matched",
      lastSeenAt: observedAt,
      location: "不应公开",
      providerKey: "不应公开",
    });
    const result = itemResponseWithChinaComparison(
      {
        id: "item-1",
        product: {
          id: "product-1",
          marketComparisons: [
            comparison({
              observedAt,
              offers: [
                acceptedOffer("offer-3", 210),
                acceptedOffer("offer-1", 170),
                acceptedOffer("offer-2", 190),
                acceptedOffer("offer-4", 230),
              ],
            }),
          ],
        },
      },
      { includeOffers: true },
    );

    expect(readyChinaComparisonDetailRelation.select.offers.take).toBe(3);
    const publicOffers = result.chinaComparison?.offers ?? [];
    expect(publicOffers).toHaveLength(3);
    expect(publicOffers.map((offer) => offer.priceCny)).toEqual([
      170, 190, 210,
    ]);
    expect(publicOffers[0]).toEqual({
      title: "假面骑士同款 offer-1",
      priceCny: 170,
      condition: "全新未拆",
      imageUrl: "https://img.example.com/offer-1.jpg",
      sourceUrl: "https://www.goofish.com/item?id=offer-1",
      isReference: true,
    });
    expect(JSON.stringify(result.chinaComparison)).not.toContain("location");
    expect(JSON.stringify(result.chinaComparison)).not.toContain("providerKey");
  });

  it("removes internal opportunity evidence without publishing profit", () => {
    const result = itemResponseWithChinaComparison({
      id: "item-1",
      crossMarketOpportunities: [
        {
          status: "ready",
          netProfitJpy: 11_600,
          netMarginRatio: 0.58,
        },
      ],
    });

    expect(result).not.toHaveProperty("crossMarketOpportunities");
    expect(result).not.toHaveProperty("crossMarketOpportunity");
  });

  it("publishes a direct-buy value king only from current complete evidence", () => {
    const observedAt = new Date(NOW.getTime() - HOUR_MS);
    const result = itemResponseWithChinaComparison({
      id: "item-king",
      listingType: "direct",
      status: "active",
      archivedAt: null,
      ignored: false,
      purchaseRecord: null,
      priceCurrent: 3_000,
      shippingFee: 500,
      quantityEst: 5,
      conditionGrade: "used",
      crossMarketOpportunities: [
        {
          status: "ready",
          xianyuReferencePriceCny: new Prisma.Decimal("1200"),
          jpyToCnyRate: new Prisma.Decimal("0.05"),
          acquisitionCostJpy: 3_500,
          grossSpreadCny: new Prisma.Decimal("1025"),
          grossSpreadRatio: 0.85,
          netProfitJpy: 12_000,
          netMarginRatio: 0.6,
          missingFacts: [],
          rejectionReason: null,
          listingObservedAt: observedAt,
          comparisonObservedAt: observedAt,
          exchangeRateFetchedAt: observedAt,
          evidenceExpiresAt: new Date(NOW.getTime() + HOUR_MS),
          evaluatedAt: observedAt,
          comparison: {
            status: "ready",
            matchedCount: 3,
            confidence: 0.95,
            referencePriceCny: new Prisma.Decimal("1200"),
            referenceUrl: "https://www.goofish.com/item?id=offer-king",
            observedAt,
            lastError: null,
            source: { key: "xianyu" },
          },
        },
      ],
    });

    expect(result.valueKing).toMatchObject({
      kind: "high_value_low_price",
      label: "高价值低价",
      acquisitionCostJpy: 3_500,
      unitCostJpy: 700,
      quantity: 5,
      xianyuReferencePriceCny: 1_200,
      netProfitJpy: 12_000,
    });
    expect(result).not.toHaveProperty("crossMarketOpportunities");
  });

  it("hides a value king when the current listing cost no longer matches its evidence", () => {
    const observedAt = new Date(NOW.getTime() - HOUR_MS);
    const result = itemResponseWithChinaComparison({
      listingType: "direct",
      status: "active",
      archivedAt: null,
      ignored: false,
      purchaseRecord: null,
      priceCurrent: 3_500,
      shippingFee: 500,
      quantityEst: 5,
      conditionGrade: "used",
      crossMarketOpportunities: [
        {
          status: "ready",
          xianyuReferencePriceCny: new Prisma.Decimal("1200"),
          jpyToCnyRate: new Prisma.Decimal("0.05"),
          acquisitionCostJpy: 3_500,
          grossSpreadCny: new Prisma.Decimal("1025"),
          grossSpreadRatio: 0.85,
          netProfitJpy: 12_000,
          netMarginRatio: 0.6,
          missingFacts: [],
          rejectionReason: null,
          listingObservedAt: observedAt,
          comparisonObservedAt: observedAt,
          exchangeRateFetchedAt: observedAt,
          evidenceExpiresAt: new Date(NOW.getTime() + HOUR_MS),
          evaluatedAt: observedAt,
          comparison: {
            status: "ready",
            matchedCount: 3,
            confidence: 0.95,
            referencePriceCny: new Prisma.Decimal("1200"),
            referenceUrl: "https://www.goofish.com/item?id=offer-king",
            observedAt,
            lastError: null,
            source: { key: "xianyu" },
          },
        },
      ],
    });

    expect(result.valueKing).toBeNull();
  });

  it.each([
    ["缺少邮费", { shippingFee: null }, {}, {}],
    ["缺少数量", { quantityEst: null }, {}, {}],
    [
      "证据已经过期",
      {},
      { evidenceExpiresAt: new Date(NOW.getTime() - 1) },
      {},
    ],
    [
      "闲鱼证据已经陈旧",
      {},
      {},
      { observedAt: new Date(NOW.getTime() - 25 * HOUR_MS) },
    ],
    ["闲鱼同款少于三个", {}, {}, { matchedCount: 2 }],
  ])(
    "hides a candidate when %s",
    (_reason, item, opportunity, comparisonRow) => {
      const result = itemResponseWithChinaComparison(
        valueKingItem(item, opportunity, comparisonRow),
      );
      expect(result.valueKing).toBeNull();
    },
  );

  it("hides legacy ready summaries carrying a failed refresh without leaking the error", () => {
    const result = response({ lastError: "private-provider-failure" });
    expect(result.chinaComparison).toBeNull();
    expect(JSON.stringify(result)).not.toContain("private-provider-failure");
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "hides a ready comparison with invalid price %s",
    (referencePriceCny) => {
      expect(response({ referencePriceCny }).chinaComparison).toBeNull();
    },
  );

  it.each([
    "https://example.cn/item/offer-1",
    "https://www.goofish.com/",
    "https://www.goofish.com/search?id=offer-1",
    "https://www.goofish.com/search/offer-1",
    "https://www.goofish.com/other/offer-1",
    "https://www.goofish.com/item/offer-1",
    "https://www.goofish.com/item/offer-1/extra",
    "https://www.goofish.com/item/offer-1?id=offer-2",
    "https://www.goofish.com/item?id=offer-1&id=offer-2",
    "http://www.goofish.com/item?id=offer-1",
    "https://www.goofish.com/item?id=bad id",
    "javascript:alert(1)",
    "https://goofish.com.evil.example/item/offer-1",
    "https://goofish.com@evil.example/item/offer-1",
  ])("hides a ready comparison with a non-Goofish URL: %s", (referenceUrl) => {
    expect(response({ referenceUrl }).chinaComparison).toBeNull();
  });

  it("removes tracking data from a canonical Goofish item URL", () => {
    expect(
      response({
        referenceUrl: "https://goofish.com/item?id=offer-1&track=1#seller",
      }).chinaComparison?.referenceUrl,
    ).toBe("https://www.goofish.com/item?id=offer-1");
  });

  it.each([
    { key: "mercari", displayName: "Mercari" },
    { key: "xianyu", displayName: "淘宝" },
    { key: "xianyu", displayName: "" },
    { key: "xianyu", displayName: "闲鱼\u0000" },
    null,
  ])("hides a ready comparison without a valid Xianyu source", (source) => {
    expect(response({ source }).chinaComparison).toBeNull();
  });

  it("hides evidence that does not satisfy the persisted sample bounds", () => {
    expect(response({ matchedCount: 2 }).chinaComparison).toBeNull();
    expect(
      response({ minPriceCny: new Prisma.Decimal("200") }).chinaComparison,
    ).toBeNull();
    expect(response({ confidence: null }).chinaComparison).toBeNull();
    expect(response({ confidence: 0.849 }).chinaComparison).toBeNull();
    expect(response({ confidence: 1.1 }).chinaComparison).toBeNull();
    expect(
      response({ minPriceCny: new Prisma.Decimal("1000000.01") })
        .chinaComparison,
    ).toBeNull();
    expect(
      response({ maxPriceCny: new Prisma.Decimal("1000000.01") })
        .chinaComparison,
    ).toBeNull();
  });

  it.each([null, new Date("invalid"), "2026-09-01T11:00:00.000Z"])(
    "hides a ready comparison with an invalid observation time",
    (observedAt) => {
      expect(response({ observedAt }).chinaComparison).toBeNull();
    },
  );

  it("uses a twenty-four-hour default freshness window", () => {
    expect(
      response({ observedAt: new Date(NOW.getTime() - DAY_MS) })
        .chinaComparison,
    ).not.toBeNull();
    expect(
      response({ observedAt: new Date(NOW.getTime() - DAY_MS - 1) })
        .chinaComparison,
    ).toBeNull();
  });

  it("rejects an observation timestamp that is materially in the future", () => {
    expect(
      response({ observedAt: new Date(NOW.getTime() + 5 * 60_000 + 1) })
        .chinaComparison,
    ).toBeNull();
  });

  it("derives freshness from the refresh interval and caps it at seven days", () => {
    process.env.XIANYU_COMPARISON_INTERVAL_MS = String(12 * 60 * 60_000);
    expect(
      response({ observedAt: new Date(NOW.getTime() - 36 * 60 * 60_000 - 1) })
        .chinaComparison,
    ).toBeNull();

    process.env.XIANYU_COMPARISON_INTERVAL_MS = String(10 * DAY_MS);
    expect(
      response({ observedAt: new Date(NOW.getTime() - 7 * DAY_MS - 1) })
        .chinaComparison,
    ).toBeNull();
  });

  it("honors an explicit maximum and falls back to twenty-four hours if it is invalid", () => {
    process.env.XIANYU_COMPARISON_MAX_STALE_MS = "1000";
    expect(
      response({ observedAt: new Date(NOW.getTime() - 1_001) }).chinaComparison,
    ).toBeNull();

    process.env.XIANYU_COMPARISON_MAX_STALE_MS = "not-a-number";
    process.env.XIANYU_COMPARISON_INTERVAL_MS = "1";
    expect(
      response({ observedAt: new Date(NOW.getTime() - DAY_MS) })
        .chinaComparison,
    ).not.toBeNull();
    expect(
      response({ observedAt: new Date(NOW.getTime() - DAY_MS - 1) })
        .chinaComparison,
    ).toBeNull();
  });

  it("caps an explicit freshness window at thirty days", () => {
    process.env.XIANYU_COMPARISON_MAX_STALE_MS = String(365 * DAY_MS);
    expect(
      response({ observedAt: new Date(NOW.getTime() - 30 * DAY_MS) })
        .chinaComparison,
    ).not.toBeNull();
    expect(
      response({ observedAt: new Date(NOW.getTime() - 30 * DAY_MS - 1) })
        .chinaComparison,
    ).toBeNull();
  });
});
