import { describe, it, expect } from "vitest";
import { mobileViewportMetrics } from "./mobile-viewport";
const base = {
  layoutHeight: 844,
  baselineHeight: 844,
  visualHeight: 844,
  visualTop: 0,
  editing: false,
  scale: 1,
};
describe("mobile visual viewport", () => {
  it("does not treat browser chrome changes as a keyboard", () => {
    expect(
      mobileViewportMetrics({ ...base, visualHeight: 760 }).keyboardOpen,
    ).toBe(false);
    expect(
      mobileViewportMetrics({ ...base, editing: true, visualHeight: 760 })
        .keyboardOpen,
    ).toBe(false);
  });
  it("tracks both overlay and resize keyboard modes", () => {
    expect(
      mobileViewportMetrics({
        ...base,
        editing: true,
        visualHeight: 480,
        visualTop: 24,
      }),
    ).toEqual({ keyboardOpen: true, height: 480, top: 24 });
    expect(
      mobileViewportMetrics({
        ...base,
        editing: true,
        layoutHeight: 480,
        visualHeight: 480,
      }).keyboardOpen,
    ).toBe(true);
  });
  it("preserves pinch zoom instead of treating it as keyboard", () => {
    expect(
      mobileViewportMetrics({
        ...base,
        editing: true,
        visualHeight: 422,
        scale: 2,
      }),
    ).toEqual({ keyboardOpen: false, height: 844, top: 0 });
  });
});
