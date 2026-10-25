import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const finalLayer = readFileSync(
  new URL("../../styles/simple-apple.css", import.meta.url),
  "utf8",
);
const glass = readFileSync(
  new URL("../../styles/procurement-glass.css", import.meta.url),
  "utf8",
);
const globals = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);

describe("product card price and action row contracts", () => {
  it("never lets the hero total wrap mid-number in the final layer", () => {
    expect(finalLayer).toMatch(
      /\.product-card-total dd \{font-size:24px[^}]*white-space:\s*nowrap/,
    );
    // Phone grid: the total row may wrap as a row, but the amount
    // itself is shrink-proof and nowrap, so the CNY estimate drops
    // underneath instead of squeezing the amount.
    expect(finalLayer).toMatch(
      /\.product-card-total \{display:flex !important;flex-wrap:\s*wrap/,
    );
    expect(finalLayer).toMatch(
      /\.product-card-total dd \{font-size:16px[^}]*flex-shrink:\s*0[^}]*white-space:\s*nowrap/,
    );
    expect(finalLayer).toMatch(
      /\.product-card-total > small \{font-size:10px;white-space:\s*nowrap/,
    );
  });

  it("does not allow character-level breaks in the glass price block", () => {
    const rule = glass.match(
      /:is\(dt, dd, \.product-card-total > small\) \{([^{}]*)\}/,
    )?.[1];
    expect(rule).toBeTruthy();
    expect(rule).not.toMatch(/overflow-wrap:\s*anywhere/);
    expect(glass).toMatch(
      /\.product-card-total dd \{\s*font-size: clamp\(1\.125rem[^}]*white-space:\s*nowrap/,
    );
  });

  it("keeps the action grid at four columns for the four icon buttons", () => {
    const rules = [
      ...globals.matchAll(/\.product-card-actions \{([^{}]*)\}/g),
    ]
      .map((match) => match[1])
      .filter((body) => body.includes("grid-template-columns"));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).toMatch(/repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
    }
  });

  it("leaves no seller row behind in any card layer", () => {
    for (const source of [finalLayer, glass, globals]) {
      expect(source).not.toContain("product-card-seller");
    }
  });
});
