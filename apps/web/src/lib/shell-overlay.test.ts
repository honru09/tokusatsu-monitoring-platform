// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { getShellOverlayRoot, SHELL_OVERLAY_ROOT_ID } from "./shell-overlay";

describe("getShellOverlayRoot", () => {
  afterEach(() => {
    document.getElementById(SHELL_OVERLAY_ROOT_ID)?.remove();
  });

  it("returns the shell overlay root when present", () => {
    const shell = document.createElement("main");
    shell.className = "ios-shell";
    const overlay = document.createElement("div");
    overlay.id = SHELL_OVERLAY_ROOT_ID;
    shell.append(overlay);
    document.body.append(shell);

    expect(getShellOverlayRoot()).toBe(overlay);
    shell.remove();
  });

  it("falls back to document.body when the shell root is missing", () => {
    expect(getShellOverlayRoot()).toBe(document.body);
  });
});
