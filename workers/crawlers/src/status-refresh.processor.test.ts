import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  createPrice: vi.fn(),
  refreshOpportunities: vi.fn(),
  findMany: vi.fn(),
  sourceUpsert: vi.fn(),
  sourceUpdate: vi.fn(),
  createCrawl: vi.fn(),
  updateCrawl: vi.fn(),
  heartbeat: vi.fn(),
  keyword: vi.fn(),
  recordMatch: vi.fn(),
  createAudit: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@tokusatsu/db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  prisma: {
    item: {
      findUnique: store.findUnique,
      findMany: store.findMany,
      update: store.update,
      updateMany: store.updateMany,
    },
    itemPriceHistory: { create: store.createPrice },
    source: { upsert: store.sourceUpsert, update: store.sourceUpdate },
    crawlJob: {
      create: store.createCrawl,
      update: store.updateCrawl,
      updateMany: store.heartbeat,
    },
    monitoringKeyword: { findUnique: store.keyword },
    manualReview: { create: store.createAudit },
    $transaction: store.transaction,
  },
}));
vi.mock("./monitoring-keywords.js", () => ({
  recordMonitoringKeywordMatch: store.recordMatch,
}));
vi.mock("./queues.js", () => ({
  connection: {},
  classificationQueue: {},
  statusQueue: {},
  marketKeywordForRotation: (keyword: string) => keyword,
  ensureStatusRefreshCoverage: vi.fn(),
}));
vi.mock("./china-market/arbitrage.js", () => ({
  refreshReadyCrossMarketOpportunitiesForItem: store.refreshOpportunities,
  refreshCrossMarketOpportunityForItem: vi.fn(),
}));

import { MercariAdapter } from "./adapters/mercari.adapter.js";
import { processSearch, processStatus } from "./processors.js";

function currentItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "listing-1",
    sourceId: "mercari-source",
    sourceItemId: "m123",
    sourceUrl: "https://jp.mercari.com/item/m123",
    titleRaw: "仮面ライダー SHF",
    status: "active",
    archivedAt: null,
    ignored: false,
    purchaseRecord: null,
    seller: null,
    sellerId: null,
    descriptionRaw: null,
    sourceData: null,
    listingType: "direct",
    auctionEndAt: null,
    priceCurrent: 4000,
    priceTotalEst: 4000,
    shippingFee: 0,
    bidCount: null,
    lastSeenAt: new Date("2026-10-07T00:00:00.000Z"),
    ...overrides,
  };
}

