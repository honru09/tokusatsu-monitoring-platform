import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@tokusatsu/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MonitoringConfigService,
  monitoringSearchJobId,
  normalizeMonitoringKeyword,
} from "./monitoring-config.service.js";

const queueMock = vi.hoisted(() => ({
  add: vi.fn(),
  getJob: vi.fn(),
  getJobs: vi.fn(),
  close: vi.fn(),
  disconnect: vi.fn(),
  setCadence: vi.fn(),
}));
vi.mock("bullmq", () => ({
  Queue: class {
    add = queueMock.add;
    getJob = queueMock.getJob;
    getJobs = queueMock.getJobs;
    close = queueMock.close;
  },
}));
vi.mock("ioredis", () => ({
  Redis: class {
    disconnect = queueMock.disconnect;
    set = queueMock.setCadence;
  },
}));

const updatedAt = new Date("2026-10-08T03:00:00.000Z");
function keyword(overrides: Record<string, unknown> = {}) {
  return {
    id: "keyword-1",
    keyword: "仮面ライダー",
    normalizedKeyword: "仮面ライダー",
    categoryId: "category-1",
    sourceKeys: [] as string[],
    enabled: true,
    intervalMinutes: 60,
    createdAt: updatedAt,
    updatedAt,
    category: { id: "category-1", name: "假面骑士", scope: "toys" },
    _count: { matches: 0 },
    ...overrides,
  };
}

function fixture() {
  const prisma = {
    managerAccount: { findFirst: vi.fn().mockResolvedValue({ id: "dragon" }) },
    monitoringCategory: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({
        id: "category-1",
        name: "假面骑士",
        parentId: null,
        scope: "toys",
      }),
      create: vi.fn().mockImplementation(async (args) => ({
        id: "category-new",
        ...args.data,
      })),
      update: vi.fn().mockImplementation(async (args) => ({
        id: args.where.id,
        ...args.data,
      })),
      count: vi.fn().mockResolvedValue(0),
    },
    monitoringKeyword: {
      findMany: vi.fn().mockResolvedValue([keyword()]),
      findUnique: vi.fn().mockResolvedValue(keyword()),
      create: vi.fn().mockImplementation(async (args) => keyword(args.data)),
      update: vi.fn().mockImplementation(async (args) => keyword(args.data)),
    },
    monitoringKeywordMatch: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn(),
    },
    source: {
      findMany: vi.fn().mockResolvedValue([
        { key: "mercari", displayName: "Mercari", enabled: true },
        { key: "yahoo_auctions", displayName: "Yahoo!", enabled: true },
      ]),
      count: vi
        .fn()
        .mockImplementation(async (args) => args.where.key.in.length),
    },
    item: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    manualReview: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((action) => action(prisma));
  prisma.monitoringKeywordMatch.findMany.mockImplementation(async (args) =>
    args.where.itemId.in.map((itemId: string) => ({
      itemId,
      keyword: {
        categoryId:
          prisma.monitoringKeyword.update.mock.calls.at(-1)?.[0]?.data
            .categoryId ?? "category-1",
      },
    })),
  );
  return { prisma, service: new MonitoringConfigService(prisma as never) };
}

