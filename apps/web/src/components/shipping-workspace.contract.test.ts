import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./shipping-workspace.tsx", import.meta.url),
  "utf8",
);

/**
 * The packed-line row used to lay the thumbnail, title, both fixed-width
 * inputs, the amount column and the remove button out in a single flex
 * row: ~370px of minimum content inside a ~319px card, which pushed the
 * whole shipping page sideways on phones. The row is now two stacked
 * rows; this contract keeps the inputs off the title row.
 */
describe("shipping packed-line width contract", () => {
  it("stacks a packed line as a grid with a separate controls row", () => {
    expect(source).toContain('data-testid="packed-line"');
    expect(source).toContain('data-testid="packed-line-controls"');
    const lineTag = source.match(
      /data-testid="packed-line"\s*className="([^"]*)"/,
    );
    expect(lineTag?.[1]).toContain("grid");
    expect(lineTag?.[1]).toContain("min-w-0");
    expect(lineTag?.[1]).toContain("grid-cols-[minmax(0,1fr)]");
    expect(lineTag?.[1]).not.toContain("flex");
  });

  it("keeps the fixed-width inputs inside the controls row and allows total to wrap right", () => {
    const controlsAt = source.indexOf('data-testid="packed-line-controls"');
    expect(controlsAt).toBeGreaterThan(-1);
    const controlsTag = source.match(
      /data-testid="packed-line-controls"\s*className="([^"]*)"/,
    );
    expect(controlsTag?.[1]).toContain("flex-wrap");
    expect(controlsTag?.[1]).toContain("min-w-0");
    for (const widthClass of ["w-[52px]", "w-[64px]", "w-[76px]"]) {
      const at = source.indexOf(widthClass, controlsAt);
      expect(at).toBeGreaterThan(controlsAt);
    }
    // Total amount block floats/wraps right on narrow screens with ml-auto
    const totalBlockAt = source.indexOf('ml-auto flex w-[76px]', controlsAt);
    expect(totalBlockAt).toBeGreaterThan(controlsAt);
  });

  it("does not resurrect the old single-row packed line", () => {
    expect(source).not.toContain(
      'className="flex items-center gap-2 rounded-xl border border-black/[0.06] bg-white px-3 py-2"',
    );
  });

  it("constrains both stock lists and root containers to shrinkable columns", () => {
    // A plain `grid` sizes its implicit column to the widest row's
    // max-content: one long untruncated-looking title stretched the
    // whole card to 659px on a 390px phone (measured on the live
    // page). The minmax(0, 1fr) column is what lets rows truncate.
    const lists = source.match(/<ul className="[^"]*grid[^"]*"/g) ?? [];
    expect(lists.length).toBeGreaterThanOrEqual(2);
    for (const list of lists) {
      expect(list).toContain("grid-cols-[minmax(0,1fr)]");
      expect(list).toContain("min-w-0");
    }
    // Root section and cards must also be min-w-0 grid-cols-[minmax(0,1fr)]
    expect(source).toContain(
      '<section aria-label="发货打包" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">',
    );
    expect(source).toContain('ios-surface min-w-0 rounded-[28px]');
  });
});
