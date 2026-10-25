import { beforeEach, describe, expect, it, vi } from "vitest";

type QueueCall = {
  name: string;
  options: {
    defaultJobOptions?: {
      attempts?: number;
      backoff?: { type?: string; delay?: number };
    };
  };
  adds: Array<{
    name: string;
    data: unknown;
    options?: Record<string, unknown>;
  }>;
  repeatableJobs: unknown[];
  pendingJobs: unknown[];
  removedRepeatableKeys: string[];
  resumes: number;
};

const queueCalls = vi.hoisted(() => [] as QueueCall[]);

const providerMock = vi.hoisted(() => ({
  enabled: vi.fn(() => false),
}));
const keywordMock = vi.hoisted(() => ({ initialize: vi.fn() }));

vi.mock("./monitoring-keywords.js", () => ({
  initializeMonitoringKeywordSources: keywordMock.initialize,
}));

const dbMock = vi.hoisted(() => ({
  findItems: vi.fn(),
  countItems: vi.fn(),
  findSource: vi.fn(),
  findSources: vi.fn(),
  updateSources: vi.fn(),
  countMarketIntel: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Queue: class QueueMock {
    name: string;
    private readonly call: QueueCall;

    constructor(
      name: string,
      options: {
        defaultJobOptions?: {
          attempts?: number;
          backoff?: { type?: string; delay?: number };
        };
      },
    ) {
      this.name = name;
      this.call = {
        name,
        options,
        adds: [],
        repeatableJobs: [],
        pendingJobs: [],
        removedRepeatableKeys: [],
        resumes: 0,
      };
      queueCalls.push(this.call);
    }

    async add(name: string, data: unknown, options?: Record<string, unknown>) {
      this.call.adds.push({ name, data, options });
      return {};
    }

    async addBulk(
      jobs: Array<{
        name: string;
        data: unknown;
        opts?: Record<string, unknown>;
      }>,
    ) {
      this.call.adds.push(
        ...jobs.map(({ name, data, opts }) => ({
          name,
          data,
          options: opts,
        })),
      );
      return jobs.map(() => ({}));
    }

    async getRepeatableJobs() {
      return this.call.repeatableJobs;
    }

    async getJobs() {
      return this.call.pendingJobs;
    }

    async getJob(jobId: string) {
      return (
        this.call.pendingJobs.find(
          (job) =>
            job != null &&
            typeof job === "object" &&
            (job as { id?: unknown }).id === jobId,
        ) ?? null
      );
    }

    async removeRepeatableByKey(key: string) {
      this.call.removedRepeatableKeys.push(key);
      return undefined;
    }

    async resume() {
      this.call.resumes += 1;
    }
  },
}));

vi.mock("ioredis", () => ({
  Redis: class RedisMock {},
}));

vi.mock("@tokusatsu/db", () => ({
  prisma: {
    item: { findMany: dbMock.findItems, count: dbMock.countItems },
    source: {
      findUnique: dbMock.findSource,
      findMany: dbMock.findSources,
      updateMany: dbMock.updateSources,
    },
    marketIntel: { count: dbMock.countMarketIntel },
  },
}));

vi.mock("./queue-maintenance.js", () => ({
  removePendingAdapterJobs: vi.fn(),
}));

vi.mock("./china-market/xianyu.provider.js", () => ({
  xianyuComparisonEnabled: providerMock.enabled,
}));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  queueCalls.length = 0;
  providerMock.enabled.mockReset();
  providerMock.enabled.mockReturnValue(false);
  keywordMock.initialize.mockReset().mockResolvedValue({ hasConfig: false });
  dbMock.findItems.mockReset().mockResolvedValue([]);
  dbMock.countItems.mockReset();
  dbMock.findSource.mockReset().mockResolvedValue(null);
  dbMock.findSources.mockReset().mockResolvedValue([]);
  dbMock.updateSources.mockReset().mockResolvedValue({ count: 0 });
  dbMock.countMarketIntel.mockReset().mockResolvedValue(1);
});

