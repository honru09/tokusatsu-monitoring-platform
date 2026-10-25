"use client";

import React from "react";

import { ImageGallery } from "../image-gallery";
import {
  relativeTime,
  useLiveAuctionTimeline,
} from "../../lib/listing-display";
import { marketplaceSourceName as sourceName } from "../../lib/source-label";
import type { ProductCardItem } from "./product-card-item";
import { CommentIcon } from "./product-card-icons";

export function ProductCardMedia({
  item,
  displayTitle,
  serverOffset,
  nowTick,
  onOpen,
  onOpenNote,
}: {
  item: ProductCardItem;
  displayTitle: string;
  serverOffset: number;
  nowTick: number;
  onOpen: () => void;
  onOpenNote: () => void;
}) {
  const auction = useLiveAuctionTimeline(item, serverOffset, nowTick);
  return (
    <div className="product-card-media relative block aspect-[3/2] w-full overflow-hidden bg-ink text-left">
      <ImageGallery
        images={item.images}
        alt={displayTitle ?? item.titleRaw}
        className="h-full w-full"
        imageClassName="opacity-95"
        quietControls
        onSurfaceClick={onOpen}
      />
      <div className="product-card-media-meta absolute inset-x-0 top-0 z-30 flex items-start justify-between p-2.5">
        <span className="max-w-[70%] truncate rounded-md bg-ink/55 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
          {sourceName(item.source.key, item.source.displayName, item.sourceUrl)}
        </span>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onOpenNote();
          }}
          aria-label={item.note ? `编辑采购备注：${item.note}` : "添加采购备注"}
          title={item.note ? "编辑采购备注" : "添加采购备注"}
          className={`product-card-note-trigger relative grid h-11 w-11 shrink-0 place-items-center text-white ${item.note ? "is-active" : ""}`}
        >
          <span>
            <CommentIcon className="h-4 w-4" />
          </span>
        </button>
      </div>
      <div className="product-card-media-footer absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-ink/85 to-transparent p-2.5 pb-3 pt-10 text-white">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-[11px] font-semibold">
            发现 {relativeTime(item.detectedAt)}
          </span>
          {item.quantityEst != null && item.quantityEst > 1 ? (
            <span
              className="product-card-qty-chip shrink-0 rounded-md bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
              aria-label={`数量 ${item.quantityEst} 件`}
            >
              ×{item.quantityEst}
            </span>
          ) : null}
        </span>
        {auction?.remaining ? (
          <span
            className={`product-card-auction-countdown shrink-0 rounded-md px-2 py-1 tabular-nums ${auction.remainingMs < 10 * 60_000 ? "is-critical" : auction.remainingMs < 60 * 60_000 ? "is-urgent" : ""}`}
          >
            <small>拍卖</small>
            <strong>{auction.remaining}</strong>
          </span>
        ) : null}
      </div>
      {auction?.remaining && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1 bg-white/25"
          aria-label={`拍卖进度 ${Math.round(auction.progress * 100)}%`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(auction.progress * 100)}
        >
          <span
            className={`block h-full origin-left transition-transform duration-1000 ease-linear motion-reduce:transition-none ${auction.remainingMs < 10 * 60_000 ? "bg-rust" : auction.remainingMs < 60 * 60_000 ? "bg-amber-400" : "bg-white"}`}
            style={{ transform: `scaleX(${auction.progress})` }}
          />
        </div>
      )}
    </div>
  );
}
