import "reflect-metadata";
import { validate } from "class-validator";
import { describe, expect, it, vi } from "vitest";

vi.mock("bullmq", () => ({
  Queue: class {
    add = vi.fn();
    close = vi.fn();
    getJob = vi.fn();
  },
}));

vi.mock("ioredis", () => ({
  Redis: class {
    quit = vi.fn();
  },
}));

// The workspace copy of @tokusatsu/shared used to run these tests predates
// the inventory-order helpers, so add them with the same semantics as
// packages/shared/src/inventory-order.ts on top of the real module.
vi.mock("@tokusatsu/shared", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // Enum lists the DTO decorators read at class definition time; the
    // borrowed build is missing some of them, so mirror this repo's
    // packages/shared values.
    categoryIps: [
      "kamen_rider",
      "ultraman",
      "super_sentai",
      "godzilla",
      "other",
      "unknown",
    ],
    collectibleSeriesKeys: ["shf", "sic"],
    toyTypes: [
      "gashapon",
      "shokugan",
      "figure",
      "sofubi",
      "finger_puppet",
      "dx_belt",
      "henshin_item",
      "card",
      "medal",
      "model",
      "set",
      "other",
      "unknown",
    ],
    manufacturers: [
      "bandai",
      "bandai_spirits",
      "banpresto",
      "megahouse",
      "plex",
      "other",
      "unknown",
    ],
    conditionGrades: [
      "new_sealed",
      "like_new",
      "used",
      "stained_or_damaged",
      "junk",
      "unknown",
    ],
    shfLines: ["standard", "shinkocchou"],
    shfReleaseChannels: ["retail", "tamashii_web", "event", "unknown"],
    shfEditions: ["first", "reissue", "unknown"],
    shfRegions: ["japanese", "agent", "hong_kong", "unknown"],
    orderNumberFromId: (id: string) => {
      const hex = id.replace(/-/g, "").replace(/[^0-9a-fA-F]/g, "");
      if (hex.length >= 8) return `ORD-${hex.slice(0, 8).toUpperCase()}`;
      const alnum = id
        .replace(/[^0-9a-zA-Z]/g, "")
        .toUpperCase()
        .padEnd(8, "0")
        .slice(0, 8);
      return `ORD-${alnum}`;
    },
    resolveInventoryOrderStatus: (remaining: number, initial: number) =>
      remaining === initial
        ? "in_stock"
        : remaining === 0
          ? "sold_out"
          : "partially_sold",
  };
});

import { ItemsService } from "./items.service.js";
import { PurchaseBundleMemberDto, PurchaseDto } from "./items.dto.js";

type InventoryRow = { productId: string; quantity: number; averageCost: number | null };