describe("status refresh queue compaction", () => {
  it("collapses duplicates to one stable job and rephases an over-SLA survivor", async () => {
    const now = new Date("2026-09-06T00:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now.getTime());
    const stableRemove = vi.fn().mockResolvedValue(undefined);
    const legacyRemoveOne = vi.fn().mockResolvedValue(undefined);
    const legacyRemoveTwo = vi.fn().mockResolvedValue(undefined);
    dbMock.findItems.mockResolvedValue([{ id: "item-1", lastSeenAt: now, auctionEndAt: null, listingType: "direct" }]);
    vi.resetModules();
    const { compactPendingStatusJobs } = await import("./queues.js");
    const statusQueue = queueCalls.find(
      ({ name }) => name === "item-status-refresh",
    );
    expect(statusQueue).toBeDefined();
    statusQueue!.pendingJobs = [
      {
        id: "status-item-1",
        name: "refresh-status",
        data: { itemId: "item-1", auctionEndAt: null },
        timestamp: now.getTime(),
        opts: { delay: 12 * 60 * 60_000 },
        remove: stableRemove,
      },
      {
        id: "legacy-item-1-a",
        name: "refresh-status",
        data: { itemId: "item-1", auctionEndAt: null },
        timestamp: now.getTime(),
        opts: { delay: 4 * 60 * 60_000 },
        remove: legacyRemoveOne,
      },
      {
        id: "legacy-item-1-b",
        name: "refresh-status",
        data: { itemId: "item-1", auctionEndAt: null },
        timestamp: now.getTime(),
        opts: { delay: 6 * 60 * 60_000 },
        remove: legacyRemoveTwo,
      },
    ];

    await expect(compactPendingStatusJobs()).resolves.toMatchObject({
      inspected: 3,
      uniqueItems: 1,
      removed: 2,
      migrated: 1,
    });
    expect(stableRemove).toHaveBeenCalledOnce();
    expect(legacyRemoveOne).toHaveBeenCalledOnce();
    expect(legacyRemoveTwo).toHaveBeenCalledOnce();
    expect(statusQueue!.adds).toHaveLength(1);
    expect(statusQueue!.adds[0]).toMatchObject({
      name: "refresh-status",
      options: {
        jobId: "status-item-1",
        delay: expect.any(Number),
      },
    });
    expect(Number(statusQueue!.adds[0]?.options?.delay)).toBeLessThanOrEqual(
      2 * 60 * 60_000,
    );
  });

  it("removes pending work for listings that are no longer active inventory", async () => {
    const now = new Date("2026-09-06T00:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now.getTime());
    const activeRemove = vi.fn().mockResolvedValue(undefined);
    const inactiveRemove = vi.fn().mockResolvedValue(undefined);
    dbMock.findItems.mockResolvedValue([{ id: "item-active", lastSeenAt: now, auctionEndAt: null, listingType: "direct" }]);
    vi.resetModules();
    const { compactPendingStatusJobs } = await import("./queues.js");
    const statusQueue = queueCalls.find(
      ({ name }) => name === "item-status-refresh",
    );
    expect(statusQueue).toBeDefined();
    statusQueue!.pendingJobs = [
      {
        id: "status-item-active",
        name: "refresh-status",
        data: { itemId: "item-active", auctionEndAt: null },
        timestamp: now.getTime(),
        opts: { delay: 60 * 60_000 },
        remove: activeRemove,
      },
      {
        id: "status-item-inactive",
        name: "refresh-status",
        data: { itemId: "item-inactive", auctionEndAt: null },
        timestamp: now.getTime(),
        opts: { delay: 60 * 60_000 },
        remove: inactiveRemove,
      },
    ];

    await expect(compactPendingStatusJobs()).resolves.toMatchObject({
      inspected: 2,
      uniqueItems: 2,
      removed: 1,
      migrated: 0,
    });
    expect(dbMock.findItems).toHaveBeenCalledWith({
      where: {
        id: { in: ["item-active", "item-inactive"] },
        archivedAt: null,
        deletedAt: null,
        ignored: false,
        status: { in: ["active", "unknown"] },
        channel: "online",
        purchaseRecord: null,
        categoryToyType: { not: "card" },
      },
      select: { id: true, lastSeenAt: true, auctionEndAt: true, listingType: true },
    });
    expect(activeRemove).not.toHaveBeenCalled();
    expect(inactiveRemove).toHaveBeenCalledOnce();
    expect(statusQueue!.adds).toHaveLength(0);
  });

  it("adds stable phased jobs for every uncovered live or unresolved online listing", async () => {
    dbMock.findItems.mockResolvedValueOnce([
      {
        id: "item-covered",
        sourceItemId: "covered-source-id",
        sourceUrl: "https://example.test/covered",
        status: "active",
        auctionEndAt: null,
        source: { key: "mercari" },
      },
      {
        id: "item-unknown",
        sourceItemId: "unknown-source-id",
        sourceUrl: "https://example.test/unknown",
        status: "unknown",
        auctionEndAt: null,
        source: { key: "rakuma" },
      },
    ]);
    vi.resetModules();
    const { ensureStatusRefreshCoverage } = await import("./queues.js");
    const statusQueue = queueCalls.find(
      ({ name }) => name === "item-status-refresh",
    );
    expect(statusQueue).toBeDefined();
    statusQueue!.pendingJobs = [
      {
        id: "status-item-covered",
        name: "refresh-status",
        data: { itemId: "item-covered" },
      },
    ];

    await expect(ensureStatusRefreshCoverage()).resolves.toMatchObject({
      inspected: 2,
      alreadyCovered: 1,
      scheduled: 1,
    });
    expect(dbMock.findItems).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        deletedAt: null,
        ignored: false,
        status: { in: ["active", "unknown"] },
        channel: "online",
        purchaseRecord: null,
        categoryToyType: { not: "card" },
      },
      select: {
        id: true,
        sourceItemId: true,
        sourceUrl: true,
        status: true,
        auctionEndAt: true,
        lastSeenAt: true,
        listingType: true,
        source: { select: { key: true } },
      },
      orderBy: { id: "asc" },
      take: 1_000,
    });
    expect(statusQueue!.adds).toEqual([
      expect.objectContaining({
        name: "refresh-status",
        data: expect.objectContaining({
          itemId: "item-unknown",
          status: "unknown",
          adapterKey: "rakuma",
        }),
        options: expect.objectContaining({
          jobId: "status-item-unknown",
          delay: expect.any(Number),
          removeOnComplete: true,
          removeOnFail: true,
        }),
      }),
    ]);
    expect(Number(statusQueue!.adds[0]?.options?.delay)).toBeLessThanOrEqual(
      2 * 60 * 60_000,
    );
  });

  it("repairs overdue listings promptly rather than postponing stale checks for another two hours", async () => {
    const now = new Date("2026-10-08T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now.getTime());
    dbMock.findItems.mockResolvedValueOnce([
      { id: "overdue-long-catalogue-listing-123456", sourceItemId: "source-1", sourceUrl: "https://example.test/1", status: "active", lastSeenAt: new Date(now.getTime() - 4 * 60 * 60_000), auctionEndAt: null, source: { key: "mercari" } },
      { id: "due-within-10min-long-catalogue-listing-123456", sourceItemId: "source-2", sourceUrl: "https://example.test/2", status: "active", lastSeenAt: new Date(now.getTime() - 110 * 60_000), auctionEndAt: null, source: { key: "mercari" } },
    ]);
    vi.resetModules();
    const { ensureStatusRefreshCoverage } = await import("./queues.js");
    await ensureStatusRefreshCoverage();
    const queue = queueCalls.find(({ name }) => name === "item-status-refresh")!;
    const delays = queue.adds.map((entry) => Number(entry.options?.delay));
    expect(delays[0]).toBeLessThanOrEqual(5 * 60_000);
    expect(delays[1]).toBeLessThanOrEqual(10 * 60_000);
  });

  it("coalesces overlapping coverage repairs instead of repeatedly scanning or enqueuing the same listing", async () => {
    let resolveRows!: (rows: unknown[]) => void;
    dbMock.findItems.mockImplementationOnce(() => new Promise((resolve) => { resolveRows = resolve; }));
    vi.resetModules();
    const { ensureStatusRefreshCoverage } = await import("./queues.js");
    const first = ensureStatusRefreshCoverage();
    const second = ensureStatusRefreshCoverage();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dbMock.findItems).toHaveBeenCalledOnce();
    resolveRows([]);
    await Promise.all([first, second]);
  });

  it("rephases an overdue stable job using the current database deadline and listing mode", async () => {
    const now = new Date("2026-10-08T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now.getTime());
    dbMock.findItems.mockResolvedValueOnce([{
      id: "item-stale", lastSeenAt: new Date(now.getTime() - 4 * 60 * 60_000),
      auctionEndAt: null, listingType: "direct",
    }]);
    vi.resetModules();
    const { compactPendingStatusJobs } = await import("./queues.js");
    const queue = queueCalls.find(({ name }) => name === "item-status-refresh")!;
    const remove = vi.fn().mockResolvedValue(undefined);
    queue.pendingJobs = [{
      id: "status-item-stale", name: "refresh-status", timestamp: now.getTime(),
      opts: { delay: 60 * 60_000 }, remove,
      data: { itemId: "item-stale", auctionEndAt: "2026-10-10T12:00:00.000Z", listingType: "auction" },
    }];
    await expect(compactPendingStatusJobs()).resolves.toMatchObject({ migrated: 1 });
    expect(remove).toHaveBeenCalledOnce();
    expect(Number(queue.adds[0].options?.delay)).toBeLessThanOrEqual(5 * 60_000);
    expect(queue.adds[0].data).toMatchObject({ auctionEndAt: null, listingType: "direct" });
  });

  it("does not let a legacy non-stable status job prevent the current coverage repair", async () => {
    dbMock.findItems.mockResolvedValueOnce([{
      id: "item-legacy", sourceItemId: "source-1", sourceUrl: "https://example.test/1",
      status: "unknown", lastSeenAt: new Date(), auctionEndAt: null, listingType: "direct", source: { key: "rakuma" },
    }]);
    vi.resetModules();
    const { ensureStatusRefreshCoverage } = await import("./queues.js");
    const queue = queueCalls.find(({ name }) => name === "item-status-refresh")!;
    queue.pendingJobs = [{ id: "legacy-item-legacy", name: "refresh-status", data: { itemId: "item-legacy" } }];
    await expect(ensureStatusRefreshCoverage()).resolves.toMatchObject({ scheduled: 1, alreadyCovered: 0 });
    expect(queue.adds[0].options?.jobId).toBe("status-item-legacy");
  });

  it("allows a later repair after a transient coverage scan failure", async () => {
    dbMock.findItems.mockRejectedValueOnce(new Error("database unavailable")).mockResolvedValueOnce([]);
    vi.resetModules();
    const { ensureStatusRefreshCoverage } = await import("./queues.js");
    await expect(ensureStatusRefreshCoverage()).rejects.toThrow("database unavailable");
    await expect(ensureStatusRefreshCoverage()).resolves.toMatchObject({ scheduled: 0 });
    expect(dbMock.findItems).toHaveBeenCalledTimes(2);
  });
});

