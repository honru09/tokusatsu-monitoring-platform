// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  claimFloatingYield,
  isStickyHeaderStuck,
  releaseFloatingYield,
} from "./floating-yield";

describe("floating yield claims", () => {
  afterEach(() => {
    releaseFloatingYield("selection");
    releaseFloatingYield("sheet");
    delete document.documentElement.dataset.floatingYield;
  });

  it("sets the shell signal while any owner claims it", () => {
    claimFloatingYield("selection");
    expect(document.documentElement.dataset.floatingYield).toBe("true");
    releaseFloatingYield("selection");
    expect(document.documentElement.dataset.floatingYield).toBeUndefined();
  });

  it("keeps the signal until the last owner releases", () => {
    claimFloatingYield("selection");
    claimFloatingYield("sheet");
    releaseFloatingYield("selection");
    expect(document.documentElement.dataset.floatingYield).toBe("true");
    releaseFloatingYield("sheet");
    expect(document.documentElement.dataset.floatingYield).toBeUndefined();
  });

  it("treats a repeated claim by one owner as a single claim", () => {
    claimFloatingYield("selection");
    claimFloatingYield("selection");
    releaseFloatingYield("selection");
    expect(document.documentElement.dataset.floatingYield).toBeUndefined();
  });
});

describe("isStickyHeaderStuck", () => {
  it("is false while the header sits at its in-flow gap from the sentinel", () => {
    // Sentinel bottom 100, header top 112: exactly the 12px in-flow
    // margin the header carries, so nothing has stuck yet.
    expect(isStickyHeaderStuck(100, 112, 12)).toBe(false);
  });

  it("is true once the sentinel has scrolled past the stuck header", () => {
    expect(isStickyHeaderStuck(40, 112, 12)).toBe(true);
    expect(isStickyHeaderStuck(-320, 112, 12)).toBe(true);
  });

  it("tolerates a pixel of sub-pixel rounding at the stick point", () => {
    expect(isStickyHeaderStuck(99, 112, 12)).toBe(false);
    expect(isStickyHeaderStuck(98, 112, 12)).toBe(true);
  });
});
