// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagerProfileWorkspace } from "./manager-profile-workspace";

describe("ManagerProfileWorkspace", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    vi.unstubAllGlobals();
  });

  it("shows only the logged-in account, with logout instead of switching", () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const onLogout = vi.fn();
    act(() => {
      root.render(
        <ManagerProfileWorkspace
          accounts={[
            { id: "one", key: "one", displayName: "龙", avatarInitial: "龙", position: 1, active: true, online: true, stats: { shares: 4, favorites: 5, dislikes: 6 } },
            { id: "two", key: "two", displayName: "润", avatarInitial: "润", position: 2, active: true, online: false, stats: { shares: 7, favorites: 8, dislikes: 9 } },
          ]}
          activeManagerId="one"
          onLogout={onLogout}
          onOpenChat={vi.fn()}
        />,
      );
    });

    expect(host.querySelectorAll(".manager-profile-card")).toHaveLength(1);
    const card = host.querySelector(".manager-profile-card");
    expect(card?.textContent).toContain("龙");
    expect(card?.textContent).toContain("当前账号");
    expect(card?.textContent).not.toContain("润");
    // No identity switcher remains: no tabs, no switch button.
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(host.textContent).not.toContain("切换账号");
    const logout = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "退出登录",
    );
    expect(logout).toBeTruthy();
    act(() => logout!.click());
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
