import { afterEach, describe, expect, it, vi } from "vitest";
import type { NormalizedItem, SearchResult } from "@tokusatsu/shared";
import { prisma } from "@tokusatsu/db";
import { MockAdapter } from "./adapters/mock.adapter.js";
import {
  AUTOMATIC_CLASSIFICATION_SYSTEM_PROMPT,
  archiveExcludedCollectibles,
  archiveLowQualitySearchInventory,
  automaticClassificationPatch,
  emptySearchIsFailure,
  logisticsColumnsForPersistence,
  needsCompleteEnrichment,
  normalizeProcurementAiReview,
  openCircuitRetryAt,
  pickExactMercariBackfillResult,
  prioritizeSearchResults,
  processCleanup,
  processDislikedCleanup,
  processSearch,
  processClassification,
  procurementFactsForClassification,
  procurementLogisticsFromHints,
  resetItemTranslation,
  sellerMetadata,
  sellerIdForWrite,
  shouldAnalyzeProcurementImages,
  shouldQueueAutomaticClassification,
  sourceBaseUrl,
  startCrawlJobHeartbeat,
  classificationJobId,
  statusJobId,
  verifiedClassificationConfidence,
} from "./processors.js";

describe("crawler source metadata", () => {
  it.each([
    ["mock", "https://example.com/mock"],
    ["mandarake", "https://order.mandarake.co.jp"],
    ["mercari", "https://jp.mercari.com"],
    ["yahoo_auctions", "https://auctions.yahoo.co.jp"],
    ["yahoo_fleamarket", "https://paypayfleamarket.yahoo.co.jp"],
    ["yahoo_shopping", "https://shopping.yahoo.co.jp"],
    ["rakuma", "https://fril.jp"],
    ["surugaya", "https://www.suruga-ya.jp"],
    ["firecrawl_market", "https://api.firecrawl.dev"],
    ["apify_ecommerce", "https://api.apify.com"],
    ["public_page", "https://public.example"],
    ["playwright_page", "https://public.example"],
  ])(
    "does not register %s against the mock source URL",
    (adapterKey, expected) => {
      expect(sourceBaseUrl(adapterKey)).toBe(expected);
    },
  );
});

const originalCrossMarketArbitrageEnabled =
  process.env.XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED;
const originalReverseSearchEnabled = process.env.XIANYU_REVERSE_SEARCH_ENABLED;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  if (originalCrossMarketArbitrageEnabled == null)
    delete process.env.XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED;
  else
    process.env.XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED =
      originalCrossMarketArbitrageEnabled;
  if (originalReverseSearchEnabled == null)
    delete process.env.XIANYU_REVERSE_SEARCH_ENABLED;
  else process.env.XIANYU_REVERSE_SEARCH_ENABLED = originalReverseSearchEnabled;
  vi.restoreAllMocks();
});

function procurementSearchResult(
  sourceItemId: string,
  options: {
    priceCurrent?: number;
    quantity?: number;
    dimensionsCm?: [number, number, number];
  } = {},
): SearchResult {
  const quantity = options.quantity ?? 10;
  const dimensions = options.dimensionsCm ?? [10, 10, 10];
  const sourceUrl = `https://market.example/items/${sourceItemId}`;
  return {
    sourceItemId,
    sourceUrl,
    detailHint: {
      sourcePlatform: "test_market",
      listingType: "direct",
      sourceItemId,
      sourceUrl,
      titleRaw: `仮面ライダー 食玩 ${quantity}個`,
      descriptionRaw: `梱包サイズ ${dimensions.join("×")} cm`,
      priceCurrent: options.priceCurrent ?? 4_000,
      shippingFee: 0,
      conditionRaw: "中古",
      imageUrls: [],
      status: "active",
      channel: "online",
    },
  };
}

