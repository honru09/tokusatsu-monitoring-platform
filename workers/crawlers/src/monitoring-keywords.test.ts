import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  keywords: vi.fn(),
  keyword: vi.fn(),
  sources: vi.fn(),
  sourceUpsert: vi.fn(),
  getJobs: vi.fn(),
  getJob: vi.fn(),
  add: vi.fn(),
  matchUpsert: vi.fn(),
  matchFirst: vi.fn(),
  itemUpdate: vi.fn(),
  cadence: vi.fn(),
  setCadence: vi.fn(),
}));
vi.mock("@tokusatsu/db", () => {
  const db = {
    monitoringKeyword: {
      count: mocks.count,
      findMany: mocks.keywords,
      findUnique: mocks.keyword,
    },
    source: { findMany: mocks.sources, upsert: mocks.sourceUpsert },
    monitoringKeywordMatch: {
      upsert: mocks.matchUpsert,
      findFirst: mocks.matchFirst,
    },
    item: { update: mocks.itemUpdate },
  };
  return {
    prisma: {
      ...db,
      $transaction: (callback: (tx: typeof db) => unknown) => callback(db),
    },
  };
});
vi.mock("./queues.js", () => ({
  searchQueue: { getJobs: mocks.getJobs, getJob: mocks.getJob, add: mocks.add },
  connection: { get: mocks.cadence, set: mocks.setCadence },
}));
import {
  dispatchMonitoringKeywords,
  initializeMonitoringKeywordSources,
  monitoringSearchJobId,
  recordMonitoringKeywordMatch,
} from "./monitoring-keywords.js";

const keyword = {
  id: "rule-1",
  keyword: "バッグ",
  enabled: true,
  sourceKeys: [] as string[],
  categoryId: "bags",
  updatedAt: new Date("2026-10-08T12:00:00Z"),
  intervalMinutes: 60,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.keywords.mockResolvedValue([keyword]);
  mocks.sources.mockResolvedValue([
    { key: "mercari" },
    { key: "yahoo_fleamarket" },
  ]);
  mocks.getJobs.mockResolvedValue([]);
  mocks.getJob.mockResolvedValue(null);
  mocks.keyword.mockResolvedValue(keyword);
  mocks.matchFirst.mockResolvedValue({ keyword });
});

describe("durable monitoring dispatch", () => {
  it("uses the same revision/window job ID as the API", () => {
    const now = new Date("2026-10-08T12:30:00Z").getTime();
    expect(monitoringSearchJobId(keyword, "mercari", now)).toBe(
      monitoringSearchJobId(keyword, "mercari", now + 60_000),
    );
    expect(monitoringSearchJobId(keyword, "mercari", now + 3_600_000)).not.toBe(
      monitoringSearchJobId(keyword, "mercari", now),
    );
    expect(
      monitoringSearchJobId(
        { ...keyword, updatedAt: new Date(now) },
        "mercari",
        now,
      ),
    ).not.toBe(monitoringSearchJobId(keyword, "mercari", now));
  });
  it("dispatches each enabled platform and carries the rule association", async () => {
    await expect(dispatchMonitoringKeywords()).resolves.toEqual({
      queued: 2,
      skipped: 0,
    });
    expect(mocks.add).toHaveBeenCalledWith(
      "search",
      expect.objectContaining({
        monitoringKeywordId: keyword.id,
        query: expect.objectContaining({ keyword: "バッグ" }),
      }),
      expect.objectContaining({ removeOnComplete: 1000 }),
    );
  });
  it("honors platform selection", async () => {
    mocks.keywords.mockResolvedValue([{ ...keyword, sourceKeys: ["mercari"] }]);
    await expect(dispatchMonitoringKeywords()).resolves.toEqual({
      queued: 1,
      skipped: 0,
    });
    expect(mocks.add.mock.calls[0][1].adapterKey).toBe("mercari");
  });
  it("does not grow a second backlog when the interval changes", async () => {
    mocks.getJobs.mockResolvedValue([
      { data: { monitoringKeywordId: keyword.id, adapterKey: "mercari" } },
    ]);
    await expect(dispatchMonitoringKeywords()).resolves.toEqual({
      queued: 1,
      skipped: 1,
    });
  });
  it("does not repeat a completed job in the same interval", async () => {
    mocks.getJob.mockResolvedValue({ id: "retained" });
    await expect(dispatchMonitoringKeywords()).resolves.toEqual({
      queued: 0,
      skipped: 2,
    });
  });
  it("honors the full interval even across a wall-clock bucket boundary", async () => {
    mocks.cadence.mockResolvedValue("scheduled");
    await expect(dispatchMonitoringKeywords()).resolves.toEqual({
      queued: 0,
      skipped: 2,
    });
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it("does not label an old-query result as a newly edited keyword", async () => {
    mocks.keyword.mockResolvedValue({
      ...keyword,
      normalizedKeyword: "new-brand",
    });
    await expect(
      recordMonitoringKeywordMatch("item-1", keyword.id, "old-brand"),
    ).resolves.toBeNull();
    expect(mocks.matchUpsert).not.toHaveBeenCalled();
  });
  it("retains legacy fallback for an empty library", async () => {
    mocks.count.mockResolvedValue(0);
    await expect(initializeMonitoringKeywordSources()).resolves.toEqual({
      hasConfig: false,
    });
    expect(mocks.sourceUpsert).not.toHaveBeenCalled();
  });
});

describe("current classification destination", () => {
  it("rechecks enabled state before writing a match", async () => {
    mocks.keyword.mockResolvedValue({ ...keyword, enabled: false });
    await expect(
      recordMonitoringKeywordMatch("item-1", keyword.id),
    ).resolves.toBeNull();
    expect(mocks.matchUpsert).not.toHaveBeenCalled();
    expect(mocks.itemUpdate).not.toHaveBeenCalled();
  });
  it("records real query provenance and routes to the most recently edited matching rule", async () => {
    mocks.matchFirst.mockResolvedValue({
      keyword: { ...keyword, id: "newer-rule", categoryId: "new-category" },
    });
    await expect(
      recordMonitoringKeywordMatch("item-1", keyword.id),
    ).resolves.toBe("new-category");
    expect(mocks.matchUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          itemId: "item-1",
          keywordId: keyword.id,
          matchedKeyword: "バッグ",
        },
      }),
    );
    expect(mocks.matchFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ keyword: { updatedAt: "desc" } }, { keywordId: "asc" }],
      }),
    );
    expect(mocks.itemUpdate).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { monitoringCategoryId: "new-category" },
    });
  });
});
