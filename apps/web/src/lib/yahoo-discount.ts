/**
 * Yahoo flea-market asking-price heuristic: listings there routinely
 * close around 80% of the ask, so cards surface the expected target
 * next to the listed price. Moved out of the retired procurement
 * calculator when the 算账 tool was removed - this helper has live
 * consumers on item cards and detail surfaces.
 */
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
