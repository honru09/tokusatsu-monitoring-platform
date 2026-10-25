// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonitoringConfigWorkspace } from "./monitoring-config-workspace";

function sampleConfig() {
  return {
    keywords: [
      {
        id: "kw-1",
        keyword: "S.H.Figuarts",
        enabled: true,
        intervalMinutes: 60,
        categoryId: "cat-1",
        sourceKeys: [] as string[],
        category: { id: "cat-1", name: "假面骑士 SHF" },
        _count: { matches: 12 },
        lastRunAt: "2026-10-08T01:00:00Z",
      },
    ],
    categories: [
      {
        id: "cat-1",
        name: "假面骑士 SHF",
        parentId: null as string | null,
        scope: "toys" as "toys" | "general",
        _count: { items: 12 },
      },
    ],
    platforms: [
      { key: "mercari", displayName: "Mercari", enabled: true },
      { key: "yahoo_fleamarket", displayName: "Yahoo!フリマ", enabled: true },
      { key: "offline", displayName: "停用平台", enabled: false },
    ],
  };
}

describe("MonitoringConfigWorkspace", () => {
  let host: HTMLElement;
  let root: ReturnType<typeof createRoot>;
  let config: ReturnType<typeof sampleConfig>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let failure: { path: string; status: number; message: string } | null;
  let changed: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    config = sampleConfig();
    failure = null;
    changed = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    fetchMock = vi.fn(async (url: string, options: RequestInit = {}) => {
      const path = new URL(url).pathname.replace("/monitoring", "");
      const body = options.body ? JSON.parse(String(options.body)) : {};
      if (failure?.path === path)
        return Response.json(
          { message: failure.message },
          { status: failure.status },
        );
      if (path === "/config") return Response.json(config);
      if (path === "/categories") {
        const category = { id: "cat-2", ...body, _count: { items: 0 } };
        config.categories.push(category);
        return Response.json(category);
      }
      if (path.startsWith("/categories/")) {
        const category = { ...config.categories[0], ...body };
        config.categories[0] = category;
        return Response.json(category);
      }
      if (path === "/keywords") {
        const category = config.categories.find(
          (row) => row.id === body.categoryId,
        )!;
        const keyword = {
          id: "kw-2",
          ...body,
          category,
          _count: { matches: 0 },
        };
        config.keywords.push(keyword);
        return Response.json({ keyword, dispatch: { queued: 2 } });
      }
      if (path === "/keywords/kw-1") {
        config.keywords[0] = { ...config.keywords[0], ...body };
        return Response.json({
          keyword: config.keywords[0],
          dispatch: { queued: 2 },
        });
      }
      if (path.endsWith("/reindex"))
        return Response.json({ matched: 9, moved: 7 });
      if (path.endsWith("/run") || path === "/config/refresh")
        return Response.json({ queued: 2, skipped: 0 });
      throw new Error(`Unexpected test request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function render(accountId: string | null = "manager-1") {
    await act(async () => {
      root.render(
        <MonitoringConfigWorkspace
          apiBaseUrl="https://api.example/"
          accountId={accountId}
          onConfigChanged={changed}
        />,
      );
    });
  }
  function button(label: string, within: ParentNode = document.body) {
    const result = Array.from(
      within.querySelectorAll<HTMLButtonElement>("button"),
    ).find(
      (node) =>
        node.getAttribute("aria-label") === label || node.textContent === label,
    );
    if (!result) throw new Error(`Missing button ${label}`);
    return result;
  }
  async function click(label: string, within: ParentNode = document.body) {
    await act(async () => {
      button(label, within).click();
    });
  }
  function field(label: string): HTMLInputElement | HTMLSelectElement {
    const target = Array.from(document.body.querySelectorAll("label"))
      .find((node) => node.firstChild?.textContent === label)
      ?.querySelector<HTMLInputElement | HTMLSelectElement>("input,select");
    if (!target) throw new Error(`Missing field ${label}`);
    return target;
  }
  function fill(label: string, value: string) {
    const node = field(label);
    act(() => {
      const prototype =
        node instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
        node,
        value,
      );
      node.dispatchEvent(
        new Event(node instanceof HTMLSelectElement ? "change" : "input", {
          bubbles: true,
        }),
      );
    });
  }
  async function submit() {
    await act(async () => {
      document.body
        .querySelector(".mcfg-backdrop:not([hidden]) form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
  }
  function bodyFor(path: string) {
    const call = fetchMock.mock.calls.find(
      ([url, options]) =>
        String(url).endsWith(path) && options?.method !== "GET",
    );
    if (!call) throw new Error(`Missing mutation ${path}`);
    return JSON.parse(String(call[1].body));
  }

  it("reads real counts and timestamps, and searches keywords by category", async () => {
    await render();
    expect(host.textContent).toContain("12 件收录");
    expect(host.textContent).toContain("最近");
    const search = host.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, "奥特曼");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("没有匹配的关键词");
    await click("清空搜索");
    expect(host.textContent).toContain("S.H.Figuarts");
    await click("假面骑士 SHF玩具12");
    expect(host.textContent).toContain("全部关键词");
    await click("全部关键词");
  });

  it("creates a category inside keyword editing, preserves the keyword, and saves the enabled scan", async () => {
    await render();
    await click("添加关键词");
    fill("关键词", "ウルトラマン S.H.Figuarts");
    await click("新建商品分类");
    fill("分类名称", "奥特曼 SHF");
    fill("商品范围", "toys");
    await submit();
    expect(field("关键词").value).toBe("ウルトラマン S.H.Figuarts");
    expect(field("商品分类").value).toBe("cat-2");
    expect(bodyFor("/categories")).toMatchObject({
      name: "奥特曼 SHF",
      scope: "toys",
      parentId: null,
      accountId: "manager-1",
    });
    await submit();
    expect(bodyFor("/keywords")).toMatchObject({
      keyword: "ウルトラマン S.H.Figuarts",
      enabled: true,
      categoryId: "cat-2",
      intervalMinutes: 60,
      sourceKeys: [],
      accountId: "manager-1",
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain("已安排 2 个扫描任务");
    expect(changed).toHaveBeenCalled();
  });

  it("edits a keyword with explicit platforms and does not include disabled sources", async () => {
    await render();
    await click("S.H.Figuarts假面骑士 SHF");
    fill("关键词", "真骨彫製法");
    fill("扫描间隔（分钟）", "30");
    act(() => {
      document.body.querySelector("summary")!.click();
    });
    expect(document.body.textContent).not.toContain("停用平台");
    const mercari = Array.from(document.body.querySelectorAll("label"))
      .find((node) => node.textContent === "Mercari")!
      .querySelector<HTMLInputElement>("input")!;
    act(() => mercari.click());
    await submit();
    expect(bodyFor("/keywords/kw-1")).toMatchObject({
      keyword: "真骨彫製法",
      intervalMinutes: 30,
      sourceKeys: ["mercari"],
      accountId: "manager-1",
    });
  });

  it("keeps edits and exposes server errors when saving fails", async () => {
    await render();
    await click("添加关键词");
    fill("关键词", "仮面ライダー SIC");
    failure = { path: "/keywords", status: 409, message: "关键词已经存在" };
    await submit();
    expect(field("关键词").value).toBe("仮面ライダー SIC");
    expect(
      document.body.querySelector('[role="alert"]')?.textContent,
    ).toContain("关键词已经存在");
    expect(button("保存").disabled).toBe(false);
    failure = null;
    await submit();
    expect(host.textContent).toContain("仮面ライダー SIC");
  });

  it("validates the platform-safe interval range before submitting", async () => {
    await render();
    await click("添加关键词");
    fill("关键词", "仮面ライダー SIC");
    fill("扫描间隔（分钟）", "5");
    await submit();
    expect(
      document.body.querySelector('[role="alert"]')?.textContent,
    ).toContain("15 至 1440");
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/keywords")),
    ).toBe(false);
  });

  it("persists toggles and dispatches immediate scans, reindex and plan refresh with the account", async () => {
    await render();
    await click("监控 S.H.Figuarts");
    expect(bodyFor("/keywords/kw-1")).toEqual({
      enabled: false,
      accountId: "manager-1",
    });
    expect(button("监控 S.H.Figuarts").getAttribute("aria-checked")).toBe(
      "false",
    );
    await click("立即扫描 S.H.Figuarts");
    expect(bodyFor("/keywords/kw-1/run")).toEqual({ accountId: "manager-1" });
    await click("S.H.Figuarts假面骑士 SHF");
    await click("匹配现有商品");
    expect(bodyFor("/keywords/kw-1/reindex")).toEqual({
      accountId: "manager-1",
    });
    await click("取消");
    await click("更新扫描计划");
    expect(bodyFor("/config/refresh")).toEqual({ accountId: "manager-1" });
  });

  it("edits scope and parent category using the category endpoint", async () => {
    await render();
    await click("编辑分类 假面骑士 SHF");
    fill("分类名称", "包品牌");
    fill("商品范围", "general");
    await submit();
    expect(bodyFor("/categories/cat-1")).toMatchObject({
      name: "包品牌",
      scope: "general",
      parentId: null,
      accountId: "manager-1",
    });
    expect(host.textContent).toContain("其他商品");
  });

  it("defaults new unparented categories to other products rather than the toy identity gate", async () => {
    await render();
    await click("新建分类");
    fill("分类名称", "包品牌");
    expect(field("商品范围").value).toBe("general");
    await submit();
    expect(bodyFor("/categories")).toMatchObject({
      name: "包品牌",
      scope: "general",
      parentId: null,
    });
  });

  it("inherits the selected parent scope and restores other products when the parent is cleared", async () => {
    await render();
    await click("新建分类");
    fill("分类名称", "真骨雕");
    fill("上级分类", "cat-1");
    expect(field("商品范围").value).toBe("toys");
    expect(field("商品范围").disabled).toBe(true);
    fill("上级分类", "");
    expect(field("商品范围").value).toBe("general");
    expect(field("商品范围").disabled).toBe(false);
    fill("上级分类", "cat-1");
    await submit();
    expect(bodyFor("/categories")).toMatchObject({
      name: "真骨雕",
      scope: "toys",
      parentId: "cat-1",
    });
  });

  it("supports focus trapping, Escape, touch backdrop dismissal and opening a second small dialog", async () => {
    await render();
    const trigger = button("添加关键词");
    trigger.focus();
    await click("添加关键词");
    expect(document.activeElement).toBe(field("关键词"));
    button("保存").focus();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(button("关闭新建关键词"));
    await click("新建商品分类");
    expect(
      document.body.querySelectorAll(".mcfg-backdrop:not([hidden])"),
    ).toHaveLength(1);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(field("关键词")).toBeTruthy();
    expect(
      document.body.querySelectorAll(".mcfg-backdrop:not([hidden])"),
    ).toHaveLength(1);
    act(() => {
      document.body
        .querySelector(".mcfg-backdrop:not([hidden])")!
        .dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows empty states and blocks mutation without an administrator", async () => {
    config.keywords = [];
    config.categories = [];
    await render(null);
    expect(host.textContent).toContain("还没有监控关键词");
    expect(button("添加关键词").disabled).toBe(true);
    expect(button("新建分类").disabled).toBe(true);
    expect(
      fetchMock.mock.calls.every(([, options]) => options.method === "GET"),
    ).toBe(true);
  });

  it("shows a load error with a working retry and no fabricated counts", async () => {
    failure = { path: "/config", status: 503, message: "API 503" };
    await render();
    expect(host.textContent).toContain("后台服务暂时无法连接");
    expect(host.textContent).not.toContain("运行中");
    failure = null;
    await click("重试");
    expect(host.textContent).toContain("S.H.Figuarts");
  });

  it("renders a loading state until the request resolves", async () => {
    let complete!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
    await render();
    expect(host.textContent).toContain("正在读取监控设置");
    await act(async () => {
      complete(Response.json(config));
    });
    expect(host.textContent).toContain("S.H.Figuarts");
  });
});