describe("procurement search prioritization", () => {
  it.each([
    [undefined, undefined],
    ["true", undefined],
    [undefined, "true"],
    ["TRUE", "true"],
  ])(
    "does not call a provider for queued reverse-search work when gates are %s/%s",
    async (arbitrageEnabled, reverseEnabled) => {
      if (arbitrageEnabled == null)
        delete process.env.XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED;
      else process.env.XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED = arbitrageEnabled;
      if (reverseEnabled == null)
        delete process.env.XIANYU_REVERSE_SEARCH_ENABLED;
      else process.env.XIANYU_REVERSE_SEARCH_ENABLED = reverseEnabled;
      const search = vi.spyOn(MockAdapter.prototype, "search");

      const result = await processSearch({
        data: {
          adapterKey: "mock",
          query: { keyword: "仮面ライダー" },
          arbitrageContext: {
            productId: "product-1",
            comparisonId: "comparison-1",
            trigger: "xianyu_reverse_search",
          },
        },
      } as never);

      expect(result).toEqual({
        skipped: "cross_market_arbitrage_disabled",
        adapter: "mock",
      });
      expect(search).not.toHaveBeenCalled();
    },
  );

  it("treats an empty reverse-arbitrage search as a valid no-match", () => {
    expect(emptySearchIsFailure("incremental")).toBe(true);
    expect(
      emptySearchIsFailure("incremental", {
        productId: "product-1",
        comparisonId: "comparison-1",
        trigger: "xianyu_reverse_search",
      }),
    ).toBe(false);
  });

  it("deduplicates source item ids and retains the row with detail facts", () => {
    const sparse: SearchResult = {
      sourceItemId: "duplicate",
      sourceUrl: "https://market.example/items/duplicate",
      titleHint: "検索結果だけのタイトル",
    };
    const detailed = procurementSearchResult("duplicate");

    const results = prioritizeSearchResults([
      sparse,
      procurementSearchResult("other"),
      detailed,
    ]);

    expect(results).toHaveLength(2);
    expect(results).toContain(detailed);
    expect(results).not.toContain(sparse);
  });

  it("retains a later duplicate when its detail facts are more complete", () => {
    const earlier = procurementSearchResult("richer-duplicate");
    const later: SearchResult = {
      ...earlier,
      detailHint: {
        ...earlier.detailHint!,
        shippingFee: 0,
        descriptionRaw: "未開封10個セット",
        conditionRaw: "未使用",
        imageUrls: ["https://images.example/items/richer-duplicate.jpg"],
        sourceData: { quantityText: "10個" },
        sellerName: "公開ストア",
        sellerProfileUrl: "https://market.example/sellers/store-1",
        listedAt: new Date("2026-08-31T12:00:00.000Z"),
      },
    };
    earlier.detailHint!.shippingFee = undefined;
    earlier.detailHint!.descriptionRaw = undefined;
    earlier.detailHint!.conditionRaw = undefined;

    expect(prioritizeSearchResults([earlier, later])).toEqual([later]);
  });

  it("keeps the first duplicate when completeness is tied", () => {
    const first = procurementSearchResult("stable-duplicate");
    const later: SearchResult = {
      ...first,
      detailHint: {
        ...first.detailHint!,
        titleRaw: "同じ事実数を持つ後続の商品名",
        locationText: "   ",
        sourceData: {},
        sellerData: { aliases: [] },
        listedAt: new Date("invalid"),
      },
    };

    expect(prioritizeSearchResults([first, later])).toEqual([first]);
  });

  it.each([
    [
      "lower price",
      procurementSearchResult("expensive", { priceCurrent: 9_000 }),
      procurementSearchResult("cheap", { priceCurrent: 4_000 }),
    ],
    [
      "larger quantity",
      procurementSearchResult("few", { quantity: 8 }),
      procurementSearchResult("many", { quantity: 16 }),
    ],
    [
      "smaller volume",
      procurementSearchResult("large", { dimensionsCm: [20, 20, 10] }),
      procurementSearchResult("small", { dimensionsCm: [10, 10, 5] }),
    ],
  ])("prioritizes the candidate with %s", (_axis, weaker, stronger) => {
    expect(prioritizeSearchResults([weaker, stronger])[0]).toBe(stronger);
  });
});

