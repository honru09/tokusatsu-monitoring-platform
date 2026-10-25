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

  it("shows a retry affordance when the summary fails", async () => {
    fetchMock.mockResolvedValue(response({ message: "down" }, 503));
    await act(async () => {
      root.render(<FinancePanel apiBaseUrl="/backend" />);
    });
    expect(host.textContent).toContain("重试");
    expect(host.textContent).toContain("—");
  });
});
