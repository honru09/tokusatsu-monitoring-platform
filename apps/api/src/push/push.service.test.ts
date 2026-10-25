import { BadRequestException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PushService, type PushSubscriptionRow } from "./push.service.js";

const rows: PushSubscriptionRow[] = [
  {
    id: "sub-1",
    accountId: "manager-2",
    endpoint: "https://push.example/one",
    p256dh: "key-1",
    auth: "auth-1",
    userAgent: null,
  },
  {
    id: "sub-2",
    accountId: "manager-2",
    endpoint: "https://push.example/two",
    p256dh: "key-2",
    auth: "auth-2",
    userAgent: null,
  },
  {
    id: "sub-3",
    accountId: "manager-2",
    endpoint: "https://push.example/three",
    p256dh: "key-3",
    auth: "auth-3",
    userAgent: null,
  },
];

function fixture(initial: PushSubscriptionRow[] = rows) {
  const store = [...initial];
  const prisma = {
    managerAccount: {
      findFirst: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          ["manager-1", "manager-2"].includes(where.id)
            ? { id: where.id, active: true }
            : null,
        ),
      ),
    },
    pushSubscription: {
      upsert: vi.fn(
        (args: {
          where: { endpoint: string };
          create: Omit<PushSubscriptionRow, "id">;
          update: Omit<PushSubscriptionRow, "id">;
        }) => {
          const existing = store.findIndex(
            (row) => row.endpoint === args.where.endpoint,
          );
          if (existing >= 0) {
            store[existing] = { ...store[existing], ...args.update } as PushSubscriptionRow;
            return Promise.resolve(store[existing]);
          }
          const row = { id: `sub-${store.length + 1}`, ...args.create };
          store.push(row);
          return Promise.resolve(row);
        },
      ),
      findMany: vi.fn(({ where }: { where: { accountId: string } }) =>
        Promise.resolve(store.filter((row) => row.accountId === where.accountId)),
      ),
      delete: vi.fn(({ where }: { where: { id: string } }) => {
        const index = store.findIndex((row) => row.id === where.id);
        if (index >= 0) store.splice(index, 1);
        return Promise.resolve({});
      }),
      deleteMany: vi.fn(
        (args: { where: { accountId: string; endpoint: string } }) => {
          const index = store.findIndex(
            (row) =>
              row.accountId === args.where.accountId &&
              row.endpoint === args.where.endpoint,
          );
          if (index >= 0) store.splice(index, 1);
          return Promise.resolve({ count: index >= 0 ? 1 : 0 });
        },
      ),
    },
  };
  const service = new PushService(prisma as never);
  return { service, prisma, store };
}

