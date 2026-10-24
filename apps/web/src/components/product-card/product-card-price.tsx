import React from "react";
import { YahooDiscount } from "../yahoo-discount";
import { chinaComparisonSummary } from "../../lib/china-comparison";
import {
  fmtCny,
  fmtCnyAmount,
  fmtYen,
  shippingLabel,
} from "../../lib/listing-display";
import { listingCostSummary } from "../../lib/listing-cost";
import type { ProductCardItem } from "./product-card-item";

/**
 * Price block. Every amount stays on the card in both densities (total,
 * its CNY estimate, quantity, unit price, the list-price/shipping split
 * and the Yahoo discount estimate); compact mode only tightens the chrome
 * around them.
 */
export function ProductCardPrice({
  item,
  exchangeRate,
}: {
  item: ProductCardItem;
  exchangeRate?: number;
}) {
  const cost = listingCostSummary(item);
  const knownShipping =
    item.shippingFee != null &&
    Number.isFinite(item.shippingFee) &&
    item.shippingFee >= 0;
  const chinaComparison = chinaComparisonSummary(item);
  const chinaPrice = fmtCnyAmount(chinaComparison.priceCny);
  const chinaSourceUrl = chinaComparison.sourceUrl;
  return (
    <div className="product-card-market product-card-decision mt-2">
      <dl data-qty-unknown={cost.unit == null || undefined}>
        <div className="product-card-total">
          <dt>{cost.label}</dt>
          <dd>{fmtYen(cost.total)}</dd>
          <small>{fmtCny(cost.total, exchangeRate)}</small>
        </div>
        <div className="product-card-qty">
          <dt>数量</dt>
          <dd>{item.quantityEst ? `${item.quantityEst} 件` : "待识别"}</dd>
        </div>
        <div className="product-card-unit">
          <dt>{cost.unitLabel}</dt>
          <dd>{fmtYen(cost.unit)}</dd>
        </div>
      </dl>
      <div className="product-card-price-split text-[11px] tabular-nums text-ink/55">
        标价 {fmtYen(item.priceCurrent)}
        {knownShipping
          ? item.shippingFee === 0
            ? " · 包邮"
            : ` + 邮费 ${fmtYen(item.shippingFee)}`
          : ` · 邮费${shippingLabel(item)}`}
        {knownShipping && item.shippingFee ? (
          <small className="ml-1">
            {fmtCny(item.shippingFee, exchangeRate)}
          </small>
        ) : null}
      </div>
      <YahooDiscount
        sourceKey={item.source.key}
        priceYen={item.priceCurrent}
        exchangeRate={exchangeRate}
      />
      {(item.valueKing || (chinaPrice && chinaSourceUrl)) && (
        <div className="product-card-cost-evidence">
          {item.valueKing ? (
            <span
              className="product-card-value-king"
              title={item.valueKing.facts.join(" · ")}
            >
              <b aria-hidden="true">♛</b>
              {item.valueKing.label}
            </span>
          ) : chinaPrice && chinaSourceUrl ? (
            <a
              className="product-card-china-reference"
              href={chinaSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`打开${chinaComparison.platformName}原商品，中国参考价 ${chinaPrice}`}
              title={`${chinaComparison.platformName}参考价 ${chinaPrice}`}
            >
              {chinaComparison.platformName}同款 {chinaPrice}
            </a>
          ) : null}
        </div>
      )}
    </div>
  );
}