function quantityHarness() {
  const now = new Date("2026-10-25T00:00:00.000Z");
  const items = [
    {
      id: "item-1",
      productId: "product-1",
      quantityEst: 2,
      titleRaw: "DX belt set",
      titleZh: "DX 腰带套装",
      source: { displayName: "Mercari" },
      images: [] as { url: string }[],
      purchaseRecord: null as Record<string, unknown> | null,
    },
    {
      id: "item-2",
      productId: "product-2",
      quantityEst: 5,
      titleRaw: "Figure lot",
      titleZh: "手办套装",
      source: { displayName: "Mercari" },
      images: [] as { url: string }[],
      purchaseRecord: null as Record<string, unknown> | null,
    },
  ];
  const bundles = new Map<string, Record<string, unknown>>();
  const purchases = new Map<string, Record<string, unknown>>();
  const inventory = new Map<string, InventoryRow>();
  const inventoryOrders = new Map<string, Record<string, unknown>>();
  let sequence = 0;

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

  const tx = {
    item: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        items.filter((item) => where.id.in.includes(item.id)),
      ),
      update: vi.fn(async () => ({})),
    },
    purchaseBundle: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        sequence += 1;
        const id = `bundle-new-${sequence}`;
        const row = {
          id,
          pricingMode: data.pricingMode ?? "per_item",
          totalPurchaseAmount: data.totalPurchaseAmount,
          currency: "JPY",
          purchasedAt: data.purchasedAt ?? now,
          note: data.note ?? null,
          archivedAt: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        bundles.set(id, row);
        return row;
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
          where: { id: string; version?: number };
          data: Record<string, unknown>;
        }) => {
          const bundle = bundles.get(where.id);
          if (!bundle || (where.version != null && bundle.version !== where.version))
            return { count: 0 };
          if (typeof data.pricingMode === "string")
            bundle.pricingMode = data.pricingMode;
          if (typeof data.totalPurchaseAmount === "number")
            bundle.totalPurchaseAmount = data.totalPurchaseAmount;
          if (data.purchasedAt instanceof Date)
            bundle.purchasedAt = data.purchasedAt;
          if ("note" in data) bundle.note = data.note ?? null;
          if (
            data.version &&
            typeof data.version === "object" &&
            "increment" in data.version
          )
            bundle.version =
              Number(bundle.version) +
              Number((data.version as { increment: number }).increment);
          return { count: 1 };
        },
      ),
    },
    purchaseRecord: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        sequence += 1;
        const row = {
          id: `purchase-${sequence}`,
          createdAt: now,
          verifiedAt: null,
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
    },
    purchaseBundleAudit: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "audit-1",
        ...data,
      })),
    },
    inventory: {
      findUnique: vi.fn(
        async ({ where }: { where: { productId: string } }) =>
          inventory.get(where.productId) ?? null,
      ),
      upsert: vi.fn(
        async ({
          where,
          update,
          create,
        }: {
          where: { productId: string };
          update: Record<string, unknown>;
          create: InventoryRow;
        }) => {
          const existing = inventory.get(where.productId);
          if (!existing) {
            inventory.set(where.productId, { ...create });
            return create;
          }
          const quantity = update.quantity as
            | number
            | { increment: number }
            | undefined;
          if (typeof quantity === "number") existing.quantity = quantity;
          else if (quantity?.increment)
            existing.quantity += quantity.increment;
          if ("averageCost" in update)
            existing.averageCost = update.averageCost as number | null;
          return existing;
        },
      ),
    },
    inventoryOrder: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { sourceBundleId?: string; id?: string };
        }) => {
          const row = where.id
            ? inventoryOrders.get(where.id)
            : [...inventoryOrders.values()].find(
                (order) => order.sourceBundleId === where.sourceBundleId,
              );
          return row ? { ...row } : null;
        },
      ),
      findUniqueOrThrow: vi.fn(
        async ({
          where,
        }: {
          where: { sourceBundleId?: string; id?: string };
        }) => {
          const row = where.id
            ? inventoryOrders.get(where.id)
            : [...inventoryOrders.values()].find(
                (order) => order.sourceBundleId === where.sourceBundleId,
              );
          if (!row) throw new Error("Inventory order missing");
          return { ...row };
        },
      ),
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (
          [...inventoryOrders.values()].some(
            (order) => order.sourceBundleId === data.sourceBundleId,
          )
        )
          return { count: 0 };
        inventoryOrders.set(data.id as string, { ...data });
        return { count: 1 };
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = inventoryOrders.get(where.id)!;
          Object.assign(row, data);
          return { ...row };
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
  return { prisma, tx, items, bundles, purchases, inventory, inventoryOrders, bundleRow, now };
}

