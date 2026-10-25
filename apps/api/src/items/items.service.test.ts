import "reflect-metadata";
import { Prisma } from "@tokusatsu/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validate } from "class-validator";
import {
  CreatePurchaseBundleDto,
  ListItemsQuery,
  UpdateItemDto,
} from "./items.dto.js";
import {
  ItemsService,
  normalizePurchaseMembers,
  resolveAdapterKey,
} from "./items.service.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveAdapterKey", () => {
  const firecrawlHosts = new Set(["item.fril.jp"]);

  it.each([
    "https://auctions.yahoo.co.jp/jp/auction/g1241924961",
    "https://page.auctions.yahoo.co.jp/jp/auction/g1241924961",
  ])("accepts current and legacy Yahoo Auctions product URLs: %s", (value) => {
    expect(resolveAdapterKey(new URL(value), firecrawlHosts, false)).toBe(
      "yahoo_auctions",
    );
  });

  it("does not treat a Yahoo search page as a product detail", () => {
    expect(
      resolveAdapterKey(
        new URL("https://auctions.yahoo.co.jp/search/search?p=DX"),
        firecrawlHosts,
        false,
      ),
    ).toBeUndefined();
  });

  it.each([
    [
      "https://paypayfleamarket.yahoo.co.jp/item/z671469566",
      "yahoo_fleamarket",
    ],
    ["https://item.fril.jp/fb35ad389e21cc34ce20553c2112d713", "rakuma"],
    ["https://www.suruga-ya.jp/product/detail/607224616", "surugaya"],
  ])("routes supported public marketplace product URLs: %s", (value, key) => {
    expect(resolveAdapterKey(new URL(value), firecrawlHosts, false)).toBe(key);
  });

  it.each([
    "https://paypayfleamarket.yahoo.co.jp/search/DX",
    "https://fril.jp/s?query=DX",
    "https://www.suruga-ya.jp/search?search_word=DX",
  ])(
    "does not accept a marketplace search page as one product: %s",
    (value) => {
      expect(
        resolveAdapterKey(new URL(value), firecrawlHosts, false),
      ).toBeUndefined();
    },
  );

  it("uses Firecrawl only for configured hosts when a key is present", () => {
    const url = new URL("https://item.fril.jp/example-item");
    expect(resolveAdapterKey(url, firecrawlHosts, false)).toBeUndefined();
    expect(resolveAdapterKey(url, firecrawlHosts, true)).toBe(
      "firecrawl_market",
    );
  });

  it("falls back to the safe public-page adapter for other HTTPS product pages", () => {
    expect(
      resolveAdapterKey(
        new URL("https://shop.example.jp/item/123"),
        firecrawlHosts,
        false,
      ),
    ).toBe("public_page");
  });
});

