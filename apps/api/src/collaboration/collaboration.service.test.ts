import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { CollaborationService } from "./collaboration.service.js";

const knownItemIds = ["item-1", "item-2", "item-3"];

function itemShape(id: string) {
  return {
    id,
    titleRaw: `title-${id}`,
    titleZh: null,
    sourceUrl: `https://example.com/${id}`,
    priceCurrent: 1000,
    source: { key: "mercari", displayName: "Mercari" },
    seller: null,
    images: [],
    product: null,
  };
}

function fixture() {
  const account = (id: string) => ({
    id,
    active: true,
    displayName: id === "manager-1" ? "龙" : "王",
    position: id === "manager-1" ? 1 : 2,
    lastSeenAt: new Date(),
  });
  type StoredRoundItem = {
    id: string;
    roundId: string;
    itemId: string;
    targetPriceYen: number | null;
    copiedAt: Date | null;
    item: ReturnType<typeof itemShape>;
  };
  type StoredRound = {
    id: string;
    createdById: string;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
    createdBy: ReturnType<typeof account>;
    items: StoredRoundItem[];
  };
  const roundStore = new Map<string, StoredRound>();
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
      findUnique: vi.fn().mockResolvedValue({ id: "message-1" }),
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
      findMany: vi
        .fn()
        .mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            where.id.in
              .filter((id) => knownItemIds.includes(id))
              .map((id) => itemShape(id)),
          ),
        ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: "item-1", ignored: false, ...data }),
        ),
    },
    itemDecision: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi
        .fn()
        .mockImplementation(
          ({
            create,
            update,
          }: {
            create: Record<string, unknown>;
            update: Record<string, unknown>;
          }) =>
            Promise.resolve({
              id: "decision-1",
              ...create,
              ...update,
              decidedBy: {
                id: update.decidedById,
                displayName:
                  update.decidedById === "manager-1" ? "龙" : "王",
              },
            }),
        ),
    },
    shareRound: {
      create: vi
        .fn()
        .mockImplementation(
          ({
            data,
          }: {
            data: {
              createdById: string;
              note?: string | null;
              items?: {
                create: { itemId: string; targetPriceYen?: number | null }[];
              };
            };
          }) => {
            const round: StoredRound = {
              id: "round-1",
              createdById: data.createdById,
              note: data.note ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
              createdBy: account(data.createdById),
              items: (data.items?.create ?? []).map((entry, index) => ({
                id: `round-item-${index + 1}`,
                roundId: "round-1",
                itemId: entry.itemId,
                targetPriceYen: entry.targetPriceYen ?? null,
                copiedAt: null,
                item: itemShape(entry.itemId),
              })),
            };
            roundStore.set(round.id, round);
            return Promise.resolve(round);
          },
        ),
      findMany: vi
        .fn()
        .mockImplementation(
          ({ where }: { where?: { id?: { in: string[] } } } = {}) =>
            Promise.resolve(
              [...roundStore.values()].filter(
                (round) => !where?.id?.in || where.id.in.includes(round.id),
              ),
            ),
        ),
      findUnique: vi
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve(roundStore.get(where.id) ?? null),
        ),
    },
    shareRoundItem: {
      findUnique: vi
        .fn()
        .mockImplementation(
          ({
            where,
          }: {
            where: { roundId_itemId: { roundId: string; itemId: string } };
          }) => {
            const round = roundStore.get(where.roundId_itemId.roundId);
            const row = round?.items.find(
              (entry) => entry.itemId === where.roundId_itemId.itemId,
            );
            return Promise.resolve(row ? { id: row.id } : null);
          },
        ),
      update: vi
        .fn()
        .mockImplementation(
          ({
            where,
            data,
          }: {
            where: { roundId_itemId: { roundId: string; itemId: string } };
            data: { copiedAt?: Date | null; targetPriceYen?: number | null };
          }) => {
            const round = roundStore.get(where.roundId_itemId.roundId);
            const row = round?.items.find(
              (entry) => entry.itemId === where.roundId_itemId.itemId,
            );
            if (!row) return Promise.reject(new Error("missing round item"));
            if ("copiedAt" in data) row.copiedAt = data.copiedAt ?? null;
            if ("targetPriceYen" in data)
              row.targetPriceYen = data.targetPriceYen ?? null;
            return Promise.resolve({ ...row, item: itemShape(row.itemId) });
          },
        ),
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
        .mockImplementation(({ create }) =>
          Promise.resolve({
            id: "case-1",
            ...create,
            item: {
              ...itemShape(create.itemId),
              sellerId: "seller-1",
              seller: { id: "seller-1", name: "卖家一" },
            },
          }),
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
      data: expect.objectContaining({
        accountId: "manager-1",
        action: "share",
        itemId: "item-1",
      }),
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
    const { service } = fixture();
    await expect(
      service.send({
        senderId: "manager-1",
        recipientId: "manager-2",
        text: "  ",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
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

  it("creates a share round with per-item targets and copied progress", async () => {
    const { service } = fixture();
    const round = await service.createShareRound({
      accountId: "manager-1",
      note: "第一轮",
      items: [
        { itemId: "item-1", targetPriceYen: 900 },
        { itemId: "item-2" },
      ],
    });
    expect(round).toMatchObject({
      id: "round-1",
      note: "第一轮",
      copiedCount: 0,
      total: 2,
      targetTotalYen: null,
    });
    expect(round.items[0]).toMatchObject({
      itemId: "item-1",
      targetPriceYen: 900,
      item: expect.objectContaining({ id: "item-1" }),
    });
    expect(round.items[1]).toMatchObject({
      itemId: "item-2",
      targetPriceYen: null,
    });
  });

  it("rejects share rounds without items or with missing products", async () => {
    const { service } = fixture();
    await expect(
      service.createShareRound({ accountId: "manager-1", items: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createShareRound({
        accountId: "manager-1",
        items: [{ itemId: "missing" }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("sends a bundle as a share round without the text prefix", async () => {
    const { service, prisma } = fixture();
    const saved = await service.send({
      senderId: "manager-1",
      recipientId: "manager-2",
      text: "看看这一组",
      itemIds: ["item-1", "item-2"],
      itemTargets: { "item-1": 900, "item-2": 1800 },
    });
    expect(prisma.shareRound.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdById: "manager-1",
          items: {
            create: [
              { itemId: "item-1", targetPriceYen: 900 },
              { itemId: "item-2", targetPriceYen: 1800 },
            ],
          },
        }),
      }),
    );
    expect(prisma.directMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          text: "看看这一组",
          roundId: "round-1",
        }),
      }),
    );
    expect(saved.text).toBe("看看这一组");
    expect(saved.text).not.toContain("[[BUNDLE:");
    expect(saved.roundId).toBe("round-1");
    expect(saved.targetPriceYen).toBe(2700);
    expect(saved).toMatchObject({
      bundleItemTargets: { "item-1": 900, "item-2": 1800 },
    });
    expect(saved.bundleItems).toHaveLength(2);
    expect(saved.bundleItems[0]).toMatchObject({
      id: "item-1",
      targetPriceYen: 900,
    });
    expect(saved.bundleItems[1]).toMatchObject({
      id: "item-2",
      targetPriceYen: 1800,
    });
  });

  it("still parses the legacy bundle text prefix on read", async () => {
    const { service, prisma } = fixture();
    prisma.directMessage.findMany.mockResolvedValueOnce([
      {
        id: "message-legacy",
        senderId: "manager-2",
        recipientId: "manager-1",
        text: '[[BUNDLE:{"itemIds":["item-1","item-2"],"targetPriceYen":2500}]]\n老打包消息',
        itemId: "item-1",
        roundId: null,
        replyTo: null,
        reactions: [],
        item: itemShape("item-1"),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const result = await service.messages("manager-1");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      text: "老打包消息",
      targetPriceYen: 2500,
    });
    expect(
      result.messages[0]?.bundleItems.map(
        (entry) => (entry as { id: string }).id,
      ),
    ).toEqual(["item-1", "item-2"]);
  });

  it("updates copied state and target price on a round item", async () => {
    const { service } = fixture();
    await service.createShareRound({
      accountId: "manager-1",
      items: [{ itemId: "item-1", targetPriceYen: 900 }],
    });
    const copied = await service.updateShareRoundItem("round-1", "item-1", {
      accountId: "manager-2",
      copied: true,
    });
    expect(copied.copiedAt).toBeInstanceOf(Date);
    const retargeted = await service.updateShareRoundItem(
      "round-1",
      "item-1",
      { accountId: "manager-2", targetPriceYen: 750 },
    );
    expect(retargeted.targetPriceYen).toBe(750);
    const cleared = await service.updateShareRoundItem("round-1", "item-1", {
      accountId: "manager-2",
      copied: false,
      targetPriceYen: null,
    });
    expect(cleared.copiedAt).toBeNull();
    expect(cleared.targetPriceYen).toBeNull();
    await expect(
      service.updateShareRoundItem("round-1", "item-2", {
        accountId: "manager-2",
        copied: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("records a want decision without touching cases or the item", async () => {
    const { service, prisma } = fixture();
    const saved = await service.setDecision({
      accountId: "manager-2",
      itemId: "item-1",
      status: "want",
      messageId: "message-1",
    });
    expect(saved).toMatchObject({
      itemId: "item-1",
      status: "want",
      decidedById: "manager-2",
      decidedByName: "王",
    });
    expect(prisma.itemDecision.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { itemId: "item-1" },
        create: expect.objectContaining({
          status: "want",
          sourceMessageId: "message-1",
          sourceRoundId: null,
        }),
      }),
    );
    expect(prisma.negotiationCase.upsert).not.toHaveBeenCalled();
    expect(prisma.item.update).not.toHaveBeenCalled();
  });

  it("overwrites the previous decision when the decider changes their mind", async () => {
    const { service, prisma } = fixture();
    await service.setDecision({
      accountId: "manager-2",
      itemId: "item-1",
      status: "want",
    });
    prisma.shareRound.findUnique.mockResolvedValueOnce({ id: "round-1" });
    const saved = await service.setDecision({
      accountId: "manager-1",
      itemId: "item-1",
      status: "bought",
      roundId: "round-1",
    });
    expect(saved).toMatchObject({ status: "bought", decidedByName: "龙" });
    expect(prisma.itemDecision.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { itemId: "item-1" },
        update: expect.objectContaining({
          status: "bought",
          decidedById: "manager-1",
          decidedAt: expect.any(Date),
          sourceRoundId: "round-1",
          sourceMessageId: null,
        }),
      }),
    );
  });

  it("opens or reopens an in-progress negotiation case for a negotiate decision", async () => {
    const { service, prisma } = fixture();
    await service.setDecision({
      accountId: "manager-2",
      itemId: "item-1",
      status: "negotiate",
    });
    expect(prisma.negotiationCase.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { itemId: "item-1" },
        create: expect.objectContaining({
          itemId: "item-1",
          initiatedById: "manager-2",
          status: "in_progress",
          statusChangedAt: expect.any(Date),
        }),
        update: expect.objectContaining({
          status: "in_progress",
          statusChangedAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.item.update).not.toHaveBeenCalled();
  });

  it("applies the not-interested effect for a pass decision and closes an open case as moved to disliked", async () => {
    const { service, prisma } = fixture();
    prisma.negotiationCase.findUnique.mockResolvedValue({
      id: "case-1",
      itemId: "item-1",
      status: "in_progress",
    });
    await service.setDecision({
      accountId: "manager-2",
      itemId: "item-1",
      status: "pass",
    });
    expect(prisma.item.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "item-1" },
        data: expect.objectContaining({
          favorite: false,
          ignored: true,
          ignoredAt: expect.any(Date),
          ignoredReason: "manual",
        }),
      }),
    );
    expect(prisma.managerActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: "manager-2",
        action: "dislike",
        itemId: "item-1",
      }),
    });
    expect(prisma.negotiationCase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { itemId: "item-1" },
        data: expect.objectContaining({
          status: "moved_to_disliked",
          statusChangedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("leaves a finished negotiation case alone for a pass decision", async () => {
    const { service, prisma } = fixture();
    prisma.negotiationCase.findUnique.mockResolvedValue({
      id: "case-1",
      itemId: "item-1",
      status: "success",
    });
    await service.setDecision({
      accountId: "manager-2",
      itemId: "item-1",
      status: "pass",
    });
    expect(prisma.negotiationCase.update).not.toHaveBeenCalled();
  });

  it("rejects decisions for unknown items, rounds, messages and statuses", async () => {
    const { service, prisma } = fixture();
    prisma.item.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.setDecision({
        accountId: "manager-2",
        itemId: "missing",
        status: "want",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    prisma.shareRound.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.setDecision({
        accountId: "manager-2",
        itemId: "item-1",
        status: "want",
        roundId: "missing",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    prisma.directMessage.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.setDecision({
        accountId: "manager-2",
        itemId: "item-1",
        status: "want",
        messageId: "missing",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.setDecision({
        accountId: "manager-2",
        itemId: "item-1",
        status: "maybe" as never,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.setDecision({
        accountId: "outsider",
        itemId: "item-1",
        status: "want",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("lists decisions with decider names", async () => {
    const { service, prisma } = fixture();
    prisma.itemDecision.findMany.mockResolvedValueOnce([
      {
        itemId: "item-1",
        status: "negotiate",
        decidedById: "manager-2",
        decidedAt: new Date("2026-10-25T01:24:00.000Z"),
        decidedBy: { displayName: "王" },
      },
    ]);
    await expect(service.decisions("manager-1")).resolves.toMatchObject({
      decisions: [
        {
          itemId: "item-1",
          status: "negotiate",
          decidedById: "manager-2",
          decidedByName: "王",
        },
      ],
    });
  });

  it("threads decisions into message items and share round rows", async () => {
    const { service, prisma } = fixture();
    const decidedAt = new Date("2026-10-25T01:24:00.000Z");
    prisma.itemDecision.findMany.mockResolvedValue([
      {
        itemId: "item-1",
        status: "negotiate",
        decidedById: "manager-2",
        decidedAt,
        decidedBy: { displayName: "王" },
      },
    ]);
    prisma.directMessage.findMany.mockResolvedValueOnce([
      {
        id: "message-1",
        senderId: "manager-1",
        recipientId: "manager-2",
        text: "看看这个",
        itemId: "item-1",
        roundId: null,
        replyTo: null,
        reactions: [],
        item: itemShape("item-1"),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const result = await service.messages("manager-2");
    expect(result.messages[0]).toMatchObject({
      item: {
        id: "item-1",
        decision: { status: "negotiate", decidedByName: "王" },
      },
      bundleItems: [
        { id: "item-1", decision: { status: "negotiate" } },
      ],
    });

    await service.createShareRound({
      accountId: "manager-1",
      items: [{ itemId: "item-1" }, { itemId: "item-2" }],
    });
    const listed = await service.shareRounds("manager-2");
    expect(listed.rounds[0]?.items[0]).toMatchObject({
      itemId: "item-1",
      decision: { status: "negotiate", decidedByName: "王" },
      item: { id: "item-1", decision: { status: "negotiate" } },
    });
    expect(listed.rounds[0]?.items[1]).toMatchObject({
      itemId: "item-2",
      decision: null,
      item: { id: "item-2", decision: null },
    });
  });

  it("lists share rounds newest first with copied counts", async () => {
    const { service } = fixture();
    await service.createShareRound({
      accountId: "manager-1",
      items: [
        { itemId: "item-1", targetPriceYen: 900 },
        { itemId: "item-2", targetPriceYen: 100 },
      ],
    });
    await service.updateShareRoundItem("round-1", "item-2", {
      accountId: "manager-2",
      copied: true,
    });
    const listed = await service.shareRounds("manager-2");
    expect(listed.rounds).toHaveLength(1);
    expect(listed.rounds[0]).toMatchObject({
      copiedCount: 1,
      total: 2,
      targetTotalYen: 1000,
    });
  });
});
