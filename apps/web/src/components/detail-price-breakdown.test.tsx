// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DetailPriceBreakdown,
  type PriceBreakdownItem,
} from "./detail-price-breakdown";

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

let host: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

function render(item: PriceBreakdownItem, exchangeRate?: number) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <DetailPriceBreakdown item={item} exchangeRate={exchangeRate} />,
    ),
  );
  return host;
}

function row(name: string) {
  return host!.querySelector(`[data-row="${name}"]`);
}

function base(overrides: Partial<PriceBreakdownItem> = {}): PriceBreakdownItem {
  return {
    priceCurrent: 10_000,
    shippingFee: 500,
    quantityEst: 4,
    listingType: "direct",
    source: { key: "mercari" },
    ...overrides,
  };
}

describe("detail price breakdown", () => {
  it("renders every row with aligned values for a fully known listing", () => {
    render(base(), 0.0425);
    expect(row("list-price")?.textContent).toContain("标价");
    expect(row("list-price")?.textContent).toContain("¥10,000");
    expect(row("shipping")?.textContent).toContain("¥500");
    expect(row("quantity")?.textContent).toContain("4 件");
    // (10,000 + 500) / 4 = 2,625
    expect(row("unit-price")?.textContent).toContain("¥2,625");
    expect(row("total")?.textContent).toContain("¥10,500");
    expect(row("total")?.textContent).not.toContain("未含邮费");
    // 10,500 * 0.0425 = 446.25
    expect(row("total-cny")?.textContent).toContain("446.25");
    expect(row("discount-target")).toBeNull();
  });

  it("states free shipping as 包邮 and keeps the total equal to the list price", () => {
    render(base({ shippingFee: 0, quantityEst: 2 }), 0.0425);
    expect(row("shipping")?.textContent).toContain("包邮");
    expect(row("total")?.textContent).toContain("¥10,000");
    expect(row("unit-price")?.textContent).toContain("¥5,000");
  });

  it("never presents an unknown fee as a known total", () => {
    render(base({ shippingFee: null }));
    expect(row("shipping")?.textContent).toContain("平台未提供");
    expect(row("shipping")?.textContent).not.toContain("¥0");
    expect(row("total")?.textContent).toContain("未含邮费");
    expect(row("unit-price")?.textContent).toContain("下限");
  });

  it("marks auction totals as current values", () => {
    render(base({ listingType: "auction", shippingFee: null }));
    expect(row("total")?.textContent).toContain("当前价下限");
    expect(row("unit-price")?.textContent).toContain("当前");
  });

  it("carries the Yahoo discount target with its CNY estimate", () => {
    render(base({ source: { key: "yahoo_fleamarket" } }), 0.0425);
    const discount = row("discount-target");
    expect(discount).not.toBeNull();
    expect(discount?.textContent).toContain("最低降价测算");
    // ceil(10,000 * 0.8) = 8,000; 8,000 * 0.0425 = 340
    expect(discount?.textContent).toContain("¥8,000");
    expect(discount?.textContent).toContain("340");
  });

  it("states a missing rate and missing quantity instead of inventing figures", () => {
    render(base({ quantityEst: null }));
    expect(row("quantity")?.textContent).toContain("待确认");
    expect(row("unit-price")?.textContent).toContain("待确认");
    expect(row("total-cny")?.textContent).toContain("暂无汇率");
  });
});
