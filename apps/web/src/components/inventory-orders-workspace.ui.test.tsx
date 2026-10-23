// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InventoryOrdersWorkspace,
  clearanceMarginPercent,
  previewCreateAverageCost,
  previewSaleCost,
  previewSaleProfit,
} from "./inventory-orders-workspace";

const order = {
  id: "inv-1",
  orderNumber: "ORD-ABCDEF12",
  name: "DX 腰带批次",
  platform: "Mercari",
  purchaseCost: 10_000,
  initialQuantity: 10,
  remainingQuantity: 6,
  soldQuantity: 4,
  totalSales: 5_000,
  status: "partially_sold" as const,
  statusLabel: "部分售出",
  averageCost: 1_000,
  realizedProfit: 1_000,
  recoveryPercent: 50,
  finalOrderProfit: null,
  finalOrderMarginPercent: null,
  purchasedAt: "2026-09-01T00:00:00.000Z",
  imageUrl: null,
  note: null,
};

const soldOutOrder = {
  ...order,
  id: "inv-2",
  orderNumber: "ORD-SOLD0001",
  name: "清仓批次",
  remainingQuantity: 0,
  soldQuantity: 10,
  totalSales: 12_000,
  status: "sold_out" as const,
  statusLabel: "已售完",
  realizedProfit: 2_000,
  recoveryPercent: 120,
  finalOrderProfit: 2_000,
  finalOrderMarginPercent: 20,
};

describe("previewSaleCost / previewSaleProfit / previewCreateAverageCost", () => {
  it("mirrors average-cost rounding for sell preview", () => {
    expect(previewSaleCost(1_000, 1)).toBe(1_000);
    expect(previewSaleCost(1_285.71, 3)).toBe(3_857);
    expect(previewSaleProfit(7_000, 3_857)).toBe(3_143);
    expect(previewSaleCost(null, 1)).toBeNull();
    expect(previewSaleProfit(100, null)).toBeNull();
  });

  it("previews create-form average cost", () => {
    expect(previewCreateAverageCost("10000", "10")).toBe(1_000);
    expect(previewCreateAverageCost("5000", "3")).toBeCloseTo(5_000 / 3);
    expect(previewCreateAverageCost("", "10")).toBeNull();
    expect(previewCreateAverageCost("100", "0")).toBeNull();
  });

  it("derives clearance margin when API omits the field", () => {
    expect(
      clearanceMarginPercent({
        status: "sold_out",
        purchaseCost: 10_000,
        finalOrderProfit: 2_000,
        finalOrderMarginPercent: null,
      }),
    ).toBe(20);
    expect(
      clearanceMarginPercent({
        status: "partially_sold",
        purchaseCost: 10_000,
        finalOrderProfit: null,
        finalOrderMarginPercent: null,
      }),
    ).toBeNull();
  });
});

