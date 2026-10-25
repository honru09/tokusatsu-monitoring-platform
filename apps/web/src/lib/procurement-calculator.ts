export const MAX_AMOUNT = 1_000_000_000;
export const cents = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Default assumptions for a quick quote. The standalone calculator
 * pre-fills its draft from these values and the embedded estimate
 * panel uses the same ones, so a number seen in the detail drawer
 * matches what the full 算账 tool produces for the same item.
 * Shipping is 25 CNY per unit (4 items per kilo at 100 CNY/kilo).
 */
export const DEFAULT_FEE_PERCENT = 15;
export const DEFAULT_SHIPPING_PER_UNIT_CNY = 25;
export const DEFAULT_TARGET_PROFIT_PER_UNIT_CNY = 30;

export const DEFAULT_QUOTE_ASSUMPTIONS = {
  feePercent: DEFAULT_FEE_PERCENT,
  shippingPerUnit: DEFAULT_SHIPPING_PER_UNIT_CNY,
  targetProfitPerUnit: DEFAULT_TARGET_PROFIT_PER_UNIT_CNY,
} as const;

export function inputNumber(
  value: string,
  min = 0,
  max = MAX_AMOUNT,
  integer = false,
): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) &&
    number >= min &&
    number <= max &&
    (!integer || Number.isInteger(number))
    ? number
    : null;
}

export type QuoteInput = {
  quantity: number;
  exchangePer100: number;
  marketYen: number;
  feePercent: number;
  shippingPerUnit: number;
};

export function calculateQuote(input: QuoteInput) {
  const { quantity, exchangePer100, marketYen, feePercent, shippingPerUnit } =
    input;
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 1_000_000 ||
    !Number.isFinite(exchangePer100) ||
    exchangePer100 <= 0 ||
    exchangePer100 > 1_000_000 ||
    ![marketYen, shippingPerUnit, feePercent].every(Number.isFinite) ||
    marketYen < 0 ||
    marketYen > MAX_AMOUNT ||
    shippingPerUnit < 0 ||
    shippingPerUnit > MAX_AMOUNT ||
    feePercent < 0 ||
    feePercent > 100
  )
    return null;
  const marketCny = cents((marketYen * exchangePer100) / 100);
  const shipping = cents(quantity * shippingPerUnit);
  const fee = cents((marketCny * feePercent) / 100);
  const landed = cents(marketCny + shipping);
  const receivable = cents(landed + fee);
  return {
    marketCny,
    shipping,
    fee,
    landed,
    receivable,
    perUnit: cents(receivable / quantity),
  };
}

export function procurementCeiling(
  input: Omit<QuoteInput, "marketYen"> & {
    domesticCny: number;
    unitProfit: number;
  },
) {
  if (
    !calculateQuote({ ...input, marketYen: 0 }) ||
    ![input.domesticCny, input.unitProfit].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= MAX_AMOUNT,
    )
  )
    return null;
  const available = cents(
    input.domesticCny - input.quantity * input.unitProfit,
  );
  const base = calculateQuote({ ...input, marketYen: 0 })!;
  if (available < base.receivable)
    return { possible: false as const, yen: 0, cny: 0 };
  // Use the same cent rounding as the quotation. The maximum is inclusive.
  let low = 0;
  let high = Math.min(
    MAX_AMOUNT,
    Math.ceil(available / (input.exchangePer100 / 100)) + 2,
  );
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (
      calculateQuote({ ...input, marketYen: middle })!.receivable <= available
    )
      low = middle;
    else high = middle - 1;
  }
  return {
    possible: true as const,
    yen: low,
    cny: cents((low * input.exchangePer100) / 100),
  };
}

export function internalEarnings(
  quote: NonNullable<ReturnType<typeof calculateQuote>>,
  exchangePer100: number,
  actualPurchaseYen: number,
  actualShippingCny: number,
) {
  if (
    !Number.isFinite(exchangePer100) ||
    exchangePer100 <= 0 ||
    ![actualPurchaseYen, actualShippingCny].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= MAX_AMOUNT,
    )
  )
    return null;
  const purchaseCny = cents((actualPurchaseYen * exchangePer100) / 100);
  const shippingDifference = cents(quote.shipping - cents(actualShippingCny));
  const purchaseDifference = cents(quote.marketCny - purchaseCny);
  const cost = cents(purchaseCny + cents(actualShippingCny));
  return {
    purchaseCny,
    shippingDifference,
    purchaseDifference,
    cost,
    profit: cents(quote.receivable - cost),
  };
}

