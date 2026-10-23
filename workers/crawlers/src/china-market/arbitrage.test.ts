import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  productFindUnique: vi.fn(),
  comparisonFindUnique: vi.fn(),
  comparisonUpdate: vi.fn(),
  comparisonRunFindFirst: vi.fn(),
  itemFindUnique: vi.fn(),
  itemFindMany: vi.fn(),
  exchangeRateFindUnique: vi.fn(),
  opportunityUpsert: vi.fn(),
  searchAddBulk: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: [...strings],
    values,
  })),
}));

vi.mock("@tokusatsu/db", () => ({
  Prisma: { sql: mocks.sql },
  prisma: {
    $transaction: mocks.transaction,
    product: { findUnique: mocks.productFindUnique },
    productMarketComparison: {
      findUnique: mocks.comparisonFindUnique,
      update: mocks.comparisonUpdate,
    },
    chinaMarketComparisonRun: { findFirst: mocks.comparisonRunFindFirst },
    item: {
      findUnique: mocks.itemFindUnique,
      findMany: mocks.itemFindMany,
    },
    exchangeRate: { findUnique: mocks.exchangeRateFindUnique },
    crossMarketOpportunity: { upsert: mocks.opportunityUpsert },
  },
}));

vi.mock("../queues.js", () => ({
  searchQueue: { addBulk: mocks.searchAddBulk },
}));

import {
  enabledJapanReverseSearchAdapters,
  japanReverseSearchKeywords,
  refreshCrossMarketOpportunityForItem,
  scheduleJapanReverseSearch,
} from "./arbitrage.js";

const envNames = [
  "REAL_ADAPTER_ENABLED",
  "XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED",
  "XIANYU_REVERSE_SEARCH_ENABLED",
  "XIANYU_ARBITRAGE_MIN_REFERENCE_PRICE_CNY",
  "XIANYU_ARBITRAGE_PLATFORM_FEE_RATE",
  "XIANYU_ARBITRAGE_INTERNATIONAL_SHIPPING_JPY",
  "XIANYU_ARBITRAGE_CHINA_FULFILLMENT_CNY",
  "YAHOO_SHOPPING_CLIENT_ID",
] as const;
const originalEnv = Object.fromEntries(
  envNames.map((name) => [name, process.env[name]]),
);

const product = {
  canonicalName: "仮面ライダー 指人形 10体セット",
  normalizedName: "仮面ライダー 指人形 10体セット",
  titleZh: "假面骑士 指偶 10件套",
  productLine: "指人形",
  modelNumber: "KR-FP-10",
  franchise: { nameJa: "仮面ライダー", nameZh: "假面骑士", nameEn: null },
  series: { nameJa: "仮面ライダー", nameZh: "假面骑士", nameEn: null },
  manufacturerEntity: {
    nameJa: "バンダイ",
    nameZh: "万代",
    nameEn: "Bandai",
  },
  toyTypeEntity: { nameJa: "指人形", nameZh: "指偶", nameEn: null },
  listings: [{ titleRaw: "仮面ライダー 指人形 10体 KR-FP-10" }],
};

const comparison = {
  id: "comparison-1",
  productId: "product-1",
  status: "ready",
  referencePriceCny: 1_000,
  referenceTitle: "假面骑士 指偶 10件 KR-FP-10",
  referenceUrl: "https://www.goofish.com/item?id=offer-1",
  matchedCount: 4,
  candidateCount: 4,
  confidence: 0.93,
  comparisonMethod: "xianyu-v1",
  keywordIdentityHash: "a".repeat(64),
  searchKeywords: ["假面骑士 指偶", "KR-FP-10 指偶", "万代 指人形"],
  providerStats: {
    complete: true,
    requestedKeywords: 3,
    attemptedKeywords: 3,
    rejectedRows: 0,
  },
  observedAt: new Date(),
  source: { key: "xianyu", comparisonOnly: true },
};

