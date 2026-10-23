// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantChatWorkspace } from "./assistant-chat-workspace";

describe("assistant conversation reading", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("keeps old-message reading position when a reply arrives and prevents duplicate requests", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    let finish: (value: unknown) => void = () => undefined;
    const fetchMock = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<AssistantChatWorkspace apiBaseUrl="http://test.invalid" onOpenItem={async () => true} />));
    expect(fetchMock).not.toHaveBeenCalled();
    const starter = host.querySelector<HTMLButtonElement>(".assistant-starters button")!;
    act(() => { starter.click(); starter.click(); });
    expect(fetchMock).toHaveBeenCalledOnce();
    const feed = host.querySelector<HTMLDivElement>(".assistant-chat-feed")!;
    Object.defineProperties(feed, { scrollHeight: { configurable: true, value: 1200 }, clientHeight: { configurable: true, value: 300 } });
    feed.scrollTop = 100;
    act(() => feed.dispatchEvent(new Event("scroll", { bubbles: true })));
    await act(async () => finish({ ok: true, text: async () => JSON.stringify({ answerZh: "收到商品问题。", items: [], suggestions: [], model: "glm-5.3-flash", generatedAt: "2026-10-09T01:00:00.000Z" }) }));
    expect(feed.textContent).toContain("收到商品问题。");
    expect(feed.scrollTop).toBe(100);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
