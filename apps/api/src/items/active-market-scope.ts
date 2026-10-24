import { ItemStatus, ListingType, Prisma, SourceChannel, ToyType } from "@tokusatsu/db";

export const excludedProcurementTitleFragments = [
  "トレカ",
  "trading card",
  "card game",
  "カードダス",
  "ガンバライド",
  "ガンバライジング",
  "ガンバレジェンズ",
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
] as const;

export const excludedProcurementDescriptionFragments = ["カードダス"] as const;

export const defaultMarketStaleHideHours = 12;

/** Hours after which an unconfirmed direct listing is hidden at read time. */
export function marketStaleHideHours(): number {
  const parsed = Number(process.env.MARKET_STALE_HIDE_HOURS);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : defaultMarketStaleHideHours;
}

/** Canonical read scope for the effective online procurement library. */
export function activeMarketItemWhere({
  includeIgnored = false,
  now = new Date(),
}: {
  includeIgnored?: boolean;
  now?: Date;
} = {}): Prisma.ItemWhereInput {
  const staleCutoff = new Date(
    now.getTime() - marketStaleHideHours() * 60 * 60 * 1000,
  );
  return {
    status: { in: [ItemStatus.active, ItemStatus.unknown] },
    archivedAt: null,
    channel: SourceChannel.online,
    purchaseRecord: null,
    categoryToyType: { not: ToyType.card },
    ...(includeIgnored ? {} : { ignored: false }),
    AND: [
      {
        // The scheduled source check may not have run since this deadline.
        // Hide proven-expired auctions at read time without mutating records or
        // treating an unknown/network-failed availability check as sold.
        OR: [
          { listingType: { not: ListingType.auction } },
          { auctionEndAt: null },
          { auctionEndAt: { gt: now } },
        ],
      },
      {
        // A direct listing whose availability was never confirmed stops
        // being shown once it has not been seen for a while. Nothing is
        // mutated: a later refresh that confirms it or makes it fresh
        // brings it straight back.
        OR: [
          { listingType: { not: ListingType.direct } },
          { status: ItemStatus.active },
          { lastSeenAt: { gte: staleCutoff } },
        ],
      },
      ...excludedProcurementDescriptionFragments.map((fragment) => ({
        OR: [
          { descriptionRaw: null },
          {
            NOT: {
              descriptionRaw: { contains: fragment, mode: "insensitive" as const },
            },
          },
        ],
      })),
    ],
    NOT: excludedProcurementTitleFragments.map((fragment) => ({
      titleRaw: { contains: fragment, mode: "insensitive" },
    })),
  };
}