describe("ItemsService.list", () => {
  it("rechecks active inventory while hydrating a page sorted by Xianyu reference price", async () => {
    vi.stubEnv("CHINA_MARKET_COMPARISON_ENABLED", "true");
    vi.stubEnv("CHINA_MARKET_COMPARISON_AUTHORIZED", "true");
    vi.stubEnv("XIANYU_COMPARISON_ENABLED", "true");
    const prisma = {
      item: {
        findMany: vi.fn().mockResolvedValueOnce([{
          id: "recently-sold", priceCurrent: 1_000, detectedAt: new Date(),
          product: { marketComparisons: [{ referencePriceCny: 100 }] },
        }]).mockResolvedValueOnce([]),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
    };
    await new ItemsService(prisma as never).list({ sortBy: "xianyuPrice", limit: 40, offset: 0 } as ListItemsQuery);
    const rankedWhere = prisma.item.findMany.mock.calls[0][0].where;
    const pageWhere = prisma.item.findMany.mock.calls[1][0].where;
    expect(pageWhere).toMatchObject({
      ...rankedWhere, id: { in: ["recently-sold"] },
      status: { in: ["active", "unknown"] }, archivedAt: null, purchaseRecord: null,
    });
  });

  it("filters one monitoring category without bypassing market availability or transaction facets", async () => {
    const prisma = {
      monitoringCategory: { findMany: vi.fn().mockResolvedValue([]) },
      item: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      $transaction: vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
    };
    await new ItemsService(prisma as never).list({
      monitoringCategoryId: "monitoring-category-shf",
      limit: 40,
      offset: 0,
    } as ListItemsQuery);
    const where = prisma.item.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      monitoringCategoryId: { in: ["monitoring-category-shf"] },
      archivedAt: null,
      status: { in: ["active", "unknown"] },
      ignored: false,
      purchaseRecord: null,
    });
    expect(where.AND).toEqual(expect.arrayContaining([
      expect.objectContaining({ OR: expect.arrayContaining([{ auctionEndAt: null }]) }),
    ]));
    for (const [{ where: countedWhere }] of prisma.item.count.mock.calls)
      expect(countedWhere).toMatchObject({ monitoringCategoryId: { in: ["monitoring-category-shf"] }, AND: where.AND });
  });

  it("includes descendant categories while keeping page and market facets in the same scope", async () => {
    const prisma = {
      monitoringCategory: { findMany: vi.fn().mockResolvedValue([
        { id: "toys", parentId: null },
        { id: "rider", parentId: "toys" },
        { id: "rider-shf", parentId: "rider" },
        { id: "ultraman", parentId: "toys" },
        { id: "unrelated", parentId: null },
      ]) },
      item: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      $transaction: vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
    };
    await new ItemsService(prisma as never).list({ monitoringCategoryId: "toys", limit: 40, offset: 0 } as ListItemsQuery);
    const categoryIds = prisma.item.findMany.mock.calls[0][0].where.monitoringCategoryId.in;
    expect(new Set(categoryIds)).toEqual(new Set(["toys", "rider", "rider-shf", "ultraman"]));
    for (const [{ where }] of prisma.item.count.mock.calls)
      expect(where.monitoringCategoryId).toEqual({ in: categoryIds });
  });

  it("filters SHF across supported franchises and keeps its structured attributes", async () => {
    const prisma = {
      item: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn(async (queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };
    const service = new ItemsService(prisma as never);

    await service.list({
      collection: "shf",
      shfLine: "shinkocchou",
      shfReleaseChannel: "tamashii_web",
      shfEdition: "reissue",
      shfRegion: "japanese",
      limit: 40,
      offset: 0,
    } as ListItemsQuery);

    expect(prisma.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          collectibleSeries: "shf",
          shfLine: "shinkocchou",
          shfReleaseChannel: "tamashii_web",
          shfEdition: "reissue",
          shfRegion: "japanese",
        }),
      }),
    );
  });

  it("filters the independent S.I.C. collection", async () => {
    const prisma = {
      item: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn(async (queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };
    const service = new ItemsService(prisma as never);

    await service.list({
      collection: "sic",
      limit: 40,
      offset: 0,
    } as ListItemsQuery);

    expect(prisma.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ collectibleSeries: "sic" }),
      }),
    );
  });

  it("searches persisted complete Chinese translations without dropping raw or seller matches", async () => {
    const prisma = {
      item: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn(async (queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };
    const service = new ItemsService(prisma as never);

    await service.list({
      search: "腰带缺件",
      limit: 40,
      offset: 0,
    } as ListItemsQuery);

    expect(prisma.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            {
              titleRaw: {
                contains: "腰带缺件",
                mode: "insensitive",
              },
            },
            {
              descriptionRaw: {
                contains: "腰带缺件",
                mode: "insensitive",
              },
            },
            {
              titleZh: {
                contains: "腰带缺件",
                mode: "insensitive",
              },
            },
            {
              descriptionZh: {
                contains: "腰带缺件",
                mode: "insensitive",
              },
            },
            {
              conditionZh: {
                contains: "腰带缺件",
                mode: "insensitive",
              },
            },
            {
              shippingZh: {
                contains: "腰带缺件",
                mode: "insensitive",
              },
            },
            {
              seller: {
                name: {
                  contains: "腰带缺件",
                  mode: "insensitive",
                },
              },
            },
          ],
        }),
      }),
    );
  });

  it("filters one listing type while returning full-dataset transaction facets", async () => {
    const prisma = {
      item: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi
          .fn()
          .mockResolvedValueOnce(37)
          .mockResolvedValueOnce(37)
          .mockResolvedValueOnce(2_941)
          .mockResolvedValueOnce(12),
      },
      $transaction: vi.fn(async (queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };
    const service = new ItemsService(prisma as never);

    const result = await service.list({
      listingType: "auction",
      limit: 40,
      offset: 0,
    } as ListItemsQuery);

    expect(prisma.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          listingType: "auction",
          status: { in: ["active", "unknown"] },
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
    expect(prisma.item.count).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ listingType: "auction" }),
      }),
    );
    expect(prisma.item.count).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({ listingType: "direct" }),
      }),
    );
    expect(prisma.item.count).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        where: expect.objectContaining({ listingType: "unknown" }),
      }),
    );
    expect(result).toMatchObject({
      total: 37,
      facets: { auction: 37, direct: 2_941, unknown: 12 },
    });
  });

  it("sorts a fully filtered page by price without losing pagination", async () => {
    const prisma = {
      item: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn(async (queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };
    const service = new ItemsService(prisma as never);

    await service.list({
      favorite: true,
      listingType: "direct",
      sortBy: "price",
      sortOrder: "desc",
      limit: 20,
      offset: 60,
    } as ListItemsQuery);

    expect(prisma.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          favorite: true,
          listingType: "direct",
        }),
        orderBy: [
          { priceCurrent: "desc" },
          { detectedAt: "desc" },
          { id: "asc" },
        ],
        skip: 60,
        take: 20,
      }),
    );
  });

  it("uses minute precision for closing auctions and supports deadline ordering", async () => {
    const prisma = {
      item: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn(async (queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };
    const service = new ItemsService(prisma as never);
    const before = Date.now();

    await service.list({
      listingType: "auction",
      auctionMinutes: 30,
      auctionHours: 12,
      sortBy: "auctionEndAt",
      sortOrder: "asc",
      limit: 30,
      offset: 0,
    } as ListItemsQuery);

    const call = prisma.item.findMany.mock.calls[0][0];
    expect(call.where.listingType).toBe("auction");
    expect(call.where.auctionEndAt.gt.getTime()).toBeGreaterThanOrEqual(before);
    expect(call.where.auctionEndAt.lte.getTime()).toBeGreaterThanOrEqual(
      before + 30 * 60_000,
    );
    expect(call.where.auctionEndAt.lte.getTime()).toBeLessThan(
      before + 30 * 60_000 + 2_000,
    );
    expect(call.orderBy).toEqual([
      { auctionEndAt: { sort: "asc", nulls: "last" } },
      { detectedAt: "desc" },
      { id: "asc" },
    ]);
  });

  it("keeps list comparison compact and adds verified offers only to detail", async () => {
    vi.stubEnv("CHINA_MARKET_COMPARISON_ENABLED", "true");
    vi.stubEnv("CHINA_MARKET_COMPARISON_AUTHORIZED", "true");
    vi.stubEnv("XIANYU_COMPARISON_ENABLED", "true");
    const observedAt = new Date();
    const nextRefreshAt = new Date(observedAt.getTime() + 86_400_000);
    const item = {
      id: "item-with-comparison",
      sourceData: null,
      source: { key: "mercari", displayName: "Mercari" },
      product: {
        id: "product-1",
        canonicalName: "DX 测试商品",
        marketComparisons: [
          {
            id: "comparison-1",
            status: "ready",
            searchKeywords: ["DX 测试商品"],
            candidateCount: 7,
            matchedCount: 3,
            referencePriceCny: new Prisma.Decimal("188.80"),
            minPriceCny: new Prisma.Decimal("168.00"),
            maxPriceCny: new Prisma.Decimal("208.00"),
            referenceUrl: "https://www.goofish.com/item?id=offer-1",
            referenceTitle: "DX 测试商品",
            confidence: 0.97,
            observedAt,
            nextRefreshAt,
            lastError: null,
            source: { key: "xianyu", displayName: "闲鱼" },
            offers: [
              {
                id: "offer-1",
                sourceListingId: "offer-1",
                sourceUrl: "https://www.goofish.com/item?id=offer-1",
                titleRaw: "DX 测试商品",
                priceCny: new Prisma.Decimal("188.80"),
                currency: "CNY",
                imageUrl: null,
                location: "上海",
                condition: "二手",
                status: "active",
                matchConfidence: 0.97,
                matchDecision: "auto_matched",
                lastSeenAt: observedAt,
              },
            ],
          },
        ],
      },
    };
    const prisma = {
      item: {
        findMany: vi.fn().mockResolvedValue([item]),
        findUnique: vi.fn().mockResolvedValue(item),
        count: vi.fn().mockResolvedValue(1),
      },
      $transaction: vi.fn(async (queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };
    const service = new ItemsService(prisma as never);

    const listed = await service.list({
      limit: 10,
      offset: 0,
    } as ListItemsQuery);
    const detailed = await service.get(item.id);

    const expectedComparison = {
      status: "ready",
      source: { key: "xianyu", displayName: "闲鱼" },
      referencePriceCny: 188.8,
      referenceUrl: "https://www.goofish.com/item?id=offer-1",
      observedAt,
      expiresAt: new Date(observedAt.getTime() + 86_400_000),
    };
    expect(listed.items[0].chinaComparison).toEqual(expectedComparison);
    expect(detailed.item.chinaComparison).toEqual({
      ...expectedComparison,
      offers: [
        {
          title: "DX 测试商品",
          priceCny: 188.8,
          condition: "二手",
          imageUrl: null,
          sourceUrl: "https://www.goofish.com/item?id=offer-1",
          isReference: true,
        },
      ],
    });
    expect(listed.items[0].product).not.toHaveProperty("marketComparisons");
    expect(detailed.item.product).not.toHaveProperty("marketComparisons");
    expect(prisma.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          product: {
            include: expect.objectContaining({
              marketComparisons: expect.objectContaining({
                where: {
                  status: "ready",
                  lastError: null,
                  source: { key: "xianyu" },
                },
                take: 1,
              }),
            }),
          },
        }),
      }),
    );
    expect(prisma.item.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          product: {
            include: expect.objectContaining({
              marketComparisons: expect.objectContaining({
                where: {
                  status: "ready",
                  lastError: null,
                  source: { key: "xianyu" },
                },
                take: 1,
              }),
            }),
          },
        }),
      }),
    );
  });

  it("verifies every value-king candidate before paginating the direct-buy result", async () => {
    vi.stubEnv("CHINA_MARKET_COMPARISON_ENABLED", "true");
    vi.stubEnv("CHINA_MARKET_COMPARISON_AUTHORIZED", "true");
    vi.stubEnv("XIANYU_COMPARISON_ENABLED", "true");
    vi.stubEnv("XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED", "true");
    const now = new Date();
    const observedAt = new Date(now.getTime() - 60 * 60_000);
    const opportunity = (netProfitJpy: number, evidenceExpiresAt: Date) => ({
      status: "ready",
      xianyuReferencePriceCny: new Prisma.Decimal("1200"),
      jpyToCnyRate: new Prisma.Decimal("0.05"),
      acquisitionCostJpy: 3_500,
      grossSpreadCny: new Prisma.Decimal("1025"),
      grossSpreadRatio: 0.85,
      netProfitJpy,
      netMarginRatio: 0.6,
      missingFacts: [],
      rejectionReason: null,
      listingObservedAt: observedAt,
      comparisonObservedAt: observedAt,
      exchangeRateFetchedAt: observedAt,
      evidenceExpiresAt,
      evaluatedAt: observedAt,
      comparison: {
        status: "ready",
        matchedCount: 3,
        confidence: 0.95,
        referencePriceCny: new Prisma.Decimal("1200"),
        referenceUrl: "https://www.goofish.com/item?id=value-king",
        observedAt,
        lastError: null,
        source: { key: "xianyu" },
      },
    });
    const item = (
      id: string,
      netProfitJpy: number,
      evidenceExpiresAt: Date,
    ) => ({
      id,
      sourceData: null,
      source: { key: "mercari", displayName: "Mercari" },
      product: null,
      listingType: "direct",
      status: "active",
      archivedAt: null,
      ignored: false,
      purchaseRecord: null,
      priceCurrent: 3_000,
      shippingFee: 500,
      quantityEst: 5,
      conditionGrade: "used",
      detectedAt: observedAt,
      crossMarketOpportunities: [opportunity(netProfitJpy, evidenceExpiresAt)],
    });
    const prisma = {
      item: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            item("lower-profit", 8_000, new Date(now.getTime() + 60 * 60_000)),
            item("expired", 20_000, new Date(now.getTime() - 1)),
            item(
              "higher-profit",
              12_000,
              new Date(now.getTime() + 60 * 60_000),
            ),
          ]),
        count: vi.fn(),
      },
    };
    const service = new ItemsService(prisma as never);

    const result = await service.list({
      valueKing: true,
      listingType: "direct",
      limit: 1,
      offset: 1,
    } as ListItemsQuery);

    expect(prisma.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          listingType: "direct",
          status: "active",
          shippingFee: { not: null },
          quantityEst: { not: null },
        }),
        include: expect.objectContaining({
          crossMarketOpportunities: expect.objectContaining({ take: 3 }),
        }),
      }),
    );
    expect(prisma.item.findMany.mock.calls[0][0].where).not.toHaveProperty('crossMarketOpportunities');
    expect(result).toMatchObject({
      total: 2,
      facets: { auction: 0, direct: 2, unknown: 0 },
      items: [
        {
          id: "lower-profit",
          valueKing: { netProfitJpy: 8_000 },
        },
      ],
    });
  });

  it("never exposes the value-king area as an auction listing", async () => {
    vi.stubEnv("CHINA_MARKET_COMPARISON_ENABLED", "true");
    vi.stubEnv("CHINA_MARKET_COMPARISON_AUTHORIZED", "true");
    vi.stubEnv("XIANYU_COMPARISON_ENABLED", "true");
    vi.stubEnv("XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED", "true");
    const prisma = { item: { findMany: vi.fn(), count: vi.fn() } };
    const service = new ItemsService(prisma as never);

    await expect(
      service.list({
        valueKing: true,
        listingType: "auction",
        limit: 20,
        offset: 0,
      } as ListItemsQuery),
    ).resolves.toMatchObject({
      items: [],
      total: 0,
      facets: { auction: 0, direct: 0, unknown: 0 },
    });
    expect(prisma.item.findMany).not.toHaveBeenCalled();
  });
  it('lists existing low-unit-cost bundles even when Xianyu is disabled',async()=>{
    vi.stubEnv('CHINA_MARKET_COMPARISON_ENABLED','false');vi.stubEnv('XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED','false');
    const candidate={id:'bundle-without-xianyu',source:{key:'mercari',displayName:'Mercari'},listingType:'direct',status:'active',channel:'online',ignored:false,archivedAt:null,purchaseRecord:null,titleRaw:'仮面ライダー SHF 5体セット',descriptionRaw:'仮面ライダー SHF 正規品5体セット、付属品完備。まとめて出品します。',categoryToyType:'figure',categoryIp:'kamen_rider',collectibleSeries:'shf',conditionGrade:'used',quantityEst:5,priceCurrent:3000,shippingFee:500,images:[{url:'https://example.com/a.jpg',position:0}],lastSeenAt:new Date(),detectedAt:new Date(),crossMarketOpportunities:[],product:null};
    const prisma={item:{findMany:vi.fn().mockResolvedValue([candidate]),count:vi.fn()}};
    const result=await new ItemsService(prisma as never).list({valueKing:true,listingType:'direct',limit:20,offset:0} as ListItemsQuery);
    expect(result.total).toBe(1);expect(result.items[0].valueKing?.referenceBasis).toBe('unit_cost');
    expect(prisma.item.findMany.mock.calls[0][0].where).not.toHaveProperty('crossMarketOpportunities');
  });
});

