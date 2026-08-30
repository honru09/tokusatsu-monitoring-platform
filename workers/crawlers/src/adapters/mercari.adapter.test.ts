import { describe, expect, it } from "vitest";
import {
  MercariAdapter,
  mergeMercariDetails,
  parseMercariDetailHtml,
  parseMercariSearchResponse,
} from "./mercari.adapter.js";

describe("Mercari adapter", () => {
  it("turns a removed public-price page into a sold status", async () => {
    const adapter = new MercariAdapter();
    (adapter as unknown as { fetchDetail: () => Promise<never> }).fetchDetail =
      async () => {
        throw new Error("Mercari detail page did not contain a public price");
      };
    await expect(
      adapter.refreshStatus({
        sourceItemId: "m123",
        sourceUrl: "https://jp.mercari.com/item/m123",
        status: "active",
      }),
    ).resolves.toEqual({ status: "sold" });
  });

  it("parses public Open Graph and product price metadata", () => {
    const raw = parseMercariDetailHtml(
      `<html><head>
        <meta property="og:title" content="仮面ライダー ウィザードリング 7個セット" />
        <meta property="og:description" content="中古・セット" />
        <meta name="product:price:amount" content="300" />
        <meta property="og:image" content="https://static.mercdn.net/item.jpg" />
      </head><body>商品説明</body></html>`,
      "https://jp.mercari.com/item/m123",
      "m123",
    );
    expect(raw.titleRaw).toContain("仮面ライダー");
    expect(raw.priceCurrent).toBe(300);
    expect(raw.imageUrls).toEqual(["https://static.mercdn.net/item.jpg"]);
    expect(raw.sourcePlatform).toBe("mercari");
  });

  it("turns Mercari search fields into a direct-purchase detail fallback", () => {
    const [result] = parseMercariSearchResponse({
      items: [
        {
          id: "m51893530359",
          sellerId: "441480240",
          status: "ITEM_STATUS_ON_SALE",
          name: "DX変身ベルト 未開封 2点セット",
          price: "789",
          created: "1787978506",
          thumbnails: ["https://static.mercdn.net/thumb.jpg"],
          photos: [{ uri: "https://static.mercdn.net/detail.jpg" }],
          itemType: "ITEM_TYPE_MERCARI",
          itemConditionId: "1",
          shippingPayerId: "2",
        },
      ],
    });
    expect(result.sourceUrl).toBe("https://jp.mercari.com/item/m51893530359");
    expect(result.detailHint).toMatchObject({
      titleRaw: "DX変身ベルト 未開封 2点セット",
      priceCurrent: 789,
      shippingFee: 0,
      sellerName: "Mercari 卖家 441480240",
      conditionRaw: "新品、未使用",
      status: "active",
    });
    expect(result.detailHint?.imageUrls).toHaveLength(2);
  });

  it("keeps Mercari Shops listings with their public shop URL and seller", () => {
    const [result] = parseMercariSearchResponse({
      items: [
        {
          id: "2JW3gQDCYVhLvPz4yfpf7S",
          sellerId: "626432859",
          status: "ITEM_STATUS_ON_SALE",
          name: "新品未開封 BOX 4個セット",
          price: "3080",
          photos: [{ uri: "https://assets.mercari-shops-static.com/item.jpg" }],
          itemType: "ITEM_TYPE_BEYOND",
          shopName: "キャラクターショップ",
        },
      ],
    });
    expect(result.sourceUrl).toBe(
      "https://jp.mercari.com/shops/product/2JW3gQDCYVhLvPz4yfpf7S",
    );
    expect(result.detailHint?.sellerName).toBe("キャラクターショップ");
    expect(result.detailHint?.sellerType).toBe("store");
  });

  it("drops non-active rows even if Mercari returns them in a mixed response", () => {
    const results = parseMercariSearchResponse({
      items: [
        {
          id: "m11111111111",
          status: "ITEM_STATUS_ON_SALE",
          name: "仮面ライダー 在售商品",
          price: "1000",
        },
        {
          id: "m22222222222",
          status: "ITEM_STATUS_SOLD_OUT",
          name: "仮面ライダー 已售商品",
          price: "1200",
        },
        {
          id: "m33333333333",
          status: "ITEM_STATUS_TRADING",
          name: "仮面ライダー 交易中商品",
          price: "1400",
        },
      ],
    });

    expect(results.map((result) => result.sourceItemId)).toEqual([
      "m11111111111",
    ]);
  });

  it("keeps the authoritative active search status when page chrome contains sold wording", () => {
    const cached = parseMercariSearchResponse({
      items: [
        {
          id: "m44444444444",
          status: "ITEM_STATUS_ON_SALE",
          name: "仮面ライダー 在售商品",
          price: "1600",
          photos: [{ uri: "https://static.mercdn.net/search.jpg" }],
        },
      ],
    })[0].detailHint!;
    const page = parseMercariDetailHtml(
      `<html><head>
        <meta property="og:title" content="仮面ライダー 在售商品" />
        <meta name="product:price:amount" content="1600" />
        <meta property="og:image" content="https://static.mercdn.net/page.jpg" />
      </head><body>
        <main>公開商品ページ</main>
        <script>{"status_SALE_STATUS_SOLD_OUT":"売り切れ","order":"取引完了"}</script>
      </body></html>`,
      cached.sourceUrl,
      cached.sourceItemId,
    );

    expect(page.status).toBe("unknown");
    expect(mergeMercariDetails(cached, page).status).toBe("active");
  });

  it("keeps the public search seller identity when unauthenticated HTML only has page chrome", () => {
    const cached = parseMercariSearchResponse({
      items: [
        {
          id: "m55555555555",
          sellerId: "407612843",
          status: "ITEM_STATUS_ON_SALE",
          name: "仮面ライダー まとめ売り",
          price: "2500",
          photos: [{ uri: "https://static.mercdn.net/search-detail.jpg" }],
        },
      ],
    })[0].detailHint!;
    const page = parseMercariDetailHtml(
      `<html><head>
        <meta property="og:title" content="仮面ライダー まとめ売り by メルカリ" />
        <meta name="product:price:amount" content="2500" />
        <meta property="og:image" content="https://static.mercdn.net/page.jpg" />
      </head><body><main>公開商品ページ</main></body></html>`,
      cached.sourceUrl,
      cached.sourceItemId,
    );

    const merged = mergeMercariDetails(cached, page);
    expect(merged.sellerName).toBe("Mercari 卖家 407612843");
    expect(merged.sellerProfileUrl).toBe(
      "https://jp.mercari.com/user/profile/407612843",
    );
    expect(merged.sourceData).toMatchObject({
      sellerId: "407612843",
      sellerProfileUrl: "https://jp.mercari.com/user/profile/407612843",
    });
    expect(merged.imageUrls).toHaveLength(2);
  });
});
