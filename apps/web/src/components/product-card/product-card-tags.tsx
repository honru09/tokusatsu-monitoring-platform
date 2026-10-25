import React from "react";
import { isUnverifiableListing } from "../../lib/item-availability";
import { listingLabels as labels } from "../../lib/listing-display";
import type { ProductCardItem } from "./product-card-item";

/**
 * Identity chips row: the IP tag comes first, then line/series/type,
 * condition and maker (at most two), plus the review marker when the
 * classification still needs a human look.
 */
export function ProductCardTags({ item }: { item: ProductCardItem }) {
  const productTags = Array.from(
    new Set(
      [
        item.categoryIp && item.categoryIp !== "unknown"
          ? labels[item.categoryIp]
          : null,
        item.listingType === "unknown" ? "交易方式待识别" : null,
        item.shfLine ? labels[item.shfLine] : null,
        item.product?.series?.nameZh,
        item.product?.toyTypeEntity?.nameZh ?? labels[item.categoryToyType],
        labels[item.conditionGrade],
        item.product?.manufacturerEntity?.nameZh ?? labels[item.manufacturer],
      ].filter((tag): tag is string => Boolean(tag && tag !== "待识别")),
    ),
  ).slice(0, 2);
  return (
    <div className="product-card-tags mb-2 flex min-h-6 flex-wrap gap-1">
      {productTags.map((tag, index) => (
        <span
          key={`${tag}-${index}`}
          className={`rounded px-1.5 py-1 text-[10px] font-bold ${tag === labels.junk || tag === labels.stained_or_damaged ? "bg-rust/10 text-rust" : "bg-fog/70 text-moss"}`}
        >
          {tag}
        </span>
      ))}
      {item.needsReview && (
        <span className="rounded bg-amber-100 px-1.5 py-1 text-[10px] font-bold text-amber-800">
          待复核
        </span>
      )}
      {isUnverifiableListing(item) && (
        <span className="rounded bg-zinc-200 px-1.5 py-1 text-[10px] font-bold text-zinc-600">
          暂无法核验
        </span>
      )}
      {item.ignoredReason === "negotiation_failed" && (
        <span className="rounded bg-red-50 px-1.5 py-1 text-[10px] font-bold text-red-600">
          砍价失败
        </span>
      )}
    </div>
  );
}
