import { describe, expect, it } from "vitest";
import {
  applyWorkspaceSearchParam,
  goBackWorkspaceState,
  initialWorkspaceNavigationState,
  navigateWorkspaceState,
  parseWorkspaceHistoryState,
  parseRecentWorkspaceEntries,
  recordRecentWorkspace,
  parseWorkspaceParam,
  withWorkspaceHistoryState,
  workspaceSearchParam,
} from "./workspace-navigation.js";

describe("recent workspace navigation", () => {
  it("keeps the three most recent distinct pages with their exact scroll positions", () => {
    const recent = [
      {
        workspace: "catalog" as const,
        trail: ["inventory" as const],
        scrollY: 840,
        visitedAt: 1,
      },
      {
        workspace: "inventory" as const,
        trail: [],
        scrollY: 120,
        visitedAt: 2,
      },
      {
        workspace: "workbench" as const,
        trail: [],
        scrollY: 40,
        visitedAt: 3,
      },
    ];

    const updated = recordRecentWorkspace(recent, {
      workspace: "catalog",
      trail: ["inventory"],
      scrollY: 1260,
      visitedAt: 4,
    });

    expect(updated).toEqual([
      {
        workspace: "catalog",
        trail: ["inventory"],
        scrollY: 1260,
        visitedAt: 4,
      },
      {
        workspace: "inventory",
        trail: [],
        scrollY: 120,
        visitedAt: 2,
      },
      {
        workspace: "workbench",
        trail: [],
        scrollY: 40,
        visitedAt: 3,
      },
    ]);
  });

  it("rejects malformed session history and sanitizes valid entries", () => {
    expect(parseRecentWorkspaceEntries("not-json")).toEqual([]);
    expect(
      parseRecentWorkspaceEntries(
        JSON.stringify([
          {
            workspace: "catalog",
            trail: ["inventory"],
            scrollY: 325,
            visitedAt: 12,
          },
          {
            workspace: "unknown",
            trail: [],
            scrollY: 0,
            visitedAt: 13,
          },
        ]),
      ),
    ).toEqual([
      {
        workspace: "catalog",
        trail: ["inventory"],
        scrollY: 325,
        visitedAt: 12,
      },
    ]);
  });
});

describe("workspace navigation stack", () => {
  it("does not create back history when switching between primary pages", () => {
    const state = navigateWorkspaceState(
      { workspace: "inventory", trail: [] },
      "catalog",
    );
    expect(state).toEqual({ workspace: "catalog", trail: [] });
  });

  it("treats the assistant as a nested page now that it left the primary slots", () => {
    const state = navigateWorkspaceState(
      { workspace: "inventory", trail: [] },
      "assistant",
    );
    expect(state).toEqual({ workspace: "assistant", trail: ["inventory"] });
    expect(initialWorkspaceNavigationState("assistant").trail).toEqual([
      "workbench",
    ]);
  });

  it("treats collaboration as a primary destination and profile as a nested page", () => {
    const state = navigateWorkspaceState(
      { workspace: "favorites", trail: ["workbench"] },
      "collaboration",
    );
    expect(state).toEqual({ workspace: "collaboration", trail: [] });
    expect(
      navigateWorkspaceState({ workspace: "inventory", trail: [] }, "profile"),
    ).toEqual({ workspace: "profile", trail: ["inventory"] });
  });

  it("returns secondary and tertiary pages one level at a time", () => {
    const secondary = navigateWorkspaceState(
      { workspace: "workbench", trail: [] },
      "links",
    );
    const tertiary = navigateWorkspaceState(secondary, "logistics");

    expect(goBackWorkspaceState(tertiary)).toEqual(secondary);
    expect(goBackWorkspaceState(secondary)).toEqual({
      workspace: "workbench",
      trail: [],
    });
  });
});

describe("workspace URL deep-link", () => {
  it("gives secondary deep-links a parent while primary destinations have no back button", () => {
    expect(initialWorkspaceNavigationState("favorites")).toEqual({
      workspace: "favorites",
      trail: ["workbench"],
    });
    expect(
      goBackWorkspaceState(initialWorkspaceNavigationState("favorites")),
    ).toEqual({ workspace: "workbench", trail: [] });
    expect(initialWorkspaceNavigationState("collaboration").trail).toEqual([]);
    expect(initialWorkspaceNavigationState("profile").trail).toEqual([
      "workbench",
    ]);
    expect(initialWorkspaceNavigationState("catalog")).toEqual({
      workspace: "catalog",
      trail: [],
    });
  });
  it("accepts known workspace query values and rejects junk", () => {
    expect(parseWorkspaceParam("inventory")).toBe("inventory");
    expect(parseWorkspaceParam("catalog")).toBe("catalog");
    expect(parseWorkspaceParam("orders")).toBe("orders");
    expect(parseWorkspaceParam("not-a-workspace")).toBeNull();
    expect(parseWorkspaceParam(null)).toBeNull();
  });

  it("treats inventory orders as a workbench child", () => {
    expect(initialWorkspaceNavigationState("orders")).toEqual({
      workspace: "orders",
      trail: ["workbench"],
    });
  });

  it("omits inventory from the query so the default home stays clean", () => {
    expect(workspaceSearchParam("inventory")).toBeNull();
    expect(workspaceSearchParam("assistant")).toBe("assistant");
    expect(workspaceSearchParam("catalog")).toBe("catalog");

    const withAssistant = applyWorkspaceSearchParam(
      new URL("http://127.0.0.1:3002/"),
      "assistant",
    );
    expect(withAssistant.searchParams.get("workspace")).toBe("assistant");

    const cleared = applyWorkspaceSearchParam(withAssistant, "inventory");
    expect(cleared.searchParams.has("workspace")).toBe(false);
  });

  it("round-trips nested navigation through browser history without discarding framework state", () => {
    const entry = {
      workspace: "logistics" as const,
      trail: ["workbench", "favorites"] as const,
      depth: 2,
      scrollY: 318,
    };
    const state = withWorkspaceHistoryState(
      { __NA: true },
      {
        ...entry,
        trail: [...entry.trail],
      },
    );

    expect(state.__NA).toBe(true);
    expect(parseWorkspaceHistoryState(state)).toEqual(entry);
  });

  it("rejects malformed browser history state", () => {
    expect(parseWorkspaceHistoryState(null)).toBeNull();
    expect(
      parseWorkspaceHistoryState({
        __tokusatsuWorkspaceNavigation: {
          workspace: "not-a-workspace",
          trail: [],
          depth: -1,
          scrollY: Number.NaN,
        },
      }),
    ).toBeNull();
  });
});
