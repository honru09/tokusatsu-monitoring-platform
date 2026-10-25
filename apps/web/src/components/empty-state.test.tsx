// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmptyState } from "./empty-state";

describe("EmptyState artwork", () => {
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

  function render(art: React.ComponentProps<typeof EmptyState>["art"]) {
    act(() => {
      root.render(<EmptyState art={art} title="空的" />);
    });
  }

  it.each([
    ["check", "/illustrations/empty-todo.webp"],
    ["search", "/illustrations/empty-catalog.webp"],
    ["chat", "/illustrations/empty-shares.webp"],
    ["receipt", "/illustrations/empty-purchases.webp"],
    ["box", "/illustrations/empty-inventory.webp"],
    ["shipping", "/illustrations/empty-shipping.webp"],
    ["favorites", "/illustrations/empty-favorites.webp"],
  ] as const)("renders the %s artwork in a fixed square slot", (art, src) => {
    render(art);
    const image = host.querySelector("img");
    expect(image?.getAttribute("src")).toBe(src);
    expect(image?.getAttribute("loading")).toBe("lazy");
    expect(image?.closest("span")?.className).toContain("aspect-square");
  });

  it("keeps the line glyph for art keys without an illustration", () => {
    render("chart");
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector(".empty-state-glyph")).not.toBeNull();
  });
});
