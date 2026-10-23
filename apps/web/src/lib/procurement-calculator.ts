export const MAX_AMOUNT = 1_000_000_000;
export const cents = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

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
