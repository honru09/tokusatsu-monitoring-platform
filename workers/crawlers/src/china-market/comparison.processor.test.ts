import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sourceUpsert: vi.fn(),
  productFindUnique: vi.fn(),
  productFindMany: vi.fn(),
  comparisonUpsert: vi.fn(),
  comparisonUpdate: vi.fn(),
  comparisonUpdateMany: vi.fn(),
  comparisonUpdateManyTx: vi.fn(),
  comparisonFindMany: vi.fn(),
  comparisonFindFirst: vi.fn(),
  offerUpsert: vi.fn(),
  offerUpdateMany: vi.fn(),
  offerDeleteMany: vi.fn(),
  offerFindMany: vi.fn(),
  opportunityUpdateMany: vi.fn(),
  runCreate: vi.fn(),
  runUpdateMany: vi.fn(),
  transaction: vi.fn(),
  queueAdd: vi.fn(),
  queueGetJob: vi.fn(),
  search: vi.fn(),
  enabled: vi.fn(),
  keywords: vi.fn(),
  decisions: vi.fn(),
  evaluateArbitrage: vi.fn(),
}));

vi.mock("@tokusatsu/db", () => ({
  prisma: {
    source: { upsert: mocks.sourceUpsert },
    product: {
      findUnique: mocks.productFindUnique,
      findMany: mocks.productFindMany,
    },
    productMarketComparison: {
      upsert: mocks.comparisonUpsert,
      update: mocks.comparisonUpdate,
      updateMany: mocks.comparisonUpdateMany,
      findMany: mocks.comparisonFindMany,
    },
    comparisonOffer: {
      upsert: mocks.offerUpsert,
      updateMany: mocks.offerUpdateMany,
      deleteMany: mocks.offerDeleteMany,
      findMany: mocks.offerFindMany,
    },
    crossMarketOpportunity: {
      updateMany: mocks.opportunityUpdateMany,
    },
    chinaMarketComparisonRun: {
      create: mocks.runCreate,
      updateMany: mocks.runUpdateMany,
    },
    $transaction: mocks.transaction,
  },
  Prisma: { InputJsonValue: undefined },
}));

vi.mock("../queues.js", () => ({
  chinaMarketComparisonQueue: {
    add: mocks.queueAdd,
    getJob: mocks.queueGetJob,
  },
}));

vi.mock("./xianyu.provider.js", () => ({
  searchXianyuOffers: mocks.search,
  xianyuMarketProvider: {
    search: async (...args: Parameters<typeof mocks.search>) => {
      const value = await mocks.search(...args);
      if (Array.isArray(value))
        return {
          offers: value.map((offer) => ({
            ...offer,
            provenance: offer.provenance ?? {
              providerKey: "search_api",
              queryKeyword: Array.isArray(args[0]) ? args[0][0] : "",
            },
          })),
          complete: true,
          stats: {
            requestedKeywords: Array.isArray(args[0]) ? args[0].length : 0,
            attemptedKeywords: Array.isArray(args[0]) ? args[0].length : 0,
            rejectedRows: 0,
          },
        };
      return value;
    },
  },
  stableComparisonJobId: (id: string) => `stable-${id}`,
  xianyuComparisonEnabled: mocks.enabled,
}));

vi.mock("./ai.js", () => ({
  generateChineseSearchKeywords: mocks.keywords,
  decideChinaCandidates: mocks.decisions,
}));

vi.mock("./arbitrage.js", () => ({
  evaluateAndScheduleCrossMarketArbitrage: mocks.evaluateArbitrage,
}));

import {
  dispatchChinaMarketComparisons,
  processChinaMarketComparison,
  refreshChinaMarketComparison,
} from "./comparison.processor.js";

const product = {
  id: "product-1",
  canonicalName: "仮面ライダー555 DXファイズドライバー SB-555B",
  normalizedName: "仮面ライダー555 dxファイズドライバー sb 555b",
  titleZh: "假面骑士555 DX Faiz驱动器 SB-555B",
  productLine: "DX",
  modelNumber: "SB-555B",
  releaseYear: 2003,
  franchise: { nameZh: "假面骑士", nameJa: "仮面ライダー", nameEn: null },
  series: { nameZh: "假面骑士555", nameJa: "仮面ライダー555", nameEn: null },
  manufacturerEntity: { nameZh: "万代", nameJa: "BANDAI", nameEn: null },
  toyTypeEntity: { nameZh: "变身腰带", nameJa: "変身ベルト", nameEn: null },
  listings: [
    {
      titleRaw: "仮面ライダー555 DXファイズドライバー SB-555B",
      titleZh: "假面骑士555 DX Faiz驱动器 SB-555B",
      descriptionRaw: "完整商品",
      quantityEst: 1,
      images: [{ url: "https://images.example.test/jp.jpg" }],
    },
  ],
};

const offers = [
  {
    platform: "xianyu" as const,
    sourceListingId: "offer-1",
    sourceUrl: "https://www.goofish.com/item?id=offer-1",
    titleRaw: "假面骑士555 DX Faiz驱动器 SB-555B",
    priceCny: 600,
    imageUrl: "https://images.example.test/cn-1.jpg",
    status: "active" as const,
  },
  {
    platform: "xianyu" as const,
    sourceListingId: "offer-2",
    sourceUrl: "https://www.goofish.com/item?id=offer-2",
    titleRaw: "万代 假面骑士555 DX Faiz驱动器 SB-555B",
    priceCny: 620,
    imageUrl: "https://images.example.test/cn-2.jpg",
    status: "active" as const,
  },
  {
    platform: "xianyu" as const,
    sourceListingId: "offer-3",
    sourceUrl: "https://www.goofish.com/item?id=offer-3",
    titleRaw: "假面骑士555 DX Faiz驱动器 SB-555B",
    priceCny: 640,
    imageUrl: "https://images.example.test/cn-3.jpg",
    status: "active" as const,
  },
];

