// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinancePanel } from "./finance-panel";

vi.mock("motion/react", () => ({
  useReducedMotion: () => true,
}));

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response;
}

describe("FinancePanel", () => {
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
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("renders the three pool figures from the summary endpoint", async () => {
    fetchMock.mockResolvedValue(
      response({
        totalCostYen: 120_000,
        totalIncomeYen: 150_500,
        netProfitYen: 30_500,
      }),
    );
    await act(async () => {
      root.render(<FinancePanel apiBaseUrl="/backend" />);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/backend/finance/summary",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(host.textContent).toContain("总支出");
    expect(host.textContent).toContain("¥120,000");
    expect(host.textContent).toContain("总收入");
    expect(host.textContent).toContain("¥150,500");
    expect(host.textContent).toContain("净利润");
    expect(host.textContent).toContain("¥30,500");
  });

  it("steps the figure size down starting at 9 glyphs for long and 11 for xlong", async () => {
    fetchMock.mockResolvedValue(
      response({
        totalCostYen: 120_000,
        totalIncomeYen: 15_000,
        netProfitYen: -105_309,
      }),
    );
    await act(async () => {
      root.render(<FinancePanel apiBaseUrl="/backend" />);
    });
    const figures = [...host.querySelectorAll("strong")];
    expect(figures).toHaveLength(3);
    // ¥120,000 is 8 glyphs: default tier.
    expect(figures[0]?.dataset.tier).toBe("default");
    // ¥15,000 is 7 glyphs: default tier.
    expect(figures[1]?.dataset.tier).toBe("default");
    // −¥105,309 is 9 glyphs: long tier.
    expect(figures[2]?.dataset.tier).toBe("long");
    expect(figures[2]?.textContent).toBe("−¥105,309");
  });

  it("steps the figure size down for eight-digit totals", async () => {
    fetchMock.mockResolvedValue(
      response({
        totalCostYen: 99_999_999,
        totalIncomeYen: 0,
        netProfitYen: -99_999_999,
      }),
    );
    await act(async () => {
      root.render(<FinancePanel apiBaseUrl="/backend" />);
    });
    const figures = [...host.querySelectorAll("strong")];
    expect(figures).toHaveLength(3);
    // ¥99,999,999 is 11 glyphs: two steps down (xlong tier).
    expect(figures[0]?.dataset.tier).toBe("xlong");
    expect(figures[0]?.textContent).toBe("¥99,999,999");
    // ¥0 stays at the default size.
    expect(figures[1]?.dataset.tier).toBe("default");
    // −¥99,999,999 is 12 glyphs: two steps down (xlong tier).
    expect(figures[2]?.dataset.tier).toBe("xlong");
    expect(figures[2]?.textContent).toBe("−¥99,999,999");
  });

  it("shows a retry affordance when the summary fails", async () => {
    fetchMock.mockResolvedValue(response({ message: "down" }, 503));
    await act(async () => {
      root.render(<FinancePanel apiBaseUrl="/backend" />);
    });
    expect(host.textContent).toContain("重试");
    expect(host.textContent).toContain("—");
  });

  it("retry refetches and renders the recovered figures", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ message: "down" }, 503))
      .mockResolvedValueOnce(
        response({
          totalCostYen: 8_000,
          totalIncomeYen: 0,
          netProfitYen: -8_000,
        }),
      );
    await act(async () => {
      root.render(<FinancePanel apiBaseUrl="/backend" />);
    });
    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "重试",
    );
    expect(retry).toBeTruthy();
    await act(async () => {
      retry!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("¥8,000");
    expect(host.textContent).toContain("−¥8,000");
    expect(host.textContent).not.toContain("重试");
  });

  it("refetches when the refresh key changes identity", async () => {
    fetchMock.mockResolvedValue(
      response({
        totalCostYen: 1_000,
        totalIncomeYen: 0,
        netProfitYen: -1_000,
      }),
    );
    const firstKey = new Set(["a"]);
    await act(async () => {
      root.render(
        <FinancePanel apiBaseUrl="/backend" refreshKey={firstKey} />,
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(
      response({
        totalCostYen: 2_500,
        totalIncomeYen: 0,
        netProfitYen: -2_500,
      }),
    );
    await act(async () => {
      root.render(
        <FinancePanel
          apiBaseUrl="/backend"
          refreshKey={new Set(["a", "b"])}
        />,
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("¥2,500");
  });
});
