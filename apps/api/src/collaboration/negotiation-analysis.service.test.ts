import { describe, expect, it, vi } from "vitest";
import { NegotiationScriptService } from "./negotiation-script.service.js";

const items = [
  {
    id: "item-1",
    titleRaw: "仮面ライダー フィギュア",
    priceCurrent: 10_000,
    shippingFee: 500,
    sourceUrl: "https://example.com/items/1",
    sellerId: "seller-1",
    seller: { id: "seller-1", name: "特摄商店" },
    source: { id: "source-1", key: "mercari" },
  },
  {
    id: "item-2",
    titleRaw: "ウルトラマン ソフビ",
    priceCurrent: 6_000,
    shippingFee: null,
    sourceUrl: "https://example.com/items/2",
    sellerId: "seller-1",
    seller: { id: "seller-1", name: "特摄商店" },
    source: { id: "source-1", key: "mercari" },
  },
  {
    id: "item-3",
    titleRaw: "戦隊 ロボット",
    priceCurrent: 7_000,
    shippingFee: 300,
    sourceUrl: "https://example.com/items/3",
    sellerId: "seller-2",
    seller: { id: "seller-2", name: "別の店" },
    source: { id: "source-1", key: "mercari" },
  },
  {
    id: "item-4",
    titleRaw: "単品 アイテム",
    priceCurrent: 3_000,
    shippingFee: null,
    sourceUrl: "https://example.com/items/4",
    sellerId: null,
    seller: null,
    source: { id: "source-1", key: "mercari" },
  },
];

type RoundItemRow = {
  roundId: string;
  itemId: string;
  targetPriceYen: number | null;
  copiedAt: null;
  createdAt: Date;
};

const roundItemRows: RoundItemRow[] = [
  {
    roundId: "round-a",
    itemId: "item-1",
    targetPriceYen: 8_000,
    copiedAt: null,
    createdAt: new Date("2026-01-10T00:00:00Z"),
  },
  {
    roundId: "round-a",
    itemId: "item-2",
    targetPriceYen: 1_111,
    copiedAt: null,
    createdAt: new Date("2026-01-10T00:00:00Z"),
  },
  {
    roundId: "round-old",
    itemId: "item-2",
    targetPriceYen: 9_999,
    copiedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  },
  {
    roundId: "round-new",
    itemId: "item-2",
    targetPriceYen: 4_000,
    copiedAt: null,
    createdAt: new Date("2026-02-01T00:00:00Z"),
  },
];

function fixture() {
  const prisma = {
    shareRound: { findUnique: vi.fn().mockResolvedValue(null) },
    shareRoundItem: {
      findMany: vi.fn(
        ({
          where,
          orderBy,
          take,
        }: {
          where: { roundId?: string; itemId?: string };
          orderBy?: { createdAt: "desc" };
          take?: number;
        }) => {
          let rows = roundItemRows.filter(
            (row) =>
              (where.roundId === undefined || row.roundId === where.roundId) &&
              (where.itemId === undefined || row.itemId === where.itemId),
          );
          if (orderBy?.createdAt === "desc") {
            rows = [...rows].sort(
              (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
            );
          }
          if (take !== undefined) rows = rows.slice(0, take);
          return Promise.resolve(rows);
        },
      ),
    },
    item: {
      findMany: vi.fn(
        ({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            items.filter((item) => where.id.in.includes(item.id)),
          ),
      ),
    },
  };
  const service = new NegotiationScriptService(prisma as never);
  return { prisma, service };
}

describe("NegotiationScriptService.analyzeSelection", () => {
  it("groups by seller with correct totals and target resolution per item", async () => {
    const { service } = fixture();
    const result = await service.analyzeSelection([
      { itemId: "item-1", roundId: "round-a" },
      { itemId: "item-2" },
      { itemId: "item-3" },
    ]);

    expect(result.groups).toHaveLength(2);

    const sellerGroup = result.groups[0];
    expect(sellerGroup).toMatchObject({
      sellerId: "seller-1",
      sellerName: "特摄商店",
      itemIds: ["item-1", "item-2"],
      fallback: true,
      // 8,000 from the given round + 4,000 from item-2's latest round.
      targetTotalYen: 12_000,
      listedTotalYen: 16_000,
      firstItemUrl: "https://example.com/items/1",
    });
    expect(sellerGroup.items).toEqual([
      expect.objectContaining({
        id: "item-1",
        targetPriceYen: 8_000,
        targetMissing: false,
      }),
      expect.objectContaining({
        id: "item-2",
        targetPriceYen: 4_000,
        targetMissing: false,
      }),
    ]);
    // A multi-item script lists both titles and asks for the target total.
    expect(sellerGroup.script).toContain("仮面ライダー フィギュア");
    expect(sellerGroup.script).toContain("ウルトラマン ソフビ");
    expect(sellerGroup.script).toContain("合計12,000円");

    const otherGroup = result.groups[1];
    expect(otherGroup).toMatchObject({
      sellerId: "seller-2",
      sellerName: "別の店",
      itemIds: ["item-3"],
      // No round anywhere: the target falls back to the listed price.
      targetTotalYen: 7_000,
      listedTotalYen: 7_000,
      firstItemUrl: "https://example.com/items/3",
    });
    expect(otherGroup.items[0]).toMatchObject({
      id: "item-3",
      targetPriceYen: null,
      targetMissing: true,
    });
  });

  it("prefers the given round's target over the item's latest round", async () => {
    const { service } = fixture();
    const result = await service.analyzeSelection([
      { itemId: "item-2", roundId: "round-old" },
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].items[0]).toMatchObject({
      targetPriceYen: 9_999,
      targetMissing: false,
    });
    expect(result.groups[0].targetTotalYen).toBe(9_999);
  });

  it("dedupes itemIds keeping the first occurrence and its roundId", async () => {
    const { service, prisma } = fixture();
    const result = await service.analyzeSelection([
      { itemId: "item-1", roundId: "round-a" },
      { itemId: "item-1" },
      { itemId: "item-2", roundId: "round-a" },
      { itemId: "item-2", roundId: "round-old" },
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].itemIds).toEqual(["item-1", "item-2"]);
    // First occurrence wins: item-2 resolves from round-a (1,111), not round-old.
    expect(result.groups[0].items[1]).toMatchObject({
      targetPriceYen: 1_111,
    });
    expect(prisma.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["item-1", "item-2"] } },
      }),
    );
  });

  it("gives a seller-less item its own singleton group", async () => {
    const { service } = fixture();
    const result = await service.analyzeSelection([
      { itemId: "item-1", roundId: "round-a" },
      { itemId: "item-4" },
    ]);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[1]).toMatchObject({
      sellerId: null,
      sellerName: null,
      itemIds: ["item-4"],
      targetTotalYen: 3_000,
      listedTotalYen: 3_000,
      firstItemUrl: "https://example.com/items/4",
    });
    expect(result.groups[1].items[0].targetMissing).toBe(true);
  });

  it("returns no groups for an empty selection", async () => {
    const { service } = fixture();
    await expect(service.analyzeSelection([])).resolves.toEqual({
      groups: [],
    });
  });
});