describe("procurement AI review inputs", () => {
  it("keeps unknown source facts unknown in the deterministic assessment", () => {
    const facts = procurementFactsForClassification({
      titleRaw: "仮面ライダー DXベルト",
      categoryToyType: "dx_belt",
      conditionGrade: "unknown",
      priceCurrent: 5_000,
      shippingFee: null,
      quantityEst: null,
      logistics: null,
    });

    expect(facts.knownFacts).toMatchObject({
      shippingFeeJpy: null,
      quantityEst: null,
      conditionGrade: "unknown",
      logistics: null,
    });
    expect(facts.deterministicAssessment.compactness).toBe("unknown");
    expect(facts.deterministicAssessment.missingFacts).toEqual(
      expect.arrayContaining([
        "shipping_fee",
        "listing_type",
        "quantity",
        "volume",
        "condition",
      ]),
    );

    const review = normalizeProcurementAiReview(
      {
        scope: "tokusatsu_toy",
        procurementCategory: "preferred",
        compactness: "compact",
        missingFacts: [],
        shouldAnalyze: "true",
        confidence: 0.8,
        quantity: 99,
      },
      facts.deterministicAssessment,
    );
    expect(review.procurementCategory).toBe("needs_facts");
    expect(review.compactness).toBe("unknown");
    expect(review.missingFacts).toEqual(
      expect.arrayContaining([
        "shipping_fee",
        "listing_type",
        "quantity",
        "volume",
        "condition",
      ]),
    );
    expect(review.shouldAnalyze).toBeNull();
    expect(review).not.toHaveProperty("quantity");
  });

  it("does not promote product dimensions to known procurement volume", () => {
    expect(
      procurementLogisticsFromHints({
        volumeCm3: 400,
        lengthMm: 100,
        widthMm: 80,
        heightMm: 50,
        volumeBasis: "product",
        dimensionBasis: "product",
        basis: "product",
      }),
    ).toEqual({});

    const facts = procurementFactsForClassification({
      titleRaw: "仮面ライダー DXベルト 10個",
      categoryToyType: "dx_belt",
      conditionGrade: "used",
      priceCurrent: 5_000,
      shippingFee: 0,
      quantityEst: 10,
      logistics: {
        lengthMm: 100,
        widthMm: 80,
        heightMm: 50,
        volumeCm3: null,
      },
    });

    expect(facts.deterministicAssessment.compactness).toBe("unknown");
    expect(facts.deterministicAssessment.missingFacts).toContain("volume");
  });

  it("keeps package volume separate from product dimensions", () => {
    expect(
      procurementLogisticsFromHints({
        volumeCm3: 800,
        lengthMm: 100,
        widthMm: 80,
        heightMm: 50,
        volumeBasis: "package",
        dimensionBasis: "product",
        basis: "mixed",
      }),
    ).toEqual({ volumeCm3: 800 });
  });

  it("keeps package dimensions separate from product volume", () => {
    expect(
      procurementLogisticsFromHints({
        volumeCm3: 800,
        lengthMm: 100,
        widthMm: 80,
        heightMm: 50,
        volumeBasis: "product",
        dimensionBasis: "package",
        basis: "mixed",
      }),
    ).toEqual({
      lengthMm: 100,
      widthMm: 80,
      heightMm: 50,
    });
  });

  it("keeps both package facts for downstream conflict detection", () => {
    expect(
      procurementLogisticsFromHints({
        volumeCm3: 800,
        lengthMm: 100,
        widthMm: 80,
        heightMm: 50,
        volumeBasis: "package",
        dimensionBasis: "package",
        basis: "package",
      }),
    ).toEqual({
      lengthMm: 100,
      widthMm: 80,
      heightMm: 50,
      volumeCm3: 800,
    });
  });

  it("marks a stored package volume that conflicts with its dimensions for review", () => {
    const facts = procurementFactsForClassification({
      titleRaw: "仮面ライダー 食玩 10個",
      categoryToyType: "shokugan",
      conditionGrade: "used",
      priceCurrent: 5_000,
      shippingFee: 0,
      quantityEst: 10,
      logistics: {
        lengthMm: 1_000,
        widthMm: 1_000,
        heightMm: 1_000,
        volumeCm3: 1_000,
      },
    });

    expect(facts.deterministicAssessment.compactness).toBe("unknown");
    expect(facts.deterministicAssessment.compactnessBasis).toBe("conflict");
    expect(facts.deterministicAssessment.missingFacts).toContain("volume");
  });

  it("does not pass an unverified AI logistics draft to procurement ranking", () => {
    const facts = procurementFactsForClassification({
      titleRaw: "仮面ライダー 食玩 10個",
      listingType: "direct",
      categoryToyType: "shokugan",
      conditionGrade: "used",
      priceCurrent: 5_000,
      shippingFee: 0,
      quantityEst: 10,
      logistics: {
        lengthMm: 100,
        widthMm: 100,
        heightMm: 100,
        volumeCm3: 1_000,
        notes: "[AI_ESTIMATE_UNVERIFIED]",
      },
    });

    expect(facts.knownFacts.logistics).toBeNull();
    expect(facts.deterministicAssessment.missingFacts).toContain("volume");
  });

  it("persists package weight independently from product dimensions", () => {
    expect(
      logisticsColumnsForPersistence({
        weightGrams: 1_200,
        lengthMm: 100,
        widthMm: 80,
        heightMm: 50,
        dimensionBasis: "product",
        weightBasis: "package",
        basis: "mixed",
      }),
    ).toEqual({
      weightGrams: undefined,
      packageWeightGrams: 1_200,
      lengthMm: undefined,
      widthMm: undefined,
      heightMm: undefined,
      volumeCm3: undefined,
    });
  });

  it("passes only explicitly packaged cubic volume to procurement persistence", () => {
    expect(
      logisticsColumnsForPersistence({
        volumeCm3: 800,
        volumeBasis: "package",
        basis: "package",
      }),
    ).toMatchObject({ volumeCm3: 800 });
    expect(
      logisticsColumnsForPersistence({
        volumeCm3: 800,
        volumeBasis: "product",
        basis: "product",
      }),
    ).toMatchObject({ volumeCm3: undefined });
  });

  it("lets AI add image review but never cancel a deterministic review", () => {
    expect(
      shouldAnalyzeProcurementImages(3, { shouldAnalyze: false }, true),
    ).toBe(true);
    expect(
      shouldAnalyzeProcurementImages(3, { shouldAnalyze: true }, false),
    ).toBe(true);
    expect(shouldAnalyzeProcurementImages(3, {}, true)).toBe(true);
    expect(
      shouldAnalyzeProcurementImages(3, { shouldAnalyze: "false" }, true),
    ).toBe(true);
    expect(shouldAnalyzeProcurementImages(3, null, true)).toBe(true);
    expect(
      shouldAnalyzeProcurementImages(0, { shouldAnalyze: true }, true),
    ).toBe(false);
  });
});