describe("database-owned monitoring scheduler", () => {
  it("replaces only old static real-platform searches and retains maintenance and user keyword jobs", async () => {
    keywordMock.initialize.mockResolvedValue({ hasConfig: true });
    vi.stubEnv("REAL_ADAPTER_ENABLED", "true");
    vi.stubEnv("MERCARI_SEARCH_ENABLED", "true");
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    vi.stubEnv("BACKGROUND_AI_FREE_AUTOMATION_ENABLED", "false");
    vi.stubEnv("MOCK_ADAPTER_ENABLED", "false");
    vi.resetModules();
    const { scheduleJobs } = await import("./queues.js");
    const queue = queueCalls.find(({ name }) => name === "source-search")!;
    const removeLegacy = vi.fn().mockResolvedValue(undefined);
    const removeKeyword = vi.fn().mockResolvedValue(undefined);
    const removeOther = vi.fn().mockResolvedValue(undefined);
    queue.pendingJobs = [
      { id: "legacy-real-search", data: { adapterKey: "mercari" }, remove: removeLegacy },
      { id: "monitor-keyword-1", data: { adapterKey: "mercari", monitoringKeywordId: "keyword-1" }, remove: removeKeyword },
      { id: "unrelated-adapter-search", data: { adapterKey: "custom" }, remove: removeOther },
    ];
    await scheduleJobs();
    expect(keywordMock.initialize).toHaveBeenCalledOnce();
    expect(removeLegacy).toHaveBeenCalledOnce();
    expect(removeKeyword).not.toHaveBeenCalled();
    expect(removeOther).not.toHaveBeenCalled();
    expect(queue.adds).toHaveLength(0);
    expect(queueCalls.find(({ name }) => name === "inventory-maintenance")?.adds).toEqual([
      expect.objectContaining({ name: "archive-stale-items" }),
    ]);
    expect(queueCalls.find(({ name }) => name === "disliked-maintenance")?.adds).toEqual([
      expect.objectContaining({ name: "purge-disliked-warehouse" }),
    ]);
  });

  it("removes repeatable scheduler definitions instead of deleting scheduler children", async () => {
    keywordMock.initialize.mockResolvedValue({ hasConfig: true });
    vi.stubEnv("REAL_ADAPTER_ENABLED", "true");
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    vi.stubEnv("BACKGROUND_AI_FREE_AUTOMATION_ENABLED", "false");
    vi.stubEnv("MOCK_ADAPTER_ENABLED", "false");
    vi.resetModules();
    const { scheduleJobs } = await import("./queues.js");
    const queue = queueCalls.find(({ name }) => name === "source-search")!;
    const removeSchedulerChild = vi.fn().mockRejectedValue(
      new Error("scheduler children cannot be removed directly"),
    );
    queue.pendingJobs = [
      {
        id: "repeat:legacy-hash:1720000000000",
        repeatJobKey: "repeat:legacy-hash",
        data: { adapterKey: "mercari" },
        remove: removeSchedulerChild,
      },
    ];

    await expect(scheduleJobs()).resolves.toBeUndefined();
    expect(removeSchedulerChild).not.toHaveBeenCalled();
    expect(queue.removedRepeatableKeys).toEqual(["repeat:legacy-hash"]);
  });

  it("preserves the static marketplace fallback until a monitoring keyword has been configured", async () => {
    vi.stubEnv("REAL_ADAPTER_ENABLED", "true");
    vi.stubEnv("MANDARAKE_SEARCH_ENABLED", "true");
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    vi.stubEnv("BACKGROUND_AI_FREE_AUTOMATION_ENABLED", "false");
    vi.stubEnv("MOCK_ADAPTER_ENABLED", "false");
    vi.resetModules();
    const { scheduleJobs } = await import("./queues.js");
    await scheduleJobs();
    const queue = queueCalls.find(({ name }) => name === "source-search")!;
    expect(queue.adds.some((job) => (job.data as { adapterKey?: string }).adapterKey === "mandarake")).toBe(true);
    expect(dbMock.updateSources).toHaveBeenCalledWith({
      where: { key: "mandarake" }, data: { enabled: true, circuitOpenAt: null },
    });
  });
});

