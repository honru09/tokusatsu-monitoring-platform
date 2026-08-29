import { describe, expect, it } from "vitest";
import {
  parseYahooAuctionDetailHtml,
  parseYahooAuctionSearch,
} from "./yahoo-auctions.adapter.js";

describe("Yahoo Auctions parser", () => {
  it("deduplicates public auction links", () => {
    const html = `
      <a href="/jp/auction/a123">仮面ライダー DX ベルト</a>
      <a href="https://page.auctions.yahoo.co.jp/jp/auction/a123">duplicate</a>
      <a href="/jp/auction/b456">ウルトラマン ソフビ</a>
      <a href="https://auctions.yahoo.co.jp/jp/auction/c789">特撮 まとめ売り</a>
    `;
    expect(parseYahooAuctionSearch(html, 10)).toEqual([
      {
        sourceItemId: "a123",
        sourceUrl: "https://auctions.yahoo.co.jp/jp/auction/a123",
        titleHint: "仮面ライダー DX ベルト",
      },
      {
        sourceItemId: "b456",
        sourceUrl: "https://auctions.yahoo.co.jp/jp/auction/b456",
        titleHint: "ウルトラマン ソフビ",
      },
      {
        sourceItemId: "c789",
        sourceUrl: "https://auctions.yahoo.co.jp/jp/auction/c789",
        titleHint: "特撮 まとめ売り",
      },
    ]);
  });

  it("reads product JSON-LD including price, images and auction end", () => {
    const html = `<script type="application/ld+json">{
      "@type":"Product",
      "name":"仮面ライダー まとめ売り",
      "description":"中古 BANDAI 7点セット",
      "image":["https://img.example/1.jpg","https://img.example/2.jpg"],
      "offers":{
        "priceCurrency":"JPY",
        "price":"3980",
        "priceValidUntil":"2026-08-30T21:15:00+09:00",
        "availability":"https://schema.org/InStock",
        "itemCondition":"https://schema.org/UsedCondition"
      }
    }</script>`;
    const item = parseYahooAuctionDetailHtml(
      html,
      "https://page.auctions.yahoo.co.jp/jp/auction/a123",
      "a123",
    );
    expect(item.priceCurrent).toBe(3980);
    expect(item.auctionEndAt?.toISOString()).toBe("2026-08-30T12:15:00.000Z");
    expect(item.imageUrls).toHaveLength(2);
    expect(item.status).toBe("active");
  });
});
