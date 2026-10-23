// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrimaryNavigation } from "./primary-navigation";
import styles from "./primary-navigation.module.css";

describe("PrimaryNavigation", () => {
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

  it("keeps all four destinations and precisely one selected page", () => {
    const navigate = vi.fn();
    act(() =>
      root.render(
        <PrimaryNavigation
          activeWorkspace="inventory"
          unreadCount={0}
          onNavigate={navigate}
        />,
      ),
    );
    expect(
      Array.from(host.querySelectorAll("button")).map(
        (button) => button.textContent,
      ),
    ).toEqual(["首页", "AI", "消息", "工作台"]);
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="工作台"]')!.click(),
    );
    expect(navigate).toHaveBeenCalledWith("workbench");
  });

  it("moves the same selection element without remounting the focused button", () => {
    const render = (activeWorkspace: "inventory" | "collaboration") =>
      root.render(
        <PrimaryNavigation
          activeWorkspace={activeWorkspace}
          unreadCount={3}
          onNavigate={() => undefined}
        />,
      );
    act(() => render("inventory"));
    const message =
      host.querySelector<HTMLButtonElement>('[aria-label="消息"]')!;
    const slider = host.querySelector<HTMLElement>(`.${styles.selection}`)!;
    message.focus();
    act(() => render("collaboration"));
    expect(document.activeElement).toBe(message);
    expect(host.querySelector(`.${styles.selection}`)).toBe(slider);
    expect(slider.style.transform).toBe("translateX(200%)");
    expect(message.getAttribute("aria-current")).toBe("page");
  });

  it("uses readable unread badges and no badge for zero unread", () => {
    const render = (unreadCount: number) =>
      root.render(
        <PrimaryNavigation
          activeWorkspace="inventory"
          unreadCount={unreadCount}
          onNavigate={() => undefined}
        />,
      );
    act(() => render(105));
    expect(
      host.querySelector('[aria-label="105 条未读消息"]')?.textContent,
    ).toBe("99+");
    act(() => render(0));
    expect(host.querySelector(".message-unread-badge")).toBeNull();
  });

  it("only opts into selection motion after pointer input, not keyboard input", () => {
    act(() =>
      root.render(
        <PrimaryNavigation
          activeWorkspace="inventory"
          unreadCount={0}
          onNavigate={() => undefined}
        />,
      ),
    );
    const nav = host.querySelector("nav")!;
    expect(nav.dataset.pointerMotion).toBe("false");
    act(() => nav.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(nav.dataset.pointerMotion).toBe("true");
    act(() =>
      nav.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      ),
    );
    expect(nav.dataset.pointerMotion).toBe("false");
  });
});