describe("paid automation scheduler boundary", () => {
  it("does not create any automatic AI jobs or scan AI backlogs when disabled", async () => {
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    vi.stubEnv("BACKGROUND_AI_FREE_AUTOMATION_ENABLED", "false");
    vi.stubEnv("REAL_ADAPTER_ENABLED", "false");
    vi.stubEnv("MOCK_ADAPTER_ENABLED", "false");
    vi.resetModules();
    const { scheduleJobs } = await import("./queues.js");

    await scheduleJobs();

    for (const queueName of [
      "image-classification",
      "china-market-comparison",
      "title-translation",
      "item-detail-translation",
      "ai-operations",
    ]) {
      const queue = queueCalls.find(({ name }) => name === queueName);
      expect(queue?.adds, queueName).toHaveLength(0);
    }
    expect(
      dbMock.findItems.mock.calls.some(
        ([query]) =>
          query &&
          typeof query === "object" &&
          "where" in query &&
          query.where &&
          typeof query.where === "object" &&
          "classifications" in query.where,
      ),
    ).toBe(false);
    expect(dbMock.countItems).not.toHaveBeenCalled();
  });

  it("schedules the free-tier translation queues when free automation is authorized", async () => {
    vi.stubEnv("BACKGROUND_AI_FREE_AUTOMATION_ENABLED", "true");
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    vi.stubEnv("REAL_ADAPTER_ENABLED", "false");
    vi.stubEnv("MOCK_ADAPTER_ENABLED", "false");
    vi.resetModules();
    const { scheduleJobs } = await import("./queues.js");

    await scheduleJobs();

    expect(
      queueCalls.find(({ name }) => name === "title-translation")?.adds,
    ).toEqual([
      expect.objectContaining({
        name: "translate-existing-product-titles",
        options: expect.objectContaining({
          jobId: "repeat-title-translation",
        }),
      }),
    ]);
    expect(
      queueCalls.find(({ name }) => name === "title-translation")?.resumes,
    ).toBe(1);
    expect(
      queueCalls.find(({ name }) => name === "item-detail-translation")?.adds,
    ).toEqual([
      expect.objectContaining({
        name: "translate-existing-item-details",
        options: expect.objectContaining({
          jobId: "repeat-detail-translation",
        }),
      }),
    ]);
    expect(
      queueCalls.find(({ name }) => name === "item-detail-translation")
        ?.resumes,
    ).toBe(1);
    for (const queueName of [
      "image-classification",
      "china-market-comparison",
      "ai-operations",
    ]) {
      expect(queueCalls.find(({ name }) => name === queueName)?.adds).toHaveLength(
        0,
      );
    }
  });
});

