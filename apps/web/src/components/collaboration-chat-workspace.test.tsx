// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CollaborationChatWorkspace,
  NegotiationScriptPanel,
  buildBundleShareText,
  groupNegotiationsByRound,
  type CollaborationItem,
  type ShareRound,
} from "./collaboration-chat-workspace";
import type { ManagerAccount } from "./manager-account-gate";

vi.mock("../lib/visibility-poller", () => ({
  createVisibilityPoller({
    task,
  }: {
    task: (signal?: AbortSignal) => Promise<void>;
  }) {
    return {
      start() {
        void task();
      },
      pause() {},
      resume() {},
      stop() {},
      runNow: () => task(),
    };
  },
}));

const accounts: ManagerAccount[] = [
  {
    id: "manager-1",
    key: "manager_one",
    displayName: "龙",
    avatarInitial: "龙",
    position: 1,
    active: true,
    online: true,
    stats: { shares: 7, favorites: 4, dislikes: 2 },
  },
  {
    id: "manager-2",
    key: "manager_two",
    displayName: "润",
    avatarInitial: "润",
    position: 2,
    active: true,
    online: false,
    stats: { shares: 5, favorites: 9, dislikes: 1 },
  },
];

const message = {
  id: "message-1",
  senderId: "manager-2",
  recipientId: "manager-1",
  text: "这件可以砍价",
  itemId: null,
  replyToId: null,
  forwardedFromId: null,
  readAt: "2026-09-07T01:00:00.000Z",
  createdAt: "2026-09-07T01:00:00.000Z",
  updatedAt: "2026-09-07T01:00:00.000Z",
  sender: accounts[1],
  recipient: accounts[0],
  item: null,
  replyTo: null,
  reactions: [],
};

const productMessage = {
  ...message,
  id: "message-with-product",
  text: "这件商品可以砍价",
  createdAt: "2026-09-07T01:01:00.000Z",
  updatedAt: "2026-09-07T01:01:00.000Z",
  itemId: "item-1",
  item: {
    id: "item-1",
    titleRaw: "S.H.Figuarts 仮面ライダー",
    titleZh: "S.H.Figuarts 假面骑士",
    sourceUrl: "https://example.com/item-1",
    priceCurrent: 3100,
    source: { key: "mercari", displayName: "Mercari" },
    images: [],
    product: null,
  },
};

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response;
}

