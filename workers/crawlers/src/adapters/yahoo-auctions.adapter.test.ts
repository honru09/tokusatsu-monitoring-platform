import { describe, expect, it, vi } from "vitest";
import {
  YahooAuctionsAdapter,
  YahooAuctionsRequestGate,
  parseYahooAuctionDetailHtml,
  parseYahooAuctionSearch,
  yahooAuctionsRetryAfterMs,
} from "./yahoo-auctions.adapter.js";

function auctionDetailPage(sourceItemId: string) {
  return `<script type="application/ld+json">${JSON.stringify({
    "@type": "Product",
    name: `仮面ライダー ${sourceItemId}`,
    offers: {
      price: "4200",
      availability: "https://schema.org/InStock",
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

describe("Yahoo Auctions parser", () => {
  it("recognizes an explicit auction-ended notice without a price", async () => {
    const adapter = new YahooAuctionsAdapter({
      fetchImpl: vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        return mockedResponse(
          url,
          200,
          url.endsWith("robots.txt")
            ? "User-agent: *\nAllow: /"
            : "<h1>このオークションは終了しました</h1>",
        );
      }) as typeof fetch,
      requestGate: new YahooAuctionsRequestGate(),
    });
    await expect(
      adapter.refreshStatus({
        sourceItemId: "a123",
        sourceUrl: "https://auctions.yahoo.co.jp/jp/auction/a123",
        status: "active",
      }),
    ).resolves.toEqual({ status: "ended", listingType: "auction" });
  });
  it.each(["SoldOut", "Discontinued"])(
    "recognizes structured %s auctions as ended",
    (availability) => {
      const detail = parseYahooAuctionDetailHtml(
        `<script type="application/ld+json">${JSON.stringify({
          "@type": "Product",
          name: "SHF 仮面ライダー",
          offers: {
            price: "3000",
            availability: `https://schema.org/${availability}`,
          },
        })}</script>`,
        "https://auctions.yahoo.co.jp/jp/auction/a123",
        "a123",
      );
      expect(detail.status).toBe("ended");
    },
  );

  it("does not infer auction completion from seller description prose", () => {
    const detail = parseYahooAuctionDetailHtml(
      `${auctionDetailPage("a123")}<body><section class="ProductDescription">前回の受付は終了しました。今回の出品は新品です。</section></body>`,
      "https://auctions.yahoo.co.jp/jp/auction/a123",
      "a123",
    );
    expect(detail.status).toBe("active");
  });

  it("does not infer auction completion from a price-less challenge page", async () => {
    const adapter = new YahooAuctionsAdapter();
    vi.spyOn(adapter, "fetchDetail").mockRejectedValue(
      new Error("Yahoo Auctions detail page did not contain a public price"),
    );
    await expect(
      adapter.refreshStatus({
        sourceItemId: "a123",
        sourceUrl: "https://auctions.yahoo.co.jp/jp/auction/a123",
        status: "active",
      }),
    ).rejects.toThrow("did not contain a public price");
  });
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
    ).resolves.toEqual({ status: "ended", listingType: "auction" });
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

  it("serializes concurrent detail refreshes and shares transient-failure cooldowns", async () => {
    let now = 0;
    const waits: number[] = [];
    const requestGate = new YahooAuctionsRequestGate({
      now: () => now,
      wait: async (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
      },
    });
    const attempts = new Map<string, number>();
    const requestTimes: Array<{ sourceItemId: string; at: number }> = [];
    let activeRequests = 0;
    let maximumConcurrentRequests = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/robots.txt"))
        return mockedResponse(url, 200, "User-agent: *\nAllow: /");

      const sourceItemId = new URL(url).pathname.split("/").at(-1)!;
      requestTimes.push({ sourceItemId, at: now });
      activeRequests += 1;
      maximumConcurrentRequests = Math.max(
        maximumConcurrentRequests,
        activeRequests,
      );
      await Promise.resolve();
      activeRequests -= 1;
      const attempt = (attempts.get(sourceItemId) ?? 0) + 1;
      attempts.set(sourceItemId, attempt);
      if (sourceItemId === "a100" && attempt === 1)
        return mockedResponse(url, 500, "temporarily unavailable");
      return mockedResponse(url, 200, auctionDetailPage(sourceItemId));
    });
    const adapter = new YahooAuctionsAdapter({
      fetchImpl: fetchImpl as typeof fetch,
      requestGate,
    });

    await Promise.all([
      adapter.fetchDetail({
        sourceItemId: "a100",
        sourceUrl: "https://auctions.yahoo.co.jp/jp/auction/a100",
      }),
      adapter.fetchDetail({
        sourceItemId: "a101",
        sourceUrl: "https://page.auctions.yahoo.co.jp/jp/auction/a101",
      }),
    ]);

    expect(maximumConcurrentRequests).toBe(1);
    expect(requestTimes).toEqual([
      { sourceItemId: "a100", at: 0 },
      { sourceItemId: "a101", at: 60_000 },
      { sourceItemId: "a100", at: 61_000 },
    ]);
    expect(waits).toEqual([60_000, 1_000]);
    expect(
      fetchImpl.mock.calls.filter(([input]) =>
        String(input).endsWith("/robots.txt"),
      ),
    ).toHaveLength(1);
  });

  it("bounds transient retry cooldowns and keeps the lane usable after errors", async () => {
    expect(yahooAuctionsRetryAfterMs(null, 0, 1_000)).toBe(60_000);
    expect(yahooAuctionsRetryAfterMs("120", 0, 1_000)).toBe(120_000);

    let now = 0;
    const requestGate = new YahooAuctionsRequestGate({
      now: () => now,
      wait: async (milliseconds) => {
        now += milliseconds;
      },
    });
    await expect(
      requestGate.run(1_000, async () => {
        throw new Error("transient failure");
      }),
    ).rejects.toThrow("transient failure");
    await expect(
      requestGate.run(1_000, async () => "next refresh"),
    ).resolves.toBe("next refresh");
    expect(now).toBe(1_000);
  });
});
