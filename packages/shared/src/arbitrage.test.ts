import { describe, expect, it } from "vitest";
import {
  assessCrossMarketOpportunity,
  crossMarketArbitrageEnabled,
  crossMarketArbitrageConfigFromEnv,
  xianyuReverseSearchEnabled,
  type CrossMarketArbitrageConfig,
  type CrossMarketOpportunityCandidate,
} from "./arbitrage.js";

const now = new Date("2026-09-02T00:00:00.000Z");

const config: CrossMarketArbitrageConfig = {
  minimumXianyuReferencePriceCny: 300,
  minimumGrossSpreadCny: 150,
  minimumGrossSpreadRatio: 0.5,
  minimumNetProfitJpy: 5_000,
  minimumNetMarginRatio: 0.3,
  minimumMatchConfidence: 0.85,
  maximumListingAgeMs: 3 * 24 * 60 * 60_000,
  maximumComparisonAgeMs: 3 * 24 * 60 * 60_000,
  maximumExchangeRateAgeMs: 36 * 60 * 60_000,
  platformFeeRate: 0.05,
  internationalShippingJpy: 1_500,
  chinaFulfillmentCny: 20,
  procurement: {
    minQuantity: 5,
    targetQuantity: 10,
    maxUnitCostJpy: 1_000,
    maxVolumeCm3: 10_000,
    maxUnitVolumeCm3: 1_000,
  },
};

function candidate(
  overrides: Partial<CrossMarketOpportunityCandidate> = {},
): CrossMarketOpportunityCandidate {
  return {
    titleRaw: "仮面ライダー 指人形 10体セット",
    listingType: "direct",
    categoryToyType: "finger_puppet",
    conditionGrade: "used",
    priceCurrent: 5_000,
    shippingFee: 500,
    quantityEst: 10,
    logistics: { volumeCm3: 5_000 },
    itemStatus: "active",
    listingMatchDecision: "auto_matched",
    listingMatchConfidence: 0.94,
    listingObservedAt: new Date("2026-09-01T18:00:00.000Z"),
    xianyuReferencePriceCny: 1_000,
    xianyuMatchedCount: 4,
    xianyuMatchConfidence: 0.93,
    xianyuObservedAt: new Date("2026-09-01T12:00:00.000Z"),
    xianyuQuantity: 10,
    jpyToCnyRate: 0.05,
    exchangeRateFetchedAt: new Date("2026-09-01T18:00:00.000Z"),
    evaluatedAt: now,
    ...overrides,
  };
}

