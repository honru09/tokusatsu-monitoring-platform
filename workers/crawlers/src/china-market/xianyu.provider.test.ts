import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseXianyuProviderRow,
  searchXianyuOffers,
  xianyuComparisonEnabled,
  xianyuMarketProvider,
} from "./xianyu.provider.js";
import { robustReferencePrice } from "./matching.js";

const watchedEnv = [
  "CHINA_MARKET_COMPARISON_AUTHORIZED",
  "CHINA_MARKET_COMPARISON_ENABLED",
  "XIANYU_COMPARISON_ENABLED",
  "XIANYU_SEARCH_API_URL",
  "XIANYU_REQUEST_INTERVAL_MS",
  "APIFY_TOKEN",
] as const;
const originalEnv = Object.fromEntries(
  watchedEnv.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of watchedEnv) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Xianyu provider parsing", () => {
  it("normalizes a summary row to a stable CNY offer", () => {
    const offer = parseXianyuProviderRow({
      id: "123456",
      url: "https://www.goofish.com/item?id=123456&utm_source=test",
      title: "假面骑士555 DX腰带",
      price: "¥ 688.00",
      currency: "CNY",
      pictureUrl: "//img.alicdn.test/item.jpg",
      city: "上海",
      detailStatus: "summary",
      status: "active",
    });
    expect(offer).toMatchObject({
      sourceListingId: "123456",
      sourceUrl: "https://www.goofish.com/item?id=123456",
      priceCny: 688,
      status: "active",
    });
    expect(offer).not.toHaveProperty("locationText");
  });

  it("rejects rows without a stable id, title, or CNY price", () => {
    expect(parseXianyuProviderRow({ title: "missing price" })).toBeNull();
    expect(
      parseXianyuProviderRow({
        id: "1",
        title: "wrong currency",
        price: 10,
        currency: "JPY",
      }),
    ).toBeNull();
  });

  it("rejects overlong title and condition fields instead of truncating evidence", () => {
    expect(
      parseXianyuProviderRow({
        itemId: "long-title-1",
        itemUrl: "https://www.goofish.com/item?id=long-title-1",
        title: "商".repeat(501),
        price: 100,
        status: "active",
      }),
    ).toBeNull();
    expect(
      parseXianyuProviderRow({
        itemId: "long-condition-1",
        itemUrl: "https://www.goofish.com/item?id=long-condition-1",
        title: "有效商品",
        condition: "新".repeat(241),
        price: 100,
        status: "active",
      }),
    ).toBeNull();
  });

  it("requires a verified Goofish link and rejects listing-id mismatches", () => {
    expect(
      parseXianyuProviderRow({
        url: "/item?id=relative-1&utm_source=test",
        title: "相对链接商品",
        price: 100,
      }),
    ).toMatchObject({
      sourceListingId: "relative-1",
      sourceUrl: "https://www.goofish.com/item?id=relative-1",
    });
    expect(
      parseXianyuProviderRow({
        id: "provider-database-row-1",
        url: "https://www.goofish.com/item?id=real-row-1",
        title: "数据库行号不参与商品身份",
        price: 100,
      }),
    ).toMatchObject({ sourceListingId: "real-row-1" });
    expect(
      parseXianyuProviderRow({
        itemId: "explicit-row-1",
        url: "https://www.goofish.com/item?id=different-row",
        title: "显式商品 ID 错配",
        price: 100,
      }),
    ).toBeNull();
    expect(
      parseXianyuProviderRow({
        id: "provider-database-row-1",
        title: "缺少原链接商品",
        price: 100,
      }),
    ).toBeNull();
    expect(
      parseXianyuProviderRow({
        url: "https://untrusted.example.test/item?id=external-1",
        title: "站外链接商品",
        price: 100,
      }),
    ).toBeNull();
    expect(
      parseXianyuProviderRow({
        url: "https://www.goofish.com/search?id=search-row-1",
        title: "搜索页不能伪装成商品页",
        price: 100,
      }),
    ).toBeNull();
    expect(
      parseXianyuProviderRow({
        url: "https://www.goofish.com/item?id=row-1&id=row-2",
        title: "重复身份参数",
        price: 100,
      }),
    ).toBeNull();
    expect(
      parseXianyuProviderRow({
        url: "https://www.goofish.com:8443/item?id=port-row-1",
        title: "非标准端口",
        price: 100,
      }),
    ).toBeNull();
  });

  it("keeps provider metadata product-scoped and rejects non-http images", () => {
    const offer = parseXianyuProviderRow({
      id: "item-2",
      url: "https://www.goofish.com/item?id=item-2",
      title: "商品",
      price: 20,
      currency: "CNY",
      imageUrl: "javascript:alert(1)",
      categoryName: "玩具",
      badges: ["包邮", { seller: "private" }],
      sourceData: { seller: "should-not-be-copied" },
    });
    expect(offer?.imageUrl).toBeUndefined();
    expect(offer?.sourceData).toMatchObject({
      categoryName: "玩具",
      badges: ["包邮"],
    });
    expect(offer?.sourceData).not.toHaveProperty("seller");
    expect(JSON.stringify(offer)).not.toContain("seller");
    for (const imageUrl of [
      "http://images.example.test/plain.jpg",
      "https://user:pass@images.example.test/secret.jpg",
      "https://127.0.0.1/private.jpg",
      "https://metadata.internal/latest.jpg",
      "https://images.example.test:8443/nonstandard.jpg",
    ]) {
      expect(
        parseXianyuProviderRow({
          itemId: "unsafe-image-1",
          url: "https://www.goofish.com/item?id=unsafe-image-1",
          title: "不安全图片地址",
          price: 20,
          status: "active",
          imageUrl,
        })?.imageUrl,
      ).toBeUndefined();
    }
  });

  it("drops direct and nested location data from persisted offer fields", () => {
    const offer = parseXianyuProviderRow({
      itemId: "private-location-1",
      url: "https://www.goofish.com/item?id=private-location-1",
      title: "商品",
      price: 20,
      status: "active",
      city: "上海",
      area: "浦东新区",
      location: "上海市浦东新区世纪大道 100 号 3 楼",
      address: "世纪大道 100 号",
      latitude: 31.2304,
      longitude: 121.4737,
      gps: { lat: 31.2304, lng: 121.4737 },
      geo: { city: "上海", address: "世纪大道 100 号" },
      sourceData: {
        location: "上海",
        shippingAddress: "世纪大道 100 号",
        coordinates: [121.4737, 31.2304],
      },
    });

    expect(offer).not.toHaveProperty("locationText");
    expect(JSON.stringify(offer)).not.toMatch(
      /(?:世纪大道|浦东新区|latitude|longitude|gps|geo|shippingAddress|coordinates)/i,
    );
  });

  it("retains non-personal listing classification evidence", () => {
    expect(
      parseXianyuProviderRow({
        itemId: "classified-1",
        url: "https://www.goofish.com/item?id=classified-1",
        title: "商品",
        price: 20,
        status: "active",
        isAd: true,
        isB2C: false,
        isAuction: true,
      })?.sourceData,
    ).toMatchObject({ isAd: true, isB2C: false, isAuction: true });
  });

  it("only treats an explicit marketplace availability state as active", () => {
    expect(
      parseXianyuProviderRow({
        itemId: "summary-1",
        url: "https://www.goofish.com/item?id=summary-1",
        title: "摘要商品",
        price: 20,
        detailStatus: "summary",
      })?.status,
    ).toBe("unknown");
    expect(
      parseXianyuProviderRow({
        itemId: "preorder-1",
        url: "https://www.goofish.com/item?id=preorder-1",
        title: "预售商品",
        price: 20,
        statusLabel: "预售中",
      })?.status,
    ).toBe("unknown");
    expect(
      parseXianyuProviderRow({
        itemId: "active-1",
        url: "https://www.goofish.com/item?id=active-1",
        title: "在售商品",
        price: 20,
        saleStatus: "在售",
      })?.status,
    ).toBe("active");
  });

  it("supports xianyu_spider and browser-bridge field shapes without trusting database ids", () => {
    expect(
      parseXianyuProviderRow({
        id: 101,
        商品标题: "假面骑士555 DX腰带",
        当前售价: "¥688",
        发货地区: "上海",
        商品链接: "fleamarket://item?id=998877",
        商品图片链接: "//img.example.test/1.jpg",
        status: "在售",
      }),
    ).toMatchObject({
      sourceListingId: "998877",
      sourceUrl: "https://www.goofish.com/item?id=998877",
      titleRaw: "假面骑士555 DX腰带",
      priceCny: 688,
      status: "active",
    });
    expect(
      parseXianyuProviderRow({
        data: {
          item: {
            main: {
              exContent: {
                title: "嵌套商品",
                price: [{ text: "¥99" }],
                picUrl: "https://img.example.test/2.jpg",
              },
              targetUrl: "https://www.goofish.com/item?id=nested-1",
              status: "在售",
            },
          },
        },
      }),
    ).toMatchObject({ sourceListingId: "nested-1", priceCny: 99 });
  });

  it("does not call a search provider until the operator authorization switch is on", async () => {
    delete process.env.CHINA_MARKET_COMPARISON_AUTHORIZED;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchXianyuOffers(["商品"], 20)).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires all feature switches before a provider can run", () => {
    process.env.CHINA_MARKET_COMPARISON_ENABLED = "true";
    process.env.XIANYU_COMPARISON_ENABLED = "true";
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    expect(xianyuComparisonEnabled()).toBe(true);
    process.env.XIANYU_COMPARISON_ENABLED = "false";
    expect(xianyuComparisonEnabled()).toBe(false);
  });

  it("fails closed when a search service returns a login or CAPTCHA page", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    const body = "<html>please complete CAPTCHA verification at login</html>";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = searchXianyuOffers(["商品"], 20);
    await expect(result).rejects.toMatchObject({
      name: "XianyuProviderBlockedError",
      code: "provider_blocked",
    });
    await expect(result).rejects.toThrow("blocked by provider");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recognizes Chinese login-required responses before treating them as empty", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "请先登录后继续" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchXianyuOffers(["商品"], 20)).rejects.toMatchObject({
      code: "provider_blocked",
    });
  });

  it("recognizes an expired-login response before treating it as empty", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "login_expired", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchXianyuOffers(["商品"], 20)).rejects.toMatchObject({
      code: "provider_blocked",
    });
  });

  it("treats a followed redirect to a login page as blocked even with an empty JSON body", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    const response = new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    Object.defineProperties(response, {
      redirected: { value: true },
      url: { value: "https://provider.example.test/login?next=%2Fsearch" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(searchXianyuOffers(["商品"], 20)).rejects.toMatchObject({
      code: "provider_blocked",
    });
  });

  it("recognizes structured boolean login and verification states", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    for (const payload of [
      { logged_in: false, results: [] },
      { sessionValid: false, results: [] },
      { captchaRequired: true, results: [] },
      { hint: "需要登录后继续", results: [] },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      );
      await expect(searchXianyuOffers(["商品"], 20)).rejects.toMatchObject({
        code: "provider_blocked",
      });
    }
  });

  it("returns a bounded Retry-After signal for provider rate limiting", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "120",
          },
        }),
      ),
    );

    await expect(searchXianyuOffers(["商品"], 20)).rejects.toMatchObject({
      code: "provider_rate_limited",
      retryAfterMs: 120_000,
    });
  });

  it("accepts common nested records payloads from an authorized search service", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    process.env.XIANYU_REQUEST_INTERVAL_MS = "0";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            records: [
              {
                itemId: "record-1",
                itemUrl: "https://www.goofish.com/item?id=record-1",
                title: "假面骑士555 DX腰带",
                price: 688,
                currency: "CNY",
                status: "active",
              },
            ],
            total: 1,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchXianyuOffers(["商品"], 20)).resolves.toMatchObject([
      {
        sourceListingId: "record-1",
        priceCny: 688,
        provenance: {
          providerKey: expect.stringMatching(/^search_api:[a-f0-9]{16}$/),
          queryKeyword: "商品",
        },
      },
    ]);
  });

  it("uses a later non-empty result array when an earlier envelope array is empty", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    process.env.XIANYU_REQUEST_INTERVAL_MS = "0";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [],
            data: {
              records: [
                {
                  itemId: "record-2",
                  itemUrl: "https://www.goofish.com/item?id=record-2",
                  title: "有效商品",
                  price: 88,
                  status: "active",
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(searchXianyuOffers(["商品"], 20)).resolves.toMatchObject([
      { sourceListingId: "record-2", priceCny: 88 },
    ]);
  });

  it("prefers explicit active evidence for one unchanged listing seen by two queries", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    process.env.XIANYU_REQUEST_INTERVAL_MS = "0";
    const row = {
      itemId: "repeated-1",
      itemUrl: "https://www.goofish.com/item?id=repeated-1",
      title: "同一商品",
      price: 88,
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ results: [row] }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ results: [{ ...row, status: "active" }] }),
            { status: 200 },
          ),
        ),
    );

    await expect(
      searchXianyuOffers(["第一组", "第二组"], 20),
    ).resolves.toMatchObject([
      {
        sourceListingId: "repeated-1",
        status: "active",
        provenance: { queryKeyword: "第二组" },
      },
    ]);
  });

  it("quarantines one listing id when two queries report conflicting prices", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    process.env.XIANYU_REQUEST_INTERVAL_MS = "0";
    const makeRow = (price: number) => ({
      itemId: "conflict-1",
      itemUrl: "https://www.goofish.com/item?id=conflict-1",
      title: "价格冲突商品",
      price,
      status: "active",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ results: [makeRow(88)] }), {
            status: 200,
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ results: [makeRow(188)] }), {
            status: 200,
          }),
        ),
    );

    await expect(
      xianyuMarketProvider.search(["第一组", "第二组"], 20),
    ).resolves.toMatchObject({
      offers: [],
      complete: true,
      stats: { rejectedRows: 1 },
    });
  });

  it("treats an explicit zero-result count as a successful empty search", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    process.env.XIANYU_REQUEST_INTERVAL_MS = "0";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [], total_results: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchXianyuOffers(["商品"], 20)).resolves.toEqual([]);
  });

  it.each([
    { success: false, results: [] },
    { ok: false, results: [] },
    { success: "false", results: [] },
    { data: { success: false, items: [] } },
    { success: true, data: { ok: false, items: [] } },
    { code: "SYSTEM_BUSY", message: "系统繁忙", items: [] },
    { error: "系统繁忙", items: [] },
    {
      success: false,
      results: [
        {
          url: "https://www.goofish.com/item?id=stale-result",
          title: "过期缓存商品",
          price: 600,
          status: "active",
        },
      ],
    },
  ])(
    "rejects an HTTP 200 failure envelope before reading its rows: %j",
    async (payload) => {
      process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
      process.env.XIANYU_SEARCH_API_URL =
        "https://provider.example.test/search";
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify(payload), { status: 200 }),
          ),
      );

      await expect(searchXianyuOffers(["商品"], 20)).rejects.toThrow(
        "reported an unsuccessful response",
      );
    },
  );

  it("classifies an HTTP 200 rate-limit envelope without treating it as empty", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            code: "RATE_LIMIT",
            message: "请求过于频繁",
            items: [],
          }),
          { status: 200, headers: { "retry-after": "90" } },
        ),
      ),
    );

    await expect(searchXianyuOffers(["商品"], 20)).rejects.toMatchObject({
      code: "provider_rate_limited",
      retryAfterMs: 90_000,
    });
  });

  it("counts overlong provider rows as rejected evidence", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    process.env.XIANYU_REQUEST_INTERVAL_MS = "0";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              {
                itemId: "long-title-2",
                itemUrl: "https://www.goofish.com/item?id=long-title-2",
                title: "商".repeat(501),
                price: 100,
                status: "active",
              },
              {
                itemId: "long-condition-2",
                itemUrl: "https://www.goofish.com/item?id=long-condition-2",
                title: "有效标题",
                condition: "新".repeat(241),
                price: 110,
                status: "active",
              },
              {
                itemId: "valid-row-1",
                itemUrl: "https://www.goofish.com/item?id=valid-row-1",
                title: "有效商品",
                condition: "九成新",
                price: 120,
                status: "active",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      xianyuMarketProvider.search(["商品"], 20),
    ).resolves.toMatchObject({
      offers: [{ sourceListingId: "valid-row-1" }],
      stats: { rejectedRows: 2 },
    });
  });

  it("rejects an unknown success envelope instead of treating it as an empty market", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, payload: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchXianyuOffers(["商品"], 20)).rejects.toThrow(
      "unsupported response shape",
    );
  });

  it("preserves HTTP rate-limit handling when the error body also says success false", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, results: [] }), {
          status: 429,
          headers: { "retry-after": "120" },
        }),
      ),
    );
    await expect(searchXianyuOffers(["商品"], 20)).rejects.toMatchObject({
      code: "provider_rate_limited",
      retryAfterMs: 120000,
    });
  });

  it("marks provider authentication responses as blocked", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchXianyuOffers(["商品"], 20)).rejects.toMatchObject({
      code: "provider_blocked",
    });
  });

  it("rejects an oversized provider response before buffering its body", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("{}", {
          status: 200,
          headers: { "content-length": "4000001" },
        }),
      ),
    );

    await expect(searchXianyuOffers(["商品"], 20)).rejects.toThrow(
      "response exceeded the size limit",
    );
  });

  it("fails closed on excessively deep or broad status envelopes", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    let deep: Record<string, unknown> = { results: [] };
    for (let index = 0; index < 70; index += 1) deep = { data: deep };
    const broad = { data: Array.from({ length: 20_001 }, () => 0) };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(deep), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(broad), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchXianyuOffers(["商品"], 20)).rejects.toMatchObject({
      code: "provider_blocked",
    });
    await expect(searchXianyuOffers(["商品"], 20)).rejects.toMatchObject({
      code: "provider_blocked",
    });
  });

  it("cancels an oversized streamed response without a content-length header", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.XIANYU_SEARCH_API_URL = "https://provider.example.test/search";
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2_100_000));
        controller.enqueue(new Uint8Array(2_100_000));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(stream, { status: 200 })),
    );

    await expect(searchXianyuOffers(["商品"], 20)).rejects.toThrow(
      "response exceeded the size limit",
    );
    expect(cancelled).toBe(true);
  });

  it("checks Apify dataset responses for Chinese risk-control signals", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.APIFY_TOKEN = "test-token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { status: "SUCCEEDED", defaultDatasetId: "dataset-1" },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response('{"message":"安全验证"}', { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchXianyuOffers(["商品"], 20)).rejects.toMatchObject({
      code: "provider_blocked",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("polls the same Apify run instead of starting another actor when it is still running", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.APIFY_TOKEN = "test-token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { id: "run-1", status: "RUNNING" },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "run-1",
              status: "SUCCEEDED",
              defaultDatasetId: "dataset-1",
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              itemId: "apify-item-1",
              itemUrl:
                "https://www.goofish.com/item?id=apify-item-1&utm_source=test",
              title: "闲鱼在售商品",
              price: 88,
              status: "active",
            },
          ]),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchXianyuOffers(["商品"], 20)).resolves.toMatchObject([
      { sourceListingId: "apify-item-1", priceCny: 88 },
    ]);
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(
      requestedUrls.filter(
        (url) => url.includes("/acts/") && url.includes("/runs"),
      ),
    ).toHaveLength(1);
    expect(requestedUrls[1]).toContain("/actor-runs/run-1");
    const actorRequest = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(actorRequest.body))).toMatchObject({
      detailLevel: "summary",
    });
  });

  it("marks only a just-completed Apify summary search as current availability", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.APIFY_TOKEN = "test-token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "run-summary-1",
              status: "SUCCEEDED",
              defaultDatasetId: "dataset-summary-1",
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              itemId: "summary-current-1",
              itemUrl: "https://www.goofish.com/item?id=summary-current-1",
              title: "当前搜索页商品",
              price: 88,
              detailStatus: "summary",
            },
            {
              itemId: "summary-current-2",
              itemUrl: "https://www.goofish.com/item?id=summary-current-2",
              title: "当前搜索页商品",
              price: 80,
              detailStatus: "summary",
            },
            {
              itemId: "summary-current-3",
              itemUrl: "https://www.goofish.com/item?id=summary-current-3",
              title: "当前搜索页商品",
              price: 96,
              detailStatus: "summary",
            },
          ]),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const currentOffers = await searchXianyuOffers(["商品"], 20);
    expect(currentOffers).toHaveLength(3);
    expect(currentOffers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceListingId: "summary-current-1",
          status: "active",
          sourceData: expect.objectContaining({
            detailStatus: "summary",
            availabilityEvidence: "apify_current_search_result",
            availabilityObservedAt: expect.any(String),
          }),
          provenance: {
            providerKey: expect.stringMatching(/^apify:/),
            providerRunId: "run-summary-1",
            queryKeyword: "商品",
          },
        }),
      ]),
    );
    expect(
      robustReferencePrice(
        currentOffers.map((offer) => ({
          ...offer,
          matchConfidence: 0.95,
        })),
      ),
    ).toMatchObject({
      status: "ready",
      referencePriceCny: 88,
      representative: {
        sourceListingId: "summary-current-1",
      },
    });
    expect(
      parseXianyuProviderRow({
        itemId: "summary-bare-1",
        itemUrl: "https://www.goofish.com/item?id=summary-bare-1",
        title: "裸摘要",
        price: 88,
        detailStatus: "summary",
      })?.status,
    ).toBe("unknown");
    expect(
      parseXianyuProviderRow(
        {
          itemId: "summary-error-1",
          itemUrl: "https://www.goofish.com/item?id=summary-error-1",
          title: "详情失败摘要",
          price: 88,
          detailStatus: "summary",
          detailError: "fetch failed",
        },
        {
          providerKey: "apify:test-actor",
          providerRunId: "run-current-1",
          queryKeyword: "商品",
        },
        { freshSuccessfulApifySearchAt: new Date().toISOString() },
      )?.status,
    ).toBe("unknown");
  });

  it("lets an explicit sold row override fresh-summary active inference for the same id", async () => {
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED = "true";
    process.env.APIFY_TOKEN = "test-token";
    process.env.XIANYU_REQUEST_INTERVAL_MS = "0";
    const listing = {
      itemId: "summary-terminal-1",
      itemUrl: "https://www.goofish.com/item?id=summary-terminal-1",
      title: "同一商品",
      price: 88,
      detailStatus: "summary",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: {
                id: "run-active-1",
                status: "SUCCEEDED",
                defaultDatasetId: "dataset-active-1",
              },
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify([listing]), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: {
                id: "run-sold-1",
                status: "SUCCEEDED",
                defaultDatasetId: "dataset-sold-1",
              },
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ ...listing, status: "sold" }]), {
            status: 200,
          }),
        ),
    );

    await expect(
      searchXianyuOffers(["第一组", "第二组"], 20),
    ).resolves.toMatchObject([
      { sourceListingId: "summary-terminal-1", status: "sold" },
    ]);
  });
});
