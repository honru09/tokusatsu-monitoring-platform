type PurchaseWithBundle = {
  bundleId?: string | null;
  bundle?: { id?: string | null } | null;
};

/** A record is legacy/standalone only when the server says it has no bundle. */
export function standalonePurchaseRecords<T extends PurchaseWithBundle>(
  purchases: readonly T[],
): T[] {
  return purchases.filter(
    (purchase) => !purchase.bundleId && !purchase.bundle?.id,
  );
}

/** The active-bundle aggregate returned by the API is the accounting source of truth. */
export function authoritativePurchaseTotal(
  grandTotalPurchaseAmountYen: number | null | undefined,
): number {
  return Number.isFinite(grandTotalPurchaseAmountYen)
    ? Math.max(0, grandTotalPurchaseAmountYen ?? 0)
    : 0;
}

/** Append a page while preserving API order and replacing any overlapping row. */
export function mergePurchaseBundlePage<T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const incomingById = new Map(incoming.map((row) => [row.id, row]));
  const result = current.map((row) => incomingById.get(row.id) ?? row);
  const known = new Set(current.map((row) => row.id));
  for (const row of incoming) {
    if (!known.has(row.id)) result.push(row);
  }
  return result;
}
