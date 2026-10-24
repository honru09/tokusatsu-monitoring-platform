export type MarketListingAvailability = {
  status?: string | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
  ignored?: boolean;
  purchaseRecord?: unknown;
  listingType?: string;
  auctionEndAt?: string | null;
  lastSeenAt?: string | null;
};

// Keep in sync with the API MARKET_STALE_HIDE_HOURS default (12h).
export const marketStaleHideMs = 12 * 60 * 60 * 1000;

/** Unknown is not sold: confirmed terminal state, expiry, or a stale
 * unconfirmed direct listing hides a listing at read time. */
export function isAvailableMarketListing(
  item: MarketListingAvailability,
  now = Date.now(),
): boolean {
  if (item.ignored || item.archivedAt || item.deletedAt || item.purchaseRecord)
    return false;
  if (item.status && item.status !== "active" && item.status !== "unknown")
    return false;
  if (item.listingType === "auction" && item.auctionEndAt) {
    const deadline = Date.parse(item.auctionEndAt);
    if (Number.isFinite(deadline) && deadline <= now) return false;
  }
  // Same read-side staleness rule as the API: a direct listing that was
  // never confirmed active drops out once it has not been seen for a
  // while. Missing or unreadable evidence is not staleness.
  if (
    item.listingType === "direct" &&
    item.status === "unknown" &&
    item.lastSeenAt
  ) {
    const seenAt = Date.parse(item.lastSeenAt);
    if (Number.isFinite(seenAt) && seenAt < now - marketStaleHideMs)
      return false;
  }
  return true;
}

/** Preserve the reference when unchanged so a clock tick does not repaint the grid. */
export function retainAvailableMarketListings<T extends MarketListingAvailability>(
  items: T[],
  now = Date.now(),
): T[] {
  const available = items.filter((item) => isAvailableMarketListing(item, now));
  return available.length === items.length ? items : available;
}
