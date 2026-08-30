import { describe, expect, it, vi } from "vitest";
import { SystemToolRegistryService } from "./system-tool-registry.service.js";

describe("SystemToolRegistryService fallback selection", () => {
  const registry = new SystemToolRegistryService({} as never, {} as never);

  it("does not attach queues and error logs to an ordinary system question", () => {
    const selection = registry.fallbackSelection("当前系统商品总数是多少？");

    expect(selection).toContain("system_health");
    expect(selection).toContain("inventory_summary");
    expect(selection).not.toContain("search_products");
    expect(selection).not.toContain("queue_status");
    expect(selection).not.toContain("recent_system_errors");
  });

  it("loads operational details only when the question asks for them", () => {
    expect(registry.fallbackSelection("Worker 队列是否异常失败？")).toEqual(
      expect.arrayContaining(["queue_status", "recent_system_errors"]),
    );
  });

  it("treats an AI model status question as operations, not merchandise", () => {
    expect(registry.fallbackSelection("AI 模型现在怎么样")).toEqual([
      "ai_system_status",
    ]);
  });
});

describe("SystemToolRegistryService execution", () => {
  const snapshot = {
    generatedAt: "2026-08-30T00:00:00.000Z",
    inventory: { totalListings: 3, activeListings: 2, newProducts24h: 1 },
    crawlers: { jobs24h: { completed: 1 }, sources: [] },
    ai: { tasksToday: [], models: [], providerStates: [] },
    queues: { status: "ok", counts: [] },
    market: { intel24h: 0, keywords: [] },
    recentErrors: { crawler: [], ai: [] },
    recentUserActivity: {
      favorites24h: 0,
      purchases24h: 0,
      discovery: [],
    },
  };

  it("reuses one precomputed snapshot for every snapshot-backed tool", async () => {
    const context = { snapshot: vi.fn().mockResolvedValue(snapshot) };
    const registry = new SystemToolRegistryService(
      {} as never,
      context as never,
    );

    const results = await registry.execute(
      [
        "crawler_status",
        "system_health",
        "worker_status",
        "queue_status",
        "service_status",
        "ai_task_queue",
      ],
      "系统现在怎么样",
      Promise.resolve(snapshot as never),
    );

    expect(context.snapshot).not.toHaveBeenCalled();
    expect(results).toHaveLength(6);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it("returns provider cooldown and quota state from ai_system_status", async () => {
    const future = new Date(Date.now() + 60_000);
    const prisma = {
      aiProviderState: {
        findMany: vi.fn().mockResolvedValue([
          {
            provider: "gemini",
            status: "cooldown",
            cooldownUntil: future,
            quotaResetAt: future,
            remainingRequests: 0,
            remainingTokens: 120,
            lastErrorCode: "RATE_LIMIT",
            consecutiveFailures: 2,
            updatedAt: new Date(),
          },
        ]),
      },
      aiModelState: { findMany: vi.fn().mockResolvedValue([]) },
      aiRun: { groupBy: vi.fn().mockResolvedValue([]) },
    };
    const registry = new SystemToolRegistryService(
      prisma as never,
      { snapshot: vi.fn() } as never,
    );

    const [result] = await registry.execute(
      ["ai_system_status"],
      "AI 模型现在怎么样",
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          providers: expect.arrayContaining([
            expect.objectContaining({
              provider: "gemini",
              status: "cooldown",
              cooldownUntil: future,
              quotaResetAt: future,
              remainingRequests: 0,
              remainingTokens: 120,
              consecutiveFailures: 2,
            }),
          ]),
        }),
      }),
    );
  });

  it("groups usage by provider and excludes stale cache rows", async () => {
    const usageGroupBy = vi.fn().mockResolvedValue([]);
    const cacheCount = vi.fn().mockResolvedValue(0);
    const cacheGroupBy = vi.fn().mockResolvedValue([]);
    const prisma = {
      aiRun: { groupBy: usageGroupBy },
      aiCache: { count: cacheCount, groupBy: cacheGroupBy },
    };
    const registry = new SystemToolRegistryService(
      prisma as never,
      {} as never,
    );

    await registry.execute(
      ["ai_usage_stats", "ai_cache_stats"],
      "AI 用量和缓存",
    );

    expect(usageGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["provider", "requestedModel", "status"],
      }),
    );
    const activeCacheWhere = {
      provider: { not: null },
      expiresAt: { gt: expect.any(Date) },
    };
    expect(cacheCount).toHaveBeenCalledWith({ where: activeCacheWhere });
    expect(cacheGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: activeCacheWhere }),
    );
  });
});
