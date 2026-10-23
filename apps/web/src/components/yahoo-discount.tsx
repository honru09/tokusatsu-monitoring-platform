import { yahooFleamarketDiscount } from "../lib/procurement-calculator";

export function YahooDiscount({
  sourceKey,
  priceYen,
  exchangeRate,
}: {
  sourceKey: string;
  priceYen: number;
  exchangeRate?: number;
}) {
  const discount = yahooFleamarketDiscount(sourceKey, priceYen);
  if (!discount) return null;
  return (
    <span
      className="yahoo-discount"
      title="以当前商品标价降20%测算，日元向上取整；不含额外邮费，不代表卖家已同意降价。"
    >
      <span>
        最低降价20%<small>测算</small>
      </span>
      <strong>¥{discount.targetYen.toLocaleString("zh-CN")}</strong>
      {exchangeRate && exchangeRate > 0 ? (
        <small>
          约人民币{" "}
          {(discount.targetYen * exchangeRate).toLocaleString("zh-CN", {
            maximumFractionDigits: 2,
            minimumFractionDigits: 2,
          })}
          元
        </small>
      ) : null}
    </span>
  );
}
