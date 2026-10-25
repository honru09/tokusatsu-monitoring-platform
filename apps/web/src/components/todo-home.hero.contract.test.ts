import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  new URL("./todo-home.module.css", import.meta.url),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `${selector} rule`).toBeTruthy();
  return match![1];
}

describe("todo hero illustration blends into the gradient", () => {
  it("fades the artwork's left edge with a mask instead of a hard seam", () => {
    const art = ruleBody(".brandArt");
    expect(art).toMatch(/mask-image:\s*linear-gradient\(\s*to right,\s*transparent/);
    expect(art).toMatch(/-webkit-mask-image:\s*linear-gradient\(\s*to right,\s*transparent/);
  });

  it("never lays an opaque block over the gradient", () => {
    const art = ruleBody(".brandArt");
    expect(art).not.toMatch(/background(-color)?:/);
    const opacity = Number(art.match(/opacity:\s*([\d.]+)/)?.[1] ?? "1");
    expect(opacity).toBeLessThan(0.5);
  });

  it("keeps the status statement above the artwork", () => {
    expect(ruleBody(".heroStatement")).toMatch(/z-index:\s*2/);
    expect(ruleBody(".brandArt")).toMatch(/pointer-events:\s*none/);
  });
});
