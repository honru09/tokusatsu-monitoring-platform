// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceHeaderArt } from "./workspace-header-art";

describe("WorkspaceHeaderArt", () => {
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

  it.each([
    ["todo", "/illustrations/header-todo.webp"],
    ["catalog", "/illustrations/header-catalog.webp"],
    ["chat", "/illustrations/header-chat.webp"],
    ["dashboard", "/illustrations/header-dashboard.webp"],
  ] as const)("renders the %s spot in the shared 56px slot", (art, src) => {
    act(() => {
      root.render(<WorkspaceHeaderArt art={art} />);
    });
    const slot = host.querySelector(`[data-workspace-header-art="${art}"]`);
    expect(slot).not.toBeNull();
    expect(slot?.className).toContain("h-14");
    expect(slot?.className).toContain("w-14");
    expect(slot?.getAttribute("aria-hidden")).toBe("true");
    const image = slot?.querySelector("img");
    expect(image?.getAttribute("src")).toBe(src);
    expect(image?.getAttribute("alt")).toBe("");
    expect(image?.getAttribute("loading")).toBe("lazy");
    expect(image?.getAttribute("width")).toBe("480");
    expect(image?.getAttribute("height")).toBe("480");
  });

  it("keeps the slot reserved when the artwork fails to load", () => {
    act(() => {
      root.render(<WorkspaceHeaderArt art="todo" />);
    });
    act(() => {
      host.querySelector("img")?.dispatchEvent(new Event("error"));
    });
    const slot = host.querySelector('[data-workspace-header-art="todo"]');
    expect(slot).not.toBeNull();
    expect(slot?.querySelector("img")).toBeNull();
  });
});