describe("ItemsService.changes", () => {
  const collaborativeReview = (index: number, overrides = {}) => {
    const suffix = String(index).padStart(4, "0");
    return {
      id: `review-${suffix}`,
      itemId: `item-${suffix}`,
      createdAt: new Date("2026-08-31T12:00:00.000Z"),
      beforeData: {
        id: `item-${suffix}`,
        favorite: false,
        ignored: false,
        ignoredAt: null,
        archivedAt: null,
        note: null,
        updatedAt: "2026-08-31T11:59:59.000Z",
      },
      afterData: {
        id: `item-${suffix}`,
        favorite: true,
        ignored: false,
        ignoredAt: null,
        archivedAt: null,
        note: null,
        updatedAt: "2026-08-31T12:00:00.000Z",
      },
      ...overrides,
    };
  };

  it("continues after 500 same-timestamp events without skipping the remainder", async () => {
    const reviews = Array.from({ length: 501 }, (_, index) =>
      collaborativeReview(index),
    );
    const findMany = vi
      .fn()
      .mockResolvedValueOnce(reviews)
      .mockResolvedValueOnce([reviews[500]]);
    const service = new ItemsService({ manualReview: { findMany } } as never);

    const first = await service.changes("2026-08-31T11:59:00.000Z");

    expect(first.changes).toHaveLength(500);
    expect(first.changes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "item-0500" })]),
    );
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toMatch(/^v1\./);
    expect(first.serverTime).toBe("2026-08-31T12:00:00.000Z");

    const second = await service.changes(first.nextCursor);

    expect(second.changes).toEqual([
      expect.objectContaining({ id: "item-0500", favorite: true }),
    ]);
    expect(second.hasMore).toBe(false);
    expect(second.serverTime).toBe("2026-08-31T12:00:00.000Z");
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          OR: [
            { createdAt: { gt: new Date("2026-08-31T12:00:00.000Z") } },
            {
              createdAt: new Date("2026-08-31T12:00:00.000Z"),
              id: { gt: "review-0499" },
            },
          ],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 501,
      }),
    );
  });

  it("returns only favorite, note, and ignored collaboration changes", async () => {
    const nonCollaborative = collaborativeReview(1, {
      beforeData: { id: "item-0001", quantityEst: 1 },
      afterData: { id: "item-0001", quantityEst: 2 },
    });
    const noteReview = collaborativeReview(2, {
      beforeData: {
        ...collaborativeReview(2).beforeData,
        favorite: false,
        note: null,
      },
      afterData: {
        ...collaborativeReview(2).afterData,
        favorite: false,
        note: "重点看看",
      },
    });
    const findMany = vi.fn().mockResolvedValue([nonCollaborative, noteReview]);
    const service = new ItemsService({ manualReview: { findMany } } as never);

    const result = await service.changes("2026-08-31T11:59:00.000Z");

    expect(result.changes).toEqual([
      expect.objectContaining({
        id: "item-0002",
        favorite: false,
        note: "重点看看",
      }),
    ]);
    expect(result.hasMore).toBe(false);
  });

  it("pushes sold, removed, archived and expired auction changes without erasing omitted collaborative fields", async () => {
    const events = [
      {
        id: "sold-event",
        itemId: "sold-item",
        createdAt: new Date("2026-10-08T12:00:00.000Z"),
        beforeData: { status: "active" },
        afterData: { status: "sold" },
      },
      {
        id: "removed-event",
        itemId: "removed-item",
        createdAt: new Date("2026-10-08T12:00:01.000Z"),
        beforeData: { status: "active" },
        afterData: { status: "removed" },
      },
      {
        id: "archive-event",
        itemId: "archived-item",
        createdAt: new Date("2026-10-08T12:00:02.000Z"),
        beforeData: { archivedAt: null },
        afterData: { archivedAt: "2026-10-08T12:00:02.000Z" },
      },
      {
        id: "expiry-event",
        itemId: "expired-item",
        createdAt: new Date("2026-10-08T12:00:03.000Z"),
        beforeData: { listingType: "unknown", auctionEndAt: null },
        afterData: { listingType: "auction", auctionEndAt: "2026-10-08T11:59:00.000Z" },
      },
    ];
    const findMany = vi.fn().mockResolvedValue(events);
    const service = new ItemsService({ manualReview: { findMany } } as never);

    const result = await service.changes("2026-10-08T11:00:00.000Z");

    expect(result.changes).toEqual([
      { id: "sold-item", status: "sold", updatedAt: "2026-10-08T12:00:00.000Z" },
      { id: "removed-item", status: "removed", updatedAt: "2026-10-08T12:00:01.000Z" },
      { id: "archived-item", archivedAt: "2026-10-08T12:00:02.000Z", updatedAt: "2026-10-08T12:00:02.000Z" },
      { id: "expired-item", listingType: "auction", auctionEndAt: "2026-10-08T11:59:00.000Z", updatedAt: "2026-10-08T12:00:03.000Z" },
    ]);
    expect(result.changes.every((change) => !Object.hasOwn(change, "favorite"))).toBe(true);
    expect(result.changes.every((change) => !Object.hasOwn(change, "ignored"))).toBe(true);
    expect(result.changes.every((change) => !Object.hasOwn(change, "note"))).toBe(true);
  });

  it("retains a known unavailable change when a later status check is unchanged or merely adds diagnostics", async () => {
    const events = [
      {
        id: "sold-event",
        itemId: "sold-item",
        createdAt: new Date("2026-10-08T12:00:00.000Z"),
        beforeData: { status: "active" },
        afterData: { status: "sold", archivedAt: "2026-10-08T12:00:00.000Z" },
      },
      {
        id: "diagnostic-event",
        itemId: "sold-item",
        createdAt: new Date("2026-10-08T12:00:01.000Z"),
        beforeData: { status: "sold", archivedAt: "2026-10-08T12:00:00.000Z" },
        afterData: { availabilityCheck: { error: "network_timeout" } },
      },
    ];
    const service = new ItemsService({ manualReview: { findMany: vi.fn().mockResolvedValue(events) } } as never);
    const result = await service.changes("2026-10-08T11:00:00.000Z");
    expect(result.changes).toEqual([
      expect.objectContaining({ id: "sold-item", status: "sold", archivedAt: "2026-10-08T12:00:00.000Z" }),
    ]);
  });

  it("pushes price and shipping-only audits without clearing favorite, note or availability", async () => {
    const createdAt = new Date("2026-10-08T12:00:00.000Z");
    const service = new ItemsService({ manualReview: { findMany: vi.fn().mockResolvedValue([{
      id: "price-check", itemId: "priced-item", createdAt,
      beforeData: { priceCurrent: 1_000, shippingFee: 200, priceTotalEst: 1_200, bidCount: 1 },
      afterData: { priceCurrent: 2_400, shippingFee: null, priceTotalEst: 2_400, bidCount: 2 },
    }]) } } as never);
    expect((await service.changes("2026-10-08T11:00:00.000Z")).changes).toEqual([{
      id: "priced-item", priceCurrent: 2_400, shippingFee: null, priceTotalEst: 2_400, bidCount: 2,
      updatedAt: createdAt.toISOString(),
    }]);
  });

  it("merges partial availability and note events for the same item in one sync page", async () => {
    const events = [
      {
        id: "sold-event",
        itemId: "sold-item",
        createdAt: new Date("2026-10-08T12:00:00.000Z"),
        beforeData: { status: "active" },
        afterData: { status: "sold" },
      },
      {
        id: "note-event",
        itemId: "sold-item",
        createdAt: new Date("2026-10-08T12:00:01.000Z"),
        beforeData: { note: null },
        afterData: { note: "已售" },
      },
    ];
    const service = new ItemsService({ manualReview: { findMany: vi.fn().mockResolvedValue(events) } } as never);
    expect((await service.changes("2026-10-08T11:00:00.000Z")).changes).toEqual([
      { id: "sold-item", status: "sold", note: "已售", updatedAt: "2026-10-08T12:00:01.000Z" },
    ]);
  });
});

