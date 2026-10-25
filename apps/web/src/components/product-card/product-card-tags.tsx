import React from "react";
import { isUnverifiableListing } from "../../lib/item-availability";
import { listingLabels as labels } from "../../lib/listing-display";
import type { ProductCardItem } from "./product-card-item";

/**
 * Identity chips row: the IP tag comes first, then line/series/type,
 * condition and maker (at most two), plus the review marker when the
 * classification still needs a human look. The bundle-share toggle
 * also lives here as a chip, so the bottom action row stays icon-only.
 * The row is one fixed-height line: it never wraps, and chips that do
 * not fit clip instead of pushing the card taller.
 */
export function ProductCardTags({
  item,
  inBundleShare = false,
  onToggleBundleShare,
}: {
  item: ProductCardItem;
  inBundleShare?: boolean;
  onToggleBundleShare?: () => void;
}) {
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
    <div className="product-card-tags mb-2 flex h-[var(--product-card-tags-height,24px)] flex-nowrap gap-1 overflow-hidden">
      {productTags.map((tag, index) => (
        <span
          key={`${tag}-${index}`}
          className={`min-w-0 truncate rounded px-1.5 py-1 text-[10px] font-bold ${tag === labels.junk || tag === labels.stained_or_damaged ? "bg-rust/10 text-rust" : "bg-fog/70 text-moss"}`}
        >
          {tag}
        </span>
      ))}
      {item.needsReview && (
        <span className="min-w-0 truncate rounded bg-amber-100 px-1.5 py-1 text-[10px] font-bold text-amber-800">
          待复核
        </span>
      )}
      {isUnverifiableListing(item) && (
        <span className="min-w-0 truncate rounded bg-zinc-200 px-1.5 py-1 text-[10px] font-bold text-zinc-600">
          暂无法核验
        </span>
      )}
      {item.ignoredReason === "negotiation_failed" && (
        <span className="min-w-0 truncate rounded bg-red-50 px-1.5 py-1 text-[10px] font-bold text-red-600">
          砍价失败
        </span>
      )}
      {onToggleBundleShare && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleBundleShare();
          }}
          aria-pressed={inBundleShare}
          aria-label={inBundleShare ? "移出集合分享篮" : "加入集合分享篮"}
          title={
            inBundleShare
              ? "已加入集合分享篮，点击移出"
              : "加入集合分享篮（与同店商品一起发给搭档砍价）"
          }
          className={`ml-auto inline-flex shrink-0 items-center rounded px-1.5 py-1 text-[10px] font-bold transition active:scale-[0.96] ${
            inBundleShare
              ? "bg-ink text-white"
              : "bg-black/[0.05] text-ink/65 hover:bg-black/[0.09] hover:text-ink"
          }`}
        >
          {inBundleShare ? "✓ 已凑" : "+ 凑单"}
        </button>
      )}
    </div>
  );
}
