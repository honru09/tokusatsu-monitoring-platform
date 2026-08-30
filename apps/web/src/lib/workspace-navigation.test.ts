import { describe, expect, it } from "vitest";
import {
  goBackWorkspaceState,
  navigateWorkspaceState,
} from "./workspace-navigation.js";

describe("workspace navigation stack", () => {
  it("does not create back history when switching between primary pages", () => {
    const state = navigateWorkspaceState(
      { workspace: "inventory", trail: [] },
      "discovery",
    );
    expect(state).toEqual({ workspace: "discovery", trail: [] });
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