describe("UpdateItemDto note validation", () => {
  it("accepts 25 characters and rejects 26", async () => {
    const accepted = Object.assign(new UpdateItemDto(), {
      note: "购".repeat(25),
    });
    const rejected = Object.assign(new UpdateItemDto(), {
      note: "购".repeat(26),
    });

    expect(await validate(accepted)).toHaveLength(0);
    expect(await validate(rejected)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: "note" })]),
    );
  });
});

describe("ItemsService collaborative states", () => {
  it("moves an item into the shared ignored warehouse without deleting it", async () => {
    const current = {
      id: "ignored-item",
      favorite: true,
      ignored: false,
      ignoredAt: null,
      note: null,
      quantityEst: 1,
      priceTotalEst: 1_000,
      needsReview: false,
    };
    const tx = {
      item: {
        update: vi.fn().mockImplementation(({ data }) => ({
          ...current,
          ...data,
          updatedAt: new Date(),
        })),
      },
      managerAccount: { findFirst: vi.fn().mockResolvedValue(null) },
      managerActivity: { create: vi.fn().mockResolvedValue({}) },
      manualReview: { create: vi.fn().mockResolvedValue({}) },
      reviewQueue: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = {
      item: { findUnique: vi.fn().mockResolvedValue(current) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new ItemsService(prisma as never);

    await service.update("ignored-item", { ignored: true });

    expect(tx.item.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ignored-item" },
        data: expect.objectContaining({
          ignored: true,
          ignoredAt: expect.any(Date),
          favorite: false,
        }),
      }),
    );
    expect(prisma.item).not.toHaveProperty("delete");
  });

  it("returns the current China comparison from a lightweight collaborative patch", async () => {
    vi.stubEnv("CHINA_MARKET_COMPARISON_ENABLED", "true");
    vi.stubEnv("CHINA_MARKET_COMPARISON_AUTHORIZED", "true");
    vi.stubEnv("XIANYU_COMPARISON_ENABLED", "true");
    const observedAt = new Date();
    const current = {
      id: "favorite-with-comparison",
      favorite: false,
      ignored: false,
      ignoredAt: null,
      archivedAt: null,
      note: null,
      updatedAt: observedAt,
    };
    const updated = {
      ...current,
      favorite: true,
      product: {
        marketComparisons: [
          {
            status: "ready",
            matchedCount: 3,
            minPriceCny: new Prisma.Decimal("168.00"),
            maxPriceCny: new Prisma.Decimal("208.00"),
            confidence: 0.97,
            referencePriceCny: new Prisma.Decimal("188.80"),
            referenceUrl: "https://www.goofish.com/item?id=offer-patch",
            observedAt,
            nextRefreshAt: new Date(observedAt.getTime() + 6 * 3_600_000),
            lastError: null,
            source: { key: "xianyu", displayName: "闲鱼" },
          },
        ],
      },
    };
    const tx = {
      item: { update: vi.fn().mockResolvedValue(updated) },
      managerAccount: { findFirst: vi.fn().mockResolvedValue(null) },
      managerActivity: { create: vi.fn().mockResolvedValue({}) },
      manualReview: { create: vi.fn().mockResolvedValue({}) },
      reviewQueue: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = {
      item: { findUnique: vi.fn().mockResolvedValue(current) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new ItemsService(prisma as never);

    const result = await service.update(current.id, { favorite: true });

    expect(result.item).toMatchObject({
      id: current.id,
      favorite: true,
      chinaComparison: {
        status: "ready",
        source: { key: "xianyu", displayName: "闲鱼" },
        referencePriceCny: 188.8,
        referenceUrl: "https://www.goofish.com/item?id=offer-patch",
        observedAt,
        expiresAt: new Date(observedAt.getTime() + 86_400_000),
      },
    });
    expect(result.item).not.toHaveProperty("product");
    expect(tx.item.update).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          product: {
            select: {
              marketComparisons: expect.objectContaining({ take: 1 }),
            },
          },
        }),
      }),
    );
  });

  it("rejects a direct service call whose procurement note exceeds 25 characters", async () => {
    const prisma = {
      item: {
        findUnique: vi.fn().mockResolvedValue({ id: "item-1" }),
      },
    };
    const service = new ItemsService(prisma as never);

    await expect(
      service.update("item-1", { note: "购".repeat(26) }),
    ).rejects.toThrow("采购备注不能超过 25 个字符");
  });

  it("returns the current China comparison after a non-collaborative patch", async () => {
    vi.stubEnv("CHINA_MARKET_COMPARISON_ENABLED", "true");
    vi.stubEnv("CHINA_MARKET_COMPARISON_AUTHORIZED", "true");
    vi.stubEnv("XIANYU_COMPARISON_ENABLED", "true");
    const observedAt = new Date();
    const current = {
      id: "patched-item",
      quantityEst: 1,
      priceTotalEst: 1_000,
      needsReview: false,
    };
    const updated = {
      ...current,
      quantityEst: 2,
      product: {
        id: "product-1",
        marketComparisons: [
          {
            status: "ready",
            matchedCount: 3,
            minPriceCny: new Prisma.Decimal("188.00"),
            maxPriceCny: new Prisma.Decimal("208.00"),
            confidence: 0.96,
            referencePriceCny: new Prisma.Decimal("199.00"),
            referenceUrl: "https://www.goofish.com/item?id=offer-latest",
            observedAt,
            nextRefreshAt: new Date(observedAt.getTime() + 86_400_000),
            source: { key: "xianyu", displayName: "闲鱼" },
          },
        ],
      },
    };
    const tx = {
      item: { update: vi.fn().mockResolvedValue(updated) },
      manualReview: { create: vi.fn().mockResolvedValue({}) },
      reviewQueue: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = {
      item: { findUnique: vi.fn().mockResolvedValue(current) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new ItemsService(prisma as never);

    const result = await service.update("patched-item", { quantityEst: 2 });

    expect(result.item).toEqual(
      expect.objectContaining({
        chinaComparison: expect.objectContaining({
          referencePriceCny: 199,
          referenceUrl: "https://www.goofish.com/item?id=offer-latest",
          expiresAt: new Date(observedAt.getTime() + 86_400_000),
        }),
        product: expect.not.objectContaining({
          marketComparisons: expect.anything(),
        }),
      }),
    );
    expect(tx.item.update).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          product: {
            include: expect.objectContaining({
              marketComparisons: expect.any(Object),
            }),
          },
        }),
      }),
    );
  });

  it.each([
    ["direct", 200, 600],
    ["direct", null, null],
    ["auction", 200, null],
  ] as const)(
    "does not turn uncertain costs into a confirmed unit price: %s/%s",
    async (listingType, shippingFee, expected) => {
      const current = {
        id: "cost-item",
        quantityEst: 1,
        priceCurrent: 1000,
        priceTotalEst: 999999,
        shippingFee,
        listingType,
        needsReview: false,
      };
      const tx = {
        item: { update: vi.fn().mockResolvedValue(current) },
        manualReview: { create: vi.fn().mockResolvedValue({}) },
        reviewQueue: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      };
      const prisma = {
        item: { findUnique: vi.fn().mockResolvedValue(current) },
        $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
      };
      await new ItemsService(prisma as never).update(current.id, {
        quantityEst: 2,
      });
      expect(tx.item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ unitCostEst: expected }),
        }),
      );
    },
  );
});

