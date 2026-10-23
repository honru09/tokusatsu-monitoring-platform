import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApifyEcommerceAdapter,
  parseApifyProduct,
} from "./apify-ecommerce.adapter.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Apify ecommerce parsing", () => {
  it("preserves explicitly free shipping as zero", () => {
    const item = parseApifyProduct({
      url: "https://www.amazon.co.jp/dp/B000000001",
      name: "仮面ライダー 食玩 10個セット",
      price: "4800",
      shipping: "0",
      images: ["https://images.example/item.jpg"],
    });

    expect(item.priceCurrent).toBe(4_800);
    expect(item.shippingFee).toBe(0);
  });

  it("does not turn a non-numeric shipping label into zero", () => {
    const item = parseApifyProduct({
      url: "https://www.amazon.co.jp/dp/B000000002",
      name: "仮面ライダー 食玩 10個セット",
      price: "4800",
      shipping: "calculated at checkout",
      images: [],
    });

    expect(item.shippingFee).toBeUndefined();
  });

  it("recognizes explicit free shipping text but rejects non-JPY prices", () => {
    expect(
      parseApifyProduct({
        url: "https://www.amazon.co.jp/dp/B000000004",
        name: "仮面ライダー 食玩 10個セット",
        price: "JPY 4,800",
        shipping: "Free shipping",
        images: [],
      }).shippingFee,
    ).toBe(0);

    expect(() =>
      parseApifyProduct({
        url: "https://www.ebay.com/itm/123456",
        name: "Kamen Rider mini figure lot",
        price: "US $20.00",
        currency: "USD",
        shipping: "0",
        images: [],
      }),
    ).toThrow(/not priced in JPY/);
    expect(() =>
      parseApifyProduct({
        url: "https://www.ebay.com/itm/123457",
        name: "Kamen Rider mini figure lot",
        price: "20.00",
        shipping: "0",
        images: [],
      }),
    ).toThrow(/no verifiable JPY currency/);
    expect(() =>
      parseApifyProduct({
        url: "https://market.example/items/1",
        name: "Kamen Rider mini figure lot",
        price: "20.00",
        shipping: "0",
        images: [],
      }),
    ).toThrow(/no verifiable JPY currency/);
  });

  it("does not add a foreign-currency shipping amount to a JPY price", () => {
    const item = parseApifyProduct({
      url: "https://www.amazon.co.jp/dp/B000000005",
      name: "仮面ライダー 食玩 10個セット",
      offers: {
        price: 4_800,
        priceCurrency: "JPY",
        shippingDetails: {
          shippingRate: { value: 20, currency: "USD" },
        },
      },
      images: [],
    });

    expect(item.shippingFee).toBeUndefined();
  });

  it("passes search-response facts to central procurement prioritization", async () => {
    vi.stubEnv("APIFY_TOKEN", "test-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { status: "SUCCEEDED", defaultDatasetId: "dataset-1" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            url: "https://www.amazon.co.jp/dp/B000000003",
            name: "仮面ライダー 食玩 20個セット",
            price: "4000",
            shipping: "0",
            descriptionRaw: "梱包サイズ 20×10×5 cm",
            images: [],
          },
        ],
      });
    vi.stubGlobal("fetch", fetchMock);

    const [result] = await new ApifyEcommerceAdapter().search({
      keyword: "仮面ライダー 食玩 まとめ売り",
    });

    expect(result?.detailHint).toMatchObject({
      titleRaw: "仮面ライダー 食玩 20個セット",
      priceCurrent: 4_000,
      shippingFee: 0,
    });
  });
});
