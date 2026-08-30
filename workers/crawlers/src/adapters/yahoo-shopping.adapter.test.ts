import { describe, expect, it } from "vitest";
import { parseYahooShoppingResponse } from "./yahoo-shopping.adapter.js";

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
      priceCurrent: 3980,
      shippingFee: 0,
      status: "active",
      channel: "online",
    });
  });
});
