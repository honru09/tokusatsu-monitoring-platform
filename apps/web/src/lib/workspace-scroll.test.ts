import { describe, expect, it, vi } from "vitest";
import {
  readWorkspaceScrollTop,
  restoreWorkspaceScroll,
} from "./workspace-scroll.js";

function elementFixture({
  scrollTop,
  scrollHeight,
  clientHeight,
}: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}) {
  return {
    scrollTop,
    scrollHeight,
    clientHeight,
    scrollTo: vi.fn(),
  } as unknown as HTMLElement;
}

describe("workspace scroll source", () => {
  it("reads and restores window scroll on the mobile layout", () => {
    const content = elementFixture({
      scrollTop: 0,
      scrollHeight: 2400,
      clientHeight: 2400,
    });
    const scrollWindow = vi.fn();

    expect(readWorkspaceScrollTop(content, 1476, () => "visible")).toBe(1476);

    restoreWorkspaceScroll(1476, content, {
      getOverflowY: () => "visible",
      requestFrame: (callback) => callback(),
      scrollWindow,
    });

    expect(scrollWindow).toHaveBeenCalledWith({ top: 1476, behavior: "auto" });
    expect(content.scrollTo).not.toHaveBeenCalled();
  });

  it("reads and restores the desktop content scroller", () => {
    const content = elementFixture({
      scrollTop: 930,
      scrollHeight: 3200,
      clientHeight: 720,
    });
    const scrollWindow = vi.fn();

    expect(readWorkspaceScrollTop(content, 120, () => "auto")).toBe(930);

    restoreWorkspaceScroll(930, content, {
      getOverflowY: () => "auto",
      requestFrame: (callback) => callback(),
      scrollWindow,
    });

    expect(content.scrollTo).toHaveBeenCalledWith({
      top: 930,
      behavior: "auto",
    });
    expect(scrollWindow).not.toHaveBeenCalled();
  });
});
