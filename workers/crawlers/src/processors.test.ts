import { describe, expect, it } from "vitest";
import type { SearchResult } from "@tokusatsu/shared";
import {
  needsCompleteEnrichment,
  pickExactMercariBackfillResult,
  resetItemTranslation,
  statusJobId,
} from "./processors.js";

describe("historical seller enrichment", () => {
  it("re-crawls Yahoo listings assigned to a provisional seller", () => {
    expect(
      needsCompleteEnrichment(
        {
          sourceData: { provisional: true },
          descriptionRaw: "完整商品说明",
          sellerId: "seller-provisional",
          seller: {
            name: "Yahoo!出品者 abc123（公开资料回补中）",
            sourceData: { provisional: true },
          },
        },
        "yahoo_auctions",
      ),
    ).toBe(true);
  });

  it("does not force a fresh detail crawl for a fully enriched seller", () => {
    expect(
      needsCompleteEnrichment(
        {
          sourceData: { aucUserId: "public-user" },
          descriptionRaw: "完整商品说明",
          sellerId: "seller-real",
          seller: {
            name: "公开卖家",
            sourceData: { aucUserId: "public-user" },
          },
        },
        "yahoo_auctions",
      ),
    ).toBe(false);
  });

  it("re-crawls historical Mercari listings with the generic seller", () => {
    expect(
      needsCompleteEnrichment(
        {
          sourceData: { shippingStatus: "free" },
          descriptionRaw: "商品説明",
          sellerId: "seller-generic",
          seller: { name: "Mercari 卖家", sourceData: {} },
        },
        "mercari",
      ),
    ).toBe(true);
  });

  it("also re-crawls ID-suffixed Mercari placeholders", () => {
    expect(
      needsCompleteEnrichment(
        {
          sourceData: { shippingStatus: "free" },
          descriptionRaw: "商品説明",
          sellerId: "seller-generic",
          seller: { name: "Mercari 卖家 477041432", sourceData: {} },
        },
        "mercari",
      ),
    ).toBe(true);
  });
});

describe("item translation invalidation", () => {
  it("clears the complete translation when a detail crawl changes public data", () => {
    expect(resetItemTranslation()).toMatchObject({
      titleZh: null,
      descriptionZh: null,
      conditionZh: null,
      shippingZh: null,
      translationStatus: "pending",
      translatedAt: null,
    });
  });
});

describe("Mercari historical seller recovery", () => {
  it("uses only the exact public search result for the historical listing", () => {
    const exact: SearchResult = {
      sourceItemId: "m123",
      sourceUrl: "https://jp.mercari.com/item/m123",
      detailHint: {
        sourcePlatform: "mercari",
        sourceItemId: "m123",
        sourceUrl: "https://jp.mercari.com/item/m123",
        titleRaw: "商品",
        sellerName: "Mercari 卖家 456",
        priceCurrent: 1_000,
        imageUrls: [],
        status: "active",
        channel: "online",
      },
    };
    expect(
      pickExactMercariBackfillResult("m123", [
        {
          sourceItemId: "m999",
          sourceUrl: "https://jp.mercari.com/item/m999",
        },
        exact,
      ]),
    ).toBe(exact);
    expect(pickExactMercariBackfillResult("m404", [exact])).toBeUndefined();
  });
});

describe("status refresh scheduling", () => {
  it("uses one stable job id per item so repeated scheduling cannot queue duplicates", () => {
    expect(statusJobId("item-123")).toBe("status-item-123");
    expect(statusJobId("item-123")).toBe(statusJobId("item-123"));
  });
});
