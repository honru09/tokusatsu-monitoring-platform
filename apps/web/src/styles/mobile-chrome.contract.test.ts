import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./mobile-chrome.css", import.meta.url), "utf8");

describe("mobile chrome contracts", () => {
  it("docks the collaboration floating controls above the composer on phones", () => {
    // Both controls anchor to the bottom right of the visible viewport,
    // stacked (orb above the negotiation button), clear of the bottom
    // nav via --app-nav-clearance.
    expect(css).toMatch(
      /\.workspace-collaboration\s+\.floating-control\.workspace-history-orb:not\(\.is-dragging\)\s*\{[^}]*transform:\s*translate3d\(\s*calc\(100vw - 56px\),\s*calc\(var\(--visible-height\) - var\(--app-nav-clearance\) - 172px\)/,
    );
    expect(css).toMatch(
      /\.workspace-collaboration\s+\.floating-control\.collaboration-negotiation-float:not\(\.is-dragging\)\s*\{[^}]*transform:\s*translate3d\(\s*calc\(100vw - 56px\),\s*calc\(var\(--visible-height\) - var\(--app-nav-clearance\) - 120px\)/,
    );
    // The negotiation rail opens upward from the docked button and the
    // history menu aligns to the right edge.
    expect(css).toMatch(
      /\.floating-control\.collaboration-negotiation-float\s+\.negotiation-status-rail\s*\{[^}]*bottom:\s*54px/,
    );
    expect(css).toMatch(
      /\.workspace-collaboration \.workspace-history-orb > \[role="menu"\]\s*\{\s*right:\s*0/,
    );
    // The message feed can scroll its last message clear of the stack.
    expect(css).toMatch(
      /\.workspace-collaboration \.collaboration-feed\s*\{\s*padding-bottom:\s*128px/,
    );
  });
});