describe("Mercari historical seller backfill", () => {
  it("paginates every seller without a public ID instead of repeating the first page", async () => {
    dbMock.findSource.mockResolvedValue({ id: "source-mercari" });
    const item = (id: string) => ({
      id,
      sourceItemId: `listing-${id}`,
      sourceUrl: `https://jp.mercari.com/item/listing-${id}`,
      status: "active",
      auctionEndAt: null,
    });
    dbMock.findItems
      .mockResolvedValueOnce([item("a"), item("b")])
      .mockResolvedValueOnce([item("c")])
      .mockResolvedValueOnce([]);
    vi.resetModules();
    const { scheduleMercariSellerBackfill } = await import("./queues.js");

    await expect(scheduleMercariSellerBackfill()).resolves.toEqual({
      scheduled: 3,
    });

    expect(dbMock.findItems).toHaveBeenCalledTimes(3);
    expect(dbMock.findItems.mock.calls[0]?.[0]).toMatchObject({
      where: {
        sourceId: "source-mercari",
        OR: [
          { sellerId: null },
          {
            seller: {
              name: { startsWith: "Mercari 卖家" },
              sourceSellerId: null,
            },
          },
        ],
        archivedAt: null,
        deletedAt: null,
        status: { in: ["active", "unknown"] },
      },
      orderBy: { id: "asc" },
      take: 1000,
    });
    expect(dbMock.findItems.mock.calls[1]?.[0]).toMatchObject({
      where: { id: { gt: "b" } },
    });
    expect(dbMock.findItems.mock.calls[2]?.[0]).toMatchObject({
      where: { id: { gt: "c" } },
    });

    const queue = queueCalls.find(
      ({ name }) => name === "seller-profile-backfill",
    );
    expect(queue?.adds).toHaveLength(3);
    expect(queue?.adds.map(({ options }) => options)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          jobId: "seller-profile-backfill-mercari-a",
          removeOnComplete: true,
          removeOnFail: true,
        }),
        expect.objectContaining({
          jobId: "seller-profile-backfill-mercari-c",
          removeOnComplete: true,
          removeOnFail: true,
        }),
      ]),
    );
  });
});

describe("source search queue retry policy", () => {
  it("retries transient marketplace failures with exponential backoff", async () => {
    vi.resetModules();
    await import("./queues.js");

    const searchQueue = queueCalls.find(({ name }) => name === "source-search");

    expect(searchQueue?.options.defaultJobOptions).toEqual({
      attempts: 4,
      backoff: { type: "exponential", delay: 30_000 },
    });
  });
});

