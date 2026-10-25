// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "./page";

// Poller timing is covered by visibility-poller.test.ts; here the poller
// runs its task once on start and forwards failures like the real one.
vi.mock("../lib/visibility-poller", () => ({
  createVisibilityPoller({
    task,
    onError,
  }: {
    task: (signal: AbortSignal) => Promise<void>;
    onError?: (reason: unknown) => void;
  }) {
    let stopped = true;
    return {
      start(immediate = true) {
        stopped = false;
        if (immediate)
          void task(new AbortController().signal).catch((reason) =>
            onError?.(reason),
          );
      },
      pause() {},
      resume() {},
      runNow: () => task(new AbortController().signal),
      stop() {
        stopped = true;
      },
    };
  },
}));

type TestItem = ReturnType<typeof makeItem>;

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    sourceUrl: "https://example.com/item-1",
    titleRaw: "测试商品",
    titleZh: "测试商品",
    priceCurrent: 1_000,
    priceTotalEst: 1_000,
    detectedAt: "2026-09-01T00:00:00.000Z",
    lastSeenAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    listingType: "direct",
    categoryIp: "kamen-rider",
    categoryToyType: "figure",
    manufacturer: "Bandai",
    conditionGrade: "used",
    channel: "online",
    confidence: 1,
    needsReview: false,
    status: "active",
    favorite: true,
    ignored: false,
    note: null,
    source: { key: "test", displayName: "测试平台" },
    images: [],
    ...overrides,
  };
}

function testResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response;
}

function json(body: unknown, status = 200) {
  return Promise.resolve(testResponse(body, status));
}

