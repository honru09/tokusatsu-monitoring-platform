import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export function createBrowserControl(authDir, browsers) {
  return async (platform, action, payload = {}) => {
    const browser = browsers[platform];
    if (!browser || !["restore", "park", "home", "login-scan", "login-fill", "login-submit", "page-scan", "page-fill", "page-import", "page-location", "page-choice", "media-scan", "media-attach", "page-view"].includes(action)) throw new Error("Unknown browser action");
    const token = (await readFile(resolve(authDir, "browser-control.token"), "utf8")).trim();
    if (token.length < 32) throw new Error("Browser control not configured");
    const response = await fetch(`http://${browser.host}:${browser.controlPort ?? 5901}/${action}`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw Object.assign(new Error("Browser unavailable"), { status: 409 });
    return response.json();
  };
}