describe("automatic product classification", () => {
  const item = {
    titleRaw: "仮面ライダー DXベルト 3個",
    descriptionRaw: "中古品",
    conditionRaw: "中古",
    categoryIp: "unknown" as const,
    categoryToyType: "unknown" as const,
    manufacturer: "unknown" as const,
    conditionGrade: "unknown" as const,
    quantityEst: null,
    listingType: "direct" as const,
    priceCurrent: 12_000,
    shippingFee: 0,
  };

  it("offers every supported franchise category to the production AI classifier", () => {
    for (const category of [
      "kamen_rider",
      "ultraman",
      "super_sentai",
      "godzilla",
      "other",
      "unknown",
    ]) {
      expect(AUTOMATIC_CLASSIFICATION_SYSTEM_PROMPT).toContain(category);
    }
  });

  it("applies only high-confidence valid enum and exact quantity values", () => {
    expect(
      automaticClassificationPatch(item, {
        categoryIp: {
          value: "kamen_rider",
          confidence: 0.96,
          evidence: ["仮面ライダー"],
        },
        categoryToyType: {
          value: "dx_belt",
          confidence: 0.95,
          evidence: ["DXベルト"],
        },
        manufacturer: {
          value: "invented_brand",
          confidence: 1,
          evidence: ["DXベルト"],
        },
        conditionGrade: {
          value: "used",
          confidence: 0.89,
          evidence: ["中古"],
        },
        quantity: { value: 3, confidence: 0.98, evidence: ["3個"] },
      }),
    ).toEqual({
      data: {
        categoryIp: "kamen_rider",
        categoryToyType: "dx_belt",
        quantityEst: 3,
        unitCostEst: 4_000,
      },
      fieldConfidences: {
        categoryIp: 0.96,
        categoryToyType: 0.95,
        quantityEst: 0.98,
      },
      conflicts: [],
    });
  });

  it("preserves known fields and reports conflicting AI suggestions", () => {
    expect(
      automaticClassificationPatch(
        {
          ...item,
          titleRaw: "仮面ライダー DXベルト 4個",
          descriptionRaw: "バンプレスト製",
          categoryIp: "ultraman",
          manufacturer: "bandai",
          quantityEst: 2,
        },
        {
          categoryIp: {
            value: "kamen_rider",
            confidence: 0.99,
            evidence: ["仮面ライダー"],
          },
          manufacturer: {
            value: "banpresto",
            confidence: 0.99,
            evidence: ["バンプレスト"],
          },
          quantity: { value: 4, confidence: 0.99, evidence: ["4個"] },
        },
      ),
    ).toEqual({
      data: {},
      fieldConfidences: {},
      conflicts: ["categoryIp", "manufacturer", "quantityEst"],
    });
  });

  it("ignores high-confidence facts that have no verifiable source evidence", () => {
    expect(
      automaticClassificationPatch(item, {
        categoryIp: { value: "ultraman", confidence: 1, evidence: [] },
        categoryToyType: {
          value: "gashapon",
          confidence: 1,
          evidence: ["原文に存在しないガシャポン"],
        },
        conditionGrade: { value: "used", confidence: 1 },
        quantity: { value: 99, confidence: 1, evidence: ["99個"] },
      }),
    ).toEqual({ data: {}, fieldConfidences: {}, conflicts: [] });
  });

  it("rejects a located evidence snippet that does not support the enum", () => {
    expect(
      automaticClassificationPatch(item, {
        categoryToyType: {
          value: "gashapon",
          confidence: 1,
          evidence: ["仮面ライダー"],
        },
      }),
    ).toEqual({ data: {}, fieldConfidences: {}, conflicts: [] });
  });

  it("does not persist a normal unit cost for an active auction", () => {
    expect(
      automaticClassificationPatch(
        { ...item, listingType: "auction" },
        { quantity: { value: 3, confidence: 0.98, evidence: ["3個"] } },
      ),
    ).toEqual({
      data: { quantityEst: 3 },
      fieldConfidences: { quantityEst: 0.98 },
      conflicts: [],
    });
  });

  it("does not raise item confidence when AI produced no verified patch", () => {
    expect(verifiedClassificationConfidence(0.62, 1, {})).toBe(0.62);
    expect(
      verifiedClassificationConfidence(0.62, 0.97, {
        categoryIp: 0.95,
        quantityEst: 0.91,
      }),
    ).toBe(0.91);
  });
});

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
        listingType: "direct",
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

  it("closes a running CrawlJob whose heartbeat has been stale for thirty minutes", async () => {
    const now = new Date("2026-09-06T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const updateMany = vi
      .spyOn(prisma.crawlJob, "updateMany")
      .mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.item, "findMany").mockResolvedValue([] as never);
    vi.spyOn(prisma.product, "deleteMany").mockResolvedValue({ count: 0 });

    await expect(processCleanup()).resolves.toMatchObject({
      staleRunsClosed: 1,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        status: "running",
        updatedAt: {
          lt: new Date(now.getTime() - 30 * 60_000),
        },
      },
      data: {
        status: "failed",
        errorText: "worker heartbeat expired; run was closed by maintenance",
        finishedAt: now,
      },
    });
  });

  it("archives terminal inventory but retains images needed by purchases, favorites and chat", async () => {
    const now = new Date("2026-09-09T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.spyOn(prisma.crawlJob, "updateMany").mockResolvedValue({ count: 0 });
    vi.spyOn(prisma.item, "findMany")
      .mockResolvedValueOnce([{ id: "sold-item" }] as never)
      .mockResolvedValue([] as never);
    vi.spyOn(prisma.item, "findUnique").mockResolvedValue({
      id: "sold-item",
      archivedAt: null,
      status: "sold",
    } as never);
    vi.spyOn(prisma.item, "updateMany").mockResolvedValue({ count: 1 });
    const audit = vi
      .spyOn(prisma.manualReview, "create")
      .mockResolvedValue({ id: "audit-1" } as never);
    const deleteImages = vi
      .spyOn(prisma.itemImage, "deleteMany")
      .mockResolvedValue({ count: 0 });
    vi.spyOn(prisma.product, "deleteMany").mockResolvedValue({ count: 0 });
    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (action: unknown) =>
        typeof action === "function"
          ? action(prisma)
          : Promise.all(action as Promise<unknown>[]),
    );

    await expect(processCleanup()).resolves.toMatchObject({ archived: 1 });
    expect(audit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        itemId: "sold-item",
        beforeData: { archivedAt: null },
        afterData: { archivedAt: now.toISOString() },
      }),
    });
    expect(deleteImages).toHaveBeenCalledWith({
      where: {
        itemId: { in: ["sold-item"] },
        item: {
          purchaseRecord: null,
          favorite: false,
          collaborationMessages: { none: {} },
        },
      },
    });
  });

  it("keeps a long-running crawl fresh until the run finishes", async () => {
    const startedAt = new Date("2026-09-06T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const stop = startCrawlJobHeartbeat("crawl-long", {
      intervalMs: 60_000,
      store: { updateMany },
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "crawl-long", status: "running" },
      data: { updatedAt: new Date("2026-09-06T00:01:00.000Z") },
    });

    await stop();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("does not archive, announce or prune a terminal listing when a purchase wins the race", async () => {
    vi.spyOn(prisma.crawlJob, "updateMany").mockResolvedValue({ count: 0 });
    const findMany = vi
      .spyOn(prisma.item, "findMany")
      .mockResolvedValueOnce([{ id: "raced-purchase" }] as never)
      .mockResolvedValue([] as never);
    vi.spyOn(prisma.item, "findUnique").mockResolvedValue({
      id: "raced-purchase",
      status: "sold",
      archivedAt: null,
    } as never);
    const update = vi
      .spyOn(prisma.item, "updateMany")
      .mockResolvedValue({ count: 0 });
    const audit = vi.spyOn(prisma.manualReview, "create");
    const deleteImages = vi.spyOn(prisma.itemImage, "deleteMany");
    vi.spyOn(prisma.product, "deleteMany").mockResolvedValue({ count: 0 });
    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (action: unknown) =>
        typeof action === "function"
          ? action(prisma)
          : Promise.all(action as Promise<unknown>[]),
    );
    await expect(processCleanup()).resolves.toMatchObject({ archived: 0 });
    expect(findMany.mock.calls[0]![0]!.where).toMatchObject({
      purchaseRecord: null,
    });
    expect(update.mock.calls[0]![0]!.where).toMatchObject({
      purchaseRecord: null,
    });
    expect(audit).not.toHaveBeenCalled();
    expect(deleteImages).not.toHaveBeenCalled();
  });
});