describe("Dashboard load error states", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let mounted: boolean;
  const failures = new Set<string>();
  const item = makeItem();

  beforeEach(() => {
    failures.clear();
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
    window.sessionStorage.clear();
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 0,
    });
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal(
      "matchMedia",
      vi.fn((media: string) => ({
        matches: true,
        media,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    vi.stubGlobal("fetch", vi.fn(fetchHandler));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    mounted = true;
  });

  afterEach(() => {
    if (mounted) act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function fetchHandler(
    input: RequestInfo | URL,
    _init?: RequestInit,
  ): Promise<Response> {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/auth/me")
      return json({
        account: {
          id: "manager-1",
          key: "manager_one",
          displayName: "龙",
          avatarInitial: "龙",
          position: 1,
          active: true,
        },
      });
    if (url.pathname === "/collaboration/accounts")
      return json({
        accounts: [
          {
            id: "manager-1",
            key: "manager_one",
            displayName: "龙",
            avatarInitial: "龙",
            position: 1,
            active: true,
          },
          {
            id: "manager-2",
            key: "manager_two",
            displayName: "润",
            avatarInitial: "润",
            position: 2,
            active: true,
          },
        ],
      });
    if (url.pathname === "/monitoring/overview")
      return json({
        status: "active",
        serverTime: "2026-09-01T00:00:00.000Z",
        itemTotal: 1,
        activeTotal: 1,
        productTotal: 1,
        pendingReviewTotal: 0,
        inventoryTotal: 0,
        discovered24h: 1,
        totals24h: {
          candidates: 1,
          inserted: 1,
          skippedKnown: 0,
          detailFailed: 0,
          succeeded: 1,
          failed: 0,
        },
        sources: [],
        recent: [],
        market: {
          activeTotal: 1,
          categories: [],
          collections: [],
          listingTypes: [{ key: "direct", count: 1 }],
          sources: [],
          discoveryTrend: [],
        },
      });
    if (url.pathname === "/items/changes")
      return json({ changes: [], nextCursor: null, hasMore: false });
    // The resale workspace keeps its own error state; an empty object
    // payload would crash its settings UI, so fail the load outright.
    if (url.pathname.startsWith("/resale")) return json({ error: "down" }, 503);
    if (url.pathname === "/cart")
      return json({ cartId: "", items: [], count: 0, updatedAt: "" });
    if (url.pathname === "/exchange-rate") {
      if (failures.has("rate")) return json({ error: "down" }, 503);
      return json({
        pair: "JPY_CNY",
        rate: 0.032,
        source: "test",
        referenceDate: "2026-09-01",
        fetchedAt: "2026-09-01T00:00:00.000Z",
        stale: false,
      });
    }
    if (url.pathname === "/items/purchases") {
      if (failures.has("purchases")) return json({ error: "down" }, 503);
      return json({ purchases: [], totalPurchaseAmountYen: 0 });
    }
    if (url.pathname === "/items") {
      if (url.searchParams.get("favorite") === "true") {
        if (failures.has("favorites")) return json({ error: "down" }, 503);
        return json({ items: [item], total: 1 });
      }
      if (
        url.searchParams.has("importOrigin") ||
        url.searchParams.has("ignored")
      )
        return json({ items: [], total: 0 });
      if (failures.has("catalog")) return json({ error: "down" }, 503);
      return json({
        items: [item],
        total: 1,
        facets: { direct: 1, auction: 0, unknown: 0 },
        serverTime: "2026-09-01T00:00:00.000Z",
      });
    }
    return json({});
  }

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await Promise.resolve();
    });
  }

  async function waitFor(assertion: () => void) {
    await vi.waitFor(
      async () => {
        await flush();
        assertion();
      },
      { timeout: 5_000 },
    );
  }

  async function renderDashboard() {
    await act(async () => {
      root.render(<Dashboard />);
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      await Promise.resolve();
    });
  }

  async function selectManager() {
    // Login replaced free account picking: the mocked /auth/me session
    // resolves the account at boot, so "selecting" now just waits for
    // the login gate to lift.
    await waitFor(() =>
      expect(host.querySelector(".manager-gate")).toBeNull(),
    );
  }

  async function renderAsManager() {
    await renderDashboard();
    await selectManager();
  }

  async function openCatalog() {
    // The home overview that used to carry the catalog entry is gone;
    // the catalog is reached from the bottom navigation now.
    await waitFor(() =>
      expect(host.querySelector('button[aria-label="选货"]')).not.toBeNull(),
    );
    await act(async () => {
      (
        host.querySelector('button[aria-label="选货"]') as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(host.querySelector('[aria-label="在售商品类型"]')).not.toBeNull(),
    );
  }

  async function openFavorites() {
    // Favorites is a view inside the catalog now: bottom nav to 选货,
    // then the 收藏 tab of the view switcher.
    await openCatalog();
    const switcher = host.querySelector('[aria-label="选货视图"]');
    const favoriteTab = [
      ...(switcher?.querySelectorAll<HTMLButtonElement>("button") ?? []),
    ].find((button) => button.textContent?.trim() === "收藏");
    expect(favoriteTab).toBeDefined();
    await act(async () => {
      favoriteTab?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("shows a retryable error when the catalog load fails, and recovers on retry", async () => {
    failures.add("catalog");
    await renderAsManager();
    await openCatalog();
    await waitFor(() =>
      expect(host.querySelector('[data-testid="load-error"]')).not.toBeNull(),
    );
    expect(host.querySelector('[data-testid="load-error"]')?.textContent).toContain(
      "商品同步暂时不可用",
    );
    const retry = host.querySelector<HTMLButtonElement>(
      '[data-testid="retry-catalog"]',
    );
    expect(retry).not.toBeNull();

    failures.delete("catalog");
    await act(async () => {
      retry?.click();
      await Promise.resolve();
    });
    await waitFor(() => expect(host.textContent).toContain("测试商品"));
    expect(host.querySelector('[data-testid="load-error"]')).toBeNull();
  });

  // Note: a mid-session catalog refresh failure (items stay, alert joins
  // them) is guaranteed by the loader replacing items only on success;
  // driving a second load from here pulls in the urgent-auction loader,
  // which paginates against these stubs, so that path is not re-tested.

  it("shows a retry in the favorites view when the collection load fails", async () => {
    failures.add("favorites");
    await renderAsManager();
    await openFavorites();
    await waitFor(() =>
      expect(
        host.querySelector('[data-testid="retry-favorites"]'),
      ).not.toBeNull(),
    );

    failures.delete("favorites");
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="retry-favorites"]')
        ?.click();
      await Promise.resolve();
    });
    await waitFor(() => expect(host.textContent).toContain("测试商品"));
    expect(host.querySelector('[data-testid="retry-favorites"]')).toBeNull();
  });

  it("degrades quietly when the exchange rate cannot be loaded", async () => {
    failures.add("rate");
    await renderAsManager();
    await openCatalog();
    await waitFor(() => expect(host.textContent).toContain("汇率暂不可用"));
    // The catalog itself still renders; the rate is a note, not a blocker.
    await waitFor(() => expect(host.textContent).toContain("测试商品"));
  });

  it("shows a retry in the purchases view when the records load fails", async () => {
    failures.add("purchases");
    window.history.replaceState(null, "", "/?workspace=purchases");
    await renderAsManager();
    await waitFor(() =>
      expect(
        host.querySelector('[data-testid="retry-purchases"]'),
      ).not.toBeNull(),
    );

    failures.delete("purchases");
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="retry-purchases"]')
        ?.click();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        host.querySelector('[data-testid="retry-purchases"]'),
      ).toBeNull(),
    );
  });

  it("lands the legacy orders deep link on the inventory tab of the merged page", async () => {
    window.history.replaceState(null, "", "/?workspace=orders");
    await renderAsManager();
    await waitFor(() => {
      const ordersTab = [...host.querySelectorAll('[role="tab"]')].find(
        (tab) => tab.textContent?.trim() === "库存订单",
      );
      expect(ordersTab?.getAttribute("aria-selected")).toBe("true");
    });
    // The inventory workspace itself renders under the merged heading.
    await waitFor(() => expect(host.textContent).toContain("还没有库存订单"));
  });

  it("honours ?tab=orders alongside ?workspace=purchases", async () => {
    window.history.replaceState(null, "", "/?workspace=purchases&tab=orders");
    await renderAsManager();
    await waitFor(() => {
      const ordersTab = [...host.querySelectorAll('[role="tab"]')].find(
        (tab) => tab.textContent?.trim() === "库存订单",
      );
      expect(ordersTab?.getAttribute("aria-selected")).toBe("true");
    });
    await waitFor(() => expect(host.textContent).toContain("还没有库存订单"));
  });
});
