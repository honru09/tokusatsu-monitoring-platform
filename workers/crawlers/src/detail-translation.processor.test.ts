import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchTranslationWithRetry,
  DetailTranslationUnavailableError,
  processDetailTranslationBatch,
} from "./detail-translation.processor.js";
import { resetAutomaticAiGuardForTests } from "./background-ai-guard.js";

afterEach(() => {
  resetAutomaticAiGuardForTests();
  vi.unstubAllEnvs();
});

describe("historical item detail translation", () => {
  it("does not inspect the backlog or fetch when background automation is disabled", async () => {
    vi.stubEnv("BACKGROUND_AI_FREE_AUTOMATION_ENABLED", "false");
    vi.stubEnv("BACKGROUND_AI_PAID_AUTOMATION_ENABLED", "false");
    const findPending = vi.fn(async () => [{ id: "must-not-run" }]);
    const countPending = vi.fn(async () => 1);
    const fetcher = vi.fn(async () => Response.json({ translation: {} }));

    await expect(
      processDetailTranslationBatch({
        findPending,
        countPending,
        fetcher,
        apiBaseUrl: "http://api:3001",
      }),
    ).resolves.toEqual({ skipped: "background_automation_not_authorized" });

    expect(findPending).not.toHaveBeenCalled();
    expect(countPending).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("submits every pending historical item in the batch and reports the remaining backlog", async () => {
    const fetcher = vi.fn(
      async (_url: string) =>
        new Response(JSON.stringify({ translation: { id: "translated" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const result = await processDetailTranslationBatch({
      findPending: async (limit) => {
        expect(limit).toBe(4);
        return [{ id: "item-old-1" }, { id: "item-old-2" }];
      },
      countPending: async () => 91,
      fetcher,
      apiBaseUrl: "http://api:3001",
      batchSize: 4,
      wait: async () => undefined,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "http://api:3001/analysis/item/item-old-1?costPolicy=free_only",
      "http://api:3001/analysis/item/item-old-2?costPolicy=free_only",
    ]);
    expect(result).toEqual({ translated: 2, failed: 0, remaining: 91 });
  });

  it("does not multiply a provider-side 503 already handled by the Gateway", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ translation: { id: "item-1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const waits: number[] = [];

    const response = fetchTranslationWithRetry(
      "http://api:3001/analysis/item/item-1",
      fetcher,
      async (milliseconds) => {
        waits.push(milliseconds);
      },
    );

    await expect(response).rejects.toBeInstanceOf(
      DetailTranslationUnavailableError,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it("stops the rest of a batch after the first shared-capacity failure", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('{"code":"AI_GATEWAY_CAPACITY_COOLDOWN"}', {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
    );

    const result = await processDetailTranslationBatch({
      findPending: async () => [
        { id: "item-capacity-1" },
        { id: "item-capacity-2" },
        { id: "item-capacity-3" },
      ],
      countPending: async () => 3,
      fetcher,
      apiBaseUrl: "http://api:3001",
      batchSize: 3,
      wait: async () => undefined,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ translated: 0, failed: 3, remaining: 3 });
  });

  it("does not retry a Gateway outage already handled by backend fallback", async () => {
    const fetcher = vi.fn(
      async (_url: string) =>
        new Response(
          JSON.stringify({
            message: "当前免费 AI 路由均不可用，任务已保留等待后续重试",
            code: "AI_GATEWAY_UNAVAILABLE",
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
    );
    const waits: number[] = [];

    await expect(
      fetchTranslationWithRetry(
        "http://api:3001/analysis/item/item-1",
        fetcher,
        async (milliseconds) => {
          waits.push(milliseconds);
        },
      ),
    ).rejects.toBeInstanceOf(DetailTranslationUnavailableError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it("pauses immediately when the free provider pool is cooling down", async () => {
    const fetcher = vi.fn(
      async (_url: string) =>
        new Response(
          JSON.stringify({
            message: "免费额度或请求频率正在恢复",
            code: "AI_GATEWAY_CAPACITY_COOLDOWN",
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
    );
    const waits: number[] = [];

    await expect(
      fetchTranslationWithRetry(
        "http://api:3001/analysis/item/item-1",
        fetcher,
        async (milliseconds) => {
          waits.push(milliseconds);
        },
      ),
    ).rejects.toMatchObject({
      name: "DetailTranslationUnavailableError",
      code: "AI_GATEWAY_UNAVAILABLE",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });
});
