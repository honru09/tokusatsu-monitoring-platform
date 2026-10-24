import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  new URL("./editorial-communications.module.css", import.meta.url),
  "utf8",
);
const tsx = readFileSync(
  new URL("./collaboration-chat-workspace.tsx", import.meta.url),
  "utf8",
);

function ruleBody(selectorPattern: RegExp): string | undefined {
  return css.match(selectorPattern)?.[1];
}

describe("editorial communications product action contracts", () => {
  it("gives product actions one shared pill size for buttons and anchors", () => {
    const rule = ruleBody(
      /\.chat :global\(\.collaboration-product-action\)\s*\{([^{}]*)\}/,
    );
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/height:\s*40px/);
    expect(rule).toMatch(/min-height:\s*40px/);
    expect(rule).toMatch(/border-radius:\s*999px/);
    expect(rule).toMatch(/font-size:\s*12px/);
  });

  it("defines distinct primary, secondary and tertiary backgrounds", () => {
    const primary = ruleBody(
      /\.collaboration-product-action\.is-primary\)\s*\{([^{}]*)\}/,
    );
    const secondary = ruleBody(
      /\.collaboration-product-action\.is-secondary\)\s*\{([^{}]*)\}/,
    );
    const tertiary = ruleBody(
      /\.collaboration-product-action\.is-tertiary\)\s*\{([^{}]*)\}/,
    );
    expect(primary).toBeTruthy();
    expect(secondary).toBeTruthy();
    expect(tertiary).toBeTruthy();
    const backgroundOf = (rule: string | undefined) =>
      rule?.match(/background:\s*([^;]+);/)?.[1]?.trim();
    expect(backgroundOf(primary)).toBeTruthy();
    expect(backgroundOf(secondary)).toBeTruthy();
    expect(backgroundOf(tertiary)).toBeTruthy();
    expect(backgroundOf(primary)).not.toBe(backgroundOf(secondary));
    expect(backgroundOf(primary)).not.toBe(backgroundOf(tertiary));
    expect(backgroundOf(secondary)).not.toBe(backgroundOf(tertiary));
  });

  it("applies the shared classes in the product reference actions", () => {
    expect(tsx).toContain("collaboration-product-action is-primary");
    expect(tsx).toContain("collaboration-product-action is-secondary");
    // The copy button uses the primary treatment and the source link the secondary one.
    expect(tsx).toMatch(
      /className="collaboration-product-action is-primary"[\s\S]{0,200}复制砍价日语/,
    );
    expect(tsx).toMatch(
      /className="collaboration-product-action is-secondary"[\s\S]{0,200}直达原商品/,
    );
    expect(tsx).not.toContain("min-h-8 items-center gap-1 rounded-full");
  });

  it("resets the raised chip shadow inside the chat account buttons", () => {
    const rule = ruleBody(
      /\.collaboration-account-button\) :is\(small, span\)\s*\{([^{}]*)\}/,
    );
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/box-shadow:\s*none/);
  });
});
