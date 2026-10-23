export type MarketListingAvailability = {
  status?: string | null;
  archivedAt?: string | null;
  ignored?: boolean;
  purchaseRecord?: unknown;
  listingType?: string;
  auctionEndAt?: string | null;
};

/** Unknown is not sold: only confirmed terminal state or expiry hides a listing. */
export function isAvailableMarketListing(
  item: MarketListingAvailability,
  now = Date.now(),
): boolean {
  if (item.ignored || item.archivedAt || item.purchaseRecord) return false;
  if (item.status && item.status !== "active" && item.status !== "unknown")
    return false;
  if (item.listingType === "auction" && item.auctionEndAt) {
    const deadline = Date.parse(item.auctionEndAt);
    if (Number.isFinite(deadline) && deadline <= now) return false;
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
