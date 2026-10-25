// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "./page";

// Poller timing is covered by visibility-poller.test.ts. These collaboration
// tests exercise focus-triggered refreshes without leaving real two-second
// timers that can update React outside the test's act() boundary.
vi.mock("../lib/visibility-poller", () => ({
  createVisibilityPoller({
    task,
    isPaused = () => false,
  }: {
    task: (signal: AbortSignal) => Promise<void>;
    isPaused?: () => boolean;
  }) {
    let stopped = true;
    let inFlight: Promise<void> | null = null;
    let controller: AbortController | null = null;

    const runNow = () => {
      if (stopped || isPaused()) return Promise.resolve();
      if (inFlight) return inFlight;
      const currentController = new AbortController();
      controller = currentController;
      inFlight = task(currentController.signal)
        .catch(() => undefined)
        .finally(() => {
          if (controller === currentController) controller = null;
          inFlight = null;
        });
      return inFlight;
    };

    return {
      start(immediate = true) {
        stopped = false;
        if (immediate) void runNow();
      },
      pause() {
        controller?.abort();
      },
      resume() {
        if (!stopped && !isPaused()) void runNow();
      },
      runNow,
      stop() {
        stopped = true;
        controller?.abort();
      },
    };
  },
}));

type TestItem = {
  id: string;
  sourceUrl: string;
  titleRaw: string;
  titleZh: string;
  descriptionRaw?: string | null;
  descriptionZh?: string | null;
  priceCurrent: number;
  priceTotalEst: number;
  shippingFee?: number | null;
  bidCount?: number | null;
  detectedAt: string;
  lastSeenAt: string;
  updatedAt: string;
  listingType: "direct" | "auction";
  auctionEndAt?: string | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
  categoryIp: string;
  categoryToyType: string;
  manufacturer: string;
  conditionGrade: string;
  channel: string;
  confidence: number;
  needsReview: boolean;
  status: string;
  translationStatus?: "pending" | "processing" | "completed" | "failed";
  favorite: boolean;
  ignored: boolean;
  note: string | null;
  source: { key: string; displayName: string };
  seller?: {
    id: string;
    name: string;
    sellerType: string;
  } | null;
  images: { url: string; position: number }[];
};

type TestChange = Partial<TestItem> &
  Pick<TestItem, "id">;

