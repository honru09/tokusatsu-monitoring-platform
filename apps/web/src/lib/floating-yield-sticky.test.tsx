// @vitest-environment jsdom

import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimFloatingYield,
  releaseFloatingYield,
  useStickyHeaderYield,
} from "./floating-yield";

function rectStub(top: number, bottom: number): DOMRect {
  return {
    x: 0,
    y: top,
    width: 100,
    height: bottom - top,
    top,
    bottom,
    left: 0,
    right: 100,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("useStickyHeaderYield", () => {
  let host: HTMLDivElement;
  let root: Root;
  // jsdom has no layout, so the harness reads its rects from this
  // mutable geometry: the sentinel scrolls with the page while the
  // header top stays pinned once the header sticks. Layout offsets
  // are all zero in jsdom, which makes the natural gap zero.
  const geometry = { sentinelBottom: 112, headerTop: 112 };

  function StickyHeaderHarness() {
    const sentinelRef = useRef<HTMLSpanElement>(null);
    const headerRef = useRef<HTMLElement>(null);
    useStickyHeaderYield(sentinelRef, headerRef);
    return (
      <>
        <span
          ref={(element) => {
            sentinelRef.current = element;
            if (element) {
              element.getBoundingClientRect = () =>
                rectStub(geometry.sentinelBottom, geometry.sentinelBottom);
            }
          }}
        />
        <section
          ref={(element) => {
            headerRef.current = element;
            if (element) {
              element.getBoundingClientRect = () =>
                rectStub(geometry.headerTop, geometry.headerTop + 40);
            }
          }}
        >
          直购 · 1,261 件
        </section>
      </>
    );
  }

  function renderHarness() {
    act(() => {
      root.render(<StickyHeaderHarness />);
    });
  }

  let rafCallback: FrameRequestCallback | null = null;

  function scroll() {
    act(() => {
      document.dispatchEvent(new Event("scroll"));
      const callback = rafCallback;
      rafCallback = null;
      callback?.(0);
    });
  }

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    // Queue rAF callbacks so the scroll helper can flush the one the
    // hook schedules, settling the claim within the same act().
    rafCallback = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      rafCallback = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    geometry.sentinelBottom = 112;
    geometry.headerTop = 112;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    releaseFloatingYield("catalog-sticky-header");
    releaseFloatingYield("shell-sheet");
    delete document.documentElement.dataset.floatingYield;
    vi.unstubAllGlobals();
  });

  it("leaves the floats alone while the header is in flow", () => {
    renderHarness();
    expect(document.documentElement.dataset.floatingYield).toBeUndefined();
    scroll();
    expect(document.documentElement.dataset.floatingYield).toBeUndefined();
  });

  it("claims the yield once the header is stuck", () => {
    geometry.sentinelBottom = 40;
    renderHarness();
    expect(document.documentElement.dataset.floatingYield).toBe("true");
  });

  it("follows the header as it sticks and unsticks on scroll", () => {
    renderHarness();
    geometry.sentinelBottom = 40;
    scroll();
    expect(document.documentElement.dataset.floatingYield).toBe("true");
    geometry.sentinelBottom = 112;
    scroll();
    expect(document.documentElement.dataset.floatingYield).toBeUndefined();
  });

  it("releases the claim when the header unmounts", () => {
    geometry.sentinelBottom = 40;
    renderHarness();
    expect(document.documentElement.dataset.floatingYield).toBe("true");
    act(() => root.unmount());
    expect(document.documentElement.dataset.floatingYield).toBeUndefined();
    // Remount a fresh root for the shared afterEach teardown.
    root = createRoot(host);
  });

  it("shares the signal with the sheet claim without clearing it early", () => {
    claimFloatingYield("shell-sheet");
    geometry.sentinelBottom = 40;
    renderHarness();
    geometry.sentinelBottom = 112;
    scroll();
    // The sticky claim released on unstick, the sheet claim still holds.
    expect(document.documentElement.dataset.floatingYield).toBe("true");
    releaseFloatingYield("shell-sheet");
    expect(document.documentElement.dataset.floatingYield).toBeUndefined();
  });
});
