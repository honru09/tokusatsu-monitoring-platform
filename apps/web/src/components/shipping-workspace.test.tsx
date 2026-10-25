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
  purchaseCost: 1400,
  initialQuantity: 2,
  remainingQuantity: 2,
  soldQuantity: 0,
  totalSales: 0,
  status: "in_stock",
  statusLabel: "在库",
  averageCost: 700,
  realizedProfit: 0,
  recoveryPercent: null,
  finalOrderProfit: null,
  purchasedAt: "2026-01-01T00:00:00.000Z",
  imageUrl: null,
  note: null,
  ...overrides,
});

describe("ShippingWorkspace", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let postBody: unknown;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    postBody = undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const json = (payload: unknown) =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        if (url.includes("/inventory-orders")) {
          return json({
            orders: [
              order({}),
              order({
                id: "o2",
                orderNumber: "PO-2",
                name: "商品二",
                purchaseCost: 1200,
                initialQuantity: 1,
                remainingQuantity: 1,
                averageCost: 1200,
                purchasedAt: "2026-01-02T00:00:00.000Z",
              }),
              order({
                id: "o3",
                orderNumber: "PO-3",
                name: "贵重商品",
                purchaseCost: 2600,
                initialQuantity: 1,
                remainingQuantity: 1,
                averageCost: 2600,
                purchasedAt: "2026-01-03T00:00:00.000Z",
              }),
            ],
            total: 3,
          });
        }
        if (url.includes("/shipments") && init?.method === "POST") {
          postBody = JSON.parse(String(init.body));
          return json({
            shipment: {
              id: "s1",
              totalDeclared: 1900,
              createdById: "admin-1",
              createdByName: "王",
              createdAt: "2026-02-01T00:00:00.000Z",
              lines: [],
            },
          });
        }
        if (url.includes("/shipments")) return json({ shipments: [] });
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const render = async () => {
    await act(async () => {
      root.render(
        <ShippingWorkspace apiBaseUrl="/backend" accountId="admin-1" />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it("auto-packs toward the cap and flags over-cap stock", async () => {
    await render();
    expect(host.textContent).toContain("可用库存");
    expect(host.textContent).toContain("超限");
    expect(host.textContent).toContain("贵重商品");

    const auto = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "自动组包",
    )!;
    await act(async () => {
      auto.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // 700x1 + 1200x1 = 1900, right at the top of the target band.
    expect(host.textContent).toContain("申报合计");
    expect(host.textContent).toContain("¥1,900");
    expect(host.textContent).toContain("已达标");

    const confirm = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "确认发货",
    )!;
    await act(async () => {
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(postBody).toMatchObject({
      accountId: "admin-1",
      lines: [
        { inventoryOrderId: "o1", quantity: 1, unitDeclaredYen: 700 },
        { inventoryOrderId: "o2", quantity: 1, unitDeclaredYen: 1200 },
      ],
    });
    expect(host.textContent).toContain("已发货");
  });
});