describe("ItemsService seller pagination", () => {
  const sellerRow = (
    id: string,
    sellerType: "individual" | "store" | "unknown" = "individual",
    categoryToyTypes = ["figure"],
  ) => ({
    id,
    name: id,
    sellerType,
    locationText: null,
    sourceData: null,
    profileUrl: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    source: { key: "yahoo_auctions", displayName: "Yahoo!オークション" },
    items: categoryToyTypes.map((categoryToyType) => ({ categoryToyType })),
  });

  it("returns the real seller-directory total and paginates after classification", async () => {
    const rows = Array.from({ length: 1_105 }, (_, index) =>
      sellerRow(`seller-${index + 1}`),
    );
    const prisma = {
      seller: {
        findMany: vi.fn().mockResolvedValue(rows),
      },
    };
    const service = new ItemsService(prisma as never);

    const result = await service.listSellers("", 3, 60);

    expect(result).toMatchObject({ total: 1_105, page: 3, pageCount: 19 });
    expect(result.sellers[0]).toMatchObject({ id: "seller-121" });
    expect(result.sellers).toHaveLength(60);
    expect(result.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "occasional", count: 1_105 }),
      ]),
    );
  });

  it("filters by one segment while returning counts and descriptions for every group", async () => {
    const rows = [
      sellerRow("store", "store"),
      sellerRow("volume", "individual", Array(20).fill("figure")),
      sellerRow("specialist", "individual", Array(4).fill("sofubi")),
      sellerRow("active", "individual", ["figure", "sofubi"]),
      sellerRow("occasional", "unknown"),
    ];
    const prisma = { seller: { findMany: vi.fn().mockResolvedValue(rows) } };
    const service = new ItemsService(prisma as never);

    const result = await service.listSellers("", 1, 60, "specialist");

    expect(result).toMatchObject({
      total: 1,
      activeSegment: "specialist",
      sellers: [
        expect.objectContaining({
          id: "specialist",
          segment: expect.objectContaining({ key: "specialist" }),
        }),
      ],
      segments: [
        expect.objectContaining({ key: "professional_store", count: 1 }),
        expect.objectContaining({ key: "high_volume", count: 1 }),
        expect.objectContaining({ key: "specialist", count: 1 }),
        expect.objectContaining({ key: "active_individual", count: 1 }),
        expect.objectContaining({ key: "occasional", count: 1 }),
      ],
    });
  });

  it("pages through every active item from one seller", async () => {
    const rows = Array.from({ length: 48 }, (_, index) => ({
      id: `item-${index + 49}`,
    }));
    const prisma = {
      seller: {
        findUnique: vi.fn().mockResolvedValue({
          id: "seller-large",
          name: "large seller",
          source: { key: "yahoo_auctions", displayName: "Yahoo!オークション" },
          items: rows,
        }),
      },
      item: {
        findMany: vi.fn().mockResolvedValue(
          Array.from({ length: 237 }, () => ({
            categoryToyType: "figure",
          })),
        ),
      },
    };
    const service = new ItemsService(prisma as never);

    const result = await service.getSeller("seller-large", 2, 48);

    expect(prisma.seller.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          items: expect.objectContaining({ skip: 48, take: 48 }),
        }),
      }),
    );
    expect(result).toMatchObject({
      total: 237,
      page: 2,
      pageCount: 5,
      items: rows,
      seller: expect.objectContaining({
        segment: expect.objectContaining({ key: "high_volume" }),
      }),
    });
  });
});

