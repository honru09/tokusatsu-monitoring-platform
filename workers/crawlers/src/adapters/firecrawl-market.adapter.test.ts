import { describe, expect, it } from "vitest";
import {
  isAllowedFirecrawlMarketplaceUrl,
  parseFirecrawlMarketplaceDocument,
} from "./firecrawl-market.adapter.js";

describe("Firecrawl marketplace adapter", () => {
  it("accepts only whitelisted public product routes", () => {
    expect(
      isAllowedFirecrawlMarketplaceUrl(
        "https://jp.mercari.com/item/m123456789",
      ),
    ).toBe(true);
    expect(
      isAllowedFirecrawlMarketplaceUrl("https://jp.mercari.com/mypage/"),
    ).toBe(false);
    expect(
      isAllowedFirecrawlMarketplaceUrl("https://evil.example/item/m123456789"),
    ).toBe(false);
  });

  it("normalizes product profile data without inventing a listing time", () => {
    const item = parseFirecrawlMarketplaceDocument(
      {
        markdown: "中古 仮面ライダー 7点セット",
        metadata: { title: "仮面ライダー 7点セット" },
        product: {
          title: "仮面ライダー 7点セット",
          url: "https://jp.mercari.com/item/m123456789",
          variants: [
            {
              price: { amount: 3200, currency: "JPY" },
              availability: { inStock: true },
              images: [{ url: "https://img.example/a.jpg" }],
            },
          ],
        },
      },
      "https://jp.mercari.com/item/m123456789",
    );
    expect(item.priceCurrent).toBe(3200);
    expect(item.listedAt).toBeUndefined();
    expect(item.imageUrls).toEqual(["https://img.example/a.jpg"]);
  });
});
