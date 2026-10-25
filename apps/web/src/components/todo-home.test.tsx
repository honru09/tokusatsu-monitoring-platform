// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TodoHome } from "./todo-home";

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response;
}

const sharedItem = {
  id: "item-1",
  titleRaw: "仮面ライダー フィギュア",
  titleZh: "假面骑士手办",
  priceCurrent: 5_000,
  source: { key: "mercari", displayName: "Mercari" },
  images: [{ url: "https://example.com/1.jpg", position: 0 }],
  copiedAt: null,
};

describe("TodoHome", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const fetchMock = vi.fn();

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  function stubEndpoints(overrides: Record<string, unknown> = {}) {
    const payloads: Record<string, unknown> = {
      "share-rounds": {
        rounds: [
          {
            id: "round-1",
            createdAt: "2026-10-24T00:00:00.000Z",
            createdBy: { name: "搭档" },
            items: [{ itemId: "item-1", copiedAt: null, item: sharedItem }],
          },
        ],
      },
      messages: { messages: [] },
      negotiations: {
        cases: [
          {
            id: "case-1",
            status: "in_progress",
            statusChangedAt: "2026-10-23T00:00:00.000Z",
            item: { ...sharedItem, id: "item-2" },
          },
        ],
      },
      "inventory-orders": { orders: [], total: 0 },
      "ai/resources": {
        remainingLocalBudget: 190_000,
        dailyTokenLimit: 200_000,
        expiresAt: "2027-01-01T00:00:00.000Z",
      },
      ...overrides,
    };
    fetchMock.mockImplementation((url: string) => {
      const key = Object.keys(payloads).find((candidate) =>
        String(url).includes(candidate),
      );
      return Promise.resolve(response(key ? payloads[key] : {}));
    });
  }

  async function render() {
    const onPendingCountChange = vi.fn();
    await act(async () => {
      root.render(
        <TodoHome
          apiBaseUrl="http://api.test"
          accountId="manager-1"
          purchasedItemIds={new Set()}
          dislikedItemIds={new Set()}
          purchaseAnalyses={[]}
          failedJobs24h={0}
          onNavigate={() => undefined}
          onPendingCountChange={onPendingCountChange}
        />,
      );
    });
    return onPendingCountChange;
  }

  it("renders the decision queues with counts and reports the pending total", async () => {
    stubEndpoints();
    const onPendingCountChange = await render();
    expect(host.textContent).toContain("待评估");
    expect(host.textContent).toContain("假面骑士手办");
    expect(host.textContent).toContain("砍价中");
    expect(host.textContent).toContain("2 件待处理");
    expect(onPendingCountChange).toHaveBeenCalledWith(2);
  });

  it("shows the header spot and the brand scene above the finance panel", async () => {
    stubEndpoints();
    await render();
    const spot = host.querySelector('[data-workspace-header-art="todo"] img');
    expect(spot?.getAttribute("src")).toBe("/illustrations/header-todo.webp");
    const brand = host.querySelector<HTMLImageElement>(
      'img[src="/illustrations/brand-home.webp"]',
    );
    expect(brand).not.toBeNull();
    expect(brand?.getAttribute("width")).toBe("1280");
    expect(brand?.getAttribute("height")).toBe("480");
    expect(brand?.getAttribute("loading")).toBe("lazy");
    // The scene lives in the header zone, outside the finance panel.
    expect(brand?.closest('[aria-label="财务汇总"]')).toBeNull();
  });

  it("collapses to a single all-clear line when every queue is empty", async () => {
    stubEndpoints({
      "share-rounds": { rounds: [] },
      negotiations: { cases: [] },
    });
    await render();
    expect(host.textContent).toContain("全部处理完");
    expect(host.textContent).not.toContain("待评估");
  });

  it("shows the packable reminder only once stock can fill a parcel, and opens shipping from it", async () => {
    stubEndpoints({
      "inventory-orders": {
        orders: [
          {
            id: "order-1",
            orderNumber: "PO-1",
            name: "腰带库存",
            status: "in_stock",
            remainingQuantity: 2,
            purchasedAt: "2026-10-01T00:00:00.000Z",
            imageUrl: null,
            averageCost: 23_000,
          },
        ],
        total: 1,
      },
    });
    const onNavigate = vi.fn();
    const onOpenShipping = vi.fn();
    await act(async () => {
      root.render(
        <TodoHome
          apiBaseUrl="http://api.test"
          accountId="manager-1"
          purchasedItemIds={new Set()}
          dislikedItemIds={new Set()}
          purchaseAnalyses={[]}
          failedJobs24h={0}
          onNavigate={onNavigate}
          onOpenShipping={onOpenShipping}
          exchangeRate={0.0425}
          onPendingCountChange={() => undefined}
        />,
      );
    });
    // ¥23,000 × 2 ≈ 1,955 CNY — inside the 1,800–2,000 target band.
    expect(host.textContent).toContain("可组包提醒");
    const row = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("库存够组一包了"),
    );
    expect(row).toBeDefined();
    await act(async () => {
      row?.click();
    });
    expect(onOpenShipping).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("shows a retryable error instead of fake-empty queues when collaboration sync fails", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("collaboration"))
        return Promise.resolve(response({ message: "boom" }, 503));
      if (String(url).includes("inventory-orders"))
        return Promise.resolve(response({ orders: [], total: 0 }));
      return Promise.resolve(
        response({
          remainingLocalBudget: 190_000,
          dailyTokenLimit: 200_000,
          expiresAt: null,
        }),
      );
    });
    await render();
    expect(host.querySelector('[data-testid="load-error"]')).not.toBeNull();
    expect(
      host.querySelector('[data-testid="retry-todo-collaboration"]'),
    ).not.toBeNull();
    expect(host.textContent).not.toContain("全部处理完");
  });
});
