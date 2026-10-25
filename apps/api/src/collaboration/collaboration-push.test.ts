import { describe, expect, it, vi } from "vitest";
import { CollaborationService } from "./collaboration.service.js";

function itemShape(id: string) {
  return {
    id,
    titleRaw: `title-${id}`,
    titleZh: `标题-${id}`,
    source: { key: "mercari", displayName: "Mercari" },
    seller: null,
    images: [],
    product: null,
  };
}

function fixture() {
  const push = {
    notifyAccount: vi.fn().mockResolvedValue({ sent: 1, pruned: 0 }),
    notifyDecision: vi.fn().mockResolvedValue({ sent: 1, pruned: 0 }),
  };
  const prisma = {
    managerAccount: {
      findFirst: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          ["manager-1", "manager-2"].includes(where.id)
            ? { id: where.id, active: true }
            : null,
        ),
      ),
      findMany: vi.fn(() => Promise.resolve([{ id: "manager-2" }])),
    },
    managerActivity: {
      create: vi.fn().mockResolvedValue({ id: "activity-1" }),
    },
    item: {
      findMany: vi.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.map((id) => itemShape(id))),
      ),
    },
    shareRound: {
      findMany: vi.fn(() =>
        Promise.resolve([
          {
            id: "round-1",
            createdById: "manager-1",
            note: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: { id: "manager-1" },
            items: ["item-1", "item-2"].map((itemId, index) => ({
              id: `round-item-${index + 1}`,
              roundId: "round-1",
              itemId,
              targetPriceYen: null,
              copiedAt: null,
              item: itemShape(itemId),
            })),
          },
        ]),
      ),
      create: vi.fn(({ data }: { data: { createdById: string; items?: { create: { itemId: string }[] } } }) =>
        Promise.resolve({
          id: "round-1",
          createdById: data.createdById,
          note: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: { id: data.createdById },
          items: (data.items?.create ?? []).map((entry, index) => ({
            id: `round-item-${index + 1}`,
            roundId: "round-1",
            itemId: entry.itemId,
            targetPriceYen: null,
            copiedAt: null,
            item: itemShape(entry.itemId),
          })),
        }),
      ),
    },
    directMessage: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: "message-1",
          ...data,
          text: data.text ?? null,
          item: data.itemId ? itemShape(data.itemId as string) : null,
          round: null,
          replyTo: null,
          reactions: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      findFirst: vi.fn().mockResolvedValue({ id: "message-0" }),
    },
    $transaction: vi.fn(
      async (callback: (client: unknown) => unknown) => callback(prisma),
    ),
  };
  const service = new CollaborationService(prisma as never, push as never);
  return { service, prisma, push };
}

describe("collaboration push triggers", () => {
  it("notifies the recipient when a message shares a single item, with its title", async () => {
    const { service, push } = fixture();
    await service.send({
      senderId: "manager-1",
      recipientId: "manager-2",
      itemId: "item-1",
    });
    expect(push.notifyAccount).toHaveBeenCalledWith("manager-2", {
      title: "搭档分享了新商品",
      body: "标题-item-1",
      url: "/?workspace=collaboration",
    });
  });

  it("summarizes a multi-item share by count and does not notify for plain text", async () => {
    const { service, push } = fixture();
    await service.send({
      senderId: "manager-1",
      recipientId: "manager-2",
      itemIds: ["item-1", "item-2"],
    });
    expect(push.notifyAccount).toHaveBeenCalledWith(
      "manager-2",
      expect.objectContaining({ body: "共 2 件新商品" }),
    );
    push.notifyAccount.mockClear();
    await service.send({
      senderId: "manager-1",
      recipientId: "manager-2",
      text: "在吗",
    });
    expect(push.notifyAccount).not.toHaveBeenCalled();
  });

  it("notifies the other account when a share round is created directly", async () => {
    const { service, push } = fixture();
    await service.createShareRound({
      accountId: "manager-1",
      items: [{ itemId: "item-1" }, { itemId: "item-2" }],
    });
    // The fan-out runs fire-and-forget; let its microtasks settle.
    await new Promise((resolve) => setImmediate(resolve));
    expect(push.notifyAccount).toHaveBeenCalledWith("manager-2", {
      title: "搭档分享了新商品",
      body: "新一轮分享：共 2 件商品",
      url: "/?workspace=collaboration",
    });
  });

  it("a failing push never fails the share", async () => {
    const { service, push } = fixture();
    push.notifyAccount.mockRejectedValue(new Error("push down"));
    await expect(
      service.send({
        senderId: "manager-1",
        recipientId: "manager-2",
        itemId: "item-1",
      }),
    ).resolves.toMatchObject({ id: "message-1" });
  });
});