const item = {
  id: "item-1",
  productId: "product-1",
  sourceItemId: "jp-1",
  titleRaw: "仮面ライダー 指人形 10体 KR-FP-10",
  listingType: "direct",
  categoryToyType: "finger_puppet",
  conditionGrade: "used",
  priceCurrent: 5_000,
  shippingFee: 500,
  quantityEst: 10,
  logistics: { volumeCm3: 5_000 },
  status: "active",
  lastSeenAt: new Date(),
  archivedAt: null,
  ignored: false,
  matchDecision: "auto_matched",
  matchConfidence: 0.94,
  source: { key: "mercari", comparisonOnly: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.REAL_ADAPTER_ENABLED = "true";
  process.env.XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED = "true";
  process.env.XIANYU_REVERSE_SEARCH_ENABLED = "true";
  process.env.XIANYU_ARBITRAGE_MIN_REFERENCE_PRICE_CNY = "300";
  process.env.XIANYU_ARBITRAGE_PLATFORM_FEE_RATE = "0.05";
  process.env.XIANYU_ARBITRAGE_INTERNATIONAL_SHIPPING_JPY = "1500";
  process.env.XIANYU_ARBITRAGE_CHINA_FULFILLMENT_CNY = "20";
  delete process.env.YAHOO_SHOPPING_CLIENT_ID;
  mocks.productFindUnique.mockResolvedValue(product);
  mocks.comparisonFindUnique.mockResolvedValue(comparison);
  mocks.comparisonUpdate.mockResolvedValue({});
  mocks.comparisonRunFindFirst.mockResolvedValue({
    id: "run-1",
    comparisonId: "comparison-1",
    status: "ready",
    referencePriceCny: 1_000,
    referenceUrl: comparison.referenceUrl,
    comparisonMethod: comparison.comparisonMethod,
    candidateCount: comparison.candidateCount,
    matchedCount: comparison.matchedCount,
    observedAt: comparison.observedAt,
    completedAt: new Date(),
  });
  mocks.itemFindUnique.mockResolvedValue(item);
  mocks.exchangeRateFindUnique.mockResolvedValue({
    pair: "JPY_CNY",
    rate: 0.05,
    source: "test-rate",
    referenceDate: new Date(),
    fetchedAt: new Date(),
  });
  mocks.opportunityUpsert.mockImplementation(
    async (args: { create: { status: string } }) => ({
      id: "opportunity-1",
      status: args.create.status,
    }),
  );
  mocks.queryRaw.mockResolvedValue([]);
  mocks.transaction.mockImplementation(
    async (callback: (transaction: unknown) => Promise<unknown>) =>
      callback({
        $queryRaw: mocks.queryRaw,
        productMarketComparison: {
          findUnique: mocks.comparisonFindUnique,
        },
        chinaMarketComparisonRun: {
          findFirst: mocks.comparisonRunFindFirst,
        },
        item: { findUnique: mocks.itemFindUnique },
        exchangeRate: { findUnique: mocks.exchangeRateFindUnique },
        crossMarketOpportunity: { upsert: mocks.opportunityUpsert },
      }),
  );
  mocks.searchAddBulk.mockResolvedValue([]);
});

afterEach(() => {
  for (const name of envNames) {
    const value = originalEnv[name];
    if (value == null) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("Xianyu reverse Japan search", () => {
  it("builds exact Japanese/model keywords and schedules enabled Japan sources", async () => {
    const result = await scheduleJapanReverseSearch(
      "product-1",
      "comparison-1",
    );

    const jobs = mocks.searchAddBulk.mock.calls[0]?.[0] as Array<{
      data: Record<string, unknown>;
    }>;
    expect(result).toMatchObject({ scheduled: jobs.length });
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((job) => job.data.adapterKey !== "xianyu")).toBe(true);
    expect(jobs[0]?.data).toMatchObject({
      arbitrageContext: {
        productId: "product-1",
        comparisonId: "comparison-1",
        trigger: "xianyu_reverse_search",
      },
      query: expect.objectContaining({ highPriority: true }),
    });
    expect(mocks.comparisonUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ japanSearchStatus: "scheduled" }),
      }),
    );
  });

  it("does not schedule Japan crawling below the Xianyu value threshold", async () => {
    mocks.comparisonFindUnique.mockResolvedValueOnce({
      ...comparison,
      referencePriceCny: 299,
    });

    const result = await scheduleJapanReverseSearch(
      "product-1",
      "comparison-1",
    );

    expect(result.scheduled).toBe(0);
    expect(mocks.searchAddBulk).not.toHaveBeenCalled();
    expect(mocks.comparisonUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ japanSearchStatus: "skipped" }),
      }),
    );
  });

  it("fails closed when real Japan adapters are disabled", () => {
    expect(
      enabledJapanReverseSearchAdapters({ REAL_ADAPTER_ENABLED: "false" }),
    ).toEqual([]);
    expect(
      japanReverseSearchKeywords({
        ...product,
        listingTitles: product.listings.map(({ titleRaw }) => titleRaw),
        franchiseNames: ["仮面ライダー"],
        seriesNames: ["仮面ライダー"],
        manufacturerNames: ["バンダイ"],
        toyTypeNames: ["指人形"],
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining("KR-FP-10")]));
  });
});

