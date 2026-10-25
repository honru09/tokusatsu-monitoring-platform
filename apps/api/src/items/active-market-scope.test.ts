import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeMarketItemWhere } from "./active-market-scope.js";
import { ItemsService } from "./items.service.js";
import { ListItemsQuery } from "./items.dto.js";

const now = new Date("2026-10-08T12:00:00.000Z");

function fixture(id: string, fields: Record<string, unknown> = {}) {
  return {
    id,
    status: "active",
    lifecycleStatus: "live",
    archivedAt: null,
    deletedAt: null,
    channel: "online",
    purchaseRecord: null,
    categoryToyType: "figure",
    ignored: false,
    favorite: true,
    titleRaw: "S.H.Figuarts 仮面ライダー",
    descriptionRaw: null,
    listingType: "direct",
    auctionEndAt: null,
    lastSeenAt: now,
    source: { key: "mercari", displayName: "Mercari" },
    sourceData: null,
    product: null,
    ...fields,
  };
}

// Match the real Prisma predicate sent by ItemsService, rather than returning
// canned rows that cannot catch an expired auction leaking from the query.
function matchesWhere(
  item: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true;
    if (["AND", "OR", "NOT"].includes(key)) {
      const conditions = Array.isArray(condition) ? condition : [condition];
      const results = conditions.map((entry) => matchesWhere(item, entry));
      return key === "OR"
        ? results.some(Boolean)
        : key === "NOT"
          ? results.every((result) => !result)
          : results.every(Boolean);
    }
    const actual = item[key];
    if (condition === null || typeof condition !== "object")
      return actual === condition;
    return Object.entries(condition).every(([operator, value]) => {
      if (operator === "in") return Array.isArray(value) && value.includes(actual);
      if (operator === "not") return actual !== value;
      if (operator === "contains")
        return typeof actual === "string" &&
          actual.toLowerCase().includes(String(value).toLowerCase());
      if (operator === "gt")
        return actual instanceof Date && value instanceof Date &&
          actual.getTime() > value.getTime();
      if (operator === "gte")
        return actual instanceof Date && value instanceof Date &&
          actual.getTime() >= value.getTime();
      return operator === "mode";
    });
  });
}

afterEach(() => vi.useRealTimers());

describe("active market availability", () => {
  it("hides expired auctions without calling an unknown availability sold or deleting purchases", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const candidates = [
      fixture("direct"),
      fixture("network-unknown", { status: "unknown" }),
      fixture("future-auction", {
        listingType: "auction",
        auctionEndAt: new Date(now.getTime() + 1),
      }),
      fixture("unknown-auction", { listingType: "auction", status: "unknown" }),
      fixture("expired-auction", {
        listingType: "auction",
        auctionEndAt: new Date(now.getTime() - 1),
      }),
      fixture("just-ended-auction", { listingType: "auction", auctionEndAt: now }),
      fixture("sold", { status: "sold", lifecycleStatus: "sold" }),
      fixture("ended", {
        status: "ended",
        listingType: "auction",
        lifecycleStatus: "ended",
      }),
      fixture("removed", { status: "removed", lifecycleStatus: "ended" }),
      fixture("purchased", {
        purchaseRecord: { id: "purchase-record" },
        lifecycleStatus: "purchased",
      }),
      fixture("archived", { archivedAt: now, lifecycleStatus: "ended" }),
      fixture("deleted", { deletedAt: now, lifecycleStatus: "deleted" }),
    ];

    const visible = candidates.filter((item) =>
      matchesWhere(item, activeMarketItemWhere()),
    );

    expect(visible.map((item) => item.id)).toEqual([
      "direct", "network-unknown", "future-auction", "unknown-auction",
    ]);
    expect(candidates.find((item) => item.id === "purchased")?.purchaseRecord)
      .toEqual({ id: "purchase-record" });
    expect(candidates.find((item) => item.id === "expired-auction")?.status)
      .toBe("active");
  });

  it("hides only stale direct listings whose availability was never confirmed", () => {
    const stale = new Date(now.getTime() - 13 * 60 * 60 * 1000);
    const fresh = new Date(now.getTime() - 60 * 60 * 1000);
    const candidates = [
      fixture("direct-unknown-stale", { status: "unknown", lastSeenAt: stale, favorite: false }),
      fixture("direct-unknown-fresh", { status: "unknown", lastSeenAt: fresh }),
      fixture("direct-active-stale", { status: "active", lastSeenAt: stale }),
      fixture("direct-unknown-stale-favorite", { status: "unknown", lastSeenAt: stale }),
      fixture("auction-unknown-stale", {
        status: "unknown",
        listingType: "auction",
        auctionEndAt: new Date(now.getTime() + 60 * 60 * 1000),
        lastSeenAt: stale,
      }),
      fixture("unknown-type-unknown-stale", {
        status: "unknown",
        listingType: "unknown",
        lastSeenAt: stale,
      }),
    ];

    const visible = candidates.filter((item) =>
      matchesWhere(item, activeMarketItemWhere({ now })),
    );

    expect(visible.map((item) => item.id)).toEqual([
      "direct-unknown-fresh",
      "direct-active-stale",
      "direct-unknown-stale-favorite",
      "auction-unknown-stale",
      "unknown-type-unknown-stale",
    ]);
    // Hiding is read-only: the stale row itself is untouched.
    expect(candidates[0]).toMatchObject({ status: "unknown", archivedAt: null });
  });

  it("parses MARKET_STALE_HIDE_HOURS defensively", () => {
    const stale = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const item = fixture("direct-unknown", { status: "unknown", lastSeenAt: stale, favorite: false });
    try {
      process.env.MARKET_STALE_HIDE_HOURS = "2";
      expect(matchesWhere(item, activeMarketItemWhere({ now }))).toBe(false);
      process.env.MARKET_STALE_HIDE_HOURS = "not-a-number";
      expect(matchesWhere(item, activeMarketItemWhere({ now }))).toBe(true);
      process.env.MARKET_STALE_HIDE_HOURS = "0";
      expect(matchesWhere(item, activeMarketItemWhere({ now }))).toBe(true);
    } finally {
      delete process.env.MARKET_STALE_HIDE_HOURS;
    }
  });

  it("uses the same availability gate for searched favorites, totals and transaction facets", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const candidates = [
      fixture("live-favorite", { listingType: "auction", auctionEndAt: new Date(now.getTime() + 60_000) }),
      fixture("stale-favorite", { listingType: "auction", auctionEndAt: new Date(now.getTime() - 60_000) }),
      fixture("direct-favorite"),
    ];
    const prisma = {
      item: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          candidates.filter((item) => matchesWhere(item, where))),
        count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          candidates.filter((item) => matchesWhere(item, where)).length),
      },
      $transaction: vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
    };
    const service = new ItemsService(prisma as never);

    const result = await service.list({
      favorite: true,
      search: "S.H.Figuarts",
      listingType: "auction",
      limit: 40,
      offset: 0,
    } as ListItemsQuery);

    expect(result.items.map((item) => item.id)).toEqual(["live-favorite"]);
    expect(result.total).toBe(1);
    expect(result.facets).toEqual({ auction: 1, direct: 1, unknown: 0 });
    const gate = prisma.item.findMany.mock.calls[0][0].where.AND;
    for (const [{ where }] of prisma.item.count.mock.calls)
      expect(where.AND).toEqual(gate);
  });
});
