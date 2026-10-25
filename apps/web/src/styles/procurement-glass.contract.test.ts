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

  it("lays the market grid out in two columns on phone widths", () => {
    for (const source of [globals, css, polish, finalLayer]) {
      expect(source).not.toMatch(
        /\.procurement-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
      );
    }
    expect(finalLayer).toMatch(
      /@media\s*\(max-width:\s*639px\)\s*\{[\s\S]*?\.procurement-shell \.procurement-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*!important/,
    );
    // Cards size to their content inside the phone grid instead of the
    // fixed desktop height floor, with a 4/3 image.
    expect(finalLayer).toMatch(
      /\.procurement-shell \.procurement-grid \.js-product-card\s*\{[^}]*min-height:\s*0\s*!important/,
    );
    expect(finalLayer).toMatch(
      /\.procurement-shell \.procurement-grid \.product-card-media\s*\{[^}]*aspect-ratio:\s*4\/3\s*!important/,
    );
    // The unknown-quantity row (no amount) collapses in the phone grid.
    expect(finalLayer).toMatch(
      /dl\[data-qty-unknown="true"\] \.product-card-qty/,
    );
  });

  it("keeps the catalog toolbar on one scrollable line with an opaque surface on phones", () => {
    expect(finalLayer).toMatch(
      /\.procurement-shell \.catalog-toolbar\s*\{\s*background:\s*#fff\s*!important/,
    );
    expect(finalLayer).toMatch(
      /\.procurement-shell \.catalog-actions\s*\{[^}]*flex-wrap:\s*nowrap[^}]*overflow-x:\s*auto/,
    );
    expect(finalLayer).toMatch(
      /\.procurement-shell \.catalog-mode-switch\s*\{\s*flex:\s*0 0 auto/,
    );
  });

  it("renders home category and source selectors as wrapping chips on phones", () => {
    expect(finalLayer).toMatch(
      /\.procurement-shell \.home-category-list>div\s*\{[^}]*flex-wrap:\s*wrap[^}]*overflow-x:\s*visible/,
    );
    expect(finalLayer).toMatch(
      /\.procurement-shell \.home-category-list button\s*\{[^}]*align-self:\s*flex-start/,
    );
    expect(finalLayer).toMatch(
      /\.procurement-shell \.home-source-list>div\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/,
    );
    expect(finalLayer).toMatch(
      /\.procurement-shell \.home-source-row>i\s*\{\s*display:\s*none/,
    );
  });

  it("keeps the card stationary when reaching its gallery arrows", () => {
    for (const source of [globals, polish, finalLayer]) {
      const hover = source.match(/\.product-card:hover\s*\{([^{}]*)\}/)?.[1];
      expect(hover).toMatch(/transform:\s*none;/);
      expect(hover).not.toMatch(/translate|scale/);
    }
  });

  it("keeps phone grid cards content-sized with one tidy action row", () => {
    // No height:100% stretch and no expanding note row on phones: the
    // final layer re-stacks the card body and pins actions to content.
    expect(finalLayer).toMatch(
      /\.procurement-shell \.procurement-grid \.js-product-card\s*\{[^}]*height:\s*auto\s*!important/,
    );
    // The bundle toggle lives in the tags row; no seller row shares
    // the bottom of the card with the icon-only action row.
    expect(finalLayer).not.toMatch(/product-card-seller/);
    expect(finalLayer).toMatch(
      /\.procurement-shell \.procurement-grid \.product-card-actions\s*\{[^}]*display:\s*flex\s*!important[^}]*margin-top:\s*0\s*!important/,
    );
    expect(finalLayer).toMatch(
      /\.procurement-shell \.procurement-grid \.product-card-title\s*\{[^}]*-webkit-line-clamp:\s*2\s*!important/,
    );
    expect(finalLayer).toMatch(
      /\.procurement-shell \.product-card-split-facts\s*\{\s*display:\s*none/,
    );
    expect(finalLayer).toMatch(
      /\.procurement-shell \.catalog-toolbar h2\s*\{[^}]*scroll-margin-top:\s*calc\(var\(--app-header-height\)/,
    );
  });
});
