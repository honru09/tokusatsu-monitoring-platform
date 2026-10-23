import { describe, expect, it, vi } from "vitest";
import { InventoryOrdersService } from "./inventory-orders.service.js";

function concurrentMutationHarness(remainingQuantity = 10) {
  const now = new Date("2026-09-01T00:00:00.000Z");
  const row = {
    id: "order-race",
    orderNumber: "ORD-RACE0001",
    name: "DX 腰带",
    platform: "Mercari",
    purchaseCost: 10_000,
    initialQuantity: 10,
    remainingQuantity,
    soldQuantity: 10 - remainingQuantity,
    totalSales: 0,
    status: "in_stock",
    purchasedAt: now,
    imageUrl: null,
    note: null,
    sourceBundleId: "bundle-race",
    createdAt: now,
    updatedAt: now,
  };
  const sales: Record<string, unknown>[] = [];
  const adjustments: Record<string, unknown>[] = [];
  let beforeWrite: (() => void) | undefined;
  const tx = {
    inventoryOrder: {
      findUnique: vi.fn(async () => ({ ...row })),
      findUniqueOrThrow: vi.fn(async () => ({ ...row })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        beforeWrite?.();
        beforeWrite = undefined;
        Object.assign(row, data);
        return { ...row };
      }),
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
            Object.entries(where).some(
              ([key, value]) => Reflect.get(row, key) !== value,
            )
          )
            return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
    },
    salesRecord: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const sale = {
          id: `sale-${sales.length}`,
          ...data,
          soldAt: now,
          createdAt: now,
        };
        sales.push(sale);
        return sale;
      }),
    },
    inventoryAdjustment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const adjustment = {
          id: `adjustment-${adjustments.length}`,
          ...data,
          createdAt: now,
        };
        adjustments.push(adjustment);
        return adjustment;
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
  return {
    service: new InventoryOrdersService(prisma as never),
    tx,
    prisma,
    row,
    sales,
    adjustments,
    race: (change: Partial<typeof row>) => {
      beforeWrite = () => {
        Object.assign(row, change);
      };
    },
  };
}