function job() {
  return {
    name: "refresh-status",
    data: {
      itemId: "listing-1",
      sourceItemId: "old-id",
      sourceUrl: "https://jp.mercari.com/item/old-id",
      status: "active",
      auctionEndAt: null,
      adapterKey: "mercari",
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.findUnique.mockResolvedValue(currentItem());
  store.update.mockResolvedValue({});
  store.updateMany.mockResolvedValue({ count: 1 });
  store.createPrice.mockResolvedValue({});
  store.sourceUpsert.mockResolvedValue({
    id: "mercari-source",
    circuitOpenAt: null,
    failureCount: 0,
  });
  store.sourceUpdate.mockResolvedValue({});
  store.createCrawl.mockResolvedValue({ id: "crawl-1" });
  store.updateCrawl.mockResolvedValue({});
  store.heartbeat.mockResolvedValue({ count: 1 });
  store.createAudit.mockResolvedValue({ id: "audit-1" });
  store.transaction.mockImplementation(async (action) => {
    if (typeof action !== "function") return Promise.all(action);
    return action({
      item: { findUnique: store.findUnique, updateMany: store.updateMany },
      manualReview: { create: store.createAudit },
      itemPriceHistory: { create: store.createPrice },
    });
  });
});

describe("search results cannot revive confirmed terminal listings", () => {
  it("publishes a partial terminal event when search-detail enrichment discovers a sold item", async () => {
    store.findMany.mockResolvedValue([currentItem()]);
    vi.spyOn(MercariAdapter.prototype, "search").mockResolvedValue([
      { sourceItemId: "m123", sourceUrl: "https://jp.mercari.com/item/m123" },
    ]);
    vi.spyOn(MercariAdapter.prototype, "fetchDetail").mockResolvedValue(
      {} as never,
    );
    vi.spyOn(MercariAdapter.prototype, "normalize").mockResolvedValue({
      status: "sold",
      listingType: "direct",
      priceCurrent: 3500,
      shippingFee: 0,
    } as never);
    await processSearch({
      name: "search",
      id: "job-1",
      opts: {},
      attemptsMade: 0,
      data: { adapterKey: "mercari", query: { keyword: "S.H.Figuarts" } },
    } as never);
    expect(store.createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor: "market-search",
        beforeData: expect.objectContaining({
          status: "active",
          priceCurrent: 4000,
        }),
        afterData: expect.objectContaining({
          status: "sold",
          priceCurrent: 3500,
          archivedAt: expect.any(String),
        }),
      }),
    });
    expect(store.updateMany.mock.calls[0][0].where).toMatchObject({
      purchaseRecord: null,
      archivedAt: null,
    });
  });
  it("writes the terminal state from a search hint without a detail fetch for a fully enriched listing", async () => {
    store.findMany.mockResolvedValue([
      currentItem({
        imageCount: 3,
        sourceData: { shippingStatus: "free" },
        descriptionRaw: "商品説明",
        sellerId: "seller-1",
      }),
    ]);
    vi.spyOn(MercariAdapter.prototype, "search").mockResolvedValue([
      {
        sourceItemId: "m123",
        sourceUrl: "https://jp.mercari.com/item/m123",
        detailHint: {
          titleRaw: "仮面ライダー SHF",
          status: "sold",
          priceCurrent: 3500,
          shippingFee: 0,
          listingType: "direct",
        } as never,
      },
    ]);
    const fetchDetail = vi
      .spyOn(MercariAdapter.prototype, "fetchDetail")
      .mockRejectedValue(new Error("must not fetch detail for a sold hint"));

    await processSearch({
      name: "search",
      id: "job-1",
      opts: {},
      attemptsMade: 0,
      data: { adapterKey: "mercari", query: { keyword: "S.H.Figuarts" } },
    } as never);

    expect(fetchDetail).not.toHaveBeenCalled();
    expect(store.createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor: "market-search",
        reason: "search_detail_confirmed_terminal",
        afterData: expect.objectContaining({
          status: "sold",
          priceCurrent: 3500,
        }),
      }),
    });
  });
  it("does not run a queued job after its keyword was disabled", async () => {
    store.keyword.mockResolvedValue({ enabled: false });
    const search = vi
      .spyOn(MercariAdapter.prototype, "search")
      .mockResolvedValue([]);
    await expect(
      processSearch({
        data: {
          adapterKey: "mercari",
          monitoringKeywordId: "keyword-1",
          query: { keyword: "old" },
        },
      } as never),
    ).resolves.toMatchObject({ skipped: "monitoring_keyword_disabled" });
    expect(search).not.toHaveBeenCalled();
  });
  it("uses the latest keyword and records existing listing provenance without reopening terminal state", async () => {
    store.keyword.mockResolvedValue({
      id: "keyword-1",
      keyword: "new-brand",
      normalizedKeyword: "new-brand",
      enabled: true,
      sourceKeys: [],
      category: { scope: "general" },
    });
    store.sourceUpsert.mockResolvedValue({
      id: "mercari-source",
      enabled: true,
      circuitOpenAt: null,
    });
    store.findMany.mockResolvedValue([currentItem({ status: "sold" })]);
    const search = vi
      .spyOn(MercariAdapter.prototype, "search")
      .mockResolvedValue([
        { sourceItemId: "m123", sourceUrl: "https://jp.mercari.com/item/m123" },
      ]);
    await processSearch({
      name: "search",
      id: "job-1",
      opts: {},
      attemptsMade: 0,
      data: {
        adapterKey: "mercari",
        monitoringKeywordId: "keyword-1",
        query: { keyword: "old-brand" },
      },
    } as never);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: "new-brand" }),
    );
    expect(store.recordMatch).toHaveBeenCalledWith(
      "listing-1",
      "keyword-1",
      "new-brand",
    );
    expect(
      store.createCrawl.mock.calls[0][0].data.query.monitoringKeywordId,
    ).toBe("keyword-1");
  });
  it("does not re-open a sold listing or refresh its verified timestamp from a stale search row", async () => {
    store.findMany.mockResolvedValue([currentItem({ status: "sold" })]);
    vi.spyOn(MercariAdapter.prototype, "search").mockResolvedValue([
      {
        sourceItemId: "m123",
        sourceUrl: "https://jp.mercari.com/item/m123",
        detailHint: { titleRaw: "仮面ライダー SHF", status: "active" } as never,
      },
    ]);
    vi.spyOn(MercariAdapter.prototype, "fetchDetail").mockRejectedValue(
      new Error("must not enrich sold"),
    );

    await processSearch({
      name: "search",
      id: "crawl-1",
      opts: {},
      attemptsMade: 0,
      data: { adapterKey: "mercari", query: { keyword: "S.H.Figuarts" } },
    } as never);

    for (const [query] of store.updateMany.mock.calls) {
      if (query.data.status === "active" || query.data.lastSeenAt) {
        expect(query.where).toMatchObject({
          archivedAt: null,
          status: { in: ["active", "unknown"] },
        });
      }
    }
    expect(MercariAdapter.prototype.fetchDetail).not.toHaveBeenCalled();
  });
});
afterEach(() => vi.restoreAllMocks());

