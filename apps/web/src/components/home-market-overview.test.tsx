// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeMarketOverview } from "./home-market-overview";

describe("HomeMarketOverview", () => {
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
  });

  it("adds configured category entries with real active counts and closes the drawer on selection", () => {
    const onSelectCustomCategory = vi.fn();
    act(() =>
      root.render(
        <HomeMarketOverview
          data={{
            activeTotal: 120,
            categories: [{ key: "kamen_rider", count: 120 }],
            listingTypes: [],
            sources: [],
            discoveryTrend: [],
          }}
          activeCategory="all"
          activeListingType="direct"
          activeCustomCategoryId="custom-bags"
          customCategories={[
            {
              id: "custom-bags",
              name: "包品牌",
              activeItems: 7,
              scope: "general",
            },
            { id: "custom-empty", name: "新监控分类", activeItems: 0 },
          ]}
          onSelectCustomCategory={onSelectCustomCategory}
          onSelectCategory={() => undefined}
          onSelectCollection={() => undefined}
          onSelectListingType={() => undefined}
          onOpenInventory={() => undefined}
          onOpenValueKings={() => undefined}
          onOpenUrgentAuctions={() => undefined}
          onOpenXianyuComparison={() => undefined}
          onOpenWorkspace={() => undefined}
          onOpenCatalogView={() => undefined}
          onOpenAnalysis={() => undefined}
          hasAnalysis={false}
        />,
      ),
    );
    const drawer = host.querySelector<HTMLDetailsElement>(
      ".home-category-drawer",
    )!;
    expect(drawer.querySelector("summary")?.textContent).toContain("包品牌");
    expect(
      drawer.querySelector(".home-category-drawer-count")?.textContent,
    ).toBe("7");
    act(() => drawer.querySelector("summary")!.click());
    expect(
      host
        .querySelector('[aria-label="查看 包品牌"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      host.querySelector('[aria-label="查看 新监控分类"]')?.textContent,
    ).toContain("0");
    act(() =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="查看 包品牌"]')!
        .click(),
    );
    expect(onSelectCustomCategory).toHaveBeenCalledWith("custom-bags");
    expect(drawer.open).toBe(false);
  });

  it("renders only real non-zero categories and accepts future category keys", () => {
    const onSelectCategory = vi.fn();
    const onSelectCollection = vi.fn();
    const onSelectListingType = vi.fn();
    const onOpenXianyuComparison = vi.fn();
    act(() => {
      root.render(
        <HomeMarketOverview
          data={{
            activeTotal: 120,
            valueKingTotal: 6,
            categories: [
              { key: "kamen_rider", count: 80 },
              { key: "ultraman", count: 12 },
              { key: "super_sentai", count: 24 },
              { key: "other", count: 0 },
              { key: "future_ip", count: 16 },
            ],
            collections: [
              { key: "shf", categoryIp: "kamen_rider", count: 18 },
              { key: "shf", categoryIp: "ultraman", count: 7 },
              { key: "sic", categoryIp: "kamen_rider", count: 5 },
            ],
            listingTypes: [
              { key: "direct", count: 70 },
              { key: "auction", count: 50 },
              { key: "unknown", count: 5 },
            ],
            sources: [{ key: "mercari", displayName: "Mercari", count: 70 }],
            discoveryTrend: [
              { date: "2026-08-30", count: 2 },
              { date: "2026-08-31", count: 4 },
              { date: "2026-09-01", count: 6 },
              { date: "2026-09-02", count: 8 },
              { date: "2026-09-03", count: 10 },
              { date: "2026-09-04", count: 12 },
              { date: "2026-09-05", count: 14 },
            ],
            xianyuComparison: {
              total: 24,
              priceBands: [
                { key: "lt_300", label: "¥300 以下", count: 6 },
                { key: "300_999", label: "¥300–999", count: 14 },
                { key: "gte_1000", label: "¥1,000 以上", count: 4 },
              ],
            },
          }}
          activeCategory="all"
          activeCollection=""
          activeListingType="direct"
          updatedAt="2026-09-05T03:00:00.000Z"
          onSelectCategory={onSelectCategory}
          onSelectCollection={onSelectCollection}
          onSelectListingType={onSelectListingType}
          onOpenInventory={() => undefined}
          onOpenValueKings={() => undefined}
          onOpenUrgentAuctions={() => undefined}
          onOpenXianyuComparison={onOpenXianyuComparison}
          onOpenWorkspace={() => undefined}
          onOpenCatalogView={() => undefined}
          onOpenAnalysis={() => undefined}
          hasAnalysis={false}
        />,
      );
    });

    expect(host.textContent).toContain("超级战队");
    expect(host.textContent).toContain("S.H.Figuarts");
    expect(host.textContent).toContain("普通 · 真骨雕");
    expect(host.textContent).toContain("S.I.C.");
    expect(host.textContent).toContain("奥特曼");
    expect(host.textContent).toContain("future ip");
    expect(host.textContent).toContain("闲鱼同款对价");
    expect(host.textContent).toContain("性价比之王");
    expect(host.textContent).toContain("24");
    expect(host.textContent).not.toContain("其他");
    const listingSummary = host.querySelector(".home-listing-switch");
    expect(listingSummary?.querySelectorAll("button")).toHaveLength(0);
    expect(listingSummary?.textContent).toContain("直购");
    expect(listingSummary?.textContent).toContain("拍卖");
    expect(
      host.querySelectorAll(".home-catalog-entry-grid button"),
    ).toHaveLength(3);
    const drawer = host.querySelector("details.home-category-drawer");
    const summary = drawer?.querySelector("summary");
    expect(drawer?.hasAttribute("open")).toBe(false);
    act(() => summary?.click());
    expect(drawer?.hasAttribute("open")).toBe(true);
    const future = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("future ip"),
    );
    act(() => future?.click());
    expect(onSelectCategory).toHaveBeenCalledWith("future_ip");
    expect(drawer?.hasAttribute("open")).toBe(false);
    act(() => summary?.click());
    const ultramanShf = Array.from(host.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("S.H.Figuarts") &&
        button.textContent?.includes("奥特曼"),
    );
    act(() => ultramanShf?.click());
    expect(onSelectCollection).toHaveBeenCalledWith("shf", "ultraman");
    expect(drawer?.hasAttribute("open")).toBe(false);
    expect(
      Array.from(host.querySelectorAll("button")).some((button) =>
        button.textContent?.includes("待识别"),
      ),
    ).toBe(false);
    const xianyuDrawer = host.querySelector("details.home-xianyu-drawer");
    act(() => xianyuDrawer?.querySelector("summary")?.click());
    const midPriceBand = Array.from(
      xianyuDrawer?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent?.includes("¥300–999"));
    act(() => midPriceBand?.click());
    expect(onOpenXianyuComparison).toHaveBeenCalledWith("300_999", "asc");
  });

  it("does not render placeholder counts while the aggregate is loading", () => {
    act(() => {
      root.render(
        <HomeMarketOverview
          activeCategory="all"
          activeCollection=""
          activeListingType="direct"
          onSelectCategory={() => undefined}
          onSelectCollection={() => undefined}
          onSelectListingType={() => undefined}
          onOpenInventory={() => undefined}
          onOpenValueKings={() => undefined}
          onOpenUrgentAuctions={() => undefined}
          onOpenXianyuComparison={() => undefined}
          onOpenWorkspace={() => undefined}
          onOpenCatalogView={() => undefined}
          onOpenAnalysis={() => undefined}
          hasAnalysis={false}
        />,
      );
    });
    expect(host.textContent).toContain("正在汇总全库实时数据");
    expect(host.textContent).not.toContain("0 件");
  });

  it("explains an empty Xianyu comparison catalog without offering false price bands", () => {
    act(() => {
      root.render(
        <HomeMarketOverview
          data={{
            activeTotal: 10,
            valueKingTotal: 0,
            categories: [],
            listingTypes: [],
            sources: [],
            discoveryTrend: [],
            xianyuComparison: {
              total: 0,
              priceBands: [
                { key: "lt_300", label: "¥300 以下", count: 0 },
                { key: "300_999", label: "¥300–999", count: 0 },
                { key: "gte_1000", label: "¥1,000 以上", count: 0 },
              ],
            },
          }}
          activeCategory="all"
          activeCollection=""
          activeListingType="direct"
          onSelectCategory={() => undefined}
          onSelectCollection={() => undefined}
          onSelectListingType={() => undefined}
          onOpenInventory={() => undefined}
          onOpenValueKings={() => undefined}
          onOpenUrgentAuctions={() => undefined}
          onOpenXianyuComparison={() => undefined}
          onOpenWorkspace={() => undefined}
          onOpenCatalogView={() => undefined}
          onOpenAnalysis={() => undefined}
          hasAnalysis={false}
        />,
      );
    });

    const drawer = host.querySelector("details.home-xianyu-drawer");
    act(() => drawer?.querySelector("summary")?.click());
    expect(host.textContent).toContain("暂未生成可信同款");
    expect(host.textContent).toContain("目前没有达到公开条件的闲鱼同款");
    expect(drawer?.querySelectorAll("button")).toHaveLength(0);
  });

  function renderFlowEntries(overrides: Record<string, unknown> = {}) {
    const props = {
      data: {
        activeTotal: 10,
        categories: [],
        listingTypes: [],
        sources: [],
        discoveryTrend: [],
      },
      activeCategory: "all",
      activeCollection: "",
      activeListingType: "direct" as const,
      onSelectCategory: () => undefined,
      onSelectCollection: () => undefined,
      onSelectListingType: () => undefined,
      onOpenInventory: () => undefined,
      onOpenValueKings: () => undefined,
      onOpenUrgentAuctions: () => undefined,
      onOpenXianyuComparison: () => undefined,
      onOpenWorkspace: vi.fn(),
      onOpenCatalogView: () => undefined,
      onOpenAnalysis: () => undefined,
      hasAnalysis: false,
      ...overrides,
    };
    act(() => {
      root.render(<HomeMarketOverview {...props} />);
    });
    const entry = (label: string) =>
      [...host.querySelectorAll<HTMLButtonElement>(".home-menu-entry")].find(
        (button) => button.querySelector("strong")?.textContent === label,
      );
    return { props, entry };
  }

  it("opens the inventory tab of the merged page from the flow entries", () => {
    const onOpenPurchasesTab = vi.fn();
    const { entry } = renderFlowEntries({ onOpenPurchasesTab });
    act(() => entry("库存订单")?.click());
    expect(onOpenPurchasesTab).toHaveBeenCalledWith("orders");
  });

  it("falls back to the merged page when no tab opener is wired", () => {
    const { props, entry } = renderFlowEntries();
    act(() => entry("库存订单")?.click());
    expect(props.onOpenWorkspace).toHaveBeenCalledWith("purchases");
  });
});
