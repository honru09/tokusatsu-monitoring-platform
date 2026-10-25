import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globals = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const editorial = readFileSync(
  new URL("./editorial-communications.module.css", import.meta.url),
  "utf8",
);
const glass = readFileSync(
  new URL("../styles/procurement-glass.css", import.meta.url),
  "utf8",
);
const tsx = readFileSync(
  new URL("./collaboration-chat-workspace.tsx", import.meta.url),
  "utf8",
);

function selectableRules(css: string): string[] {
  return [
    ...css.matchAll(/\.collaboration-product\.is-selectable\)?\s*\{([^}]*)\}/g),
  ].map((match) => match[1]);
}

describe("collaboration share card contracts", () => {
  it("gives the selection toggle its own grid track in every layer", () => {
    // The card is a 3-track grid (image | copy | open). Selection mode
    // renders the toggle as a fourth child; without a fourth track it
    // took the image track, squeezed the copy into the 44px open track
    // (totals ellipsised, amounts broke mid-number) and pushed the open
    // button onto a second row under a tall empty band.
    expect(tsx).toContain('" is-selectable"');
    for (const css of [globals, editorial]) {
      const rules = selectableRules(css);
      expect(rules.length).toBeGreaterThanOrEqual(2);
      for (const rule of rules) {
        expect(rule).toMatch(
          /grid-template-columns:\s*36px\s+\d+px\s+minmax\(0,\s*1fr\)\s+44px/,
        );
      }
    }
  });

  it("keeps the discount amount a single nowrap token", () => {
    const base = glass.match(/\.yahoo-discount strong\s*\{([^}]*)\}/)?.[1];
    expect(base).toBeTruthy();
    expect(base).toMatch(/white-space:\s*nowrap/);
    expect(base).not.toMatch(/overflow-wrap:\s*anywhere/);
    // Inside the chat card the amount used to inherit white-space:normal
    // from the copy-span context, which is what let ¥2,640 split.
    const inChat = glass.match(
      /\.collaboration-product-copy \.yahoo-discount strong,\s*\.assistant-result-copy \.yahoo-discount strong\s*\{([^}]*)\}/,
    )?.[1];
    expect(inChat).toBeTruthy();
    expect(inChat).toMatch(/white-space:\s*nowrap/);
    expect(inChat).not.toMatch(/white-space:\s*normal/);
  });

  it("keeps the discount label on one line so it cannot squeeze the amount", () => {
    const label = glass.match(
      /\.collaboration-product-copy \.yahoo-discount > span,\s*\.assistant-result-copy \.yahoo-discount > span\s*\{([^}]*)\}/,
    )?.[1];
    expect(label).toBeTruthy();
    expect(label).toMatch(/white-space:\s*nowrap/);
    expect(label).toMatch(/flex-wrap:\s*nowrap/);
  });

  it("keeps bundle and share-round totals nowrap in the markup", () => {
    // Bundle header total: shrink-proof container, nowrap amount.
    expect(tsx).toMatch(
      /shrink-0 text-right font-mono text-xs tabular-nums[\s\S]{0,200}whitespace-nowrap font-bold text-ink/,
    );
    // Share-round row: the price is its own shrink-proof span, not
    // nested inside the truncating title span where a long title
    // ellipsised it.
    expect(tsx).toMatch(
      /shrink-0 whitespace-nowrap font-mono text-\[11px\] text-ink\/55 tabular-nums/,
    );
  });
});