describe("Monitoring keyword configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(updatedAt);
    queueMock.add.mockImplementation(async (_name, _data, opts) => ({
      id: opts.jobId,
    }));
    queueMock.getJob.mockResolvedValue(undefined);
    queueMock.getJobs.mockResolvedValue([]);
    queueMock.close.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it("canonicalizes width, whitespace and case without losing the displayed keyword", () => {
    expect(normalizeMonitoringKeyword("  ＳＨＦ\n 仮面ライダー  ")).toEqual({
      keyword: "SHF 仮面ライダー",
      normalizedKeyword: "shf 仮面ライダー",
    });
    expect(() => normalizeMonitoringKeyword(" ")).toThrow(BadRequestException);
    expect(() => normalizeMonitoringKeyword("x".repeat(161))).toThrow(
      BadRequestException,
    );
    expect(() => normalizeMonitoringKeyword(null)).toThrow(BadRequestException);
  });

  it("deduplicates one keyword/platform/revision within its monitoring window", () => {
    const row = keyword();
    expect(monitoringSearchJobId(row, "mercari", updatedAt.getTime())).toBe(
      monitoringSearchJobId(row, "mercari", updatedAt.getTime() + 59_000),
    );
    expect(monitoringSearchJobId(row, "mercari", updatedAt.getTime())).not.toBe(
      monitoringSearchJobId(row, "mercari", updatedAt.getTime() + 60 * 60_000),
    );
    expect(monitoringSearchJobId(row, "mercari")).not.toBe(
      monitoringSearchJobId(
        { ...row, updatedAt: new Date(updatedAt.getTime() + 1) },
        "mercari",
      ),
    );
  });

  it("returns persisted keywords, platform eligibility and true latest-run facts", async () => {
    const { prisma, service } = fixture();
    prisma.$queryRaw.mockResolvedValue([
      {
        keywordId: "keyword-1",
        status: "failed",
        startedAt: updatedAt,
        finishedAt: updatedAt,
        errorText: "private upstream details",
      },
    ]);
    const result = await service.get();
    expect(result.keywords[0]).toMatchObject({
      lastRunAt: updatedAt,
      lastRunStatus: "failed",
      lastRunError: "最近扫描未完成，可重试",
    });
    expect(JSON.stringify(result)).not.toContain("private upstream details");
    expect(prisma.source.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          comparisonOnly: false,
          channel: "online",
        }),
      }),
    );
    const allowed = prisma.source.findMany.mock.calls[0]![0].where.key.in;
    expect(allowed).not.toContain("mock");
    expect(allowed).not.toContain("public_page");
    expect(allowed).not.toContain("playwright_page");
  });

  it("requires a real active manager before any writes", async () => {
    const { prisma, service } = fixture();
    prisma.managerAccount.findFirst.mockResolvedValue(null);
    await expect(
      service.createKeyword({
        accountId: "outsider",
        keyword: "SHF",
        categoryId: "category-1",
      }),
    ).rejects.toThrow("管理者账号无效");
    expect(prisma.monitoringKeyword.create).not.toHaveBeenCalled();
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it("inherits a general parent's scope and accepts a null root parent", async () => {
    const { prisma, service } = fixture();
    prisma.monitoringCategory.findUnique.mockResolvedValue({
      id: "bags",
      parentId: null,
      scope: "general",
      name: "包",
    });
    const child = await service.createCategory({
      accountId: "dragon",
      name: " COACH ",
      parentId: "bags",
    });
    expect(child).toMatchObject({
      name: "COACH",
      scope: "general",
      parentId: "bags",
    });
    const root = await service.createCategory({
      accountId: "dragon",
      name: "包",
      parentId: null,
      scope: "general",
    });
    expect(root).toMatchObject({ scope: "general", parentId: null });
  });

  it("rejects category cycles and mixing toy/general parent scopes", async () => {
    const { prisma, service } = fixture();
    await expect(
      service.updateCategory("category-1", {
        accountId: "dragon",
        parentId: "category-1",
      }),
    ).rejects.toThrow("分类层级不能循环");
    prisma.monitoringCategory.findUnique.mockResolvedValue({
      id: "bags",
      parentId: null,
      scope: "general",
    });
    await expect(
      service.createCategory({
        accountId: "dragon",
        name: "DX",
        parentId: "bags",
        scope: "toys",
      }),
    ).rejects.toThrow("子分类需与上级分类范围一致");
  });

  it("saves and dispatches only selected eligible platforms immediately", async () => {
    const { prisma, service } = fixture();
    const result = await service.createKeyword({
      accountId: "dragon",
      keyword: "  ＣＯＡＣＨ  ",
      categoryId: "category-1",
      sourceKeys: ["mercari"],
    });
    expect(prisma.monitoringKeyword.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          keyword: "COACH",
          normalizedKeyword: "coach",
          intervalMinutes: 60,
          enabled: true,
        }),
      }),
    );
    expect(result.dispatch.queued).toBe(1);
    expect(queueMock.add).toHaveBeenCalledWith(
      "search",
      expect.objectContaining({
        monitoringKeywordId: "keyword-1",
        adapterKey: "mercari",
        query: {
          keyword: "COACH",
          limit: 100,
          scanMode: "incremental",
          highPriority: true,
        },
      }),
      expect.objectContaining({ attempts: 4 }),
    );
  });

  it("rejects nonsearchable, unknown and invalid-rate selections", async () => {
    const { prisma, service } = fixture();
    await expect(
      service.createKeyword({
        accountId: "dragon",
        keyword: "SHF",
        categoryId: "category-1",
        sourceKeys: ["mock"],
      }),
    ).rejects.toThrow("可搜索的线上平台");
    prisma.source.count.mockResolvedValue(0);
    await expect(
      service.createKeyword({
        accountId: "dragon",
        keyword: "SHF",
        categoryId: "category-1",
        sourceKeys: ["mercari"],
      }),
    ).rejects.toThrow("所选平台不存在");
    await expect(
      service.createKeyword({
        accountId: "dragon",
        keyword: "SHF",
        categoryId: "category-1",
        intervalMinutes: 1,
      }),
    ).rejects.toThrow("15至1440");
  });

  it("keeps a successful save while reporting an enqueue outage without secrets", async () => {
    const { prisma, service } = fixture();
    queueMock.add.mockRejectedValue(new Error("private Redis credential"));
    const result = await service.createKeyword({
      accountId: "dragon",
      keyword: "SHF",
      categoryId: "category-1",
    });
    expect(prisma.monitoringKeyword.create).toHaveBeenCalledOnce();
    expect(result.dispatch.error).toBe("配置已保存，监控调度暂不可用");
    expect(JSON.stringify(result)).not.toContain("credential");
  });

  it("does not duplicate pending or retained jobs", async () => {
    const { service } = fixture();
    queueMock.getJob.mockResolvedValue({
      id: "already",
      getState: vi.fn().mockResolvedValue("completed"),
    });
    const result = await service.run("keyword-1", "dragon");
    expect(result).toMatchObject({ queued: 0, skipped: 2 });
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it("does not dispatch disabled keywords", async () => {
    const { prisma, service } = fixture();
    prisma.monitoringKeyword.findUnique.mockResolvedValue(
      keyword({ enabled: false }),
    );
    expect(await service.run("keyword-1", "dragon")).toMatchObject({
      queued: 0,
      skipped: 1,
    });
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it("migrates only recorded keyword matches when a target changes, including null categories", async () => {
    const { prisma, service } = fixture();
    prisma.item.findMany.mockResolvedValue([
      { id: "matched-item", monitoringCategoryId: null },
    ]);
    const result = await service.updateKeyword("keyword-1", {
      accountId: "dragon",
      categoryId: "category-new",
    });
    expect(prisma.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          monitoringKeywordMatches: { some: { keywordId: "keyword-1" } },
          OR: expect.arrayContaining([{ monitoringCategoryId: null }]),
        }),
      }),
    );
    expect(prisma.item.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["matched-item"] } },
      data: { monitoringCategoryId: "category-new" },
    });
    expect(prisma.manualReview.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          actor: "dragon",
          reason: "monitoring_keyword_target_changed",
          beforeData: { monitoringCategoryId: null },
          afterData: { monitoringCategoryId: "category-new" },
        }),
      ],
    });
    expect(result.movedItems).toBe(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: "Serializable" }),
    );
  });

  it("does not recategorize listings merely when enabling or editing a keyword", async () => {
    const { prisma, service } = fixture();
    await service.updateKeyword("keyword-1", {
      accountId: "dragon",
      enabled: false,
      keyword: "仮面ライダー DX",
    });
    expect(prisma.item.findMany).not.toHaveBeenCalled();
    expect(prisma.item.updateMany).not.toHaveBeenCalled();
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it("reindexes only the explicitly requested literal keyword and audits existing inventory moves", async () => {
    const { prisma, service } = fixture();
    prisma.monitoringKeyword.findUnique.mockResolvedValue(
      keyword({ keyword: "COACH 100%", sourceKeys: ["mercari"] }),
    );
    prisma.item.findMany
      .mockResolvedValueOnce([{ id: "bag-1", monitoringCategoryId: null }])
      .mockResolvedValueOnce([]);
    expect(await service.reindex("keyword-1", "dragon")).toEqual({
      matched: 1,
      moved: 1,
    });
    expect(prisma.item.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          lifecycleStatus: "live",
          ignored: false,
          source: { key: { in: ["mercari"] } },
          AND: expect.arrayContaining([
            {
              OR: [
                { titleRaw: { contains: "100\\%", mode: "insensitive" } },
                { descriptionRaw: { contains: "100\\%", mode: "insensitive" } },
              ],
            },
          ]),
        }),
      }),
    );
    expect(prisma.monitoringKeywordMatch.createMany).toHaveBeenCalledWith({
      data: [
        {
          itemId: "bag-1",
          keywordId: "keyword-1",
          matchedKeyword: "COACH 100%",
        },
      ],
      skipDuplicates: true,
    });
    expect(prisma.manualReview.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          actor: "dragon",
          reason: "monitoring_keyword_reindex",
        }),
      ],
    });
  });

  it("reports duplicate persistence and missing records with domain errors", async () => {
    const { prisma, service } = fixture();
    prisma.monitoringKeyword.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "6.19.3",
      }),
    );
    await expect(
      service.createKeyword({
        accountId: "dragon",
        keyword: "SHF",
        categoryId: "category-1",
      }),
    ).rejects.toThrow(ConflictException);
    prisma.monitoringKeyword.findUnique.mockResolvedValue(null);
    await expect(service.run("missing", "dragon")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("closes the queue and redis connection during API shutdown", async () => {
    const { service } = fixture();
    await service.run("keyword-1", "dragon");
    await service.onModuleDestroy();
    expect(queueMock.close).toHaveBeenCalledOnce();
    expect(queueMock.disconnect).toHaveBeenCalledOnce();
  });

  it("does not launch the same keyword/platform again across a time-window boundary", async () => {
    const { service } = fixture();
    queueMock.getJobs.mockResolvedValue([
      {
        id: "previous-window",
        data: { monitoringKeywordId: "keyword-1", adapterKey: "mercari" },
      },
    ]);
    const result = await service.run("keyword-1", "dragon");
    expect(result).toMatchObject({ queued: 1, skipped: 1 });
    expect(queueMock.add.mock.calls[0]?.[1].adapterKey).toBe("yahoo_auctions");
  });

  it("allows an explicitly requested retry of a failed current-window task", async () => {
    const { service } = fixture();
    const remove = vi.fn().mockResolvedValue(undefined);
    queueMock.getJob.mockResolvedValue({
      id: "failed",
      getState: vi.fn().mockResolvedValue("failed"),
      remove,
    });
    expect(await service.run("keyword-1", "dragon")).toMatchObject({
      queued: 2,
      skipped: 0,
    });
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("aggregates real active child counts into parents without using historical totals", async () => {
    const { prisma, service } = fixture();
    prisma.monitoringCategory.findMany.mockResolvedValue([
      { id: "toys", parentId: null, _count: { items: 300 } },
      { id: "rider", parentId: "toys", _count: { items: 200 } },
      { id: "shf", parentId: "rider", _count: { items: 100 } },
    ]);
    prisma.item.groupBy.mockResolvedValue([
      { monitoringCategoryId: "rider", _count: { _all: 5 } },
      { monitoringCategoryId: "shf", _count: { _all: 3 } },
    ]);
    const result = await service.get();
    expect(result.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "toys",
          activeItems: 8,
          activeItemCount: 8,
        }),
        expect.objectContaining({ id: "rider", activeItems: 8 }),
        expect.objectContaining({ id: "shf", activeItems: 3 }),
      ]),
    );
    expect(prisma.item.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ignored: false,
          lifecycleStatus: "live",
        }),
      }),
    );
  });

  it("keeps the newest recorded keyword target during an older keyword reindex", async () => {
    const { prisma, service } = fixture();
    prisma.item.findMany
      .mockResolvedValueOnce([
        { id: "matched-item", monitoringCategoryId: null },
      ])
      .mockResolvedValueOnce([]);
    prisma.monitoringKeywordMatch.findMany.mockResolvedValue([
      { itemId: "matched-item", keyword: { categoryId: "newer-category" } },
      { itemId: "matched-item", keyword: { categoryId: "category-1" } },
    ]);
    expect(await service.reindex("keyword-1", "dragon")).toEqual({
      matched: 1,
      moved: 1,
    });
    expect(prisma.item.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["matched-item"] } },
      data: { monitoringCategoryId: "newer-category" },
    });
    expect(prisma.monitoringKeywordMatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          itemId: { in: ["matched-item"] },
          keyword: { enabled: true },
        },
        orderBy: [{ keyword: { updatedAt: "desc" } }, { keywordId: "asc" }],
      }),
    );
  });

  it("rejects indirect parent loops before persisting a category move", async () => {
    const { prisma, service } = fixture();
    prisma.monitoringCategory.findUnique.mockImplementation(
      async ({ where }) => ({
        id: where.id,
        parentId: where.id === "child" ? "category-1" : null,
        scope: "toys",
      }),
    );
    await expect(
      service.updateCategory("category-1", {
        accountId: "dragon",
        parentId: "child",
      }),
    ).rejects.toThrow("分类层级不能循环");
    expect(prisma.monitoringCategory.update).not.toHaveBeenCalled();
  });
});