function enableConfig() {
  vi.stubEnv("VAPID_PUBLIC_KEY", "test-public-key");
  vi.stubEnv("VAPID_PRIVATE_KEY", "test-private-key");
  vi.stubEnv("VAPID_SUBJECT", "mailto:operator@example.com");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("push config", () => {
  it("is disabled unless all three VAPID values are present", () => {
    const { service } = fixture([]);
    expect(service.config()).toEqual({ enabled: false, publicKey: null });
    vi.stubEnv("VAPID_PUBLIC_KEY", "test-public-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "test-private-key");
    expect(service.config()).toEqual({ enabled: false, publicKey: null });
    vi.stubEnv("VAPID_SUBJECT", "mailto:operator@example.com");
    expect(service.config()).toEqual({
      enabled: true,
      publicKey: "test-public-key",
    });
  });
});

describe("push subscriptions", () => {
  it("upserts by endpoint and reassigns the account when the browser switches manager", async () => {
    const { service, prisma, store } = fixture([]);
    await service.subscribe(
      "manager-1",
      {
        endpoint: "https://push.example/one",
        keys: { p256dh: "key-1", auth: "auth-1" },
      },
      "Browser/1",
    );
    await service.subscribe("manager-2", {
      endpoint: "https://push.example/one",
      keys: { p256dh: "key-1b", auth: "auth-1b" },
    });
    expect(prisma.pushSubscription.upsert).toHaveBeenCalledTimes(2);
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({
      accountId: "manager-2",
      p256dh: "key-1b",
    });
  });

  it("rejects an unknown account", async () => {
    const { service } = fixture([]);
    await expect(
      service.subscribe("nobody", {
        endpoint: "https://push.example/one",
        keys: { p256dh: "k", auth: "a" },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("deletes only the caller's own subscription and stays quiet when absent", async () => {
    const { service, store } = fixture();
    await expect(
      service.unsubscribe("manager-1", "https://push.example/one"),
    ).resolves.toEqual({ removed: false });
    expect(store).toHaveLength(3);
    await expect(
      service.unsubscribe("manager-2", "https://push.example/one"),
    ).resolves.toEqual({ removed: true });
    expect(store.map((row) => row.id)).toEqual(["sub-2", "sub-3"]);
    await expect(
      service.unsubscribe("manager-2", "https://push.example/one"),
    ).resolves.toEqual({ removed: false });
  });
});

describe("notifyAccount", () => {
  it("sends to every subscription, prunes 410s, and swallows other failures", async () => {
    enableConfig();
    const { service, store } = fixture();
    const sender = vi.fn((subscription: PushSubscriptionRow) => {
      if (subscription.id === "sub-2") {
        const error = new Error("gone") as Error & { statusCode: number };
        error.statusCode = 410;
        return Promise.reject(error);
      }
      if (subscription.id === "sub-3") {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve();
    });
    service.sender = sender;
    await expect(
      service.notifyAccount("manager-2", {
        title: "搭档分享了新商品",
        body: "共 3 件新商品",
        url: "/?workspace=collaboration",
      }),
    ).resolves.toEqual({ sent: 1, pruned: 1 });
    expect(sender).toHaveBeenCalledTimes(3);
    expect(store.map((row) => row.id)).toEqual(["sub-1", "sub-3"]);
    const payload = JSON.parse(
      (sender.mock.calls[0] as unknown as [PushSubscriptionRow, string])[1],
    ) as unknown;
    expect(payload).toEqual({
      title: "搭档分享了新商品",
      body: "共 3 件新商品",
      url: "/?workspace=collaboration",
    });
  });

  it("prunes 404s as well", async () => {
    enableConfig();
    const { service, store } = fixture([rows[0] as PushSubscriptionRow]);
    service.sender = vi.fn(() => {
      const error = new Error("not found") as Error & { statusCode: number };
      error.statusCode = 404;
      return Promise.reject(error);
    });
    await expect(
      service.notifyAccount("manager-2", { title: "t", body: "b", url: "/" }),
    ).resolves.toEqual({ sent: 0, pruned: 1 });
    expect(store).toHaveLength(0);
  });

  it("does nothing when push is not configured", async () => {
    const { service, prisma } = fixture();
    await expect(
      service.notifyAccount("manager-2", { title: "t", body: "b", url: "/" }),
    ).resolves.toEqual({ sent: 0, pruned: 0 });
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
  });
});

describe("notifyDecision", () => {
  it("formats the decision with the canonical wording and deep-links to messages", async () => {
    enableConfig();
    const { service } = fixture([rows[0] as PushSubscriptionRow]);
    const sender = vi.fn().mockResolvedValue(undefined);
    service.sender = sender;
    await service.notifyDecision({
      itemTitle: "假面骑士响鬼 吹奏鬼弦套装",
      status: "negotiate",
      deciderName: "王",
      recipientAccountId: "manager-2",
    });
    const payload = JSON.parse(sender.mock.calls[0][1] as string) as {
      title: string;
      body: string;
      url: string;
    };
    expect(payload.body).toBe("王 对《假面骑士响鬼 吹奏鬼弦套装》定了：砍价");
    expect(payload.url).toBe("/?workspace=collaboration");
  });
});