describe("procurement search expansion", () => {
  it("places compact bulk searches before general market coverage and deduplicates overrides", async () => {
    vi.resetModules();
    const { marketKeywords } = await import("./queues.js");

    expect(
      marketKeywords({
        PROCUREMENT_SEARCH_KEYWORDS:
          "特撮 指人形 まとめ売り|特撮 ガシャポン まとめ売り",
        MARKET_KEYWORDS: "仮面ライダー|特撮 指人形 まとめ売り",
      }),
    ).toEqual([
      "特撮 指人形 まとめ売り",
      "特撮 ガシャポン まとめ売り",
      "仮面ライダー",
    ]);
  });

  it("keeps procurement, franchise SHF and S.I.C. searches dominant while covering every default keyword", async () => {
    vi.resetModules();
    const { marketKeywordWindow, marketKeywords } = await import("./queues.js");
    const priority = [
      "仮面ライダー まとめ売り",
      "ウルトラマン まとめ売り",
      "特撮 ガシャポン まとめ売り",
      "特撮 食玩 まとめ売り",
      "特撮 指人形 まとめ売り",
      "特撮 ミニフィギュア まとめ売り",
      "仮面ライダー S.H.Figuarts",
      "仮面ライダー 真骨彫製法",
      "仮面ライダー S.H.Figuarts まとめ売り",
      "仮面ライダー SHF 魂ウェブ商店",
      "ウルトラマン S.H.Figuarts",
      "ウルトラマン SHF まとめ売り",
      "ウルトラマン S.H.Figuarts 魂ウェブ商店",
      "仮面ライダー S.I.C.",
      "仮面ライダー SIC まとめ売り",
      "S.I.C. 仮面ライダー",
      "S.I.C. 極魂 仮面ライダー",
    ];
    const all = marketKeywords({});
    const rounds = Array.from(
      { length: all.length - priority.length + 1 },
      (_, round) => marketKeywordWindow({}, priority.length, round),
    );

    expect(rounds[0]).toEqual(priority);
    expect(
      rounds.every((keywords) => keywords.length === priority.length),
    ).toBe(true);
    expect(new Set(rounds.flat())).toEqual(new Set(all));

    const occurrences = (keyword: string) =>
      rounds.flat().filter((entry) => entry === keyword).length;
    expect(Math.min(...priority.map(occurrences))).toBeGreaterThan(
      Math.max(...all.slice(priority.length).map(occurrences)),
    );
  });

  it("covers all keywords without exceeding a small marketplace request cap", async () => {
    vi.resetModules();
    const { marketKeywordWindow, marketKeywords } = await import("./queues.js");
    const all = marketKeywords({});
    const rounds = Array.from({ length: all.length * 2 }, (_, round) =>
      marketKeywordWindow({}, 3, round),
    );

    expect(rounds.every((keywords) => keywords.length === 3)).toBe(true);
    expect(new Set(rounds.flat())).toEqual(new Set(all));
    expect(
      rounds
        .slice(1)
        .every(
          (keywords) =>
            keywords.filter((keyword) => keyword.includes("まとめ売り"))
              .length >= 2,
        ),
    ).toBe(true);
  });

  it("pins configured procurement terms and rotates every general/custom term", async () => {
    vi.resetModules();
    const { marketKeywordWindow } = await import("./queues.js");
    const env = {
      PROCUREMENT_SEARCH_KEYWORDS: "采购甲|采购乙",
      MARKET_KEYWORDS: "通用甲|通用乙|自定义甲|自定义乙|自定义丙",
    };
    const rounds = [0, 1, 2].map((round) => marketKeywordWindow(env, 4, round));

    expect(rounds).toEqual([
      ["采购甲", "采购乙", "通用甲", "通用乙"],
      ["采购甲", "采购乙", "自定义甲", "自定义乙"],
      ["采购甲", "采购乙", "自定义丙", "通用甲"],
    ]);
    expect(rounds.every((window) => window.includes("采购甲"))).toBe(true);
    expect(rounds.every((window) => window.includes("采购乙"))).toBe(true);
    expect(new Set(rounds.flat())).toEqual(
      new Set([
        "采购甲",
        "采购乙",
        "通用甲",
        "通用乙",
        "自定义甲",
        "自定义乙",
        "自定义丙",
      ]),
    );
  });

  it("derives a stable keyword from the repeat iteration and preserves non-rotating jobs", async () => {
    vi.resetModules();
    const { marketKeywordForRotation } = await import("./queues.js");
    const rotation = { slot: 0, capacity: 6 };

    expect(marketKeywordForRotation("fallback", rotation, 1, {})).toBe(
      "仮面ライダー まとめ売り",
    );
    expect(marketKeywordForRotation("fallback", rotation, 2, {})).toBe(
      "仮面ライダー S.H.Figuarts",
    );
    expect(marketKeywordForRotation("fallback", rotation, 3, {})).toBe(
      "仮面ライダー まとめ売り",
    );
    expect(marketKeywordForRotation("fallback", undefined, 99, {})).toBe(
      "fallback",
    );
  });
});

describe("China comparison scheduler", () => {
  it("creates comparison jobs without enabling paid AI automation", async () => {
    providerMock.enabled.mockReturnValue(true);
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    vi.resetModules();
    const { scheduleChinaComparisonJobs } = await import("./queues.js");

    await expect(scheduleChinaComparisonJobs()).resolves.toMatchObject({
      enabled: true,
      scheduled: 1,
    });
    const chinaQueue = queueCalls.find(
      ({ name }) => name === "china-market-comparison",
    );
    expect(chinaQueue?.adds).toHaveLength(2);
  });

  it("stays disabled without creating China-market jobs", async () => {
    vi.resetModules();
    const { scheduleChinaComparisonJobs } = await import("./queues.js");

    await expect(scheduleChinaComparisonJobs()).resolves.toEqual({
      enabled: false,
      scheduled: 0,
    });
    const chinaQueue = queueCalls.find(
      ({ name }) => name === "china-market-comparison",
    );
    expect(chinaQueue?.adds).toHaveLength(0);
  });

  it("uses one repeat dispatcher and a stable bootstrap job when enabled", async () => {
    providerMock.enabled.mockReturnValue(true);
    vi.resetModules();
    const { scheduleChinaComparisonJobs } = await import("./queues.js");

    await expect(scheduleChinaComparisonJobs()).resolves.toMatchObject({
      enabled: true,
      scheduled: 1,
    });
    const chinaQueue = queueCalls.find(
      ({ name }) => name === "china-market-comparison",
    );
    expect(chinaQueue?.adds).toHaveLength(2);
    expect(chinaQueue?.adds[0]).toMatchObject({
      name: "dispatch-due",
      options: {
        jobId: "repeat-china-comparison-dispatch",
        repeat: { every: 900_000 },
      },
    });
    expect(chinaQueue?.adds[1]).toMatchObject({
      name: "dispatch-due",
      options: {
        jobId: "bootstrap-china-comparison-dispatch",
        removeOnComplete: true,
      },
    });
  });

  it("uses an independent bounded due-scan cadence", async () => {
    vi.resetModules();
    const { chinaComparisonDispatchIntervalMs } = await import("./queues.js");

    expect(chinaComparisonDispatchIntervalMs({})).toBe(15 * 60_000);
    expect(
      chinaComparisonDispatchIntervalMs({
        XIANYU_COMPARISON_DISPATCH_INTERVAL_MS: "30000",
        XIANYU_COMPARISON_INTERVAL_MS: "2592000000",
      }),
    ).toBe(60_000);
    expect(
      chinaComparisonDispatchIntervalMs({
        XIANYU_COMPARISON_DISPATCH_INTERVAL_MS: "86400000",
      }),
    ).toBe(6 * 60 * 60_000);
  });

  it("does not remove queued product refreshes during scheduler cleanup", async () => {
    const removeDispatch = vi.fn().mockResolvedValue(undefined);
    const removeProduct = vi.fn().mockResolvedValue(undefined);
    vi.resetModules();
    const { scheduleChinaComparisonJobs } = await import("./queues.js");
    const chinaQueue = queueCalls.find(
      ({ name }) => name === "china-market-comparison",
    );
    expect(chinaQueue).toBeDefined();
    chinaQueue!.pendingJobs = [
      {
        id: "product-refresh-1",
        name: "refresh-product",
        remove: removeProduct,
      },
      {
        id: "bootstrap-china-comparison-dispatch",
        name: "dispatch-due",
        remove: removeDispatch,
      },
    ];
    await scheduleChinaComparisonJobs();
    expect(removeDispatch).toHaveBeenCalledOnce();
    expect(removeProduct).not.toHaveBeenCalled();
  });
});

