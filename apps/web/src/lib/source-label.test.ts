import { describe, expect, it } from "vitest";
import {
  marketplaceSourceName,
  marketplaceSourceOptions,
} from "./source-label";

describe("marketplace source identity", () => {
  it.each([
    "firecrawl_market",
    "apify_ecommerce",
    "playwright_page",
    "public_page",
  ])("preserves the actual platform name for %s", (key) => {
    expect(marketplaceSourceName(key, "HARD OFF Netmall")).toBe(
      "HARD OFF Netmall",
    );
    expect(
      marketplaceSourceName(
        key,
        "Firecrawl",
        "https://item.rakuten.co.jp/shop/item",
      ),
    ).toBe("乐天市场");
  });
  it("keeps known platform naming stable", () => {
    expect(marketplaceSourceName("yahoo_fleamarket", "日本市场")).toBe(
      "Yahoo!フリマ",
    );
  });

  it("builds the platform filter from active monitored sources", () => {
    expect(
      marketplaceSourceOptions([
        { key: "mercari", displayName: "Mercari", itemCount: 10 },
        {
          key: "yahoo_fleamarket",
          displayName: "Yahoo!フリマ",
          itemCount: 5,
        },
        { key: "rakuma", displayName: "ラクマ", itemCount: 4 },
        { key: "surugaya", displayName: "駿河屋", itemCount: 2 },
        { key: "mandarake", displayName: "Mandarake", itemCount: 0 },
      ]),
    ).toEqual([
      { value: "mercari", label: "Mercari" },
      { value: "yahoo_fleamarket", label: "Yahoo!フリマ" },
      { value: "rakuma", label: "ラクマ" },
      { value: "surugaya", label: "駿河屋" },
    ]);
  });
});