describe("excluded collectible maintenance", () => {
  it("archives an excluded listing with an audit instead of deleting it", async () => {
    const now = new Date("2026-09-06T00:00:00.000Z");
    const excluded = {
      id: "book-1",
      titleRaw: "仮面ライダーSPIRITS 単行本",
      descriptionRaw: "全巻セット",
      categoryToyType: "unknown",
      favorite: true,
      ignored: false,
      ignoredAt: null,
      archivedAt: null,
    };
    const findMany = vi
      .spyOn(prisma.item, "findMany")
      .mockResolvedValueOnce([excluded] as never)
      .mockResolvedValueOnce([]);
    const updateMany = vi
      .spyOn(prisma.item, "updateMany")
      .mockResolvedValue({ count: 1 });
    const deleteMany = vi.spyOn(prisma.item, "deleteMany");
    const createAudit = vi
      .spyOn(prisma.manualReview, "create")
      .mockResolvedValue({ id: "audit-1" } as never);
    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: unknown) =>
        (callback as (tx: typeof prisma) => Promise<number>)(prisma),
    );

    await expect(archiveExcludedCollectibles(now)).resolves.toBe(1);

    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          archivedAt: null,
          purchaseRecord: null,
        }),
      }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "book-1", archivedAt: null, deletedAt: null, purchaseRecord: null },
      data: { archivedAt: now },
    });
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        itemId: "book-1",
        actor: "inventory-maintenance",
        reason: "excluded_collectible_archived",
        beforeData: expect.objectContaining({ archivedAt: null }),
        afterData: expect.objectContaining({
          archivedAt: now.toISOString(),
        }),
      }),
    });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("does not archive a purchased excluded listing that wins the write race", async () => {
    vi.spyOn(prisma.item, "findMany")
      .mockResolvedValueOnce([
        {
          id: "card-1",
          titleRaw: "仮面ライダー トレカ 30枚",
          descriptionRaw: null,
          categoryToyType: "card",
          favorite: false,
          ignored: false,
          ignoredAt: null,
          archivedAt: null,
        },
      ] as never)
      .mockResolvedValueOnce([]);
    vi.spyOn(prisma.item, "updateMany").mockResolvedValue({ count: 0 });
    const createAudit = vi.spyOn(prisma.manualReview, "create");
    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: unknown) =>
        (callback as (tx: typeof prisma) => Promise<number>)(prisma),
    );

    await expect(archiveExcludedCollectibles()).resolves.toBe(0);
    expect(createAudit).not.toHaveBeenCalled();
  });
});

