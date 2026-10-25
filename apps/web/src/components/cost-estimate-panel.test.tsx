// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CostEstimatePanel } from "./cost-estimate-panel";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("CostEstimatePanel", () => {
  it("matches the standalone calculator figures for the same item", () => {
    // Same numbers as the calculator lib test: 20 units, ¥30,000 batch,
    // 4.21 CNY per 100 JPY, default 15% fee and 25 CNY/unit shipping
    // gives a 1,952.45 CNY receivable.
    act(() =>
      root.render(
        <CostEstimatePanel
          priceYen={30_000}
          shippingYen={0}
          quantity={20}
          exchangeRate={0.0421}
        />,
      ),
    );
    expect(
      host.querySelector('[data-testid="cost-estimate-total-yen"]')
        ?.textContent,
    ).toContain("30,000");
    expect(
      host.querySelector('[data-testid="cost-estimate-landed-cny"]')
        ?.textContent,
    ).toContain("1,952.45");
    expect(host.textContent).toContain("97.62");
    expect(
      host.querySelector('[data-testid="cost-estimate-profit"]')?.textContent,
    ).toContain("待填售价");
  });

  it("reports profit once an expected domestic price is supplied", () => {
    act(() =>
      root.render(
        <CostEstimatePanel
          priceYen={30_000}
          shippingYen={0}
          quantity={20}
          exchangeRate={0.0421}
          domesticCny={3000}
        />,
      ),
    );
    expect(
      host.querySelector('[data-testid="cost-estimate-profit"]')?.textContent,
    ).toContain("1,047.55");
  });

  it("adds known Japan-side shipping to the yen total", () => {
    act(() =>
      root.render(
        <CostEstimatePanel priceYen={10_000} shippingYen={500} quantity={2} />,
      ),
    );
    expect(
      host.querySelector('[data-testid="cost-estimate-total-yen"]')
        ?.textContent,
    ).toContain("10,500");
    // No exchange rate, so no CNY landed cost is invented.
    expect(
      host.querySelector('[data-testid="cost-estimate-landed-cny"]'),
    ).toBeNull();
  });

  it("renders nothing when the price is unknown", () => {
    act(() => root.render(<CostEstimatePanel priceYen={0} />));
    expect(host.querySelector('[data-testid="cost-estimate-panel"]')).toBeNull();
    act(() => root.render(<CostEstimatePanel priceYen={Number.NaN} />));
    expect(host.querySelector('[data-testid="cost-estimate-panel"]')).toBeNull();
  });
});
