import { describe, expect, it } from "vitest";
import {
  shippingEvidence,
  structuredShipping,
  textualShipping,
} from "./shipping.js";

describe("shipping evidence", () => {
  it("reads a fixed JSON-LD shipping rate", () => {
    expect(
      structuredShipping({
        offers: {
          shippingDetails: { shippingRate: { value: 850, currency: "JPY" } },
        },
      }),
    ).toMatchObject({ fee: 850, status: "fixed" });
  });

  it("does not invent a fee when rates vary by region", () => {
    const result = structuredShipping({
      shippingDetails: [
        { shippingRate: { value: 750, currency: "JPY" } },
        { shippingRate: { value: 1200, currency: "JPY" } },
      ],
    });
    expect(result.status).toBe("calculated");
    expect(result.fee).toBeUndefined();
  });

  it("recognizes payer text without turning hydration numbers into postage", () => {
    const calculated = textualShipping(
      "送料は落札者負担で配送先の地域により異なります",
    );
    expect(calculated.status).toBe("calculated");
    expect(calculated.fee).toBeUndefined();
    const unknown = shippingEvidence({}, "送料13 hydration-id");
    expect(unknown.status).toBe("unknown");
    expect(unknown.fee).toBeUndefined();
  });

  it("does not mark threshold-based free shipping as universally free", () => {
    const result = textualShipping("999円以上は送料無料（未満は地域別）");
    expect(result.status).toBe("calculated");
    expect(result.fee).toBeUndefined();
  });

  it("normalizes full-width yen digits", () => {
    expect(textualShipping("送料５５０円")).toMatchObject({
      status: "fixed",
      fee: 550,
    });
  });

  it("rejects a negative amount near a shipping label", () => {
    const result = textualShipping("キャンペーン適用で送料が－120円");
    expect(result.status).toBe("unknown");
    expect(result.fee).toBeUndefined();
  });
});