describe("search inventory quality maintenance", () => {
  it("excludes every protected workflow from historical quality cleanup", async () => {
    const findMany = vi
      .spyOn(prisma.item, "findMany")
      .mockResolvedValue([] as never);

    await expect(archiveLowQualitySearchInventory()).resolves.toBe(0);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          importOrigin: "search",
          ignored: false,
          favorite: false,
          purchaseRecord: null,
          cartItems: { none: {} },
          negotiationCase: { is: null },
        }),
      }),
    );
  });

  it("archives a keyword-only search result while preserving the item audit", async () => {
    const now = new Date("2026-09-09T00:00:00.000Z");
    vi.spyOn(prisma.item, "findMany")
      .mockResolvedValueOnce([
        {
          id: "weak-1",
          titleRaw: "仮面ライダー 関連グッズ",
          descriptionRaw: "整理のため出品します",
          sourceUrl: "https://example.test/item/weak-1",
          priceCurrent: 2_000,
          shippingFee: null,
          categoryIp: "kamen_rider",
          categoryToyType: "unknown",
          manufacturer: "unknown",
          conditionGrade: "unknown",
          quantityEst: null,
          imageCount: 1,
          status: "active",
          channel: "online",
          collectibleSeries: null,
          collaborationMessages: [],
        },
      ] as never)
      .mockResolvedValueOnce([]);
    const updateMany = vi
      .spyOn(prisma.item, "updateMany")
      .mockResolvedValue({ count: 1 });
    const createAudit = vi
      .spyOn(prisma.manualReview, "create")
      .mockResolvedValue({ id: "quality-audit" } as never);
    const deleteImages = vi
      .spyOn(prisma.itemImage, "deleteMany")
      .mockResolvedValue({ count: 1 });
    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: unknown) =>
        (callback as (tx: typeof prisma) => Promise<number>)(prisma),
    );

    await expect(archiveLowQualitySearchInventory(now)).resolves.toBe(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "weak-1",
          favorite: false,
          purchaseRecord: null,
        }),
        data: { archivedAt: now },
      }),
    );
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        itemId: "weak-1",
        actor: "inventory-quality-maintenance",
        reason: "weak_product_identity",
      }),
    });
    expect(deleteImages).toHaveBeenCalledWith({
      where: { itemId: "weak-1" },
    });
  });

  it("keeps the thumbnail when an archived weak listing is referenced in chat", async () => {
    const now = new Date("2026-09-09T00:00:00.000Z");
    vi.spyOn(prisma.item, "findMany")
      .mockResolvedValueOnce([
        {
          id: "shared-weak-1",
          titleRaw: "仮面ライダー 関連グッズ",
          descriptionRaw: "整理のため出品します",
          sourceUrl: "https://example.test/item/shared-weak-1",
          priceCurrent: 2_000,
          shippingFee: null,
          categoryIp: "kamen_rider",
          categoryToyType: "unknown",
          manufacturer: "unknown",
          conditionGrade: "unknown",
          quantityEst: null,
          imageCount: 1,
          status: "active",
          channel: "online",
          collectibleSeries: null,
          collaborationMessages: [{ id: "message-1" }],
        },
      ] as never)
      .mockResolvedValueOnce([]);
    vi.spyOn(prisma.item, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.manualReview, "create").mockResolvedValue({
      id: "quality-audit",
    } as never);
    const deleteImages = vi.spyOn(prisma.itemImage, "deleteMany");
    vi.spyOn(prisma, "$transaction").mockImplementation(
      async (callback: unknown) =>
        (callback as (tx: typeof prisma) => Promise<number>)(prisma),
    );

    await expect(archiveLowQualitySearchInventory(now)).resolves.toBe(1);
    expect(deleteImages).not.toHaveBeenCalled();
  });
});

