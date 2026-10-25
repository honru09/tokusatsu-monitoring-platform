import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globals = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const mobileChrome = readFileSync(
  new URL("../styles/mobile-chrome.css", import.meta.url),
  "utf8",
);
const tsx = readFileSync(
  new URL("../components/collaboration-chat-workspace.tsx", import.meta.url),
  "utf8",
);

function ruleBody(css: string, selectorPattern: RegExp): string {
  const body = css.match(selectorPattern)?.[1];
  expect(body, `missing rule ${selectorPattern}`).toBeTruthy();
  return body as string;
}

function zIndexOf(body: string): number {
  const value = body.match(/z-index:\s*(\d+)/)?.[1];
  expect(value, "missing z-index").toBeTruthy();
  return Number(value);
}

describe("collaboration composer panel contracts", () => {
  it("lays the composer context strip out as one flex row", () => {
    // The strip renders three children for a reply (icon, text, close)
    // and four when an item is quoted (a target-price input joins), so
    // it cannot be a fixed-column grid: the quoted input used to be
    // squeezed into the close button's track and the button wrapped.
    const strip = ruleBody(
      globals,
      /\.collaboration-composer-context\s*\{([^}]*)\}/,
    );
    expect(strip).toMatch(/display:\s*flex/);
    expect(strip).toMatch(/flex-wrap:\s*nowrap/);
    expect(strip).toMatch(/min-height:\s*48px/);
    expect(strip).not.toMatch(/grid-template-columns/);
    expect(globals).not.toContain("34px minmax(0, 1fr) 40px");
  });

  it("keeps the strip's fixed children at full size and lets the text shrink", () => {
    const icon = ruleBody(
      globals,
      /\.collaboration-composer-context-icon\s*\{([^}]*)\}/,
    );
    const input = ruleBody(
      globals,
      /\.collaboration-composer-context > input\s*\{([^}]*)\}/,
    );
    const close = ruleBody(
      globals,
      /\.collaboration-composer-context > button\s*\{([^}]*)\}/,
    );
    const text = ruleBody(
      globals,
      /\.collaboration-composer-context span:nth-child\(2\)\s*\{([^}]*)\}/,
    );
    expect(icon).toMatch(/flex:\s*0 0 auto/);
    expect(input).toMatch(/flex:\s*0 0 auto/);
    expect(close).toMatch(/flex:\s*0 0 auto/);
    expect(text).toMatch(/min-width:\s*0/);
    // The markup carries the matching utilities: the text span absorbs
    // the squeeze and ellipsises, the price input keeps its width.
    expect(tsx).toContain('className="min-w-0 flex-1"');
    expect(tsx).toMatch(/placeholder="目标日元\(可选\)"[\s\S]{0,200}w-28 shrink-0/);
  });

  it("stacks the composer above the floating dock, below nav and dialogs", () => {
    const composer = ruleBody(
      globals,
      /\.collaboration-composer\s*\{([^}]*)\}/,
    );
    expect(composer).toMatch(/position:\s*relative/);
    const composerZ = zIndexOf(composer);

    const dock = ruleBody(
      mobileChrome,
      /\.floating-control\.workspace-history-orb,\s*\.floating-control\.collaboration-negotiation-float\s*\{([^}]*)\}/,
    );
    const dragging = ruleBody(
      mobileChrome,
      /\.floating-control\.is-dragging\s*\{([^}]*)\}/,
    );
    const nav = ruleBody(
      mobileChrome,
      /\.primary-navigation\.ios-nav\s*\{([^}]*)\}/,
    );
    const dialog = ruleBody(
      globals,
      /\.negotiation-dialog-backdrop\s*\{([^}]*)\}/,
    );

    // Dock 80, dock while dragging 90, composer in between, then the
    // bottom nav and the negotiation dialog stay on top.
    expect(zIndexOf(dock)).toBeLessThan(composerZ);
    expect(zIndexOf(dragging)).toBeLessThan(composerZ);
    expect(composerZ).toBeLessThan(zIndexOf(nav));
    expect(composerZ).toBeLessThan(zIndexOf(dialog));
  });
});