describe("purchase quantityOverride", () => {
  it("stores the override and lets it win over quantityEst in both inventory ledgers", async () => {
    const harness = quantityHarness();
    const service = new ItemsService(harness.prisma as never);

    await service.createPurchaseBundle({
      pricingMode: "per_item",
      members: [
        { itemId: "item-1", amountYen: 900, quantity: 3 },
        { itemId: "item-2", amountYen: 1_000 },
      ],
      actor: "operator-a",
      reason: "登记购买",
    });

    const records = [...harness.purchases.values()];
    expect(records.find((r) => r.itemId === "item-1")).toMatchObject({
      quantityOverride: 3,
    });
    expect(records.find((r) => r.itemId === "item-2")).toMatchObject({
      quantityOverride: null,
    });
    // Product inventory: override 3 beats the recognised estimate of 2, and
    // the average cost is the allocated amount spread over 3 units.
    expect(harness.inventory.get("product-1")).toMatchObject({
      quantity: 3,
      averageCost: 300,
    });
    // No override: the estimate of 5 still applies.
    expect(harness.inventory.get("product-2")).toMatchObject({
      quantity: 5,
      averageCost: 200,
    });
    // Inventory order dual-write: 3 + 5 units for the bundle total.
    const order = [...harness.inventoryOrders.values()][0];
    expect(order).toMatchObject({
      purchaseCost: 1_900,
      initialQuantity: 8,
      remainingQuantity: 8,
    });
  });

  it("re-syncs the linked inventory order and product count when an edit changes the override", async () => {
    const harness = quantityHarness();
    // Existing singleton purchase: bundle-a / purchase-a, override 3.
    harness.bundles.set("bundle-a", {
      id: "bundle-a",
      pricingMode: "per_item",
      totalPurchaseAmount: 900,
      currency: "JPY",
      purchasedAt: harness.now,
      note: null,
      archivedAt: null,
      version: 1,
      createdAt: harness.now,
      updatedAt: harness.now,
    });
    harness.purchases.set("purchase-a", {
      id: "purchase-a",
      itemId: "item-1",
      bundleId: "bundle-a",
      purchaseAmount: 900,
      amountAllocated: true,
      quantityOverride: 3,
      purchasedAt: harness.now,
      note: null,
      verifiedAt: null,
      createdAt: harness.now,
    });
    harness.items[0].purchaseRecord = {
      ...harness.purchases.get("purchase-a"),
      bundle: { purchases: [{ id: "purchase-a" }] },
    } as never;
    harness.inventory.set("product-1", {
      productId: "product-1",
      quantity: 3,
      averageCost: 300,
    });
    harness.inventoryOrders.set("inv-a", {
      id: "inv-a",
      sourceBundleId: "bundle-a",
      purchaseCost: 900,
      initialQuantity: 3,
      remainingQuantity: 3,
      soldQuantity: 0,
      totalSales: 0,
      status: "in_stock",
      name: "DX belt set",
      platform: "Mercari",
      imageUrl: null,
      note: null,
    });
    const service = new ItemsService(harness.prisma as never);

    await service.updatePurchaseBundle("bundle-a", {
      expectedVersion: 1,
      members: [{ itemId: "item-1", amountYen: 900, quantity: 6 }],
      actor: "operator-b",
      reason: "实物清点后修正数量",
    });

    expect(harness.purchases.get("purchase-a")).toMatchObject({
      quantityOverride: 6,
    });
    expect(harness.inventory.get("product-1")?.quantity).toBe(6);
    expect(harness.inventoryOrders.get("inv-a")).toMatchObject({
      initialQuantity: 6,
      remainingQuantity: 6,
      purchaseCost: 900,
    });
  });

  it("does not rewrite the linked inventory order quantity after units have sold", async () => {
    const harness = quantityHarness();
    harness.bundles.set("bundle-a", {
      id: "bundle-a",
      pricingMode: "per_item",
      totalPurchaseAmount: 900,
      currency: "JPY",
      purchasedAt: harness.now,
      note: null,
      archivedAt: null,
      version: 1,
      createdAt: harness.now,
      updatedAt: harness.now,
    });
    harness.purchases.set("purchase-a", {
      id: "purchase-a",
      itemId: "item-1",
      bundleId: "bundle-a",
      purchaseAmount: 900,
      amountAllocated: true,
      quantityOverride: 3,
      purchasedAt: harness.now,
      note: null,
      verifiedAt: null,
      createdAt: harness.now,
    });
    harness.items[0].purchaseRecord = {
      ...harness.purchases.get("purchase-a"),
      bundle: { purchases: [{ id: "purchase-a" }] },
    } as never;
    harness.inventoryOrders.set("inv-a", {
      id: "inv-a",
      sourceBundleId: "bundle-a",
      purchaseCost: 900,
      initialQuantity: 3,
      remainingQuantity: 2,
      soldQuantity: 1,
      totalSales: 500,
      status: "partially_sold",
      name: "DX belt set",
      platform: "Mercari",
      imageUrl: null,
      note: null,
    });
    const service = new ItemsService(harness.prisma as never);

    await service.updatePurchaseBundle("bundle-a", {
      expectedVersion: 1,
      members: [{ itemId: "item-1", amountYen: 900, quantity: 6 }],
      actor: "operator-b",
      reason: "修正数量",
    });

    // The record itself is corrected, but the sold batch keeps its numbers.
    expect(harness.purchases.get("purchase-a")).toMatchObject({
      quantityOverride: 6,
    });
    expect(harness.inventoryOrders.get("inv-a")).toMatchObject({
      initialQuantity: 3,
      remainingQuantity: 2,
      soldQuantity: 1,
      purchaseCost: 900,
    });
  });
});

describe("purchase quantity DTO validation", () => {
  it("accepts an integer quantity of at least 1 and rejects 0", async () => {
    const purchase = Object.assign(new PurchaseDto(), {
      purchaseAmount: 1_000,
      quantity: 3,
    });
    const badPurchase = Object.assign(new PurchaseDto(), {
      purchaseAmount: 1_000,
      quantity: 0,
    });
    const member = Object.assign(new PurchaseBundleMemberDto(), {
      itemId: "item-1",
      amountYen: 500,
      quantity: 2,
    });
    const badMember = Object.assign(new PurchaseBundleMemberDto(), {
      itemId: "item-1",
      amountYen: 500,
      quantity: 0,
    });

    expect(await validate(purchase)).toHaveLength(0);
    expect(await validate(member)).toHaveLength(0);
    expect(await validate(badPurchase)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: "quantity" }),
      ]),
    );
    expect(await validate(badMember)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: "quantity" }),
      ]),
    );
  });
});
