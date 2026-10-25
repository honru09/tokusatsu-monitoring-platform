// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PurchaseRecordsWorkspace,
  type PurchaseLinkJobLike,
} from "./purchase-records-workspace";

const completedJob: PurchaseLinkJobLike = {
  jobId: "job-1",
  url: "https://example.com/item/1",
  state: "completed",
  progress: 100,
  item: { titleZh: "腰带", titleRaw: "ベルト" },
  suggestedAmountYen: 12_800,
  suggestedAmountSource: "actual",
};

const failedJob: PurchaseLinkJobLike = {
  jobId: "job-2",
  url: "https://example.com/item/2",
  state: "failed",
  progress: 100,
  item: null,
  failedReason: "boom",
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

function renderWorkspace(overrides: Record<string, unknown> = {}) {
  const props = {
    purchaseLinkInput: "https://example.com/item/1",
    onPurchaseLinkInputChange: vi.fn(),
    purchaseLinkUrlCount: 1,
    purchaseLinkSubmitting: false,
    purchaseLinkMessage: "",
    purchaseLinkJobs: [completedJob, failedJob],
    completedPurchaseJobCount: 1,
    selectedPurchaseJobIds: [] as string[],
    onTogglePurchaseJob: vi.fn(),
    onSubmitPurchaseLinks: vi.fn(async () => undefined),
    onRegisterJob: vi.fn(),
    onRegisterSelected: vi.fn(),
    purchasesError: "",
    onRetryPurchases: vi.fn(),
    onOpenOrdersTab: vi.fn(),
    recordsPanel: <p>记录面板占位</p>,
    ...overrides,
  };
  act(() => {
    root.render(<PurchaseRecordsWorkspace {...props} />);
  });
  return props;
}

describe("PurchaseRecordsWorkspace", () => {
  it("renders the link registration, job rows and the records panel slot", () => {
    renderWorkspace();
    expect(host.textContent).toContain("链接登记购买");
    expect(host.textContent).toContain("腰带");
    expect(host.textContent).toContain("分析完成，可登记 · 实付 ¥12,800");
    expect(host.textContent).toContain("记录面板占位");
    expect(host.querySelector("textarea")?.getAttribute("aria-label")).toBe(
      "购买商品链接",
    );
  });

  it("wires the register, bundle, toggle and inventory-tab actions", () => {
    const props = renderWorkspace();
    const registerButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "登记",
    );
    act(() => registerButton?.click());
    expect(props.onRegisterJob).toHaveBeenCalledWith("job-1");

    const bundleButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("登记已完成"),
    );
    act(() => bundleButton?.click());
    expect(props.onRegisterSelected).toHaveBeenCalledTimes(1);

    const checkbox = host.querySelector<HTMLInputElement>(
      'input[aria-label="选择加入购买包"]',
    );
    act(() => checkbox?.click());
    expect(props.onTogglePurchaseJob).toHaveBeenCalledWith("job-1");

    const nextStep = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("查看库存订单"),
    );
    act(() => nextStep?.click());
    expect(props.onOpenOrdersTab).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable error when the records load failed", () => {
    const props = renderWorkspace({ purchasesError: "购买记录加载失败" });
    const retry = host.querySelector<HTMLButtonElement>(
      '[data-testid="retry-purchases"]',
    );
    expect(retry).not.toBeNull();
    act(() => retry?.click());
    expect(props.onRetryPurchases).toHaveBeenCalledTimes(1);
  });
});