describe("historical automatic classification scheduler", () => {
  it("does not scan or enqueue items when background automation is disabled", async () => {
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    vi.stubEnv("BACKGROUND_AI_FREE_AUTOMATION_ENABLED", "false");
    vi.resetModules();
    const { schedulePendingAutomaticClassifications } = await import(
      "./queues.js"
    );

    await expect(schedulePendingAutomaticClassifications()).resolves.toEqual({
      inspected: 0,
      scheduled: 0,
    });
    expect(dbMock.findItems).not.toHaveBeenCalled();
    const classificationQueue = queueCalls.find(
      ({ name }) => name === "image-classification",
    );
    expect(classificationQueue?.adds).toHaveLength(0);
  });

  it("uses content-stable IDs and advances through the historical cursor when only free automation is enabled", async () => {
    vi.stubEnv("BACKGROUND_AI_FREE_AUTOMATION_ENABLED", "true");
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    dbMock.findItems
      .mockResolvedValueOnce([
        {
          id: "item-history-1",
          titleRaw: "仮面ライダー DX変身ベルト",
          descriptionRaw: "付属品不明",
          conditionRaw: "中古",
          categoryIp: "kamen_rider",
          categoryToyType: "unknown",
          manufacturer: "bandai",
          conditionGrade: "used",
          quantityEst: 1,
          priceCurrent: 8_000,
          needsReview: true,
          images: [{ url: "https://images.example/history-1.jpg" }],
        },
      ])
      .mockResolvedValueOnce([]);
    vi.resetModules();
    const { schedulePendingAutomaticClassifications } = await import(
      "./queues.js"
    );

    await expect(schedulePendingAutomaticClassifications()).resolves.toEqual({
      inspected: 1,
      scheduled: 1,
    });
    expect(dbMock.findItems).toHaveBeenCalledTimes(2);
    expect(dbMock.findItems.mock.calls[1]?.[0]).toMatchObject({
      where: { id: { gt: "item-history-1" } },
      orderBy: { id: "asc" },
      take: 500,
    });
    const classificationQueue = queueCalls.find(
      ({ name }) => name === "image-classification",
    );
    expect(classificationQueue?.adds).toHaveLength(1);
    expect(classificationQueue?.adds[0]).toMatchObject({
      name: "classify-images",
      data: { itemId: "item-history-1" },
      options: {
        jobId: expect.stringMatching(/^classification-item-history-1-/),
      },
    });
  });
});

