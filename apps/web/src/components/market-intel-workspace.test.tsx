// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketIntelWorkspace } from "./market-intel-workspace";

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("MarketIntelWorkspace delayed refresh", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let mounted: boolean;
  let fetchMock: ReturnType<typeof vi.fn>;
  let hiddenSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    hiddenSpy = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(Response.json({}));
      return Promise.resolve(
        Response.json({ items: [], total: 0, pageCount: 1 }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    mounted = true;
  });

  afterEach(() => {
    if (mounted) act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const renderWorkspace = async () => {
    act(() => root.render(<MarketIntelWorkspace apiBaseUrl="/backend" />));
    await act(async () => {
      await flushPromises();
      await vi.advanceTimersByTimeAsync(300);
    });
  };

  const refreshButton = () =>
    Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "立即更新",
    ) as HTMLButtonElement;

  const getRequestCount = () =>
    fetchMock.mock.calls.filter(([, init]) => init?.method !== "POST").length;

  const postRequestCount = () =>
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length;

  it("reloads the mounted visible workspace hourly using GET only", async () => {
    await renderWorkspace();
    const initialGets = getRequestCount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      await flushPromises();
    });

    expect(getRequestCount()).toBe(initialGets + 1);
    expect(postRequestCount()).toBe(0);
  });

  it("pauses hourly reloads while hidden and catches up after becoming visible", async () => {
    await renderWorkspace();
    const initialGets = getRequestCount();

    hiddenSpy.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      await flushPromises();
    });
    expect(getRequestCount()).toBe(initialGets);

    hiddenSpy.mockReturnValue(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await flushPromises();
    });

    expect(getRequestCount()).toBe(initialGets + 1);
    expect(postRequestCount()).toBe(0);
  });

  it("stops the hourly reload when the workspace unmounts", async () => {
    await renderWorkspace();
    const initialGets = getRequestCount();

    act(() => root.unmount());
    mounted = false;
    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect(getRequestCount()).toBe(initialGets);
    expect(postRequestCount()).toBe(0);
  });

  it("replaces a pending delayed refresh instead of stacking timers", async () => {
    await renderWorkspace();
    const initialGets = getRequestCount();

    await act(async () => {
      refreshButton().click();
      await flushPromises();
    });
    await act(async () => {
      refreshButton().click();
      await flushPromises();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_499);
    });
    expect(getRequestCount()).toBe(initialGets);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await flushPromises();
    });
    expect(getRequestCount()).toBe(initialGets + 1);
  });

  it("clears the delayed refresh when the workspace unmounts", async () => {
    await renderWorkspace();
    const initialGets = getRequestCount();
    await act(async () => {
      refreshButton().click();
      await flushPromises();
    });

    act(() => root.unmount());
    mounted = false;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(getRequestCount()).toBe(initialGets);
  });

  it("keeps a valid delayed reload when a replacement refresh fails", async () => {
    await renderWorkspace();
    const initialGets = getRequestCount();
    await act(async () => {
      refreshButton().click();
      await flushPromises();
    });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await act(async () => {
      refreshButton().click();
      await flushPromises();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
      await flushPromises();
    });

    expect(getRequestCount()).toBe(initialGets + 1);
  });

  it("does not schedule a refresh when the request resolves after unmount", async () => {
    await renderWorkspace();
    const initialGets = getRequestCount();
    let resolveRefresh: ((response: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    act(() => refreshButton().click());
    act(() => root.unmount());
    mounted = false;
    resolveRefresh?.(Response.json({}));
    await flushPromises();
    await vi.advanceTimersByTimeAsync(3_000);

    expect(getRequestCount()).toBe(initialGets);
  });
});
