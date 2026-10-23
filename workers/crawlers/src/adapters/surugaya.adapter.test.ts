import { describe, expect, it, vi } from "vitest";
import {
  parseSurugayaSearchHtml,
  SurugayaAdapter,
} from "./surugaya.adapter.js";

describe("parseSurugayaSearchHtml", () => {
  it("keeps in-stock toy cards with shipping evidence and excludes books/cards", () => {
    const html = `
      <div class="item">
        <div class="photo_box"><a href="/product/detail/607224616"><img src="https://www.suruga-ya.jp/database/photo.php?shinaban=607224616&size=m"></a></div>
        <div class="item_detail"><a href="/product/detail/607224616"><h3 class="product-name">仮面ライダー DX変身ベルト 5点セット</h3></a><p class="condition">おもちゃ</p><p class="release_date">[発売日：2026/07/25]</p><p class="brand">[バンダイ]</p></div>
        <div class="item_price"><p class="price_teika">中古：<strong>￥1,100</strong></p><p><a class="show_shipping_fee">999円以上は送料無料</a></p><div class="panel_buy">通販手数料 240円</div></div>
      </div>
      <div class="item">
        <a href="/product/detail/123"><h3 class="product-name">仮面ライダー トレーディングカード</h3></a>
        <div class="item_price"><strong>￥900</strong></div>
      </div>`;
    const results = parseSurugayaSearchHtml(
      html,
      "https://www.suruga-ya.jp/search?category=50003&search_word=DX",
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      sourceItemId: "607224616",
      detailHint: {
        sourcePlatform: "surugaya",
        listingType: "direct",
        priceCurrent: 1100,
        shippingFee: 0,
        sellerName: "駿河屋",
        status: "active",
      },
    });
    expect(results[0].detailHint?.imageUrls).toHaveLength(1);
  });

  it("marks a catalogue item sold when the public lookup returns 404", async () => {
    const adapter = new SurugayaAdapter();
    vi.spyOn(adapter, "fetchDetail").mockRejectedValue(
      new Error("Surugaya returned 404"),
    );

    await expect(
      adapter.refreshStatus({
        sourceItemId: "607224616",
        sourceUrl: "https://www.suruga-ya.jp/product/detail/607224616",
        listingType: "direct",
        status: "active",
      }),
    ).resolves.toEqual({ status: "sold", listingType: "direct" });
  });
});
