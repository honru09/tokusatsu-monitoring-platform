import { describe, expect, it } from "vitest";
import {
  YahooAuctionsAdapter,
  parseYahooAuctionDetailHtml,
  parseYahooAuctionSearch,
} from "./yahoo-auctions.adapter.js";

describe("Yahoo Auctions parser", () => {
  it("turns a removed auction page into an ended status", async () => {
    const adapter = new YahooAuctionsAdapter();
    (adapter as unknown as { fetchDetail: () => Promise<never> }).fetchDetail =
      async () => {
        throw new Error("Yahoo Auctions returned 404");
      };
    await expect(
      adapter.refreshStatus({
        sourceItemId: "a123",
        sourceUrl: "https://auctions.yahoo.co.jp/jp/auction/a123",
        status: "active",
      }),
    ).resolves.toEqual({ status: "ended" });
  });

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

  it("extracts the complete public Yahoo seller profile from hydration data", () => {
    const html = `<script type="application/ld+json">{
      "@type":"Product","name":"仮面ライダー DXベルト",
      "offers":{"price":"3980","availability":"https://schema.org/InStock"}
    }</script>
    <script id="__NEXT_DATA__" type="application/json">{
      "props":{"pageProps":{"initialState":{"detail":{"item":{"seller":{
        "displayName":"pha********","aucUserId":"public-id",
        "listUrl":"https://auctions.yahoo.co.jp/seller/public-id",
        "isStore":false,"isBestStore":false,"isExcellentSeller":true,
        "isEkycVerified":true,"sellerMessage":"公開メッセージ",
        "rating":{"goodRating":"100%","summary":20219},
        "sellerPerformance":{"isSpeedShipping":true},
        "location":{"prefecture":"福井県","prefCode":"18"}
      }}}}}}
    }</script>`;
    const item = parseYahooAuctionDetailHtml(
      html,
      "https://auctions.yahoo.co.jp/jp/auction/a123",
      "a123",
    );

    expect(item.sellerName).toBe("pha********");
    expect(item.sellerType).toBe("individual");
    expect(item.sellerProfileUrl).toBe(
      "https://auctions.yahoo.co.jp/seller/public-id",
    );
    expect(item.locationText).toBe("福井県");
    expect(item.sellerData).toEqual(
      expect.objectContaining({
        aucUserId: "public-id",
        isExcellentSeller: true,
        isIdentityVerified: true,
        rating: { goodRating: "100%", summary: 20219 },
      }),
    );
  });

  it("does not mistake hydration IDs for postage", () => {
    const html = `<script type="application/ld+json">{
      "@type":"Product","name":"仮面ライダー フィギュア",
      "offers":{"price":"1280","availability":"https://schema.org/InStock"}
    }</script><div>送料1 hydration-id</div>`;
    const item = parseYahooAuctionDetailHtml(
      html,
      "https://auctions.yahoo.co.jp/jp/auction/a123",
      "a123",
    );
    expect(item.shippingFee).toBeUndefined();
  });

  it("reads a public yen postage amount", () => {
    const html = `<script type="application/ld+json">{
      "@type":"Product","name":"仮面ライダー フィギュア",
      "offers":{"price":"1280","availability":"https://schema.org/InStock"}
    }</script><div>送料：850円</div>`;
    const item = parseYahooAuctionDetailHtml(
      html,
      "https://auctions.yahoo.co.jp/jp/auction/a123",
      "a123",
    );
    expect(item.shippingFee).toBe(850);
  });

  it("excludes page scripts from status, shipping and AI-visible body text", () => {
    const html = `<script type="application/ld+json">{
      "@type":"Product","name":"仮面ライダー フィギュア",
      "offers":{"price":"1280","availability":"https://schema.org/InStock"}
    }</script>
    <main>公開されている商品説明</main>
    <script>window.YAHOO = { locale: "終了しました", shipping: "送料：99999円" };</script>`;
    const item = parseYahooAuctionDetailHtml(
      html,
      "https://auctions.yahoo.co.jp/jp/auction/a123",
      "a123",
    );

    expect(item.status).toBe("active");
    expect(item.shippingFee).toBeUndefined();
    expect(item.sourceData?.bodyText).toBe("公開されている商品説明");
  });
});
