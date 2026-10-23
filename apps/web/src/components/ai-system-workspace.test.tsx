// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSystemWorkspace } from "./ai-system-workspace";

describe("AI task entry points", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    vi.unstubAllGlobals();
  });

  it("opens existing product and chat workspaces without making model requests", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => ({ ok: true, json: async () => ({ configured: true, available: true, model: "glm-5.3-flash", tokenLimit: 14000000, dailyTokenLimit: 200000, accountedTokens: 5090, todayTokens: 5090, remainingLocalBudget: 13994910, expiresAt: "2026-11-09T06:35:56.000Z", allowedUses: ["product_reading", "translation", "chat"], note: "本地统计并非账号实时余额。" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const products = vi.fn();
    const chat = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<AiSystemWorkspace apiBaseUrl="http://test.invalid" onOpenProducts={products} onOpenChat={chat} />));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://test.invalid/ai/resources");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="到商品库，从详情读取商品"]')?.click());
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="到商品库，从详情翻译商品"]')?.click());
    act(() => Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("打开 AI 聊天"))?.click());
    expect(products).toHaveBeenCalledTimes(2);
    expect(chat).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="meter"]')?.getAttribute("aria-valuenow")).toBe("5090");
  });
});
