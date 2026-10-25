import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { prisma } from "@tokusatsu/db";

vi.mock("@tokusatsu/product-intelligence", () => ({
  matchOrCreateProduct: vi.fn().mockResolvedValue(null),
  seedCatalogDictionary: vi.fn().mockResolvedValue(undefined),
  backfillUnmatchedListings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./china-market/arbitrage.js", () => ({
  refreshReadyCrossMarketOpportunitiesForItem: vi
    .fn()
    .mockResolvedValue({ refreshed: 0 }),
  refreshCrossMarketOpportunityForItem: vi
    .fn()
    .mockResolvedValue({ refreshed: 0 }),
}));

const { dummyQueue } = vi.hoisted(() => ({
  dummyQueue: {
    add: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./queues.js", () => ({
  classificationQueue: dummyQueue,
  sellerCatalogueQueue: dummyQueue,
  searchQueue: dummyQueue,
  statusQueue: dummyQueue,
  sellerBackfillQueue: dummyQueue,
  urlAnalysisQueue: dummyQueue,
  maintenanceQueue: dummyQueue,
  dislikedMaintenanceQueue: dummyQueue,
  marketIntelQueue: dummyQueue,
  chinaMarketComparisonQueue: dummyQueue,
  titleTranslationQueue: dummyQueue,
  detailTranslationQueue: dummyQueue,
  aiOperationsQueue: dummyQueue,
  DEFAULT_FULL_RESCAN_INTERVAL_MS: 86_400_000,
  connection: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(null),
    eval: vi.fn().mockResolvedValue(null),
    quit: vi.fn().mockResolvedValue(undefined),
  },
  ensureStatusRefreshCoverage: vi.fn(),
  scheduleJobs: vi.fn(),
}));

import { MercariAdapter } from "./adapters/mercari.adapter.js";
import {
  processSellerCatalogue,
  type SellerCatalogueJobData,
} from "./processors.js";