describe("authoritative availability refresh", () => {
  it("archives a terminal seller-detail result instead of letting the enrichment write block final archival", async () => {
    store.findUnique.mockResolvedValue(currentItem());
    vi.spyOn(MercariAdapter.prototype, "refreshStatus").mockResolvedValue({
      status: "active",
    });
    vi.spyOn(MercariAdapter.prototype, "fetchDetail").mockResolvedValue(
      {} as never,
    );
    vi.spyOn(MercariAdapter.prototype, "normalize").mockResolvedValue({
      titleRaw: "仮面ライダー SHF",
      categoryToyType: "action_figure",
      status: "sold",
      priceCurrent: 4000,
      shippingFee: 0,
      listingType: "direct",
    } as never);
    const value = job() as unknown as { name: string };
    value.name = "backfill-public-seller-profile";
    await expect(processStatus(value as never)).resolves.toMatchObject({
      status: "sold",
    });
    expect(store.updateMany).toHaveBeenCalledTimes(1);
    expect(store.updateMany.mock.calls[0][0].data).toMatchObject({
      status: "sold",
      archivedAt: expect.any(Date),
    });
  });
  it("checks availability without using full-detail fallback or stale queue facts", async () => {
    store.findUnique.mockResolvedValue(currentItem());
    const detail = vi
      .spyOn(MercariAdapter.prototype, "fetchDetail")
      .mockRejectedValue(new Error("cached detail unavailable"));
    const refresh = vi
      .spyOn(MercariAdapter.prototype, "refreshStatus")
      .mockResolvedValue({ status: "sold", listingType: "direct" });

    await expect(processStatus(job())).resolves.toMatchObject({
      status: "sold",
    });

    expect(detail).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceItemId: "m123",
        sourceUrl: "https://jp.mercari.com/item/m123",
      }),
    );
    expect(store.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "sold",
          archivedAt: expect.any(Date),
        }),
        where: expect.objectContaining({
          archivedAt: null,
          purchaseRecord: null,
        }),
      }),
    );
    expect(store.createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        itemId: "listing-1",
        beforeData: expect.objectContaining({
          status: "active",
          archivedAt: null,
        }),
        afterData: expect.objectContaining({
          status: "sold",
          archivedAt: expect.any(String),
        }),
      }),
    });
    const audit = store.createAudit.mock.calls[0][0].data;
    expect(audit.beforeData).not.toHaveProperty("favorite");
    expect(audit.afterData).not.toHaveProperty("note");
    expect(store.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.anything(),
    );
  });

  it.each([
    { status: "sold" },
    { status: "ended" },
    { archivedAt: new Date() },
    { ignored: true },
    { purchaseRecord: { id: "purchase-1" } },
  ])(
    "cannot resurrect or overwrite an unavailable or purchased listing: %j",
    async (overrides) => {
      store.findUnique.mockResolvedValue(currentItem(overrides));
      const refresh = vi
        .spyOn(MercariAdapter.prototype, "refreshStatus")
        .mockResolvedValue({ status: "active" });
      vi.spyOn(MercariAdapter.prototype, "fetchDetail").mockRejectedValue(
        new Error("do not enrich"),
      );

      await expect(processStatus(job())).resolves.toMatchObject({
        skipped: "inactive_item",
      });
      expect(refresh).not.toHaveBeenCalled();
      expect(store.update).not.toHaveBeenCalled();
      expect(store.updateMany).not.toHaveBeenCalled();
    },
  );

  it("does not claim a successful check or archive a listing on an unknown page", async () => {
    store.findUnique.mockResolvedValue(currentItem());
    vi.spyOn(MercariAdapter.prototype, "refreshStatus").mockResolvedValue({
      status: "unknown",
    });
    vi.spyOn(MercariAdapter.prototype, "fetchDetail").mockRejectedValue(
      new Error("do not enrich"),
    );

    await expect(processStatus(job())).resolves.toMatchObject({
      status: "unknown",
    });
    const calls = [...store.update.mock.calls, ...store.updateMany.mock.calls];
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0].data).toMatchObject({ status: "unknown" });
    expect(calls[0]?.[0].data).not.toHaveProperty("lastSeenAt");
    expect(calls[0]?.[0].data).not.toHaveProperty("archivedAt");
  });

  it("does not publish price history or downstream opportunities if a purchase wins the race", async () => {
    store.findUnique.mockResolvedValue(currentItem());
    store.updateMany.mockResolvedValue({ count: 0 });
    vi.spyOn(MercariAdapter.prototype, "refreshStatus").mockResolvedValue({
      status: "sold",
      priceCurrent: 3000,
    });
    vi.spyOn(MercariAdapter.prototype, "fetchDetail").mockRejectedValue(
      new Error("do not enrich"),
    );

    await expect(processStatus(job())).resolves.toMatchObject({
      skipped: "item_changed",
    });
    expect(store.createPrice).not.toHaveBeenCalled();
    expect(store.refreshOpportunities).not.toHaveBeenCalled();
    expect(store.createAudit).not.toHaveBeenCalled();
  });

  it("clears a stale auction deadline after a confirmed switch to direct purchase", async () => {
    store.findUnique.mockResolvedValue(
      currentItem({
        listingType: "auction",
        auctionEndAt: new Date("2026-10-09T00:00:00Z"),
      }),
    );
    vi.spyOn(MercariAdapter.prototype, "refreshStatus").mockResolvedValue({
      status: "active",
      listingType: "direct",
    });
    await expect(processStatus(job())).resolves.toMatchObject({
      listingType: "direct",
      auctionEndAt: null,
    });
    expect(store.updateMany.mock.calls[0][0].data).toMatchObject({
      listingType: "direct",
      auctionEndAt: null,
    });
    expect(store.createAudit.mock.calls[0][0].data.afterData).toMatchObject({
      listingType: "direct",
      auctionEndAt: null,
    });
  });

  it("honors an explicit null deadline instead of reviving the old auction end", async () => {
    store.findUnique.mockResolvedValue(
      currentItem({
        listingType: "auction",
        auctionEndAt: new Date("2026-10-09T00:00:00Z"),
      }),
    );
    vi.spyOn(MercariAdapter.prototype, "refreshStatus").mockResolvedValue({
      status: "active",
      listingType: "auction",
      auctionEndAt: null,
    } as never);
    await expect(processStatus(job())).resolves.toMatchObject({
      auctionEndAt: null,
    });
    expect(store.updateMany.mock.calls[0][0].data.auctionEndAt).toBeNull();
  });

  it("preserves a previous deadline when a provider has no new deadline evidence", async () => {
    const deadline = new Date("2026-10-09T00:00:00Z");
    store.findUnique.mockResolvedValue(
      currentItem({ listingType: "auction", auctionEndAt: deadline }),
    );
    vi.spyOn(MercariAdapter.prototype, "refreshStatus").mockResolvedValue({
      status: "active",
      auctionEndAt: undefined,
    });
    await expect(processStatus(job())).resolves.toMatchObject({
      auctionEndAt: deadline,
      listingType: "auction",
    });
    expect(store.createAudit).not.toHaveBeenCalled();
  });

  it("rejects the refresh if the availability audit cannot commit", async () => {
    store.createAudit.mockRejectedValueOnce(new Error("audit unavailable"));
    vi.spyOn(MercariAdapter.prototype, "refreshStatus").mockResolvedValue({
      status: "sold",
      priceCurrent: 3000,
    });
    await expect(processStatus(job())).rejects.toThrow("audit unavailable");
    expect(store.createPrice).not.toHaveBeenCalled();
    expect(store.refreshOpportunities).not.toHaveBeenCalled();
  });
});

