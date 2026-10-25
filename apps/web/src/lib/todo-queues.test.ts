import { describe, expect, it } from "vitest";
import {
  buildInventoryQueue,
  buildNegotiatingQueue,
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

describe("buildInventoryQueue", () => {
  const now = new Date("2026-10-25T00:00:00.000Z");
  it("flags partially sold and 30+ day stock, skips sold out and fresh stock", () => {
    const queue = buildInventoryQueue(
      [
        { id: "o1", orderNumber: "1", name: "A", status: "partially_sold", remainingQuantity: 2, purchasedAt: "2026-10-20T00:00:00.000Z", imageUrl: null },
        { id: "o2", orderNumber: "2", name: "B", status: "in_stock", remainingQuantity: 1, purchasedAt: "2026-09-01T00:00:00.000Z", imageUrl: null },
        { id: "o3", orderNumber: "3", name: "C", status: "in_stock", remainingQuantity: 1, purchasedAt: "2026-10-24T00:00:00.000Z", imageUrl: null },
        { id: "o4", orderNumber: "4", name: "D", status: "sold_out", remainingQuantity: 0, purchasedAt: "2026-08-01T00:00:00.000Z", imageUrl: null },
      ],
      now,
    );
    expect(queue.map((entry) => entry.orderId)).toEqual(["o2", "o1"]);
    expect(queue[0].detail).toContain("入库超过 30 天");
    expect(queue[1].detail).toContain("部分售出");
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
        inventory: [{}] as never[],
        system: [{}] as never[],
      }),
    ).toBe(5);
  });
});
