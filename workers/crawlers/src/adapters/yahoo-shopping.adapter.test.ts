import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseYahooShoppingResponse,
  YahooShoppingAdapter,
  YahooShoppingRequestGate,
} from "./yahoo-shopping.adapter.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Yahoo Shopping adapter", () => {
  it("maps official API hits to direct product details", () => {
    const result = parseYahooShoppingResponse({
      hits: [
        {
          Code: "shop-rider-belt",
          Name: "仮面ライダー DX 変身ベルト まとめ売り",
          Url: "https://store.shopping.yahoo.co.jp/shop/rider-belt.html",
          Price: 3980,
          Image: { Medium: "https://item-shopping.c.yimg.jp/i/g/rider.jpg" },
          Seller: { Name: "玩具専門店" },
          Shipping: { Name: "送料無料", Code: 1 },
        },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.detailHint).toMatchObject({
      sourcePlatform: "yahoo_shopping",
      listingType: "direct",
      priceCurrent: 3980,
      shippingFee: 0,
      status: "active",
      channel: "online",
    });
  });

  it("uses Yahoo's documented shipping code 2 for free shipping", () => {
    const result = parseYahooShoppingResponse({
      hits: [
        {
          code: "shop-item",
          name: "仮面ライダー DXベルト",
          url: "https://store.shopping.yahoo.co.jp/shop/item.html",
          price: 4000,
          shipping: { name: "設定なし", code: 1 },
        },
        {
          code: "shop-free-item",
          name: "ウルトラマン ソフビ",
          url: "https://store.shopping.yahoo.co.jp/shop/free-item.html",
          price: 3000,
          shipping: { name: "送料無料", code: 2 },
        },
      ],
    });

    expect(result[0]?.detailHint?.shippingFee).toBeUndefined();
    expect(result[1]?.detailHint?.shippingFee).toBe(0);
  });

  it("serializes concurrent requests through one process-wide rate gate", async () => {
    let now = 10_000;
    const waits: number[] = [];
    const starts: number[] = [];
    const gate = new YahooShoppingRequestGate({
      now: () => now,
      wait: async (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
      },
    });

    await Promise.all([
      gate.run(1_100, async () => starts.push(now)),
      gate.run(1_100, async () => starts.push(now)),
      gate.run(1_100, async () => starts.push(now)),
    ]);

    expect(starts).toEqual([10_000, 11_100, 12_200]);
    expect(waits).toEqual([1_100, 1_100]);
  });

  it("requests only in-stock used products from the official search API", async () => {
    vi.stubEnv("YAHOO_SHOPPING_CLIENT_ID", "test-client-id");
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json({ hits: [] }),
    );
    const adapter = new YahooShoppingAdapter({
      fetchImpl: fetchMock as unknown as typeof fetch,
      requestGate: new YahooShoppingRequestGate({ wait: async () => {} }),
    });

    await adapter.search({ keyword: "仮面ライダー", limit: 10 });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("condition")).toBe("used");
    expect(requestUrl.searchParams.get("in_stock")).toBe("true");
  });
});
