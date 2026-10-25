import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

function ruleBody(selector: string): string | undefined {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`))?.[1];
}

describe("purchases workspace width contract", () => {
  it("clips horizontal overflow at the merged workspace root", () => {
    const rule = ruleBody(".procurement-workspace");
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/width:\s*100%/);
    expect(rule).toMatch(/min-width:\s*0/);
    expect(rule).toMatch(/overflow-x:\s*clip/);
  });

  it("keeps the records and orders roots shrinkable and clipped", () => {
    for (const selector of [".purchases-workspace", ".inventory-orders-page"]) {
      const rule = ruleBody(selector);
      expect(rule).toBeTruthy();
      expect(rule).toMatch(/min-width:\s*0/);
      expect(rule).toMatch(/overflow-x:\s*clip/);
    }
  });

  it("caps form controls and tables at the workspace box", () => {
    const rule = ruleBody(
      ".procurement-workspace :is(input, select, textarea, table)",
    );
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/max-width:\s*100%/);
  });
});
