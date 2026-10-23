import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { CollaborationService } from "./collaboration.service.js";

function fixture() {
  const account = (id: string) => ({
    id,
    active: true,
    position: id === "manager-1" ? 1 : 2,
    lastSeenAt: new Date(),
  });
  const prisma = {
    managerAccount: {
      findMany: vi
        .fn()
        .mockResolvedValue([account("manager-1"), account("manager-2")]),
      findFirst: vi.fn(({ where }) =>
        Promise.resolve(
          typeof where.id === "object" && where.id?.not
            ? account(where.id.not === "manager-1" ? "manager-2" : "manager-1")
            : ["manager-1", "manager-2"].includes(where.id)
              ? account(where.id)
              : null,
        ),
      ),
      update: vi.fn().mockResolvedValue(account("manager-1")),
    },
    managerActivity: {
      groupBy: vi
        .fn()
        .mockResolvedValue([
          { accountId: "manager-1", action: "favorite", _sum: { count: 3 } },
        ]),
      create: vi.fn().mockResolvedValue({ id: "activity-1" }),
    },
    directMessage: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ id: "message-1" }),
      create: vi
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: "message-new", ...data }),
        ),
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      update: vi.fn().mockResolvedValue({ id: "message-1" }),
      count: vi.fn().mockResolvedValue(4),
    },
    item: {
      findUnique: vi.fn().mockResolvedValue({ id: "item-1" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    messageReaction: {
      upsert: vi.fn().mockResolvedValue({ id: "reaction-1" }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    negotiationCase: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ id: "case-1", itemId: "item-1" }),
      upsert: vi
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: "case-1", ...data }),
        ),
      update: vi
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: "case-1", itemId: "item-1", ...data }),
        ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    shoppingCart: {
      findUnique: vi.fn().mockResolvedValue({
        id: "cart-1",
        items: [{ itemId: "item-1" }],
      }),
    },
    shoppingCartItem: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  Object.assign(prisma, {
    $transaction: vi.fn(async (callback: (client: typeof prisma) => unknown) =>
      callback(prisma),
    ),
  });
  return { prisma, service: new CollaborationService(prisma as never) };
}

describe("CollaborationService", () => {
  it("returns presence, unread messages and per-manager activity totals", async () => {
    const { service } = fixture();
    await expect(service.presence("manager-1")).resolves.toMatchObject({
      unreadCount: 4,
      accounts: expect.arrayContaining([
        expect.objectContaining({
          id: "manager-1",
          online: true,
          stats: { shares: 0, favorites: 3, dislikes: 0 },
        }),
      ]),
    });
  });

  it("moves shared-cart products into a durable negotiation and conversation", async () => {
    const { service, prisma } = fixture();
    await expect(
      service.startNegotiations({ accountId: "manager-1" }),
    ).resolves.toMatchObject({ moved: 1 });
    expect(prisma.negotiationCase.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          itemId: "item-1",
          status: "in_progress",
        }),
      }),
    );
    expect(prisma.shoppingCartItem.deleteMany).toHaveBeenCalled();
    expect(prisma.directMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ itemId: "item-1" }),
      }),
    );
  });

  it("persists a failed negotiation for the 24-hour maintenance policy", async () => {
    const { service, prisma } = fixture();
    await expect(
      service.updateNegotiation("case-1", {
        accountId: "manager-2",
        status: "failed",
      }),
    ).resolves.toMatchObject({
      negotiation: expect.objectContaining({ status: "failed" }),
    });
    expect(prisma.negotiationCase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          statusChangedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("moves failed negotiations to the disliked warehouse with their origin", async () => {
    const { service, prisma } = fixture();
    prisma.negotiationCase.findMany.mockResolvedValueOnce([
      { id: "case-1", itemId: "item-1" },
    ]);

    await expect(
      service.clearFailedNegotiations("manager-1"),
    ).resolves.toMatchObject({ moved: 1 });
    expect(prisma.item.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ignored: true,
          ignoredReason: "negotiation_failed",
        }),
      }),
    );
    expect(prisma.negotiationCase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "moved_to_disliked" }),
      }),
    );
  });
  it("only accepts the two persisted active manager accounts", async () => {
    const { service } = fixture();
    await expect(
      service.send({
        senderId: "outsider",
        recipientId: "manager-2",
        text: "test",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("persists text, product forwarding and reply relationships", async () => {
    const { service, prisma } = fixture();
    await expect(
      service.send({
        senderId: "manager-1",
        recipientId: "manager-2",
        text: "看看这个",
        itemId: "item-1",
        replyToId: "message-1",
        forwardedFromId: "message-1",
      }),
    ).resolves.toMatchObject({ id: "message-new", text: "看看这个" });
    expect(prisma.directMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          itemId: "item-1",
          replyToId: "message-1",
        }),
      }),
    );
    expect(prisma.managerActivity.create).toHaveBeenCalledWith({
      data: {
        accountId: "manager-1",
        action: "share",
        itemId: "item-1",
      },
    });
    expect(prisma.managerActivity.create).toHaveBeenCalledTimes(1);
  });

  it("does not count a plain text message as a product share", async () => {
    const { service, prisma } = fixture();

    await expect(
      service.send({
        senderId: "manager-1",
        recipientId: "manager-2",
        text: "普通消息",
      }),
    ).resolves.toMatchObject({ id: "message-new", text: "普通消息" });
    expect(prisma.managerActivity.create).not.toHaveBeenCalled();
  });

  it("rejects empty messages and missing products", async () => {
    const { service, prisma } = fixture();
    await expect(
      service.send({
        senderId: "manager-1",
        recipientId: "manager-2",
        text: "  ",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    prisma.item.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.send({
        senderId: "manager-1",
        recipientId: "manager-2",
        itemId: "missing",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("marks only messages received by the selected manager as read", async () => {
    const { service, prisma } = fixture();
    await expect(service.markRead({ accountId: "manager-2" })).resolves.toEqual(
      { updated: 2 },
    );
    expect(prisma.directMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recipientId: "manager-2",
          readAt: null,
        }),
      }),
    );
  });

  it.each(["knife", "like", "negotiation_success", "negotiation_failed"])(
    "persists the Telegram-style %s quick reaction",
    async (reaction) => {
      const { service, prisma } = fixture();
      await expect(
        service.addReaction("message-1", {
          accountId: "manager-1",
          reaction,
        } as never),
      ).resolves.toEqual({ id: "reaction-1" });
      expect(prisma.messageReaction.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ reaction }),
        }),
      );
    },
  );
});
