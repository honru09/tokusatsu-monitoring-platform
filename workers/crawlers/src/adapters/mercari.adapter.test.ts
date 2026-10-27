import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MercariAdapter,
  mergeMercariDetails,
  parseMercariDetailHtml,
  parseMercariSearchResponse,
} from "./mercari.adapter.js";
import {
  ListingUnavailableError,
  NoPublicPriceError,
} from "./public-listing-status.js";

describe("Mercari adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not mistake a price-less challenge or shell page for a sale", async () => {
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
        listingType: "direct",
      }),
    ).rejects.toThrow("did not contain a public price");
  });

  it("recognizes structured sold status without a visible sold badge", () => {
    const detail = parseMercariDetailHtml(
      `<meta property="og:title" content="SHF 仮面ライダー" />
       <meta name="product:price:amount" content="3000" />
       <script type="application/ld+json">{"@type":"Product","offers":{"availability":"https://schema.org/SoldOut"}}</script>`,
      "https://jp.mercari.com/item/m123",
      "m123",
    );
    expect(detail.status).toBe("sold");
  });

  it("ignores sold wording in seller descriptions and hidden status widgets", () => {
    const detail = parseMercariDetailHtml(
      `<meta property="og:title" content="SHF 仮面ライダー" />
       <meta name="product:price:amount" content="3000" />
       <body><section data-testid="item-description">以前のセットは売り切れ。取引完了後に発送します。</section>
       <span hidden data-testid="sold-out">SOLD OUT</span></body>`,
      "https://jp.mercari.com/item/m123",
      "m123",
    );
    expect(detail.status).toBe("unknown");
  });

  it("does not reuse cached active search results during a removed-page refresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("entities:search"))
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "m12345678",
                  status: "ITEM_STATUS_ON_SALE",
                  name: "SHF 仮面ライダー",
                  price: "3000",
                },
              ],
            }),
            { status: 200 },
          );
        if (url.endsWith("robots.txt"))
          return new Response("User-agent: *\nAllow: /", { status: 200 });
        return new Response("not found", { status: 404 });
      }),
    );
    const adapter = new MercariAdapter();
    expect(await adapter.search({ keyword: "SHF" })).toHaveLength(1);
    await expect(
      adapter.refreshStatus({
        sourceItemId: "m12345678",
        sourceUrl: "https://jp.mercari.com/item/m12345678",
        status: "active",
        listingType: "direct",
      }),
    ).resolves.toEqual({ status: "sold", listingType: "direct" });
  });

  it("recognizes an explicit removed-page notice without a price", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (input: string | URL | Request) =>
          new Response(
            String(input).endsWith("robots.txt")
              ? "User-agent: *\nAllow: /"
              : "<h1>商品が見つかりません</h1>",
            { status: 200 },
          ),
      ),
    );
    await expect(
      new MercariAdapter().refreshStatus({
        sourceItemId: "m12345678",
        sourceUrl: "https://jp.mercari.com/item/m12345678",
        status: "active",
      }),
    ).resolves.toEqual({ status: "ended", listingType: "unknown" });
  });

  it("keeps a network failure on the retry path instead of calling it sold", async () => {
    const adapter = new MercariAdapter();
    vi.spyOn(adapter, "fetchDetail").mockRejectedValue(
      new Error("fetch failed"),
    );
    await expect(
      adapter.refreshStatus({
        sourceItemId: "m12345678",
        sourceUrl: "https://jp.mercari.com/item/m12345678",
        status: "active",
      }),
    ).rejects.toThrow("fetch failed");
  });

  it("does not renew an old active status when the public page is inconclusive", async () => {
    const adapter = new MercariAdapter();
    vi.spyOn(adapter, "fetchDetail").mockResolvedValue({
      sourcePlatform: "mercari",
      sourceItemId: "m12345678",
      sourceUrl: "https://jp.mercari.com/item/m12345678",
      titleRaw: "SHF",
      priceCurrent: 3000,
      imageUrls: [],
      channel: "online",
      listingType: "direct",
      status: "unknown",
    });
    expect(
      (
        await adapter.refreshStatus({
          sourceItemId: "m12345678",
          sourceUrl: "https://jp.mercari.com/item/m12345678",
          status: "active",
        })
      ).status,
    ).toBe("unknown");
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
    expect(raw.listingType).toBe("direct");
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

  it("surfaces sold and trading rows as sold instead of dropping them", () => {
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
      "m22222222222",
      "m33333333333",
    ]);
    expect(results.map((result) => result.detailHint?.status)).toEqual([
      "active",
      "sold",
      "sold",
    ]);
    expect(results[1].detailHint).toMatchObject({
      titleRaw: "仮面ライダー 已售商品",
      priceCurrent: 1200,
    });
  });

  it("still drops rows whose status is neither on sale nor sold", () => {
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
          status: "",
          name: "仮面ライダー 状态不明商品",
          price: "1200",
        },
      ],
    });

    expect(results.map((result) => result.sourceItemId)).toEqual([
      "m11111111111",
    ]);
  });

  it("asks the search endpoint for sold-out rows as well as on-sale rows", async () => {
    let requestBody: { searchCondition?: { status?: string[] } } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_input: string | URL | Request, init?: { body?: string }) => {
          requestBody = JSON.parse(init?.body ?? "{}") as typeof requestBody;
          return new Response(JSON.stringify({ items: [] }), {
            status: 200,
          });
        },
      ),
    );
    await new MercariAdapter().search({ keyword: "SHF" });
    expect(requestBody.searchCondition?.status).toEqual([
      "STATUS_ON_SALE",
      "STATUS_SOLD_OUT",
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

  it("falls back to the JSON-LD offers price when the price meta is absent", () => {
    const detail = parseMercariDetailHtml(
      `<meta property="og:title" content="SHF 仮面ライダー" />
       <script type="application/ld+json">{"@type":"Product","offers":{"price":"2500","availability":"https://schema.org/InStock"}}</script>`,
      "https://jp.mercari.com/item/m123",
      "m123",
    );
    expect(detail.priceCurrent).toBe(2500);
    expect(detail.status).toBe("active");
  });

  it("falls back to the visible price element when meta and JSON-LD prices are absent", () => {
    const detail = parseMercariDetailHtml(
      `<meta property="og:title" content="SHF 仮面ライダー" />
       <body><div data-testid="price">¥3,200</div></body>`,
      "https://jp.mercari.com/item/m123",
      "m123",
    );
    expect(detail.priceCurrent).toBe(3200);
  });

  it("treats a sold page without any price as unavailable, not as a parse failure", async () => {
    expect(() =>
      parseMercariDetailHtml(
        `<meta property="og:title" content="SHF 仮面ライダー" />
         <script type="application/ld+json">{"@type":"Product","offers":{"availability":"https://schema.org/SoldOut"}}</script>`,
        "https://jp.mercari.com/item/m123",
        "m123",
      ),
    ).toThrow(ListingUnavailableError);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (input: string | URL | Request) =>
          new Response(
            String(input).endsWith("robots.txt")
              ? "User-agent: *\nAllow: /"
              : `<meta property="og:title" content="SHF 仮面ライダー" />
                 <script type="application/ld+json">{"@type":"Product","offers":{"availability":"https://schema.org/SoldOut"}}</script>`,
            { status: 200 },
          ),
      ),
    );
    await expect(
      new MercariAdapter().refreshStatus({
        sourceItemId: "m12345678",
        sourceUrl: "https://jp.mercari.com/item/m12345678",
        status: "active",
      }),
    ).resolves.toEqual({ status: "sold", listingType: "unknown" });
  });

  it("reports a price-less shell page as a typed no-public-price outcome", async () => {
    const shell = `<meta property="og:title" content="SHF 仮面ライダー" /><body><main>読み込み中</main></body>`;
    expect(() =>
      parseMercariDetailHtml(shell, "https://jp.mercari.com/item/m123", "m123"),
    ).toThrow(NoPublicPriceError);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (input: string | URL | Request) =>
          new Response(
            String(input).endsWith("robots.txt")
              ? "User-agent: *\nAllow: /"
              : shell,
            { status: 200 },
          ),
      ),
    );
    await expect(
      new MercariAdapter().refreshStatus({
        sourceItemId: "m12345678",
        sourceUrl: "https://jp.mercari.com/item/m12345678",
        status: "active",
      }),
    ).rejects.toBeInstanceOf(NoPublicPriceError);
  });

  it("queries entities:search with sellerId filter, empty keyword, and parses response via parseMercariSearchResponse in fetchSellerListings", async () => {
    let capturedBody: any = null;
    let capturedHeaders: any = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("entities:search")) {
          capturedBody = JSON.parse(String(init?.body ?? "{}"));
          capturedHeaders = init?.headers as Record<string, string>;
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "m17892882001",
                  status: "ITEM_STATUS_ON_SALE",
                  name: "S.H.Figuarts 仮面ライダーギーツ",
                  price: "8500",
                  sellerId: "178928820",
                  thumbnails: ["https://static.mercdn.net/item/detail/orig/photos/m17892882001_1.jpg"],
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const adapter = new MercariAdapter();
    const results = await adapter.fetchSellerListings("178928820", 60);

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.searchCondition.sellerId).toEqual(["178928820"]);
    expect(capturedBody.searchCondition.keyword).toBe("");
    expect(capturedBody.pageSize).toBe(60);
    expect(capturedHeaders?.dpop).toBeTruthy();
    expect(capturedHeaders?.["content-type"]).toBe("application/json");

    expect(results).toHaveLength(1);
    expect(results[0].sourceItemId).toBe("m17892882001");
    expect(results[0].sourceUrl).toBe("https://jp.mercari.com/item/m17892882001");
    expect(results[0].titleHint).toBe("S.H.Figuarts 仮面ライダーギーツ");
    expect(results[0].detailHint?.priceCurrent).toBe(8500);
    expect(results[0].detailHint?.sellerName).toBe("Mercari 卖家 178928820");
  });

  it("throws NoPublicPriceError on fetchDetail for price-less page, while fetchDetailLenient resolves fallback price with parsed details", async () => {
    const missingPriceHtml = `<html><head>
      <meta property="og:title" content="仮面ライダー ウィザードリング 7個セット" />
      <meta property="og:description" content="中古・セット" />
      <meta property="og:image" content="https://static.mercdn.net/item.jpg" />
    </head><body><section data-testid="seller">特撮ショップ</section>商品説明</body></html>`;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        new Response(
          String(input).endsWith("robots.txt")
            ? "User-agent: *\nAllow: /"
            : missingPriceHtml,
          { status: 200 },
        ),
      ),
    );

    const adapter = new MercariAdapter();
    const item = {
      sourceItemId: "m123",
      sourceUrl: "https://jp.mercari.com/item/m123",
    };

    await expect(adapter.fetchDetail(item)).rejects.toBeInstanceOf(
      NoPublicPriceError,
    );

    const detail = await adapter.fetchDetailLenient(item, 4500);
    expect(detail.priceCurrent).toBe(4500);
    expect(detail.titleRaw).toBe("仮面ライダー ウィザードリング 7個セット");
    expect(detail.descriptionRaw).toBe("中古・セット");
    expect(detail.imageUrls).toEqual(["https://static.mercdn.net/item.jpg"]);
    expect(detail.sourcePlatform).toBe("mercari");
  });
});
