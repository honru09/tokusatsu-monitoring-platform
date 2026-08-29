import { describe, expect, it } from "vitest";
import { resolveAdapterKey } from "./items.service.js";

describe("resolveAdapterKey", () => {
  const firecrawlHosts = new Set(["item.fril.jp"]);

  it.each([
    "https://auctions.yahoo.co.jp/jp/auction/g1241924961",
    "https://page.auctions.yahoo.co.jp/jp/auction/g1241924961",
  ])("accepts current and legacy Yahoo Auctions product URLs: %s", (value) => {
    expect(resolveAdapterKey(new URL(value), firecrawlHosts, false)).toBe(
      "yahoo_auctions",
    );
  });

  it("does not treat a Yahoo search page as a product detail", () => {
    expect(
      resolveAdapterKey(
        new URL("https://auctions.yahoo.co.jp/search/search?p=DX"),
        firecrawlHosts,
        false,
      ),
    ).toBeUndefined();
  });

  it("uses Firecrawl only for configured hosts when a key is present", () => {
    const url = new URL("https://item.fril.jp/example-item");
    expect(resolveAdapterKey(url, firecrawlHosts, false)).toBeUndefined();
    expect(resolveAdapterKey(url, firecrawlHosts, true)).toBe(
      "firecrawl_market",
    );
  });

  it("falls back to the safe public-page adapter for other HTTPS product pages", () => {
    expect(resolveAdapterKey(new URL("https://shop.example.jp/item/123"), firecrawlHosts, false)).toBe("public_page");
  });
});
