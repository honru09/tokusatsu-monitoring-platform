import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import type {
  MarkDirectMessagesReadDto,
  MessageReactionDto,
  SendDirectMessageDto,
  StartNegotiationsDto,
  UpdateNegotiationDto,
} from "./collaboration.dto.js";

const sharedCartKey = "shared-procurement-workspace";

const allowedReactions = new Set([
  "heart",
  "agree",
  "check",
  "knife",
  "like",
  "negotiation_success",
  "negotiation_failed",
]);

const BUNDLE_META_PREFIX = "[[BUNDLE:";
const BUNDLE_META_SUFFIX = "]]";

interface BundleMessageMetadata {
  itemIds: string[];
  targetPriceYen?: number | null;
}

function encodeBundleMessageText(
  text: string | null | undefined,
  itemIds: string[],
  targetPriceYen?: number | null,
): string | null {
  const cleanText = text?.trim() || null;
  if (itemIds.length <= 1 && !targetPriceYen) {
    return cleanText;
  }
  const meta: BundleMessageMetadata = {
    itemIds,
    ...(targetPriceYen && targetPriceYen > 0 ? { targetPriceYen } : {}),
  };
  const header = `${BUNDLE_META_PREFIX}${JSON.stringify(meta)}${BUNDLE_META_SUFFIX}`;
  return cleanText ? `${header}\n${cleanText}` : header;
}

function parseBundleMessageText(rawText: string | null | undefined): {
  cleanText: string | null;
  itemIds: string[];
  targetPriceYen: number | null;
} {
  if (!rawText || !rawText.startsWith(BUNDLE_META_PREFIX)) {
    return {
      cleanText: rawText ?? null,
      itemIds: [],
      targetPriceYen: null,
    };
  }
  const endIndex = rawText.indexOf(BUNDLE_META_SUFFIX);
  if (endIndex === -1) {
    return {
      cleanText: rawText,
      itemIds: [],
      targetPriceYen: null,
    };
  }
  const jsonPart = rawText.slice(BUNDLE_META_PREFIX.length, endIndex);
  const rest = rawText.slice(endIndex + BUNDLE_META_SUFFIX.length).replace(/^\n/, "");
  try {
    const parsed = JSON.parse(jsonPart) as Partial<BundleMessageMetadata>;
    const itemIds = Array.isArray(parsed.itemIds)
      ? parsed.itemIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    const targetPriceYen =
      typeof parsed.targetPriceYen === "number" && parsed.targetPriceYen > 0
        ? Math.round(parsed.targetPriceYen)
        : null;
    return {
      cleanText: rest.trim() || null,
      itemIds,
      targetPriceYen,
    };
  } catch {
    return {
      cleanText: rawText,
      itemIds: [],
      targetPriceYen: null,
    };
  }
}

const messageItemInclude = {
  source: true,
  seller: true,
  images: { orderBy: { position: "asc" as const } },
  product: true,
} as const;

