// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SafeItemImage } from "./item-image";

describe("SafeItemImage placeholder", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("shows the placeholder artwork when there is no photo", () => {
    act(() => {
      root.render(<SafeItemImage src={null} alt="商品" />);
    });
    const placeholder = host.querySelector(".safe-item-image-placeholder");
    expect(placeholder).not.toBeNull();
    expect(placeholder?.querySelector("img")?.getAttribute("src")).toBe(
      "/illustrations/item-placeholder.webp",
    );
  });

  it("renders the photo itself when a source is present", () => {
    act(() => {
      root.render(
        <SafeItemImage src="https://example.test/item.jpg" alt="商品" />,
      );
    });
    const image = host.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://example.test/item.jpg");
    expect(host.querySelector(".safe-item-image-placeholder")).toBeNull();
  });
});
