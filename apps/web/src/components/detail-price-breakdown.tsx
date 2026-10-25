import { listingCostSummary } from "../lib/listing-cost";
import { fmtCny, fmtYen, shippingLabel } from "../lib/listing-display";
import { yahooFleamarketDiscount } from "../lib/yahoo-discount";

export type PriceBreakdownItem = {
  priceCurrent: number;
  shippingFee?: number | null;
  quantityEst?: number | null;
  listingType: string;
  sourceData?: Record<string, unknown> | null;
  source: { key: string };
};

/**
 * Full price split for the detail view. The card keeps only the total
 * and one meta row; everything it dropped lives here, one labeled row
 * per fact, amounts right-aligned and never wrapped mid-number. An
 * unknown shipping fee is stated as unknown and the total is labelled
 * as a lower bound instead of a known total.
 */
export function DetailPriceBreakdown({
  item,
  exchangeRate,
}: {
  item: PriceBreakdownItem;
  exchangeRate?: number;
}) {
  const cost = listingCostSummary(item);
  const discount = yahooFleamarketDiscount(item.source.key, item.priceCurrent);
  const hasRate =
    exchangeRate != null && Number.isFinite(exchangeRate) && exchangeRate > 0;
  const auction = item.listingType === "auction";
  const totalQualifier = !cost.knownShipping
    ? auction
      ? "当前价下限"
      : "未含邮费"
    : auction
      ? "当前合计"
      : null;
  const unitQualifier = [
    auction ? "当前" : "",
    !cost.knownShipping ? "下限" : "",
  ]
    .join("")
    .trim();
  return (
    <section
      className="detail-breakdown"
      aria-labelledby="detail-breakdown-title"
      data-testid="detail-price-breakdown"
    >
      <h3 id="detail-breakdown-title">价格明细</h3>
      <dl>
        <div data-row="list-price">
          <dt>标价</dt>
          <dd>{fmtYen(item.priceCurrent)}</dd>
        </div>
        <div data-row="shipping">
          <dt>邮费</dt>
          <dd>
            {shippingLabel(item)}
            {cost.knownShipping && item.shippingFee ? (
              <small>{fmtCny(item.shippingFee, exchangeRate)}</small>
            ) : null}
          </dd>
        </div>
        <div data-row="quantity">
          <dt>数量</dt>
          <dd>
            {item.quantityEst != null &&
            Number.isInteger(item.quantityEst) &&
            item.quantityEst > 0
              ? `${item.quantityEst} 件`
              : "待确认"}
          </dd>
        </div>
        <div data-row="unit-price">
          <dt>
            单价
            {unitQualifier && cost.unit != null ? (
              <small>（{unitQualifier}）</small>
            ) : null}
          </dt>
          <dd>{cost.unit == null ? "待确认" : fmtYen(cost.unit)}</dd>
        </div>
        <div data-row="total">
          <dt>
            总价
            {totalQualifier ? <small>（{totalQualifier}）</small> : null}
          </dt>
          <dd>{cost.total == null ? "待确认" : fmtYen(cost.total)}</dd>
        </div>
        <div data-row="total-cny">
          <dt>
            总价约人民币
            {totalQualifier ? <small>（{totalQualifier}）</small> : null}
          </dt>
          <dd>
            {cost.total == null
              ? "待确认"
              : hasRate
                ? fmtCny(cost.total, exchangeRate)
                : "暂无汇率"}
          </dd>
        </div>
        {discount ? (
          <div data-row="discount-target">
            <dt>
              最低降价测算
              <small>（目标价）</small>
            </dt>
            <dd>
              {fmtYen(discount.targetYen)}
              {hasRate ? (
                <small>{fmtCny(discount.targetYen, exchangeRate)}</small>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
