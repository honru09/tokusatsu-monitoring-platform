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
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
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
      (button) => button.textContent?.includes("登记购买"),
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

  it("sorts jobs stably: ready -> in-progress -> failed, preserving original order in each group", () => {
    const jobs: PurchaseLinkJobLike[] = [
      {
        jobId: "f1",
        url: "https://example.com/fail1",
        state: "failed",
        progress: 100,
        item: null,
      },
      {
        jobId: "r1",
        url: "https://example.com/ready1",
        state: "completed",
        progress: 100,
        item: { titleZh: "现货A", titleRaw: "现货A" },
      },
      {
        jobId: "p1",
        url: "https://jp.mercari.com/item/m12345",
        state: "active",
        progress: 45,
        item: null,
      },
      {
        jobId: "r2",
        url: "https://example.com/ready2",
        state: "completed",
        progress: 100,
        item: { titleZh: "现货B", titleRaw: "现货B" },
      },
      {
        jobId: "p2",
        url: "https://page.auctions.yahoo.co.jp/jp/auction/y9876",
        state: "waiting",
        progress: 0,
        item: null,
      },
      {
        jobId: "f2",
        url: "https://example.com/fail2",
        state: "failed",
        progress: 100,
        item: null,
      },
    ];

    renderWorkspace({ purchaseLinkJobs: jobs });
    const jobTitles = [...host.querySelectorAll(".min-w-0 > p.font-semibold")].map(
      (node) => node.textContent?.trim(),
    );
    expect(jobTitles).toEqual([
      "现货A",
      "现货B",
      "Mercari · m12345",
      "雅虎拍卖 · y9876",
      "example.com",
      "example.com",
    ]);
  });

  it("does not render percentage on failed rows and renders '失败', but keeps percentage on in-progress rows", () => {
    const jobs: PurchaseLinkJobLike[] = [
      {
        jobId: "active-1",
        url: "https://jp.mercari.com/item/m1111",
        state: "active",
        progress: 55,
        item: null,
      },
      {
        jobId: "failed-1",
        url: "https://jp.mercari.com/item/m2222",
        state: "failed",
        progress: 100,
        item: null,
        failedReason: "Error: NoPublicPriceError",
      },
    ];

    renderWorkspace({ purchaseLinkJobs: jobs });
    expect(host.textContent).toContain("55%");
    expect(host.textContent).not.toContain("100%");

    const failedLabel = host.querySelector("span.text-rust");
    expect(failedLabel).not.toBeNull();
    expect(failedLabel?.textContent?.trim()).toBe("失败");
  });

  it("renders compactLinkLabel for jobs without item title and retains full url in title attribute", () => {
    const jobs: PurchaseLinkJobLike[] = [
      {
        jobId: "mercari-1",
        url: "https://jp.mercari.com/item/m54739826519",
        state: "active",
        progress: 30,
        item: null,
      },
      {
        jobId: "yahoo-1",
        url: "https://page.auctions.yahoo.co.jp/jp/auction/b1088492041",
        state: "waiting",
        progress: 0,
        item: null,
      },
    ];

    renderWorkspace({ purchaseLinkJobs: jobs });
    const mercariP = host.querySelector('p[title="https://jp.mercari.com/item/m54739826519"]');
    expect(mercariP).not.toBeNull();
    expect(mercariP?.textContent?.trim()).toBe("Mercari · m54739826519");

    const yahooP = host.querySelector(
      'p[title="https://page.auctions.yahoo.co.jp/jp/auction/b1088492041"]',
    );
    expect(yahooP).not.toBeNull();
    expect(yahooP?.textContent?.trim()).toBe("雅虎拍卖 · b1088492041");
  });
});
