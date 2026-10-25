// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShippingWorkspace } from "./shipping-workspace";
import type { InventoryOrderCard } from "./inventory-orders-workspace";

const order = (
  overrides: Partial<InventoryOrderCard>,
): InventoryOrderCard => ({
  id: "o1",
  orderNumber: "PO-1",
  name: "商品一",
  platform: "mercari",
  purchaseCost: 30000,
  initialQuantity: 2,
  remainingQuantity: 2,
  soldQuantity: 0,
  totalSales: 0,
  status: "in_stock",
  statusLabel: "在库",
  averageCost: 15000,
  realizedProfit: 0,
  recoveryPercent: null,
  finalOrderProfit: null,
  purchasedAt: "2026-01-01T00:00:00.000Z",
  imageUrl: null,
  note: null,
  ...overrides,
});

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("ShippingWorkspace", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let postBody: unknown;
  let rateFails: boolean;
  let reloadFails: boolean;
  let posted: boolean;

  const shipmentPayload = {
    id: "s1",
    totalDeclared: 43500,
    totalDeclaredCny: 1848,
    exchangeRate: 0.0425,
    createdById: "admin-1",
    createdByName: "王",
    createdAt: "2026-02-01T00:00:00.000Z",
    lines: [
      {
        id: "sl1",
        inventoryOrderId: "o1",
        itemName: "商品一",
        quantity: 2,
        unitDeclaredYen: 15000,
        lineTotalYen: 30000,
      },
    ],
  };

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    postBody = undefined;
    rateFails = false;
    reloadFails = false;
    posted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const json = (payload: unknown, status = 200) =>
          new Response(JSON.stringify(payload), {
            status,
            headers: { "content-type": "application/json" },
          });
        if (url.includes("/exchange-rate")) {
          if (rateFails)
            return json({ message: "rate down" }, 503);
          return json({
            rate: 0.0425,
            source: "test",
            referenceDate: "2026-10-24",
            fetchedAt: "2026-10-25T06:30:00.000Z",
            stale: false,
          });
        }
        if (url.includes("/inventory-orders")) {
          if (reloadFails && posted)
            return json({ message: "boom" }, 500);
          return json({
            orders: [
              order({}),
              order({
                id: "o2",
                orderNumber: "PO-2",
                name: "商品二",
                purchaseCost: 13500,
                initialQuantity: 1,
                remainingQuantity: 1,
                averageCost: 13500,
                purchasedAt: "2026-01-02T00:00:00.000Z",
              }),
              order({
                id: "o3",
                orderNumber: "PO-3",
                name: "贵重商品",
                purchaseCost: 50000,
                initialQuantity: 1,
                remainingQuantity: 1,
                averageCost: 50000,
                purchasedAt: "2026-01-03T00:00:00.000Z",
              }),
            ],
            total: 3,
          });
        }
        if (url.includes("/shipments") && init?.method === "POST") {
          postBody = JSON.parse(String(init.body));
          posted = true;
          return json({ shipment: shipmentPayload });
        }
        if (url.includes("/shipments"))
          return json({ shipments: posted ? [shipmentPayload] : [] });
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const render = async () => {
    await act(async () => {
      root.render(
        <ShippingWorkspace apiBaseUrl="/backend" accountId="admin-1" />,
      );
    });
    await flush();
    await flush();
  };

  const buttonByText = (text: string) =>
    [...host.querySelectorAll("button")].find(
      (button) => button.textContent === text,
    )!;

  const clickAutoPack = async () => {
    await act(async () => {
      buttonByText("自动组包").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();
    await flush();
  };

  it("auto-packs into the CNY band and posts the rate and CNY total", async () => {
    await render();
    expect(host.textContent).toContain("可用库存");
    expect(host.textContent).toContain("超限");
    expect(host.textContent).toContain("贵重商品");
    // Live rate is shown next to the CNY cap control.
    expect(host.textContent).toContain("0.0425");
    expect(host.textContent).toContain("汇率");
    const capInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="申报上限"]',
    )!;
    expect(capInput.disabled).toBe(false);
    expect(capInput.value).toBe("2000");

    await clickAutoPack();
    // 15000x2 + 13500x1 = ¥43,500 -> 1,848 CNY, inside the band.
    expect(host.textContent).toContain("申报合计");
    expect(host.textContent).toContain("¥43,500");
    expect(host.textContent).toContain("1,848 元");
    expect(host.textContent).toContain("已达标");

    await act(async () => {
      buttonByText("确认发货").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();
    await flush();
    expect(postBody).toMatchObject({
      accountId: "admin-1",
      exchangeRate: 0.0425,
      totalDeclaredCny: 1848,
      lines: [
        { inventoryOrderId: "o1", quantity: 2, unitDeclaredYen: 15000 },
        { inventoryOrderId: "o2", quantity: 1, unitDeclaredYen: 13500 },
      ],
    });
    expect(host.textContent).toContain("已发货");
    expect(host.textContent).toContain("≈1,848 元");
    // History row carries the recorded CNY total too.
    expect(host.textContent).toContain("≈ 1,848 元");
  });

  it("disables the cap and packing when the rate cannot be loaded", async () => {
    rateFails = true;
    await render();
    expect(host.textContent).toContain("汇率加载失败");
    const capInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="申报上限"]',
    )!;
    expect(capInput.disabled).toBe(true);
    expect(buttonByText("自动组包").disabled).toBe(true);
    // No made-up conversion is shown.
    expect(host.textContent).not.toContain("0.0425");
  });

  it("keeps the line while the quantity input is empty, until blur", async () => {
    await render();
    await clickAutoPack();
    const quantity = host.querySelector<HTMLInputElement>(
      'input[aria-label="数量：商品一"]',
    )!;
    expect(quantity.value).toBe("2");

    setInputValue(quantity, "");
    // Clearing the field mid-edit must not delete the line.
    expect(
      host.querySelector('input[aria-label="数量：商品一"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain("¥43,500");

    await act(async () => {
      quantity.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await flush();
    // Empty on blur reverts to the committed quantity.
    const reverted = host.querySelector<HTMLInputElement>(
      'input[aria-label="数量：商品一"]',
    )!;
    expect(reverted.value).toBe("2");

    // An explicit 0 on blur does remove the line.
    setInputValue(reverted, "0");
    await act(async () => {
      reverted.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await flush();
    expect(host.querySelector('input[aria-label="数量：商品一"]')).toBeNull();
  });

  it("keeps the receipt when the post-confirm refresh fails", async () => {
    reloadFails = true;
    await render();
    await clickAutoPack();
    await act(async () => {
      buttonByText("确认发货").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();
    await flush();
    expect(postBody).toMatchObject({ totalDeclaredCny: 1848 });
    // Receipt survives, the failure is noted in the receipt area, and
    // the composer is not replaced by a full load error.
    expect(host.textContent).toContain("已发货");
    expect(host.textContent).toContain("库存刷新失败");
    expect(host.textContent).toContain("组包");
    expect(host.querySelector('[data-testid="load-error"]')).toBeNull();
  });
});
