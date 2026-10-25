/**
 * Parcel packing for the Japan Post small-packet flow: one parcel's
 * declared total must stay at or under the cap (¥2,000 by default -
 * above it the parcel is treated as commercial goods). Each stock
 * unit's declared value defaults to its order's unit purchase price,
 * so the packed total is both the weight and the value: the goal is
 * the largest achievable total not exceeding the cap.
 *
 * Tie-breaks: stock is consumed oldest first (FIFO clearing), and a
 * composition found through earlier orders wins over one found later,
 * which also keeps quantities consolidated into fewer orders.
 */

export type PackingStock = {
  orderId: string;
  /** Declared value of one unit, in yen (integer >= 0). */
  unitDeclaredYen: number;
  /** Units available to pack. */
  available: number;
  /** Purchase timestamp (ISO) for FIFO ordering; null sorts last. */
  purchasedAt: string | null;
  /** Creation timestamp (ISO), FIFO tiebreak after purchasedAt. */
  createdAt: string;
};

export type PackedLine = {
  orderId: string;
  quantity: number;
  unitDeclaredYen: number;
};

function fifoOrder(stock: PackingStock[]): PackingStock[] {
  return [...stock].sort((a, b) => {
    const aTime = a.purchasedAt ?? a.createdAt;
    const bTime = b.purchasedAt ?? b.createdAt;
    if (aTime !== bTime) return aTime < bTime ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0;
  });
}

/**
 * Bounded knapsack via binary splitting. Returns the lines of the
 * best parcel (possibly empty). Units priced at 0 or priced above the
 * cap can never join a parcel and are excluded here; the caller
 * surfaces the over-cap ones separately.
 */
export function packParcel(stock: PackingStock[], capYen: number): PackedLine[] {
  const cap = Math.max(0, Math.floor(capYen));
  if (cap === 0) return [];
  const usable = fifoOrder(stock).filter(
    (entry) =>
      entry.available > 0 &&
      entry.unitDeclaredYen > 0 &&
      entry.unitDeclaredYen <= cap,
  );
  if (!usable.length) return [];

  // reach[amount] = index of the chunk that first reached this amount;
  // first-reach wins, which biases compositions toward older orders.
  const reach = new Int32Array(cap + 1).fill(-1);
  const prev = new Int32Array(cap + 1).fill(-1);
  reach[0] = -2;
  type Chunk = { orderIndex: number; quantity: number; weight: number };
  const chunks: Chunk[] = [];
  usable.forEach((entry, orderIndex) => {
    let remaining = entry.available;
    let size = 1;
    while (remaining > 0) {
      const quantity = Math.min(size, remaining);
      chunks.push({
        orderIndex,
        quantity,
        weight: quantity * entry.unitDeclaredYen,
      });
      remaining -= quantity;
      size *= 2;
    }
  });
  chunks.forEach((chunk, chunkIndex) => {
    for (let amount = cap - chunk.weight; amount >= 0; amount -= 1) {
      if (reach[amount] === -1) continue;
      const next = amount + chunk.weight;
      if (reach[next] !== -1) continue;
      reach[next] = chunkIndex;
      prev[next] = amount;
    }
  });

  let best = cap;
  while (best > 0 && reach[best] === -1) best -= 1;
  if (best === 0) return [];

  const quantityByOrder = new Map<number, number>();
  for (let amount = best; amount > 0; ) {
    const chunk = chunks[reach[amount]!];
    if (!chunk) break;
    quantityByOrder.set(
      chunk.orderIndex,
      (quantityByOrder.get(chunk.orderIndex) ?? 0) + chunk.quantity,
    );
    amount = prev[amount]!;
  }
  return [...quantityByOrder.entries()]
    .sort(([a], [b]) => a - b)
    .map(([orderIndex, quantity]) => ({
      orderId: usable[orderIndex]!.orderId,
      quantity,
      unitDeclaredYen: usable[orderIndex]!.unitDeclaredYen,
    }));
}

/** Total declared yen of a set of packed lines. */
export function packedTotal(lines: readonly PackedLine[]): number {
  return lines.reduce(
    (sum, line) => sum + line.quantity * line.unitDeclaredYen,
    0,
  );
}
