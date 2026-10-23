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