function transactionClient() {
  return {
    productMarketComparison: {
      upsert: mocks.comparisonUpsert,
      findFirst: mocks.comparisonFindFirst,
      updateMany: mocks.comparisonUpdateManyTx,
    },
    comparisonOffer: {
      upsert: mocks.offerUpsert,
      updateMany: mocks.offerUpdateMany,
      deleteMany: mocks.offerDeleteMany,
      findMany: mocks.offerFindMany,
    },
    crossMarketOpportunity: {
      updateMany: mocks.opportunityUpdateMany,
    },
    chinaMarketComparisonRun: {
      create: mocks.runCreate,
      updateMany: mocks.runUpdateMany,
    },
  };
}

function committedAuditWrites() {
  const committed: string[] = [];
  mocks.transaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) => {
      const staged: string[] = [];
      const tx = transactionClient();
      const result = await callback({
        ...tx,
        productMarketComparison: {
          ...tx.productMarketComparison,
          updateMany: (...args: unknown[]) => {
            const data = (args[0] as { data: { status?: string } }).data;
            staged.push(data.status ? `summary:${data.status}` : "lease");
            return mocks.comparisonUpdateManyTx(...args);
          },
        },
        comparisonOffer: {
          ...tx.comparisonOffer,
          upsert: (...args: unknown[]) => {
            staged.push("offer");
            return mocks.offerUpsert(...args);
          },
        },
        chinaMarketComparisonRun: {
          create: (...args: unknown[]) => {
            staged.push("run:refreshing");
            return mocks.runCreate(...args);
          },
          updateMany: (...args: unknown[]) => {
            staged.push(
              `run:${(args[0] as { data: { status: string } }).data.status}`,
            );
            return mocks.runUpdateMany(...args);
          },
        },
      });
      committed.push(...staged);
      return result;
    },
  );
  return committed;
}

function installDefaults() {
  mocks.enabled.mockReturnValue(true);
  mocks.sourceUpsert.mockResolvedValue({ id: "source-xianyu" });
  mocks.productFindUnique.mockResolvedValue(product);
  mocks.comparisonUpsert.mockResolvedValue({ id: "comparison-1" });
  mocks.comparisonUpdate.mockResolvedValue({});
  mocks.comparisonUpdateMany.mockResolvedValue({ count: 1 });
  mocks.comparisonUpdateManyTx.mockResolvedValue({ count: 1 });
  mocks.comparisonFindMany.mockResolvedValue([]);
  mocks.comparisonFindFirst.mockResolvedValue({ id: "comparison-1" });
  mocks.productFindMany.mockResolvedValue([]);
  mocks.offerUpsert.mockResolvedValue({});
  mocks.offerUpdateMany.mockResolvedValue({ count: 0 });
  mocks.offerDeleteMany.mockResolvedValue({ count: 0 });
  mocks.offerFindMany.mockResolvedValue([]);
  mocks.opportunityUpdateMany.mockResolvedValue({ count: 0 });
  mocks.runCreate.mockResolvedValue({ id: "run-1" });
  mocks.runUpdateMany.mockResolvedValue({ count: 1 });
  mocks.queueGetJob.mockResolvedValue(null);
  mocks.transaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(transactionClient()),
  );
  mocks.search.mockResolvedValue(offers);
  mocks.keywords.mockImplementation(
    async (_reference: unknown, fallback: string[]) => fallback,
  );
  mocks.decisions.mockResolvedValue(
    offers.map((offer) => ({
      sourceListingId: offer.sourceListingId,
      sameProduct: true,
      confidence: 0.95,
      accessoryOnly: false,
      damaged: false,
      quantityConflict: false,
      modelConflict: false,
      versionConflict: false,
      scaleConflict: false,
      evidence: ["型号一致"],
    })),
  );
  mocks.evaluateArbitrage.mockResolvedValue({
    opportunities: { ready: 1, rejected: 0, needsFacts: 0, skipped: 0 },
    reverseSearch: { scheduled: 4 },
  });
}

beforeEach(() => {
  process.env.CHINA_MARKET_COMPARISON_ENABLED = "true";
  process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
  process.env.XIANYU_COMPARISON_ENABLED = "true";
  process.env.XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED = "true";
  process.env.XIANYU_REVERSE_SEARCH_ENABLED = "true";
  process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
  vi.clearAllMocks();
  installDefaults();
});

afterEach(() => {
  for (const key of [
    "BACKGROUND_AI_PAID_AUTOMATION_ENABLED",
    "CHINA_MARKET_COMPARISON_ENABLED",
    "CHINA_MARKET_COMPARISON_AUTHORIZED",
    "XIANYU_COMPARISON_ENABLED",
    "XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED",
    "XIANYU_REVERSE_SEARCH_ENABLED",
    "XIANYU_SEARCH_API_URL",
    "XIANYU_COMPARISON_INTERVAL_MS",
    "XIANYU_COMPARISON_MAX_KEYWORDS",
    "XIANYU_COMPARISON_MAX_STORED_OFFERS",
  ])
    delete process.env[key];
  vi.restoreAllMocks();
});