export function customerQuoteText(
  input: QuoteInput,
  quote: NonNullable<ReturnType<typeof calculateQuote>>,
  domesticCny: number | null,
) {
  const money = (n: number) =>
    n.toLocaleString("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return [
    "假面采购 · 客户报价",
    `数量：${input.quantity} 件`,
    `商品报价：${money(input.marketYen)} 日元（人民币 ${money(quote.marketCny)} 元）`,
    `采购费（${input.feePercent}%）：${money(quote.fee)} 元`,
    `运输及税费：${money(quote.shipping)} 元`,
    `应付合计：${money(quote.receivable)} 元`,
    `单件成本：${money(quote.perUnit)} 元`,
    `换算汇率：100 日元 = ${input.exchangePer100.toLocaleString("zh-CN", { maximumFractionDigits: 10 })} 元`,
    ...(domesticCny === null
      ? []
      : [
          `预计国内整批售价：${money(domesticCny)} 元`,
          `预计转售利润：${money(cents(domesticCny - quote.receivable))} 元`,
        ]),
    "按填写的售价与费用测算，实际转售收益以成交和最终费用为准。",
  ].join("\n");
}

export type ItemCostEstimateInput = {
  /** Item price in yen for the whole batch (one listing). */
  priceYen: number;
  /** Known domestic (Japan-side) shipping for the listing, in yen. */
  shippingYen?: number | null;
  /** Units in the batch; defaults to 1 when missing or invalid. */
  quantity?: number | null;
  /** CNY per 1 JPY (same shape as the dashboard exchange rate). */
  exchangeRate?: number | null;
  /** Expected domestic resale price for the whole batch, in CNY. */
  domesticCny?: number | null;
  feePercent?: number;
  shippingPerUnit?: number;
};

/**
 * One-item estimate shared by the embedded panel and the 算账 tool.
 * The yen total is price + known Japan-side shipping. The CNY landed
 * cost reuses calculateQuote with the default assumptions unless the
 * caller overrides them, so the fee and international shipping口径
 * never drift between surfaces. Profit is only reported when the
 * caller supplies an expected domestic resale price.
 */
export function estimateItemCost(input: ItemCostEstimateInput) {
  if (!Number.isFinite(input.priceYen) || input.priceYen <= 0) return null;
  const quantity =
    input.quantity != null &&
    Number.isInteger(input.quantity) &&
    input.quantity > 0
      ? input.quantity
      : 1;
  const shippingKnown =
    input.shippingYen != null &&
    Number.isFinite(input.shippingYen) &&
    input.shippingYen >= 0;
  const totalYen = input.priceYen + (shippingKnown ? input.shippingYen! : 0);
  const exchangePer100 =
    input.exchangeRate != null &&
    Number.isFinite(input.exchangeRate) &&
    input.exchangeRate > 0
      ? input.exchangeRate * 100
      : null;
  const quote =
    exchangePer100 !== null
      ? calculateQuote({
          quantity,
          exchangePer100,
          marketYen: totalYen,
          feePercent: input.feePercent ?? DEFAULT_FEE_PERCENT,
          shippingPerUnit:
            input.shippingPerUnit ?? DEFAULT_SHIPPING_PER_UNIT_CNY,
        })
      : null;
  const profitCny =
    quote && input.domesticCny != null && Number.isFinite(input.domesticCny)
      ? cents(input.domesticCny - quote.receivable)
      : null;
  return {
    quantity,
    shippingKnown,
    totalYen,
    unitYen: Math.round(totalYen / quantity),
    quote,
    landedCny: quote?.receivable ?? null,
    perUnitCny: quote?.perUnit ?? null,
    profitCny,
  };
}

export function yahooFleamarketDiscount(sourceKey: string, priceYen: number) {
  if (
    sourceKey !== "yahoo_fleamarket" ||
    !Number.isFinite(priceYen) ||
    priceYen <= 0
  )
    return null;
  const targetYen = Math.ceil((priceYen * 80) / 100);
  return { targetYen, reductionYen: priceYen - targetYen };
}
