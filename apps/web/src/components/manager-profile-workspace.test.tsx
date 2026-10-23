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

  it("shows one selected manager rather than parallel profile cards", () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <ManagerProfileWorkspace
          accounts={[
            { id: "one", key: "one", displayName: "龙", avatarInitial: "龙", position: 1, active: true, online: true, stats: { shares: 4, favorites: 5, dislikes: 6 } },
            { id: "two", key: "two", displayName: "润", avatarInitial: "润", position: 2, active: true, online: false, stats: { shares: 7, favorites: 8, dislikes: 9 } },
          ]}
          activeManagerId="one"
          onSwitchIdentity={vi.fn()}
          onOpenChat={vi.fn()}
        />,
      );
    });

    expect(host.querySelectorAll(".manager-profile-card")).toHaveLength(1);
    expect(host.querySelector(".manager-profile-card")?.textContent).toContain("龙");
    const second = host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1];
    act(() => second.click());
    expect(host.querySelector(".manager-profile-card")?.textContent).toContain("润");
    expect(host.querySelector(".manager-profile-card")?.textContent).not.toContain("当前账号");
  });
});
