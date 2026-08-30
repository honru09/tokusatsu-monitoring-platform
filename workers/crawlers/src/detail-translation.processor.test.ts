import { describe, expect, it, vi } from "vitest";
import {
  fetchTranslationWithRetry,
  DetailTranslationUnavailableError,
  processDetailTranslationBatch,
} from "./detail-translation.processor.js";

describe("historical item detail translation", () => {
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
      "http://api:3001/analysis/item/item-old-1",
      "http://api:3001/analysis/item/item-old-2",
    ]);
    expect(result).toEqual({ translated: 2, failed: 0, remaining: 91 });
  });

  it("retries transient Gateway/API failures without dropping the item", async () => {
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

    const response = await fetchTranslationWithRetry(
      "http://api:3001/analysis/item/item-1",
      fetcher,
      async (milliseconds) => {
        waits.push(milliseconds);
      },
    );

    expect(response.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([2_000]);
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
});
