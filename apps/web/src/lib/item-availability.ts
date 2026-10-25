export type MarketListingAvailability = {
  status?: string | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
  ignored?: boolean;
  favorite?: boolean | null;
  purchaseRecord?: unknown;
  listingType?: string;
  auctionEndAt?: string | null;
  lastSeenAt?: string | null;
  refreshFailureCount?: number | null;
};

// Keep in sync with the API MARKET_STALE_HIDE_HOURS default (12h).
export const marketStaleHideMs = 12 * 60 * 60 * 1000;

// Mirrors the crawler's STATUS_REFRESH_DETAIL_ESCALATION_FAILURES default:
// from this many consecutive failed refreshes on, the listing's price is
// treated as unverified rather than live.
export const refreshFailureEscalationCount = 3;

/**
 * A direct listing whose availability could not be verified for a while:
 * either it was never confirmed (unknown) and has not been seen inside
 * the stale window, or it reads active but its refresh has failed at
 * least `refreshFailureEscalationCount` times in a row and it has not
 * been seen inside the window either. Such a listing must not present
 * its last known price as live. Missing or unreadable evidence is not
 * staleness, and auctions are governed by their end time instead.
 */
export function isUnverifiableListing(
  item: MarketListingAvailability,
  now = Date.now(),
): boolean {
  if (item.listingType !== "direct" || !item.lastSeenAt) return false;
  const seenAt = Date.parse(item.lastSeenAt);
  if (!Number.isFinite(seenAt) || seenAt >= now - marketStaleHideMs)
    return false;
  if (item.status === "unknown") return true;
  if (item.status === "active")
    return (item.refreshFailureCount ?? 0) >= refreshFailureEscalationCount;
  return false;
}

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
  // while. Favorites are exempt: a favorite is a curated shelf, so it
  // stays listed and renders as unverifiable (isUnverifiableListing)
  // instead of silently disappearing.
  if (
    item.status === "unknown" &&
    !item.favorite &&
    isUnverifiableListing(item, now)
  )
    return false;
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