describe("InventoryOrdersService concurrent mutations", () => {
  it("keeps both sales and retries against current stock without lost updates", async () => {
    const h = concurrentMutationHarness();
    await Promise.all([
      h.service.sell("order-race", { quantity: 2, salePrice: 3_000 }),
      h.service.sell("order-race", { quantity: 3, salePrice: 4_000 }),
    ]);
    expect(h.row).toMatchObject({
      remainingQuantity: 5,
      soldQuantity: 5,
      totalSales: 7_000,
    });
    expect(h.sales).toHaveLength(2);
    expect(h.sales.map((sale) => sale.costOfSale).sort()).toEqual([
      2_000, 3_000,
    ]);
  });

  it("rejects overselling after a concurrent sale without recording the rejected sale", async () => {
    const h = concurrentMutationHarness(3);
    const outcomes = await Promise.allSettled([
      h.service.sell("order-race", { quantity: 2, salePrice: 3_000 }),
      h.service.sell("order-race", { quantity: 2, salePrice: 4_000 }),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(h.row.remainingQuantity).toBe(1);
    expect(h.sales).toHaveLength(1);
  });

  it("preserves a sale racing with a non-sale adjustment", async () => {
    const h = concurrentMutationHarness();
    await Promise.all([
      h.service.sell("order-race", { quantity: 2, salePrice: 3_000 }),
      h.service.adjust("order-race", { quantityDelta: -1, reason: "破损" }),
    ]);
    expect(h.row).toMatchObject({
      remainingQuantity: 7,
      soldQuantity: 2,
      totalSales: 3_000,
    });
    expect(h.sales).toHaveLength(1);
    expect(h.adjustments).toHaveLength(1);
  });

  it("recalculates sale cost after a concurrent purchase-bundle resync", async () => {
    const h = concurrentMutationHarness();
    h.race({ purchaseCost: 20_000, initialQuantity: 5, remainingQuantity: 5 });
    const result = await h.service.sell("order-race", {
      quantity: 2,
      salePrice: 10_000,
    });
    expect(h.row).toMatchObject({
      remainingQuantity: 3,
      initialQuantity: 5,
      purchaseCost: 20_000,
    });
    expect(result.sale.costOfSale).toBe(8_000);
    expect(h.sales).toHaveLength(1);
  });

  it.each(["sell", "adjust"] as const)(
    "bounds %s retries and leaves no audit rows on repeated contention",
    async (action) => {
      const h = concurrentMutationHarness();
      h.tx.inventoryOrder.updateMany.mockResolvedValue({ count: 0 });
      const mutation =
        action === "sell"
          ? h.service.sell("order-race", { quantity: 1, salePrice: 2_000 })
          : h.service.adjust("order-race", {
              quantityDelta: -1,
              reason: "破损",
            });
      await expect(mutation).rejects.toMatchObject({ status: 409 });
      expect(h.prisma.$transaction).toHaveBeenCalledTimes(3);
      expect(h.sales).toHaveLength(0);
      expect(h.adjustments).toHaveLength(0);
      expect(h.row.remainingQuantity).toBe(10);
    },
  );

  it("rechecks adjustment bounds against a concurrent sale and cannot make stock negative", async () => {
    const h = concurrentMutationHarness(2);
    h.race({ remainingQuantity: 0, soldQuantity: 10, status: "sold_out" });
    await expect(
      h.service.adjust("order-race", { quantityDelta: -1, reason: "破损" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(h.row.remainingQuantity).toBe(0);
    expect(h.adjustments).toHaveLength(0);
  });
});

describe("InventoryOrdersService", () => {
  it("lists orders with derived metrics", async () => {
    const row = {
      id: "ord-1",
      orderNumber: "ORD-ABCDEF12",
      name: "DX 腰带",
      platform: "Mercari",
      purchaseCost: 10_000,
      initialQuantity: 10,
      remainingQuantity: 6,
      soldQuantity: 4,
      totalSales: 5_000,
      status: "partially_sold",
      purchasedAt: new Date("2026-09-01T00:00:00.000Z"),
      imageUrl: null,
      note: null,
      sourceBundleId: null,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    };
    const prisma = {
      $transaction: vi.fn(async (ops: unknown[]) => {
        if (Array.isArray(ops)) return Promise.all(ops);
        return ops;
      }),
      inventoryOrder: {
        findMany: vi.fn().mockResolvedValue([row]),
        count: vi.fn().mockResolvedValue(1),
        aggregate: vi.fn().mockResolvedValue({
          _sum: {
            purchaseCost: 10_000,
            totalSales: 5_000,
            remainingQuantity: 6,
            soldQuantity: 4,
          },
        }),
      },
    };
    // Prisma $transaction with array of promises — mock findMany/count/aggregate as thenables
    prisma.$transaction = vi.fn(async (ops: Promise<unknown>[]) =>
      Promise.all(ops),
    );
    prisma.inventoryOrder.findMany.mockReturnValue(Promise.resolve([row]));
    prisma.inventoryOrder.count.mockReturnValue(Promise.resolve(1));
    prisma.inventoryOrder.aggregate.mockReturnValue(
      Promise.resolve({
        _sum: {
          purchaseCost: 10_000,
          totalSales: 5_000,
          remainingQuantity: 6,
          soldQuantity: 4,
        },
      }),
    );

    const service = new InventoryOrdersService(prisma as never);
    const result = await service.list({ page: 1, limit: 30 });

    expect(result.total).toBe(1);
    expect(result.orders[0]).toMatchObject({
      orderNumber: "ORD-ABCDEF12",
      averageCost: 1_000,
      realizedProfit: 1_000,
      recoveryPercent: 50,
      statusLabel: "部分售出",
      finalOrderProfit: null,
      finalOrderMarginPercent: null,
    });
  });

  it("serializes sold-out final profit and margin", async () => {
    const row = {
      id: "ord-sold",
      orderNumber: "ORD-SOLD0001",
      name: "清仓",
      platform: null,
      purchaseCost: 10_000,
      initialQuantity: 10,
      remainingQuantity: 0,
      soldQuantity: 10,
      totalSales: 12_000,
      status: "sold_out",
      purchasedAt: new Date("2026-09-01T00:00:00.000Z"),
      imageUrl: null,
      note: null,
      sourceBundleId: null,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    };
    const prisma = {
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
      inventoryOrder: {
        findMany: vi.fn().mockReturnValue(Promise.resolve([row])),
        count: vi.fn().mockReturnValue(Promise.resolve(1)),
        aggregate: vi.fn().mockReturnValue(
          Promise.resolve({
            _sum: {
              purchaseCost: 10_000,
              totalSales: 12_000,
              remainingQuantity: 0,
              soldQuantity: 10,
            },
          }),
        ),
      },
    };
    const service = new InventoryOrdersService(prisma as never);
    const result = await service.list({ page: 1, limit: 30 });
    expect(result.orders[0]).toMatchObject({
      statusLabel: "已售完",
      finalOrderProfit: 2_000,
      finalOrderMarginPercent: 20,
      realizedProfit: 2_000,
    });
  });

  it("sells and appends a sales record", async () => {
    const order = {
      id: "ord-1",
      orderNumber: "ORD-ABCDEF12",
      name: "DX 腰带",
      platform: null,
      purchaseCost: 10_000,
      initialQuantity: 10,
      remainingQuantity: 10,
      soldQuantity: 0,
      totalSales: 0,
      status: "in_stock",
      purchasedAt: new Date("2026-09-01T00:00:00.000Z"),
      imageUrl: null,
      note: null,
      sourceBundleId: null,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    };
    const updated = {
      ...order,
      remainingQuantity: 8,
      soldQuantity: 2,
      totalSales: 3_000,
      status: "partially_sold",
    };
    const sale = {
      id: "sale-1",
      quantity: 2,
      salePrice: 3_000,
      costOfSale: 2_000,
      profit: 1_000,
      note: null,
      soldAt: new Date("2026-09-02T00:00:00.000Z"),
    };
    const tx = {
      inventoryOrder: {
        findUnique: vi.fn().mockResolvedValue(order),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(updated),
      },
      salesRecord: {
        create: vi.fn().mockResolvedValue(sale),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const service = new InventoryOrdersService(prisma as never);
    const result = await service.sell("ord-1", {
      quantity: 2,
      salePrice: 3_000,
    });

    expect(tx.salesRecord.create).toHaveBeenCalled();
    expect(result.order.remainingQuantity).toBe(8);
    expect(result.order.realizedProfit).toBe(1_000);
    expect(result.sale.costOfSale).toBe(2_000);
  });

  it("adjusts remaining without sales", async () => {
    const order = {
      id: "ord-1",
      orderNumber: "ORD-ABCDEF12",
      name: null,
      platform: null,
      purchaseCost: 5_000,
      initialQuantity: 5,
      remainingQuantity: 5,
      soldQuantity: 0,
      totalSales: 0,
      status: "in_stock",
      purchasedAt: null,
      imageUrl: null,
      note: null,
      sourceBundleId: null,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    };
    const updated = {
      ...order,
      remainingQuantity: 4,
      status: "partially_sold",
    };
    const adjustment = {
      id: "adj-1",
      quantityDelta: -1,
      reason: "破损",
      createdAt: new Date("2026-09-02T00:00:00.000Z"),
    };
    const tx = {
      inventoryOrder: {
        findUnique: vi.fn().mockResolvedValue(order),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(updated),
      },
      inventoryAdjustment: {
        create: vi.fn().mockResolvedValue(adjustment),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const service = new InventoryOrdersService(prisma as never);
    const result = await service.adjust("ord-1", {
      quantityDelta: -1,
      reason: "破损",
    });

    expect(result.order.remainingQuantity).toBe(4);
    expect(result.order.totalSales).toBe(0);
    expect(result.adjustment.reason).toBe("破损");
  });
});
