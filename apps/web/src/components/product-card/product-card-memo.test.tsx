// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductCard } from "./product-card";
import type { ProductCardItem, ProductCardProps } from "./product-card-item";

// Render counting lives in the media block: it renders once per card
// render, so its count is the card's render count.
const mediaRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock("./product-card-media", () => ({
  ProductCardMedia: () => {
    mediaRenders.count += 1;
    return null;
  },
}));

function makeItem(): ProductCardItem {
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
    needsReview: false,
    favorite: false,
    note: null,
    source: { key: "test", displayName: "测试平台" },
    images: [],
  };
}

function stableProps(): ProductCardProps {
  return {
    item: makeItem(),
    serverOffset: 0,
    nowTick: 0,
    language: "zh",
    onOpen: () => undefined,
    onPatch: () => undefined,
    onIgnore: () => undefined,
    onDelete: () => undefined,
    onPurchase: () => undefined,
    exchangeRate: 0.05,
    inCart: false,
    onCart: () => undefined,
    onShare: () => undefined,
    onSendToManager: () => undefined,
  };
}

describe("ProductCard memoization", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mediaRenders.count = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("skips re-rendering when every prop keeps its identity", () => {
    const props = stableProps();
    act(() => {
      root.render(<ProductCard {...props} />);
    });
    expect(mediaRenders.count).toBe(1);
    // A parent re-render that changes nothing for this card (the
    // catalog search keystroke case) must not re-render the card.
    act(() => {
      root.render(<ProductCard {...props} />);
    });
    expect(mediaRenders.count).toBe(1);
  });

  it("re-renders when a prop actually changes", () => {
    const props = stableProps();
    act(() => {
      root.render(<ProductCard {...props} />);
    });
    act(() => {
      root.render(<ProductCard {...props} inCart />);
    });
    expect(mediaRenders.count).toBe(2);
  });
});
