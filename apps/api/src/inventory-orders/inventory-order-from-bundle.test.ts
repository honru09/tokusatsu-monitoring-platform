import { describe, expect, it, vi } from "vitest";
import {
  canResyncInventoryOrderCostQty,
  ensureInventoryOrderFromBundle,
  nameFromBundleMembers,
  quantityFromBundleMembers,
  syncInventoryOrderFromBundle,
} from "./inventory-order-from-bundle.js";

function concurrentOrderHarness(initial?: Record<string, unknown>) {
  let row = initial ? { ...initial } : null;
  let beforeWrite: (() => void) | undefined;
  const write = (data: Record<string, unknown>) => {
    beforeWrite?.();
    beforeWrite = undefined;
    if (!row) throw new Error("Inventory order missing");
    Object.assign(row, data);
    return { ...row };
  };
  const tx = {
    inventoryOrder: {
      findUnique: vi.fn(async () => (row ? { ...row } : null)),
      findUniqueOrThrow: vi.fn(async () => {
        if (!row) throw new Error("Inventory order missing");
        return { ...row };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (row) throw new Error("P2002: source_bundle_id must be unique");
        row = { ...data };
        return { ...row };
      }),
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (row) return { count: 0 };
        row = { ...data };
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
        write(data),
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          beforeWrite?.();
          beforeWrite = undefined;
          if (
            !row ||
            Object.entries(where).some(([key, value]) => row?.[key] !== value)
          )
            return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
    },
  };
  return {
    tx,
    row: () => row,
    race: (change: Record<string, unknown>) => {
      beforeWrite = () => {
        Object.assign(row!, change);
      };
    },
  };
}

const pristineOrder = {
  id: "inv-race",
  sourceBundleId: "bundle-race",
  purchaseCost: 1_000,
  initialQuantity: 3,
  remainingQuantity: 3,
  soldQuantity: 0,
  totalSales: 0,
  status: "in_stock",
  name: "Original title",
  platform: "Mercari",
  imageUrl: null,
  note: null,
};

const bundleInput = {
  bundleId: "bundle-race",
  purchaseCost: 2_000,
  purchasedAt: new Date("2026-09-01T00:00:00.000Z"),
  members: [{ titleRaw: "Updated title", quantityEst: 5 }],
};

