import { describe, expect, it } from "vitest";
import {
  buildNegotiatingQueue,
  buildPackableReminder,
  buildRegisterQueue,
  buildReviewQueue,
  buildSystemQueue,
  todoPendingCount,
  type NegotiationLike,
  type ShareMessageLike,
  type ShareRoundLike,
  type SharedItemLike,
} from "./todo-queues";

function item(overrides: Partial<SharedItemLike> = {}): SharedItemLike {
  return {
    id: "item-1",
    titleRaw: "仮面ライダー フィギュア",
    titleZh: "假面骑士手办",
    priceCurrent: 5_000,
    source: { key: "mercari", displayName: "Mercari" },
    images: [{ url: "https://example.com/1.jpg" }],
    ...overrides,
  };
}

const noPurchases = new Set<string>();
const noDisliked = new Set<string>();

describe("buildReviewQueue", () => {
  it("keeps undecided round rows and partner messages, oldest first, deduped by item", () => {
    const rounds: ShareRoundLike[] = [
      {
        id: "round-1",
        createdAt: "2026-10-24T00:00:00.000Z",
        createdBy: { name: "搭档" },
        items: [
          { itemId: "item-1", copiedAt: null, item: item() },
          {
            // Copied into a negotiation but never decided: still pending.
            itemId: "item-2",
            copiedAt: "2026-10-24T01:00:00.000Z",
            item: item({ id: "item-2" }),
          },
        ],
      },
    ];
    const messages: ShareMessageLike[] = [
      {
        id: "msg-1",
        senderId: "partner",
        createdAt: "2026-10-23T00:00:00.000Z",
        sender: { name: "搭档" },
        item: item(),
      },
      {
        id: "msg-2",
        senderId: "me",
        createdAt: "2026-10-22T00:00:00.000Z",
        item: item({ id: "item-3" }),
      },
    ];
    const queue = buildReviewQueue(rounds, messages, "me", noPurchases, noDisliked);
    expect(queue.map((entry) => entry.item.id)).toEqual(["item-1", "item-2"]);
    // The earlier message wins over the later round for the same item.
    expect(queue[0].key).toBe("message-msg-1-item-1");
    expect(queue[0].sharedAt).toBe("2026-10-23T00:00:00.000Z");
    expect(queue[1].key).toBe("round-round-1-item-2");
  });

  it("drops purchased, disliked and decided shares", () => {
    const rounds: ShareRoundLike[] = [
      {
        id: "round-1",
        createdAt: "2026-10-24T00:00:00.000Z",
        createdBy: null,
        items: [
          { itemId: "item-1", copiedAt: null, item: item() },
          { itemId: "item-2", copiedAt: null, item: item({ id: "item-2" }) },
          {
            itemId: "item-3",
            copiedAt: null,
            decision: {
              status: "pass",
              decidedByName: "王",
              decidedAt: "2026-10-24T02:00:00.000Z",
            },
            item: item({ id: "item-3" }),
          },
          {
            itemId: "item-4",
            copiedAt: null,
            item: item({
              id: "item-4",
              decision: {
                status: "want",
                decidedByName: "王",
                decidedAt: "2026-10-24T03:00:00.000Z",
              },
            }),
          },
        ],
      },
    ];
    const queue = buildReviewQueue(
      rounds,
      [],
      "me",
      new Set(["item-1"]),
      new Set(["item-2"]),
    );
    expect(queue).toHaveLength(0);
  });
});

