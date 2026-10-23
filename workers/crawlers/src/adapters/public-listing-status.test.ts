import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import {
  publicListingUiStatus,
  schemaListingStatus,
} from "./public-listing-status.js";

describe("public listing availability evidence", () => {
  it.each(["SoldOut", "OutOfStock"])(
    "reads %s product offers in a schema graph",
    (availability) => {
      expect(
        schemaListingStatus({
          "@graph": [
            { "@type": "WebPage" },
            {
              "@type": "Product",
              offers: { availability: `https://schema.org/${availability}` },
            },
          ],
        }),
      ).toBe("sold");
    },
  );

  it("does not take unrelated offers or disagreeing product schemas as evidence", () => {
    expect(
      schemaListingStatus({
        "@type": "WebPage",
        offers: { availability: "https://schema.org/SoldOut" },
      }),
    ).toBeUndefined();
    expect(
      schemaListingStatus([
        {
          "@type": "Product",
          offers: { availability: "https://schema.org/InStock" },
        },
        {
          "@type": "Product",
          offers: { availability: "https://schema.org/SoldOut" },
        },
      ]),
    ).toBeUndefined();
  });

  it("reads a visible sold badge and a dedicated auction completion notice", () => {
    expect(
      publicListingUiStatus(
        cheerio.load('<span data-testid="sold-out">SOLD</span>'),
      ),
    ).toBe("sold");
    expect(
      publicListingUiStatus(
        cheerio.load("<h2>このオークションは終了しています。</h2>"),
      ),
    ).toBe("ended");
  });

  it("ignores description, recommendations, script, and hidden sold widgets", () => {
    expect(
      publicListingUiStatus(
        cheerio.load(`<body>
      <div itemprop="description"><button>売り切れ</button></div>
      <section class="Recommendations"><span data-testid="sold-out">SOLD</span></section>
      <div aria-hidden="true"><span data-testid="sold-out">SOLD</span></div>
      <script>{"sold":"売り切れ"}</script>
    </body>`),
      ),
    ).toBeUndefined();
  });
});
