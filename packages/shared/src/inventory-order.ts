/** Batch inventory + average-cost helpers for purchase orders.
 *
 * One purchase order = one inventory batch. Average cost is fixed for the
 * batch: purchaseCost / initialQuantity. Sales reduce remaining qty and
 * accumulate revenue; adjustments reduce remaining without revenue.
 */

export const inventoryOrderStatuses = [
  "in_stock",
  "partially_sold",
  "sold_out",
] as const;
export type InventoryOrderStatus = (typeof inventoryOrderStatuses)[number];

export const inventoryOrderStatusLabels: Record<InventoryOrderStatus, string> =
  {
    in_stock: "在库",
    partially_sold: "部分售出",
    sold_out: "已售完",
  };

export type InventoryOrderSnapshot = {
  purchaseCost: number;
  initialQuantity: number;
  remainingQuantity: number;
  soldQuantity: number;
  totalSales: number;
};

export type SaleApplication = {
  remainingQuantity: number;
  soldQuantity: number;
  totalSales: number;
  costOfSale: number;
  saleProfit: number;
  realizedProfit: number;
  status: InventoryOrderStatus;
};

export type AdjustmentApplication = {
  remainingQuantity: number;
  status: InventoryOrderStatus;
};

function assertSafeInt(value: number, label: string) {
  if (!Number.isSafeInteger(value))
    throw new RangeError(`${label} must be a safe integer`);
}

function assertNonNegativeInt(value: number, label: string) {
  assertSafeInt(value, label);
  if (value < 0) throw new RangeError(`${label} must be >= 0`);
}

function assertPositiveInt(value: number, label: string) {
  assertSafeInt(value, label);
  if (value <= 0) throw new RangeError(`${label} must be > 0`);
}

/** Fixed batch average cost. Returns null when quantity is invalid. */
export function averageCost(
  purchaseCost: number,
  initialQuantity: number,
): number | null {
  assertNonNegativeInt(purchaseCost, "purchaseCost");
  assertSafeInt(initialQuantity, "initialQuantity");
  if (initialQuantity <= 0) return null;
  return purchaseCost / initialQuantity;
}

/** Integer yen cost of a sale (rounded half away from zero via Math.round). */
export function costOfSale(
  purchaseCost: number,
  initialQuantity: number,
  quantity: number,
): number {
  assertPositiveInt(quantity, "quantity");
  const unit = averageCost(purchaseCost, initialQuantity);
  if (unit == null) throw new RangeError("initialQuantity must be > 0");
  return Math.round(unit * quantity);
}

export function saleProfit(salePrice: number, cost: number): number {
  assertNonNegativeInt(salePrice, "salePrice");
  assertSafeInt(cost, "cost");
  return salePrice - cost;
}

/** realized_profit = total_sales - average_cost * sold_qty */
export function realizedProfit(
  totalSales: number,
  purchaseCost: number,
  initialQuantity: number,
  soldQuantity: number,
): number {
  assertNonNegativeInt(totalSales, "totalSales");
  assertNonNegativeInt(soldQuantity, "soldQuantity");
  const unit = averageCost(purchaseCost, initialQuantity);
  if (unit == null) return totalSales;
  return Math.round(totalSales - unit * soldQuantity);
}

/** Recovery ratio total_sales / purchase_cost; null when cost is 0. */
export function recoveryRatio(
  totalSales: number,
  purchaseCost: number,
): number | null {
  assertNonNegativeInt(totalSales, "totalSales");
  assertNonNegativeInt(purchaseCost, "purchaseCost");
  if (purchaseCost === 0) return null;
  return totalSales / purchaseCost;
}

export function recoveryPercent(
  totalSales: number,
  purchaseCost: number,
): number | null {
  const ratio = recoveryRatio(totalSales, purchaseCost);
  return ratio == null ? null : ratio * 100;
}

/** Final order profit is only meaningful when sold out. */
export function finalOrderProfit(
  totalSales: number,
  purchaseCost: number,
): number {
  assertNonNegativeInt(totalSales, "totalSales");
  assertNonNegativeInt(purchaseCost, "purchaseCost");
  return totalSales - purchaseCost;
}

/** Final margin % = (total_sales - purchase_cost) / purchase_cost; null when cost is 0. */
export function finalOrderMarginPercent(
  totalSales: number,
  purchaseCost: number,
): number | null {
  assertNonNegativeInt(totalSales, "totalSales");
  assertNonNegativeInt(purchaseCost, "purchaseCost");
  if (purchaseCost === 0) return null;
  return ((totalSales - purchaseCost) / purchaseCost) * 100;
}

