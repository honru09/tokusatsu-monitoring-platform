// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DetailDisclosure, DetailDescription } from "./detail-disclosure";

it("keeps the complete description and toggles its preview without truncating data", () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const text = "这是商品的完整描述，包含品相、数量和全部配件。".repeat(30);
  try {
    act(() =>
      root.render(
        <>
          <DetailDescription text={text} />
          <DetailDisclosure title="商品参数">
            <input aria-label="数量" />
          </DetailDisclosure>
        </>,
      ),
    );
    expect(host.querySelector("p")?.textContent).toBe(text);
    expect(host.querySelector("p")?.classList.contains("is-condensed")).toBe(
      true,
    );
    expect(host.querySelector("details")?.open).toBe(false);
    act(() => host.querySelector("button")?.click());
    expect(host.querySelector("p")?.classList.contains("is-condensed")).toBe(
      false,
    );
    expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe(
      "true",
    );
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("holds a very long unbreakable description in the collapsed preview", () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const token = "a".repeat(400);
  const text = `${token} ${"説明テキスト。".repeat(120)}`;
  try {
    act(() => root.render(<DetailDescription text={text} />));
    const paragraph = host.querySelector("p");
    // The full text stays in the DOM; only the visual preview clamps.
    expect(paragraph?.textContent).toBe(text);
    expect(paragraph?.classList.contains("is-condensed")).toBe(true);
    act(() => host.querySelector("button")?.click());
    expect(paragraph?.classList.contains("is-condensed")).toBe(false);
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("renders a designed empty state with an art slot when there is no description", () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() => root.render(<DetailDescription text="" />));
    expect(host.textContent).toContain("暂无商品说明");
    expect(host.querySelector("[data-description-art-slot]")).not.toBeNull();
    expect(host.querySelector("button")).toBeNull();
    expect(host.textContent).not.toContain("无详情描述");
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
