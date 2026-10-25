import React from "react";
import {
  DEFAULT_FEE_PERCENT,
  DEFAULT_SHIPPING_PER_UNIT_CNY,
  estimateItemCost,
} from "../lib/procurement-calculator";
import { listingCostSummary } from "../lib/listing-cost";

export type CostEstimatePanelProps = {
  /** Item price in yen for the whole batch (one listing). */
  priceYen: number;
  /** Known Japan-side shipping for the listing, in yen. */
  shippingYen?: number | null;
  /** Units in the batch; defaults to 1 when missing. */
  quantity?: number;
  /** CNY per 1 JPY (dashboard exchange rate). Enables the CNY landed cost. */
  exchangeRate?: number | null;
  /** Expected domestic resale price for the whole batch, in CNY. */
  domesticCny?: number | null;
  /** Listing type, forwarded to the yen total label (auction vs direct). */
  listingType?: string;
};

const yen = (value: number) => `¥${Math.round(value).toLocaleString("ja-JP")}`;
const cny = (value: number) =>
  value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * Compact read-only costing for the places where a decision happens
 * (detail drawer today, the unified purchase form next). All math goes
 * through estimateItemCost / listingCostSummary with the shared default
 * assumptions from lib/procurement-calculator, so the figures match the
 * standalone 算账 tool. Renders nothing when the price is unknown.
 */
export function CostEstimatePanel({
  priceYen,
  shippingYen,
  quantity,
  exchangeRate,
  domesticCny,
  listingType = "direct",
}: CostEstimatePanelProps) {
  const estimate = estimateItemCost({
    priceYen,
    shippingYen,
    quantity,
    exchangeRate,
    domesticCny,
  });
  if (!estimate) return null;
  const summary = listingCostSummary({
    priceCurrent: priceYen,
    shippingFee: shippingYen,
    quantityEst: estimate.quantity,
    listingType,
  });
  return (
    <section
      className="cost-estimate-panel"
      aria-label="算账估算"
      data-testid="cost-estimate-panel"
    >
      <dl>
        <div>
          <dt>{summary.label}（日元）</dt>
          <dd data-testid="cost-estimate-total-yen">{yen(estimate.totalYen)}</dd>
        </div>
        {estimate.landedCny != null && (
          <div>
            <dt>到手成本</dt>
            <dd data-testid="cost-estimate-landed-cny">
              {cny(estimate.landedCny)} 元
            </dd>
          </div>
        )}
        {estimate.quantity > 1 && estimate.perUnitCny != null && (
          <div>
            <dt>单件成本</dt>
            <dd>{cny(estimate.perUnitCny)} 元</dd>
          </div>
        )}
        <div>
          <dt>预计利润</dt>
          <dd data-testid="cost-estimate-profit">
            {estimate.profitCny != null
              ? `${cny(estimate.profitCny)} 元`
              : "待填售价"}
          </dd>
        </div>
      </dl>
      <p>
        按算账默认口径测算：采购费 {DEFAULT_FEE_PERCENT}%、单件运税{" "}
        {DEFAULT_SHIPPING_PER_UNIT_CNY} 元。
      </p>
    </section>
  );
}
