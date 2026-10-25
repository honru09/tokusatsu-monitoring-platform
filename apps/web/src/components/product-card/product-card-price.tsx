import React from "react";
import { fmtYen } from "../../lib/listing-display";
import { listingCostSummary } from "../../lib/listing-cost";
import { yahooFleamarketDiscount } from "../../lib/yahoo-discount";
import type { ProductCardItem } from "./product-card-item";

/** Whole-yuan CNY estimate: no decimals, no mid-number wrap. */
function fmtCnyWhole(yen: number, rate: number) {
  return `约 ${Math.round(yen * rate).toLocaleString("zh-CN")}元`;
}

/**
 * Price block: two fixed rows and nothing else. The price row is the
 * total label plus the hero amount; the meta row underneath prefers
 * the Yahoo flea-market target (target yen plus its CNY estimate) and
 * otherwise shows the total's CNY estimate. Without an exchange rate
 * the meta row stays empty but keeps its slot height, so the block is
 * the same shape on every card. Quantity, unit price, the
 * list/shipping split and the China/value evidence are detail-view
 * facts, not card facts.
 */
export function ProductCardPrice({
  item,
  exchangeRate,
}: {
  item: ProductCardItem;
  exchangeRate?: number;
}) {
  const cost = listingCostSummary(item);
  const discount = yahooFleamarketDiscount(item.source.key, item.priceCurrent);
  const hasRate =
    exchangeRate != null && Number.isFinite(exchangeRate) && exchangeRate > 0;
  const meta = !hasRate
    ? ""
    : discount
      ? `目标 ${fmtYen(discount.targetYen)} · ${fmtCnyWhole(discount.targetYen, exchangeRate)}`
      : cost.total != null
        ? fmtCnyWhole(cost.total, exchangeRate)
        : "";
  return (
    <div className="product-card-market product-card-decision mt-2">
      <dl>
        <div className="product-card-total product-card-price-slot flex h-[var(--product-card-price-height,32px)] flex-nowrap items-baseline gap-2 overflow-hidden">
          <dt className="shrink-0">{cost.label}</dt>
          <dd className="shrink-0 tabular-nums">{fmtYen(cost.total)}</dd>
        </div>
      </dl>
      <p className="product-card-meta h-[var(--product-card-meta-height,20px)] overflow-hidden whitespace-nowrap text-[11px] tabular-nums text-ink/55">
        {meta}
      </p>
    </div>
  );
}
