import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { ItemsService } from "./items.service.js";

// Harness for the unified registration path (createPurchaseBundle, plus the
// legacy single-item purchase() delegating to it). Covers the field set the
// one web form submits: per-item actual paid amount, quantity override,
// purchasedAt, note/platform, negotiation auto-close and the inventory
// order dual-write.
function registrationHarness() {
  const now = new Date("2026-10-25T00:00:00.000Z");
  const items = new Map<string, Record<string, unknown>>();
  const bundles = new Map<string, Record<string, unknown>>();
  const purchases = new Map<string, Record<string, unknown>>();
  const inventoryOrders = new Map<string, Record<string, unknown>>();
  const negotiationCases = new Map<
    string,
    { itemId: string; status: string; statusChangedAt: Date }
  >();
  let sequence = 0;

  const addItem = (id: string) => {
    items.set(id, {
      id,
      productId: null,
      quantityEst: 2,
      titleRaw: `商品 ${id}`,
      titleZh: `商品 ${id}`,
      source: { displayName: "Mercari" },
      images: [] as { url: string }[],
      purchaseRecord: null,
    });
  };
  addItem("item-1");
  addItem("item-2");
  negotiationCases.set("case-1", {
    itemId: "item-1",
    status: "in_progress",
    statusChangedAt: new Date("2026-10-20T00:00:00.000Z"),
  });
  negotiationCases.set("case-2", {
    itemId: "item-2",
    status: "success",
    statusChangedAt: new Date("2026-10-21T00:00:00.000Z"),
  });

  const bundleRow = (id: string) => {
    const bundle = bundles.get(id);
    if (!bundle) return null;
    return {
      ...bundle,
      purchases: [...purchases.values()].filter(
        (purchase) => purchase.bundleId === id,
      ),
    };
  };
  const readInventoryOrder = (where: { sourceBundleId?: string; id?: string }) =>
    where.id
      ? inventoryOrders.get(where.id)
      : [...inventoryOrders.values()].find(
          (order) => order.sourceBundleId === where.sourceBundleId,
        );

  const tx = {
    source: {
      upsert: vi.fn(async () => ({ id: "source-manual" })),
    },
    item: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in
          .map((id) => items.get(id))
          .filter((item) => item != null),
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          productId: null,
          titleZh: data.titleZh,
          titleRaw: data.titleRaw,
          source: { displayName: "站外购买" },
          images: [] as { url: string }[],
          purchaseRecord: null,
          ...data,
        };
        items.set(data.id as string, row);
        return row;
      }),
      update: vi.fn(async () => ({})),
    },
    purchaseBundle: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        sequence += 1;
        const row = {
          id: `bundle-${sequence}`,
          currency: "JPY",
          archivedAt: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        bundles.set(row.id as string, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        bundleRow(where.id),
      ),
      findUniqueOrThrow: vi.fn(
        async ({ where }: { where: { id: string } }) => bundleRow(where.id)!,
      ),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    purchaseRecord: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        sequence += 1;
        const row = {
          id: `purchase-${sequence}`,
          verifiedAt: null,
          createdAt: now,
          ...data,
        };
        purchases.set(row.id as string, row);
        return row;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = purchases.get(where.id)!;
          Object.assign(row, data);
          return row;
        },
      ),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(
        async ({ where }: { where: { id: string } }) => ({
          ...purchases.get(where.id)!,
          receipts: [],
          bundle: bundleRow(purchases.get(where.id)!.bundleId as string),
          item: items.get(purchases.get(where.id)!.itemId as string),
        }),
      ),
    },
    purchaseBundleAudit: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "audit-1",
        ...data,
      })),
    },
    purchaseReceipt: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "receipt-1",
        ...data,
      })),
    },
    inventory: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
    },
    inventoryOrder: {
      findUnique: vi.fn(
        async ({ where }: { where: { sourceBundleId?: string; id?: string } }) =>
          readInventoryOrder(where) ?? null,
      ),
      findUniqueOrThrow: vi.fn(
        async ({ where }: { where: { sourceBundleId?: string; id?: string } }) =>
          readInventoryOrder(where)!,
      ),
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (readInventoryOrder({ sourceBundleId: data.sourceBundleId as string }))
          return { count: 0 };
        inventoryOrders.set(data.id as string, { ...data });
        return { count: 1 };
      }),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    negotiationCase: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { itemId: { in: string[] }; status: string };
          data: { status: string; statusChangedAt: Date };
        }) => {
          let count = 0;
          for (const entry of negotiationCases.values()) {
            if (
              where.itemId.in.includes(entry.itemId) &&
              entry.status === where.status
            ) {
              entry.status = data.status;
              entry.statusChangedAt = data.statusChangedAt;
              count += 1;
            }
          }
          return { count };
        },
      ),
    },
  };
  const prisma = {
    $transaction: vi.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
  return {
    prisma,
    tx,
    items,
    purchases,
    inventoryOrders,
    negotiationCases,
  };
}

