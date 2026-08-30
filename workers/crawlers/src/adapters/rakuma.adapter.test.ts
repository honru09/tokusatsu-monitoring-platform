import { describe, expect, it } from "vitest";
import {
  RakumaAdapter,
  parseRakumaDetailHtml,
  parseRakumaSearchHtml,
} from "./rakuma.adapter.js";

describe("Rakuma parsing", () => {
  it("turns a removed listing page into a sold status", async () => {
    const adapter = new RakumaAdapter();
    (adapter as unknown as { fetchDetail: () => Promise<never> }).fetchDetail =
      async () => {
        throw new Error("Rakuma returned 404");
      };
    await expect(
      adapter.refreshStatus({
        sourceItemId: "a".repeat(32),
        sourceUrl: `https://item.fril.jp/${"a".repeat(32)}`,
        status: "active",
      }),
    ).resolves.toEqual({ status: "sold" });
  });

  it("filters books and cards from public search cards", () => {
    const card = (id: string, title: string) => `
      <div class="item"><div class="item-box">
        <a class="link_search_image" href="https://item.fril.jp/${id}" data-rat-itemid="seller/123" data-rat-price="1799" data-rat-sgenre="一般"><img data-original="https://img.fril.jp/img/123/m/1.jpg"></a>
        <a class="link_search_title" href="https://item.fril.jp/${id}">${title}</a>
      </div></div>`;
    const results = parseRakumaSearchHtml(
      card("a".repeat(32), "仮面ライダー ソフビ 5体セット") +
        card("b".repeat(32), "仮面ライダー コミック 全巻"),
    );
    expect(results).toHaveLength(1);
    expect(results[0].detailHint).toMatchObject({
      sourcePlatform: "rakuma",
      priceCurrent: 1799,
      sellerType: "individual",
    });
  });

  it("extracts complete description, seller, postage and gallery", () => {
    const product = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: "仮面ライダー ソフビ 5体セット",
      description: "中古品。傷のある個体を含みます。付属品は写真の通りです。",
      image: "https://img.fril.jp/img/123/l/1.jpg",
      offers: {
        price: 1799,
        availability: "https://schema.org/InStock",
        itemCondition: "https://schema.org/UsedCondition",
        seller: { name: "ガク" },
      },
    };
    const html = `
      <script type="application/ld+json">${JSON.stringify(product)}</script>
      <div class="sp-slides"><div class="sp-slide"><img src="https://img.fril.jp/img/123/l/1.jpg"></div><div class="sp-slide"><img src="https://img.fril.jp/img/123/l/2.jpg"></div></div>
      <table><tr><th>商品の状態</th><td>傷や汚れあり</td></tr><tr><th>配送料の負担</th><td>送料込</td></tr><tr><th>発送元の地域</th><td>埼玉県</td></tr></table>
      <a href="https://fril.jp/shop/shop-id">ガク</a><a href="https://fril.jp/shop/shop-id/review">取引の評価 265 0 1</a>`;
    const detail = parseRakumaDetailHtml(
      html,
      `https://item.fril.jp/${"a".repeat(32)}`,
      "a".repeat(32),
    );
    expect(detail).toMatchObject({
      sellerName: "ガク",
      shippingFee: 0,
      locationText: "埼玉県",
      conditionRaw: "傷や汚れあり",
      status: "active",
    });
    expect(detail.imageUrls).toHaveLength(2);
  });
});
