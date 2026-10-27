import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { prisma } from "@tokusatsu/db";
import { MercariAdapter } from "./adapters/mercari.adapter.js";
import { NoPublicPriceError } from "./adapters/public-listing-status.js";
import { processUrlAnalysis } from "./processors.js";

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
}));

describe("processUrlAnalysis purchase pipeline", () => {
  let itemUpsertSpy: any;

  beforeEach(() => {
    vi.spyOn(prisma.source, "upsert").mockResolvedValue({
      id: "source-mercari",
      key: "mercari",
      displayName: "Mercari",
    } as never);
    vi.spyOn(prisma.crawlJob, "create").mockResolvedValue({
      id: "crawl-job-1",
    } as never);
    vi.spyOn(prisma.crawlJob, "update").mockResolvedValue({
      id: "crawl-job-1",
    } as never);
    vi.spyOn(prisma.crawlJob, "updateMany").mockResolvedValue({
      count: 1,
    } as never);
    vi.spyOn(prisma.urlImport, "update").mockResolvedValue({
      id: "import-1",
    } as never);
    vi.spyOn(prisma.item, "findUnique").mockResolvedValue(null);
    vi.spyOn(prisma.seller, "findUnique").mockResolvedValue(null);
    vi.spyOn(prisma.seller, "upsert").mockResolvedValue({
      id: "seller-1",
    } as never);
    vi.spyOn(prisma.item, "update").mockResolvedValue({
      id: "item-1",
    } as never);
    vi.spyOn(prisma.itemImage, "deleteMany").mockResolvedValue({
      count: 0,
    } as never);
    vi.spyOn(prisma.itemImage, "createMany").mockResolvedValue({
      count: 0,
    } as never);
    vi.spyOn(prisma.itemPriceHistory, "findFirst").mockResolvedValue(null);
    vi.spyOn(prisma.itemPriceHistory, "create").mockResolvedValue({
      id: "history-1",
    } as never);
    vi.spyOn(prisma.itemClassification, "create").mockResolvedValue({
      id: "class-1",
    } as never);

    itemUpsertSpy = (vi.spyOn(prisma.item, "upsert") as any).mockImplementation(
      async (args: any) => ({
        id: "item-1",
        titleRaw: args.create?.titleRaw ?? "",
        priceCurrent: args.create?.priceCurrent ?? 0,
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("purchase 任务 + fetchDetail 抛 NoPublicPriceError + actualAmountYen>0 → 任务成功，落库 priceCurrent = actualAmountYen", async () => {
    vi.spyOn(MercariAdapter.prototype, "fetchDetail").mockRejectedValue(
      new NoPublicPriceError(
        "Mercari detail page did not contain a public price",
      ),
    );
    vi.spyOn(MercariAdapter.prototype, "fetchDetailLenient").mockResolvedValue({
      sourcePlatform: "mercari",
      sourceItemId: "m54739826519",
      sourceUrl: "https://jp.mercari.com/item/m54739826519",
      titleRaw: "仮面ライダー フィギュア",
      priceCurrent: 5200,
      listingType: "direct",
      status: "unknown",
      imageUrls: [],
      channel: "online",
    });

    const job = {
      id: "job-1",
      attemptsMade: 0,
      data: {
        adapterKey: "mercari",
        sourceUrl: "https://jp.mercari.com/item/m54739826519",
        importOrigin: "purchase",
        actualAmountYen: 5200,
        importId: "import-1",
      },
    } as unknown as Job<{
      adapterKey: string;
      sourceUrl: string;
      importId?: string;
      importOrigin?: "url" | "purchase";
      actualAmountYen?: number;
    }>;

    const result = await processUrlAnalysis(job);

    expect(result.itemId).toBe("item-1");
    expect(itemUpsertSpy).toHaveBeenCalledTimes(1);
    const upsertCall = itemUpsertSpy.mock.calls[0][0] as any;
    expect(upsertCall.create.priceCurrent).toBe(5200);
    expect(upsertCall.update.priceCurrent).toBe(5200);
  });

  it("purchase 任务 + NoPublicPriceError + 无 actualAmountYen → 仍失败", async () => {
    vi.spyOn(MercariAdapter.prototype, "fetchDetail").mockRejectedValue(
      new NoPublicPriceError(
        "Mercari detail page did not contain a public price",
      ),
    );

    const job = {
      id: "job-2",
      attemptsMade: 0,
      data: {
        adapterKey: "mercari",
        sourceUrl: "https://jp.mercari.com/item/m54739826519",
        importOrigin: "purchase",
        importId: "import-2",
      },
    } as unknown as Job<{
      adapterKey: string;
      sourceUrl: string;
      importId?: string;
      importOrigin?: "url" | "purchase";
      actualAmountYen?: number;
    }>;

    await expect(processUrlAnalysis(job)).rejects.toBeInstanceOf(
      NoPublicPriceError,
    );
    expect(itemUpsertSpy).not.toHaveBeenCalled();
  });

  it("purchase 任务 + isExcludedNormalizedItem 命中 → 任务成功落库", async () => {
    vi.spyOn(MercariAdapter.prototype, "fetchDetail").mockResolvedValue({
      sourcePlatform: "mercari",
      sourceItemId: "m24324410349",
      sourceUrl: "https://jp.mercari.com/item/m24324410349",
      titleRaw: "仮面ライダー コミック 全3巻",
      priceCurrent: 3000,
      listingType: "direct",
      status: "unknown",
      imageUrls: [],
      channel: "online",
    });

    const job = {
      id: "job-3",
      attemptsMade: 0,
      data: {
        adapterKey: "mercari",
        sourceUrl: "https://jp.mercari.com/item/m24324410349",
        importOrigin: "purchase",
        actualAmountYen: 3000,
        importId: "import-3",
      },
    } as unknown as Job<{
      adapterKey: string;
      sourceUrl: string;
      importId?: string;
      importOrigin?: "url" | "purchase";
      actualAmountYen?: number;
    }>;

    const result = await processUrlAnalysis(job);

    expect(result.itemId).toBe("item-1");
    expect(itemUpsertSpy).toHaveBeenCalledTimes(1);
  });

  it('url 任务（origin "url"）+ 命中过滤 → 仍抛「已过滤书籍或卡片类商品」', async () => {
    vi.spyOn(MercariAdapter.prototype, "fetchDetail").mockResolvedValue({
      sourcePlatform: "mercari",
      sourceItemId: "m24324410349",
      sourceUrl: "https://jp.mercari.com/item/m24324410349",
      titleRaw: "仮面ライダー コミック 全3巻",
      priceCurrent: 3000,
      listingType: "direct",
      status: "unknown",
      imageUrls: [],
      channel: "online",
    });

    const job = {
      id: "job-4",
      attemptsMade: 0,
      data: {
        adapterKey: "mercari",
        sourceUrl: "https://jp.mercari.com/item/m24324410349",
        importOrigin: "url",
        importId: "import-4",
      },
    } as unknown as Job<{
      adapterKey: string;
      sourceUrl: string;
      importId?: string;
      importOrigin?: "url" | "purchase";
      actualAmountYen?: number;
    }>;

    await expect(processUrlAnalysis(job)).rejects.toThrow(
      "已过滤书籍或卡片类商品",
    );
    expect(itemUpsertSpy).not.toHaveBeenCalled();
  });
});
