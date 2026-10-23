import { afterEach, describe, expect, it, vi } from "vitest";
import { ResalePublisher } from "./resale-publisher.js";

describe("resale bridge contracts", () => {
  const publisher = new ResalePublisher();
  const payload = {
    id: "internal-1",
    version: 1,
    title: "真实标题",
    description: "有划痕",
    priceCny: 80,
    imageUrls: ["https://example.com/image.jpg"],
    deliveryText: "实际交付条件",
    sourceUrl: "https://jp.mercari.com/item/1",
    targetItemId: null,
  };
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  function bridge() {
    vi.stubEnv("RESALE_PUBLISHER_URL", "https://bridge.test/v1");
    vi.stubEnv("RESALE_PUBLISHER_TOKEN", "test-only");
    vi.stubEnv("RESALE_PUBLISHER_CAPABILITIES", "bump,reprice,metrics");
  }
  it("requires publishing receipts to match the actual item link", async () => {
    bridge();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "published",
            targetItemId: "1",
            targetUrl: "https://www.goofish.com/item?id=2",
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      publisher.execute("publish", payload, "operation-1"),
    ).rejects.toThrow("无法确认");
    expect(fetchMock.mock.calls[0]![1].headers["idempotency-key"]).toBe(
      "operation-1",
    );
  });
  it("refuses a reprice receipt with the wrong value or item", async () => {
    bridge();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              status: "succeeded",
              targetItemId: "1",
              priceCny: 81,
            }),
          ),
        ),
    );
    await expect(
      publisher.sellerAction("reprice", "1", "task-1", 80),
    ).rejects.toThrow("无法确认");
  });
  it("reads nullable actual metrics and sends no request for undeclared capabilities", async () => {
    bridge();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            targetItemId: "1",
            observedAt: new Date().toISOString(),
            views: 0,
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect(await publisher.pullMetrics("1")).toMatchObject({
      views: 0,
      wants: null,
    });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "https://bridge.test/v1/seller/items/1/metrics",
    );
    vi.stubEnv("RESALE_PUBLISHER_CAPABILITIES", "");
    await expect(publisher.sellerAction("bump", "1", "task-1")).rejects.toThrow(
      "未声明",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
