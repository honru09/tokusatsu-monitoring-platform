// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { claimFloatingYield, releaseFloatingYield } from "./floating-yield";

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
