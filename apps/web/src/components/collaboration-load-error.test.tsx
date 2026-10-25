// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollaborationChatWorkspace } from "./collaboration-chat-workspace";
import type { ManagerAccount } from "./manager-account-gate";

// The poller contract that matters here: a rejected task is reported to
// onError, which is what turns a failed message sync into the error row.
vi.mock("../lib/visibility-poller", () => ({
  createVisibilityPoller({
    task,
    onError,
  }: {
    task: (signal?: AbortSignal) => Promise<void>;
    onError?: (reason: unknown) => void;
  }) {
    return {
      start() {
        void task().catch((reason) => onError?.(reason));
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

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response;
}

describe("Collaboration chat load error state", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let messagesFail = true;

  beforeEach(() => {
    messagesFail = true;
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.sessionStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    vi.stubGlobal("React", React);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname.endsWith("/collaboration/messages")) {
          if (messagesFail)
            return Promise.resolve(response({ error: "down" }, 503));
          return Promise.resolve(
            response({ messages: [message], nextAfter: message.updatedAt }),
          );
        }
        if (url.pathname.endsWith("/collaboration/messages/read"))
          return Promise.resolve(response({ updated: 1 }));
        if (url.pathname.endsWith("/collaboration/negotiations"))
          return Promise.resolve(response({ cases: [] }));
        if (url.pathname.endsWith("/collaboration/share-rounds"))
          return Promise.resolve(response({ rounds: [] }));
        return Promise.resolve(response({}));
      }),
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function renderChat() {
    await act(async () => {
      root.render(
        <CollaborationChatWorkspace
          apiBaseUrl=""
          account={accounts[0]}
          accounts={accounts}
          pendingItem={null}
          onPendingItemConsumed={() => undefined}
          onOpenItem={vi.fn(async () => true)}
          cartCount={0}
          onCartMigrated={() => undefined}
          onUnreadCleared={() => undefined}
          onActivityChanged={() => undefined}
        />,
      );
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }

  it("shows the sync error with a retry, and recovers when the retry succeeds", async () => {
    await renderChat();
    await vi.waitFor(() =>
      expect(
        host.querySelector('[data-testid="retry-collaboration"]'),
      ).not.toBeNull(),
    );
    expect(
      host.querySelector('[data-testid="load-error"]')?.textContent,
    ).toContain("消息同步失败");

    messagesFail = false;
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="retry-collaboration"]')
        ?.click();
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await vi.waitFor(() =>
      expect(host.textContent).toContain("这件可以砍价"),
    );
    expect(host.querySelector('[data-testid="load-error"]')).toBeNull();
  });
});
