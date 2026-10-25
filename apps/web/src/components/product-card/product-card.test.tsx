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

  it("renders five- and six-digit totals as single amount tokens", () => {
    act(() => {
      root.render(
        <ProductCard
          {...cardProps(makeItem({ priceCurrent: 17_500, shippingFee: 0 }))}
        />,
      );
    });
    const five = host.querySelector(".product-card-total");
    expect(five?.querySelector("dd")?.textContent).toBe("¥17,500");
    expect(five?.querySelector("small")?.textContent).toContain("约");

    act(() => {
      root.render(
        <ProductCard
          {...cardProps(
            makeItem({ priceCurrent: 123_456, shippingFee: 0 }),
          )}
        />,
      );
    });
    const six = host.querySelector(".product-card-total");
    expect(six?.querySelector("dd")?.textContent).toBe("¥123,456");
  });

  it("keeps the bundle toggle in the tags row and the action row icon-only", () => {
    act(() => {
      root.render(
        <ProductCard
          {...cardProps(makeItem())}
          inBundleShare={false}
          onToggleBundleShare={vi.fn()}
        />,
      );
    });
    expect(host.querySelector(".product-card-seller")).toBeNull();
    const toggle = host.querySelector(
      'button[aria-label="加入集合分享篮"]',
    );
    expect(toggle).not.toBeNull();
    expect(
      host.querySelector(".product-card-tags")?.contains(toggle),
    ).toBe(true);
    const actionButtons = host.querySelectorAll(
      ".product-card-actions > button",
    );
    expect(actionButtons).toHaveLength(4);
    for (const button of actionButtons) {
      expect(button.textContent?.trim()).toBe("");
    }
  });
});