describe("deleted listings stay out of every worker path", () => {
  it("skips a status refresh for a deleted listing without probing the source", async () => {
    store.findUnique.mockResolvedValue(
      currentItem({ deletedAt: new Date("2026-10-08T00:00:00.000Z") }),
    );
    const refresh = vi
      .spyOn(MercariAdapter.prototype, "refreshStatus")
      .mockResolvedValue({ status: "active" });
    await expect(processStatus(job())).resolves.toEqual({
      skipped: "inactive_item",
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(store.updateMany).not.toHaveBeenCalled();
  });

  it("does not record a keyword match or revive a deleted listing from search", async () => {
    store.keyword.mockResolvedValue({
      id: "keyword-1",
      keyword: "new-brand",
      normalizedKeyword: "new-brand",
      enabled: true,
      sourceKeys: [],
      category: { scope: "general" },
    });
    store.findMany.mockResolvedValue([
      currentItem({
        status: "unknown",
        deletedAt: new Date("2026-10-08T00:00:00.000Z"),
      }),
    ]);
    vi.spyOn(MercariAdapter.prototype, "search").mockResolvedValue([
      {
        sourceItemId: "m123",
        sourceUrl: "https://jp.mercari.com/item/m123",
        detailHint: { status: "active" } as never,
      } as never,
    ]);
    await processSearch({
      name: "search",
      id: "job-1",
      opts: {},
      attemptsMade: 0,
      data: {
        adapterKey: "mercari",
        monitoringKeywordId: "keyword-1",
        query: { keyword: "old-brand" },
      },
    } as never);
    expect(store.recordMatch).not.toHaveBeenCalled();
    expect(store.createAudit).not.toHaveBeenCalled();
    expect(store.updateMany).not.toHaveBeenCalled();
  });
});