describe("not-interested retention", () => {
  it("moves a failed negotiation into not-interested after 24 hours", async () => {
    const now = new Date("2026-09-06T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.spyOn(prisma.negotiationCase, "findMany").mockResolvedValue([
      { itemId: "failed-item" },
    ] as never);
    vi.spyOn(prisma.item, "findMany").mockResolvedValue([]);
    const updateMany = vi
      .spyOn(prisma.item, "updateMany")
      .mockResolvedValue({ count: 1 });
    const updateNegotiations = vi
      .spyOn(prisma.negotiationCase, "updateMany")
      .mockResolvedValue({ count: 1 });
    vi.spyOn(prisma, "$transaction").mockResolvedValue([
      { count: 1 },
      { count: 1 },
    ] as never);

    await expect(processDislikedCleanup()).resolves.toMatchObject({
      failedNegotiationsMoved: 1,
      archived: 0,
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          favorite: false,
          ignored: true,
          ignoredAt: now,
          ignoredReason: "negotiation_failed",
        },
      }),
    );
    expect(updateNegotiations).toHaveBeenCalledWith({
      where: {
        itemId: { in: ["failed-item"] },
        status: "failed",
        statusChangedAt: { lt: new Date("2026-09-05T00:00:00.000Z") },
      },
      data: { status: "moved_to_disliked", statusChangedAt: now },
    });
  });

  it("archives stale disliked listings without deleting their discovery history owner", async () => {
    const now = new Date("2026-09-06T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const stale = {
      id: "disliked-1",
      ignored: true,
      ignoredAt: new Date("2026-09-04T23:59:59.000Z"),
      archivedAt: null,
    };
    vi.spyOn(prisma.negotiationCase, "findMany").mockResolvedValue([]);
    const findMany = vi
      .spyOn(prisma.item, "findMany")
      .mockResolvedValueOnce([stale] as never)
      .mockResolvedValueOnce([]);
    const updateMany = vi
      .spyOn(prisma.item, "updateMany")
      .mockResolvedValue({ count: 1 });
    const deleteMany = vi
      .spyOn(prisma.item, "deleteMany")
      .mockResolvedValue({ count: 1 });

    await expect(processDislikedCleanup()).resolves.toMatchObject({
      removed: 1,
      archived: 1,
      cleanedAt: now.toISOString(),
    });

    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          ignored: true,
          ignoredAt: { lt: new Date("2026-09-05T00:00:00.000Z") },
          archivedAt: null,
          purchaseRecord: null,
        }),
      }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["disliked-1"] },
        ignored: true,
        ignoredAt: { lt: new Date("2026-09-05T00:00:00.000Z") },
        archivedAt: null,
        purchaseRecord: null,
      },
      data: { archivedAt: now },
    });
    expect(deleteMany).not.toHaveBeenCalled();
  });
});

