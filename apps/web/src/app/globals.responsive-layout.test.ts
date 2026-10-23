import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

describe("responsive shell contracts", () => {
  it("reserves the bottom navigation clearance on desktop and mobile", () => {
    expect(css).toMatch(
      /@media \(min-width: 1024px\)[\s\S]*?\.procurement-content\s*\{[\s\S]*?height:\s*calc\(100dvh - var\(--app-header-height\) - var\(--app-nav-clearance\)\);/,
    );
    expect(css).toMatch(
      /@media \(max-width: 639px\)[\s\S]*?--app-nav-height:\s*74px;/,
    );
  });

  it("keeps the chat toolbar in the mobile thumb zone", () => {
    expect(css).toMatch(
      /@media \(max-width: 639px\)[\s\S]*?\.collaboration-message\.is-own \.collaboration-message-actions,[\s\S]*?position:\s*fixed;[\s\S]*?left:\s*50%;/,
    );
  });

  it("uses four stable bottom-navigation columns", () => {
    expect(css).toMatch(
      /\.primary-navigation\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
    );
  });

  it("keeps shell overlays above transformed or filtered content", () => {
    expect(css).toMatch(
      /\.shell-overlay-root\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?z-index:\s*200/,
    );
    expect(css).toMatch(
      /\.negotiation-dialog-backdrop\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?place-items:\s*center/,
    );
  });

  it("uses transform and opacity for the negotiation rail motion", () => {
    expect(css).toMatch(
      /\.negotiation-status-rail\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?transform:/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.negotiation-status-rail\s*\{\s*transition:\s*none/,
    );
  });

  it("does not retain the removed discovery page CSS", () => {
    expect(css).not.toMatch(/\.discovery-|\.workspace-discovery\b/);
  });
});
