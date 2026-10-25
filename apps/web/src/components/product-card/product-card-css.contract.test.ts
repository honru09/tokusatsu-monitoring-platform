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

describe("fixed-form card geometry contracts", () => {
  it("defines one height token per body slot in the final layer", () => {
    expect(finalLayer).toMatch(/--product-card-tags-height:\s*24px/);
    expect(finalLayer).toMatch(/--product-card-title-height:\s*48px/);
    expect(finalLayer).toMatch(/--product-card-price-height:\s*32px/);
    expect(finalLayer).toMatch(/--product-card-meta-height:\s*20px/);
  });

  it("pins the tags and title slots to their tokens", () => {
    expect(finalLayer).toMatch(
      /\.product-card-tags \{[^}]*height:\s*var\(--product-card-tags-height\)\s*!important[^}]*flex-wrap:\s*nowrap\s*!important[^}]*overflow:\s*hidden/,
    );
    expect(finalLayer).toMatch(
      /\.product-card-title \{[^}]*height:\s*var\(--product-card-title-height\)\s*!important[^}]*min-height:\s*var\(--product-card-title-height\)\s*!important[^}]*max-height:\s*var\(--product-card-title-height\)\s*!important/,
    );
  });

  it("keeps the price slot on one nowrap row and the meta slot reserved", () => {
    expect(finalLayer).toMatch(
      /\.product-card-price-slot \{[^}]*height:\s*var\(--product-card-price-height\)[^}]*flex-wrap:\s*nowrap\s*!important/,
    );
    expect(finalLayer).toMatch(
      /\.product-card-meta \{[^}]*height:\s*var\(--product-card-meta-height\)[^}]*white-space:\s*nowrap[^}]*overflow:\s*hidden/,
    );
  });

  it("shrinks the slot tokens in the phone grid only", () => {
    expect(finalLayer).toMatch(
      /\.procurement-shell \.procurement-grid \{\s*--product-card-title-height:\s*34px;\s*--product-card-price-height:\s*24px;\s*--product-card-meta-height:\s*16px;/,
    );
  });

  it("has no note row left in the glass body grid", () => {
    expect(glass).not.toMatch(/"note"/);
    expect(glass).not.toContain(".product-card-note {");
    expect(glass).toMatch(/"decision" auto\s+"actions" auto/);
  });
});
