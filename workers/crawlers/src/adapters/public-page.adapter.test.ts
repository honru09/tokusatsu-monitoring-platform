import { describe, expect, it } from "vitest";
import { parsePublicProductPage } from "./public-page.adapter.js";

describe("public product page extraction", () => {
  it("prefers JSON-LD product facts and keeps seller, images and logistics evidence", () => {
    const html = `<!doctype html><html><head>
      <meta property="og:title" content="fallback title">
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "仮面ライダー DX ベルト セット",
        description: "本体と付属品を含む中古セット。",
        image: ["/images/one.jpg", "https://cdn.example/two.jpg"],
        sku: "DX-001",
        brand: { "@type": "Brand", name: "BANDAI" },
        seller: {
          "@type": "Organization",
          name: "特撮商店",
          url: "https://shop.example/seller",
        },
        offers: {
          "@type": "Offer",
          price: "4980",
          priceCurrency: "JPY",
          availability: "https://schema.org/InStock",
          shippingDetails: { shippingRate: { value: 800, currency: "JPY" } },
        },
        additionalProperty: [
          { name: "重量", value: "1.2 kg" },
          { name: "梱包サイズ", value: "30 x 20 x 10 cm" },
        ],
      })}</script>
    </head><body><h1>页面标题</h1><p>送料800円</p></body></html>`;

    const result = parsePublicProductPage(
      html,
      "https://shop.example/item/DX-001",
    );
    expect(result.titleRaw).toBe("fallback title");
    expect(result.priceCurrent).toBe(4980);
    expect(result.descriptionRaw).toContain("付属品");
    expect(result.sellerName).toBe("特撮商店");
    expect(result.sellerType).toBe("store");
    expect(result.sellerProfileUrl).toBe("https://shop.example/seller");
    expect(result.imageUrls).toEqual([
      "https://shop.example/images/one.jpg",
      "https://cdn.example/two.jpg",
    ]);
    expect(result.shippingFee).toBe(800);
    expect(result.sourceData).toMatchObject({
      product: { sku: "DX-001" },
      logisticsHints: {
        weightGrams: 1200,
        lengthMm: 300,
        widthMm: 200,
        heightMm: 100,
      },
    });
  });
});
