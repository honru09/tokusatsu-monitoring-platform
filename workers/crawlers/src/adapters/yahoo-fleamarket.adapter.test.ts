import { describe, expect, it, vi } from "vitest";
import {
  YahooFleamarketAdapter,
  YahooFleamarketRequestGate,
  isYahooFleamarketPlaceholderSellerName,
  parseYahooFleamarketDetailHtml,
  parseYahooFleamarketSearchHtml,
  yahooFleamarketRetryAfterMs,
} from "./yahoo-fleamarket.adapter.js";

function detailPage(sourceItemId: string) {
  return `<script id="__NEXT_DATA__">${JSON.stringify({
    props: {
      initialState: {
        itemsState: {
          items: {
            item: {
              id: sourceItemId,
              title: `仮面ライダー ${sourceItemId}`,
              price: 4200,
              status: "OPEN",
              seller: { id: `seller-${sourceItemId}`, nickname: "ジョー" },
              images: [],
            },
          },
        },
      },
    },
  })}</script>`;
}

function mockedResponse(
  url: string,
  status: number,
  body: string,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers(headers),
    text: vi.fn(async () => body),
    arrayBuffer: vi.fn(async () => new TextEncoder().encode(body).buffer),
  } as unknown as Response;
}

describe("Yahoo! Fleamarket parsing", () => {
  it("recognizes an explicit removed-page notice without hydration state", async () => {
    const adapter = new YahooFleamarketAdapter({
      fetchImpl: vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        return mockedResponse(
          url,
          200,
          url.endsWith("robots.txt")
            ? "User-agent: *\nAllow: /"
            : "<h1>商品が見つかりません</h1>",
        );
      }) as typeof fetch,
      requestGate: new YahooFleamarketRequestGate(),
    });
    await expect(
      adapter.refreshStatus({
        sourceItemId: "z100",
        sourceUrl: "https://paypayfleamarket.yahoo.co.jp/item/z100",
        status: "active",
      }),
    ).resolves.toEqual({ status: "ended", listingType: "direct" });
  });
  it("does not assume sold when an item has an unrecognized state", () => {
    const html = detailPage("z100").replace(
      '"status":"OPEN"',
      '"status":"NEW_UNKNOWN_STATE"',
    );
    expect(
      parseYahooFleamarketDetailHtml(
        html,
        "https://paypayfleamarket.yahoo.co.jp/item/z100",
        "z100",
      ).status,
    ).toBe("unknown");
  });

  it("uses the purchase flag even when a search row still says OPEN", () => {
    const state = {
      props: {
        initialState: {
          searchState: {
            search: {
              result: {
                items: [
                  {
                    id: "z100",
                    title: "SHF 仮面ライダー",
                    price: 3000,
                    itemStatus: "OPEN",
                    isPurchased: true,
                  },
                ],
              },
            },
          },
        },
      },
    };
    const [result] = parseYahooFleamarketSearchHtml(
      `<script id="__NEXT_DATA__">${JSON.stringify(state)}</script>`,
    );
    expect(result.detailHint?.status).toBe("sold");
  });
  it("turns a removed listing page into a sold status", async () => {
    const adapter = new YahooFleamarketAdapter();
    (adapter as unknown as { fetchDetail: () => Promise<never> }).fetchDetail =
      async () => {
        throw new Error("Yahoo! Fleamarket returned 410");
      };
    await expect(
      adapter.refreshStatus({
        sourceItemId: "z100",
        sourceUrl: "https://paypayfleamarket.yahoo.co.jp/item/z100",
        status: "active",
      }),
    ).resolves.toEqual({ status: "sold", listingType: "direct" });
  });

  it("filters card results before detail crawling", () => {
    const state = {
      props: {
        initialState: {
          searchState: {
            search: {
              result: {
                items: [
                  {
                    id: "z100",
                    title: "仮面ライダー DXベルト まとめ売り",
                    price: 4200,
                    itemStatus: "OPEN",
                    openTime: "2026-08-30T00:00:00+09:00",
                    thumbnailImageUrl:
                      "https://auctions.c.yimg.jp/images.auctions.yahoo.co.jp/image/dr000/auc1/users/u/i-img1200x900-1.jpg",
                    category: { path: [{ name: "おもちゃ" }] },
                    sellerId: "p1",
                    seller: { goodRatio: 100, numRating: 20 },
                    condition: "used10",
                  },
                  {
                    id: "z101",
                    title: "仮面ライダー トレーディングカード",
                    price: 500,
                    itemStatus: "OPEN",
                  },
                ],
              },
            },
          },
        },
      },
    };
    const results = parseYahooFleamarketSearchHtml(
      `<script id="__NEXT_DATA__">${JSON.stringify(state)}</script>`,
    );
    expect(results).toHaveLength(1);
    expect(results[0].detailHint).toMatchObject({
      shippingFee: 0,
      status: "active",
      sellerProfileUrl: "https://paypayfleamarket.yahoo.co.jp/user/p1",
      sellerData: { sellerId: "p1" },
    });
    expect(results[0].detailHint?.sellerName).toBeUndefined();
  });

  it("preserves full public item, seller, shipping and gallery data", () => {
    const item = {
      id: "z100",
      title: "仮面ライダー DXベルト まとめ売り",
      description: "動作確認済み。付属品は写真の5点です。",
      price: 4200,
      createDate: "2026-08-30T00:00:00+09:00",
      images: [
        {
          url: "https://auctions.c.yimg.jp/images.auctions.yahoo.co.jp/image/dr000/auc1/users/u/i-img1200x900-1.jpg",
        },
        {
          url: "https://auctions.c.yimg.jp/images.auctions.yahoo.co.jp/image/dr000/auc1/users/u/i-img1200x900-2.jpg",
        },
      ],
      media: [
        {
          type: "image",
          content: {
            url: "https://auctions.c.yimg.jp/images.auctions.yahoo.co.jp/image/dr000/auc1/users/u/i-img1200x900-1.jpg",
          },
        },
        {
          type: "image",
          content: {
            url: "https://auctions.c.yimg.jp/images.auctions.yahoo.co.jp/image/dr000/auc1/users/u/i-img1200x900-2.jpg",
          },
        },
      ],
      seller: {
        id: "p1",
        nickname: "ジョー",
        rating: { total: 641, goodRatio: 100 },
        tradingRecord: { displayLabel: "取引実績99+" },
        image: { url: "https://displayname-pctr.c.yimg.jp/avatar.jpg" },
        isKycCompleted: true,
        isTrusted: true,
      },
      condition: { key: "used10", text: "目立った傷や汚れなし" },
      location: "TOKYO",
      status: "OPEN",
      isPurchased: false,
      categoryList: [{ name: "フィギュア" }],
      brandList: [{ name: "BANDAI" }],
      deliveryMethod: { name: "おてがる配送" },
      deliverySchedule: { text: "2〜3日で発送" },
    };
    const state = {
      props: {
        initialState: { itemsState: { items: { item } } },
      },
    };
    const detail = parseYahooFleamarketDetailHtml(
      `<script id="__NEXT_DATA__">${JSON.stringify(state)}</script>`,
      "https://paypayfleamarket.yahoo.co.jp/item/z100",
      "z100",
    );
    expect(detail).toMatchObject({
      sellerName: "ジョー",
      shippingFee: 0,
      conditionRaw: "目立った傷や汚れなし",
      status: "active",
    });
    expect(detail.imageUrls).toHaveLength(2);
    expect(
      (detail.sourceData as { item?: { imageCount?: number } }).item
        ?.imageCount,
    ).toBe(2);
    expect(detail.sellerData).toMatchObject({
      sellerId: "p1",
      nickname: "ジョー",
      isKycCompleted: true,
      image: { url: "https://displayname-pctr.c.yimg.jp/avatar.jpg" },
    });
  });

  it("never promotes a marketplace placeholder to a seller identity", () => {
    expect(isYahooFleamarketPlaceholderSellerName("Yahoo!フリマ")).toBe(true);
    expect(
      isYahooFleamarketPlaceholderSellerName("Yahoo!フリマ出品者 p188926"),
    ).toBe(true);
    expect(isYahooFleamarketPlaceholderSellerName("ジョー")).toBe(false);
  });

  it("serializes concurrent platform calls and shares Retry-After with queued status refreshes", async () => {
    let now = 0;
    const waits: number[] = [];
    const requestGate = new YahooFleamarketRequestGate({
      now: () => now,
      wait: async (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
      },
    });
    const itemAttempts = new Map<string, number>();
    const itemRequestTimes: Array<{ sourceItemId: string; at: number }> = [];
    let activeItemRequests = 0;
    let maximumConcurrentItemRequests = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/robots.txt"))
        return mockedResponse(url, 200, "User-agent: *\nAllow: /");

      const sourceItemId = new URL(url).pathname.split("/").at(-1)!;
      itemRequestTimes.push({ sourceItemId, at: now });
      activeItemRequests += 1;
      maximumConcurrentItemRequests = Math.max(
        maximumConcurrentItemRequests,
        activeItemRequests,
      );
      await Promise.resolve();
      activeItemRequests -= 1;
      const attempt = (itemAttempts.get(sourceItemId) ?? 0) + 1;
      itemAttempts.set(sourceItemId, attempt);
      if (sourceItemId === "z100" && attempt === 1)
        return mockedResponse(url, 429, "rate limited", {
          "retry-after": "45",
        });
      return mockedResponse(url, 200, detailPage(sourceItemId));
    });
    const adapter = new YahooFleamarketAdapter({
      fetchImpl: fetchImpl as typeof fetch,
      requestGate,
    });

    await Promise.all([
      adapter.fetchDetail({
        sourceItemId: "z100",
        sourceUrl: "https://paypayfleamarket.yahoo.co.jp/item/z100",
      }),
      adapter.fetchDetail({
        sourceItemId: "z101",
        sourceUrl: "https://paypayfleamarket.yahoo.co.jp/item/z101",
      }),
    ]);

    expect(maximumConcurrentItemRequests).toBe(1);
    expect(itemRequestTimes).toEqual([
      { sourceItemId: "z100", at: 0 },
      { sourceItemId: "z101", at: 45_000 },
      { sourceItemId: "z100", at: 50_000 },
    ]);
    expect(waits).toEqual([45_000, 5_000]);
    expect(
      fetchImpl.mock.calls.filter(([input]) =>
        String(input).endsWith("/robots.txt"),
      ),
    ).toHaveLength(1);
  });

  it("uses a conservative exponential cooldown when Retry-After is absent", () => {
    expect(yahooFleamarketRetryAfterMs(null, 0, 1_000)).toBe(60_000);
    expect(yahooFleamarketRetryAfterMs("", 1, 1_000)).toBe(120_000);
    expect(yahooFleamarketRetryAfterMs("45", 0, 1_000)).toBe(45_000);
  });

  it("keeps the shared request lane usable after a failed status attempt", async () => {
    let now = 0;
    const requestGate = new YahooFleamarketRequestGate({
      now: () => now,
      wait: async (milliseconds) => {
        now += milliseconds;
      },
    });

    await expect(
      requestGate.run(5_000, async () => {
        throw new Error("transient failure");
      }),
    ).rejects.toThrow("transient failure");
    await expect(
      requestGate.run(5_000, async () => "next refresh"),
    ).resolves.toBe("next refresh");
    expect(now).toBe(5_000);
  });
});
