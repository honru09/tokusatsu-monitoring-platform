import { Prisma } from "@tokusatsu/db";
import {
  orderNumberFromId,
  resolveInventoryOrderStatus,
} from "@tokusatsu/shared";
import { randomUUID } from "node:crypto";

export type BundleMemberForInventory = {
  quantityEst?: number | null;
  titleZh?: string | null;
  titleRaw: string;
  platform?: string | null;
  imageUrl?: string | null;
};

export function quantityFromBundleMembers(
  members: BundleMemberForInventory[],
): number {
  return Math.max(
    1,
    members.reduce(
      (sum, member) => sum + Math.max(1, member.quantityEst ?? 1),
      0,
    ),
  );
}

/** Display name from listing/product title — never from purchase note/remark. */
export function nameFromBundleMembers(
  members: BundleMemberForInventory[],
): string | null {
  const first = members[0];
  if (!first) return null;
  return first.titleZh?.trim() || first.titleRaw?.trim() || null;
}

/**
 * Safe to rewrite purchaseCost / initialQuantity / remainingQuantity (and thus
 * derived averageCost) only when the linked order is still pristine:
 * remaining === initial AND soldQuantity === 0 AND totalSales === 0.
 *
 * If any units have been sold (or remaining was adjusted away from initial),
 * we leave cost/qty alone so dual-write never clobbers sold state. Metadata
 * (note / purchasedAt / name / image) may still be refreshed when present.
 */
export function canResyncInventoryOrderCostQty(order: {
  remainingQuantity: number;
  initialQuantity: number;
  soldQuantity: number;
  totalSales: number;
}): boolean {
  return (
    order.remainingQuantity === order.initialQuantity &&
    order.soldQuantity === 0 &&
    order.totalSales === 0
  );
}

async function createInventoryOrderFromBundle(
  tx: Prisma.TransactionClient,
  input: {
    bundleId: string;
    purchaseCost: number;
    purchasedAt: Date;
    note?: string | null;
    members: BundleMemberForInventory[];
  },
) {
  const initialQuantity = quantityFromBundleMembers(input.members);
  const first = input.members[0];
  const id = randomUUID();
  // PostgreSQL handles the race in one INSERT ... ON CONFLICT DO NOTHING.
  // Catching P2002 from create() is not safe here: it aborts the caller's
  // transaction, including the purchase bundle/audit dual-write.
  const inserted = await tx.inventoryOrder.createMany({
    skipDuplicates: true,
    data: {
      id,
      orderNumber: orderNumberFromId(input.bundleId),
      name: nameFromBundleMembers(input.members),
      platform: first?.platform ?? null,
      purchaseCost: input.purchaseCost,
      initialQuantity,
      remainingQuantity: initialQuantity,
      soldQuantity: 0,
      totalSales: 0,
      status: resolveInventoryOrderStatus(initialQuantity, initialQuantity),
      purchasedAt: input.purchasedAt,
      imageUrl: first?.imageUrl ?? null,
      note: input.note?.trim() || null,
      sourceBundleId: input.bundleId,
    },
  });
  const order = await tx.inventoryOrder.findUniqueOrThrow({
    where: { sourceBundleId: input.bundleId },
  });
  return { order, created: inserted.count === 1 };
}

/** Idempotent dual-write: one purchase bundle → one inventory order batch. */
export async function ensureInventoryOrderFromBundle(
  tx: Prisma.TransactionClient,
  input: {
    bundleId: string;
    purchaseCost: number;
    purchasedAt: Date;
    note?: string | null;
    members: BundleMemberForInventory[];
  },
) {
  const existing = await tx.inventoryOrder.findUnique({
    where: { sourceBundleId: input.bundleId },
  });
  if (existing) return existing;
  return (await createInventoryOrderFromBundle(tx, input)).order;
}

/**
 * After purchase-bundle PATCH: ensure a linked inventory order exists, then
 * resync cost/qty only when safe (see canResyncInventoryOrderCostQty).
 *
 * Returns `{ syncedCostQty: true }` when purchaseCost/initialQuantity/
 * remainingQuantity were updated; otherwise the order was created or left
 * untouched for sold/adjusted batches.
 */
export async function syncInventoryOrderFromBundle(
  tx: Prisma.TransactionClient,
  input: {
    bundleId: string;
    purchaseCost: number;
    purchasedAt: Date;
    note?: string | null;
    members: BundleMemberForInventory[];
  },
): Promise<{
  order: { id: string };
  syncedCostQty: boolean;
  created: boolean;
}> {
  let before = await tx.inventoryOrder.findUnique({
    where: { sourceBundleId: input.bundleId },
  });
  if (!before) {
    const ensured = await createInventoryOrderFromBundle(tx, input);
    if (ensured.created)
      return { order: ensured.order, syncedCostQty: true, created: true };
    // A concurrent caller may have created (or already sold) this batch.
    // Reuse its current row and apply the same guard as every other sync.
    before = ensured.order;
  }

  const first = input.members[0];
  const initialQuantity = quantityFromBundleMembers(input.members);
  const titleName = nameFromBundleMembers(input.members);
  const meta = {
    // Prefer listing title; never promote purchase note into name.
    ...(titleName == null ? {} : { name: titleName }),
    ...(first?.platform == null ? {} : { platform: first.platform }),
    purchasedAt: input.purchasedAt,
    ...(first?.imageUrl == null ? {} : { imageUrl: first.imageUrl }),
    ...(input.note === undefined ? {} : { note: input.note?.trim() || null }),
  };

  if (!canResyncInventoryOrderCostQty(before)) {
    const order = await tx.inventoryOrder.update({
      where: { id: before.id },
      data: meta,
    });
    return { order, syncedCostQty: false, created: false };
  }

  const updated = await tx.inventoryOrder.updateMany({
    // The pristine check must hold when PostgreSQL obtains the row lock, not
    // only when findUnique ran. Also reject another cost/quantity resync.
    where: {
      id: before.id,
      purchaseCost: before.purchaseCost,
      initialQuantity: before.initialQuantity,
      remainingQuantity: before.initialQuantity,
      soldQuantity: 0,
      totalSales: 0,
    },
    data: {
      ...meta,
      purchaseCost: input.purchaseCost,
      initialQuantity,
      remainingQuantity: initialQuantity,
      status: resolveInventoryOrderStatus(initialQuantity, initialQuantity),
    },
  });
  const order =
    updated.count === 1
      ? await tx.inventoryOrder.findUniqueOrThrow({ where: { id: before.id } })
      : await tx.inventoryOrder.update({
          where: { id: before.id },
          data: meta,
        });
  return { order, syncedCostQty: updated.count === 1, created: false };
}
