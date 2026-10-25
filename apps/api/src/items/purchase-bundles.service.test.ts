import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { ItemsService } from "./items.service.js";

type BundleState = {
  id: string;
  pricingMode: "per_item" | "bundle_total";
  totalPurchaseAmount: number;
  currency: string;
  purchasedAt: Date;
  note: string | null;
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

type PurchaseState = {
  id: string;
  itemId: string;
  bundleId: string;
  purchaseAmount: number;
  amountAllocated: boolean;
  purchasedAt: Date;
  note: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
};

function purchaseHarness() {
  const now = new Date("2026-08-31T00:00:00.000Z");
  const bundles = new Map<string, BundleState>();
  const purchases = new Map<string, PurchaseState>();
  const audits: Array<Record<string, unknown>> = [];
  let sequence = 0;

  const addSingleton = (suffix: string, amount: number) => {
    const bundleId = `bundle-${suffix}`;
    const purchaseId = `purchase-${suffix}`;
    bundles.set(bundleId, {
      id: bundleId,
      pricingMode: "per_item",
      totalPurchaseAmount: amount,
      currency: "JPY",
      purchasedAt: now,
      note: null,
      archivedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    purchases.set(purchaseId, {
      id: purchaseId,
      itemId: `item-${suffix}`,
      bundleId,
      purchaseAmount: amount,
      amountAllocated: true,
      purchasedAt: now,
      note: null,
      verifiedAt: null,
      createdAt: now,
    });
  };
  addSingleton("a", 400);
  addSingleton("b", 600);

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

  const itemRows = () =>
    ["a", "b"].map((suffix) => {
      const purchase = purchases.get(`purchase-${suffix}`)!;
      const bundle = bundleRow(purchase.bundleId)!;
      return {
        id: `item-${suffix}`,
        productId: null,
        quantityEst: 1,
        titleRaw: `商品 ${suffix}`,
        titleZh: `商品 ${suffix}`,
        source: { displayName: "Mercari" },
        images: [] as { url: string }[],
        purchaseRecord: {
          ...purchase,
          bundle: {
            ...bundle,
            purchases: bundle.purchases.map(({ id }) => ({ id })),
          },
        },
      };
    });

  const inventoryOrders = new Map<string, Record<string, unknown>>();
  const readInventoryOrder = (where: {
    sourceBundleId?: string;
    id?: string;
  }) => {
    const row = where.id
      ? inventoryOrders.get(where.id)
      : [...inventoryOrders.values()].find(
          (order) => order.sourceBundleId === where.sourceBundleId,
        );
    return row ? { ...row } : null;
  };

  const tx = {
    item: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        itemRows().filter((item) => where.id.in.includes(item.id)),
      ),
      update: vi.fn(async () => ({})),
    },
    purchaseBundle: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        sequence += 1;
        const id = `bundle-new-${sequence}`;
        bundles.set(id, {
          id,
          pricingMode:
            (data.pricingMode as BundleState["pricingMode"]) ?? "per_item",
          totalPurchaseAmount: data.totalPurchaseAmount as number,
          currency: "JPY",
          purchasedAt: (data.purchasedAt as Date) ?? now,
          note: (data.note as string | null | undefined) ?? null,
          archivedAt: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        return bundles.get(id)!;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        bundleRow(where.id),
      ),
      findUniqueOrThrow: vi.fn(
        async ({ where }: { where: { id: string } }) => bundleRow(where.id)!,
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; version?: number; archivedAt?: null };
          data: Record<string, unknown>;
        }) => {
          const bundle = bundles.get(where.id);
          if (
            !bundle ||
            (where.version != null && bundle.version !== where.version) ||
            (where.archivedAt === null && bundle.archivedAt !== null)
          )
            return { count: 0 };
          if (typeof data.pricingMode === "string")
            bundle.pricingMode = data.pricingMode as BundleState["pricingMode"];
          if (typeof data.totalPurchaseAmount === "number")
            bundle.totalPurchaseAmount = data.totalPurchaseAmount;
          if (data.purchasedAt instanceof Date)
            bundle.purchasedAt = data.purchasedAt;
          if ("note" in data)
            bundle.note = (data.note as string | null) ?? null;
          if (data.archivedAt instanceof Date)
            bundle.archivedAt = data.archivedAt;
          if (
            data.version &&
            typeof data.version === "object" &&
            "increment" in data.version
          )
            bundle.version += Number(
              (data.version as { increment: number }).increment,
            );
          return { count: 1 };
        },
      ),
    },
    purchaseRecord: {
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<PurchaseState>;
        }) => {
          const purchase = purchases.get(where.id)!;
          Object.assign(purchase, data);
          return purchase;
        },
      ),
      create: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    purchaseBundleAudit: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return { id: `audit-${audits.length}`, ...data };
      }),
    },
    negotiationCase: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    inventory: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    inventoryOrder: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { sourceBundleId?: string; id?: string };
        }) => {
          return readInventoryOrder(where);
        },
      ),
      findUniqueOrThrow: vi.fn(
        async ({
          where,
        }: {
          where: { sourceBundleId?: string; id?: string };
        }) => {
          const order = readInventoryOrder(where);
          if (!order) throw new Error("Inventory order missing");
          return order;
        },
      ),
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (
          readInventoryOrder({ sourceBundleId: data.sourceBundleId as string })
        )
          return { count: 0 };
        const id = (data.id as string) ?? `inv-${inventoryOrders.size + 1}`;
        inventoryOrders.set(id, { ...data, id });
        return { count: 1 };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = (data.id as string) ?? `inv-${inventoryOrders.size + 1}`;
        const row = { ...data, id };
        inventoryOrders.set(id, row);
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
          const row = inventoryOrders.get(where.id);
          if (!row) throw new Error(`inventory order ${where.id} missing`);
          Object.assign(row, data);
          return row;
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown> & { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = inventoryOrders.get(where.id);
          if (
            !row ||
            Object.entries(where).some(([key, value]) => row[key] !== value)
          )
            return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
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
    bundles,
    purchases,
    audits,
    bundleRow,
    inventoryOrders,
  };
}

