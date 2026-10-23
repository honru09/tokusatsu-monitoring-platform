import { describe, expect, it, vi } from "vitest";
import { rescheduleCompletedStatusJob } from "./status-refresh-lifecycle.js";

const data = {
  itemId: "item-1", sourceItemId: "source-1", sourceUrl: "https://example.test/1",
  adapterKey: "yahoo_auctions", auctionEndAt: "2026-10-10T12:00:00.000Z", listingType: "auction",
};

describe("completed availability check scheduling", () => {
  it("uses the newly verified auction deadline instead of the old job deadline", async () => {
    const schedule = vi.fn().mockResolvedValue(undefined);
    const latest = new Date("2026-10-08T12:00:00.000Z");
    await rescheduleCompletedStatusJob(data, { status: "active", auctionEndAt: latest, listingType: "auction" }, schedule);
    expect(schedule).toHaveBeenCalledWith("item-1", "source-1", data.sourceUrl, "active", latest, "yahoo_auctions");
  });

  it.each([null, "not-a-date"])("does not resurrect a cleared/invalid auction deadline: %s", async (auctionEndAt) => {
    const schedule = vi.fn().mockResolvedValue(undefined);
    await rescheduleCompletedStatusJob(data, { status: "active", auctionEndAt }, schedule);
    expect(schedule.mock.calls[0][4]).toBeNull();
  });

  it("removes an obsolete auction cadence when the listing is now direct purchase", async () => {
    const schedule = vi.fn().mockResolvedValue(undefined);
    await rescheduleCompletedStatusJob(data, { status: "active", listingType: "direct" }, schedule);
    expect(schedule.mock.calls[0][4]).toBeNull();
  });

  it("retains unresolved listings, but never reschedules confirmed terminal or skipped results", async () => {
    const schedule = vi.fn().mockResolvedValue(undefined);
    for (const status of ["sold", "ended", "removed", "expired", undefined])
      await rescheduleCompletedStatusJob(data, { status }, schedule);
    expect(schedule).not.toHaveBeenCalled();
    await rescheduleCompletedStatusJob(data, { status: "unknown" }, schedule);
    expect(schedule).toHaveBeenCalledOnce();
  });
});
