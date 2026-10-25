// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductCard } from "./product-card";
import type { ProductCardItem } from "./product-card-item";

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

describe("ProductCard price facts", () => {
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
});
