import { describe, expect, it } from "vitest";
import {
  YahooFleamarketAdapter,
  parseYahooFleamarketDetailHtml,
  parseYahooFleamarketSearchHtml,
} from "./yahoo-fleamarket.adapter.js";

describe("Yahoo! Fleamarket parsing", () => {
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
    ).resolves.toEqual({ status: "sold" });
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
    });
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
      seller: {
        id: "p1",
        nickname: "ジョー",
        rating: { total: 641, goodRatio: 100 },
        tradingRecord: { displayLabel: "取引実績99+" },
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
    expect(detail.sellerData).toMatchObject({ isKycCompleted: true });
  });
});
