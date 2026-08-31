// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { isCardInteractiveTarget } from "./discovery-workspace";

describe("discovery card tap suppression", () => {
  it("treats image controls and their icon children as card-local interactions", () => {
    const control = document.createElement("button");
    const icon = document.createElement("span");
    control.dataset.cardInteractive = "gallery";
    control.append(icon);

    expect(isCardInteractiveTarget(control)).toBe(true);
    expect(isCardInteractiveTarget(icon)).toBe(true);
    expect(isCardInteractiveTarget(document.createElement("div"))).toBe(false);
  });
});
