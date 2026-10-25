// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NegotiationAnalysisPanel,
  SelectionToggle,
  type NegotiationAnalysisGroupResult,
} from "./collaboration-chat-workspace";

const bundleGroup: NegotiationAnalysisGroupResult = {
  sellerId: "seller-1",
  sellerName: "同店卖家",
  itemIds: ["a", "b"],
  items: [
    {
      id: "a",
      titleRaw: "商品A",
      priceCurrent: 3000,
      shippingFee: null,
      sourceUrl: "https://example.com/a",
      targetPriceYen: 2400,
      targetMissing: false,
    },
    {
      id: "b",
      titleRaw: "商品B",
      priceCurrent: 2000,
      shippingFee: null,
      sourceUrl: "https://example.com/b",
      targetPriceYen: null,
      targetMissing: true,
    },
  ],
  targetTotalYen: 4400,
  listedTotalYen: 5000,
  script: "コメント失礼いたします。まとめて購入希望です。",
  fallback: true,
  firstItemUrl: "https://example.com/a",
};

const singleGroup: NegotiationAnalysisGroupResult = {
  sellerId: "seller-2",
  sellerName: "单件卖家",
  itemIds: ["c"],
  items: [
    {
      id: "c",
      titleRaw: "商品C",
      priceCurrent: 1200,
      shippingFee: null,
      sourceUrl: "https://example.com/c",
      targetPriceYen: 1000,
      targetMissing: false,
    },
  ],
  targetTotalYen: 1000,
  listedTotalYen: 1200,
  script: "コメント失礼いたします。購入を考えているのですが。",
  fallback: true,
  firstItemUrl: "https://example.com/c",
};

describe("NegotiationAnalysisPanel", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const writeText = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("renders one card per seller group with per-item target previews", async () => {
    await act(async () => {
      root.render(
        <NegotiationAnalysisPanel
          groups={[bundleGroup, singleGroup]}
          onClose={() => undefined}
        />,
      );
    });
    expect(host.textContent).toContain("按卖家分组 · 2 份话术");
    expect(host.textContent).toContain("同店卖家");
    expect(host.textContent).toContain("2 件");
    expect(host.textContent).toContain("目标合计");
    expect(host.textContent).toContain("¥4,400");
    // Preview-only marking: the item without a share target is flagged
    // here, while the script itself stays clean.
    expect(host.textContent).toContain("未定目标（按现价）");
    expect(host.textContent).toContain("单件卖家");
    const links = [...host.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(links).toContain("https://example.com/a");
    expect(links).toContain("https://example.com/c");
  });

  it("copies exactly one group's script per copy button", async () => {
    const onCopied = vi.fn();
    await act(async () => {
      root.render(
        <NegotiationAnalysisPanel
          groups={[bundleGroup, singleGroup]}
          onCopied={onCopied}
          onClose={() => undefined}
        />,
      );
    });
    const buttons = [...host.querySelectorAll("button")].filter(
      (button) => button.textContent === "复制这份话术",
    );
    expect(buttons).toHaveLength(2);
    await act(async () => {
      buttons[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(bundleGroup.script);
    expect(onCopied).toHaveBeenCalledWith(["a", "b"]);
  });
});

describe("SelectionToggle", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("reports its pressed state and toggles", async () => {
    const onToggle = vi.fn();
    await act(async () => {
      root.render(
        <SelectionToggle selected label="选择：商品A" onToggle={onToggle} />,
      );
    });
    const button = host.querySelector("button")!;
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("选择：商品A");
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