describe("processSellerCatalogue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BACKGROUND_AI_PAID_AUTOMATION_ENABLED = "false";
    process.env.BACKGROUND_AI_FREE_AUTOMATION_ENABLED = "false";
  });

  afterEach(() => {
    delete process.env.BACKGROUND_AI_PAID_AUTOMATION_ENABLED;
    delete process.env.BACKGROUND_AI_FREE_AUTOMATION_ENABLED;
    vi.restoreAllMocks();
  });

  it("returns { supported: false } for non-Mercari seller without error", async () => {
    vi.spyOn(prisma.seller, "findUnique").mockResolvedValue({
      id: "seller-yahoo",
      sourceId: "source-yahoo",
      name: "Yahoo Seller",
      profileUrl: "https://auctions.yahoo.co.jp/seller/yseller",
      sellerType: "individual",
      sourceData: null,
      source: { key: "yahoo_auctions" },
    } as never);

    const job = {
      id: "test-job-1",
      data: { sellerId: "seller-yahoo" },
    } as Job<SellerCatalogueJobData>;

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await processSellerCatalogue(job);
    expect(result).toEqual({ supported: false });
    expect(consoleSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "seller_catalogue_skipped",
        sellerId: "seller-yahoo",
        reason: "unsupported_source",
      }),
    );
  });

  it("returns { supported: false, error: 'missing_external_id' } when external seller ID cannot be resolved", async () => {
    vi.spyOn(prisma.seller, "findUnique").mockResolvedValue({
      id: "seller-no-id",
      sourceId: "source-mercari",
      name: "Mercari Seller",
      profileUrl: null,
      sellerType: "individual",
      sourceData: null,
      source: { key: "mercari" },
    } as never);

    const job = {
      id: "test-job-2",
      data: { sellerId: "seller-no-id" },
    } as Job<SellerCatalogueJobData>;

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await processSellerCatalogue(job);
    expect(result).toEqual({
      supported: false,
      error: "missing_external_id",
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "seller_catalogue_skipped",
        sellerId: "seller-no-id",
        reason: "missing_external_id",
      }),
    );
  });

  it("filters non-toy items, updates existing items, creates new items, and updates lastCatalogueRefreshAt", async () => {
    const sellerMock = {
      id: "seller-mercari-1",
      sourceId: "source-mercari-id",
      name: "特撮ホビー専門",
      profileUrl: "https://jp.mercari.com/user/profile/123456789",
      sellerType: "individual",
      sourceData: { ratingCount: 150 },
      source: { key: "mercari" },
    };

    vi.spyOn(prisma.seller, "findUnique").mockResolvedValue(sellerMock as never);
    vi.spyOn(prisma.monitoringKeyword, "findMany").mockResolvedValue([
      { keyword: "仮面ライダー" },
      { keyword: "ウルトラマン" },
      { keyword: "スーパー戦隊" },
    ] as never);
    const sellerUpdateSpy = vi
      .spyOn(prisma.seller, "update")
      .mockResolvedValue(sellerMock as never);

    // Mock candidates returned from MercariAdapter.fetchSellerListings
    const candidates = [
      // 1. Non-toy monitoring keyword mismatch: should be dropped before fetching detail
      {
        sourceItemId: "m_clothes_1",
        sourceUrl: "https://jp.mercari.com/item/m_clothes_1",
        titleHint: "ユニクロ Tシャツ メンズ Lサイズ",
        detailHint: {
          priceCurrent: 1000,
          titleRaw: "ユニクロ Tシャツ メンズ Lサイズ",
        },
      },
      // 2. Toy keyword matched, but classification evaluates to other/other: should be dropped
      {
        sourceItemId: "m_other_toy_2",
        sourceUrl: "https://jp.mercari.com/item/m_other_toy_2",
        titleHint: "仮面ライダー お菓子の空き箱",
        detailHint: {
          priceCurrent: 500,
          titleRaw: "仮面ライダー お菓子の空き箱",
        },
      },
      // 3. Valid toy, new item (not in DB yet)
      {
        sourceItemId: "m_belt_new_3",
        sourceUrl: "https://jp.mercari.com/item/m_belt_new_3",
        titleHint: "CSM 変身ベルト 仮面ライダーファイズ",
        detailHint: {
          priceCurrent: 35000,
          titleRaw: "CSM 変身ベルト 仮面ライダーファイズ",
        },
      },
      // 4. Valid toy, already in DB (should count as updated)
      {
        sourceItemId: "m_sofubi_existing_4",
        sourceUrl: "https://jp.mercari.com/item/m_sofubi_existing_4",
        titleHint: "ウルトラマン 怪獣ソフビ バルタン星人",
        detailHint: {
          priceCurrent: 800,
          titleRaw: "ウルトラマン 怪獣ソフビ バルタン星人",
        },
      },
      // 5. Throws error during fetchDetail: should not crash the job
      {
        sourceItemId: "m_error_5",
        sourceUrl: "https://jp.mercari.com/item/m_error_5",
        titleHint: "スーパー戦隊 ロボット 玩具",
        detailHint: {
          priceCurrent: 5000,
          titleRaw: "スーパー戦隊 ロボット 玩具",
        },
      },
    ];

    vi.spyOn(MercariAdapter.prototype, "fetchSellerListings").mockResolvedValue(
      candidates as never,
    );

    vi.spyOn(MercariAdapter.prototype, "fetchDetail").mockImplementation(
      async (candidate) => {
        if (candidate.sourceItemId === "m_error_5") {
          throw new Error("Network timeout fetching item details");
        }
        return {
          sourceItemId: candidate.sourceItemId,
          sourceUrl: candidate.sourceUrl,
          titleRaw: candidate.titleHint ?? "",
          priceCurrent: candidate.detailHint?.priceCurrent ?? 1000,
          descriptionRaw: "商品説明",
          conditionRaw: "中古",
          imageUrls: ["https://example.com/img1.jpg"],
          status: "active",
        } as never;
      },
    );

    vi.spyOn(MercariAdapter.prototype, "normalize").mockImplementation(
      async (raw) => {
        if (raw.sourceItemId === "m_other_toy_2") {
          return {
            sourceItemId: raw.sourceItemId,
            sourceUrl: raw.sourceUrl,
            titleRaw: raw.titleRaw,
            descriptionRaw: "説明",
            priceCurrent: raw.priceCurrent,
            categoryToyType: "other",
            categoryIp: "other",
            channel: "online",
            conditionGrade: "used",
            imageUrls: raw.imageUrls,
            status: "active",
            confidence: 0.1,
          } as never;
        }
        if (raw.sourceItemId === "m_belt_new_3") {
          return {
            sourceItemId: raw.sourceItemId,
            sourceUrl: raw.sourceUrl,
            titleRaw: raw.titleRaw,
            descriptionRaw: "説明",
            priceCurrent: raw.priceCurrent,
            categoryToyType: "henshin_belt",
            categoryIp: "kamen_rider",
            channel: "online",
            conditionGrade: "like_new",
            imageUrls: raw.imageUrls,
            status: "active",
            confidence: 0.95,
          } as never;
        }
        if (raw.sourceItemId === "m_sofubi_existing_4") {
          return {
            sourceItemId: raw.sourceItemId,
            sourceUrl: raw.sourceUrl,
            titleRaw: raw.titleRaw,
            descriptionRaw: "説明",
            priceCurrent: raw.priceCurrent,
            categoryToyType: "soft_vinyl",
            categoryIp: "ultraman",
            channel: "online",
            conditionGrade: "used",
            imageUrls: raw.imageUrls,
            status: "active",
            confidence: 0.9,
          } as never;
        }
        throw new Error(`Unexpected item: ${raw.sourceItemId}`);
      },
    );

    // Mock prisma.item.findUnique: return existing row only for item 4
    (vi.spyOn(prisma.item, "findUnique") as any).mockImplementation(
      async ({ where }: any) => {
        if (where.sourceId_sourceItemId?.sourceItemId === "m_sofubi_existing_4") {
          return { id: "item-existing-4", sellerId: "seller-mercari-1" } as never;
        }
        return null as never;
      },
    );

    // Mock prisma.seller.upsert (for persistNormalized seller resolution)
    vi.spyOn(prisma.seller, "upsert").mockResolvedValue(sellerMock as never);
    vi.spyOn(prisma.seller, "findFirst").mockResolvedValue(sellerMock as never);

    // Mock prisma.item.upsert
    const itemUpsertSpy = (vi.spyOn(prisma.item, "upsert") as any).mockImplementation(
      async ({ where, create }: any) => {
        const id =
          where.sourceId_sourceItemId.sourceItemId === "m_sofubi_existing_4"
            ? "item-existing-4"
            : "item-new-3";
        return {
          id,
          sellerId: sellerMock.id,
          sourceItemId: where.sourceId_sourceItemId.sourceItemId,
          ...create,
        } as never;
      },
    );

    vi.spyOn(prisma.itemImage, "deleteMany").mockResolvedValue({ count: 0 } as never);
    vi.spyOn(prisma.itemImage, "createMany").mockResolvedValue({ count: 1 } as never);
    vi.spyOn(prisma.itemPriceHistory, "findFirst").mockResolvedValue(null as never);
    vi.spyOn(prisma.itemPriceHistory, "create").mockResolvedValue({} as never);
    vi.spyOn(prisma.itemClassification, "create").mockResolvedValue({} as never);
    vi.spyOn(prisma.itemLogistics, "findUnique").mockResolvedValue(null as never);
    vi.spyOn(prisma.itemLogistics, "upsert").mockResolvedValue({} as never);
    const itemUpdateSpy = vi
      .spyOn(prisma.item, "update")
      .mockResolvedValue({} as never);

    const job = {
      id: "test-job-3",
      data: { sellerId: "seller-mercari-1" },
    } as Job<SellerCatalogueJobData>;

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await processSellerCatalogue(job);

    expect(result).toEqual({
      fetched: 5,
      kept: 2,
      droppedOffType: 2,
      created: 1,
      updated: 1,
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "seller_catalogue_completed",
        sellerId: "seller-mercari-1",
        fetched: 5,
        kept: 2,
        droppedOffType: 2,
        created: 1,
        updated: 1,
      }),
    );

    // Verify seller.sourceData.lastCatalogueRefreshAt was updated, retaining ratingCount: 150
    expect(sellerUpdateSpy).toHaveBeenCalledWith({
      where: { id: "seller-mercari-1" },
      data: {
        sourceData: expect.objectContaining({
          ratingCount: 150,
          lastCatalogueRefreshAt: expect.any(String),
        }),
      },
    });

    // Verify 2 items were persisted
    expect(itemUpsertSpy).toHaveBeenCalledTimes(2);
  });
});
