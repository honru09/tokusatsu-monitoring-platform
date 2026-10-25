import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { PushService } from "../push/push.service.js";
import type {
  CreateShareRoundDto,
  MarkDirectMessagesReadDto,
  MarkShareRoundCopiedDto,
  MessageReactionDto,
  SendDirectMessageDto,
  SetItemDecisionDto,
  StartNegotiationsDto,
  UpdateNegotiationDto,
  UpdateShareRoundItemDto,
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

const shareRoundInclude = {
  createdBy: true,
  items: {
    include: { item: { include: messageItemInclude } },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

type ShareRoundRow = {
  id: string;
  targetPriceYen: number | null;
  copiedAt: Date | null;
  itemId: string;
  item?: unknown;
};

type ShareRoundWithItems = {
  id: string;
  note: string | null;
  createdById: string;
  createdBy?: unknown;
  createdAt: Date;
  updatedAt: Date;
  items?: ShareRoundRow[];
};

const decisionStatuses = ["want", "negotiate", "pass", "bought"] as const;

type DecisionRow = {
  itemId: string;
  status: string;
  decidedById: string;
  decidedAt: Date;
  decidedBy?: { displayName?: string | null } | null;
};

function presentDecision(row: DecisionRow) {
  return {
    itemId: row.itemId,
    status: row.status,
    decidedById: row.decidedById,
    decidedByName: row.decidedBy?.displayName ?? null,
    decidedAt: row.decidedAt,
  };
}

type DecisionInfo = ReturnType<typeof presentDecision>;

function presentShareRound(
  round: ShareRoundWithItems,
  decisions?: Map<string, DecisionInfo>,
) {
  const items = (round.items ?? []).map((entry) => {
    const decision = decisions?.get(entry.itemId) ?? null;
    const item =
      entry.item && typeof entry.item === "object"
        ? { ...(entry.item as Record<string, unknown>), decision }
        : entry.item;
    return { ...entry, decision, item };
  });
  const targets = items.map((entry) => entry.targetPriceYen);
  return {
    ...round,
    items,
    copiedCount: items.filter((entry) => entry.copiedAt).length,
    total: items.length,
    targetTotalYen:
      items.length > 0 && targets.every((value) => typeof value === "number")
        ? targets.reduce((sum, value) => sum + (value ?? 0), 0)
        : null,
  };
}

const messageInclude = {
  sender: true,
  recipient: true,
  item: {
    include: messageItemInclude,
  },
  round: {
    include: shareRoundInclude,
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
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly push?: PushService,
  ) {}

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

    // Per-item targets arrive as a plain map keyed by item id. Keep only
    // positive whole yen values for items that are actually being sent.
    const itemTargets = new Map<string, number>();
    for (const itemId of requestedItemIds) {
      const raw = body.itemTargets?.[itemId];
      if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
        itemTargets.set(itemId, Math.round(raw));
      }
    }
    // A bundle (or any send carrying target prices) becomes a share round so
    // membership and per-item targets live in rows, not in the message text.
    // Plain single-item shares keep the legacy shape.
    const useRound =
      requestedItemIds.length > 0 &&
      (requestedItemIds.length > 1 ||
        itemTargets.size > 0 ||
        Boolean(body.targetPriceYen));
    if (useRound && body.targetPriceYen && itemTargets.size === 0) {
      // Legacy callers only know the bundle-level target; keep it on the
      // primary item so the round rows still carry a target price.
      const primary = requestedItemIds[0];
      if (primary) itemTargets.set(primary, Math.round(body.targetPriceYen));
    }

    const encodedText = useRound
      ? cleanText
      : encodeBundleMessageText(
          cleanText,
          requestedItemIds,
          body.targetPriceYen,
        );

    const created = await this.prisma.$transaction(async (tx) => {
      let roundId: string | undefined;
      if (useRound) {
        const round = await tx.shareRound.create({
          data: {
            createdById: body.senderId,
            items: {
              create: requestedItemIds.map((itemId) => ({
                itemId,
                targetPriceYen: itemTargets.get(itemId) ?? null,
              })),
            },
          },
        });
        roundId = round.id;
      }
      const message = await tx.directMessage.create({
        data: {
          senderId: body.senderId,
          recipientId: body.recipientId,
          text: encodedText,
          itemId: primaryItemId,
          roundId,
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
    if (primaryItemId) {
      const item = (
        hydrated as
          | { item?: { titleZh?: string | null; titleRaw?: string | null } | null }
          | undefined
      )?.item;
      const itemTitle = item?.titleZh?.trim() || item?.titleRaw?.trim() || null;
      this.notifyShare(body.recipientId, requestedItemIds.length, itemTitle);
    }
    return hydrated;
  }

  async createShareRound(body: CreateShareRoundDto) {
    await this.requireAccount(body.accountId);
    const requested = new Map<string, number | null>();
    for (const entry of body.items ?? []) {
      if (!entry?.itemId || requested.has(entry.itemId)) continue;
      requested.set(
        entry.itemId,
        typeof entry.targetPriceYen === "number" &&
          Number.isFinite(entry.targetPriceYen) &&
          entry.targetPriceYen > 0
          ? Math.round(entry.targetPriceYen)
          : null,
      );
    }
    if (!requested.size) {
      throw new BadRequestException("分享轮次需要至少一件商品");
    }
    const found = await this.prisma.item.findMany({
      where: { id: { in: [...requested.keys()] } },
      select: { id: true },
    });
    if (found.length !== requested.size) {
      throw new NotFoundException("商品不存在");
    }
    const round = await this.prisma.shareRound.create({
      data: {
        createdById: body.accountId,
        note: body.note?.trim() || null,
        items: {
          create: [...requested.entries()].map(([itemId, targetPriceYen]) => ({
            itemId,
            targetPriceYen,
          })),
        },
      },
      include: shareRoundInclude,
    });
    this.notifyShareRoundOthers(body.accountId, requested.size);
    return presentShareRound(
      round as ShareRoundWithItems,
      await this.decisionMap(requested.keys()),
    );
  }

  /**
   * Fire-and-forget Web Push for a new share. Push is best-effort by
   * design: it never blocks or fails the share that triggered it.
   */
  private notifyShare(
    recipientId: string,
    itemCount: number,
    itemTitle: string | null,
  ) {
    if (!this.push) return;
    void this.push
      .notifyAccount(recipientId, {
        title: "搭档分享了新商品",
        body:
          itemCount > 1
            ? `共 ${itemCount} 件新商品`
            : (itemTitle ?? "有新商品分享给你"),
        url: "/?workspace=collaboration",
      })
      .catch(() => {});
  }

  private notifyShareRoundOthers(creatorId: string, itemCount: number) {
    if (!this.push) return;
    const push = this.push;
    void (async () => {
      const others = await this.prisma.managerAccount.findMany({
        where: { active: true, id: { not: creatorId } },
        select: { id: true },
      });
      for (const account of others) {
        await push.notifyAccount(account.id, {
          title: "搭档分享了新商品",
          body: `新一轮分享：共 ${itemCount} 件商品`,
          url: "/?workspace=collaboration",
        });
      }
    })().catch(() => {});
  }

  async shareRounds(accountId: string) {
    await this.requireAccount(accountId);
    const rounds = await this.prisma.shareRound.findMany({
      include: shareRoundInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    });
    const decisions = await this.decisionMap(
      rounds.flatMap((round) =>
        ((round as ShareRoundWithItems).items ?? []).map(
          (entry) => entry.itemId,
        ),
      ),
    );
    return {
      rounds: rounds.map((round) =>
        presentShareRound(round as ShareRoundWithItems, decisions),
      ),
      serverTime: new Date().toISOString(),
    };
  }

  async shareRound(accountId: string, roundId: string) {
    await this.requireAccount(accountId);
    const round = await this.prisma.shareRound.findUnique({
      where: { id: roundId },
      include: shareRoundInclude,
    });
    if (!round) throw new NotFoundException("分享轮次不存在");
    const typed = round as ShareRoundWithItems;
    return presentShareRound(
      typed,
      await this.decisionMap((typed.items ?? []).map((entry) => entry.itemId)),
    );
  }

  async updateShareRoundItem(
    roundId: string,
    itemId: string,
    body: UpdateShareRoundItemDto,
  ) {
    await this.requireAccount(body.accountId);
    const current = await this.prisma.shareRoundItem.findUnique({
      where: { roundId_itemId: { roundId, itemId } },
      select: { id: true },
    });
    if (!current) throw new NotFoundException("分享轮次商品不存在");
    const data: { copiedAt?: Date | null; targetPriceYen?: number | null } = {};
    if (typeof body.copied === "boolean") {
      data.copiedAt = body.copied ? new Date() : null;
    }
    if (body.targetPriceYen !== undefined) {
      data.targetPriceYen =
        typeof body.targetPriceYen === "number" &&
        Number.isFinite(body.targetPriceYen) &&
        body.targetPriceYen > 0
          ? Math.round(body.targetPriceYen)
          : null;
    }
    const updated = await this.prisma.shareRoundItem.update({
      where: { roundId_itemId: { roundId, itemId } },
      data,
      include: { item: { include: messageItemInclude } },
    });
    const decision = (await this.decisionMap([itemId])).get(itemId) ?? null;
    return {
      ...updated,
      decision,
      item: { ...updated.item, decision },
    };
  }

  async decisions(accountId: string) {
    await this.requireAccount(accountId);
    const rows = (await this.prisma.itemDecision.findMany({
      include: { decidedBy: true },
      orderBy: [{ decidedAt: "asc" }, { id: "asc" }],
    })) as DecisionRow[];
    return {
      decisions: rows.map((row) => presentDecision(row)),
      serverTime: new Date().toISOString(),
    };
  }

  async setDecision(body: SetItemDecisionDto) {
    if (
      !decisionStatuses.includes(
        body.status as (typeof decisionStatuses)[number],
      )
    ) {
      throw new BadRequestException("决定状态无效");
    }
    const account = await this.requireAccount(body.accountId);
    const item = await this.prisma.item.findUnique({
      where: { id: body.itemId },
      select: { id: true, ignored: true, titleZh: true, titleRaw: true },
    });
    if (!item) throw new NotFoundException("商品不存在");
    if (body.roundId) {
      const round = await this.prisma.shareRound.findUnique({
        where: { id: body.roundId },
        select: { id: true },
      });
      if (!round) throw new NotFoundException("分享轮次不存在");
    }
    if (body.messageId) {
      const message = await this.prisma.directMessage.findUnique({
        where: { id: body.messageId },
        select: { id: true },
      });
      if (!message) throw new NotFoundException("消息不存在");
    }
    const now = new Date();
    const saved = await this.prisma.$transaction(async (tx) => {
      const decision = await tx.itemDecision.upsert({
        where: { itemId: body.itemId },
        create: {
          itemId: body.itemId,
          status: body.status,
          decidedById: account.id,
          decidedAt: now,
          sourceRoundId: body.roundId ?? null,
          sourceMessageId: body.messageId ?? null,
        },
        update: {
          status: body.status,
          decidedById: account.id,
          decidedAt: now,
          sourceRoundId: body.roundId ?? null,
          sourceMessageId: body.messageId ?? null,
        },
        include: { decidedBy: true },
      });
      if (body.status === "negotiate") {
        // Same upsert startNegotiations uses for cart items: an existing
        // case in any terminal state reopens as in_progress.
        await tx.negotiationCase.upsert({
          where: { itemId: body.itemId },
          create: {
            itemId: body.itemId,
            initiatedById: account.id,
            status: "in_progress",
            statusChangedAt: now,
          },
          update: { status: "in_progress", statusChangedAt: now },
        });
      }
      if (body.status === "pass") {
        // The same effect as marking the item not-interested from the
        // item endpoints: ignored with the manual reason, favorite off.
        await tx.item.update({
          where: { id: body.itemId },
          data: {
            favorite: false,
            ignored: true,
            ignoredAt: now,
            ignoredReason: "manual",
            lifecycleStatus: "disliked",
          },
        });
        if (!item.ignored) {
          await tx.managerActivity.create({
            data: {
              accountId: account.id,
              action: "dislike",
              itemId: body.itemId,
            },
          });
        }
        // A case that is still open closes with the same terminal
        // status the failed-negotiation cleanup uses once its items
        // land in the disliked warehouse. It is not marked "failed":
        // that status is reserved for seller-side negotiation failure.
        const existing = await tx.negotiationCase.findUnique({
          where: { itemId: body.itemId },
          select: { status: true },
        });
        if (existing?.status === "in_progress") {
          await tx.negotiationCase.update({
            where: { itemId: body.itemId },
            data: { status: "moved_to_disliked", statusChangedAt: now },
          });
        }
      }
      return decision;
    });
    // Fire-and-forget Web Push to the other manager(s): a decision on a
    // shared item is the event the partner is waiting on. Like the share
    // notifications, a push failure never fails the decision itself.
    if (this.push) {
      const push = this.push;
      const itemTitle = item.titleZh?.trim() || item.titleRaw?.trim() || "商品";
      void (async () => {
        const others = await this.prisma.managerAccount.findMany({
          where: { active: true, id: { not: account.id } },
          select: { id: true },
        });
        for (const recipient of others) {
          await push
            .notifyDecision({
              itemTitle,
              status: body.status,
              deciderName: account.displayName,
              recipientAccountId: recipient.id,
            })
            .catch(() => {});
        }
      })().catch(() => {});
    }
    return presentDecision(saved);
  }

  private async decisionMap(itemIds: Iterable<string>) {
    const unique = [...new Set([...itemIds].filter(Boolean))];
    const map = new Map<string, DecisionInfo>();
    if (!unique.length) return map;
    const rows = (await this.prisma.itemDecision.findMany({
      where: { itemId: { in: unique } },
      include: { decidedBy: true },
    })) as DecisionRow[];
    for (const row of rows) map.set(row.itemId, presentDecision(row));
    return map;
  }

  async markShareRoundCopied(roundId: string, body: MarkShareRoundCopiedDto) {
    if (body.accountId) await this.requireAccount(body.accountId);
    const round = await this.prisma.shareRound.findUnique({
      where: { id: roundId },
      select: { id: true },
    });
    if (!round) throw new NotFoundException("分享轮次不存在");
    const itemIds = [...new Set((body.itemIds ?? []).filter(Boolean))];
    // Only the first copy stamps the row: re-copying a script must not
    // rewrite when the text first went out, so already-copied rows keep
    // their original copiedAt.
    await this.prisma.shareRoundItem.updateMany({
      where: {
        roundId,
        copiedAt: null,
        ...(itemIds.length ? { itemId: { in: itemIds } } : {}),
      },
      data: { copiedAt: new Date() },
    });
    const updated = await this.prisma.shareRound.findUnique({
      where: { id: roundId },
      include: shareRoundInclude,
    });
    if (!updated) throw new NotFoundException("分享轮次不存在");
    return presentShareRound(updated as ShareRoundWithItems);
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
      const roundItemIds =
        message.round?.items?.map((entry) => entry.itemId) ?? [];
      const parsed = parseBundleMessageText(message.text);
      const targetItemIds = [
        ...new Set(
          [
            ...roundItemIds,
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
          lifecycleStatus: "live",
        },
        data: {
          favorite: false,
          ignored: true,
          ignoredAt: now,
          ignoredReason: "negotiation_failed",
          lifecycleStatus: "disliked",
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
        const round = await tx.shareRound.create({
          data: {
            createdById: manager.id,
            note: label,
            items: {
              create: groupItemIds.map((itemId) => ({ itemId })),
            },
          },
        });
        await tx.directMessage.create({
          data: {
            senderId: manager.id,
            recipientId: recipient.id,
            text: label,
            itemId: primaryItemId,
            roundId: round.id,
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
      roundId?: string | null;
      round?: ShareRoundWithItems | null;
      replyTo?: {
        text: string | null;
        itemId?: string | null;
        item?: unknown;
      } | null;
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
    // Rounds usually arrive through the message include; fetch any that were
    // selected without it so hydration works for every caller.
    const roundsById = new Map<string, ShareRoundWithItems>();
    const missingRoundIds = new Set<string>();
    for (const msg of messages) {
      if (!msg.roundId) continue;
      if (msg.round?.items) roundsById.set(msg.roundId, msg.round);
      else missingRoundIds.add(msg.roundId);
    }
    if (missingRoundIds.size > 0) {
      const fetchedRounds = await this.prisma.shareRound.findMany({
        where: { id: { in: [...missingRoundIds] } },
        include: shareRoundInclude,
      });
      for (const round of fetchedRounds) {
        roundsById.set(round.id, round as ShareRoundWithItems);
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
    const decisionItemIds = new Set<string>(extraItemIds);
    for (const msg of messages) {
      if (msg.itemId) decisionItemIds.add(msg.itemId);
      if (msg.replyTo?.itemId) decisionItemIds.add(msg.replyTo.itemId);
      const round = msg.roundId ? roundsById.get(msg.roundId) : undefined;
      for (const row of round?.items ?? []) decisionItemIds.add(row.itemId);
    }
    const decisions = await this.decisionMap(decisionItemIds);
    const withDecision = (value: unknown): unknown => {
      if (!value || typeof value !== "object") return value;
      const record = value as Record<string, unknown> & { id?: string };
      return {
        ...record,
        decision:
          (typeof record.id === "string"
            ? decisions.get(record.id)
            : undefined) ?? null,
      };
    };
    return messages.map((msg, index) => {
      const parsed = parsedByIndex[index] ?? {
        cleanText: msg.text,
        itemIds: [],
        targetPriceYen: null,
      };
      const replyTo = msg.replyTo
        ? {
            ...msg.replyTo,
            text: parseBundleMessageText(msg.replyTo.text).cleanText,
            item: withDecision(msg.replyTo.item),
          }
        : msg.replyTo;
      const round = msg.roundId ? roundsById.get(msg.roundId) : undefined;
      if (round) {
        const rows = round.items ?? [];
        const bundleItems = rows
          .map((row) => {
            const item =
              row.item ??
              itemsById.get(row.itemId) ??
              (msg.itemId === row.itemId ? msg.item : null);
            return item
              ? {
                  ...(item as Record<string, unknown>),
                  targetPriceYen: row.targetPriceYen ?? null,
                  copiedAt: row.copiedAt ?? null,
                  decision: decisions.get(row.itemId) ?? null,
                }
              : null;
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
        const targets = rows.map((row) => row.targetPriceYen);
        const bundleTargetPriceYen =
          parsed.targetPriceYen ??
          (rows.length > 0 &&
          targets.every((value) => typeof value === "number")
            ? targets.reduce((sum, value) => sum + (value ?? 0), 0)
            : null);
        return {
          ...msg,
          text: parsed.cleanText,
          replyTo,
          item: withDecision(msg.item),
          roundId: round.id,
          bundleItems,
          bundleItemTargets: Object.fromEntries(
            rows.map((row) => [row.itemId, row.targetPriceYen ?? null]),
          ),
          targetPriceYen: bundleTargetPriceYen,
        };
      }
      const bundleItems = parsed.itemIds
        .map((id) => itemsById.get(id) ?? (msg.itemId === id ? msg.item : null))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .map((entry) => withDecision(entry));
      return {
        ...msg,
        text: parsed.cleanText,
        replyTo,
        item: withDecision(msg.item),
        bundleItems:
          bundleItems.length > 0
            ? bundleItems
            : msg.item
              ? [withDecision(msg.item)]
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
      select: {
        id: true,
        itemId: true,
        text: true,
        roundId: true,
        round: { select: { items: { select: { itemId: true } } } },
      },
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
