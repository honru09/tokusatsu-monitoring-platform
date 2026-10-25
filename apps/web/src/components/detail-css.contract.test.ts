import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../styles/apple-refinement.css", import.meta.url),
  "utf8",
);

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("detail view CSS contracts", () => {
  it("wraps unbreakable seller names inside a shrinkable row", () => {
    expect(rule(".detail-seller-name")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule(".detail-seller-name")).toMatch(/min-width:\s*0/);
    expect(rule(".detail-seller-row")).toMatch(/min-width:\s*0/);
  });

  it("keeps breakdown amounts tabular, right-aligned and unwrapped", () => {
    const dd = rule(".detail-breakdown dd");
    expect(dd).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(dd).toMatch(/white-space:\s*nowrap/);
    expect(dd).toMatch(/text-align:\s*right/);
  });

  it("keeps hero and auction figures tabular", () => {
    expect(rule(".detail-price")).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(rule(".detail-auction > strong")).toMatch(
      /font-variant-numeric:\s*tabular-nums/,
    );
  });

  it("keeps decision actions at a comfortable touch height", () => {
    const height = (selector: string) =>
      Number(rule(selector).match(/min-height:\s*(\d+)px/)?.[1] ?? 0);
    // Measured: decision buttons were already 52px; the source action
    // sat at 46px and the same-store action at about 22px.
    expect(height(".detail-decision-button")).toBeGreaterThanOrEqual(48);
    expect(height(".detail-source-action")).toBeGreaterThanOrEqual(48);
    expect(height(".detail-seller-action")).toBeGreaterThanOrEqual(44);
  });

  it("keeps the detail spacing on the 4/8/12/16/24 scale", () => {
    expect(rule(".product-detail-overview")).toMatch(/padding:\s*24px/);
    expect(rule(".product-detail-overview")).toMatch(/gap:\s*24px/);
    expect(rule(".product-detail-reading")).toMatch(/padding:\s*0 24px 24px/);
    expect(rule(".product-detail-toolbar")).toMatch(/padding:\s*8px 16px/);
  });
});
