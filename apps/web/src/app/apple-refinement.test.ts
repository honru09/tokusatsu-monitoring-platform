import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const styles = readFileSync(
  new URL("../styles/apple-refinement.css", import.meta.url),
  "utf8",
);
it("bounds both purchase bundle cards and their implicit grid tracks on mobile", () => {
  expect(source).toContain(
    "purchase-history-list mt-3 grid min-w-0 grid-cols-1",
  );
  expect(source).toContain("purchase-history-card min-w-0 w-full");
  expect(styles).toMatch(
    /\.purchase-history-card\s*\{\s*overflow-wrap:\s*anywhere/,
  );
});
it("owns a bounded scroll area and persistent footer in the product detail", () => {
  expect(styles).toMatch(/grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto/);
  expect(source).toContain("product-detail-scroll scrollbar-thin");
  expect(source).toContain("detail-primary-actions product-detail-footer");
});
