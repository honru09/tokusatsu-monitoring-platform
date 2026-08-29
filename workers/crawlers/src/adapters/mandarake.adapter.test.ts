import { describe, expect, it } from "vitest";
import {
  parseMandarakeDetailHtml,
  parseMandarakeSearch,
  validateMandarakeSearchResponse,
} from "./mandarake.adapter.js";

describe("Mandarake parser", () => {
  it("deduplicates detail links", () => {
    const html =
      '<a href="/order/detailPage/item?itemCode=ABC123">Rider</a><a href="/order/detailPage/item?itemCode=ABC123">duplicate</a>';
    expect(parseMandarakeSearch(html)).toHaveLength(1);
  });

  it("rejects the current homepage redirect instead of reporting a zero-result success", () => {
    expect(() =>
      validateMandarakeSearchResponse(
        '<title>MANDARAKE</title><a href="https://order.mandarake.co.jp/order/">通販</a>',
        "https://www.mandarake.co.jp/",
      ),
    ).toThrow(/redirected outside the public order search/i);
  });

  it("reads JSON-LD detail data without inventing listed_at", () => {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"仮面ライダー ソフビ","description":"中古 BANDAI","image":["https://img.example/a.jpg"],"offers":{"price":"2480","availability":"https://schema.org/InStock"}}</script>`;
    const item = parseMandarakeDetailHtml(
      html,
      "https://order.mandarake.co.jp/detail",
      "ABC",
    );
    expect(item.priceCurrent).toBe(2480);
    expect(item.listedAt).toBeUndefined();
    expect(item.imageUrls).toEqual(["https://img.example/a.jpg"]);
  });
});