const actorReason = { actor: "shared-user", reason: "登记购买" };

describe("unified purchase registration", () => {
  it("registers a single item through the bundle endpoint with actual paid amount and quantity override", async () => {
    const harness = registrationHarness();
    const service = new ItemsService(harness.prisma as never);

    const result = await service.createPurchaseBundle({
      pricingMode: "per_item",
      members: [{ itemId: "item-1", amountYen: 12_800, quantity: 3 }],
      purchasedAt: "2026-10-25T03:00:00.000Z",
      note: "含转运费",
      ...actorReason,
    } as never);

    const purchase = [...harness.purchases.values()][0]!;
    expect(purchase.purchaseAmount).toBe(12_800);
    expect(purchase.quantityOverride).toBe(3);
    expect(purchase.note).toBe("含转运费");
    expect(result.bundle.totalPurchaseAmount).toBe(12_800);

    // Inventory dual-write: one order, quantity from the override (3),
    // not from the recognised estimate (2).
    const orders = [...harness.inventoryOrders.values()];
    expect(orders).toHaveLength(1);
    expect(orders[0]!.purchaseCost).toBe(12_800);
    expect(orders[0]!.initialQuantity).toBe(3);
  });

  it("closes an in-progress negotiation case as success and leaves a success case untouched", async () => {
    const harness = registrationHarness();
    const service = new ItemsService(harness.prisma as never);

    await service.createPurchaseBundle({
      pricingMode: "per_item",
      members: [
        { itemId: "item-1", amountYen: 5_000, quantity: 1 },
        { itemId: "item-2", amountYen: 7_000, quantity: 1 },
      ],
      ...actorReason,
    } as never);

    const closed = harness.negotiationCases.get("case-1")!;
    expect(closed.status).toBe("success");
    expect(closed.statusChangedAt.getTime()).toBeGreaterThan(
      new Date("2026-10-20T00:00:00.000Z").getTime(),
    );
    const alreadySuccess = harness.negotiationCases.get("case-2")!;
    expect(alreadySuccess.status).toBe("success");
    expect(alreadySuccess.statusChangedAt).toEqual(
      new Date("2026-10-21T00:00:00.000Z"),
    );
  });

  it("registers an off-catalog buy by creating the item inside the same transaction", async () => {
    const harness = registrationHarness();
    const service = new ItemsService(harness.prisma as never);

    const result = await service.createPurchaseBundle({
      pricingMode: "per_item",
      members: [
        {
          title: "站外买的腰带",
          platform: "闲鱼",
          amountYen: 9_800,
          quantity: 2,
        },
      ],
      platform: "闲鱼",
      ...actorReason,
    } as never);

    expect(harness.tx.item.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          titleRaw: "站外买的腰带",
          priceTotalEst: 9_800,
          importOrigin: "purchase",
        }),
      }),
    );
    const purchase = [...harness.purchases.values()][0]!;
    expect(purchase.purchaseAmount).toBe(9_800);
    expect(purchase.quantityOverride).toBe(2);
    expect(result.bundle.totalPurchaseAmount).toBe(9_800);
    const orders = [...harness.inventoryOrders.values()];
    expect(orders).toHaveLength(1);
    expect(orders[0]!.platform).toBe("闲鱼");
    expect(orders[0]!.initialQuantity).toBe(2);
  });

  it("rejects an off-catalog member without a title", async () => {
    const harness = registrationHarness();
    const service = new ItemsService(harness.prisma as never);

    await expect(
      service.createPurchaseBundle({
        pricingMode: "per_item",
        members: [{ amountYen: 1_000 }],
        ...actorReason,
      } as never),
    ).rejects.toThrow("需要填写名称");
  });

  it("legacy single-item purchase() lands on the same bundle path", async () => {
    const harness = registrationHarness();
    const service = new ItemsService(harness.prisma as never);

    const result = await service.purchase("item-1", {
      purchaseAmount: 6_400,
      quantity: 4,
    });

    const purchase = [...harness.purchases.values()][0]!;
    expect(purchase.purchaseAmount).toBe(6_400);
    expect(purchase.quantityOverride).toBe(4);
    expect(result.purchase.id).toBe(purchase.id);
    expect(result.verified).toBe(false);
    // The negotiation auto-close applies here too, because it is the
    // same service path.
    expect(harness.negotiationCases.get("case-1")!.status).toBe("success");
    const orders = [...harness.inventoryOrders.values()];
    expect(orders).toHaveLength(1);
    expect(orders[0]!.initialQuantity).toBe(4);
  });
});
