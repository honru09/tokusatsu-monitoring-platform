// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageGallery } from "./image-gallery";

describe("ImageGallery", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("keeps gallery pointer and click events from opening the parent card", () => {
    const parentClick = vi.fn();
    const parentPointerDown = vi.fn();

    act(() => {
      root.render(
        <div onClick={parentClick} onPointerDown={parentPointerDown}>
          <ImageGallery
            images={[
              { url: "https://example.com/1.jpg", position: 0 },
              { url: "https://example.com/2.jpg", position: 1 },
            ]}
            alt="测试商品"
          />
        </div>,
      );
    });

    const next = host.querySelector<HTMLButtonElement>(
      '[data-gallery-control="next"]',
    );
    expect(next).not.toBeNull();
    expect(next?.className).toContain("h-12");
    expect(next?.className).toContain("w-12");
    expect(next?.dataset.cardInteractive).toBe("gallery");

    act(() => {
      next?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      next?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(parentPointerDown).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
    expect(host.textContent).toContain("2/2");
  });
});
