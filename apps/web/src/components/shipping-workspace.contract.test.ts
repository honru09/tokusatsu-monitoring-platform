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
    expect(lineTag?.[1]).not.toContain("flex");
  });

  it("keeps the fixed-width inputs inside the controls row", () => {
    const controlsAt = source.indexOf('data-testid="packed-line-controls"');
    expect(controlsAt).toBeGreaterThan(-1);
    for (const widthClass of ["w-[52px]", "w-[64px]", "w-[76px]"]) {
      const at = source.indexOf(widthClass, controlsAt);
      expect(at).toBeGreaterThan(controlsAt);
    }
  });

  it("does not resurrect the old single-row packed line", () => {
    expect(source).not.toContain(
      'className="flex items-center gap-2 rounded-xl border border-black/[0.06] bg-white px-3 py-2"',
    );
  });
});
