import { describe, expect, it, vi } from "vitest";
import { SystemContextService } from "./system-context.service.js";

describe("SystemContextService AI snapshot", () => {
  it("excludes legacy cache rows and exposes provider quota state", async () => {
    const future = new Date(Date.now() + 60_000);
    const cacheCount = vi.fn().mockResolvedValue(2);
    const prisma = {
      item: {
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      source: { findMany: vi.fn().mockResolvedValue([]) },
      crawlJob: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      aiRun: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      aiModelState: { findMany: vi.fn().mockResolvedValue([]) },
      aiProviderState: {
        findMany: vi.fn().mockResolvedValue([
          {
            provider: "groq",
            status: "cooldown",
            cooldownUntil: future,
            quotaResetAt: future,
            remainingRequests: 0,
            remainingTokens: 50,
            lastErrorCode: "RATE_LIMIT",
            consecutiveFailures: 1,
            updatedAt: new Date(),
          },
        ]),
      },
      aiCache: { count: cacheCount },
      marketIntel: { count: vi.fn().mockResolvedValue(0) },
      keywordInsight: { findMany: vi.fn().mockResolvedValue([]) },
      purchaseRecord: { count: vi.fn().mockResolvedValue(0) },
      discoveryFeedback: { groupBy: vi.fn().mockResolvedValue([]) },
    };
    const service = new SystemContextService(prisma as never);
    (
      service as unknown as {
        queueSnapshot(): Promise<{ status: string; counts: never[] }>;
      }
    ).queueSnapshot = vi.fn().mockResolvedValue({ status: "ok", counts: [] });

    const snapshot = await service.snapshot();

    expect(cacheCount).toHaveBeenCalledWith({
      where: {
        expiresAt: { gt: expect.any(Date) },
        provider: { not: null },
      },
    });
    expect(snapshot.ai.cacheEntries).toBe(2);
    expect(snapshot.ai.providerStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "groq",
          cooldownUntil: future,
          quotaResetAt: future,
          remainingRequests: 0,
          remainingTokens: 50,
        }),
      ]),
    );
  });
});