describe("buildNegotiatingQueue", () => {
  it("keeps only open cases, longest waiting first", () => {
    const negotiations: NegotiationLike[] = [
      { id: "n1", status: "success", statusChangedAt: "2026-10-20T00:00:00.000Z", item: item() },
      { id: "n2", status: "in_progress", statusChangedAt: "2026-10-22T00:00:00.000Z", item: item({ id: "i2" }) },
      { id: "n3", status: "in_progress", statusChangedAt: "2026-10-21T00:00:00.000Z", item: item({ id: "i3" }) },
    ];
    const queue = buildNegotiatingQueue(negotiations);
    expect(queue.map((entry) => entry.key)).toEqual([
      "negotiation-n3",
      "negotiation-n2",
    ]);
  });

  it("unions negotiate decisions with open cases, deduped by item", () => {
    const negotiations: NegotiationLike[] = [
      { id: "n2", status: "in_progress", statusChangedAt: "2026-10-22T00:00:00.000Z", item: item({ id: "i2" }) },
    ];
    const rounds: ShareRoundLike[] = [
      {
        id: "round-1",
        createdAt: "2026-10-24T00:00:00.000Z",
        createdBy: { name: "搭档" },
        items: [
          {
            // Same item as the open case: the earlier timestamp wins.
            itemId: "i2",
            decision: {
              status: "negotiate",
              decidedByName: "王",
              decidedAt: "2026-10-21T00:00:00.000Z",
            },
            item: item({ id: "i2" }),
          },
          {
            itemId: "i5",
            decision: {
              status: "negotiate",
              decidedByName: "王",
              decidedAt: "2026-10-23T00:00:00.000Z",
            },
            item: item({ id: "i5" }),
          },
          {
            itemId: "i6",
            decision: {
              status: "want",
              decidedByName: "王",
              decidedAt: "2026-10-23T00:00:00.000Z",
            },
            item: item({ id: "i6" }),
          },
        ],
      },
    ];
    const messages: ShareMessageLike[] = [
      {
        id: "msg-1",
        senderId: "partner",
        createdAt: "2026-10-20T00:00:00.000Z",
        item: item({
          id: "i7",
          decision: {
            status: "negotiate",
            decidedByName: "王",
            decidedAt: "2026-10-20T12:00:00.000Z",
          },
        }),
      },
    ];
    const queue = buildNegotiatingQueue(negotiations, rounds, messages);
    expect(queue.map((entry) => entry.item.id)).toEqual(["i7", "i2", "i5"]);
    expect(queue.map((entry) => entry.key)).toEqual([
      "decision-message-msg-1-i7",
      "decision-round-round-1-i2",
      "decision-round-round-1-i5",
    ]);
    // The decision entry for i2 carries the earlier decidedAt.
    expect(queue[1].statusChangedAt).toBe("2026-10-21T00:00:00.000Z");
  });
});

describe("buildRegisterQueue", () => {
  it("collects successful negotiations and completed analyses without a purchase record", () => {
    const negotiations: NegotiationLike[] = [
      { id: "n1", status: "success", statusChangedAt: "2026-10-22T00:00:00.000Z", item: item() },
      { id: "n2", status: "success", statusChangedAt: "2026-10-22T00:00:00.000Z", item: item({ id: "bought" }) },
    ];
    const queue = buildRegisterQueue(
      negotiations,
      [
        { jobId: "j1", state: "completed", createdAt: "2026-10-23T00:00:00.000Z", item: item({ id: "i9" }) },
        { jobId: "j2", state: "completed", createdAt: "2026-10-23T00:00:00.000Z", item: item() },
        { jobId: "j3", state: "active", createdAt: "2026-10-23T00:00:00.000Z", item: item({ id: "i10" }) },
      ],
      new Set(["bought"]),
    );
    expect(queue.map((entry) => entry.item.id)).toEqual(["item-1", "i9"]);
    expect(queue[0].origin).toBe("negotiation");
    expect(queue[1].origin).toBe("analysis");
  });
});

