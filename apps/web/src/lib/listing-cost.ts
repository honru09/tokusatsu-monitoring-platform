export function listingCostSummary(item: {
  priceCurrent: number;
  shippingFee?: number | null;
  quantityEst?: number | null;
  listingType: string;
}) {
  const knownShipping =
    item.shippingFee != null &&
    Number.isFinite(item.shippingFee) &&
    item.shippingFee >= 0;
  const total =
    Number.isFinite(item.priceCurrent) && item.priceCurrent >= 0
      ? item.priceCurrent + (knownShipping ? item.shippingFee! : 0)
      : null;
  const validQuantity =
    item.quantityEst != null &&
    Number.isInteger(item.quantityEst) &&
    item.quantityEst > 0;
  const auction = item.listingType === "auction";
  return {
    total,
    unit:
      validQuantity && total != null
        ? Math.round(total / item.quantityEst!)
        : null,
    label: auction
      ? knownShipping
        ? "当前合计"
        : "当前价下限"
      : knownShipping
        ? "总价"
        : "成本下限",
    unitLabel: auction
      ? knownShipping
        ? "当前单价"
        : "单价下限"
      : knownShipping
        ? "单价"
        : "单价下限",
  };
}