describe("cross-market opportunity persistence", () => {
  it("retains a Japan-low/Xianyu-high reverse-search match as ready", async () => {
    const result = await refreshCrossMarketOpportunityForItem(
      "item-1",
      "comparison-1",
      "xianyu_reverse_search",
      "product-1",
    );

    expect(result).toEqual({
      status: "ready",
      opportunityId: "opportunity-1",
    });
    expect(mocks.opportunityUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "ready",
          trigger: "xianyu_reverse_search",
          netProfitJpy: expect.any(Number),
          missingFacts: [],
        }),
      }),
    );
    expect(mocks.queryRaw).toHaveBeenCalledTimes(4);
    expect(mocks.queryRaw.mock.invocationCallOrder[3]).toBeLessThan(
      mocks.itemFindUnique.mock.invocationCallOrder[0]!,
    );
  });

  it("records Japan-higher as rejected without producing a ready opportunity", async () => {
    mocks.itemFindUnique.mockResolvedValueOnce({
      ...item,
      priceCurrent: 21_000,
    });

    const result = await refreshCrossMarketOpportunityForItem(
      "item-1",
      "comparison-1",
      "xianyu_reverse_search",
      "product-1",
    );

    expect(result).toMatchObject({ status: "rejected" });
    expect(mocks.opportunityUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "rejected",
          rejectionReason: expect.stringContaining("价差不足"),
        }),
      }),
    );
  });

  it("does not bind a search hit that normalized to another Product", async () => {
    mocks.itemFindUnique.mockResolvedValueOnce({
      ...item,
      productId: "different-product",
    });

    const result = await refreshCrossMarketOpportunityForItem(
      "item-1",
      "comparison-1",
      "xianyu_reverse_search",
      "product-1",
    );

    expect(result).toEqual({
      skipped: "cross_market_identity_not_verified",
    });
    expect(mocks.opportunityUpsert).not.toHaveBeenCalled();
  });

  it("does not let a late calculation restore a comparison that is no longer ready", async () => {
    mocks.comparisonFindUnique.mockResolvedValueOnce({
      ...comparison,
      status: "failed",
      lastError: "provider refresh failed",
    });

    const result = await refreshCrossMarketOpportunityForItem(
      "item-1",
      "comparison-1",
      "japan_listing",
      "product-1",
    );

    expect(result).toEqual({ skipped: "cross_market_identity_not_verified" });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(4);
    expect(mocks.opportunityUpsert).not.toHaveBeenCalled();
  });

  it("fails closed when the locked comparison source identity changed", async () => {
    mocks.comparisonFindUnique.mockResolvedValueOnce({
      ...comparison,
      source: { key: "xianyu", comparisonOnly: false },
    });

    const result = await refreshCrossMarketOpportunityForItem(
      "item-1",
      "comparison-1",
      "japan_listing",
      "product-1",
    );

    expect(result).toEqual({ skipped: "cross_market_identity_not_verified" });
    expect(mocks.opportunityUpsert).not.toHaveBeenCalled();
  });

  it("returns the database-enforced status instead of the stale in-memory assessment", async () => {
    mocks.opportunityUpsert.mockResolvedValueOnce({
      id: "opportunity-1",
      status: "needs_facts",
    });

    const result = await refreshCrossMarketOpportunityForItem(
      "item-1",
      "comparison-1",
      "japan_listing",
      "product-1",
    );

    expect(result).toEqual({
      status: "needs_facts",
      opportunityId: "opportunity-1",
    });
  });
});
