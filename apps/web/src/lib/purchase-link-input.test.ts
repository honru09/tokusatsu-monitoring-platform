import { describe, expect, it } from "vitest";
import { parsePurchaseLinkInput } from "./purchase-link-input";

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
