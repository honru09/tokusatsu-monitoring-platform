import { describe, expect, it } from "vitest";
import { extractProductImageUrls, sanitizeProductImageUrls } from "./images.js";

describe("sanitizeProductImageUrls", () => {
  it("keeps product photos in source order and removes site chrome", () => {
    expect(
      sanitizeProductImageUrls([
        "https://auctions.c.yimg.jp/images.auctions.yahoo.co.jp/image/a.jpg",
        "https://s.yimg.jp/images/serp/as/ic_prof_default.png",
        "https://displayname-pctr.c.yimg.jp/d/display-name/seller.jpg",
        "https://auctions.yahoo.co.jp/jp/auction/PHN2ZyB4bWxucz0i.svg",
        "https://shop.example.jp/assets/logo.svg",
      ]),
    ).toEqual([
      "https://auctions.c.yimg.jp/images.auctions.yahoo.co.jp/image/a.jpg",
    ]);
  });

  it("canonicalizes Yahoo thumbnail proxies and deduplicates the original", () => {
    expect(
      sanitizeProductImageUrls([
        "https://auc-pctr.c.yimg.jp/i/auctions.c.yimg.jp/images.auctions.yahoo.co.jp/image/a.jpg?pri=l&w=214&h=214",
        "https://auctions.c.yimg.jp/images.auctions.yahoo.co.jp/image/a.jpg",
      ]),
    ).toEqual([
      "https://auctions.c.yimg.jp/images.auctions.yahoo.co.jp/image/a.jpg",
    ]);
  });
});

describe("extractProductImageUrls", () => {
  it("recovers nested marketplace photos without collecting seller URLs", () => {
    expect(
      extractProductImageUrls({
        sourceUrl: "https://jp.mercari.com/item/m123",
        seller: { profileUrl: "https://jp.mercari.com/user/profile/1" },
        photos: [
          { uri: "https://img.example/one.jpg" },
          { url: "https://img.example/two.jpg" },
        ],
      }),
    ).toEqual(["https://img.example/one.jpg", "https://img.example/two.jpg"]);
  });
});