describe("automatic AI classification scheduling", () => {
  const classifiedListing = {
    needsReview: false,
    categoryIp: "kamen_rider",
    categoryToyType: "dx_belt",
    manufacturer: "bandai",
    conditionGrade: "used",
    quantityEst: 1,
    priceCurrent: 8_000,
    titleRaw: "仮面ライダー DX変身ベルト",
  } as const;

  it("does not load an item or call AI when background automation is disabled", async () => {
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    vi.stubEnv("BACKGROUND_AI_FREE_AUTOMATION_ENABLED", "false");
    const findUnique = vi
      .spyOn(prisma.item, "findUnique")
      .mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      processClassification({
        data: { itemId: "item-disabled", version: "v1" },
      } as never),
    ).resolves.toEqual({ skipped: "background_automation_not_authorized" });
    expect(findUnique).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the classification gate when only free automation is enabled", async () => {
    vi.stubEnv("BACKGROUND_AI_FREE_AUTOMATION_ENABLED", "true");
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    const findUnique = vi
      .spyOn(prisma.item, "findUnique")
      .mockResolvedValue(null);

    await expect(
      processClassification({
        data: { itemId: "item-free-only", version: "v1" },
      } as never),
    ).resolves.toEqual({ skipped: "missing_item" });
    expect(findUnique).toHaveBeenCalledOnce();
  });

  it("uses the same item/version key everywhere but permits a changed listing version", () => {
    const first = new Date("2026-09-05T00:00:00.000Z");
    const changed = new Date("2026-09-05T00:00:01.000Z");
    expect(classificationJobId("item-1", first)).toBe(
      classificationJobId("item-1", first),
    );
    expect(classificationJobId("item-1", changed)).not.toBe(
      classificationJobId("item-1", first),
    );
  });

  it("lets a purchase import past the classification gate despite its staging archive", async () => {
    const findUnique = vi.spyOn(prisma.item, "findUnique").mockResolvedValue({
      id: "purchase-item",
      titleRaw: "仮面ライダー DX変身ベルト",
      descriptionRaw: "中古品です",
      conditionRaw: "目立った傷なし",
      categoryIp: "kamen_rider",
      categoryToyType: "dx_belt",
      manufacturer: "bandai",
      conditionGrade: "used",
      quantityEst: 1,
      priceCurrent: 8_000,
      needsReview: false,
      confidence: 0.9,
      status: "active",
      archivedAt: new Date("2026-09-05T00:00:00.000Z"),
      ignored: false,
      purchaseRecord: null,
      importOrigin: "purchase",
      images: [{ url: "https://example.com/belt.jpg" }],
      logistics: null,
      monitoringCategory: { scope: "tokusatsu" },
      classifications: [],
    } as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // Fully classified by the rules, so the job stops at the deterministic
    // check. Reaching that check at all is what proves the purchase and
    // staging-archive exclusions no longer skip it up front, and no AI
    // call is spent getting there.
    await expect(
      processClassification({
        data: { itemId: "purchase-item" },
      } as never),
    ).resolves.toEqual({ skipped: "deterministic_evidence_sufficient" });
    expect(findUnique).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("spends AI only on listings whose deterministic evidence needs enrichment", () => {
    expect(shouldQueueAutomaticClassification(classifiedListing)).toBe(false);
    expect(
      shouldQueueAutomaticClassification({
        ...classifiedListing,
        categoryToyType: "unknown",
      }),
    ).toBe(true);
    expect(
      shouldQueueAutomaticClassification({
        ...classifiedListing,
        needsReview: true,
      }),
    ).toBe(true);
    expect(
      shouldQueueAutomaticClassification({
        ...classifiedListing,
        priceCurrent: 25_000,
      }),
    ).toBe(true);
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

  it("uses Mercari's public seller ID for stable historical grouping", () => {
    expect(
      sellerMetadata({
        sourcePlatform: "mercari",
        sellerData: { sellerId: "123" },
      } as unknown as NormalizedItem).sourceSellerId,
    ).toBe("123");
  });
});