export function resolveInventoryOrderStatus(
  remainingQuantity: number,
  initialQuantity: number,
): InventoryOrderStatus {
  assertNonNegativeInt(remainingQuantity, "remainingQuantity");
  assertPositiveInt(initialQuantity, "initialQuantity");
  if (remainingQuantity > initialQuantity)
    throw new RangeError("remainingQuantity cannot exceed initialQuantity");
  if (remainingQuantity === initialQuantity) return "in_stock";
  if (remainingQuantity === 0) return "sold_out";
  return "partially_sold";
}

export function applySale(
  snapshot: InventoryOrderSnapshot,
  quantity: number,
  salePrice: number,
): SaleApplication {
  assertPositiveInt(quantity, "quantity");
  assertNonNegativeInt(salePrice, "salePrice");
  assertNonNegativeInt(snapshot.remainingQuantity, "remainingQuantity");
  assertPositiveInt(snapshot.initialQuantity, "initialQuantity");
  if (quantity > snapshot.remainingQuantity)
    throw new RangeError("quantity exceeds remainingQuantity");

  const remainingQuantity = snapshot.remainingQuantity - quantity;
  const soldQuantity = snapshot.soldQuantity + quantity;
  const totalSales = snapshot.totalSales + salePrice;
  const cost = costOfSale(
    snapshot.purchaseCost,
    snapshot.initialQuantity,
    quantity,
  );
  return {
    remainingQuantity,
    soldQuantity,
    totalSales,
    costOfSale: cost,
    saleProfit: saleProfit(salePrice, cost),
    realizedProfit: realizedProfit(
      totalSales,
      snapshot.purchaseCost,
      snapshot.initialQuantity,
      soldQuantity,
    ),
    status: resolveInventoryOrderStatus(
      remainingQuantity,
      snapshot.initialQuantity,
    ),
  };
}

/** Adjust inventory (damage/gift/loss). Does not touch sales or revenue. */
export function applyAdjustment(
  snapshot: Pick<
    InventoryOrderSnapshot,
    "remainingQuantity" | "initialQuantity"
  >,
  quantityDelta: number,
): AdjustmentApplication {
  assertSafeInt(quantityDelta, "quantityDelta");
  if (quantityDelta === 0)
    throw new RangeError("quantityDelta must not be zero");
  assertNonNegativeInt(snapshot.remainingQuantity, "remainingQuantity");
  assertPositiveInt(snapshot.initialQuantity, "initialQuantity");

  const remainingQuantity = snapshot.remainingQuantity + quantityDelta;
  if (remainingQuantity < 0)
    throw new RangeError("adjustment would make remainingQuantity negative");
  if (remainingQuantity > snapshot.initialQuantity)
    throw new RangeError("adjustment would exceed initialQuantity");

  return {
    remainingQuantity,
    status: resolveInventoryOrderStatus(
      remainingQuantity,
      snapshot.initialQuantity,
    ),
  };
}

/** Derive display metrics from persisted order fields. */
export function inventoryOrderMetrics(snapshot: InventoryOrderSnapshot) {
  const unit = averageCost(snapshot.purchaseCost, snapshot.initialQuantity);
  const soldOut = snapshot.remainingQuantity === 0;
  const finalProfit = soldOut
    ? finalOrderProfit(snapshot.totalSales, snapshot.purchaseCost)
    : null;
  const finalMargin = soldOut
    ? finalOrderMarginPercent(snapshot.totalSales, snapshot.purchaseCost)
    : null;
  return {
    averageCost: unit,
    realizedProfit: realizedProfit(
      snapshot.totalSales,
      snapshot.purchaseCost,
      snapshot.initialQuantity,
      snapshot.soldQuantity,
    ),
    recoveryRatio: recoveryRatio(snapshot.totalSales, snapshot.purchaseCost),
    recoveryPercent: recoveryPercent(
      snapshot.totalSales,
      snapshot.purchaseCost,
    ),
    finalOrderProfit: finalProfit,
    finalOrderMarginPercent: finalMargin,
    status: resolveInventoryOrderStatus(
      snapshot.remainingQuantity,
      snapshot.initialQuantity,
    ),
  };
}

/** Deterministic ORD-XXXXXXXX from a UUID-like or opaque id. */
export function orderNumberFromId(id: string): string {
  const hex = id.replace(/-/g, "").replace(/[^0-9a-fA-F]/g, "");
  if (hex.length >= 8) return `ORD-${hex.slice(0, 8).toUpperCase()}`;
  const alnum = id
    .replace(/[^0-9a-zA-Z]/g, "")
    .toUpperCase()
    .padEnd(8, "0")
    .slice(0, 8);
  if (!alnum)
    throw new RangeError("id must yield at least one alphanumeric character");
  return `ORD-${alnum}`;
}
