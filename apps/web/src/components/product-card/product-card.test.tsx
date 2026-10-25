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

  it("renders the price block as one price row and one meta row", () => {
    act(() => {
      root.render(<ProductCard {...cardProps(makeItem())} />);
    });
    const decision = host.querySelector(".product-card-decision");
    const priceSlot = host.querySelector(".product-card-price-slot");
    expect(priceSlot?.querySelector("dt")?.textContent).toBe("总价");
    expect(priceSlot?.querySelector("dd")?.textContent).toBe("¥1,200");
    // No CNY small next to the hero amount: the estimate moved to the
    // meta row as a whole-yuan figure (1,200 x 0.05 = 60).
    expect(priceSlot?.querySelector("small")).toBeNull();
    expect(host.querySelector(".product-card-meta")?.textContent).toBe(
      "约 60元",
    );
    // The removed rows stay removed, whatever the item carries.
    for (const selector of [
      ".product-card-qty",
      ".product-card-unit",
      ".product-card-price-split",
      ".yahoo-discount",
      ".product-card-cost-evidence",
      ".product-card-value-king",
      ".product-card-china-reference",
    ]) {
      expect(host.querySelector(selector)).toBeNull();
    }
    expect(decision?.textContent).not.toContain("单价");
    expect(decision?.textContent).not.toContain("标价");
    expect(decision?.textContent).not.toContain("包邮");
  });

  it("prefers the Yahoo target in the meta row, in whole yuan", () => {
    act(() => {
      root.render(
        <ProductCard
          {...cardProps(
            makeItem({
              priceCurrent: 24_800,
              shippingFee: 0,
              source: { key: "yahoo_fleamarket", displayName: "Yahoo!フリマ" },
            }),
          )}
          exchangeRate={0.0425}
        />,
      );
    });
    // Target is 80% of the ask, rounded up: 19,840 yen; its CNY
    // estimate is a whole-yuan figure on the same single line.
    expect(host.querySelector(".product-card-meta")?.textContent).toBe(
      "目标 ¥19,840 · 约 843元",
    );
    expect(host.querySelector(".yahoo-discount")).toBeNull();
  });

  it("keeps the meta slot reserved and empty without an exchange rate", () => {
    act(() => {
      root.render(
        <ProductCard {...cardProps(makeItem())} exchangeRate={undefined} />,
      );
    });
    const meta = host.querySelector(".product-card-meta");
    expect(meta).not.toBeNull();
    expect(meta?.textContent).toBe("");
    expect(meta?.className).toContain("product-card-meta-height");
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
    expect(five?.querySelector("small")).toBeNull();

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
