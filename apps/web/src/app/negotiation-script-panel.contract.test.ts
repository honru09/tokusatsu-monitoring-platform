import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globals = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const tsx = readFileSync(
  new URL("../components/collaboration-chat-workspace.tsx", import.meta.url),
  "utf8",
);

function ruleBody(css: string, selectorPattern: RegExp): string {
  const body = css.match(selectorPattern)?.[1];
  expect(body, `missing rule ${selectorPattern}`).toBeTruthy();
  return body as string;
}

function referencedScriptClasses(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(/negotiation-script-[a-z-]+/g)) {
    names.add(match[0]);
  }
  return [...names];
}

describe("negotiation script panel contracts", () => {
  it("defines every negotiation-script-* class the component references", () => {
    const referenced = referencedScriptClasses(tsx);
    // The batch-6 panel shipped with this whole family undefined; pin the
    // known members so a rename cannot silently shrink the check.
    expect(referenced).toEqual(
      expect.arrayContaining([
        "negotiation-script-panel",
        "negotiation-script-generate",
        "negotiation-script-error",
        "negotiation-script-group",
        "negotiation-script-group-head",
        "negotiation-script-fallback-badge",
        "negotiation-script-text",
      ]),
    );
    for (const name of referenced) {
      const defined = new RegExp(`\\.${name}(?=[\\s{:.>])`).test(globals);
      expect(defined, `${name} is referenced but has no CSS rule`).toBe(true);
    }
  });

  it("wraps the script text instead of overflowing the panel", () => {
    const text = ruleBody(
      globals,
      /\.negotiation-script-text\s*\{([^}]*)\}/,
    );
    expect(text).toMatch(/white-space:\s*pre-wrap/);
    expect(text).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("keeps long seller names on one truncated line in the group head", () => {
    const head = ruleBody(
      globals,
      /\.negotiation-script-group-head\s*\{([^}]*)\}/,
    );
    expect(head).toMatch(/display:\s*flex/);
    const name = ruleBody(
      globals,
      /\.negotiation-script-group-head strong\s*\{([^}]*)\}/,
    );
    expect(name).toMatch(/text-overflow:\s*ellipsis/);
    expect(name).toMatch(/white-space:\s*nowrap/);
    expect(name).toMatch(/min-width:\s*0/);
  });
});