describe("purchase bundle pricing contract", () => {
  it("computes per-item totals and rejects a mismatching explicit total", () => {
    expect(
      normalizePurchaseMembers(
        [
          { itemId: "item-a", amountYen: 400 },
          { itemId: "item-b", amountYen: 600 },
        ],
        "per_item",
      ),
    ).toMatchObject({ totalPurchaseAmountYen: 1_000, amountAllocated: true });
    expect(() =>
      normalizePurchaseMembers(
        [
          { itemId: "item-a", amountYen: 400 },
          { itemId: "item-b", amountYen: 600 },
        ],
        "per_item",
        999,
      ),
    ).toThrow("批次总价必须等于全部商品单价之和");
  });

  it("keeps package totals authoritative and unallocated", () => {
    expect(
      normalizePurchaseMembers(
        [{ itemId: "item-a" }, { itemId: "item-b" }],
        "bundle_total",
        1_800,
      ),
    ).toMatchObject({ totalPurchaseAmountYen: 1_800, amountAllocated: false });
    expect(() =>
      normalizePurchaseMembers(
        [{ itemId: "item-a", amountYen: 900 }],
        "bundle_total",
        1_800,
      ),
    ).toThrow("打包总价模式不分摊单品金额");
  });

  it("validates nested member prices in the create DTO", async () => {
    const dto = Object.assign(new CreatePurchaseBundleDto(), {
      pricingMode: "per_item",
      members: [{ itemId: "item-a", amountYen: -1 }],
      actor: "wangxr",
      reason: "登记购买",
    });
    const errors = await validate(dto);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: "members" }),
      ]),
    );
  });
});