describe("full re-scan scheduler", () => {
  it("schedules one non-rotating backfill per keyword only for enabled sources", async () => {
    dbMock.findSources.mockResolvedValue([
      { key: "yahoo_auctions" },
      { key: "rakuma" },
    ]);
    vi.resetModules();
    const { scheduleFullRescanJobs, marketKeywords, marketKeywordWindow } =
      await import("./queues.js");

    await expect(scheduleFullRescanJobs({})).resolves.toEqual({
      enabled: true,
      scheduled: marketKeywords({}).length + 3,
    });

    expect(dbMock.findSources).toHaveBeenCalledWith({
      where: {
        enabled: true,
        channel: "online",
        comparisonOnly: false,
        key: {
          in: ["yahoo_auctions", "yahoo_fleamarket", "rakuma", "surugaya"],
        },
      },
      select: { key: true },
    });
    const queue = queueCalls.find(({ name }) => name === "source-search")!;
    // Disabled sources (yahoo_fleamarket, surugaya) get no re-scan jobs.
    expect(
      queue.adds.filter(
        (job) =>
          (job.data as { adapterKey?: string }).adapterKey ===
          "yahoo_fleamarket",
      ),
    ).toHaveLength(0);
    expect(
      queue.adds.filter(
        (job) =>
          (job.data as { adapterKey?: string }).adapterKey === "surugaya",
      ),
    ).toHaveLength(0);
    const yahoo = queue.adds.filter(
      (job) =>
        (job.data as { adapterKey?: string }).adapterKey === "yahoo_auctions",
    );
    expect(yahoo).toHaveLength(marketKeywords({}).length);
    expect(yahoo[0]).toMatchObject({
      name: "market-full-rescan",
      data: {
        adapterKey: "yahoo_auctions",
        query: {
          keyword: marketKeywords({})[0],
          highPriority: false,
          limit: 80,
          pages: 2,
          pageStart: 0,
          scanMode: "backfill",
          rotatePages: false,
        },
      },
      options: {
        jobId: "repeat-yahoo_auctions-full-rescan-0",
        repeat: { every: 86_400_000, offset: 0 },
      },
    });
    const rakuma = queue.adds.filter(
      (job) => (job.data as { adapterKey?: string }).adapterKey === "rakuma",
    );
    expect(rakuma.map((job) => (job.data as { query: { keyword: string } }).query.keyword)).toEqual(
      marketKeywordWindow({}, 3, 0),
    );
    for (const job of queue.adds) {
      expect(job.options?.jobId).toMatch(
        /^repeat-(yahoo_auctions|rakuma)-full-rescan-\d+$/,
      );
      expect(
        (job.data as { query: { scanMode: string; rotatePages: boolean } })
          .query,
      ).toMatchObject({ scanMode: "backfill", rotatePages: false });
      expect(
        (job.options?.repeat as { every: number }).every,
      ).toBe(86_400_000);
    }
    // Stable job ids: a second registration reuses the same ids instead of
    // minting new ones.
    const firstIds = queue.adds.map((job) => job.options?.jobId);
    queue.adds.length = 0;
    await scheduleFullRescanJobs({});
    expect(queue.adds.map((job) => job.options?.jobId)).toEqual(firstIds);
  });

  it("schedules nothing and removes old re-scan repeats when the kill switch is off", async () => {
    vi.resetModules();
    const { scheduleFullRescanJobs } = await import("./queues.js");
    const queue = queueCalls.find(({ name }) => name === "source-search")!;
    queue.repeatableJobs = [
      { id: "repeat-rakuma-full-rescan-0", key: "rescan-key" },
      { id: "repeat-rakuma-backfill-0", key: "backfill-key" },
    ];

    await expect(
      scheduleFullRescanJobs({ FULL_RESCAN_ENABLED: "false" }),
    ).resolves.toEqual({ enabled: false, scheduled: 0 });

    expect(queue.adds).toHaveLength(0);
    expect(dbMock.findSources).not.toHaveBeenCalled();
    expect(queue.removedRepeatableKeys).toEqual(["rescan-key"]);
  });

  it("defaults to a daily cadence and clamps extreme interval overrides", async () => {
    vi.resetModules();
    const { fullRescanEnabled, fullRescanIntervalMs } = await import(
      "./queues.js"
    );

    expect(fullRescanEnabled({})).toBe(true);
    expect(fullRescanEnabled({ FULL_RESCAN_ENABLED: "true" })).toBe(true);
    expect(fullRescanEnabled({ FULL_RESCAN_ENABLED: "false" })).toBe(false);
    expect(fullRescanIntervalMs({})).toBe(86_400_000);
    expect(fullRescanIntervalMs({ FULL_RESCAN_INTERVAL_MS: "junk" })).toBe(
      86_400_000,
    );
    expect(fullRescanIntervalMs({ FULL_RESCAN_INTERVAL_MS: "0" })).toBe(
      86_400_000,
    );
    expect(
      fullRescanIntervalMs({ FULL_RESCAN_INTERVAL_MS: "7200000" }),
    ).toBe(7_200_000);
    expect(
      fullRescanIntervalMs({ FULL_RESCAN_INTERVAL_MS: "1800000" }),
    ).toBe(3_600_000);
    expect(
      fullRescanIntervalMs({ FULL_RESCAN_INTERVAL_MS: "99999999999" }),
    ).toBe(7 * 86_400_000);
  });

  it("registers re-scans from scheduleJobs when monitoring keywords own the schedule", async () => {
    keywordMock.initialize.mockResolvedValue({ hasConfig: true });
    dbMock.findSources.mockResolvedValue([{ key: "surugaya" }]);
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    vi.stubEnv("BACKGROUND_AI_FREE_AUTOMATION_ENABLED", "false");
    vi.stubEnv("MOCK_ADAPTER_ENABLED", "false");
    vi.resetModules();
    const { scheduleJobs } = await import("./queues.js");

    await scheduleJobs();

    const queue = queueCalls.find(({ name }) => name === "source-search")!;
    expect(queue.adds).toHaveLength(3);
    expect(queue.adds.map((job) => job.name)).toEqual([
      "surugaya-full-rescan",
      "surugaya-full-rescan",
      "surugaya-full-rescan",
    ]);
    expect(queue.adds[0]).toMatchObject({
      data: {
        adapterKey: "surugaya",
        query: {
          keyword: "仮面ライダー",
          limit: 40,
          pages: 1,
          scanMode: "backfill",
          rotatePages: false,
        },
      },
      options: { jobId: "repeat-surugaya-full-rescan-0" },
    });
  });
});