describe("Telegram-style collaboration actions", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let openItemMock: ReturnType<typeof vi.fn>;
  let persistedReaction: {
    id: string;
    accountId: string;
    reaction: string;
    account: ManagerAccount;
  } | null;

  beforeEach(async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.sessionStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    vi.stubGlobal("React", React);
    openItemMock = vi.fn(async () => true);
    persistedReaction = null;
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/collaboration/messages/read"))
        return Promise.resolve(response({ updated: 1 }));
      if (url.pathname.endsWith("/collaboration/negotiations/failed/dislike"))
        return Promise.resolve(response({ moved: 1 }));
      if (url.pathname.endsWith("/collaboration/decisions")) {
        const body = JSON.parse(String(init?.body)) as {
          itemId: string;
          status: string;
        };
        return Promise.resolve(
          response({
            itemId: body.itemId,
            status: body.status,
            decidedById: "manager-1",
            decidedByName: "龙",
            decidedAt: "2026-09-07T01:24:00.000Z",
          }),
        );
      }
      if (url.pathname.endsWith("/collaboration/negotiations"))
        return Promise.resolve(
          response({
            cases: [
              {
                id: "case-active",
                status: "in_progress",
                statusChangedAt: "2026-09-07T01:00:00.000Z",
                item: productMessage.item,
                initiatedBy: accounts[0],
              },
              {
                id: "case-failed",
                status: "failed",
                statusChangedAt: "2026-09-07T01:00:00.000Z",
                item: productMessage.item,
                initiatedBy: accounts[0],
              },
            ],
          }),
        );
      if (url.pathname.endsWith("/reactions")) {
        const body = JSON.parse(String(init?.body)) as {
          accountId: string;
          reaction: string;
        };
        if (init?.method === "DELETE") {
          persistedReaction = null;
          return Promise.resolve(response({ removed: true }));
        }
        persistedReaction = {
          id: "reaction-1",
          ...body,
          account: accounts[0],
        };
        return Promise.resolve(response(persistedReaction));
      }
      return Promise.resolve(
        response({
          messages: [
            {
              ...message,
              reactions: persistedReaction ? [persistedReaction] : [],
            },
            productMessage,
          ],
          nextAfter: productMessage.updatedAt,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <CollaborationChatWorkspace
          apiBaseUrl=""
          account={accounts[0]}
          accounts={accounts}
          pendingItem={null}
          onPendingItemConsumed={() => undefined}
          onOpenItem={openItemMock}
          cartCount={0}
          onCartMigrated={() => undefined}
          onUnreadCleared={() => undefined}
          onActivityChanged={() => undefined}
        />,
      );
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function openActions() {
    const article = host.querySelector(".collaboration-message");
    if (!(article instanceof HTMLElement)) throw new Error("消息不存在");
    act(() => article.click());
    return article;
  }

  it("默认不渲染操作条，点按消息才显示指定操作", () => {
    expect(host.querySelector('[role="toolbar"]')).toBeNull();
    const article = openActions();
    const toolbar = host.querySelector('[role="toolbar"]');

    expect(article.dataset.actionsOpen).toBe("true");
    expect(toolbar).not.toBeNull();
    expect(
      Array.from(toolbar?.querySelectorAll("button") ?? []).map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["回复消息", "砍价", "点赞", "砍价成功", "砍价失败"]);
  });

  it("在对话顶部显示双方真实协作计数与在线状态", () => {
    const strip = host.querySelector(".collaboration-activity-strip");
    expect(strip).not.toBeNull();
    expect(
      strip?.querySelectorAll(".collaboration-manager-summary"),
    ).toHaveLength(2);
    expect(strip?.querySelector('[aria-label="转发 7 次"]')).not.toBeNull();
    expect(strip?.querySelector('[aria-label="收藏 9 次"]')).not.toBeNull();
    expect(strip?.querySelector('[aria-label="不感兴趣 1 次"]')).not.toBeNull();
    expect(strip?.querySelectorAll("i.is-online")).toHaveLength(1);
  });

  it("商品卡上有要 / 砍价 / 不要三个决定键，点击即保存并回显决定人", async () => {
    const group = host.querySelector(
      '[role="group"][aria-label="商品决定"]',
    );
    expect(group).not.toBeNull();
    const buttons = Array.from(group?.querySelectorAll("button") ?? []);
    expect(buttons.map((button) => button.textContent)).toEqual([
      "要",
      "砍价",
      "不要",
    ]);
    const negotiate = buttons[1];
    await act(async () => {
      negotiate?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/collaboration/decisions"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"itemId":"item-1"'),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/collaboration/decisions"),
      expect.objectContaining({
        body: expect.stringContaining('"status":"negotiate"'),
      }),
    );
    expect(negotiate?.getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).toContain("龙 · 已定：砍价");
    // The copy-script affordance stays on the card as the next action.
    expect(host.textContent).toContain("复制砍价日语");
  });

  it("商品转发保存成功后只刷新一次真实协作统计", async () => {
    const activityChanged = vi.fn();
    await act(async () => {
      root.render(
        <CollaborationChatWorkspace
          apiBaseUrl=""
          account={accounts[0]}
          accounts={accounts}
          pendingItem={productMessage.item}
          onPendingItemConsumed={() => undefined}
          onOpenItem={openItemMock}
          cartCount={0}
          onCartMigrated={() => undefined}
          onUnreadCleared={() => undefined}
          onActivityChanged={activityChanged}
        />,
      );
      await Promise.resolve();
    });
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        response({
          ...productMessage,
          id: "saved-product-message",
          senderId: accounts[0].id,
          recipientId: accounts[1].id,
          sender: accounts[0],
          recipient: accounts[1],
        }),
      ),
    );

    const submit = host.querySelector<HTMLButtonElement>(
      'button[aria-label="发送消息"]',
    );
    await act(async () => {
      submit?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(activityChanged).toHaveBeenCalledTimes(1);
  });

  it("商品转发保存失败时不增加协作统计", async () => {
    const activityChanged = vi.fn();
    await act(async () => {
      root.render(
        <CollaborationChatWorkspace
          apiBaseUrl=""
          account={accounts[0]}
          accounts={accounts}
          pendingItem={productMessage.item}
          onPendingItemConsumed={() => undefined}
          onOpenItem={openItemMock}
          cartCount={0}
          onCartMigrated={() => undefined}
          onUnreadCleared={() => undefined}
          onActivityChanged={activityChanged}
        />,
      );
      await Promise.resolve();
    });
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(response({ message: "消息发送失败" }, 500)),
    );

    const submit = host.querySelector<HTMLButtonElement>(
      'button[aria-label="发送消息"]',
    );
    await act(async () => {
      submit?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(activityChanged).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "消息发送失败",
    );
  });

  it("选择回复后立即收起操作条", () => {
    openActions();
    const reply = host.querySelector(
      'button[aria-label="回复消息"]',
    ) as HTMLButtonElement;
    act(() => reply.click());

    expect(host.querySelector('[role="toolbar"]')).toBeNull();
    expect(host.textContent).toContain("回复 润");
  });

  it("点击快速状态后立即显示并收起操作条", async () => {
    openActions();
    const success = host.querySelector(
      'button[aria-label="砍价成功"]',
    ) as HTMLButtonElement;
    await act(async () => {
      success.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('[role="toolbar"]')).toBeNull();
    expect(
      host.querySelector('[aria-label="消息互动"]')?.textContent,
    ).toContain("✅");
    const reactionCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/collaboration/messages/message-1/reactions"),
    );
    expect(reactionCall?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(reactionCall?.[1]?.body))).toEqual({
      accountId: "manager-1",
      reaction: "negotiation_success",
    });
  });

  it("互动保存失败时回滚状态并显示错误", async () => {
    let rejectReaction: (() => void) | undefined;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/reactions"))
        return new Promise<Response>((resolve) => {
          rejectReaction = () =>
            resolve(response({ message: "互动保存失败" }, 500));
        });
      if (url.pathname.endsWith("/collaboration/messages/read"))
        return Promise.resolve(response({ updated: 1 }));
      return Promise.resolve(
        response({
          messages: [message, productMessage],
          nextAfter: productMessage.updatedAt,
        }),
      );
    });
    openActions();
    const like = host.querySelector(
      'button[aria-label="点赞"]',
    ) as HTMLButtonElement;
    await act(async () => {
      like.click();
      await Promise.resolve();
    });
    expect(
      host.querySelector('[aria-label="消息互动"]')?.textContent,
    ).toContain("👍");
    await act(async () => {
      rejectReaction?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('[aria-label="消息互动"]')).toBeNull();
    expect(host.textContent).toContain("互动保存失败");
  });

  it("商品预览主体可打开消息操作，详情箭头仍单独打开商品", () => {
    expect(host.querySelector(".collaboration-message-avatar")).toBeNull();
    expect(host.querySelector(".collaboration-peer-avatar")).toBeNull();

    const productArticle = host.querySelectorAll(".collaboration-message")[1];
    const productCopy = productArticle.querySelector(
      ".collaboration-product-copy",
    ) as HTMLElement;
    act(() => productCopy.click());
    expect(productArticle.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector('[role="toolbar"]')).not.toBeNull();

    const openProduct = productArticle.querySelector(
      ".collaboration-product-open",
    ) as HTMLButtonElement;
    act(() => openProduct.click());
    expect(openItemMock).toHaveBeenCalledWith("item-1");
  });

  it("父组件回调更新时不会重启实时消息同步", async () => {
    const messageRequestCount = () =>
      fetchMock.mock.calls.filter(([input]) => {
        const url = new URL(String(input), "http://localhost");
        return url.pathname.endsWith("/collaboration/messages");
      }).length;
    const before = messageRequestCount();

    await act(async () => {
      root.render(
        <CollaborationChatWorkspace
          apiBaseUrl=""
          account={accounts[0]}
          accounts={accounts}
          pendingItem={null}
          onPendingItemConsumed={() => undefined}
          onOpenItem={openItemMock}
          cartCount={0}
          onCartMigrated={() => undefined}
          onUnreadCleared={() => undefined}
          onActivityChanged={() => undefined}
        />,
      );
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(messageRequestCount()).toBe(before);
  });

  it("已加载的对话返回时立即显示，不重新出现同步占位", async () => {
    expect(host.textContent).toContain("这件可以砍价");

    await act(async () => root.unmount());
    root = createRoot(host);

    let finishRefresh: ((value: Response) => void) | undefined;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/collaboration/negotiations"))
        return Promise.resolve(response({ cases: [] }));
      if (url.pathname.endsWith("/collaboration/messages/read"))
        return Promise.resolve(response({ updated: 1 }));
      if (url.pathname.endsWith("/collaboration/messages"))
        return new Promise<Response>((resolve) => {
          finishRefresh = resolve;
        });
      return Promise.resolve(response({}));
    });

    await act(async () => {
      root.render(
        <CollaborationChatWorkspace
          apiBaseUrl=""
          account={accounts[0]}
          accounts={accounts}
          pendingItem={null}
          onPendingItemConsumed={() => undefined}
          onOpenItem={openItemMock}
          cartCount={0}
          onCartMigrated={() => undefined}
          onUnreadCleared={() => undefined}
          onActivityChanged={() => undefined}
        />,
      );
      await Promise.resolve();
    });

    expect(host.textContent).toContain("这件可以砍价");
    expect(host.textContent).not.toContain("正在同步对话");

    await act(async () => {
      finishRefresh?.(
        response({ messages: [], nextAfter: productMessage.updatedAt }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("用悬浮刀入口展开状态，并在失败弹窗批量迁移", async () => {
    const floatButton = document.querySelector(
      ".negotiation-float-button",
    ) as HTMLButtonElement;
    expect(floatButton.classList.contains("has-active")).toBe(true);
    expect(
      document
        .querySelector(".negotiation-status-rail")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");

    act(() => floatButton.click());
    expect(
      document.querySelector(".collaboration-negotiation-float")?.classList,
    ).toContain("is-open");
    expect(
      document
        .querySelector(".negotiation-status-rail")
        ?.getAttribute("aria-hidden"),
    ).toBe("false");
    const failedButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".negotiation-status-rail button",
      ),
    ).find((button) => button.textContent?.includes("失败"));
    await act(async () => {
      failedButton?.click();
      await Promise.resolve();
    });
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    const clear = document.body.querySelector(
      ".negotiation-clear-failed",
    ) as HTMLButtonElement;
    await act(async () => {
      clear.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith("/collaboration/negotiations/failed/dislike"),
      ),
    ).toBe(true);
  });
});

describe("buildBundleShareText", () => {
  const shareItem = (
    overrides: Partial<CollaborationItem> = {},
  ): CollaborationItem => ({
    id: "item-1",
    titleRaw: "仮面ライダー フィギュア",
    sourceUrl: "https://example.com/item-1",
    priceCurrent: 3100,
    source: { key: "mercari", displayName: "Mercari" },
    images: [],
    ...overrides,
  });

  it("多件时逐件列出链接与目标价，并给出合计", () => {
    const text = buildBundleShareText(
      [
        shareItem(),
        shareItem({
          id: "item-2",
          titleRaw: "ベルト",
          sourceUrl: "https://example.com/item-2",
          priceCurrent: 5000,
        }),
      ],
      { "item-1": 2800, "item-2": 4000 },
    );

    expect(text).toContain("仮面ライダー フィギュア");
    expect(text).toContain("https://example.com/item-1");
    expect(text).toContain("现价 ¥3,100");
    expect(text).toContain("目标价 ¥2,800");
    expect(text).toContain("https://example.com/item-2");
    expect(text).toContain("目标价 ¥4,000");
    expect(text).toContain("合计现价 ¥8,100");
    expect(text).toContain("合计目标价 ¥6,800");
  });

  it("缺少链接时省略链接行，缺少目标价时回落到现价", () => {
    const text = buildBundleShareText([shareItem({ sourceUrl: "" })]);

    expect(text).not.toContain("http");
    expect(text).toContain("现价 ¥3,100");
    expect(text).toContain("目标价 ¥3,100");
    expect(text).toContain("合计目标价 ¥3,100");
  });

  it("给了打包目标价时合计目标价用打包价，逐件仍显示各自目标价", () => {
    const text = buildBundleShareText(
      [
        shareItem(),
        shareItem({
          id: "item-2",
          titleRaw: "ベルト",
          priceCurrent: 5000,
        }),
      ],
      { "item-1": 2800 },
      7000,
    );

    expect(text).toContain("目标价 ¥2,800");
    // item-2 has no per-item target, so it falls back to its current price.
    expect(text).toContain("目标价 ¥5,000");
    expect(text).toContain("合计现价 ¥8,100");
    expect(text).toContain("合计目标价 ¥7,000");
  });

  it("空集合返回空字符串，也接受 Map 形式的目标价", () => {
    expect(buildBundleShareText([])).toBe("");
    const text = buildBundleShareText(
      [shareItem()],
      new Map([["item-1", 2500]]),
    );
    expect(text).toContain("目标价 ¥2,500");
    expect(text).toContain("合计目标价 ¥2,500");
  });
});

describe("groupNegotiationsByRound", () => {
  const negotiationItem = (
    id: string,
    sellerId: string | null,
    priceCurrent: number,
  ): CollaborationItem => ({
    id,
    titleRaw: `title-${id}`,
    sourceUrl: `https://example.com/${id}`,
    priceCurrent,
    source: { key: "mercari", displayName: "Mercari" },
    seller: sellerId ? { id: sellerId, name: `卖家${sellerId}` } : null,
    images: [],
  });
  const negotiationCase = (id: string, item: CollaborationItem) => ({
    id,
    status: "in_progress" as const,
    statusChangedAt: "2026-09-07T01:00:00.000Z",
    item,
    initiatedBy: accounts[0],
  });
  const round: ShareRound = {
    id: "round-1",
    note: null,
    createdAt: "2026-09-07T01:00:00.000Z",
    createdById: "manager-1",
    createdBy: accounts[0],
    copiedCount: 0,
    total: 2,
    targetTotalYen: 2400,
    items: [
      {
        id: "round-item-1",
        roundId: "round-1",
        itemId: "item-1",
        targetPriceYen: 900,
        copiedAt: null,
        item: negotiationItem("item-1", "seller-1", 1000),
      },
      {
        id: "round-item-2",
        roundId: "round-1",
        itemId: "item-2",
        targetPriceYen: 1500,
        copiedAt: null,
        item: negotiationItem("item-2", "seller-1", 2000),
      },
    ],
  };

  it("先按轮次分组，轮内再按卖家分组并给出目标小计", () => {
    const groups = groupNegotiationsByRound(
      [
        negotiationCase("case-1", negotiationItem("item-1", "seller-1", 1000)),
        negotiationCase("case-2", negotiationItem("item-2", "seller-1", 2000)),
        negotiationCase("case-3", negotiationItem("item-9", "seller-2", 500)),
      ],
      [round],
    );

    expect(groups).toHaveLength(2);
    expect(groups[0]?.round?.id).toBe("round-1");
    expect(groups[0]?.sellerGroups).toHaveLength(1);
    expect(groups[0]?.sellerGroups[0]).toMatchObject({
      sellerName: "卖家seller-1",
      listedTotalYen: 3000,
      targetTotalYen: 2400,
    });
    expect(groups[0]?.sellerGroups[0]?.entries).toHaveLength(2);
    expect(groups[1]?.round).toBeNull();
    expect(groups[1]?.key).toBe("ungrouped");
    expect(groups[1]?.entries.map((entry) => entry.id)).toEqual(["case-3"]);
    expect(groups[1]?.sellerGroups[0]?.targetTotalYen).toBeNull();
  });

  it("没有轮次时全部落入未分组，仍按卖家给出现价小计", () => {
    const groups = groupNegotiationsByRound(
      [
        negotiationCase("case-1", negotiationItem("item-1", "seller-1", 1000)),
        negotiationCase("case-2", negotiationItem("item-2", "seller-1", 2000)),
      ],
      [],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("ungrouped");
    expect(groups[0]?.sellerGroups[0]).toMatchObject({
      listedTotalYen: 3000,
      targetTotalYen: null,
    });
  });
});

describe("copy auto-accounting", () => {
  const itemOne: CollaborationItem = {
    id: "item-1",
    titleRaw: "仮面ライダー 一号",
    titleZh: "假面骑士一号",
    sourceUrl: "https://example.com/item-1",
    priceCurrent: 3100,
    source: { key: "mercari", displayName: "Mercari" },
    seller: { id: "seller-1", name: "卖家一" },
    images: [],
    product: null,
  };
  const itemTwo: CollaborationItem = {
    id: "item-2",
    titleRaw: "仮面ライダー 二号",
    titleZh: "假面骑士二号",
    sourceUrl: "https://example.com/item-2",
    priceCurrent: 4200,
    source: { key: "mercari", displayName: "Mercari" },
    seller: { id: "seller-1", name: "卖家一" },
    images: [],
    product: null,
  };
  const itemLone: CollaborationItem = {
    id: "item-9",
    titleRaw: "単品アイテム",
    titleZh: "单品",
    sourceUrl: "https://example.com/item-9",
    priceCurrent: 1500,
    source: { key: "mercari", displayName: "Mercari" },
    seller: { id: "seller-9", name: "卖家九" },
    images: [],
    product: null,
  };
  const round: ShareRound = {
    id: "round-1",
    createdAt: "2026-09-07T01:00:00.000Z",
    createdById: "manager-2",
    copiedCount: 0,
    total: 2,
    targetTotalYen: 5000,
    items: [
      {
        id: "round-item-1",
        roundId: "round-1",
        itemId: "item-1",
        targetPriceYen: 2000,
        copiedAt: null,
        item: itemOne,
      },
      {
        id: "round-item-2",
        roundId: "round-1",
        itemId: "item-2",
        targetPriceYen: 3000,
        copiedAt: null,
        item: itemTwo,
      },
    ],
  };
  const bundleMessage = {
    ...message,
    id: "message-bundle",
    text: "打包这两件",
    itemId: "item-1",
    roundId: "round-1",
    item: itemOne,
    bundleItems: [
      { ...itemOne, targetPriceYen: 2000 },
      { ...itemTwo, targetPriceYen: 3000 },
    ],
    targetPriceYen: 5000,
  };
  const singleRoundMessage = {
    ...message,
    id: "message-single-round",
    text: "这件在轮次里",
    createdAt: "2026-09-07T01:02:00.000Z",
    updatedAt: "2026-09-07T01:02:00.000Z",
    itemId: "item-1",
    roundId: "round-1",
    item: { ...itemOne, targetPriceYen: 2000 },
    bundleItems: [{ ...itemOne, targetPriceYen: 2000 }],
    targetPriceYen: 2000,
  };
  const loneMessage = {
    ...message,
    id: "message-lone",
    text: "单发一件",
    createdAt: "2026-09-07T01:03:00.000Z",
    updatedAt: "2026-09-07T01:03:00.000Z",
    itemId: "item-9",
    item: itemLone,
  };

  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let writeTextMock: ReturnType<typeof vi.fn>;
  let markCopiedStatus = 200;

  function markCopiedCalls() {
    return fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/mark-copied"),
    );
  }

  function buttonByText(text: string) {
    const button = Array.from(host.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes(text),
    );
    if (!button) throw new Error(`按钮不存在：${text}`);
    return button as HTMLButtonElement;
  }

  beforeEach(async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.sessionStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    vi.stubGlobal("React", React);
    markCopiedStatus = 200;
    writeTextMock = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/mark-copied"))
        return Promise.resolve(
          response({ ...round, copiedCount: 2 }, markCopiedStatus),
        );
      if (url.pathname.endsWith("/collaboration/messages/read"))
        return Promise.resolve(response({ updated: 1 }));
      if (url.pathname.endsWith("/collaboration/negotiations"))
        return Promise.resolve(response({ cases: [] }));
      if (url.pathname.endsWith("/collaboration/share-rounds"))
        return Promise.resolve(response({ rounds: [round] }));
      if (url.pathname.endsWith("/negotiation-script"))
        return Promise.resolve(
          response({
            roundId: "round-1",
            groups: [
              {
                sellerId: "seller-1",
                sellerName: "卖家一",
                itemIds: ["item-1", "item-2"],
                script: "まとめて購入希望です。",
                fallback: false,
              },
            ],
          }),
        );
      void init;
      return Promise.resolve(
        response({
          messages: [bundleMessage, singleRoundMessage, loneMessage],
          nextAfter: loneMessage.updatedAt,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <CollaborationChatWorkspace
          apiBaseUrl=""
          account={accounts[0]}
          accounts={accounts}
          pendingItem={null}
          onPendingItemConsumed={() => undefined}
          onOpenItem={async () => true}
          cartCount={0}
          onCartMigrated={() => undefined}
          onUnreadCleared={() => undefined}
          onActivityChanged={() => undefined}
        />,
      );
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("复制打包砍价话术时把整轮商品记为已复制，进度立即更新", async () => {
    await act(async () => {
      buttonByText("一键复制合并砍价日语").click();
      await Promise.resolve();
    });
    expect(writeTextMock).toHaveBeenCalledTimes(1);
    const calls = markCopiedCalls();
    expect(calls).toHaveLength(1);
    const [input, init] = calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(input)).toContain(
      "/collaboration/share-rounds/round-1/mark-copied",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      accountId: "manager-1",
      itemIds: ["item-1", "item-2"],
    });
    expect(host.textContent).toContain("已复制 2/2");
  });

  it("记账接口失败时复制本身的已复制状态不受影响", async () => {
    markCopiedStatus = 500;
    await act(async () => {
      buttonByText("复制链接+目标价").click();
      await Promise.resolve();
    });
    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(markCopiedCalls()).toHaveLength(1);
    expect(buttonByText("已复制链接+目标价")).toBeTruthy();
  });

  it("单件卡复制时只记该件所属轮次的那一行", async () => {
    const buttons = Array.from(host.querySelectorAll("button")).filter(
      (entry) => entry.textContent?.includes("复制砍价日语"),
    );
    // One button belongs to the round's single-item card, the other to the
    // lone share; the round one renders first in the feed.
    await act(async () => {
      buttons[0]?.click();
      await Promise.resolve();
    });
    const calls = markCopiedCalls();
    expect(calls).toHaveLength(1);
    const [, init] = calls[0] as [RequestInfo | URL, RequestInit];
    expect(JSON.parse(String(init?.body))).toEqual({
      accountId: "manager-1",
      itemIds: ["item-1"],
    });
    expect(host.textContent).toContain("已复制 1/2");
  });

  it("不属于任何轮次的单发商品复制不发记账请求", async () => {
    const buttons = Array.from(host.querySelectorAll("button")).filter(
      (entry) => entry.textContent?.includes("复制砍价日语"),
    );
    await act(async () => {
      buttons[buttons.length - 1]?.click();
      await Promise.resolve();
    });
    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(markCopiedCalls()).toHaveLength(0);
  });

  it("话术面板按卖家组复制时回调该组的商品", async () => {
    const onCopied = vi.fn();
    const panelHost = document.createElement("div");
    document.body.append(panelHost);
    const panelRoot = createRoot(panelHost);
    await act(async () => {
      panelRoot.render(
        <NegotiationScriptPanel
          roundId="round-1"
          apiBaseUrl=""
          onCopied={onCopied}
        />,
      );
    });
    const panelButton = (text: string) => {
      const button = Array.from(panelHost.querySelectorAll("button")).find(
        (entry) => entry.textContent?.includes(text),
      );
      if (!button) throw new Error(`按钮不存在：${text}`);
      return button as HTMLButtonElement;
    };
    await act(async () => {
      panelButton("生成讲价话术").click();
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await act(async () => {
      panelButton("复制").click();
      await Promise.resolve();
    });
    expect(writeTextMock).toHaveBeenCalledWith("まとめて購入希望です。");
    expect(onCopied).toHaveBeenCalledWith("round-1", ["item-1", "item-2"]);
    act(() => panelRoot.unmount());
    panelHost.remove();
  });
});