const messageInclude = {
  sender: true,
  recipient: true,
  item: {
    include: messageItemInclude,
  },
  replyTo: {
    include: {
      sender: true,
      item: {
        include: {
          source: true,
          seller: true,
          images: { orderBy: { position: "asc" as const } },
        },
      },
    },
  },
  reactions: {
    include: { account: true },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

const negotiationInclude = {
  initiatedBy: true,
  item: {
    include: messageItemInclude,
  },
} as const;

@Injectable()
export class CollaborationService {
  constructor(private readonly prisma: PrismaService) {}

  async accounts(accountId?: string) {
    const now = new Date();
    const onlineSince = new Date(now.getTime() - 65_000);
    const [accounts, activities, unreadCount] = await Promise.all([
      this.prisma.managerAccount.findMany({
        where: { active: true },
        orderBy: { position: "asc" },
      }),
      this.prisma.managerActivity.groupBy({
        by: ["accountId", "action"],
        where: { action: { in: ["share", "favorite", "dislike"] } },
        _sum: { count: true },
      }),
      accountId
        ? this.prisma.directMessage.count({
            where: { recipientId: accountId, readAt: null },
          })
        : Promise.resolve(0),
    ]);
    const statsByAccount = new Map<
      string,
      { shares: number; favorites: number; dislikes: number }
    >();
    for (const activity of activities) {
      const stats = statsByAccount.get(activity.accountId) ?? {
        shares: 0,
        favorites: 0,
        dislikes: 0,
      };
      const count = activity._sum.count ?? 0;
      if (activity.action === "share") stats.shares += count;
      if (activity.action === "favorite") stats.favorites += count;
      if (activity.action === "dislike") stats.dislikes += count;
      statsByAccount.set(activity.accountId, stats);
    }
    return {
      accounts: accounts.map((account) => ({
        ...account,
        online: Boolean(
          account.lastSeenAt &&
            account.lastSeenAt.getTime() >= onlineSince.getTime(),
        ),
        stats: statsByAccount.get(account.id) ?? {
          shares: 0,
          favorites: 0,
          dislikes: 0,
        },
      })),
      unreadCount,
      serverTime: now.toISOString(),
    };
  }

  async presence(accountId: string) {
    await this.requireAccount(accountId);
    await this.prisma.managerAccount.update({
      where: { id: accountId },
      data: { lastSeenAt: new Date() },
    });
    return this.accounts(accountId);
  }

  async messages(accountId: string, after?: string) {
    await this.requireAccount(accountId);
    const conversation = {
      OR: [{ senderId: accountId }, { recipientId: accountId }],
    };
    const afterDate = after ? new Date(after) : null;
    if (afterDate && Number.isNaN(afterDate.getTime())) {
      throw new BadRequestException("消息游标无效");
    }

    const rawMessages = afterDate
      ? await this.prisma.directMessage.findMany({
          where: { AND: [conversation, { updatedAt: { gte: afterDate } }] },
          include: messageInclude,
          orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
          take: 200,
        })
      : (
          await this.prisma.directMessage.findMany({
            where: conversation,
            include: messageInclude,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 80,
          })
        ).reverse();

    const messages = await this.hydrateMessages(rawMessages);

    return {
      messages,
      nextAfter:
        rawMessages.reduce<string | null>((latest, message) => {
          const value = message.updatedAt.toISOString();
          return !latest || value > latest ? value : latest;
        }, null) ??
        after ??
        null,
      serverTime: new Date().toISOString(),
    };
  }

  async send(body: SendDirectMessageDto) {
    const cleanText = body.text?.trim() || null;
    const requestedItemIds = [
      ...new Set(
        [
          ...(body.itemIds ?? []),
          ...(body.itemId ? [body.itemId] : []),
        ].filter((id): id is string => Boolean(id && id.trim())),
      ),
    ];
    const primaryItemId = requestedItemIds[0] ?? undefined;
    if (!cleanText && !primaryItemId) {
      throw new BadRequestException("消息需要文字或商品");
    }
    if (body.senderId === body.recipientId) {
      throw new BadRequestException("请选择另一位管理者");
    }
    await Promise.all([
      this.requireAccount(body.senderId),
      this.requireAccount(body.recipientId),
    ]);
    if (requestedItemIds.length > 0) {
      const found = await this.prisma.item.findMany({
        where: { id: { in: requestedItemIds } },
        select: { id: true },
      });
      if (found.length !== requestedItemIds.length) {
        throw new NotFoundException("商品不存在");
      }
    }
    await this.requireConversationMessage(
      body.replyToId,
      body.senderId,
      body.recipientId,
      "引用消息不存在",
    );
    await this.requireConversationMessage(
      body.forwardedFromId,
      body.senderId,
      body.recipientId,
      "转发消息不存在",
    );

    const encodedText = encodeBundleMessageText(
      cleanText,
      requestedItemIds,
      body.targetPriceYen,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const message = await tx.directMessage.create({
        data: {
          senderId: body.senderId,
          recipientId: body.recipientId,
          text: encodedText,
          itemId: primaryItemId,
          replyToId: body.replyToId,
          forwardedFromId: body.forwardedFromId,
        },
        include: messageInclude,
      });
      // Sending a product or bundle into the shared conversation records the share count.
      if (primaryItemId) {
        await tx.managerActivity.create({
          data: {
            accountId: body.senderId,
            action: "share",
            itemId: primaryItemId,
            count: requestedItemIds.length,
          },
        });
      }
      return message;
    });
    const [hydrated] = await this.hydrateMessages([created]);
    return hydrated;
  }

  async markRead(body: MarkDirectMessagesReadDto) {
    await this.requireAccount(body.accountId);
    const result = await this.prisma.directMessage.updateMany({
      where: {
        recipientId: body.accountId,
        readAt: null,
        ...(body.messageIds?.length
          ? { id: { in: body.messageIds.slice(0, 200) } }
          : {}),
      },
      data: { readAt: new Date(), updatedAt: new Date() },
    });
    return { updated: result.count };
  }

  async addReaction(messageId: string, body: MessageReactionDto) {
    if (!allowedReactions.has(body.reaction)) {
      throw new BadRequestException("不支持的互动");
    }
    const message = await this.requireMessageParticipant(
      messageId,
      body.accountId,
    );
    const reaction = await this.prisma.messageReaction.upsert({
      where: {
        messageId_accountId_reaction: {
          messageId: message.id,
          accountId: body.accountId,
          reaction: body.reaction,
        },
      },
      create: { messageId, accountId: body.accountId, reaction: body.reaction },
      update: {},
      include: { account: true },
    });
    await this.prisma.directMessage.update({
      where: { id: messageId },
      data: { updatedAt: new Date() },
    });
    const negotiationStatus =
      body.reaction === "knife"
        ? "in_progress"
        : body.reaction === "negotiation_success"
          ? "success"
          : body.reaction === "negotiation_failed"
            ? "failed"
            : null;
    if (negotiationStatus) {
      const parsed = parseBundleMessageText(message.text);
      const targetItemIds = [
        ...new Set(
          [
            ...parsed.itemIds,
            ...(message.itemId ? [message.itemId] : []),
          ].filter(Boolean),
        ),
      ];
      const now = new Date();
      for (const itemId of targetItemIds) {
        await this.prisma.negotiationCase.upsert({
          where: { itemId },
          create: {
            itemId,
            initiatedById: body.accountId,
            status: negotiationStatus,
            statusChangedAt: now,
          },
          update: {
            status: negotiationStatus,
            statusChangedAt: now,
          },
        });
      }
    }
    return reaction;
  }

  async removeReaction(messageId: string, body: MessageReactionDto) {
    await this.requireMessageParticipant(messageId, body.accountId);
    const result = await this.prisma.messageReaction.deleteMany({
      where: { messageId, accountId: body.accountId, reaction: body.reaction },
    });
    await this.prisma.directMessage.update({
      where: { id: messageId },
      data: { updatedAt: new Date() },
    });
    return { removed: result.count > 0 };
  }

  async negotiations(accountId: string) {
    await this.requireAccount(accountId);
    const cases = await this.prisma.negotiationCase.findMany({
      where: { status: { in: ["in_progress", "success", "failed"] } },
      include: negotiationInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 300,
    });
    return {
      cases,
      counts: {
        inProgress: cases.filter((entry) => entry.status === "in_progress")
          .length,
        success: cases.filter((entry) => entry.status === "success").length,
        failed: cases.filter((entry) => entry.status === "failed").length,
      },
      serverTime: new Date().toISOString(),
    };
  }

  async clearFailedNegotiations(accountId: string) {
    const manager = await this.requireAccount(accountId);
    const failed = await this.prisma.negotiationCase.findMany({
      where: { status: "failed" },
      select: { id: true, itemId: true },
      take: 5000,
    });
    if (!failed.length)
      return { moved: 0, serverTime: new Date().toISOString() };

    const now = new Date();
    const ids = failed.map((entry) => entry.id);
    const itemIds = failed.map((entry) => entry.itemId);
    const moved = await this.prisma.$transaction(async (tx) => {
      const items = await tx.item.updateMany({
        where: {
          id: { in: itemIds },
          archivedAt: null,
          purchaseRecord: null,
        },
        data: {
          favorite: false,
          ignored: true,
          ignoredAt: now,
          ignoredReason: "negotiation_failed",
        },
      });
      await tx.negotiationCase.updateMany({
        where: { id: { in: ids }, status: "failed" },
        data: { status: "moved_to_disliked", statusChangedAt: now },
      });
      if (items.count) {
        await tx.managerActivity.create({
          data: {
            accountId: manager.id,
            action: "dislike",
            count: items.count,
          },
        });
      }
      return items.count;
    });
    return { moved, serverTime: now.toISOString() };
  }

  async startNegotiations(body: StartNegotiationsDto) {
    const manager = await this.requireAccount(body.accountId);
    const recipient = await this.prisma.managerAccount.findFirst({
      where: { active: true, id: { not: manager.id } },
      orderBy: { position: "asc" },
    });
    if (!recipient) throw new BadRequestException("另一位管理者账号不可用");
    const requestedIds = [...new Set(body.itemIds?.filter(Boolean) ?? [])];
    const cart = await this.prisma.shoppingCart.findUnique({
      where: { key: sharedCartKey },
      select: {
        id: true,
        items: {
          where: requestedIds.length ? { itemId: { in: requestedIds } } : {},
          select: { itemId: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    const itemIds = cart?.items.map((entry) => entry.itemId) ?? [];
    if (!cart || !itemIds.length)
      throw new NotFoundException("购物车中没有可发起砍价的商品");
    const now = new Date();
    const cases = await this.prisma.$transaction(async (tx) => {
      const rows = [];
      for (const itemId of itemIds) {
        const negotiation = await tx.negotiationCase.upsert({
          where: { itemId },
          create: {
            itemId,
            initiatedById: manager.id,
            status: "in_progress",
            statusChangedAt: now,
          },
          update: {
            initiatedById: manager.id,
            status: "in_progress",
            statusChangedAt: now,
          },
          include: negotiationInclude,
        });
        rows.push(negotiation);
      }
      // Group items by seller so same-seller items are sent as one bundle negotiation card
      const groupedBySeller = new Map<string, string[]>();
      for (const negotiation of rows) {
        const key = negotiation.item.sellerId ?? `single:${negotiation.itemId}`;
        const list = groupedBySeller.get(key) ?? [];
        list.push(negotiation.itemId);
        groupedBySeller.set(key, list);
      }
      for (const groupItemIds of groupedBySeller.values()) {
        const primaryItemId = groupItemIds[0];
        if (!primaryItemId) continue;
        const label =
          groupItemIds.length > 1
            ? `🔪 发起同店合并砍价（共 ${groupItemIds.length} 件）`
            : "🔪 发起砍价";
        await tx.directMessage.create({
          data: {
            senderId: manager.id,
            recipientId: recipient.id,
            text: encodeBundleMessageText(label, groupItemIds),
            itemId: primaryItemId,
          },
        });
      }
      await tx.shoppingCartItem.deleteMany({
        where: { cartId: cart.id, itemId: { in: itemIds } },
      });
      return rows;
    });
    return { cases, moved: cases.length, serverTime: now.toISOString() };
  }

  async updateNegotiation(caseId: string, body: UpdateNegotiationDto) {
    const manager = await this.requireAccount(body.accountId);
    const current = await this.prisma.negotiationCase.findUnique({
      where: { id: caseId },
      select: { id: true, itemId: true },
    });
    if (!current) throw new NotFoundException("砍价任务不存在");
    const recipient = await this.prisma.managerAccount.findFirst({
      where: { active: true, id: { not: manager.id } },
      orderBy: { position: "asc" },
    });
    const now = new Date();
    const negotiation = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.negotiationCase.update({
        where: { id: caseId },
        data: { status: body.status, statusChangedAt: now },
        include: negotiationInclude,
      });
      if (recipient) {
        const label =
          body.status === "success"
            ? "✅ 砍价成功"
            : body.status === "failed"
              ? "❌ 砍价失败"
              : "🔪 继续砍价";
        await tx.directMessage.create({
          data: {
            senderId: manager.id,
            recipientId: recipient.id,
            text: label,
            itemId: current.itemId,
          },
        });
      }
      return updated;
    });
    return { negotiation, serverTime: now.toISOString() };
  }

  private async hydrateMessages<
    T extends {
      text: string | null;
      itemId: string | null;
      item: unknown;
      replyTo?: { text: string | null } | null;
    },
  >(messages: T[]) {
    if (!messages.length) return [];
    const parsedByIndex = messages.map((msg) => parseBundleMessageText(msg.text));
    const extraItemIds = new Set<string>();
    for (let i = 0; i < messages.length; i++) {
      const parsed = parsedByIndex[i];
      if (!parsed) continue;
      for (const id of parsed.itemIds) {
        extraItemIds.add(id);
      }
    }
    const itemsById = new Map<string, unknown>();
    if (extraItemIds.size > 0) {
      const fetched = await this.prisma.item.findMany({
        where: { id: { in: [...extraItemIds] } },
        include: messageItemInclude,
      });
      for (const item of fetched) {
        itemsById.set(item.id, item);
      }
    }
    return messages.map((msg, index) => {
      const parsed = parsedByIndex[index] ?? {
        cleanText: msg.text,
        itemIds: [],
        targetPriceYen: null,
      };
      const bundleItems = parsed.itemIds
        .map((id) => itemsById.get(id) ?? (msg.itemId === id ? msg.item : null))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      const replyTo = msg.replyTo
        ? {
            ...msg.replyTo,
            text: parseBundleMessageText(msg.replyTo.text).cleanText,
          }
        : msg.replyTo;
      return {
        ...msg,
        text: parsed.cleanText,
        replyTo,
        bundleItems:
          bundleItems.length > 0
            ? bundleItems
            : msg.item
              ? [msg.item]
              : [],
        targetPriceYen: parsed.targetPriceYen,
      };
    });
  }

  private async requireAccount(id: string) {
    const account = await this.prisma.managerAccount.findFirst({
      where: { id, active: true },
    });
    if (!account) throw new BadRequestException("管理者账号无效");
    return account;
  }

  private async requireMessageParticipant(
    messageId: string,
    accountId: string,
  ) {
    await this.requireAccount(accountId);
    const message = await this.prisma.directMessage.findFirst({
      where: {
        id: messageId,
        OR: [{ senderId: accountId }, { recipientId: accountId }],
      },
      select: { id: true, itemId: true, text: true },
    });
    if (!message) throw new NotFoundException("消息不存在");
    return message;
  }

  private async requireConversationMessage(
    messageId: string | undefined,
    senderId: string,
    recipientId: string,
    error: string,
  ) {
    if (!messageId) return;
    const message = await this.prisma.directMessage.findFirst({
      where: {
        id: messageId,
        OR: [
          { senderId, recipientId },
          { senderId: recipientId, recipientId: senderId },
        ],
      },
      select: { id: true },
    });
    if (!message) throw new NotFoundException(error);
  }
}
