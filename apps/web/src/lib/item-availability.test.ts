import { describe, expect, it } from "vitest";
import { isAvailableMarketListing, retainAvailableMarketListings } from "./item-availability";

const now = Date.parse("2026-10-08T12:00:00.000Z");

describe("market listing availability", () => {
  it.each(["sold", "removed", "ended", "expired"])("does not display a confirmed %s listing", (status) => {
    expect(isAvailableMarketListing({ status }, now)).toBe(false);
  });

  it("keeps unknown, missing and invalid availability evidence rather than calling it sold", () => {
    expect(isAvailableMarketListing({ status: "unknown" }, now)).toBe(true);
    expect(isAvailableMarketListing({}, now)).toBe(true);
    expect(isAvailableMarketListing({ listingType: "auction", auctionEndAt: "invalid" }, now)).toBe(true);
    expect(isAvailableMarketListing({ listingType: "auction", auctionEndAt: null }, now)).toBe(true);
  });

  it("expires auctions at their exact deadline without expiring direct purchases", () => {
    const deadline = new Date(now).toISOString();
    expect(isAvailableMarketListing({ listingType: "auction", auctionEndAt: deadline }, now - 1)).toBe(true);
    expect(isAvailableMarketListing({ listingType: "auction", auctionEndAt: deadline }, now)).toBe(false);
    expect(isAvailableMarketListing({ listingType: "direct", auctionEndAt: deadline }, now)).toBe(true);
  });

  it("hides only stale direct listings whose availability was never confirmed", () => {
    const stale = new Date(now - 13 * 60 * 60 * 1000).toISOString();
    const fresh = new Date(now - 60 * 60 * 1000).toISOString();
    const future = new Date(now + 60 * 60 * 1000).toISOString();
    expect(isAvailableMarketListing({ listingType: "direct", status: "unknown", lastSeenAt: stale }, now)).toBe(false);
    expect(isAvailableMarketListing({ listingType: "direct", status: "unknown", lastSeenAt: fresh }, now)).toBe(true);
    expect(isAvailableMarketListing({ listingType: "direct", status: "active", lastSeenAt: stale }, now)).toBe(true);
    expect(isAvailableMarketListing({ listingType: "auction", status: "unknown", lastSeenAt: stale, auctionEndAt: future }, now)).toBe(true);
    expect(isAvailableMarketListing({ listingType: "unknown", status: "unknown", lastSeenAt: stale }, now)).toBe(true);
    // No timestamp means no staleness evidence, so the listing stays.
    expect(isAvailableMarketListing({ listingType: "direct", status: "unknown" }, now)).toBe(true);
    expect(isAvailableMarketListing({ listingType: "direct", status: "unknown", lastSeenAt: "invalid" }, now)).toBe(true);
  });

  it("removes unavailable rows without mutating saved purchases or repainting an unchanged grid", () => {
    const purchases = { id: "purchase-1" };
    const rows = [{ status: "active" }, { status: "sold" }, { purchaseRecord: purchases }];
    expect(retainAvailableMarketListings(rows, now)).toEqual([rows[0]]);
    expect(rows[2].purchaseRecord).toBe(purchases);
    const live = [rows[0]];
    expect(retainAvailableMarketListings(live, now)).toBe(live);
  });
});
