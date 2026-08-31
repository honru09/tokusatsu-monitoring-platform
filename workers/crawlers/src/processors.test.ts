import { describe, expect, it } from "vitest";
import type { NormalizedItem, SearchResult } from "@tokusatsu/shared";
import {
  needsCompleteEnrichment,
  openCircuitRetryAt,
  pickExactMercariBackfillResult,
  resetItemTranslation,
  sellerMetadata,
  sellerIdForWrite,
  statusJobId,
} from "./processors.js";

describe("source circuit breaker", () => {
  it("treats an open circuit as a scheduled skip until its retry time", () => {
    const openedAt = new Date("2026-08-31T04:00:00.000Z");
    expect(
      openCircuitRetryAt(openedAt, Date.parse("2026-08-31T04:10:00.000Z")),
    )?.toEqual(new Date("2026-08-31T04:15:00.000Z"));
    expect(
      openCircuitRetryAt(openedAt, Date.parse("2026-08-31T04:15:00.000Z")),
    ).toBeNull();
  });
});

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

  it.each(["Yahoo!フリマ", "Yahoo!フリマ出品者", "Yahoo!フリマ出品者 p188926"])(
    "re-crawls Yahoo! Fleamarket rows using the legacy placeholder %s",
    (name) => {
      expect(
        needsCompleteEnrichment(
          {
            sourceData: { sellerId: "p188926" },
            descriptionRaw: "商品説明",
            sellerId: "seller-placeholder",
            seller: { name, sourceData: { sellerId: "p188926" } },
          },
          "yahoo_fleamarket",
        ),
      ).toBe(true);
    },
  );

  it("keeps a real Yahoo! Fleamarket nickname associated with its public profile", () => {
    expect(
      needsCompleteEnrichment(
        {
          sourceData: { sellerId: "p188926" },
          descriptionRaw: "商品説明",
          sellerId: "seller-real",
          seller: {
            name: "ハッピー1に伴い今日より全再出品",
            profileUrl: "https://paypayfleamarket.yahoo.co.jp/user/p188926",
            sourceData: { sellerId: "p188926" },
          },
        },
        "yahoo_fleamarket",
      ),
    ).toBe(false);
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

describe("seller association writes", () => {
  it("leaves an existing seller relation untouched when a detail response has no public seller", () => {
    expect(sellerIdForWrite(undefined)).toBeUndefined();
    expect(sellerIdForWrite(null)).toBeUndefined();
    expect(sellerIdForWrite({ id: "seller-real" })).toBe("seller-real");
  });

  it("uses the public seller ID instead of a non-unique nickname", () => {
    const item = (sellerId: string) =>
      ({
        sourcePlatform: "yahoo_fleamarket",
        sellerName: "同名出品者",
        sellerProfileUrl: `https://paypayfleamarket.yahoo.co.jp/user/${sellerId}`,
        sellerData: { sellerId, nickname: "同名出品者" },
      }) as unknown as NormalizedItem;

    expect(sellerMetadata(item("p100")).sourceSellerId).toBe("p100");
    expect(sellerMetadata(item("p200")).sourceSellerId).toBe("p200");
  });

  it("uses the Yahoo Auctions public user ID instead of the display name", () => {
    const item = {
      sourcePlatform: "yahoo_auctions",
      sellerName: "pha********",
      sellerProfileUrl: "https://auctions.yahoo.co.jp/seller/public-id",
      sellerData: {
        aucUserId: "public-id",
        displayName: "pha********",
      },
    } as unknown as NormalizedItem;

    expect(sellerMetadata(item).sourceSellerId).toBe("public-id");
  });

  it("does not change seller grouping semantics for platforms without an identity migration", () => {
    expect(
      sellerMetadata({
        sourcePlatform: "mercari",
        sellerData: { sellerId: "123" },
      } as unknown as NormalizedItem).sourceSellerId,
    ).toBeUndefined();
  });
});
