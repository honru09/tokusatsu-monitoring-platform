import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DiscoveryAction,
  ItemStatus,
  ListingType,
  Prisma,
  SourceChannel,
  ToyType,
} from "@tokusatsu/db";
import { PrismaService } from "../prisma.service.js";
import type { DiscoveryFeedbackDto } from "./discovery.dto.js";

const excludedTitleFragments = [
  "トレカ",
  "trading card",
  "card game",
  "カードダス",
  "mook",
  "magazine",
  "comic",
  "novel",
  "書籍",
  "漫画",
  "マンガ",
  "コミック",
  "写真集",
  "攻略本",
  "図鑑",
  "辞典",
  "事典",
  "図録",
  "資料集",
  "雑誌",
  "絵本",
  "小説",
  "パンフレット",
];

const feedSelect = {
  id: true,
  productId: true,
  sourceUrl: true,
  titleRaw: true,
  titleZh: true,
  priceCurrent: true,
  shippingFee: true,
  priceTotalEst: true,
  listedAt: true,
  detectedAt: true,
  auctionEndAt: true,
  listingType: true,
  categoryIp: true,
  categoryToyType: true,
  conditionGrade: true,
  quantityEst: true,
  unitCostEst: true,
  note: true,
  source: { select: { key: true, displayName: true } },
  images: {
    orderBy: { position: "asc" as const },
    select: { url: true, position: true },
  },
  product: {
    select: {
      canonicalName: true,
      titleZh: true,
      series: { select: { nameZh: true, nameJa: true } },
      toyTypeEntity: { select: { nameZh: true, nameJa: true } },
    },
  },
} satisfies Prisma.ItemSelect;

function eligibleWhere(
  excludedListingIds: string[],
  listingType?: ListingType,
): Prisma.ItemWhereInput {
  return {
    id: excludedListingIds.length ? { notIn: excludedListingIds } : undefined,
    archivedAt: null,
    channel: SourceChannel.online,
    purchaseRecord: null,
    ignored: false,
    favorite: false,
    listingType,
    categoryToyType: { not: ToyType.card },
    status: { in: [ItemStatus.active, ItemStatus.unknown] },
    NOT: excludedTitleFragments.map((fragment) => ({
      titleRaw: { contains: fragment, mode: "insensitive" as const },
    })),
  };
}

@Injectable()
export class DiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  async feed(limit: number, listingType?: "auction" | "direct") {
    const consumed = await this.prisma.discoveryFeedback.findMany({
      where: {
        action: { in: [DiscoveryAction.dislike, DiscoveryAction.favorite] },
        undoEvents: { none: {} },
      },
      distinct: ["listingId"],
      select: { listingId: true },
    });
    const where = eligibleWhere(
      consumed.map(({ listingId }) => listingId),
      listingType as ListingType | undefined,
    );
    const [items, total] = await this.prisma.$transaction([
      this.prisma.item.findMany({
        where,
        select: feedSelect,
        orderBy: [{ detectedAt: "desc" }, { listedAt: "desc" }],
        take: limit,
      }),
      this.prisma.item.count({ where }),
    ]);

    // The three-card discovery stack should expose both marketplace modes
    // when both are available. A burst of newly detected direct listings must
    // not hide auction-specific UI (especially the live countdown) behind a
    // dozen swipes, and the same applies in reverse.
    if (!listingType && limit >= 3 && items.length >= 3) {
      const topTypes = new Set(
        items.slice(0, 3).map((item) => item.listingType),
      );
      const missingType = !topTypes.has(ListingType.auction)
        ? ListingType.auction
        : !topTypes.has(ListingType.direct)
          ? ListingType.direct
          : null;

      if (missingType) {
        const existingIndex = items.findIndex(
          (item, index) => index >= 3 && item.listingType === missingType,
        );
        if (existingIndex >= 0) {
          [items[2], items[existingIndex]] = [items[existingIndex], items[2]];
        } else {
          const fallback = await this.prisma.item.findFirst({
            where: {
              AND: [
                where,
                {
                  listingType: missingType,
                  id: { notIn: items.map((item) => item.id) },
                },
              ],
            },
            select: feedSelect,
            orderBy: [{ detectedAt: "desc" }, { listedAt: "desc" }],
          });
          if (fallback) items[2] = fallback;
        }
      }
    }
    return { items, total, serverTime: new Date().toISOString() };
  }

  async feedback(body: DiscoveryFeedbackDto) {
    const listing = await this.prisma.item.findUnique({
      where: { id: body.listingId },
      select: {
        id: true,
        productId: true,
        favorite: true,
        ignored: true,
        ignoredAt: true,
        archivedAt: true,
      },
    });
    if (!listing || listing.archivedAt)
      throw new NotFoundException("商品已下架或不存在");

    const action = body.action as DiscoveryAction;
    const feedback = await this.prisma.$transaction(async (tx) => {
      const record = await tx.discoveryFeedback.create({
        data: {
          listingId: listing.id,
          productId: listing.productId,
          action,
          position: body.position,
        },
      });
      if (action === DiscoveryAction.favorite && !listing.favorite) {
        await tx.item.update({
          where: { id: listing.id },
          data:
            listing.ignored || listing.ignoredAt
              ? { favorite: true, ignored: false, ignoredAt: null }
              : { favorite: true },
        });
      }
      if (action === DiscoveryAction.dislike) {
        await tx.item.update({
          where: { id: listing.id },
          data: { favorite: false, ignored: true, ignoredAt: new Date() },
        });
      }
      return record;
    });
    return { feedback, serverTime: new Date().toISOString() };
  }

  async undo(feedbackId: string) {
    const original = await this.prisma.discoveryFeedback.findUnique({
      where: { id: feedbackId },
      include: { undoEvents: { select: { id: true }, take: 1 } },
    });
    if (!original) throw new NotFoundException("找不到可撤销的发现操作");
    if (
      original.action !== DiscoveryAction.dislike &&
      original.action !== DiscoveryAction.favorite
    )
      throw new BadRequestException("只有不感兴趣或收藏操作可以撤销");
    if (original.undoEvents.length)
      throw new ConflictException("这次操作已经撤销");

    const result = await this.prisma.$transaction(async (tx) => {
      const feedback = await tx.discoveryFeedback.create({
        data: {
          listingId: original.listingId,
          productId: original.productId,
          action: DiscoveryAction.undo,
          position: original.position,
          undoOfId: original.id,
        },
      });
      if (original.action === DiscoveryAction.favorite) {
        await tx.item.update({
          where: { id: original.listingId },
          data: { favorite: false },
        });
      }
      if (original.action === DiscoveryAction.dislike) {
        await tx.item.update({
          where: { id: original.listingId },
          data: { ignored: false, ignoredAt: null },
        });
      }
      const item = await tx.item.findUnique({
        where: { id: original.listingId },
        select: feedSelect,
      });
      return { feedback, item };
    });
    return { ...result, serverTime: new Date().toISOString() };
  }
}