describe("ItemsService purchase bundle membership", () => {
  it("merges existing singleton purchases and archives old totals", async () => {
    const harness = purchaseHarness();
    const service = new ItemsService(harness.prisma as never);

    const result = await service.createPurchaseBundle({
      pricingMode: "per_item",
      members: [
        { itemId: "item-a", amountYen: 400 },
        { itemId: "item-b", amountYen: 600 },
      ],
      actor: "operator-a",
      reason: "两件商品为同一笔付款",
    });

    expect(result.bundle).toMatchObject({
      id: "bundle-new-1",
      totalPurchaseAmount: 1_000,
    });
    expect(harness.purchases.get("purchase-a")?.bundleId).toBe("bundle-new-1");
    expect(harness.purchases.get("purchase-b")?.bundleId).toBe("bundle-new-1");
    expect(harness.bundles.get("bundle-a")?.archivedAt).toBeInstanceOf(Date);
    expect(harness.bundles.get("bundle-b")?.archivedAt).toBeInstanceOf(Date);
    expect(harness.audits.map((audit) => audit.eventType)).toEqual([
      "archived",
      "archived",
      "created",
    ]);
    expect(harness.tx.inventoryOrder.createMany).toHaveBeenCalled();
  });

  it("moves an existing singleton PurchaseRecord during PATCH replacement", async () => {
    const harness = purchaseHarness();
    const service = new ItemsService(harness.prisma as never);

    const result = await service.updatePurchaseBundle("bundle-a", {
      expectedVersion: 1,
      members: [
        { itemId: "item-a", amountYen: 450 },
        { itemId: "item-b", amountYen: 550 },
      ],
      actor: "operator-b",
      reason: "补录同一订单中的第二件商品",
    });

    expect(result.bundle).toMatchObject({
      id: "bundle-a",
      version: 2,
      totalPurchaseAmount: 1_000,
    });
    expect(harness.purchases.get("purchase-b")?.bundleId).toBe("bundle-a");
    expect(harness.bundles.get("bundle-b")?.archivedAt).toBeInstanceOf(Date);
    expect(harness.audits.map((audit) => audit.eventType)).toEqual([
      "archived",
      "members_changed",
    ]);
    expect(harness.tx.inventoryOrder.createMany).toHaveBeenCalled();
    const linked = [...harness.inventoryOrders.values()].find(
      (order) => order.sourceBundleId === "bundle-a",
    );
    expect(linked).toMatchObject({
      purchaseCost: 1_000,
      initialQuantity: 2,
      remainingQuantity: 2,
      soldQuantity: 0,
    });
  });

  it("resyncs linked inventory cost/qty on PATCH when still pristine", async () => {
    const harness = purchaseHarness();
    harness.inventoryOrders.set("inv-a", {
      id: "inv-a",
      sourceBundleId: "bundle-a",
      purchaseCost: 400,
      initialQuantity: 1,
      remainingQuantity: 1,
      soldQuantity: 0,
      totalSales: 0,
      status: "in_stock",
      name: "商品 a",
      note: null,
    });
    const service = new ItemsService(harness.prisma as never);

    await service.updatePurchaseBundle("bundle-a", {
      expectedVersion: 1,
      members: [{ itemId: "item-a", amountYen: 480 }],
      actor: "operator-c",
      reason: "更正采购价",
    });

    expect(harness.inventoryOrders.get("inv-a")).toMatchObject({
      purchaseCost: 480,
      initialQuantity: 1,
      remainingQuantity: 1,
    });
    expect(harness.tx.inventoryOrder.updateMany).toHaveBeenCalled();
  });

  it("does not clobber inventory cost/qty after sales on PATCH", async () => {
    const harness = purchaseHarness();
    harness.inventoryOrders.set("inv-a", {
      id: "inv-a",
      sourceBundleId: "bundle-a",
      purchaseCost: 400,
      initialQuantity: 1,
      remainingQuantity: 0,
      soldQuantity: 1,
      totalSales: 500,
      status: "sold_out",
      name: "商品 a",
      note: null,
    });
    const service = new ItemsService(harness.prisma as never);

    await service.updatePurchaseBundle("bundle-a", {
      expectedVersion: 1,
      members: [{ itemId: "item-a", amountYen: 999 }],
      actor: "operator-d",
      reason: "事后改价不应覆盖已售批次",
    });

    expect(harness.inventoryOrders.get("inv-a")).toMatchObject({
      purchaseCost: 400,
      initialQuantity: 1,
      remainingQuantity: 0,
      soldQuantity: 1,
      totalSales: 500,
    });
  });
});
