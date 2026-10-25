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
    // Lifecycle is the visibility truth: only live listings are market
    // stock (includeIgnored also admits the disliked shelf). status
    // stays the raw platform signal and is still consulted by the
    // read-time freshness clauses below.
    lifecycleStatus: includeIgnored
      ? { in: ["live", "disliked"] as const }
      : "live",
    channel: SourceChannel.online,
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
        // brings it straight back. Favorites are exempt from this one
        // clause: a favorite is a curated shelf, so it stays listed and
        // clients render it as unverifiable instead of dropping it.
        OR: [
          { listingType: { not: ListingType.direct } },
          { status: ItemStatus.active },
          { lastSeenAt: { gte: staleCutoff } },
          { favorite: true },
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
