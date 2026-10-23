/** Portal target id — last child of `.ios-shell`, not under filtered/transformed chrome. */
export const SHELL_OVERLAY_ROOT_ID = "shell-overlay-root";

/**
 * Resolve the app-shell overlay root for modals/sheets.
 * Falls back to `document.body` in tests or if the shell has not mounted yet.
 */
export function getShellOverlayRoot(): HTMLElement {
  if (typeof document === "undefined") {
    throw new Error("getShellOverlayRoot requires a document");
  }
  return document.getElementById(SHELL_OVERLAY_ROOT_ID) ?? document.body;
}