describe("bundle dual-write concurrency", () => {
  it.each([
    {
      remainingQuantity: 2,
      soldQuantity: 1,
      totalSales: 700,
      status: "partially_sold",
    },
    {
      remainingQuantity: 2,
      soldQuantity: 0,
      totalSales: 0,
      status: "partially_sold",
    },
    {
      remainingQuantity: 0,
      soldQuantity: 3,
      totalSales: 2_100,
      status: "sold_out",
    },
  ])(
    "does not restore stock or change cost after a concurrent sale/adjustment: %o",
    async (change) => {
      const h = concurrentOrderHarness(pristineOrder);
      h.race(change);
      const result = await syncInventoryOrderFromBundle(
        h.tx as never,
        bundleInput,
      );
      expect(h.row()).toMatchObject({
        ...change,
        purchaseCost: 1_000,
        initialQuantity: 3,
        name: "Updated title",
      });
      expect(result).toMatchObject({ created: false, syncedCostQty: false });
    },
  );

  it("concurrent ensure calls reuse one order instead of aborting on a unique conflict", async () => {
    const h = concurrentOrderHarness();
    const [first, second] = await Promise.all([
      ensureInventoryOrderFromBundle(h.tx as never, bundleInput),
      ensureInventoryOrderFromBundle(h.tx as never, bundleInput),
    ]);
    expect(first.id).toBe(second.id);
    expect(h.tx.inventoryOrder.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it("concurrent sync calls create one batch and report the winning creation accurately", async () => {
    const h = concurrentOrderHarness();
    const results = await Promise.all([
      syncInventoryOrderFromBundle(h.tx as never, bundleInput),
      syncInventoryOrderFromBundle(h.tx as never, bundleInput),
    ]);
    expect(results[0].order.id).toBe(results[1].order.id);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(h.row()).toMatchObject({
      initialQuantity: 5,
      remainingQuantity: 5,
      purchaseCost: 2_000,
    });
  });

  it("preserves a batch created and sold before a competing sync could insert", async () => {
    const h = concurrentOrderHarness({
      ...pristineOrder,
      remainingQuantity: 0,
      soldQuantity: 3,
      totalSales: 2_100,
      status: "sold_out",
    });
    h.tx.inventoryOrder.findUnique.mockResolvedValueOnce(null);
    const result = await syncInventoryOrderFromBundle(
      h.tx as never,
      bundleInput,
    );
    expect(result).toMatchObject({ created: false, syncedCostQty: false });
    expect(h.row()).toMatchObject({
      remainingQuantity: 0,
      initialQuantity: 3,
      purchaseCost: 1_000,
      soldQuantity: 3,
      totalSales: 2_100,
      status: "sold_out",
    });
  });

  it("does not write stale fallback metadata when bundle details are absent", async () => {
    const h = concurrentOrderHarness(pristineOrder);
    const latestMeta = {
      name: "Latest title",
      imageUrl: "https://example.com/latest.jpg",
      platform: "Yahoo! フリマ",
      note: "Latest note",
    };
    h.race(latestMeta);
    await syncInventoryOrderFromBundle(h.tx as never, {
      ...bundleInput,
      members: [],
    });
    expect(h.row()).toMatchObject(latestMeta);
  });
});

describe("canResyncInventoryOrderCostQty", () => {
  it("allows rewrite only while remaining===initial and no sales", () => {
    expect(
      canResyncInventoryOrderCostQty({
        remainingQuantity: 3,
        initialQuantity: 3,
        soldQuantity: 0,
        totalSales: 0,
      }),
    ).toBe(true);
    expect(
      canResyncInventoryOrderCostQty({
        remainingQuantity: 2,
        initialQuantity: 3,
        soldQuantity: 0,
        totalSales: 0,
      }),
    ).toBe(false);
    expect(
      canResyncInventoryOrderCostQty({
        remainingQuantity: 3,
        initialQuantity: 3,
        soldQuantity: 1,
        totalSales: 0,
      }),
    ).toBe(false);
    expect(
      canResyncInventoryOrderCostQty({
        remainingQuantity: 3,
        initialQuantity: 3,
        soldQuantity: 0,
        totalSales: 100,
      }),
    ).toBe(false);
  });
});

describe("quantityFromBundleMembers", () => {
  it("sums quantityEst with a floor of 1 per member", () => {
    expect(
      quantityFromBundleMembers([
        { titleRaw: "a", quantityEst: 2 },
        { titleRaw: "b", quantityEst: null },
      ]),
    ).toBe(3);
  });

  it("lets a quantityOverride win over quantityEst per member", () => {
    expect(
      quantityFromBundleMembers([
        { titleRaw: "a", quantityEst: 2, quantityOverride: 5 },
        { titleRaw: "b", quantityEst: 4, quantityOverride: null },
      ]),
    ).toBe(9);
  });
});

describe("nameFromBundleMembers", () => {
  it("uses listing titleZh then titleRaw — never note", () => {
    expect(
      nameFromBundleMembers([
        { titleRaw: "仮面ライダー DX", titleZh: "假面骑士 DX" },
      ]),
    ).toBe("假面骑士 DX");
    expect(
      nameFromBundleMembers([{ titleRaw: "  belt  ", titleZh: null }]),
    ).toBe("belt");
    expect(nameFromBundleMembers([])).toBeNull();
  });
});

describe("syncInventoryOrderFromBundle", () => {
  it("creates when missing and updates cost/qty when pristine", async () => {
    const { tx } = concurrentOrderHarness();

    const created = await syncInventoryOrderFromBundle(tx as never, {
      bundleId: "bundle-1",
      purchaseCost: 200,
      purchasedAt: new Date("2026-09-01T00:00:00.000Z"),
      note: "采购备注，不是标题",
      members: [
        { titleRaw: "DX Henshin Belt", titleZh: "DX 变身腰带", quantityEst: 2 },
      ],
    });
    expect(created).toMatchObject({
      created: true,
      syncedCostQty: true,
      order: { id: expect.any(String) },
    });
    expect(tx.inventoryOrder.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "DX 变身腰带",
          note: "采购备注，不是标题",
        }),
      }),
    );

    const updated = await syncInventoryOrderFromBundle(tx as never, {
      bundleId: "bundle-1",
      purchaseCost: 250,
      purchasedAt: new Date("2026-09-01T00:00:00.000Z"),
      note: "n2",
      members: [
        { titleRaw: "DX Henshin Belt", titleZh: "DX 变身腰带", quantityEst: 2 },
      ],
    });
    expect(updated.syncedCostQty).toBe(true);
    expect(tx.inventoryOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          purchaseCost: 250,
          initialQuantity: 2,
          remainingQuantity: 2,
          name: "DX 变身腰带",
          note: "n2",
        }),
      }),
    );
  });

  it("does not put purchase note into name on create or sync", async () => {
    const { tx } = concurrentOrderHarness();

    await syncInventoryOrderFromBundle(tx as never, {
      bundleId: "bundle-note",
      purchaseCost: 100,
      purchasedAt: new Date("2026-09-01T00:00:00.000Z"),
      note: "缺配件，需补发",
      members: [{ titleRaw: "仮面ライダーベルト", titleZh: null }],
    });

    expect(tx.inventoryOrder.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "仮面ライダーベルト",
          note: "缺配件，需补发",
        }),
      }),
    );
  });

  it("skips cost/qty when sold state exists", async () => {
    const order = {
      id: "inv-1",
      sourceBundleId: "bundle-1",
      purchaseCost: 100,
      initialQuantity: 2,
      remainingQuantity: 1,
      soldQuantity: 1,
      totalSales: 80,
      status: "partially_sold",
      name: "old",
      note: null,
      platform: null,
      imageUrl: null,
    };
    const tx = {
      inventoryOrder: {
        findUnique: vi.fn().mockResolvedValue(order),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          ...order,
          ...data,
        })),
      },
    };

    const result = await syncInventoryOrderFromBundle(tx as never, {
      bundleId: "bundle-1",
      purchaseCost: 999,
      purchasedAt: new Date("2026-09-01T00:00:00.000Z"),
      note: "after sale",
      members: [
        { titleRaw: "listing title", titleZh: "商品标题", quantityEst: 5 },
      ],
    });
    expect(result.syncedCostQty).toBe(false);
    expect(tx.inventoryOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "商品标题",
          note: "after sale",
        }),
      }),
    );
    expect(tx.inventoryOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          purchaseCost: 999,
          initialQuantity: 5,
        }),
      }),
    );
  });
});