describe("InventoryOrdersWorkspace", () => {
  let shell: HTMLElement;
  let host: HTMLDivElement;
  let overlay: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    shell = document.createElement("main");
    shell.className = "ios-shell procurement-shell";
    host = document.createElement("div");
    overlay = document.createElement("div");
    overlay.id = "shell-overlay-root";
    overlay.className = "shell-overlay-root";
    shell.append(host, overlay);
    document.body.append(shell);
    root = createRoot(host);
    fetchMock = vi.fn(() =>
      Promise.resolve(
        Response.json({
          orders: [order],
          total: 1,
          totals: { purchaseCostYen: 10_000, totalSalesYen: 5_000 },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    act(() => root.unmount());
    shell.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function portalRoot() {
    return overlay;
  }

  async function renderWorkspace() {
    await act(async () => {
      root.render(
        <InventoryOrdersWorkspace apiBaseUrl="http://localhost:3001" />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("renders order card with recovery amount, stock, and sell CTA", async () => {
    await renderWorkspace();

    expect(host.querySelector("h2")?.textContent).toContain("库存订单 1 批");
    expect(host.textContent).toContain("ORD-ABCDEF12");
    expect(host.textContent).toContain("DX 腰带批次");
    expect(host.textContent).toContain("剩余 6/10");
    expect(host.textContent).toContain("已售 4/10");
    expect(host.textContent).toContain("已回款");
    expect(host.textContent).toContain("¥5,000");
    expect(host.textContent).toContain("50%");
    expect(host.textContent).toContain("+¥1,000");
    expect(host.querySelector('[aria-label="已回款进度"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="已售进度"]')).toBeTruthy();
    const sell = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "卖出",
    );
    expect(sell).toBeTruthy();
    expect(sell?.disabled).toBe(false);
  });

  it("retains the order controls and stable business class hooks", async () => {
    await renderWorkspace();

    const root = host.querySelector(".inventory-orders-workspace");
    expect(root).toBeTruthy();
    expect(host.querySelector(".inventory-order-toolbar")).toBeTruthy();
    expect(host.querySelector(".inventory-order-status-chips")).toBeTruthy();
    expect(host.querySelector(".inventory-order-search")).toBeTruthy();
    const card = host.querySelector(".inventory-order-card");
    expect(card).toBeTruthy();
    expect(card?.className).not.toMatch(/\bbg-white\b/);
    expect(card?.className).not.toMatch(/\bring-1\b/);
    expect(host.querySelector(".io-btn-sell")).toBeTruthy();
    expect(host.querySelector(".io-btn-primary")).toBeTruthy();
  });

  it("uses product name as card title — never the note/remark", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        Response.json({
          orders: [
            {
              ...order,
              name: "DX 变身腰带",
              note: "缺配件，需补发",
            },
          ],
          total: 1,
          totals: { purchaseCostYen: 10_000, totalSalesYen: 5_000 },
        }),
      ),
    );

    await renderWorkspace();

    const title = host.querySelector(
      '[data-testid="inventory-order-card-name"]',
    );
    expect(title?.textContent).toBe("DX 变身腰带");
    expect(title?.textContent).not.toContain("缺配件");
    // Note stays off the card surface; only appears in detail.
    expect(host.textContent).not.toContain("缺配件，需补发");

    const openDetail = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("DX 变身腰带"),
    );
    expect(openDetail).toBeTruthy();

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        Response.json({
          order: {
            ...order,
            name: "DX 变身腰带",
            note: "缺配件，需补发",
            salesRecords: [],
            adjustments: [],
          },
        }),
      ),
    );

    await act(async () => {
      openDetail?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const note = portalRoot().querySelector(
      '[data-testid="inventory-order-detail-note"]',
    );
    expect(note?.textContent).toContain("缺配件，需补发");
    expect(
      portalRoot().querySelector("#inventory-order-detail-title")?.textContent,
    ).toBe("DX 变身腰带");
  });

  it("filters by status chips", async () => {
    await renderWorkspace();

    const chips = host.querySelector('[aria-label="按状态筛选"]');
    expect(chips).toBeTruthy();
    expect(chips?.textContent).toContain("在库");
    expect(chips?.textContent).toContain("部分售出");
    expect(chips?.textContent).toContain("已售完");

    const soldOutChip = Array.from(host.querySelectorAll('[role="tab"]')).find(
      (button) => button.textContent === "已售完",
    );
    expect(soldOutChip).toBeTruthy();

    await act(async () => {
      soldOutChip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const filteredCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("status=sold_out"),
    );
    expect(filteredCall).toBeTruthy();
  });

  it("shows clearance final profit + margin on sold-out cards", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        Response.json({
          orders: [soldOutOrder],
          total: 1,
          totals: { purchaseCostYen: 10_000, totalSalesYen: 12_000 },
        }),
      ),
    );

    await renderWorkspace();

    const final = host.querySelector('[data-testid="card-final-profit"]');
    expect(final).toBeTruthy();
    expect(final?.textContent).toContain("清仓利润");
    expect(final?.textContent).toContain("+¥2,000");
    expect(final?.textContent).toContain("20%");
    expect(host.textContent).toContain("已实现利润");
  });

  it("opens create sheet with average-cost preview", async () => {
    await renderWorkspace();

    const createBtn = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "新建订单",
    );
    expect(createBtn).toBeTruthy();

    await act(async () => {
      createBtn?.click();
    });

    expect(portalRoot().textContent).toContain("新建库存订单");
    expect(portalRoot().textContent).toContain("商品名称");
    expect(portalRoot().textContent).toContain("ORD-");
    expect(portalRoot().textContent).toContain("购买日期");
    expect(portalRoot().textContent).toContain("图片链接");
    expect(
      portalRoot().querySelector('[data-testid="inventory-order-create-name"]'),
    ).toBeTruthy();
    const noteInput = portalRoot().querySelector(
      '[data-testid="inventory-order-create-note"]',
    ) as HTMLInputElement | null;
    expect(noteInput).toBeTruthy();
    expect(noteInput?.placeholder).toContain("不作为标题");

    const costInput = portalRoot().querySelector(
      'input[placeholder="0"]',
    ) as HTMLInputElement | null;
    const qtyInput = Array.from(
      portalRoot().querySelectorAll('input[type="number"]'),
    ).find(
      (input) =>
        (input as HTMLInputElement).min === "1" &&
        (input as HTMLInputElement).value === "1",
    ) as HTMLInputElement | undefined;
    expect(costInput).toBeTruthy();
    expect(qtyInput).toBeTruthy();

    const setInputValue = (el: HTMLInputElement, value: string) => {
      const proto = Object.getPrototypeOf(el) as HTMLInputElement;
      const protoSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      const ownSetter = Object.getOwnPropertyDescriptor(el, "value")?.set;
      if (ownSetter && ownSetter !== protoSetter) {
        protoSetter?.call(el, value);
      } else {
        ownSetter?.call(el, value);
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };

    await act(async () => {
      if (costInput) setInputValue(costInput, "10000");
      if (qtyInput) setInputValue(qtyInput, "10");
    });

    const preview = portalRoot().querySelector(
      '[data-testid="create-avg-preview"]',
    );
    expect(preview).toBeTruthy();
    expect(preview?.textContent).toContain("均价成本");
    expect(preview?.textContent).toContain("¥1,000");
  });

  it("opens sell dialog with live cost/profit preview", async () => {
    await renderWorkspace();

    const sell = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "卖出",
    );
    expect(sell).toBeTruthy();

    await act(async () => {
      sell?.click();
    });

    expect(portalRoot().textContent).toContain("成交价（日元合计）");
    expect(portalRoot().textContent).toContain("均价");
    expect(
      portalRoot().querySelector('[data-testid="inventory-order-sell-name"]')
        ?.textContent,
    ).toBe("DX 腰带批次");
    expect(
      portalRoot().querySelector('[data-testid="sell-preview"]'),
    ).toBeNull();

    const priceInput = portalRoot().querySelector(
      'input[placeholder="这一笔的总成交价"]',
    ) as HTMLInputElement | null;
    expect(priceInput).toBeTruthy();

    await act(async () => {
      if (!priceInput) return;
      const proto = Object.getPrototypeOf(priceInput) as HTMLInputElement;
      const protoSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      const ownSetter = Object.getOwnPropertyDescriptor(
        priceInput,
        "value",
      )?.set;
      if (ownSetter && ownSetter !== protoSetter) {
        protoSetter?.call(priceInput, "2800");
      } else {
        ownSetter?.call(priceInput, "2800");
      }
      priceInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const preview = portalRoot().querySelector('[data-testid="sell-preview"]');
    expect(preview).toBeTruthy();
    expect(preview?.textContent).toContain("本次成本");
    expect(preview?.textContent).toContain("¥1,000");
    expect(preview?.textContent).toContain("本次利润");
    expect(preview?.textContent).toContain("+¥1,800");
  });

  it("opens adjust sheet with product name — not note", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        Response.json({
          orders: [
            {
              ...order,
              name: "DX 变身腰带",
              note: "缺配件，需补发",
            },
          ],
          total: 1,
          totals: { purchaseCostYen: 10_000, totalSalesYen: 5_000 },
        }),
      ),
    );

    await renderWorkspace();

    const openDetail = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("DX 变身腰带"),
    );
    expect(openDetail).toBeTruthy();

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        Response.json({
          order: {
            ...order,
            name: "DX 变身腰带",
            note: "缺配件，需补发",
            salesRecords: [
              {
                id: "sale-1",
                quantity: 1,
                salePrice: 2800,
                costOfSale: 1000,
                profit: 1800,
                note: "闲鱼买家 A",
                soldAt: "2026-09-02T00:00:00.000Z",
              },
            ],
            adjustments: [],
          },
        }),
      ),
    );

    await act(async () => {
      openDetail?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      portalRoot().querySelector('[data-testid="inventory-order-detail-name"]')
        ?.textContent,
    ).toBe("DX 变身腰带");
    expect(
      portalRoot().querySelector('[data-testid="inventory-order-sale-note"]')
        ?.textContent,
    ).toContain("闲鱼买家 A");

    const adjust = Array.from(portalRoot().querySelectorAll("button")).find(
      (button) => button.textContent === "调整库存",
    );
    expect(adjust).toBeTruthy();

    await act(async () => {
      adjust?.click();
    });

    expect(portalRoot().textContent).toContain("调整库存");
    expect(
      portalRoot().querySelector('[data-testid="inventory-order-adjust-name"]')
        ?.textContent,
    ).toBe("DX 变身腰带");
    expect(
      portalRoot().querySelector('[data-testid="inventory-order-adjust-name"]')
        ?.textContent,
    ).not.toContain("缺配件");
    expect(portalRoot().textContent).toContain("破损");
    expect(portalRoot().textContent).toContain("赠送");
  });

  it("portals create sheet into the shell overlay root, not document.body", async () => {
    await renderWorkspace();

    const createBtn = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "新建订单",
    );
    await act(async () => {
      createBtn?.click();
    });

    const backdrop = portalRoot().querySelector(".inventory-order-backdrop");
    expect(backdrop).toBeTruthy();
    expect(portalRoot().contains(backdrop)).toBe(true);
    expect(
      document.body.querySelector(":scope > .inventory-order-backdrop"),
    ).toBeNull();
    expect(backdrop?.className).toMatch(/\babsolute\b/);
    expect(backdrop?.className).not.toMatch(/\bfixed\b/);
    // Dock via CSS absolute bottom sheet — not grid items-end (that left-aligns
    // under .modal-panel max-width on wide shells).
    expect(backdrop?.className).not.toMatch(/\bgrid\b/);
    expect(backdrop?.className).not.toMatch(/items-end/);
    expect(backdrop?.className).not.toMatch(/place-items-end/);

    const sheet = portalRoot().querySelector(".inventory-order-sheet");
    expect(sheet).toBeTruthy();
    expect(sheet?.className).toMatch(/\binventory-order-sheet\b/);
    expect(sheet?.className).toMatch(/\bmodal-panel\b/);
    expect(portalRoot().contains(sheet)).toBe(true);
  });

  it("keeps order list as a single-column phone layout class", async () => {
    await renderWorkspace();
    const list = host.querySelector(".inventory-order-list");
    expect(list).toBeTruthy();
    expect(host.querySelector(".inventory-orders-workspace")).toBeTruthy();
  });

  it("paginates beyond 50 orders and resets the page when filtering", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const secondPage = url.searchParams.get("page") === "2";
      return Promise.resolve(
        Response.json({
          orders: [
            { ...order, name: secondPage ? "第二页批次" : "第一页批次" },
          ],
          total: 51,
        }),
      );
    });
    await renderWorkspace();
    const next = host.querySelector<HTMLButtonElement>(
      '[aria-label="下一页库存订单"]',
    );
    expect(next).not.toBeNull();
    await act(async () => {
      next!.click();
    });
    expect(host.textContent).toContain("第二页批次");
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("page=2");
    const status = host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1];
    await act(async () => {
      status!.click();
    });
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("page=1");
    expect(host.textContent).toContain("第一页批次");
  });
});