describe("buildPackableReminder", () => {
  const rate = 0.0425;
  const order = (
    overrides: Partial<Parameters<typeof buildPackableReminder>[0][number]>,
  ) => ({
    id: "o1",
    orderNumber: "1",
    name: "A",
    status: "in_stock" as const,
    remainingQuantity: 1,
    purchasedAt: "2026-10-01T00:00:00.000Z",
    imageUrl: null,
    averageCost: 10_000,
    ...overrides,
  });

  it("stays silent while the pile cannot fill a parcel yet", () => {
    // 3 × ¥10,000 ≈ 1,275 CNY — below the 1,800 CNY target band.
    expect(
      buildPackableReminder([order({ remainingQuantity: 3 })], rate),
    ).toEqual([]);
  });

  it("fires once the declared estimate reaches the target band", () => {
    const queue = buildPackableReminder(
      [
        order({ id: "o1", remainingQuantity: 3 }),
        order({ id: "o2", remainingQuantity: 2, averageCost: 8_000 }),
      ],
      rate,
    );
    // ¥30,000 + ¥16,000 = ¥46,000 → 1,955 CNY.
    expect(queue).toEqual([
      {
        key: "packable",
        orderCount: 2,
        totalQuantity: 5,
        totalDeclaredYen: 46_000,
        totalDeclaredCny: 1_955,
      },
    ]);
  });

  it("skips sold-out and empty orders and falls back to spread purchase cost", () => {
    const queue = buildPackableReminder(
      [
        order({ id: "gone", status: "sold_out", remainingQuantity: 0 }),
        order({ id: "empty", remainingQuantity: 0 }),
        order({
          id: "spread",
          averageCost: null,
          purchaseCost: 92_000,
          initialQuantity: 2,
          remainingQuantity: 1,
        }),
      ],
      rate,
    );
    // Unit = 92,000 / 2 = ¥46,000 → 1,955 CNY from the spread order alone.
    expect(queue).toHaveLength(1);
    expect(queue[0].orderCount).toBe(1);
    expect(queue[0].totalDeclaredYen).toBe(46_000);
  });

  it("cannot judge without a usable rate", () => {
    const orders = [order({ remainingQuantity: 9 })];
    expect(buildPackableReminder(orders, undefined)).toEqual([]);
    expect(buildPackableReminder(orders, null)).toEqual([]);
    expect(buildPackableReminder(orders, 0)).toEqual([]);
  });
});

describe("buildSystemQueue", () => {
  const now = new Date("2026-10-25T00:00:00.000Z");
  it("flags gift expiry within 14 days, a nearly empty daily budget and failed jobs", () => {
    const queue = buildSystemQueue({
      resources: {
        remainingLocalBudget: 5_000,
        dailyTokenLimit: 200_000,
        expiresAt: "2026-11-09T06:35:56.000Z",
      },
      failedJobs24h: 3,
      now,
    });
    // 2026-11-09 is 15 days out, so no expiry notice yet.
    expect(queue.map((entry) => entry.key)).toEqual([
      "system-ai-budget",
      "system-monitoring-failures",
    ]);
    const expiring = buildSystemQueue({
      resources: {
        remainingLocalBudget: 190_000,
        dailyTokenLimit: 200_000,
        expiresAt: "2026-11-05T00:00:00.000Z",
      },
      failedJobs24h: 0,
      now,
    });
    expect(expiring.map((entry) => entry.key)).toEqual(["system-ai-expiry"]);
    expect(expiring[0].detail).toContain("11 天后到期");
  });

  it("stays empty when everything is healthy", () => {
    expect(
      buildSystemQueue({
        resources: {
          remainingLocalBudget: 190_000,
          dailyTokenLimit: 200_000,
          expiresAt: "2027-01-01T00:00:00.000Z",
        },
        failedJobs24h: 0,
        now,
      }),
    ).toEqual([]);
  });
});

describe("todoPendingCount", () => {
  it("sums all queues", () => {
    expect(
      todoPendingCount({
        review: [{}, {}] as never[],
        negotiating: [{}] as never[],
        register: [],
        packable: [{}] as never[],
        system: [{}] as never[],
      }),
    ).toBe(5);
  });
});
