// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SellerProfile,
  avatarInitial,
  avatarTone,
  filterSellerItems,
  formatPriceBand,
  sortSellerItems,
  type SellerProfileItem,
} from "./seller-profile";

const item = (
  overrides: Partial<SellerProfileItem>,
): SellerProfileItem => ({
  id: "i1",
  titleRaw: "仮面ライダー DXベルト",
  sourceUrl: "https://example.test/i1",
  priceCurrent: 3_000,
  listingType: "direct",
  status: "active",
  listedAt: "2026-10-20T00:00:00.000Z",
  images: [],
  ...overrides,
});

describe("seller profile helpers", () => {
  it("derives a stable avatar tone and initial from the seller", () => {
    expect(avatarTone("seller-1")).toBe(avatarTone("seller-1"));
    expect(avatarInitial(" 田中ホビー店")).toBe("田");
    expect(avatarInitial("")).toBe("?");
    expect(avatarInitial(null)).toBe("?");
  });

  it("formats the price band without leaking placeholder values", () => {
    expect(formatPriceBand(null, null)).toBe("—");
    expect(formatPriceBand(500, null)).toBe("—");
    expect(formatPriceBand(3_000, 3_000)).toBe("¥3,000");
    expect(formatPriceBand(300, 12_000)).toBe("¥300–1.2万");
  });

  it("filters by status and title query over loaded items", () => {
    const items = [
      item({ id: "a", status: "active", titleRaw: "DXベルト" }),
      item({ id: "b", status: "sold", titleRaw: "SHF フィギュア" }),
    ];
    expect(filterSellerItems(items, "", "all").map((x) => x.id)).toEqual([
      "a",
      "b",
    ]);
    expect(filterSellerItems(items, "", "sold").map((x) => x.id)).toEqual([
      "b",
    ]);
    expect(filterSellerItems(items, "ベルト", "all").map((x) => x.id)).toEqual(
      ["a"],
    );
  });

  it("sorts by price both ways without mutating the input", () => {
    const items = [
      item({ id: "a", priceCurrent: 500 }),
      item({ id: "b", priceCurrent: 100 }),
    ];
    expect(sortSellerItems(items, "priceAsc").map((x) => x.id)).toEqual([
      "b",
      "a",
    ]);
    expect(sortSellerItems(items, "priceDesc").map((x) => x.id)).toEqual([
      "a",
      "b",
    ]);
    expect(items.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("SellerProfile", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("renders a seller whose items lost their source relation instead of crashing", async () => {
    // Regression: the analysis endpoint used to omit `source` on items while
    // the dialog dereferenced item.source.key, taking the whole app down
    // with a client-side exception for every seller with live listings.
    const analysis = {
      seller: {
        id: "s1",
        name: "田中ホビー店",
        sellerType: "store",
        locationText: "東京都",
        profileUrl: "https://example.test/seller/s1",
        sourceData: null,
        source: { key: "mercari", displayName: "Mercari" },
        segment: { key: "professional_store", label: "专业店铺" },
      },
      items: [
        item({ id: "i1", titleRaw: "仮面ライダー DXベルト" }),
        item({
          id: "i2",
          titleRaw: "SHF 仮面ライダー",
          priceCurrent: 5_400,
          status: "sold",
        }),
      ],
      stats: {
        activeCount: 2,
        soldCount: 7,
        priceMinJpy: 3_000,
        priceMaxJpy: 5_400,
        lastListedAt: "2026-10-20T00:00:00.000Z",
      },
      total: 2,
      page: 1,
      limit: 48,
      pageCount: 1,
      analysis: {
        sellerType: "专业店铺",
        profile: "以 DX 腰带为主的店铺。",
        negotiationJa: "コメント失礼いたします。",
        negotiationZh: "打扰了。",
      },
      mode: "rules",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/analysis/seller/")) {
          return new Response(JSON.stringify(analysis), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    await act(async () => {
      root.render(
        <SellerProfile
          sellerId="s1"
          onClose={() => undefined}
          onOpenItem={() => undefined}
        />,
      );
    });

    expect(document.body.textContent).toContain("田中ホビー店");
    expect(document.body.textContent).toContain("仮面ライダー DXベルト");
    expect(document.body.textContent).toContain("SHF 仮面ライダー");
    expect(document.body.textContent).toContain("Mercari");
  });

  it("enqueues catalogue refresh on open and re-fetches analysis after delay", async () => {
    vi.useFakeTimers();

    const initialAnalysis = {
      seller: {
        id: "s1",
        name: "田中ホビー店",
        sellerType: "store",
        source: { key: "mercari", displayName: "Mercari" },
      },
      items: [item({ id: "i1", titleRaw: "仮面ライダー DXベルト" })],
      total: 1,
      page: 1,
      limit: 48,
      pageCount: 1,
      analysis: {
        sellerType: "普通卖家",
        profile: "个人闲置。",
        negotiationJa: "コメント失礼いたします。",
        negotiationZh: "打扰了。",
      },
      mode: "rules",
    };

    const refreshedAnalysis = {
      ...initialAnalysis,
      items: [
        item({ id: "i1", titleRaw: "仮面ライダー DXベルト" }),
        item({ id: "i2", titleRaw: "ウルトラマン 怪獣ソフビ" }),
      ],
      total: 2,
    };

    let fetchCount = 0;
    let refreshEnqueued = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/analysis/seller/s1/refresh")) {
          refreshEnqueued = true;
          return new Response(JSON.stringify({ enqueued: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/analysis/seller/s1")) {
          fetchCount += 1;
          const payload = fetchCount > 1 ? refreshedAnalysis : initialAnalysis;
          return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    await act(async () => {
      root.render(
        <SellerProfile
          sellerId="s1"
          onClose={() => undefined}
          onOpenItem={() => undefined}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(refreshEnqueued).toBe(true);
    expect(document.body.textContent).toContain("正在补全同店商品…");
    expect(fetchCount).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(fetchCount).toBe(2);
    expect(document.body.textContent).not.toContain("正在补全同店商品…");
    expect(document.body.textContent).toContain("ウルトラマン 怪獣ソフビ");

    vi.useRealTimers();
  });
});
