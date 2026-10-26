import { describe, expect, it } from "vitest";
import {
  compactLinkLabel,
  dedupeJobsByUrl,
  parsePurchaseLinkInput,
} from "./purchase-link-input";

describe("purchase link input amounts", () => {
  it("keeps plain links amount-free", () => {
    expect(
      parsePurchaseLinkInput("https://jp.mercari.com/item/m12345678901"),
    ).toEqual({
      urls: ["https://jp.mercari.com/item/m12345678901"],
      amountsByUrl: {},
    });
  });

  it("parses a trailing amount in the forms pasted from order pages", () => {
    expect(
      parsePurchaseLinkInput(
        [
          "https://jp.mercari.com/item/m1 12800",
          "https://jp.mercari.com/item/m2 ¥12,800",
          "https://jp.mercari.com/item/m3 9800円",
          "https://jp.mercari.com/item/m4 ￥7,500 円",
        ].join("\n"),
      ),
    ).toEqual({
      urls: [
        "https://jp.mercari.com/item/m1",
        "https://jp.mercari.com/item/m2",
        "https://jp.mercari.com/item/m3",
        "https://jp.mercari.com/item/m4",
      ],
      amountsByUrl: {
        "https://jp.mercari.com/item/m1": 12_800,
        "https://jp.mercari.com/item/m2": 12_800,
        "https://jp.mercari.com/item/m3": 9_800,
        "https://jp.mercari.com/item/m4": 7_500,
      },
    });
  });

  it("does not invent an amount from other text on the line", () => {
    expect(
      parsePurchaseLinkInput(
        [
          "https://jp.mercari.com/item/m1 2点セット",
          "https://jp.mercari.com/item/m2 0",
          "https://jp.mercari.com/item/m3 12.5",
        ].join("\n"),
      ),
    ).toEqual({
      urls: [
        "https://jp.mercari.com/item/m1",
        "https://jp.mercari.com/item/m2",
        "https://jp.mercari.com/item/m3",
      ],
      amountsByUrl: {},
    });
  });

  it("deduplicates repeated links and keeps the first amount", () => {
    expect(
      parsePurchaseLinkInput(
        [
          "https://jp.mercari.com/item/m1 12800",
          "https://jp.mercari.com/item/m1 9999",
        ].join("\n"),
      ),
    ).toEqual({
      urls: ["https://jp.mercari.com/item/m1"],
      amountsByUrl: { "https://jp.mercari.com/item/m1": 12_800 },
    });
  });
});

describe("dedupeJobsByUrl", () => {
  it("keeps the first occurrence of each URL preserving new->old order and discards subsequent duplicates", () => {
    const input = [
      { id: "1", url: "https://jp.mercari.com/item/m1" },
      { id: "2", url: "https://jp.mercari.com/item/m2" },
      { id: "3", url: "https://jp.mercari.com/item/m1" },
      { id: "4", url: "https://jp.mercari.com/item/m3" },
      { id: "5", url: "https://jp.mercari.com/item/m2" },
    ];
    const result = dedupeJobsByUrl(input);
    expect(result).toEqual([
      { id: "1", url: "https://jp.mercari.com/item/m1" },
      { id: "2", url: "https://jp.mercari.com/item/m2" },
      { id: "4", url: "https://jp.mercari.com/item/m3" },
    ]);
  });

  it("handles empty arrays", () => {
    expect(dedupeJobsByUrl([])).toEqual([]);
  });
});

describe("compactLinkLabel", () => {
  it("extracts Mercari item id into 'Mercari · <id>'", () => {
    expect(compactLinkLabel("https://jp.mercari.com/item/m54739826519")).toBe(
      "Mercari · m54739826519",
    );
    expect(
      compactLinkLabel("https://jp.mercari.com/item/m12345?foo=bar#baz"),
    ).toBe("Mercari · m12345");
  });

  it("extracts Yahoo auction id into '雅虎拍卖 · <id>'", () => {
    expect(
      compactLinkLabel(
        "https://page.auctions.yahoo.co.jp/jp/auction/b1088492041",
      ),
    ).toBe("雅虎拍卖 · b1088492041");
    expect(
      compactLinkLabel("https://auctions.yahoo.co.jp/auction/x998877?test=1"),
    ).toBe("雅虎拍卖 · x998877");
  });

  it("falls back to hostname for other URLs", () => {
    expect(compactLinkLabel("https://jp.mercari.com")).toBe("jp.mercari.com");
    expect(compactLinkLabel("https://jp.mercari.com/search?keyword=test")).toBe(
      "jp.mercari.com",
    );
    expect(compactLinkLabel("https://example.com/items/42")).toBe(
      "example.com",
    );
  });
});

