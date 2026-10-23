import { describe, expect, it } from "vitest";
import { extractLogisticsHints } from "./logistics-hints.js";

describe("logistics hints", () => {
  it("normalizes a labelled package triple and weight to mm and g", () => {
    const hints = extractLogisticsHints({
      titleRaw: "仮面ライダー まとめ売り",
      descriptionRaw: "梱包サイズ：30×20×10 cm、梱包重量：約1.2 kg",
    });

    expect(hints).toMatchObject({
      lengthMm: 300,
      widthMm: 200,
      heightMm: 100,
      weightGrams: 1200,
      basis: "package",
    });
    expect(hints.evidence).not.toHaveLength(0);
  });

  it("maps W/D/H and Japanese named dimensions without mixing axes", () => {
    expect(
      extractLogisticsHints({
        titleRaw: "ミニフィギュア",
        sourceData: {
          bodyText: "商品サイズ W 12 cm / D 8 cm / H 5 cm。本体重量 450 g",
        },
      }),
    ).toMatchObject({
      widthMm: 120,
      lengthMm: 80,
      heightMm: 50,
      weightGrams: 450,
      basis: "product",
    });

    expect(
      extractLogisticsHints({
        descriptionRaw: "本体寸法 幅 90mm、奥行き 40mm、高さ 120mm",
      }),
    ).toMatchObject({ widthMm: 90, lengthMm: 40, heightMm: 120 });
  });

  it("reads schema-style quantitative values and additional properties", () => {
    const hints = extractLogisticsHints({
      sourceData: {
        structuredData: {
          "@type": "Product",
          width: { value: 18, unitCode: "CMT" },
          depth: { value: 7.5, unitCode: "CMT" },
          height: { value: 25, unitCode: "CMT" },
          additionalProperty: [{ name: "商品重量", value: "380 g" }],
        },
      },
    });

    expect(hints).toMatchObject({
      widthMm: 180,
      lengthMm: 75,
      heightMm: 250,
      weightGrams: 380,
      basis: "product",
    });
  });

  it("extracts an explicit package volume and keeps product volume out of procurement", () => {
    expect(
      extractLogisticsHints({
        descriptionRaw: "梱包体積：800 cm³、梱包重量 500 g",
      }),
    ).toMatchObject({
      volumeCm3: 800,
      volumeBasis: "package",
      basis: "package",
    });

    expect(
      extractLogisticsHints({
        descriptionRaw: "商品体積：800 cm³",
      }),
    ).toMatchObject({
      volumeCm3: 800,
      volumeBasis: "product",
      basis: "product",
    });
  });

  it("reads structured volume fields with explicit cubic units", () => {
    expect(
      extractLogisticsHints({
        sourceData: {
          package: {
            volumeCm3: 1_250,
            volumeUnit: "cm3",
          },
        },
      }),
    ).toMatchObject({
      volumeCm3: 1_250,
      volumeBasis: "package",
      basis: "package",
    });
  });

  it("prefers shipping-package measurements over product-body measurements", () => {
    const hints = extractLogisticsHints({
      descriptionRaw: "梱包サイズ 30×20×10 cm、梱包重量 1.2 kg",
      sourceData: {
        structuredData: {
          "@type": "Product",
          width: { value: 10, unitCode: "CMT" },
          depth: { value: 5, unitCode: "CMT" },
          height: { value: 15, unitCode: "CMT" },
          weight: { value: 400, unitCode: "GRM" },
        },
      },
    });

    expect(hints).toMatchObject({
      lengthMm: 300,
      widthMm: 200,
      heightMm: 100,
      weightGrams: 1_200,
      basis: "package",
    });
  });

  it("preserves valid existing standardized hints and fills only gaps", () => {
    const hints = extractLogisticsHints({
      descriptionRaw: "梱包サイズ 30×20×10 cm、梱包重量 900g",
      sourceData: {
        logisticsHints: {
          weightGrams: 750,
          lengthMm: 310,
          evidence: ["operator import"],
          basis: "package",
        },
      },
    });

    expect(hints).toMatchObject({
      weightGrams: 750,
      lengthMm: 310,
      widthMm: 200,
      heightMm: 100,
      basis: "mixed",
      dimensionBasis: "mixed",
    });
    expect(hints.evidence).toContain("operator import");
  });

  it("accepts a physical triple with a unit but rejects sizes, scales and model codes", () => {
    expect(
      extractLogisticsHints({ descriptionRaw: "外箱は 30 x 20 x 10 cm です" }),
    ).toMatchObject({ lengthMm: 300, widthMm: 200, heightMm: 100 });

    expect(
      extractLogisticsHints({
        titleRaw: "Tシャツ サイズ120",
        descriptionRaw:
          "1/12スケール 型番 AB-30x20x10、適合身長120cm、重量感があります",
        conditionRaw: "本体のみ",
      }),
    ).toEqual({});
  });

  it("does not choose between conflicting equally explicit measurements", () => {
    expect(
      extractLogisticsHints({
        descriptionRaw:
          "商品サイズ 30×20×10 cm。別記の商品サイズ 40×30×20 cm。",
      }),
    ).toEqual({});
  });

  it("does not keep stale dimensions when equally explicit new values conflict", () => {
    const hints = extractLogisticsHints({
      sourceData: {
        logisticsHints: {
          lengthMm: 300,
          widthMm: 200,
          heightMm: 100,
          basis: "package",
          dimensionBasis: "package",
        },
      },
      descriptionRaw: "商品サイズ 30×20×10 cm。別記の商品サイズ 40×30×20 cm。",
    });
    expect(hints.dimensionBasis).toBe("mixed");
    expect(hints.basis).toBe("mixed");
  });

  it("keeps product dimensions separate from package weight", () => {
    expect(
      extractLogisticsHints({
        sourceData: {
          productDimensions: "商品サイズ 10×8×5 cm",
          packageWeight: "梱包重量 1.2 kg",
        },
      }),
    ).toMatchObject({
      lengthMm: 100,
      widthMm: 80,
      heightMm: 50,
      weightGrams: 1_200,
      dimensionBasis: "product",
      weightBasis: "package",
      basis: "mixed",
    });
  });

  it("does not combine named product and package axes into one volume", () => {
    expect(
      extractLogisticsHints({
        descriptionRaw: "商品本体 幅 10cm。梱包時 奥行 20cm、高さ 30cm。",
      }),
    ).not.toMatchObject({
      lengthMm: expect.any(Number),
      widthMm: expect.any(Number),
      heightMm: expect.any(Number),
    });
  });

  it("does not relabel product measurements from unrelated shipping prose", () => {
    expect(
      extractLogisticsHints({
        descriptionRaw:
          "商品サイズ 10×8×5 cm。配送は匿名です。商品体積：400 cm³。発送は宅急便です。",
      }),
    ).toMatchObject({
      lengthMm: 100,
      widthMm: 80,
      heightMm: 50,
      dimensionBasis: "product",
      volumeCm3: 400,
      volumeBasis: "product",
      basis: "product",
    });

    expect(
      extractLogisticsHints({
        sourceData: {
          size: "商品サイズ 10×8×5 cm。配送は匿名です。",
        },
      }),
    ).toMatchObject({
      dimensionBasis: "product",
      basis: "product",
    });
  });

  it("accepts a package label attached before or after the measurement", () => {
    expect(
      extractLogisticsHints({
        descriptionRaw: "梱包サイズ 30×20×10 cm。体積 6000 cm³ (package)",
      }),
    ).toMatchObject({
      dimensionBasis: "package",
      volumeBasis: "package",
      basis: "package",
    });
  });

  it("adds package provenance to matching legacy dimensions but not conflicting ones", () => {
    expect(
      extractLogisticsHints({
        sourceData: {
          logisticsHints: {
            lengthMm: 300,
            widthMm: 200,
            heightMm: 100,
          },
          shippingText: "梱包サイズ 30×20×10 cm",
        },
      }),
    ).toMatchObject({
      lengthMm: 300,
      widthMm: 200,
      heightMm: 100,
      dimensionBasis: "package",
      basis: "package",
    });

    const conflicting = extractLogisticsHints({
      sourceData: {
        logisticsHints: {
          lengthMm: 310,
          widthMm: 200,
          heightMm: 100,
        },
        shippingText: "梱包サイズ 30×20×10 cm",
      },
    });
    expect(conflicting).toMatchObject({
      lengthMm: 310,
      widthMm: 200,
      heightMm: 100,
    });
    expect(conflicting.dimensionBasis).toBe("mixed");
    expect(conflicting.basis).toBe("mixed");
  });

  it("invalidates a previously trusted package size when new evidence conflicts", () => {
    const conflicting = extractLogisticsHints({
      sourceData: {
        logisticsHints: {
          lengthMm: 300,
          widthMm: 200,
          heightMm: 100,
          basis: "package",
          dimensionBasis: "package",
        },
        shippingText: "梱包サイズ 40×30×20 cm",
      },
    });

    expect(conflicting).toMatchObject({
      lengthMm: 300,
      widthMm: 200,
      heightMm: 100,
      dimensionBasis: "mixed",
      basis: "mixed",
    });
    expect(
      conflicting.evidence?.some((entry) => entry.includes("尺寸证据冲突")),
    ).toBe(true);
  });
});
