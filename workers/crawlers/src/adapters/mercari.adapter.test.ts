import { describe, expect, it } from "vitest";
import { parseMercariDetailHtml } from "./mercari.adapter.js";

describe("Mercari adapter", () => {
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
  });
});