describe("ItemsService.purchase receipt limits", () => {
  const item = {
    id: "receipt-test-item",
    productId: null,
    quantityEst: 1,
  };

  it("accepts an image whose decoded payload is exactly 3MB", async () => {
    const receiptDataBase64 = Buffer.alloc(3 * 1024 * 1024).toString("base64");
    const now = new Date("2026-08-31T00:00:00Z");
    const purchase = {
      id: "purchase-1",
      itemId: item.id,
      bundleId: "bundle-1",
      purchaseAmount: 1_000,
      amountAllocated: true,
      purchasedAt: now,
      note: null,
      verifiedAt: now,
      createdAt: now,
    };
    const tx = {
      purchaseBundle: {
        create: vi.fn().mockResolvedValue({ id: "bundle-1" }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "bundle-1",
          version: 1,
          pricingMode: "per_item",
          totalPurchaseAmount: 1_000,
          currency: "JPY",
          purchasedAt: now,
          note: null,
          archivedAt: null,
          purchases: [purchase],
        }),
        findUnique: vi.fn().mockResolvedValue({
          id: "bundle-1",
          version: 1,
          pricingMode: "per_item",
          totalPurchaseAmount: 1_000,
          currency: "JPY",
          purchasedAt: now,
          note: null,
          archivedAt: null,
          purchases: [purchase],
        }),
      },
      purchaseRecord: {
        create: vi.fn().mockResolvedValue(purchase),
        update: vi.fn().mockResolvedValue(purchase),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ...purchase,
          receipts: [],
        }),
      },
      managerAccount: {
        findFirst: vi.fn(async () => null),
      },
      itemDecision: {
        upsert: vi.fn(async () => ({})),
      },
      negotiationCase: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      purchaseBundleAudit: {
        create: vi.fn().mockResolvedValue({ id: "audit-1" }),
      },
      purchaseReceipt: {
        create: vi.fn().mockResolvedValue({ id: "receipt-1" }),
      },
      inventoryOrder: {
        findUnique: vi.fn().mockResolvedValue(null),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ id: "inventory-order-1" }),
      },
      item: {
        findMany: vi.fn().mockResolvedValue([
          {
            ...item,
            titleRaw: "receipt test product",
            titleZh: "购买凭证测试商品",
            source: { displayName: "测试平台" },
            images: [],
          },
        ]),
        findUnique: vi.fn().mockResolvedValue({
          ...item,
          purchaseRecord: null,
        }),
        update: vi.fn().mockResolvedValue(item),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new ItemsService(prisma as never);

    const result = await service.purchase(item.id, {
      purchaseAmount: 1_000,
      receiptFileName: "receipt.png",
      receiptMimeType: "image/png",
      receiptDataBase64,
    });

    expect(result.verified).toBe(true);
    expect(tx.inventoryOrder.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceBundleId: "bundle-1",
          purchaseCost: 1_000,
          initialQuantity: 1,
          name: "购买凭证测试商品",
        }),
      }),
    );
    expect(tx.purchaseReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sizeBytes: 3 * 1024 * 1024 }),
      }),
    );
  });

  it("rejects an image whose decoded payload exceeds 3MB", async () => {
    const prisma = {
      item: { findUnique: vi.fn().mockResolvedValue(item) },
      $transaction: vi.fn(),
    };
    const service = new ItemsService(prisma as never);

    await expect(
      service.purchase(item.id, {
        purchaseAmount: 1_000,
        receiptMimeType: "image/png",
        receiptDataBase64: Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64"),
      }),
    ).rejects.toThrow("购买凭证图片不能超过 3MB");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("ItemsService.removeItem", () => {
  const liveItem = {
    id: "deleted-item",
    favorite: false,
    ignored: false,
    ignoredAt: null,
    ignoredReason: null,
    archivedAt: null,
    deletedAt: null,
    status: "active",
    productId: "product-1",
    note: null,
    updatedAt: new Date("2026-10-24T00:00:00.000Z"),
  };

  function deleteHarness(current: unknown, txItemRow: unknown) {
    const updated = {
      id: "deleted-item",
      favorite: false,
      ignored: false,
      ignoredAt: null,
      ignoredReason: null,
      archivedAt: null,
      deletedAt: new Date("2026-10-25T00:00:00.000Z"),
      note: null,
      updatedAt: new Date("2026-10-25T00:00:00.000Z"),
      product: { marketComparisons: [] },
    };
    const tx = {
      item: {
        findUnique: vi.fn().mockResolvedValue(txItemRow),
        update: vi.fn().mockResolvedValue(updated),
      },
      shoppingCartItem: {
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      manualReview: { create: vi.fn().mockResolvedValue({}) },
      managerActivity: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      item: { findUnique: vi.fn().mockResolvedValue(current) },
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => unknown) => callback(tx),
      ),
    };
    return { tx, prisma, service: new ItemsService(prisma as never) };
  }

  it("stamps only the tombstone, clears cart rows and writes a plain audit row", async () => {
    const { tx, service } = deleteHarness(liveItem, {
      deletedAt: null,
      purchaseRecord: null,
      resaleListing: null,
    });

    await expect(
      service.removeItem("deleted-item", { actor: "manager-1" }),
    ).resolves.toMatchObject({ deleted: true });

    expect(tx.item.update).toHaveBeenCalledTimes(1);
    expect(tx.item.update).toHaveBeenCalledWith({
      where: { id: "deleted-item" },
      data: { deletedAt: expect.any(Date) },
      select: expect.objectContaining({ deletedAt: true }),
    });
    expect(tx.shoppingCartItem.deleteMany).toHaveBeenCalledWith({
      where: { itemId: "deleted-item" },
    });
    expect(tx.manualReview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        itemId: "deleted-item",
        actor: "manager-1",
        reason: "manual_delete",
      }),
    });
    // Pure delete is not a preference signal.
    expect(tx.managerActivity.create).not.toHaveBeenCalled();
  });

  it("is idempotent for an already deleted item", async () => {
    const { tx, prisma, service } = deleteHarness(
      { ...liveItem, deletedAt: new Date("2026-10-25T00:00:00.000Z") },
      null,
    );

    await expect(service.removeItem("deleted-item")).resolves.toMatchObject({
      deleted: true,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.item.update).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown item", async () => {
    const { service } = deleteHarness(null, null);
    await expect(service.removeItem("missing-item")).rejects.toMatchObject({
      status: 404,
    });
  });

  it.each([
    ["a purchase record", { purchaseRecord: { id: "purchase-1" }, resaleListing: null }],
    ["a resale listing", { purchaseRecord: null, resaleListing: { id: "resale-1" } }],
  ])("refuses to delete an item with %s", async (_label, relations) => {
    const { tx, service } = deleteHarness(liveItem, {
      deletedAt: null,
      ...relations,
    });
    await expect(service.removeItem("deleted-item")).rejects.toMatchObject({
      status: 409,
    });
    expect(tx.item.update).not.toHaveBeenCalled();
    expect(tx.shoppingCartItem.deleteMany).not.toHaveBeenCalled();
  });

  it("hides a deleted item from get while the audit trail stays readable", async () => {
    const prisma = {
      item: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ ...liveItem, deletedAt: new Date() }),
      },
      manualReview: { findMany: vi.fn().mockResolvedValue([{ id: "review-1" }]) },
    };
    const service = new ItemsService(prisma as never);
    await expect(service.get("deleted-item")).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.audit("deleted-item")).resolves.toEqual([
      { id: "review-1" },
    ]);
  });

  it("keeps deleted rows out of the list query", async () => {
    const prisma = {
      item: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn(async (queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };
    const service = new ItemsService(prisma as never);
    await service.list({ limit: 40, offset: 0 } as ListItemsQuery);
    expect(prisma.item.findMany.mock.calls[0][0].where).toMatchObject({
      deletedAt: null,
    });
  });

  it("publishes the tombstone through the collaborative changes feed", async () => {
    const createdAt = new Date("2026-10-25T00:00:00.000Z");
    const service = new ItemsService({
      manualReview: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "review-delete",
            itemId: "deleted-item",
            createdAt,
            beforeData: { id: "deleted-item", deletedAt: null },
            afterData: {
              id: "deleted-item",
              deletedAt: "2026-10-25T00:00:00.000Z",
            },
          },
        ]),
      },
    } as never);
    const result = await service.changes("2026-10-24T00:00:00.000Z");
    expect(result.changes).toEqual([
      {
        id: "deleted-item",
        deletedAt: "2026-10-25T00:00:00.000Z",
        updatedAt: createdAt.toISOString(),
      },
    ]);
  });
});
