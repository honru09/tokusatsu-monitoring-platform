import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./mobile-chrome.css", import.meta.url), "utf8");
const chatTsx = readFileSync(
  new URL("../components/collaboration-chat-workspace.tsx", import.meta.url),
  "utf8",
);
const pageTsx = readFileSync(
  new URL("../app/page.tsx", import.meta.url),
  "utf8",
);
const yieldTs = readFileSync(
  new URL("../lib/floating-yield.ts", import.meta.url),
  "utf8",
);

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

  it("hides every floating control while the yield signal is claimed", () => {
    // The dock must never paint over a selection bar, a modal sheet or
    // another bottom bar: the yield rule is global (not phone-only),
    // covers both floating controls through the shared class, and also
    // drops pointer events so a hidden float cannot swallow taps.
    const rule = css.match(
      /html\[data-floating-yield="true"\] \.floating-control\s*\{([^}]*)\}/,
    )?.[1];
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/visibility:\s*hidden\s*!important/);
    expect(rule).toMatch(/pointer-events:\s*none\s*!important/);
  });

  it("has the bar and sheet owners claim the yield from their own state", () => {
    // Messages: selection mode is the state that renders the selection
    // bar with the 分析 button, so it is the state that must claim.
    expect(chatTsx).toContain(
      'useFloatingYield("collaboration-selection", selectionMode)',
    );
    expect(chatTsx).toContain("collaboration-negotiation-dialog");
    expect(chatTsx).toContain("collaboration-message-actions");
    expect(chatTsx).toContain("collaboration-selection-bar");
    // Shell: modal sheets and the bundle-share bottom bar claim it too.
    expect(pageTsx).toContain('useFloatingYield("shell-sheet", shellSheetOpen)');
    expect(pageTsx).toContain('useFloatingYield(\n    "bundle-share-bar",');
  });

  it("claims the yield while the catalog toolbar is stuck", () => {
    // The catalog toolbar is the catalog's sticky section header
    // (.catalog-toolbar, position: sticky in simple-apple.css): its
    // title must never sit under a floating control, so the toolbar
    // claims the same yield while stuck. The hook defaults to the
    // catalog owner, the shell wires it to the toolbar, and the
    // sentinel the stuck check reads from sits right before it.
    expect(yieldTs).toContain('owner = "catalog-sticky-header"');
    expect(pageTsx).toContain(
      "useStickyHeaderYield(catalogToolbarSentinelRef, catalogToolbarRef)",
    );
    expect(pageTsx).toContain("ref={catalogToolbarRef}");
    expect(pageTsx).toContain('className="catalog-toolbar ');
    const sentinelAt = pageTsx.indexOf("ref={catalogToolbarSentinelRef}");
    const toolbarAt = pageTsx.indexOf("ref={catalogToolbarRef}");
    expect(sentinelAt).toBeGreaterThan(-1);
    expect(toolbarAt).toBeGreaterThan(sentinelAt);
  });
});