describe("China market comparison processor", () => {
  it("runs the authorized comparison path without paid AI automation", async () => {
    process.env.BACKGROUND_AI_PAID_AUTOMATION_ENABLED = "false";

    await expect(dispatchChinaMarketComparisons()).resolves.toEqual({
      scheduled: 0,
      alreadyQueued: 0,
      scheduledByCohort: { due: 0, new: 0 },
      sourceId: "source-xianyu",
    });
    await expect(
      processChinaMarketComparison({ name: "dispatch-due", data: {} } as never),
    ).resolves.toMatchObject({ sourceId: "source-xianyu" });
    await expect(
      refreshChinaMarketComparison("product-1"),
    ).resolves.toMatchObject({ status: "ready", matchedCount: 3 });

    expect(mocks.sourceUpsert).toHaveBeenCalled();
    expect(mocks.search).toHaveBeenCalled();
  });

  it("rolls back the lease when the started audit cannot be persisted", async () => {
    const committed = committedAuditWrites();
    mocks.runCreate.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(refreshChinaMarketComparison("product-1")).rejects.toThrow(
      "audit unavailable",
    );
    expect(committed).toEqual([]);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("rolls back offers and the ready summary if its run cannot be completed", async () => {
    const committed = committedAuditWrites();
    mocks.runUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(refreshChinaMarketComparison("product-1")).rejects.toThrow(
      "lease was superseded",
    );
    expect(committed).toEqual([
      "lease",
      "run:refreshing",
      "summary:failed",
      "run:failed",
    ]);
    expect(mocks.queueAdd).not.toHaveBeenCalled();
    expect(mocks.runUpdateMany.mock.calls.at(-1)?.[0].data).toMatchObject({
      status: "failed",
      candidateCount: 3,
      matchedCount: 3,
      referencePriceCny: null,
      referenceUrl: null,
      providerStats: expect.objectContaining({ complete: true }),
    });
  });

  it("rolls back publication after losing the token and never completes another attempt", async () => {
    const committed = committedAuditWrites();
    mocks.comparisonUpdateManyTx.mockImplementation(
      async ({ data }: { data: { status?: string } }) => ({
        count: data.status ? 0 : 1,
      }),
    );
    await expect(refreshChinaMarketComparison("product-1")).rejects.toThrow(
      "lease was superseded",
    );
    expect(committed).not.toContain("offer");
    expect(committed).not.toContain("summary:ready");
    expect(committed).not.toContain("run:ready");
    const ownToken = mocks.runCreate.mock.calls[0]![0].data.refreshToken;
    for (const [call] of mocks.runUpdateMany.mock.calls)
      expect(call.where).toMatchObject({
        refreshToken: ownToken,
        status: "refreshing",
        completedAt: null,
      });
  });

  it("does not relabel an immutable completed run when post-publication queueing fails", async () => {
    mocks.queueAdd.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(refreshChinaMarketComparison("product-1")).rejects.toThrow(
      "queue unavailable",
    );
    expect(mocks.runUpdateMany).toHaveBeenCalledOnce();
    expect(mocks.runUpdateMany.mock.calls[0]![0].data.status).toBe("ready");
    expect(
      mocks.comparisonUpdateManyTx.mock.calls.some(
        ([call]) => call.data.status === "failed",
      ),
    ).toBe(false);
  });

  it("records started and ready audit snapshots in the same publication transaction as offers and summary", async () => {
    let transactionId = 0;
    const writes: Array<{ transactionId: number; kind: string }> = [];
    mocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => {
        transactionId += 1;
        const current = transactionId;
        const tx = transactionClient();
        return callback({
          ...tx,
          comparisonOffer: {
            ...tx.comparisonOffer,
            upsert: (...args: unknown[]) => {
              writes.push({ transactionId: current, kind: "offer" });
              return mocks.offerUpsert(...args);
            },
          },
          productMarketComparison: {
            ...tx.productMarketComparison,
            updateMany: (...args: unknown[]) => {
              if (
                (args[0] as { data: { status?: string } }).data.status ===
                "ready"
              )
                writes.push({ transactionId: current, kind: "summary" });
              return mocks.comparisonUpdateManyTx(...args);
            },
          },
          chinaMarketComparisonRun: {
            ...tx.chinaMarketComparisonRun,
            updateMany: (...args: unknown[]) => {
              if (
                (args[0] as { data: { status?: string } }).data.status ===
                "ready"
              )
                writes.push({ transactionId: current, kind: "run" });
              return mocks.runUpdateMany(...args);
            },
          },
        });
      },
    );
    await refreshChinaMarketComparison("product-1");
    expect(mocks.runCreate).toHaveBeenCalledOnce();
    const started = mocks.runCreate.mock.calls[0]![0].data;
    expect(started).toMatchObject({
      comparisonId: "comparison-1",
      status: "refreshing",
      startedAt: expect.any(Date),
    });
    expect(mocks.runCreate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.search.mock.invocationCallOrder[0]!,
    );
    const summary = mocks.comparisonUpdateManyTx.mock.calls.at(-1)![0].data;
    const completed = mocks.runUpdateMany.mock.calls.at(-1)![0];
    expect(completed.where).toMatchObject({
      comparisonId: "comparison-1",
      refreshToken: started.refreshToken,
      status: "refreshing",
      completedAt: null,
    });
    for (const field of [
      "status",
      "searchKeywords",
      "candidateCount",
      "matchedCount",
      "referencePriceCny",
      "referenceUrl",
      "comparisonMethod",
      "providerStats",
      "observedAt",
    ])
      expect(completed.data[field]).toEqual(summary[field]);
    expect(completed.data).toMatchObject({
      status: "ready",
      completedAt: expect.any(Date),
      sanitizedError: null,
    });
    expect(new Set(writes.map((write) => write.transactionId)).size).toBe(1);
    expect(writes.map((write) => write.kind)).toEqual([
      "offer",
      "offer",
      "offer",
      "summary",
      "run",
    ]);
  });

  it("records a failed attempt without persisting raw credentials or provider response text", async () => {
    const unsafe =
      "provider unavailable Authorization: Bearer secret-token Cookie: sid=private-session https://private.example.test?api_key=private-key seller=private-seller";
    mocks.search.mockRejectedValueOnce(new Error(unsafe));
    await expect(refreshChinaMarketComparison("product-1")).rejects.toThrow(
      "provider unavailable",
    );
    const started = mocks.runCreate.mock.calls[0]?.[0].data;
    const failed = mocks.runUpdateMany.mock.calls.at(-1)?.[0];
    expect(failed).toMatchObject({
      where: {
        comparisonId: "comparison-1",
        refreshToken: started?.refreshToken,
        status: "refreshing",
        completedAt: null,
      },
      data: {
        status: "failed",
        completedAt: expect.any(Date),
        candidateCount: 0,
        matchedCount: 0,
        sanitizedError: expect.any(String),
      },
    });
    const persisted = JSON.stringify([
      failed,
      mocks.comparisonUpdateManyTx.mock.calls.at(-1)?.[0].data,
    ]);
    for (const secret of [
      "secret-token",
      "private-session",
      "private.example.test",
      "private-key",
      "private-seller",
    ])
      expect(persisted).not.toContain(secret);
    expect(mocks.offerUpsert).not.toHaveBeenCalled();
  });

  it("records successful insufficient evidence as a completed run, not a fake ready result", async () => {
    mocks.search.mockResolvedValueOnce([]);
    await expect(
      refreshChinaMarketComparison("product-1"),
    ).resolves.toMatchObject({ status: "insufficient" });
    expect(mocks.runUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "insufficient",
          candidateCount: 0,
          matchedCount: 0,
          referencePriceCny: null,
          referenceUrl: null,
          completedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("does not start an audit or query the provider when another refresh owns the lease", async () => {
    mocks.comparisonUpdateMany.mockResolvedValueOnce({ count: 0 });
    mocks.comparisonUpdateManyTx.mockResolvedValueOnce({ count: 0 });
    await expect(
      refreshChinaMarketComparison("product-1"),
    ).resolves.toMatchObject({ skipped: "refresh_already_in_progress" });
    expect(mocks.runCreate).not.toHaveBeenCalled();
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("finalizes only its own failed run when its publication lease was superseded", async () => {
    mocks.comparisonFindFirst.mockResolvedValueOnce(null);
    await expect(refreshChinaMarketComparison("product-1")).rejects.toThrow(
      "lease was superseded",
    );
    const started = mocks.runCreate.mock.calls[0]?.[0].data;
    expect(mocks.runUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          comparisonId: "comparison-1",
          refreshToken: started?.refreshToken,
          status: "refreshing",
          completedAt: null,
        },
        data: expect.objectContaining({
          status: "failed",
          sanitizedError: expect.stringContaining("lease"),
        }),
      }),
    );
    expect(mocks.offerUpsert).not.toHaveBeenCalled();
    expect(mocks.queueAdd).not.toHaveBeenCalled();
  });

  it("defaults successful comparisons to a six-hour refresh interval", async () => {
    delete process.env.XIANYU_COMPARISON_INTERVAL_MS;
    const startedAt = Date.now();

    await refreshChinaMarketComparison("product-1");

    const summary = mocks.comparisonUpdateManyTx.mock.calls.at(-1)?.[0].data;
    const nextRefreshAt = summary.nextRefreshAt as Date;
    expect(nextRefreshAt.getTime()).toBeGreaterThanOrEqual(
      startedAt + 6 * 60 * 60_000,
    );
    expect(nextRefreshAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 6 * 60 * 60_000,
    );
  });

  it("writes only comparison tables and produces a median reference price", async () => {
    const result = await refreshChinaMarketComparison("product-1");

    expect(result).toMatchObject({
      status: "ready",
      candidateCount: 3,
      matchedCount: 3,
      referencePriceCny: 620,
    });
    expect(mocks.comparisonUpsert).toHaveBeenCalled();
    expect(mocks.offerUpsert).toHaveBeenCalledTimes(3);
    expect(mocks.transaction).toHaveBeenCalled();
    expect((mocks as Record<string, unknown>).item).toBeUndefined();
    expect(mocks.sourceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          enabled: false,
          comparisonOnly: true,
        }),
        create: expect.objectContaining({
          enabled: false,
          comparisonOnly: true,
        }),
      }),
    );
    expect(mocks.comparisonUpdateManyTx).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "ready",
          comparisonMethod: "xianyu-v2-special-series-condition",
          keywordIdentityHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          providerStats: {
            complete: true,
            requestedKeywords: expect.any(Number),
            attemptedKeywords: expect.any(Number),
            rejectedRows: 0,
          },
          referencePriceCny: 620,
          referenceUrl: "https://www.goofish.com/item?id=offer-2",
        }),
      }),
    );
    expect(mocks.offerUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          providerKey: "search_api",
          queryKeyword: expect.any(String),
        }),
      }),
    );
    expect(mocks.opportunityUpdateMany).toHaveBeenCalledWith({
      where: { comparisonId: "comparison-1", status: "ready" },
      data: expect.objectContaining({
        status: "needs_facts",
        missingFacts: ["comparison_freshness"],
      }),
    });
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "evaluate-arbitrage",
      expect.objectContaining({
        productId: "product-1",
        comparisonId: "comparison-1",
      }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^evaluate-arbitrage-comparison-1-/),
      }),
    );
  });

  it("never persists provider location fields or unfiltered source data", async () => {
    mocks.search.mockResolvedValueOnce(
      offers.map((offer, index) =>
        index === 0
          ? {
              ...offer,
              locationText: "上海市浦东新区世纪大道 100 号",
              sourceData: {
                listingType: "ordinary",
                address: "世纪大道 100 号",
                latitude: 31.2304,
                longitude: 121.4737,
                gps: { lat: 31.2304, lng: 121.4737 },
                geo: { city: "上海" },
              },
            }
          : offer,
      ),
    );

    await refreshChinaMarketComparison("product-1");

    const firstWrite = mocks.offerUpsert.mock.calls.find(
      ([input]) => input.create?.sourceListingId === "offer-1",
    )?.[0];
    expect(firstWrite).toMatchObject({
      create: { location: null, sourceData: { listingType: "ordinary" } },
      update: { location: null, sourceData: { listingType: "ordinary" } },
    });
    expect(JSON.stringify(firstWrite)).not.toMatch(
      /(?:世纪大道|latitude|longitude|gps|geo)/i,
    );
  });

  it("processes the durable arbitrage evaluation separately from the comparison refresh", async () => {
    const result = await processChinaMarketComparison({
      name: "evaluate-arbitrage",
      data: { productId: "product-1", comparisonId: "comparison-1" },
    } as never);

    expect(mocks.evaluateArbitrage).toHaveBeenCalledWith(
      "product-1",
      "comparison-1",
    );
    expect(result).toMatchObject({ reverseSearch: { scheduled: 4 } });
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("skips a queued arbitrage evaluation after either feature switch is disabled", async () => {
    process.env.XIANYU_REVERSE_SEARCH_ENABLED = "false";

    await expect(
      processChinaMarketComparison({
        name: "evaluate-arbitrage",
        data: { productId: "product-1", comparisonId: "comparison-1" },
      } as never),
    ).resolves.toEqual({ skipped: "cross_market_arbitrage_disabled" });
    expect(mocks.evaluateArbitrage).not.toHaveBeenCalled();
  });

  it("limits provider searches to five terms and reserves deterministic identity queries", async () => {
    mocks.keywords.mockResolvedValueOnce(
      Array.from(
        { length: 8 },
        (_, index) => `假面骑士555 宽泛变体${index + 1}`,
      ),
    );

    await refreshChinaMarketComparison("product-1");

    const keywords = mocks.search.mock.calls[0]?.[0] as string[];
    expect(keywords).toHaveLength(5);
    expect(keywords.slice(0, 3).every((value) => !value.includes("宽泛"))).toBe(
      true,
    );
    expect(keywords.some((value) => value.includes("sb 555b"))).toBe(true);
  });

  it("reuses keyword AI output by stable identity hash despite timestamp-only listing updates", async () => {
    await refreshChinaMarketComparison("product-1");
    const firstSummary = mocks.comparisonUpdateManyTx.mock.calls.at(-1)?.[0]
      ?.data as {
      comparisonMethod: string;
      keywordIdentityHash: string;
      searchKeywords: string[];
    };
    mocks.comparisonUpsert.mockResolvedValueOnce({
      id: "comparison-1",
      status: "ready",
      comparisonMethod: firstSummary.comparisonMethod,
      keywordIdentityHash: firstSummary.keywordIdentityHash,
      searchKeywords: firstSummary.searchKeywords,
      observedAt: new Date("2026-01-01T00:00:00Z"),
    });
    mocks.productFindUnique.mockResolvedValueOnce({
      ...product,
      updatedAt: new Date("2026-09-01T00:00:00Z"),
      listings: product.listings.map((listing) => ({
        ...listing,
        updatedAt: new Date("2026-09-01T00:00:00Z"),
        detectedAt: new Date("2026-09-01T00:00:00Z"),
      })),
    });
    mocks.keywords.mockClear();

    await refreshChinaMarketComparison("product-1");

    expect(mocks.keywords).not.toHaveBeenCalled();
  });

  it("regenerates keyword AI output when a product identity field changes", async () => {
    await refreshChinaMarketComparison("product-1");
    const firstSummary = mocks.comparisonUpdateManyTx.mock.calls.at(-1)?.[0]
      ?.data as {
      comparisonMethod: string;
      keywordIdentityHash: string;
      searchKeywords: string[];
    };
    mocks.comparisonUpsert.mockResolvedValueOnce({
      id: "comparison-1",
      comparisonMethod: firstSummary.comparisonMethod,
      keywordIdentityHash: firstSummary.keywordIdentityHash,
      searchKeywords: firstSummary.searchKeywords,
    });
    mocks.productFindUnique.mockResolvedValueOnce({
      ...product,
      modelNumber: "SB-555C",
    });
    mocks.keywords.mockClear();

    await refreshChinaMarketComparison("product-1");

    expect(mocks.keywords).toHaveBeenCalledOnce();
  });

  it("fails closed when AI keywords cannot be anchored to a sparse reference", async () => {
    mocks.productFindUnique.mockResolvedValueOnce({
      ...product,
      titleZh: null,
      productLine: null,
      modelNumber: null,
      franchise: null,
      series: null,
      manufacturerEntity: null,
      toyTypeEntity: null,
      listings: [
        {
          ...product.listings[0],
          titleZh: null,
          images: [],
        },
      ],
    });
    mocks.keywords.mockResolvedValueOnce([
      "假面骑士555 DX腰带",
      "万代 Faiz驱动器",
      "假面骑士555 变身腰带",
    ]);

    await expect(
      refreshChinaMarketComparison("product-1"),
    ).resolves.toMatchObject({ status: "insufficient", candidateCount: 0 });
    expect(mocks.keywords).toHaveBeenCalledOnce();
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.comparisonUpdateManyTx).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "insufficient",
          searchKeywords: [],
          candidateCount: 0,
          matchedCount: 0,
        }),
      }),
    );
  });

  it("dispatches stable product jobs without touching Item writes", async () => {
    mocks.comparisonFindMany.mockResolvedValue([{ productId: "product-1" }]);
    mocks.productFindMany.mockResolvedValue([{ id: "product-2" }]);
    mocks.queueAdd.mockResolvedValue({});

    const result = await dispatchChinaMarketComparisons();

    expect(result).toMatchObject({
      scheduled: 2,
      alreadyQueued: 0,
      scheduledByCohort: { due: 1, new: 1 },
    });
    expect(mocks.queueAdd).toHaveBeenNthCalledWith(
      1,
      "refresh-product",
      { productId: "product-1", sourceId: "source-xianyu" },
      expect.objectContaining({ jobId: "stable-product-1" }),
    );
    expect(mocks.queueAdd).toHaveBeenNthCalledWith(
      2,
      "refresh-product",
      { productId: "product-2", sourceId: "source-xianyu" },
      expect.objectContaining({ jobId: "stable-product-2" }),
    );
    const newProductInput = mocks.productFindMany.mock.calls[0]?.[0] as {
      where?: {
        listings?: {
          some?: Record<string, unknown>;
          none?: Record<string, unknown>;
        };
      };
      orderBy?: unknown;
    };
    expect(newProductInput.where?.listings?.some).not.toHaveProperty(
      "purchaseRecord",
    );
    expect(newProductInput.orderBy).toEqual([
      { createdAt: "asc" },
      { id: "asc" },
    ]);
    expect(newProductInput.where?.listings?.some).toMatchObject({
      collectibleSeries: { in: ["shf", "sic"] },
      categoryIp: { in: ["kamen_rider", "ultraman"] },
    });
    expect(
      (
        mocks.productFindMany.mock.calls[1]?.[0] as {
          where?: { listings?: { none?: Record<string, unknown> } };
        }
      ).where?.listings?.none,
    ).toMatchObject({
      collectibleSeries: { in: ["shf", "sic"] },
    });
    const dueInput = mocks.comparisonFindMany.mock.calls[0]?.[0] as {
      where?: {
        product?: { listings?: { some?: Record<string, unknown> } };
        AND?: Array<{ OR?: Array<Record<string, unknown>> }>;
      };
      orderBy?: unknown;
    };
    const staleBranch = dueInput.where?.AND?.[0]?.OR?.find(
      (condition) => condition.status === "refreshing",
    )?.updatedAt as { lt?: Date } | undefined;
    expect(staleBranch?.lt).toBeInstanceOf(Date);
    expect(Date.now() - Number(staleBranch?.lt)).toBeLessThanOrEqual(
      60 * 60_000 + 5_000,
    );
    expect(dueInput.orderBy).toEqual([
      { nextRefreshAt: { sort: "asc", nulls: "first" } },
      { updatedAt: "asc" },
      { productId: "asc" },
    ]);
    expect(dueInput.where?.product?.listings?.some).toMatchObject({
      collectibleSeries: { in: ["shf", "sic"] },
    });
  });

  it("releases a terminal stable job only when its product becomes due", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    mocks.comparisonFindMany.mockResolvedValue([{ productId: "product-1" }]);
    mocks.productFindMany.mockResolvedValue([]);
    mocks.queueGetJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue("failed"),
      remove,
    });

    await expect(dispatchChinaMarketComparisons()).resolves.toMatchObject({
      scheduled: 1,
      alreadyQueued: 0,
    });
    expect(remove).toHaveBeenCalledOnce();
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "refresh-product",
      expect.objectContaining({ productId: "product-1" }),
      expect.objectContaining({
        jobId: "stable-product-1",
        removeOnFail: 100,
      }),
    );
  });

  it("does not report an already queued stable job as newly scheduled", async () => {
    mocks.comparisonFindMany.mockResolvedValue([{ productId: "product-1" }]);
    mocks.productFindMany.mockResolvedValue([]);
    mocks.queueGetJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue("active"),
      remove: vi.fn(),
    });

    await expect(dispatchChinaMarketComparisons()).resolves.toMatchObject({
      scheduled: 0,
      alreadyQueued: 1,
    });
    expect(mocks.queueAdd).not.toHaveBeenCalled();
  });

  it("keeps previous offers when the provider is blocked and marks comparison failed", async () => {
    const blocked = Object.assign(
      new Error("Xianyu search provider blocked by provider (captcha)"),
      { code: "provider_blocked" },
    );
    mocks.search.mockRejectedValueOnce(blocked);

    await expect(
      refreshChinaMarketComparison("product-1"),
    ).rejects.toMatchObject({ code: "provider_blocked" });
    expect(mocks.offerUpdateMany).not.toHaveBeenCalled();
    expect(mocks.offerUpsert).not.toHaveBeenCalled();
    expect(mocks.comparisonUpdateManyTx).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "comparison-1" }),
        data: expect.objectContaining({
          status: "failed",
          lastError: expect.stringContaining("provider_blocked"),
        }),
      }),
    );
  });

  it("removes prior offers from pricing without claiming they ended", async () => {
    mocks.search.mockResolvedValueOnce([]);

    const result = await refreshChinaMarketComparison("product-1");

    expect(result).toMatchObject({
      status: "insufficient",
      candidateCount: 0,
      matchedCount: 0,
    });
    expect(mocks.offerUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { comparisonId: "comparison-1" } }),
    );
    expect(mocks.offerUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ status: "ended" }),
      }),
    );
    expect(mocks.opportunityUpdateMany).toHaveBeenCalledWith({
      where: { comparisonId: "comparison-1", status: "ready" },
      data: expect.objectContaining({
        status: "needs_facts",
        missingFacts: ["comparison_identity"],
      }),
    });
  });

  it("treats malformed non-empty provider rows as a failure, not a true empty market", async () => {
    mocks.comparisonUpsert.mockResolvedValueOnce({
      id: "comparison-1",
      status: "ready",
      referencePriceCny: 610,
      referenceUrl: "https://www.goofish.com/item?id=offer-1",
      observedAt: new Date(),
    });
    mocks.search.mockImplementationOnce(async (keywords: string[]) => ({
      offers: [
        {
          ...offers[0],
          sourceUrl: "https://www.goofish.com/search?id=offer-1",
          provenance: {
            providerKey: "search_api:bad-adapter",
            queryKeyword: keywords[0]!,
          },
        },
      ],
      complete: true,
      stats: {
        requestedKeywords: keywords.length,
        attemptedKeywords: keywords.length,
        rejectedRows: 0,
      },
    }));

    await expect(refreshChinaMarketComparison("product-1")).rejects.toThrow(
      "all returned offers failed validation",
    );
    expect(mocks.offerUpsert).not.toHaveBeenCalled();
    expect(mocks.offerUpdateMany).not.toHaveBeenCalled();
    expect(mocks.comparisonUpdateManyTx).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("fails closed on unaudited active Apify availability", async () => {
    const invalidAudits = [
      {
        provenance: {
          providerKey: "apify:test-actor",
          providerRunId: "run-missing-marker",
        },
        sourceData: { detailStatus: "summary" },
      },
      {
        provenance: { providerKey: "apify:test-actor" },
        sourceData: {
          detailStatus: "summary",
          availabilityEvidence: "apify_current_search_result",
          availabilityObservedAt: new Date().toISOString(),
        },
      },
      {
        provenance: {
          providerKey: "apify:test-actor",
          providerRunId: "run-stale-summary",
        },
        sourceData: {
          detailStatus: "summary",
          availabilityEvidence: "apify_current_search_result",
          availabilityObservedAt: new Date(
            Date.now() - 31 * 60_000,
          ).toISOString(),
        },
      },
    ];

    for (const invalidAudit of invalidAudits) {
      mocks.search.mockImplementationOnce(async (keywords: string[]) => ({
        offers: offers.map((offer) => ({
          ...offer,
          sourceData: invalidAudit.sourceData,
          provenance: {
            ...invalidAudit.provenance,
            queryKeyword: keywords[0]!,
          },
        })),
        complete: true,
        stats: {
          requestedKeywords: keywords.length,
          attemptedKeywords: keywords.length,
          rejectedRows: 0,
        },
      }));

      await expect(refreshChinaMarketComparison("product-1")).rejects.toThrow(
        "all returned offers failed validation",
      );
    }
    expect(mocks.offerUpsert).not.toHaveBeenCalled();
  });

  it.each(["summary", "enriched"] as const)(
    "accepts audited active Apify %s availability",
    async (detailStatus) => {
      mocks.search.mockImplementationOnce(async (keywords: string[]) => ({
        offers: offers.map((offer) => ({
          ...offer,
          sourceData:
            detailStatus === "summary"
              ? {
                  detailStatus,
                  availabilityEvidence: "apify_current_search_result",
                  availabilityObservedAt: new Date().toISOString(),
                }
              : { detailStatus },
          provenance: {
            providerKey: "apify:test-actor",
            providerRunId: `run-${detailStatus}`,
            queryKeyword: keywords[0]!,
          },
        })),
        complete: true,
        stats: {
          requestedKeywords: keywords.length,
          attemptedKeywords: keywords.length,
          rejectedRows: 0,
        },
      }));

      await expect(
        refreshChinaMarketComparison("product-1"),
      ).resolves.toMatchObject({
        status: "ready",
        matchedCount: 3,
        referencePriceCny: 620,
      });
    },
  );

  it("fails closed when a partial provider search did not fill the candidate budget", async () => {
    mocks.search.mockImplementationOnce(async (keywords: string[]) => ({
      offers: offers.map((offer) => ({
        ...offer,
        provenance: {
          providerKey: "search_api:partial",
          queryKeyword: keywords[0]!,
        },
      })),
      complete: false,
      stats: {
        requestedKeywords: keywords.length,
        attemptedKeywords: 1,
        rejectedRows: 0,
      },
    }));

    await expect(refreshChinaMarketComparison("product-1")).rejects.toThrow(
      "incomplete search did not exhaust the candidate budget",
    );
    expect(mocks.offerUpsert).not.toHaveBeenCalled();
  });

  it("fails closed when rejected provider rows could disguise a zero result", async () => {
    mocks.search.mockImplementationOnce(async (keywords: string[]) => ({
      offers: [],
      complete: true,
      stats: {
        requestedKeywords: keywords.length,
        attemptedKeywords: keywords.length,
        rejectedRows: 2,
      },
    }));

    await expect(refreshChinaMarketComparison("product-1")).rejects.toThrow(
      "too few verified offers after provider row rejection",
    );
    expect(mocks.offerUpdateMany).not.toHaveBeenCalled();
  });

  it("removes a statistical price outlier from matched evidence and the summary count", async () => {
    const outlier = {
      ...offers[0],
      sourceListingId: "offer-outlier",
      sourceUrl: "https://www.goofish.com/item?id=offer-outlier",
      priceCny: 9_999,
    };
    mocks.search.mockResolvedValueOnce([...offers, outlier]);
    mocks.decisions.mockResolvedValueOnce(
      [...offers, outlier].map((offer) => ({
        sourceListingId: offer.sourceListingId,
        sameProduct: true,
        confidence: 0.95,
        accessoryOnly: false,
        damaged: false,
        quantityConflict: false,
        modelConflict: false,
        versionConflict: false,
        scaleConflict: false,
        evidence: ["型号一致"],
      })),
    );

    await expect(
      refreshChinaMarketComparison("product-1"),
    ).resolves.toMatchObject({
      status: "ready",
      matchedCount: 3,
      referencePriceCny: 620,
    });
    const outlierWrite = mocks.offerUpsert.mock.calls.find(
      ([input]) => input.create?.sourceListingId === "offer-outlier",
    )?.[0];
    expect(outlierWrite).toMatchObject({
      update: {
        matchDecision: "unmatched",
        matchConfidence: null,
        rejectionReason: "价格异常，未进入参考价样本",
      },
    });
  });

  it("keeps at least fifty audit offers even when storage config is lower", async () => {
    process.env.XIANYU_COMPARISON_MAX_STORED_OFFERS = "1";

    await refreshChinaMarketComparison("product-1");

    expect(mocks.offerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 50 }),
    );
  });

  it("hides a previous ready summary on refresh failure without deleting its evidence", async () => {
    mocks.comparisonUpsert.mockResolvedValueOnce({
      id: "comparison-1",
      status: "ready",
      referencePriceCny: 610,
      referenceUrl: "https://www.goofish.com/item?id=offer-1",
      observedAt: new Date(),
    });
    mocks.search.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(refreshChinaMarketComparison("product-1")).rejects.toThrow(
      "provider unavailable",
    );
    expect(mocks.comparisonUpdateManyTx).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          lastError: expect.stringContaining("provider unavailable"),
        }),
      }),
    );
    expect(mocks.offerUpdateMany).not.toHaveBeenCalled();
    expect(mocks.offerDeleteMany).not.toHaveBeenCalled();
    expect(
      mocks.comparisonUpdateManyTx.mock.calls.at(-1)?.[0].data,
    ).not.toHaveProperty("referencePriceCny");
  });

  it("discards provider-blocked jobs instead of retrying a challenge", async () => {
    const blocked = Object.assign(
      new Error("Xianyu search provider blocked by provider (captcha)"),
      { code: "provider_blocked" },
    );
    mocks.search.mockRejectedValueOnce(blocked);
    const discard = vi.fn();

    await expect(
      processChinaMarketComparison({
        name: "refresh-product",
        data: { productId: "product-1" },
        discard,
      } as never),
    ).rejects.toMatchObject({ code: "provider_blocked" });
    expect(discard).toHaveBeenCalledOnce();
  });

  it("honors provider Retry-After in the database and discards immediate BullMQ retries", async () => {
    const rateLimited = Object.assign(new Error("provider rate limited"), {
      code: "provider_rate_limited",
      retryAfterMs: 20 * 60_000,
    });
    mocks.search.mockRejectedValueOnce(rateLimited);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const discard = vi.fn();
    const startedAt = Date.now();

    await expect(
      processChinaMarketComparison({
        name: "refresh-product",
        data: { productId: "product-1" },
        discard,
        updateData: vi.fn(),
      } as never),
    ).rejects.toMatchObject({ code: "provider_rate_limited" });
    expect(discard).toHaveBeenCalledOnce();
    const failureUpdate = mocks.comparisonUpdateManyTx.mock.calls.at(-1)?.[0];
    const nextRefreshAt = failureUpdate.data.nextRefreshAt as Date;
    expect(nextRefreshAt.getTime() - startedAt).toBeGreaterThanOrEqual(
      20 * 60_000,
    );
    expect(nextRefreshAt.getTime() - startedAt).toBeLessThan(
      20 * 60_000 + 5_000,
    );
  });

  it("clears a terminal provider run id so the next BullMQ attempt can start a new actor", async () => {
    const keyword = "假面骑士555 dx faiz驱动器 sb 555b sb 555b";
    const job = {
      name: "refresh-product",
      data: {
        productId: "product-1",
        providerRuns: { [keyword]: "run-terminal-1" },
      },
      discard: vi.fn(),
      updateData: vi.fn().mockResolvedValue(undefined),
    };
    mocks.search.mockImplementationOnce(
      async (
        keywords: string[],
        _limit: number,
        context: {
          onProviderRunTerminal?: (
            keyword: string,
            runId: string,
            status: string,
          ) => Promise<void>;
        },
      ) => {
        expect(keywords[0]).toBe(keyword);
        await context.onProviderRunTerminal?.(
          keyword,
          "run-terminal-1",
          "FAILED",
        );
        throw new Error("actor failed");
      },
    );

    await expect(processChinaMarketComparison(job as never)).rejects.toThrow(
      "actor failed",
    );
    expect(job.data.providerRuns).toEqual({});
    expect(job.updateData).toHaveBeenCalledWith(
      expect.objectContaining({ providerRuns: {} }),
    );
  });
});