function makeItem(overrides: Partial<TestItem> = {}): TestItem {
  return {
    id: "favorite-1",
    sourceUrl: "https://example.com/favorite-1",
    titleRaw: "收藏商品",
    titleZh: "收藏商品",
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
    note: "旧备注",
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

describe("Dashboard favorite synchronization", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let mounted: boolean;

  beforeEach(() => {
    // Each scenario starts on inventory; workspace deep-links persist in history.
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
    window.history.replaceState(null, "", "/");
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

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await Promise.resolve();
    });
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
    // resolves the account at boot, so entering the app now just waits
    // for the login gate to lift.
    await waitFor(() =>
      expect(host.querySelector(".manager-gate")).toBeNull(),
    );
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

  async function renderAsManager({ catalog = false } = {}) {
    await renderDashboard();
    await selectManager();
    if (catalog) await openCatalog();
  }

  async function waitFor(assertion: () => void, timeout?: number) {
    await vi.waitFor(
      async () => {
        await flush();
        assertion();
      },
      timeout ? { timeout } : undefined,
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

  function createApi({
    inventory,
    favorites,
    cartItems = [],
    sellerItems = [],
    itemById = new Map<string, TestItem>(),
    deferredItems = new Map<
      string,
      (signal: AbortSignal | undefined) => Promise<Response>
    >(),
    listItems,
    patchItem,
    translateItem,
  }: {
    inventory: TestItem[];
    favorites: TestItem[];
    cartItems?: TestItem[];
    sellerItems?: TestItem[];
    itemById?: Map<string, TestItem>;
    deferredItems?: Map<
      string,
      (signal: AbortSignal | undefined) => Promise<Response>
    >;
    listItems?: (
      url: URL,
      signal: AbortSignal | undefined,
    ) => Promise<Response>;
    patchItem?: (id: string, init?: RequestInit) => Promise<Response>;
    translateItem?: (id: string) => Promise<Response>;
  }) {
    const queuedChanges: {
      changes: TestChange[];
      response: Promise<Response>;
      resolveResponse: (response: Response) => void;
      requestStarted: Promise<void>;
      markRequestStarted: () => void;
      bodyConsumed: Promise<void>;
      markBodyConsumed: () => void;
    }[] = [];
    let changeRequests = 0;
    let cursor = 0;
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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
            itemTotal: inventory.length,
            activeTotal: inventory.length,
            productTotal: inventory.length,
            pendingReviewTotal: 0,
            inventoryTotal: 0,
            discovered24h: inventory.length,
            totals24h: {
              candidates: inventory.length,
              inserted: inventory.length,
              skippedKnown: 0,
              detailFailed: 0,
              succeeded: inventory.length,
              failed: 0,
            },
            sources: [],
            recent: [],
            market: {
              activeTotal: inventory.length,
              categories: [],
              collections: [],
              listingTypes: [
                {
                  key: "direct",
                  count: inventory.filter(
                    (item) => item.listingType === "direct",
                  ).length,
                },
                {
                  key: "auction",
                  count: inventory.filter(
                    (item) => item.listingType === "auction",
                  ).length,
                },
              ],
              sources: [],
              discoveryTrend: [],
            },
          });
        if (url.pathname === "/items/changes") {
          changeRequests += 1;
          cursor += 1;
          const queued = queuedChanges.shift();
          if (!queued)
            return json({
              changes: [],
              nextCursor: `2026-09-01T00:00:0${cursor}.000Z`,
              hasMore: false,
            });
          queued.markRequestStarted();
          return queued.response;
        }
        if (url.pathname === "/cart")
          return json({
            cartId: "test",
            items: cartItems,
            count: cartItems.length,
            updatedAt: "",
          });
        const sellerAnalysisMatch = url.pathname.match(
          /^\/analysis\/seller\/([^/]+)$/,
        );
        if (sellerAnalysisMatch)
          return json({
            seller: {
              id: decodeURIComponent(sellerAnalysisMatch[1]),
              name: "测试卖家",
              sellerType: "individual",
              source: { key: "test", displayName: "测试平台" },
            },
            items: sellerItems,
            total: sellerItems.length,
            page: 1,
            limit: 48,
            pageCount: 1,
            analysis: {
              sellerType: "个人卖家",
              profile: "基于公开商品的测试画像",
              negotiationJa: "価格をご相談できますか。",
              negotiationZh: "可以商量价格吗？",
            },
            mode: "rules",
          });
        const itemAnalysisMatch = url.pathname.match(
          /^\/analysis\/item\/([^/]+)$/,
        );
        if (itemAnalysisMatch && translateItem)
          return translateItem(decodeURIComponent(itemAnalysisMatch[1]));
        if (url.pathname === "/items") {
          if (url.searchParams.get("favorite") === "true")
            return json({ items: favorites, total: favorites.length });
          if (
            url.searchParams.has("importOrigin") ||
            url.searchParams.has("ignored") ||
            url.searchParams.has("auctionMinutes")
          )
            return json({
              items: [],
              total: 0,
              serverTime: "2026-09-01T00:00:00.000Z",
            });
          if (listItems)
            return listItems(url, init?.signal as AbortSignal | undefined);
          return json({
            items: inventory,
            total: inventory.length,
            facets: {
              direct: inventory.filter((item) => item.listingType === "direct")
                .length,
              auction: inventory.filter(
                (item) => item.listingType === "auction",
              ).length,
            },
            serverTime: "2026-09-01T00:00:00.000Z",
          });
        }
        const itemMatch = url.pathname.match(/^\/items\/([^/]+)$/);
        if (itemMatch) {
          const id = decodeURIComponent(itemMatch[1]);
          if (init?.method === "PATCH" && patchItem) return patchItem(id, init);
          const deferred = deferredItems.get(id);
          if (deferred)
            return deferred(init?.signal as AbortSignal | undefined);
          const item = itemById.get(id);
          return item ? json({ item }) : json({}, 404);
        }
        return json({}, 404);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    return {
      fetchMock,
      collectionRequestCount: () =>
        fetchMock.mock.calls.filter(([input]) =>
          String(input).includes("favorite=true"),
        ).length,
      async sync(changes: TestChange[]) {
        let resolveResponse!: (response: Response) => void;
        let markRequestStarted!: () => void;
        let markBodyConsumed!: () => void;
        const requestStarted = new Promise<void>((resolve) => {
          markRequestStarted = resolve;
        });
        const bodyConsumed = new Promise<void>((resolve) => {
          markBodyConsumed = resolve;
        });
        const response = new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        });
        queuedChanges.push({
          changes,
          response,
          resolveResponse,
          requestStarted,
          markRequestStarted,
          bodyConsumed,
          markBodyConsumed,
        });
        const previousRequests = changeRequests;
        await act(async () => {
          window.dispatchEvent(new Event("focus"));
          await requestStarted;
          resolveResponse({
            ...testResponse(null),
            json: () => {
              markBodyConsumed();
              return Promise.resolve({
                changes,
                nextCursor: `2026-09-01T00:00:0${cursor}.000Z`,
                hasMore: false,
              });
            },
          } as Response);
          await bodyConsumed;
          await new Promise((resolve) => window.setTimeout(resolve, 0));
          await new Promise((resolve) => window.setTimeout(resolve, 0));
          await Promise.resolve();
          await Promise.resolve();
        });
        // syncChanges continues through several awaited pages before committing
        // its React state batch. Drain the following macrotask inside act so the
        // helper resolves only after that batch is observable to the test.
        await flush();
        expect(changeRequests).toBeGreaterThan(previousRequests);
      },
    };
  }

  it("merges current favorite changes and ignores non-favorite notes without reloading the collection", async () => {
    const favorite = makeItem();
    const api = createApi({ inventory: [favorite], favorites: [favorite] });

    await renderAsManager({ catalog: true });
    await waitFor(() => expect(host.textContent).toContain(favorite.titleZh));
    await openFavorites();
    await waitFor(() => expect(host.querySelector('button[aria-label="编辑采购备注：旧备注"]')).not.toBeNull());
    expect(api.collectionRequestCount()).toBe(1);

    await api.sync([
      {
        id: "not-favorite",
        favorite: false,
        ignored: false,
        note: "别人的备注",
        updatedAt: "2026-09-01T00:00:01.000Z",
      },
    ]);
    expect(api.collectionRequestCount()).toBe(1);

    await api.sync([
      {
        id: favorite.id,
        favorite: true,
        ignored: false,
        note: "合作方备注",
        updatedAt: "2026-09-01T00:00:02.000Z",
      },
    ]);
    await waitFor(() => expect(host.querySelector('button[aria-label="编辑采购备注：合作方备注"]')).not.toBeNull());
    expect(api.collectionRequestCount()).toBe(1);

    await api.sync([
      {
        id: favorite.id,
        favorite: false,
        ignored: false,
        updatedAt: "2026-09-01T00:00:03.000Z",
      },
    ]);
    await waitFor(() => expect(host.textContent).toContain("还没有收藏商品"));
    expect(api.collectionRequestCount()).toBe(1);
  });

  it("removes a newly sold inventory item from an availability-only sync without reloading the page", async () => {
    const item = makeItem({ titleZh: "不能继续展示的已售商品", titleRaw: "不能继续展示的已售商品" });
    const api = createApi({ inventory: [item], favorites: [item] });
    await renderAsManager({ catalog: true });
    await waitFor(() => expect(host.textContent).toContain(item.titleZh));
    const listRequests = api.fetchMock.mock.calls.filter(([input]) => new URL(String(input), "http://localhost").pathname === "/items").length;

    await api.sync([{ id: item.id, status: "sold", updatedAt: "2026-09-01T00:00:03.000Z" }]);

    await waitFor(() => expect(host.textContent).not.toContain(item.titleZh));
    expect(host.querySelector("#inventory")?.textContent).toContain("0 件");
    expect(api.fetchMock.mock.calls.filter(([input]) => new URL(String(input), "http://localhost").pathname === "/items").length).toBe(listRequests);
  });

  it("removes a deleted inventory item from a tombstone sync without reloading the page", async () => {
    const item = makeItem({ titleZh: "已被删除的商品", titleRaw: "已被删除的商品" });
    const api = createApi({ inventory: [item], favorites: [] });
    await renderAsManager({ catalog: true });
    await waitFor(() => expect(host.textContent).toContain(item.titleZh));
    const listRequests = api.fetchMock.mock.calls.filter(([input]) => new URL(String(input), "http://localhost").pathname === "/items").length;

    await api.sync([{ id: item.id, deletedAt: "2026-09-01T00:00:03.000Z", updatedAt: "2026-09-01T00:00:03.000Z" }]);

    await waitFor(() => expect(host.textContent).not.toContain(item.titleZh));
    expect(host.querySelector("#inventory")?.textContent).toContain("0 件");
    expect(api.fetchMock.mock.calls.filter(([input]) => new URL(String(input), "http://localhost").pathname === "/items").length).toBe(listRequests);
  });

  it("preserves favorite and note on an unknown status check then removes a sold favorite without full reload", async () => {
    const favorite = makeItem();
    const api = createApi({ inventory: [favorite], favorites: [favorite] });
    await renderAsManager({ catalog: true });
    await openFavorites();
    await waitFor(() => expect(host.querySelector('button[aria-label="编辑采购备注：旧备注"]')).not.toBeNull());

    await api.sync([{ id: favorite.id, status: "unknown", updatedAt: "2026-09-01T00:00:01.000Z" }]);
    expect(host.textContent).toContain(favorite.titleZh);
    expect(host.querySelector('button[aria-label="编辑采购备注：旧备注"]')).not.toBeNull();

    await api.sync([{ id: favorite.id, status: "sold", updatedAt: "2026-09-01T00:00:02.000Z" }]);
    await waitFor(() => expect(host.textContent).toContain("还没有收藏商品"));
    expect(api.collectionRequestCount()).toBe(1);
  });

  it("updates a favorite price and shipping from a partial availability audit without a collection reload", async () => {
    const favorite = makeItem({ shippingFee: 200 });
    const api = createApi({ inventory: [favorite], favorites: [favorite] });
    await renderAsManager({ catalog: true });
    await openFavorites();
    await waitFor(() => expect(host.querySelector('button[aria-label="编辑采购备注：旧备注"]')).not.toBeNull());
    await api.sync([{
      id: favorite.id, priceCurrent: 2_400, shippingFee: 500, priceTotalEst: 2_900,
      updatedAt: "2026-09-01T00:00:02.000Z",
    }]);
    // The card shows the new total (2,400 + 500 shipping); the list
    // price itself is a detail-view fact since the split line retired.
    await waitFor(() => expect(host.textContent).toContain("2,900"));
    expect(host.textContent).toContain(favorite.titleZh);
    expect(host.querySelector('button[aria-label="编辑采购备注：旧备注"]')).not.toBeNull();
    expect(api.collectionRequestCount()).toBe(1);
  });

  it("rejects stale sold favorites in a collection response while retaining an uncertain availability", async () => {
    const sold = makeItem({ id: "already-sold", titleRaw: "源站已售", titleZh: "源站已售", status: "sold" });
    const unknown = makeItem({ id: "uncertain", titleRaw: "暂时无法核验", titleZh: "暂时无法核验", status: "unknown" });
    createApi({ inventory: [], favorites: [sold, unknown] });
    await renderAsManager();
    await openFavorites();
    await waitFor(() => expect(host.textContent).toContain(unknown.titleZh));
    expect(host.textContent).not.toContain(sold.titleZh);
  });

  it("removes an auction favorite once its synchronized deadline is already past without clearing the saved favorite", async () => {
    const favorite = makeItem();
    const api = createApi({ inventory: [favorite], favorites: [favorite] });
    await renderAsManager({ catalog: true });
    await openFavorites();
    await waitFor(() => expect(host.textContent).toContain(favorite.titleZh));

    await api.sync([{
      id: favorite.id,
      listingType: "auction",
      auctionEndAt: new Date(Date.now() - 60_000).toISOString(),
      updatedAt: "2026-09-01T00:00:02.000Z",
    }]);

    await waitFor(() => expect(host.textContent).toContain("还没有收藏商品"));
    expect(api.collectionRequestCount()).toBe(1);
    expect(favorite.favorite).toBe(true);
  });

  it("expires an auction favorite at its deadline even when no crawler sync event arrives", async () => {
    const favorite = makeItem();
    const api = createApi({ inventory: [favorite], favorites: [favorite] });
    await renderAsManager();
    await openFavorites();
    await waitFor(() => expect(host.textContent).toContain(favorite.titleZh));
    await api.sync([{
      id: favorite.id,
      listingType: "auction",
      auctionEndAt: new Date(Date.now() + 800).toISOString(),
      updatedAt: "2026-09-01T00:00:02.000Z",
    }]);
    expect(host.textContent).toContain("共 1 件");
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 900));
    });
    expect(host.textContent).toContain("还没有收藏商品");
    expect(api.collectionRequestCount()).toBe(1);
  });

  it("keeps an optimistic note when an older sync arrives before and after the save response", async () => {
    const favorite = makeItem();
    const confirmed = makeItem({
      note: "我的新备注",
      updatedAt: "2026-09-01T00:00:03.000Z",
    });
    let resolvePatch: ((response: Response) => void) | undefined;
    const api = createApi({
      inventory: [favorite],
      favorites: [favorite],
      patchItem: () =>
        new Promise<Response>((resolve) => {
          resolvePatch = resolve;
        }),
    });

    await renderAsManager({ catalog: true });
    await waitFor(() => expect(host.textContent).toContain(favorite.titleZh));
    await openFavorites();
    await waitFor(() => expect(host.querySelector('button[aria-label="编辑采购备注：旧备注"]')).not.toBeNull());

    const noteButton = host.querySelector(
      'button[aria-label="编辑采购备注：旧备注"]',
    ) as HTMLButtonElement;
    await act(async () => {
      noteButton.click();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(document.querySelector("textarea")).not.toBeNull(),
    );
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "我的新备注");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const saveButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "保存",
    );
    act(() => saveButton?.click());
    await waitFor(() => expect(host.querySelector('button[aria-label="编辑采购备注：我的新备注"]')).not.toBeNull());

    await api.sync([
      {
        id: favorite.id,
        favorite: true,
        ignored: false,
        note: "延迟的旧备注",
        updatedAt: "2026-09-01T00:00:01.000Z",
      },
    ]);
    expect(host.querySelector('button[aria-label="编辑采购备注：我的新备注"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="编辑采购备注：延迟的旧备注"]')).toBeNull();

    await act(async () => {
      resolvePatch?.(testResponse({ item: confirmed }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(document.querySelector("textarea")).toBeNull());
    await api.sync([
      {
        id: favorite.id,
        favorite: true,
        ignored: false,
        note: "更迟到的旧备注",
        updatedAt: "2026-09-01T00:00:02.000Z",
      },
    ]);
    expect(host.querySelector('button[aria-label="编辑采购备注：我的新备注"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="编辑采购备注：更迟到的旧备注"]')).toBeNull();
    expect(api.collectionRequestCount()).toBe(1);
  });

  it("restores the newest collaboration note when an optimistic save fails", async () => {
    const favorite = makeItem();
    let rejectPatch: ((reason?: unknown) => void) | undefined;
    const api = createApi({
      inventory: [favorite],
      favorites: [favorite],
      patchItem: () =>
        new Promise<Response>((_resolve, reject) => {
          rejectPatch = reject;
        }),
    });

    await renderAsManager({ catalog: true });
    await waitFor(() => expect(host.textContent).toContain(favorite.titleZh));
    await openFavorites();
    const noteButton = host.querySelector(
      'button[aria-label="编辑采购备注：旧备注"]',
    ) as HTMLButtonElement;
    act(() => noteButton.click());
    await waitFor(() =>
      expect(document.querySelector("textarea")).not.toBeNull(),
    );
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "我的未保存备注");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const saveButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "保存",
    );
    act(() => saveButton?.click());
    await waitFor(() =>
      expect(
        host.querySelector('button[aria-label="编辑采购备注：我的未保存备注"]'),
      ).not.toBeNull(),
    );

    await api.sync([
      {
        id: favorite.id,
        favorite: true,
        ignored: false,
        note: "合作方更新",
        updatedAt: "2026-09-01T00:00:04.000Z",
      },
    ]);
    expect(
      host.querySelector('button[aria-label="编辑采购备注：我的未保存备注"]'),
    ).not.toBeNull();

    await act(async () => {
      rejectPatch?.(new Error("模拟保存失败"));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        host.querySelector('button[aria-label="编辑采购备注：合作方更新"]'),
      ).not.toBeNull(),
    );
    expect(api.collectionRequestCount()).toBe(1);
  });

  it("opens the existing purchase flow directly from a favorite card", async () => {
    const favorite = makeItem();
    createApi({ inventory: [favorite], favorites: [favorite] });

    await renderAsManager({ catalog: true });
    await waitFor(() => expect(host.textContent).toContain(favorite.titleZh));
    await openFavorites();
    // Favorites render the shared ProductCard now: purchase lives in the
    // card's more menu, same as every other item surface.
    await waitFor(() =>
      expect(
        host.querySelector('button[aria-label="更多商品操作"]'),
      ).not.toBeNull(),
    );

    act(() => {
      (
        host.querySelector(
          'button[aria-label="更多商品操作"]',
        ) as HTMLButtonElement
      ).click();
    });
    await waitFor(() =>
      expect(host.querySelector('button[aria-label="登记购买"]')).not.toBeNull(),
    );

    act(() => {
      (
        host.querySelector(
          'button[aria-label="登记购买"]',
        ) as HTMLButtonElement
      ).click();
    });

    await waitFor(() =>
      expect(document.body.textContent).toContain("登记购买"),
    );
  });

  it("refreshes a cart item with a targeted GET before opening its detail", async () => {
    const cartItem = makeItem({
      id: "cart-detail",
      titleRaw: "购物车商品",
      titleZh: "购物车商品",
      favorite: false,
    });
    const api = createApi({
      inventory: [],
      favorites: [],
      cartItems: [cartItem],
      itemById: new Map([[cartItem.id, cartItem]]),
    });

    await renderAsManager();
    await waitFor(() =>
      expect(
        host.querySelector('button[aria-label="打开购物车，1 件"]'),
      ).not.toBeNull(),
    );
    act(() => {
      (
        host.querySelector(
          'button[aria-label="打开购物车，1 件"]',
        ) as HTMLButtonElement
      ).click();
    });
    await waitFor(() =>
      expect(
        document.querySelector('button[aria-label="查看 购物车商品"]'),
      ).not.toBeNull(),
    );
    await act(async () => {
      (
        document.querySelector(
          'button[aria-label="查看 购物车商品"]',
        ) as HTMLButtonElement
      ).click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(
      api.fetchMock.mock.calls.map(([input, init]) => ({
        path: new URL(String(input), "http://localhost").pathname,
        cache: init?.cache,
      })),
    ).toContainEqual({
      path: `/items/${cartItem.id}`,
      cache: "no-store",
    });
  });

  it("requires an explicit translation request and keeps failures stable across retry and reopen", async () => {
    const item = makeItem({
      id: "translation-failure",
      titleRaw: "翻译失败商品",
      titleZh: "翻译失败商品",
      descriptionRaw:
        "仮面ライダーの変身ベルトセットです。付属品に欠品があります。",
      descriptionZh: null,
      favorite: false,
      translationStatus: "pending",
    });
    let attempts = 0;
    createApi({
      inventory: [item],
      favorites: [],
      translateItem: async () => {
        attempts += 1;
        return testResponse({}, 503);
      },
    });

    await renderAsManager({ catalog: true });
    await waitFor(() => expect(host.textContent).toContain(item.titleZh));
    act(() => {
      (
        host.querySelector(
          'button[aria-label="打开商品：翻译失败商品"]',
        ) as HTMLButtonElement
      ).click();
    });
    await waitFor(() =>
      expect(
        document.querySelector(
          '[role="dialog"][aria-labelledby="detail-drawer-title"]',
        ),
      ).not.toBeNull(),
    );
    await flush();
    expect(attempts).toBe(0);
    const translate = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "翻译商品",
    );
    expect(translate).toBeDefined();
    act(() => translate?.click());
    await waitFor(() =>
      expect(document.body.textContent).toContain("翻译暂不可用"),
    );
    expect(document.body.textContent).toContain(item.descriptionRaw);
    expect(document.body.textContent).not.toContain(
      "假面骑士の变身腰带套装です。配件に缺件があります。",
    );
    await flush();
    expect(attempts).toBe(1);

    const retry = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "重试",
    );
    expect(retry).toBeDefined();
    act(() => retry?.click());
    await waitFor(() => expect(attempts).toBe(2));
    await flush();
    expect(attempts).toBe(2);

    act(() => {
      (
        document.querySelector(
          '[role="dialog"][aria-labelledby="detail-drawer-title"] button[aria-label="返回上一步"]',
        ) as HTMLButtonElement
      ).click();
    });
    await waitFor(() =>
      expect(
        document.querySelector(
          '[role="dialog"][aria-labelledby="detail-drawer-title"]',
        ),
      ).toBeNull(),
    );
    act(() => {
      (
        host.querySelector(
          'button[aria-label="打开商品：翻译失败商品"]',
        ) as HTMLButtonElement
      ).click();
    });
    await waitFor(() =>
      expect(
        document.querySelector(
          '[role="dialog"][aria-labelledby="detail-drawer-title"]',
        ),
      ).not.toBeNull(),
    );
    await flush();
    expect(attempts).toBe(2);
    expect(document.body.textContent).toContain("翻译暂不可用");
    const reopenedRetry = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "重试",
    );
    expect(reopenedRetry).toBeDefined();
    act(() => reopenedRetry?.click());
    await waitFor(() => expect(attempts).toBe(3));
    await flush();
    expect(attempts).toBe(3);
  });

  it("refreshes a seller item with a targeted GET before opening its detail", async () => {
    const sellerItem = makeItem({
      id: "seller-detail",
      titleRaw: "仮面ライダーギーツ DXドライバー セット",
      titleZh: "",
      favorite: false,
    });
    const inventoryItem = makeItem({
      id: "seller-entry",
      titleRaw: "进入卖家页",
      titleZh: "进入卖家页",
      favorite: false,
      seller: {
        id: "seller-1",
        name: "测试卖家",
        sellerType: "individual",
      },
    });
    const api = createApi({
      inventory: [inventoryItem],
      favorites: [],
      sellerItems: [sellerItem],
      itemById: new Map([[sellerItem.id, sellerItem]]),
    });

    await renderAsManager({ catalog: true });
    await waitFor(() => expect(host.textContent).toContain("进入卖家页"));
    // Cards no longer carry a seller entry; it lives in the detail drawer.
    expect(
      host.querySelector('button[aria-label="查看卖家：测试卖家"]'),
    ).toBeNull();
    const titleButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "进入卖家页",
    ) as HTMLButtonElement;
    expect(titleButton).toBeDefined();
    act(() => titleButton.click());
    await waitFor(() =>
      expect(document.body.textContent).toContain("查看同店商品 / 凑单"),
    );
    const sellerButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("查看同店商品 / 凑单"),
    ) as HTMLButtonElement;
    expect(sellerButton).toBeDefined();
    act(() => sellerButton.click());
    await waitFor(() =>
      expect(document.body.textContent).toContain(
        "仮面ライダーギーツ DXドライバー セット",
      ),
    );
    expect(document.body.textContent).not.toContain(
      "假面骑士ギーツ DX驱动器 套装",
    );
    const sellerItemButton = [...document.querySelectorAll("button")].find(
      (button) =>
        button.textContent?.includes("仮面ライダーギーツ DXドライバー セット"),
    );
    expect(sellerItemButton).toBeDefined();
    await act(async () => {
      sellerItemButton?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(
      api.fetchMock.mock.calls.map(([input, init]) => ({
        path: new URL(String(input), "http://localhost").pathname,
        cache: init?.cache,
      })),
    ).toContainEqual({
      path: `/items/${sellerItem.id}`,
      cache: "no-store",
    });
  });

  it("slims the card: IP tag first, review marker, total only, bundle kept, no seller row or per-card language toggle", async () => {
    const item = makeItem({
      id: "card-slim",
      titleRaw: "カード スリム",
      titleZh: "卡片精简验收",
      favorite: false,
      priceCurrent: 1_000,
      shippingFee: 500,
      categoryIp: "kamen_rider",
      needsReview: true,
      seller: {
        id: "seller-1",
        name: "测试卖家",
        sellerType: "individual",
      },
    });
    createApi({ inventory: [item], favorites: [] });

    await renderAsManager({ catalog: true });
    await waitFor(() =>
      expect(host.querySelector('[data-item-id="card-slim"]')).not.toBeNull(),
    );
    const card = host.querySelector(
      '[data-item-id="card-slim"]',
    ) as HTMLElement;

    const tags = card.querySelector(".product-card-tags");
    expect(tags?.textContent).toContain("假面骑士");
    expect(
      tags?.querySelector("span")?.textContent?.trim(),
    ).toBe("假面骑士");
    expect(tags?.textContent).toContain("待复核");

    // The total stays prominent; the list/shipping split line is a
    // detail-view fact now and no longer renders on the card.
    expect(card.textContent).toContain("¥1,500");
    expect(card.textContent).not.toContain("标价 ¥1,000 + 邮费 ¥500");
    expect(card.querySelector(".product-card-price-split")).toBeNull();
    expect(card.textContent?.match(/邮费/g) ?? []).toHaveLength(0);

    // The bundle toggle survives the seller-row removal.
    expect(
      card.querySelector('button[aria-label="加入集合分享篮"]'),
    ).not.toBeNull();
    expect(card.textContent).toContain("+ 凑单");

    // Removed rows stay removed on the card itself.
    expect(card.textContent).not.toContain("测试卖家");
    expect(card.textContent).not.toContain("卖家未知");
    expect(
      card.querySelector('button[aria-label="查看卖家：测试卖家"]'),
    ).toBeNull();
    expect(card.querySelector(".product-card-language-toggle")).toBeNull();
    expect(card.querySelector(".product-card-standard")).toBeNull();
    expect(card.querySelector(".xianyu-card-logo")).toBeNull();
  });

  it("keeps detail editing collapsed, validates quantity, and recovers from save failures", async () => {
    const item = makeItem({
      id: "detail-edit",
      titleZh: "详情排版验收",
      titleRaw: "详情排版验收",
      descriptionZh: "包含20件配件，外盒轻微磨损。",
      descriptionRaw: "付属品20点、箱に傷あり。",
      translationStatus: "completed",
    });
    const patchItem = vi.fn(async () =>
      testResponse({ message: "保存失败，请重试" }, 503),
    );
    createApi({ inventory: [item], favorites: [], patchItem });
    await renderAsManager({ catalog: true });
    await waitFor(() =>
      expect(
        host.querySelector('[aria-label="打开商品：详情排版验收"]'),
      ).not.toBeNull(),
    );
    act(() =>
      (
        host.querySelector(
          '[aria-label="打开商品：详情排版验收"]',
        ) as HTMLButtonElement
      ).click(),
    );
    await waitFor(() =>
      expect(document.querySelector(".product-detail-panel")).not.toBeNull(),
    );
    const panel = document.querySelector(".product-detail-panel")!;
    expect(
      panel.querySelector<HTMLDetailsElement>(".detail-editor")?.open,
    ).toBe(false);
    expect(panel.textContent).toContain("包含20件配件，外盒轻微磨损。");
    expect(panel.textContent).not.toContain("预计到手");
    expect(panel.textContent).not.toContain("Manual review");
    const editor = panel.querySelector<HTMLDetailsElement>(".detail-editor")!;
    editor.open = true;
    const quantity = editor.querySelector<HTMLInputElement>(
      'input[type="number"]',
    )!;
    const save = [...editor.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "保存修改",
    )!;
    const setQuantity = (value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(quantity, value);
        quantity.dispatchEvent(new Event("input", { bubbles: true }));
      });
    setQuantity("-1");
    act(() => save.click());
    expect(panel.textContent).toContain("数量须为正整数");
    expect(patchItem).not.toHaveBeenCalled();
    setQuantity("20");
    await act(async () => {
      save.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(patchItem).toHaveBeenCalledTimes(1);
    expect(panel.textContent).toContain("保存失败，请重试");
    expect(save.disabled).toBe(false);
  });

  it("boots into the session account and logs out from the account block", async () => {
    createApi({ inventory: [], favorites: [] });

    await renderDashboard();
    await selectManager();
    // The session account is already active - no picker ever appears.
    expect(host.querySelector(".manager-account-choice")).toBeNull();
    expect(
      window.localStorage.getItem("kamen-procurement-manager-v1"),
    ).toBeNull();
    await waitFor(() =>
      expect(
        host.querySelector('button[aria-label="打开工作台账号区，当前账号：龙"]'),
      ).not.toBeNull(),
    );
    act(() => {
      (
        host.querySelector(
          'button[aria-label="打开工作台账号区，当前账号：龙"]',
        ) as HTMLButtonElement
      ).click();
    });
    await waitFor(() => expect(host.textContent).toContain("当前账号"));
    // No way to switch identity from here anymore.
    expect(host.textContent).not.toContain("切换账号");

    const logoutButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "退出登录",
    );
    expect(logoutButton).toBeDefined();
    await act(async () => {
      logoutButton?.click();
      await Promise.resolve();
    });
    // Logging out drops back to the credential login card.
    await waitFor(() =>
      expect(host.querySelector(".manager-gate")).not.toBeNull(),
    );
    expect(host.querySelector('input[aria-label="账号"]')).not.toBeNull();
    expect(host.querySelector('input[aria-label="密码"]')).not.toBeNull();
  });

  it("returns from messages to the recent catalog page and restores its scroll position", async () => {
    createApi({ inventory: [makeItem()], favorites: [] });
    await renderAsManager({ catalog: true });
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 640,
    });

    await act(async () => {
      (
        host.querySelector('button[aria-label="消息"]') as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(host.querySelector(".collaboration-chat")).not.toBeNull(),
    );

    const historyTrigger = host.querySelector(
      'button[aria-label="打开最近浏览"]',
    ) as HTMLButtonElement;
    expect(historyTrigger).not.toBeNull();
    act(() => historyTrigger.click());
    const catalogEntry = [
      ...host.querySelectorAll<HTMLButtonElement>("[data-history-entry]"),
    ].find((button) => button.textContent?.includes("选货"));
    expect(catalogEntry).toBeDefined();

    const scrollToMock = window.scrollTo as ReturnType<typeof vi.fn>;
    scrollToMock.mockClear();
    await act(async () => {
      catalogEntry?.click();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(host.querySelector('[aria-label="在售商品类型"]')).not.toBeNull(),
    );
    expect(scrollToMock).toHaveBeenCalledWith({ top: 640, behavior: "auto" });
  });

  it("does not let the previous catalog response overwrite a newly opened value-king catalog", async () => {
    const ordinary = makeItem({
      id: "ordinary-direct",
      titleRaw: "普通直购商品",
      titleZh: "普通直购商品",
      favorite: false,
    });
    let resolveOrdinary: ((response: Response) => void) | undefined;
    let ordinaryRequestStarted: (() => void) | undefined;
    const ordinaryStarted = new Promise<void>((resolve) => {
      ordinaryRequestStarted = resolve;
    });
    createApi({
      inventory: [ordinary],
      favorites: [],
      listItems: (url) => {
        if (url.searchParams.get("valueKing") === "true")
          return json({
            items: [],
            total: 0,
            facets: { direct: 0, auction: 0, unknown: 0 },
            serverTime: "2026-09-01T00:00:00.000Z",
          });
        ordinaryRequestStarted?.();
        return new Promise<Response>((resolve) => {
          resolveOrdinary = resolve;
        });
      },
    });

    await renderAsManager();
    await openCatalog();
    await ordinaryStarted;
    // The value-king entry moved from the retired home overview into
    // the catalog header.
    const valueKingButton = host.querySelector(
      'button[aria-label="性价比之王"]',
    ) as HTMLButtonElement;
    expect(valueKingButton).not.toBeNull();

    await act(async () => {
      valueKingButton.click();
      await Promise.resolve();
      resolveOrdinary?.(
        testResponse({
          items: [ordinary],
          total: 1,
          facets: { direct: 1, auction: 0, unknown: 0 },
          serverTime: "2026-09-01T00:00:00.000Z",
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("性价比之王 · 0 件");
    expect(host.textContent).not.toContain("普通直购商品");
    await waitFor(() =>
      expect(host.textContent).toContain("性价比之王 · 0 件"),
    );
    expect(host.textContent).not.toContain("普通直购商品");
  });

  it("inserts known favorites, fetches unknown favorites by id, and rejects a cancelled stale response", async () => {
    const known = makeItem({
      id: "known",
      titleRaw: "已知商品",
      titleZh: "已知商品",
      favorite: false,
      note: null,
    });
    const unknown = makeItem({
      id: "unknown",
      titleRaw: "定向补取商品",
      titleZh: "定向补取商品",
      note: null,
    });
    const late = makeItem({
      id: "late",
      titleRaw: "不应恢复",
      titleZh: "不应恢复",
      note: null,
    });
    let resolveUnknown: ((response: Response) => void) | undefined;
    let lateSignal: AbortSignal | undefined;
    let resolveLate: ((response: Response) => void) | undefined;
    const api = createApi({
      inventory: [known],
      favorites: [],
      deferredItems: new Map([
        [
          unknown.id,
          () =>
            new Promise<Response>((resolve) => {
              resolveUnknown = resolve;
            }),
        ],
        [
          late.id,
          (signal: AbortSignal | undefined) => {
            lateSignal = signal;
            return new Promise<Response>((resolve) => {
              resolveLate = resolve;
            });
          },
        ],
      ]),
    });

    await renderAsManager({ catalog: true });
    await waitFor(() => expect(host.textContent).toContain(known.titleZh));
    await openFavorites();
    await waitFor(() => expect(host.textContent).toContain("还没有收藏商品"));

    await api.sync([
      {
        id: known.id,
        favorite: true,
        ignored: false,
        updatedAt: "2026-09-01T00:00:01.000Z",
      },
    ]);
    await waitFor(() => expect(host.textContent).toContain("已知商品"));
    expect(api.collectionRequestCount()).toBe(1);
    expect(
      api.fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith("/items/known"),
      ),
    ).toBe(false);

    await api.sync([
      {
        id: unknown.id,
        favorite: true,
        ignored: false,
        updatedAt: "2026-09-01T00:00:02.000Z",
      },
    ]);
    await waitFor(() => expect(resolveUnknown).toBeDefined());
    await act(async () => {
      resolveUnknown?.(testResponse({ item: unknown }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(host.textContent).toContain("定向补取商品"));
    expect(api.collectionRequestCount()).toBe(1);
    expect(
      api.fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith("/items/unknown"),
      ),
    ).toBe(true);

    await api.sync([
      {
        id: late.id,
        favorite: true,
        ignored: false,
        updatedAt: "2026-09-01T00:00:03.000Z",
      },
    ]);
    await waitFor(() => expect(lateSignal).toBeDefined());
    await api.sync([
      {
        id: late.id,
        favorite: false,
        ignored: false,
        updatedAt: "2026-09-01T00:00:04.000Z",
      },
    ]);
    await waitFor(() => expect(lateSignal?.aborted).toBe(true));

    await act(async () => {
      resolveLate?.(testResponse({ item: late }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).not.toContain("不应恢复");
    expect(api.collectionRequestCount()).toBe(1);
  });

  it("retries a transient targeted fetch without reloading the favorite collection", async () => {
    const unknown = makeItem({
      id: "retry-target",
      titleRaw: "重试后补取商品",
      titleZh: "重试后补取商品",
      note: null,
    });
    let attempts = 0;
    let retryTick: (() => void) | undefined;
    const initialNow = Date.now();
    let currentNow = initialNow;
    vi.spyOn(Date, "now").mockImplementation(() => currentNow);
    const nativeSetInterval = window.setInterval.bind(window);
    vi.spyOn(window, "setInterval").mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      if (timeout === 250) {
        retryTick = () => {
          if (typeof handler === "function") handler(...args);
        };
        return -1;
      }
      return nativeSetInterval(handler, timeout, ...args);
    }) as typeof window.setInterval);
    const api = createApi({
      inventory: [],
      favorites: [],
      deferredItems: new Map([
        [
          unknown.id,
          async () => {
            attempts += 1;
            return attempts === 1
              ? testResponse({}, 503)
              : testResponse({ item: unknown });
          },
        ],
      ]),
    });

    await renderAsManager();
    await openFavorites();
    await api.sync([
      {
        id: unknown.id,
        favorite: true,
        ignored: false,
        updatedAt: "2026-09-01T00:00:05.000Z",
      },
    ]);
    await waitFor(() => expect(attempts).toBe(1));
    currentNow += 501;
    await act(async () => {
      retryTick?.();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await Promise.resolve();
    });
    await waitFor(
      () => expect(host.textContent).toContain("重试后补取商品"),
      2_500,
    );
    expect(attempts).toBe(2);
    expect(api.collectionRequestCount()).toBe(1);
  });
});
