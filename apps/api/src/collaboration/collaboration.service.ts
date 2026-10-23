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

const messageInclude = {
  sender: true,
  recipient: true,
  item: {
    include: {
      source: true,
      images: { orderBy: { position: "asc" as const } },
      product: true,
    },
  },
  replyTo: {
    include: {
      sender: true,
      item: {
        include: {
          source: true,
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
    include: {
      source: true,
      images: { orderBy: { position: "asc" as const } },
      product: true,
    },
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

    const messages = afterDate
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

    return {
      messages,
      nextAfter:
        messages.reduce<string | null>((latest, message) => {
          const value = message.updatedAt.toISOString();
          return !latest || value > latest ? value : latest;
        }, null) ??
        after ??
        null,
      serverTime: new Date().toISOString(),
    };
  }

  async send(body: SendDirectMessageDto) {
    const text = body.text?.trim() || null;
    if (!text && !body.itemId) {
      throw new BadRequestException("消息需要文字或商品");
    }
    if (body.senderId === body.recipientId) {
      throw new BadRequestException("请选择另一位管理者");
    }
    await Promise.all([
      this.requireAccount(body.senderId),
      this.requireAccount(body.recipientId),
    ]);
    if (body.itemId) {
      const item = await this.prisma.item.findUnique({
        where: { id: body.itemId },
        select: { id: true },
      });
      if (!item) throw new NotFoundException("商品不存在");
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

    return this.prisma.$transaction(async (tx) => {
      const message = await tx.directMessage.create({
        data: {
          senderId: body.senderId,
          recipientId: body.recipientId,
          text,
          itemId: body.itemId,
          replyToId: body.replyToId,
          forwardedFromId: body.forwardedFromId,
        },
        include: messageInclude,
      });
      // Sending a product into the shared conversation is a real forwarding
      // action, whether it originates from a card or another message.
      if (body.itemId) {
        await tx.managerActivity.create({
          data: {
            accountId: body.senderId,
            action: "share",
            itemId: body.itemId,
          },
        });
      }
      return message;
    });
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
    if (negotiationStatus && message.itemId) {
      await this.prisma.negotiationCase.upsert({
        where: { itemId: message.itemId },
        create: {
          itemId: message.itemId,
          initiatedById: body.accountId,
          status: negotiationStatus,
          statusChangedAt: new Date(),
        },
        update: {
          status: negotiationStatus,
          statusChangedAt: new Date(),
        },
      });
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
        await tx.directMessage.create({
          data: {
            senderId: manager.id,
            recipientId: recipient.id,
            text: "🔪 发起砍价",
            itemId,
          },
        });
        rows.push(negotiation);
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
      select: { id: true, itemId: true },
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
