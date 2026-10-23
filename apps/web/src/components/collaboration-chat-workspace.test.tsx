// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollaborationChatWorkspace } from "./collaboration-chat-workspace";
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
          onSwitchAccount={() => undefined}
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
          onSwitchAccount={() => undefined}
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
          onSwitchAccount={() => undefined}
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
          onSwitchAccount={() => undefined}
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
          onSwitchAccount={() => undefined}
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
