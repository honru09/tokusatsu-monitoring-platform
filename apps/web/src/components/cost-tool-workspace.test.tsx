// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  CostToolWorkspace,
  ProcurementCalculatorWorkspace,
} from "./cost-tool-workspace";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function fill(label: string, value: string) {
  const node = host.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  )!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function click(label: string) {
  act(() =>
    [...host.querySelectorAll("button")]
      .find((node) => node.textContent === label)!
      .click(),
  );
}

it("separates the two views, restores draft, and never copies internal data", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  await act(async () =>
    root.render(
      <ProcurementCalculatorWorkspace
        exchangeRate={0.0421}
        managerId="manager-1"
      />,
    ),
  );
  fill("商品数量", "20");
  fill("日本整批商品报价", "30000");
  fill("预计国内整批售价", "3000");
  expect(host.querySelector("output")?.textContent).toContain("1,952.45");
  click("对内 · 实际收益");
  fill("实际整批采购价", "20000");
  fill("实际整批运税", "400");
  expect(host.querySelector("output")?.textContent).toContain("710.45");
  expect(host.textContent).not.toContain("复制客户报价");
  click("对外 · 客户报价");
  expect(host.querySelector('input[aria-label="实际整批采购价"]')).toBeNull();
  await act(async () => click("复制客户报价"));
  expect(writeText.mock.calls[0][0]).toContain("1,952.45");
  expect(writeText.mock.calls[0][0]).not.toContain("710.45");
  fill("换算汇率", "4.5");
  await act(async () =>
    root.render(
      <ProcurementCalculatorWorkspace
        exchangeRate={0.041}
        managerId="manager-1"
      />,
    ),
  );
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="换算汇率"]')?.value,
  ).toBe("4.5");
  expect(
    JSON.parse(
      sessionStorage.getItem("kamen-procurement-calculator-v1:manager-1")!,
    ).market,
  ).toBe("30000");
});

it("merges both tools under one 算账 heading with a segment switch", async () => {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      String(url).includes("carriers")
        ? { carriers: [] }
        : { items: [] },
  }));
  vi.stubGlobal("fetch", fetchMock);
  await act(async () =>
    root.render(
      <CostToolWorkspace
        apiBaseUrl="http://api.test"
        managerId="manager-1"
        exchangeRate={0.0421}
      />,
    ),
  );
  expect(host.querySelector("#cost-tool-title")?.textContent).toBe("算账");
  // Calculator segment is the default and keeps its full form.
  expect(host.querySelector('input[aria-label="商品数量"]')).not.toBeNull();
  expect(
    [...host.querySelectorAll("button")].find(
      (node) => node.textContent === "采购测算",
    )?.getAttribute("aria-pressed"),
  ).toBe("true");
  await act(async () => click("物流利润"));
  await act(async () => {});
  // Logistics segment renders its own heading and loads its data.
  expect(host.querySelector("#logistics-title")?.textContent).toBe("利润与物流");
  expect(host.textContent).toContain("暂无可计算商品");
  expect(fetchMock).toHaveBeenCalledWith(
    "http://api.test/logistics/items",
    expect.anything(),
  );
  await act(async () => click("采购测算"));
  expect(host.querySelector('input[aria-label="商品数量"]')).not.toBeNull();
});

it("opens on the logistics segment when a legacy deep-link preselects it", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).includes("carriers") ? { carriers: [] } : { items: [] },
    })),
  );
  await act(async () =>
    root.render(
      <CostToolWorkspace
        apiBaseUrl="http://api.test"
        managerId="manager-1"
        defaultSegment="logistics"
      />,
    ),
  );
  await act(async () => {});
  expect(host.querySelector("#logistics-title")?.textContent).toBe("利润与物流");
  expect(host.querySelector('input[aria-label="商品数量"]')).toBeNull();
});

it("shows invalid inputs instead of invented zero-profit results", async () => {
  await act(async () =>
    root.render(<ProcurementCalculatorWorkspace managerId="manager-1" />),
  );
  expect(host.querySelector("output")?.textContent).toContain("待填写");
  fill("商品数量", "-2");
  expect(host.querySelector('[aria-invalid="true"]')).not.toBeNull();
  expect(host.querySelector("output")?.textContent).toContain("待填写");
});
