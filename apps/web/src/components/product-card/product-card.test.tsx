// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductCard } from "./product-card";
import type { ProductCardItem } from "./product-card-item";
import {
  CARD_DENSITY_STORAGE_KEY,
  ProductCardDensityContext,
  ProductCardDensityToggle,
  readStoredCardDensity,
  storeCardDensity,
} from "./product-card-density";

function makeItem(overrides: Partial<ProductCardItem> = {}): ProductCardItem {
  return {
    id: "item-1",
    sourceUrl: "https://example.com/item-1",
    titleRaw: "テスト商品タイトル",
    titleZh: "测试商品标题",
    priceCurrent: 1_000,
    shippingFee: 200,
    quantityEst: 2,
    listingType: "direct",
    detectedAt: "2026-09-01T00:00:00.000Z",
    categoryIp: "kamen_rider",
    categoryToyType: "figure",
    manufacturer: "bandai",
    conditionGrade: "used",
    needsReview: true,
    favorite: false,
    note: null,
    source: { key: "test", displayName: "测试平台" },
    images: [],
    ...overrides,
  };
}

function cardProps(item: ProductCardItem) {
  return {
    item,
    serverOffset: 0,
    nowTick: 0,
    language: "zh" as const,
    onOpen: vi.fn(),
    onPatch: vi.fn(),
    onIgnore: vi.fn(),
    onDelete: vi.fn(),
    onPurchase: vi.fn(),
    exchangeRate: 0.05,
    inCart: false,
    onCart: vi.fn(),
    onShare: vi.fn(),
    onSendToManager: vi.fn(),
  };
}

describe("ProductCard density", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders the standard card without the compact hook by default", () => {
    act(() => {
      root.render(<ProductCard {...cardProps(makeItem())} />);
    });
    const card = host.querySelector("article.product-card");
    expect(card).not.toBeNull();
    expect(card?.className).not.toContain("product-card-compact");
    expect(card?.getAttribute("data-density")).toBeNull();
    // Amounts: total (price + shipping), its CNY estimate, quantity,
    // unit price and the list-price/shipping split all stay visible.
    expect(card?.textContent).toContain("¥1,200");
    expect(card?.textContent).toContain("约 ¥60.00");
    expect(card?.textContent).toContain("2 件");
    expect(card?.textContent).toContain("¥600");
    expect(card?.textContent).toContain("标价 ¥1,000");
    expect(card?.textContent).toContain("邮费 ¥200");
    expect(card?.querySelector(".product-card-tags")?.textContent).toContain(
      "假面骑士",
    );
    expect(card?.querySelector(".product-card-tags")?.textContent).toContain(
      "待复核",
    );
  });

  it("adds the compact hook in compact density and keeps every amount", () => {
    act(() => {
      root.render(<ProductCard {...cardProps(makeItem())} density="compact" />);
    });
    const card = host.querySelector("article.product-card");
    expect(card?.className).toContain("product-card-compact");
    expect(card?.getAttribute("data-density")).toBe("compact");
    expect(card?.textContent).toContain("¥1,200");
    expect(card?.textContent).toContain("约 ¥60.00");
    expect(card?.textContent).toContain("2 件");
    expect(card?.textContent).toContain("¥600");
    expect(card?.textContent).toContain("标价 ¥1,000");
    expect(card?.textContent).toContain("邮费 ¥200");
  });

  it("flags the price facts as quantity-unknown only when no quantity is known", () => {
    act(() => {
      root.render(<ProductCard {...cardProps(makeItem())} />);
    });
    const known = host.querySelector(".product-card-decision dl");
    expect(known?.hasAttribute("data-qty-unknown")).toBe(false);
    expect(known?.querySelector(".product-card-qty dd")?.textContent).toBe(
      "2 件",
    );
    expect(known?.querySelector(".product-card-unit dd")?.textContent).toBe(
      "¥600",
    );

    act(() => {
      root.render(
        <ProductCard {...cardProps(makeItem({ quantityEst: null }))} />,
      );
    });
    const unknown = host.querySelector(".product-card-decision dl");
    expect(unknown?.getAttribute("data-qty-unknown")).toBe("true");
    expect(unknown?.querySelector(".product-card-qty dd")?.textContent).toBe(
      "待识别",
    );
    // Amounts that do exist stay rendered even when quantity is unknown.
    const decision = host.querySelector(".product-card-decision");
    expect(decision?.textContent).toContain("¥1,200");
    expect(decision?.textContent).toContain("标价 ¥1,000");
  });

  it("takes density from context when no prop is passed", () => {
    act(() => {
      root.render(
        <ProductCardDensityContext.Provider value="compact">
          <ProductCard {...cardProps(makeItem())} />
        </ProductCardDensityContext.Provider>,
      );
    });
    expect(host.querySelector("article.product-card")?.className).toContain(
      "product-card-compact",
    );
  });

  it("persists the density choice in localStorage", () => {
    expect(readStoredCardDensity()).toBe("standard");
    storeCardDensity("compact");
    expect(window.localStorage.getItem(CARD_DENSITY_STORAGE_KEY)).toBe(
      "compact",
    );
    expect(readStoredCardDensity()).toBe("compact");
    storeCardDensity("standard");
    expect(readStoredCardDensity()).toBe("standard");
  });

  it("reports toggle clicks with the pressed state on the active density", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <ProductCardDensityToggle density="standard" onChange={onChange} />,
      );
    });
    const standard = host.querySelector<HTMLButtonElement>(
      'button[aria-pressed="true"]',
    );
    expect(standard?.textContent).toBe("标准");
    const compact = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "紧凑",
    );
    expect(compact?.getAttribute("aria-pressed")).toBe("false");
    act(() => {
      compact?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("compact");
  });
});