describe("cross-market arbitrage assessment", () => {
  it("keeps a compact multi-item Japan listing when the verified net profit is high", () => {
    const result = assessCrossMarketOpportunity(candidate(), config);

    expect(result.status).toBe("ready");
    expect(result.missingFacts).toEqual([]);
    expect(result.netProfitJpy).toBeCloseTo(11_600);
    expect(result.netMarginRatio).toBeCloseTo(0.58);
  });

  it("rejects a Japan listing whose cost lower bound already erases the spread", () => {
    const result = assessCrossMarketOpportunity(
      candidate({ priceCurrent: 21_000 }),
      { ...config, platformFeeRate: undefined },
    );

    expect(result.status).toBe("rejected");
    expect(result.reasons).toContain(
      "日本采购成本下限与闲鱼参考价之间的价差不足。",
    );
  });

  it("does not claim profit when exchange rate or configured costs are missing", () => {
    const result = assessCrossMarketOpportunity(
      candidate({ jpyToCnyRate: null, exchangeRateFetchedAt: null }),
      {
        ...config,
        platformFeeRate: undefined,
        internationalShippingJpy: undefined,
      },
    );

    expect(result.status).toBe("needs_facts");
    expect(result.missingFacts).toEqual(
      expect.arrayContaining([
        "exchange_rate",
        "exchange_rate_freshness",
        "platform_fee",
        "international_shipping",
      ]),
    );
    expect(result.netProfitJpy).toBeNull();
  });

  it("rejects an explicit quantity mismatch across the two markets", () => {
    const result = assessCrossMarketOpportunity(
      candidate({ xianyuQuantity: 6 }),
      config,
    );

    expect(result.status).toBe("rejected");
    expect(result.reasons).toContain("闲鱼报价与日本商品的明确数量不一致。");
  });

  it("keeps auctions and review-required entity matches in needs-facts", () => {
    const auction = assessCrossMarketOpportunity(
      candidate({ listingType: "auction" }),
      config,
    );
    const uncertainMatch = assessCrossMarketOpportunity(
      candidate({ listingMatchDecision: "review_required" }),
      config,
    );

    expect(auction.status).toBe("needs_facts");
    expect(auction.missingFacts).toContain("listing_type");
    expect(uncertainMatch.status).toBe("needs_facts");
    expect(uncertainMatch.missingFacts).toContain("listing_identity");
  });

  it("does not claim profit for a Japan listing whose observation is stale", () => {
    const result = assessCrossMarketOpportunity(
      candidate({ listingObservedAt: new Date("2026-08-28T00:00:00.000Z") }),
      config,
    );

    expect(result.status).toBe("needs_facts");
    expect(result.missingFacts).toContain("listing_freshness");
    expect(result.netProfitJpy).toBeNull();
  });

  it("keeps an undefined zero-cost spread ratio out of ready results", () => {
    const result = assessCrossMarketOpportunity(
      candidate({ priceCurrent: 0, shippingFee: 0 }),
      config,
    );

    expect(result.status).toBe("needs_facts");
    expect(result.missingFacts).toContain("acquisition_cost");
    expect(result.grossSpreadRatio).toBeNull();
  });

  it("does not use unverified AI logistics estimates to claim compactness", () => {
    const result = assessCrossMarketOpportunity(
      candidate({
        logistics: {
          volumeCm3: 500,
          notes: "[AI_ESTIMATE_UNVERIFIED]",
        },
      }),
      config,
    );

    expect(result.status).toBe("needs_facts");
    expect(result.missingFacts).toContain("volume");
    expect(result.netProfitJpy).toBeNull();
  });

  it("requires explicit operator costs instead of inventing profit inputs", () => {
    const resolved = crossMarketArbitrageConfigFromEnv({
      XIANYU_ARBITRAGE_PLATFORM_FEE_RATE: "not-a-rate",
      XIANYU_ARBITRAGE_INTERNATIONAL_SHIPPING_JPY: "",
      XIANYU_ARBITRAGE_CHINA_FULFILLMENT_CNY: "0",
    });

    expect(resolved.platformFeeRate).toBeUndefined();
    expect(resolved.internationalShippingJpy).toBeUndefined();
    expect(resolved.chinaFulfillmentCny).toBe(0);
    expect(resolved.maximumListingAgeMs).toBe(24 * 60 * 60_000);
    expect(resolved.maximumComparisonAgeMs).toBe(24 * 60 * 60_000);
  });

  it("requires exact opt-in values for both arbitrage gates", () => {
    expect(crossMarketArbitrageEnabled({})).toBe(false);
    expect(
      xianyuReverseSearchEnabled({
        XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED: "true",
        XIANYU_REVERSE_SEARCH_ENABLED: "true",
      }),
    ).toBe(true);
    expect(
      xianyuReverseSearchEnabled({
        XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED: "TRUE",
        XIANYU_REVERSE_SEARCH_ENABLED: "true",
      }),
    ).toBe(false);
  });

  it("fails closed on non-finite configuration or financial output", () => {
    const invalidConfig = assessCrossMarketOpportunity(candidate(), {
      ...config,
      maximumListingAgeMs: Number.POSITIVE_INFINITY,
    });
    const overflowing = assessCrossMarketOpportunity(
      candidate({ jpyToCnyRate: Number.MIN_VALUE }),
      config,
    );

    expect(invalidConfig.status).toBe("needs_facts");
    expect(invalidConfig.missingFacts).toContain("configuration");
    expect(overflowing.status).toBe("needs_facts");
    expect(overflowing.missingFacts).toContain("financial_calculation");
    expect(overflowing.netProfitJpy).toBeNull();
  });
});
