import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./procurement-glass.css", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const polish = readFileSync(new URL("./apple-polish.css", import.meta.url), "utf8");
const finalLayer = readFileSync(new URL("./simple-apple.css", import.meta.url), "utf8");

function expectContentSafeCardRule(rule: string | undefined) {
  expect(rule).toBeTruthy();
  expect(rule).toMatch(/(?:^|[;\n])\s*height:\s*100%\s*!important/);
  expect(rule).toMatch(/min-height:\s*var\(--product-card-height\)\s*!important/);
  expect(rule).toMatch(/max-height:\s*none\s*!important/);
}

describe("procurement glass layout contracts", () => {
  it("uses a governed minimum without clipping taller card content", () => {
    const cardRule = css.match(
      /\.procurement-shell \.js-product-card\s*\{([\s\S]*?)\}/,
    )?.[1];
    expectContentSafeCardRule(cardRule);
  });

  it("keeps mobile content safe under the same minimum-height contract", () => {
    const mobileRule = css.match(
      /@media \(max-width: 639px\)\s*\{[\s\S]*?\.procurement-shell \.js-product-card\s*\{([\s\S]*?)\}/,
    )?.[1];
    expectContentSafeCardRule(mobileRule);
  });

  it("keeps every later card style layer from restoring a clipping maximum", () => {
    for (const source of [globals, css, polish, finalLayer]) {
      const cardRules = [...source.matchAll(/([^{}]*\.(?:js-product-card|product-card)\s*(?:,[^{]+)?\s*)\{([^{}]*)\}/g)];
      expect(cardRules.length).toBeGreaterThan(0);
      for (const [, , rule] of cardRules) {
        expect(rule).not.toMatch(/(?:^|[;\n])\s*(?:height|max-height):\s*(?:var\(--product-card-height\)|\d+px)/);
      }
    }
  });

  it("keeps all grid rows equal while preserving the action and optional note rows", () => {
    const gridRule = globals.match(/\.procurement-grid\s*\{([^{}]*)\}/)?.[1];
    expect(gridRule).toMatch(/grid-auto-rows:\s*1fr/);
    expect(css).toMatch(/"note"\s+minmax\(var\(--product-card-note-height\),\s*1fr\)/);
    expect(css).toMatch(/\.procurement-shell \.product-card-actions\s*\{[^{}]*grid-area:\s*actions;[^{}]*min-height:\s*44px;/);
    expect(polish).not.toMatch(/\.procurement-shell \.product-card-body\s*\{[^{}]*overflow:\s*hidden/);
    expect(globals).not.toMatch(/\.product-card-has-note \.product-card-title/);
  });

  it("keeps the card stationary when reaching its gallery arrows", () => {
    for (const source of [globals, polish, finalLayer]) {
      const hover = source.match(/\.product-card:hover\s*\{([^{}]*)\}/)?.[1];
      expect(hover).toMatch(/transform:\s*none;/);
      expect(hover).not.toMatch(/translate|scale/);
    }
  });
});
