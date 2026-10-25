// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PurchaseRegistrationForm,
  type PurchaseRegistrationItem,
} from "./purchase-registration-form";

const API_BASE = "https://api.example.test";

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

describe("PurchaseRegistrationForm", () => {
  let host: HTMLDivElement;
  let overlay: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let onSaved: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    overlay = document.createElement("div");
    overlay.id = "shell-overlay-root";
    document.body.append(host, overlay);
    root = createRoot(host);
    onSaved = vi.fn();
    onClose = vi.fn();
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        bundle: { id: "bundle-1", purchases: [{ itemId: "item-1" }] },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    overlay.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderForm(items: PurchaseRegistrationItem[], extra: object = {}) {
    act(() =>
      root.render(
        <PurchaseRegistrationForm
          apiBaseUrl={API_BASE}
          items={items}
          onClose={onClose}
          onSaved={onSaved}
          {...extra}
        />,
      ),
    );
  }

  function submitButton() {
    const button = Array.from(
      overlay.querySelectorAll("button"),
    ).find((entry) => entry.textContent === "确认登记");
    if (!button) throw new Error("确认登记按钮不存在");
    return button as HTMLButtonElement;
  }

  it("prefills a single item from its listing total and recognised quantity", () => {
    renderForm([
      {
        itemId: "item-1",
        title: "腰带 A",
        amountYen: 12800,
        quantityEst: 2,
      },
    ]);

    expect(overlay.textContent).toContain("腰带 A");
    const amount = overlay.querySelector<HTMLInputElement>(
      '[data-testid="purchase-registration-amount"]',
    );
    expect(amount?.value).toBe("12800");
    const quantity = overlay.querySelector<HTMLInputElement>(
      'input[aria-label="商品数量 腰带 A"]',
    );
    expect(quantity?.value).toBe("2");
    const date = overlay.querySelector<HTMLInputElement>('input[type="date"]');
    expect(date?.value).toBe(new Date().toISOString().slice(0, 10));
  });

  it("prefills amounts from a link analysis result", () => {
    renderForm(
      [{ itemId: "item-1", title: "腰带 A", amountYen: 15000, quantityEst: 1 }],
      { initialAmounts: { "item-1": 9800 }, initialTotal: 9800 },
    );

    const amount = overlay.querySelector<HTMLInputElement>(
      '[data-testid="purchase-registration-amount"]',
    );
    expect(amount?.value).toBe("9800");
  });

  it("submits only to the bundle endpoint with the unified field set", async () => {
    renderForm([
      {
        itemId: "item-1",
        title: "腰带 A",
        amountYen: 12800,
        quantityEst: 2,
      },
    ]);
    const amount = overlay.querySelector<HTMLInputElement>(
      '[data-testid="purchase-registration-amount"]',
    )!;
    setInputValue(amount, "11900");
    const quantity = overlay.querySelector<HTMLInputElement>(
      'input[aria-label="商品数量 腰带 A"]',
    )!;
    setInputValue(quantity, "3");

    await act(async () => {
      submitButton().click();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/items/purchases/bundles`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.pricingMode).toBe("per_item");
    expect(body.members).toEqual([
      { itemId: "item-1", quantity: 3, amountYen: 11900 },
    ]);
    expect(body.totalPurchaseAmountYen).toBe(11900);
    expect(typeof body.purchasedAt).toBe("string");
    expect(body.actor).toBe("shared-user");
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: "bundle-1" }),
    );
  });

  it("blank mode registers an off-catalog buy without an item id", async () => {
    renderForm([]);
    const title = overlay.querySelector<HTMLInputElement>(
      '[data-testid="purchase-registration-offcatalog-title"]',
    )!;
    setInputValue(title, "站外买的腰带");
    const amount = overlay.querySelector<HTMLInputElement>(
      '[data-testid="purchase-registration-amount"]',
    )!;
    setInputValue(amount, "9800");

    await act(async () => {
      submitButton().click();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      members: Record<string, unknown>[];
    };
    expect(body.members).toEqual([
      { title: "站外买的腰带", quantity: 1, amountYen: 9800 },
    ]);
    expect(body.members[0]).not.toHaveProperty("itemId");
  });

  it("keeps bundle pricing mode and submits one total for several items", async () => {
    renderForm([
      { itemId: "item-1", title: "腰带 A", amountYen: 5000, quantityEst: 1 },
      { itemId: "item-2", title: "腰带 B", amountYen: 7000, quantityEst: 1 },
    ]);

    expect(overlay.textContent).toContain("打包总价");
    const total = overlay.querySelector<HTMLInputElement>(
      'input[aria-label="购买计价方式"]',
    );
    expect(total).toBeNull();
    await act(async () => {
      submitButton().click();
      await Promise.resolve();
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.pricingMode).toBe("bundle_total");
    expect(body.totalPurchaseAmountYen).toBe(12000);
    expect(body.members).toEqual([
      { itemId: "item-1", quantity: 1 },
      { itemId: "item-2", quantity: 1 },
    ]);
  });
});
