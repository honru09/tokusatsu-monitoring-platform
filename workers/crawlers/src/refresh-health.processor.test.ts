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
  statusAdd: vi.fn(),
  statusGetJob: vi.fn(),
  connectionGet: vi.fn(),
  connectionSet: vi.fn(),
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
  connection: { get: store.connectionGet, set: store.connectionSet },
  classificationQueue: {},
  statusQueue: { add: store.statusAdd, getJob: store.statusGetJob },
  marketKeywordForRotation: (keyword: string) => keyword,
  ensureStatusRefreshCoverage: vi.fn(),
}));
vi.mock("./china-market/arbitrage.js", () => ({
  refreshReadyCrossMarketOpportunitiesForItem: store.refreshOpportunities,
  refreshCrossMarketOpportunityForItem: vi.fn(),
}));

import { MercariAdapter } from "./adapters/mercari.adapter.js";
import {
  expireStaleDirectListings,
  processSearch,
  processStatus,
  recordSearchAbsences,
  scheduleForcedStatusRecheck,
  statusUpdateFromDetail,
} from "./processors.js";

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
    lastCheckedAt: null,
    refreshFailureCount: 0,
    consecutiveAbsenceCount: 0,
    ...overrides,
  };
}

function statusJob(data: Record<string, unknown> = {}) {
  return {
    name: "refresh-status",
    data: {
      itemId: "listing-1",
      sourceItemId: "m123",
      sourceUrl: "https://jp.mercari.com/item/m123",
      status: "active",
      auctionEndAt: null,
      adapterKey: "mercari",
      ...data,
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.STATUS_REFRESH_DETAIL_ESCALATION_FAILURES;
  store.findUnique.mockResolvedValue(currentItem());
  store.update.mockResolvedValue({});
  store.updateMany.mockResolvedValue({ count: 1 });
  store.createPrice.mockResolvedValue({});
  store.refreshOpportunities.mockResolvedValue(undefined);
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
  store.statusAdd.mockResolvedValue({});
  store.statusGetJob.mockResolvedValue(null);
  store.connectionGet.mockResolvedValue(null);
  store.connectionSet.mockResolvedValue("OK");
  store.transaction.mockImplementation(async (action) => {
    if (typeof action !== "function") return Promise.all(action);
    return action({
      item: { findUnique: store.findUnique, updateMany: store.updateMany },
      manualReview: { create: store.createAudit },
      itemPriceHistory: { create: store.createPrice },
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.STATUS_REFRESH_DETAIL_ESCALATION_FAILURES;
});

describe("status refresh health", () => {
  it("stays on the cheap probe below the escalation threshold and stamps a completed check", async () => {
    store.findUnique.mockResolvedValue(currentItem({ refreshFailureCount: 2 }));
    const refresh = vi
      .spyOn(MercariAdapter.prototype, "refreshStatus")
      .mockResolvedValue({ status: "active" });
    const detail = vi
      .spyOn(MercariAdapter.prototype, "fetchDetail")
      .mockRejectedValue(new Error("detail must not run"));

    await expect(processStatus(statusJob())).resolves.toMatchObject({
      status: "active",
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(detail).not.toHaveBeenCalled();
    expect(store.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "active",
          refreshFailureCount: 0,
          lastCheckedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("counts a failed probe and rethrows the original error", async () => {
    store.findUnique.mockResolvedValue(currentItem({ refreshFailureCount: 2 }));
    vi.spyOn(MercariAdapter.prototype, "refreshStatus").mockRejectedValue(
      new Error("probe exploded"),
    );

    await expect(processStatus(statusJob())).rejects.toThrow("probe exploded");

    expect(store.updateMany).toHaveBeenCalledTimes(1);
    expect(store.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          refreshFailureCount: 3,
          lastCheckedAt: expect.any(Date),
        },
      }),
    );
    expect(store.createAudit).not.toHaveBeenCalled();
  });

  it("escalates to the detail path once the failure threshold is reached", async () => {
    store.findUnique.mockResolvedValue(currentItem({ refreshFailureCount: 3 }));
    const refresh = vi
      .spyOn(MercariAdapter.prototype, "refreshStatus")
      .mockResolvedValue({ status: "active" });
    vi.spyOn(MercariAdapter.prototype, "fetchDetail").mockResolvedValue(
      {} as never,
    );
    vi.spyOn(MercariAdapter.prototype, "normalize").mockResolvedValue({
      status: "sold",
      listingType: "direct",
      priceCurrent: 3500,
      shippingFee: 0,
      auctionEndAt: null,
      bidCount: null,
    } as never);

    await expect(processStatus(statusJob())).resolves.toMatchObject({
      status: "sold",
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(store.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "sold",
          archivedAt: expect.any(Date),
          refreshFailureCount: 0,
          lastCheckedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("takes the detail path for a forced recheck even with no failures", async () => {
    store.findUnique.mockResolvedValue(currentItem({ refreshFailureCount: 0 }));
    const refresh = vi
      .spyOn(MercariAdapter.prototype, "refreshStatus")
      .mockResolvedValue({ status: "active" });
    vi.spyOn(MercariAdapter.prototype, "fetchDetail").mockResolvedValue(
      {} as never,
    );
    vi.spyOn(MercariAdapter.prototype, "normalize").mockResolvedValue({
      status: "ended",
      listingType: "direct",
      priceCurrent: 4000,
      shippingFee: 0,
      auctionEndAt: null,
      bidCount: null,
    } as never);

    await expect(
      processStatus(statusJob({ forceDetail: true })),
    ).resolves.toMatchObject({ status: "ended" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("honours the escalation threshold env override", async () => {
    process.env.STATUS_REFRESH_DETAIL_ESCALATION_FAILURES = "1";
    store.findUnique.mockResolvedValue(currentItem({ refreshFailureCount: 1 }));
    const refresh = vi
      .spyOn(MercariAdapter.prototype, "refreshStatus")
      .mockResolvedValue({ status: "active" });
    vi.spyOn(MercariAdapter.prototype, "fetchDetail").mockResolvedValue(
      {} as never,
    );
    vi.spyOn(MercariAdapter.prototype, "normalize").mockResolvedValue({
      status: "active",
      listingType: "direct",
      priceCurrent: 4000,
      shippingFee: 0,
      auctionEndAt: null,
      bidCount: null,
    } as never);

    await processStatus(statusJob());
    expect(refresh).not.toHaveBeenCalled();
  });

  it("leaves the status untouched when the detail path cannot resolve it, but still stamps the check", async () => {
    store.findUnique.mockResolvedValue(currentItem({ refreshFailureCount: 5 }));
    vi.spyOn(MercariAdapter.prototype, "fetchDetail").mockResolvedValue(
      {} as never,
    );
    vi.spyOn(MercariAdapter.prototype, "normalize").mockResolvedValue({
      status: "unknown",
      listingType: "direct",
      priceCurrent: 4000,
      shippingFee: 0,
    } as never);

    await expect(processStatus(statusJob())).resolves.toMatchObject({
      status: "active",
      detailRefresh: true,
      inconclusive: true,
    });
    expect(store.updateMany).toHaveBeenCalledTimes(1);
    expect(store.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          refreshFailureCount: 0,
          lastCheckedAt: expect.any(Date),
        },
      }),
    );
    expect(store.createAudit).not.toHaveBeenCalled();
  });

  it("counts a failed detail attempt the same way as a failed probe", async () => {
    store.findUnique.mockResolvedValue(currentItem({ refreshFailureCount: 5 }));
    vi.spyOn(MercariAdapter.prototype, "fetchDetail").mockRejectedValue(
      new Error("detail exploded"),
    );

    await expect(processStatus(statusJob())).rejects.toThrow("detail exploded");
    expect(store.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          refreshFailureCount: 6,
          lastCheckedAt: expect.any(Date),
        },
      }),
    );
  });
});

describe("statusUpdateFromDetail", () => {
  it("maps a conclusive detail result onto the status update shape", () => {
    expect(
      statusUpdateFromDetail({
        status: "sold",
        listingType: "direct",
        priceCurrent: 3500,
        shippingFee: 200,
        auctionEndAt: null,
        bidCount: 4,
      } as never),
    ).toEqual({
      status: "sold",
      listingType: "direct",
      priceCurrent: 3500,
      shippingFee: 200,
      auctionEndAt: null,
      bidCount: 4,
    });
  });

  it("returns null for an inconclusive detail result", () => {
    expect(
      statusUpdateFromDetail({
        status: "unknown",
        listingType: "direct",
        priceCurrent: 3500,
      } as never),
    ).toBeNull();
  });
});

describe("forced status recheck scheduling", () => {
  it("queues a distinct force-detail job", async () => {
    await scheduleForcedStatusRecheck({
      id: "listing-9",
      sourceItemId: "m999",
      sourceUrl: "https://jp.mercari.com/item/m999",
      status: "unknown",
      auctionEndAt: null,
      adapterKey: "mercari",
    });
    expect(store.statusAdd).toHaveBeenCalledWith(
      "refresh-status",
      expect.objectContaining({ itemId: "listing-9", forceDetail: true }),
      expect.objectContaining({ jobId: "status-force-detail-listing-9" }),
    );
  });

  it("does not queue a second copy while one is already waiting", async () => {
    store.statusGetJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue("waiting"),
      remove: vi.fn(),
    });
    await scheduleForcedStatusRecheck({
      id: "listing-9",
      sourceItemId: "m999",
      sourceUrl: "https://jp.mercari.com/item/m999",
      status: "unknown",
      auctionEndAt: null,
      adapterKey: "mercari",
    });
    expect(store.statusAdd).not.toHaveBeenCalled();
  });
});

describe("recordSearchAbsences", () => {
  it("increments absent listings without re-queueing past the threshold", async () => {
    store.findMany.mockImplementation(async (args: { where?: { id?: { gt?: string } } }) =>
      args.where?.id?.gt
        ? []
        : [
            {
              id: "listing-3",
              sourceItemId: "m333",
              sourceUrl: "https://jp.mercari.com/item/m333",
              status: "unknown",
              auctionEndAt: null,
              consecutiveAbsenceCount: 3,
            },
          ],
    );

    const totals = await recordSearchAbsences({
      sourceId: "mercari-source",
      adapterKey: "mercari",
      presentSourceItemIds: new Set<string>(),
    });

    expect(totals).toEqual({
      absentIncremented: 1,
      presentReset: 0,
      rechecksQueued: 0,
    });
    expect(store.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { consecutiveAbsenceCount: 4 } }),
    );
    expect(store.statusAdd).not.toHaveBeenCalled();
  });
});

describe("processSearch absence integration", () => {
  function knownSearchItem(overrides: Record<string, unknown> = {}) {
    return currentItem({
      imageCount: 3,
      sourceData: { shippingStatus: "free" },
      descriptionRaw: "商品説明",
      shippingFee: 0,
      sellerId: "seller-1",
      seller: {
        name: "Some Shop",
        sourceSellerId: "seller-1",
        profileUrl: "https://jp.mercari.com/user/profile/1",
        sourceData: {},
      },
      ...overrides,
    });
  }

  function mockSearchFindMany(absenceBatch: unknown[]) {
    store.findMany.mockImplementation(
      async (args: { where?: Record<string, unknown> }) => {
        const where = args.where ?? {};
        if (where.sourceItemId) return [knownSearchItem()];
        if ((where.id as { gt?: string } | undefined)?.gt) return [];
        return absenceBatch;
      },
    );
  }

  it("counts absences and queues one forced recheck on a non-rotating backfill pass", async () => {
    mockSearchFindMany([
      {
        id: "listing-1",
        sourceItemId: "m123",
        sourceUrl: "https://jp.mercari.com/item/m123",
        status: "active",
        auctionEndAt: null,
        consecutiveAbsenceCount: 2,
      },
      {
        id: "listing-2",
        sourceItemId: "m999",
        sourceUrl: "https://jp.mercari.com/item/m999",
        status: "unknown",
        auctionEndAt: null,
        consecutiveAbsenceCount: 1,
      },
    ]);
    vi.spyOn(MercariAdapter.prototype, "search").mockResolvedValue([
      { sourceItemId: "m123", sourceUrl: "https://jp.mercari.com/item/m123" },
    ]);

    const metrics = await processSearch({
      name: "search",
      id: "job-1",
      opts: {},
      attemptsMade: 0,
      data: {
        adapterKey: "mercari",
        query: { keyword: "仮面ライダー", scanMode: "backfill" },
      },
    } as never);

    expect(metrics).toMatchObject({
      absentIncremented: 1,
      absencePresentReset: 1,
      absenceRechecksQueued: 1,
    });
    expect(store.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { consecutiveAbsenceCount: 0 } }),
    );
    expect(store.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { consecutiveAbsenceCount: 2 } }),
    );
    expect(store.statusAdd).toHaveBeenCalledTimes(1);
    expect(store.statusAdd).toHaveBeenCalledWith(
      "refresh-status",
      expect.objectContaining({ itemId: "listing-2", forceDetail: true }),
      expect.objectContaining({ jobId: "status-force-detail-listing-2" }),
    );
  });

  it("does not count absences on a rotating backfill pass", async () => {
    mockSearchFindMany([]);
    vi.spyOn(MercariAdapter.prototype, "search").mockResolvedValue([
      { sourceItemId: "m123", sourceUrl: "https://jp.mercari.com/item/m123" },
    ]);

    const metrics = await processSearch({
      name: "search",
      id: "job-1",
      opts: {},
      attemptsMade: 0,
      data: {
        adapterKey: "mercari",
        query: {
          keyword: "仮面ライダー",
          scanMode: "backfill",
          rotatePages: true,
          pages: 2,
        },
      },
    } as never);

    expect(metrics).toMatchObject({
      absentIncremented: 0,
      absenceRechecksQueued: 0,
    });
    // Only the lookup of listings returned by the scan itself may run.
    expect(store.findMany).toHaveBeenCalledTimes(1);
    expect(store.statusAdd).not.toHaveBeenCalled();
  });
});

describe("expireStaleDirectListings", () => {
  it("ends only the stale direct listing and leaves the rest alone", async () => {
    const now = new Date("2026-10-25T00:00:00.000Z");
    const staleSeen = new Date(now.getTime() - 100 * 60 * 60_000);
    const base = {
      status: "unknown",
      listingType: "direct",
      lastSeenAt: staleSeen,
      consecutiveAbsenceCount: 3,
    };
    store.findMany.mockImplementation(
      async (args: { where?: { id?: { gt?: string } } }) =>
        args.where?.id?.gt
          ? []
          : [
              { ...base, id: "ttl-stale" },
              { ...base, id: "ttl-auction", listingType: "auction" },
              { ...base, id: "ttl-active", status: "active" },
              { ...base, id: "ttl-seen-once", consecutiveAbsenceCount: 1 },
              {
                ...base,
                id: "ttl-fresh",
                lastSeenAt: new Date(now.getTime() - 60 * 60_000),
              },
            ],
    );
    store.findUnique.mockResolvedValue({
      id: "ttl-stale",
      updatedAt: new Date("2026-10-20T00:00:00.000Z"),
      status: "unknown",
      archivedAt: null,
      auctionEndAt: null,
      listingType: "direct",
      priceCurrent: 1000,
      shippingFee: 0,
      priceTotalEst: 1000,
      bidCount: null,
    });

    await expect(expireStaleDirectListings(now, {})).resolves.toBe(1);

    expect(store.createAudit).toHaveBeenCalledTimes(1);
    expect(store.createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        itemId: "ttl-stale",
        actor: "inventory-maintenance",
        reason: "direct_listing_ttl_expired",
        afterData: expect.objectContaining({
          status: "ended",
          archivedAt: now.toISOString(),
        }),
      }),
    });
  });
});
