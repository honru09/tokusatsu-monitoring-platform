import { describe, expect, it } from "vitest";
import { verifiedBaiPromotionModels } from "./bai-promotions.js";

describe("B.AI live promotion verification", () => {
  it("keeps only models whose official section says API usage costs zero credits", () => {
    const document = `
      <h3>GLM-5.3-Flash</h3>
      <p>API usage is currently billed at <strong>0 Credits</strong>.</p>
      <h3>MiMo-V2.5</h3>
      <p>The promotion has ended and standard pricing applies.</p>
    `;

    expect([
      ...verifiedBaiPromotionModels(
        document,
        new Set(["glm-5.3-flash", "mimo-v2.5", "unknown-model"]),
      ),
    ]).toEqual(["glm-5.3-flash"]);
  });

  it("fails closed when the pricing document cannot prove a free API offer", () => {
    expect(
      verifiedBaiPromotionModels(
        "<html><body>Pricing is temporarily unavailable.</body></html>",
        new Set(["glm-5.3-flash"]),
      ).size,
    ).toBe(0);
  });

  it("does not borrow a free offer from the next model section", () => {
    const document = `
      <h3>GLM-5.3-Flash</h3>
      <p>The promotion has ended and standard pricing applies.</p>
      <h3>MiMo-V2.5</h3>
      <p>API usage is billed at <strong>0 Credits</strong>.</p>
    `;

    expect([
      ...verifiedBaiPromotionModels(
        document,
        new Set(["glm-5.3-flash", "mimo-v2.5"]),
      ),
    ]).toEqual(["mimo-v2.5"]);
  });
});
