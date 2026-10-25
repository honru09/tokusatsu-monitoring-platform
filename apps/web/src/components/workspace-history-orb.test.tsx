// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentWorkspaceEntry } from "../lib/workspace-navigation";
import { WorkspaceHistoryOrb } from "./workspace-history-orb";

const entries: RecentWorkspaceEntry[] = [
  {
    workspace: "catalog",
    trail: ["inventory"],
    scrollY: 820,
    visitedAt: 3,
  },
  {
    workspace: "collaboration",
    trail: [],
    scrollY: 240,
    visitedAt: 2,
  },
  {
    workspace: "favorites",
    trail: ["workbench"],
    scrollY: 120,
    visitedAt: 1,
  },
];

function pointerEvent(
  type: string,
  values: {
    pointerId?: number;
    clientX: number;
    clientY: number;
  },
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: values.pointerId ?? 1 },
    pointerType: { value: "touch" },
    isPrimary: { value: true },
    button: { value: 0 },
    clientX: { value: values.clientX },
    clientY: { value: values.clientY },
  });
  return event;
}

describe("WorkspaceHistoryOrb", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    vi.useFakeTimers();
    window.localStorage.clear();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function renderOrb(onSelect = vi.fn()) {
    act(() => {
      root.render(
        <WorkspaceHistoryOrb
          entries={entries}
          currentWorkspace="inventory"
          onSelect={onSelect}
        />,
      );
    });
    return {
      onSelect,
      orb: host.querySelector(".workspace-history-orb") as HTMLElement,
      trigger: host.querySelector(
        ".workspace-history-trigger",
      ) as HTMLButtonElement,
    };
  }

  it("opens on an ordinary tap and selects one of the three recent pages", () => {
    const { trigger, onSelect } = renderOrb();

    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const catalog = Array.from(
      host.querySelectorAll<HTMLButtonElement>("[data-history-entry]"),
    ).find((button) => button.textContent?.includes("选货"));
    expect(catalog).toBeTruthy();

    act(() => catalog?.click());
    expect(onSelect).toHaveBeenCalledWith(entries[0]);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("starts above the bottom dock and retains the three saved destinations", () => {
    const { orb } = renderOrb();
    expect(orb.style.transform).toBe("translate3d(12px, 630px, 0)");
    expect(orb.dataset.railDirection).toBe("up");
    expect(host.querySelectorAll("[data-history-entry]")).toHaveLength(3);
    expect(host.querySelector('[role="menu"]')?.hasAttribute("inert")).toBe(
      true,
    );
  });

  it("supports keyboard opening, menu traversal, Escape and focus restoration without scrolling", () => {
    const { trigger } = renderOrb();
    trigger.focus();
    act(() =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    const controls = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    expect(document.activeElement).toBe(controls[0]);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    act(() =>
      controls[0].dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(controls[1]);
    act(() =>
      controls[1].dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "End",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(controls.at(-1));
    act(() =>
      controls
        .at(-1)
        ?.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Home",
            bubbles: true,
            cancelable: true,
          }),
        ),
    );
    expect(document.activeElement).toBe(controls[0]);
    const focus = vi.spyOn(trigger, "focus");
    act(() =>
      controls[0].dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("opens at the last option with ArrowUp and dismisses on focus leaving", () => {
    const { trigger } = renderOrb();
    act(() =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    const controls = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    expect(document.activeElement).toBe(controls.at(-1));
    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => outside.focus());
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("offers edge repositioning without requiring a drag gesture", () => {
    const { trigger, orb } = renderOrb();
    act(() => trigger.click());
    const move = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((button) => button.textContent?.includes("移到右侧"));
    expect(move).toBeTruthy();
    act(() => move?.click());
    expect(orb.dataset.edge).toBe("right");
    expect(orb.style.transform).toBe("translate3d(334px, 630px, 0)");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(
      JSON.parse(
        window.localStorage.getItem("kamen-workspace-history-orb-v1") ?? "null",
      ),
    ).toEqual({ edge: "right", top: 630 });
  });

  it("dismisses for outside taps without stealing focus", () => {
    const { trigger } = renderOrb();
    act(() => trigger.click());
    const outside = document.createElement("button");
    document.body.append(outside);
    act(() =>
      outside.dispatchEvent(
        pointerEvent("pointerdown", { clientX: 200, clientY: 200 }),
      ),
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    outside.remove();
  });

  it("uses the available viewport height when choosing the popover direction", () => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 400,
    });
    window.localStorage.setItem(
      "kamen-workspace-history-orb-v1",
      JSON.stringify({ edge: "left", top: 76 }),
    );
    const { orb } = renderOrb();
    expect(orb.dataset.railDirection).toBe("down");
    const menu = host.querySelector<HTMLElement>('[role="menu"]');
    expect(Number.parseFloat(menu?.style.maxHeight ?? "0")).toBeLessThanOrEqual(
      180,
    );
  });

  it("long-presses into drag, clamps above navigation, snaps to an edge and persists without opening", () => {
    const { orb, trigger } = renderOrb();
    Object.defineProperty(trigger, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 320,
        y: 180,
        left: 320,
        top: 180,
        right: 376,
        bottom: 236,
        width: 56,
        height: 56,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(trigger, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(trigger, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    act(() => {
      trigger.dispatchEvent(
        pointerEvent("pointerdown", { clientX: 348, clientY: 208 }),
      );
      vi.advanceTimersByTime(321);
    });
    expect(orb.classList.contains("is-dragging")).toBe(true);

    act(() => {
      trigger.dispatchEvent(
        pointerEvent("pointermove", { clientX: 20, clientY: 900 }),
      );
      vi.advanceTimersByTime(16);
      trigger.dispatchEvent(
        pointerEvent("pointerup", { clientX: 20, clientY: 900 }),
      );
      trigger.click();
    });

    expect(orb.dataset.edge).toBe("left");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(
      JSON.parse(
        window.localStorage.getItem("kamen-workspace-history-orb-v1") ?? "null",
      ),
    ).toEqual({
      edge: "left",
      top: 630,
    });
  });

  it("restores the saved edge and safe vertical position", () => {
    window.localStorage.setItem(
      "kamen-workspace-history-orb-v1",
      JSON.stringify({ edge: "right", top: 9_999 }),
    );
    const { orb } = renderOrb();

    act(() => vi.runOnlyPendingTimers());
    expect(orb.dataset.edge).toBe("right");
    expect(orb.style.transform).toBe("translate3d(334px, 630px, 0)");
  });
  it("starts dragging on movement without cancelling the gesture before the hold timeout", () => {
    const { orb, trigger } = renderOrb();
    act(() => {
      trigger.dispatchEvent(
        pointerEvent("pointerdown", { clientX: 30, clientY: 300 }),
      );
      trigger.dispatchEvent(
        pointerEvent("pointermove", { clientX: 190, clientY: 420 }),
      );
    });
    expect(orb.classList.contains("is-dragging")).toBe(true);
    act(() => {
      trigger.dispatchEvent(
        pointerEvent("pointerup", { clientX: 190, clientY: 420 }),
      );
      trigger.click();
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(
      window.localStorage.getItem("kamen-workspace-history-orb-v1"),
    ).not.toBeNull();
  });
});
