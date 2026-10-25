/**
 * Parcel packing for the Japan Post small-packet flow to China: one
 * parcel's declared total must stay at or under the China customs
 * personal-postal cap of 2,000 CNY, with 1,800-1,900 CNY as the target
 * band. Stock values stay in JPY (unit purchase prices); the live
 * JPY/CNY rate converts the CNY cap and band into JPY bounds for the
 * packer, which keeps working in integer yen.
 *
 * Rounding: CNY figures are never overstated. The JPY cap is the CNY
 * cap divided by the rate and floored, so a parcel packed to the JPY
 * cap still converts to at most the CNY cap. Displayed/stored CNY
 * totals are floored the same way (line-level equivalents floor to
 * one decimal). The band's JPY lower bound is ceiled instead: it is
 * only a display edge, and ceiling keeps it at the first yen total
 * whose CNY value actually reaches the band.
 *
 * Tie-breaks: stock is consumed oldest first (FIFO clearing), and a
 * composition found through earlier orders wins over one found later,
 * which also keeps quantities consolidated into fewer orders.
 */

/** CNY per 1 JPY, as returned by GET /exchange-rate. */
export type FxRate = number;

const validRate = (rate: FxRate) => Number.isFinite(rate) && rate > 0;

/**
 * JPY cap for a CNY cap at the given rate, floored so the converted
 * CNY total can never exceed the cap. Returns 0 for an invalid rate.
 */
export function capJpyFromCny(capCny: number, rate: FxRate): number {
  if (!validRate(rate) || !Number.isFinite(capCny) || capCny <= 0) return 0;
  return Math.floor(capCny / rate);
}

/** JPY bounds of the CNY target band (lower edge ceiled, see header). */
export function bandJpyFromCny(
  bandMinCny: number,
  bandMaxCny: number,
  rate: FxRate,
): { minJpy: number; maxJpy: number } {
  if (!validRate(rate)) return { minJpy: 0, maxJpy: 0 };
  return {
    minJpy: Math.ceil(bandMinCny / rate),
    maxJpy: Math.floor(bandMaxCny / rate),
  };
}

/** CNY equivalent of a JPY amount, floored to an integer. */
export function toCny(jpy: number, rate: FxRate): number {
  if (!validRate(rate)) return 0;
  return Math.floor(jpy * rate);
}

/** CNY equivalent of a JPY amount, floored to one decimal place. */
export function toCny1dp(jpy: number, rate: FxRate): number {
  if (!validRate(rate)) return 0;
  return Math.floor(jpy * rate * 10) / 10;
}

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
 * best parcel (possibly empty). capYen is the JPY cap derived from
 * the CNY cap (see capJpyFromCny), so the over-cap comparison here -
 * unitDeclaredYen > capYen - is exactly the CNY rule "one unit's CNY
 * value alone exceeds the cap". Units priced at 0 or priced above
 * the cap can never join a parcel and are excluded here; the caller
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
