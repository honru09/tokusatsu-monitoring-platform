"use client";

import React, { useEffect, useRef, useState } from "react";
import { NoteDialog } from "../note-dialog";
import { itemDisplayTitle } from "../../lib/listing-display";
import type { ProductCardProps } from "./product-card-item";
import { useProductCardDensity } from "./product-card-density";
import { ProductCardMedia } from "./product-card-media";
import { ProductCardTags } from "./product-card-tags";
import { ProductCardPrice } from "./product-card-price";
import {
  ProductCardActions,
  type ProductCardActionFeedback,
} from "./product-card-actions";
import { CommentIcon } from "./product-card-icons";
import styles from "./product-card.module.css";

export type { ProductCardDensity, ProductCardItem, ProductCardPatch, ProductCardProps } from "./product-card-item";

/**
 * Card shell: owns the per-card state (note dialog, more menu, pending
 * action feedback, title language) and composes the media, tags, price
 * and actions blocks. Standard density renders exactly the classes the
 * inline card used; compact only adds the compact class hook.
 */
export function ProductCard({
  item,
  serverOffset,
  nowTick,
  language,
  translatedTitle,
  onOpen,
  onPatch,
  onIgnore,
  onDelete,
  onPurchase,
  exchangeRate,
  inCart,
  onCart,
  onShare,
  onSendToManager,
  inBundleShare = false,
  onToggleBundleShare,
  density: densityProp,
}: ProductCardProps) {
  const contextDensity = useProductCardDensity();
  const density = densityProp ?? contextDensity;
  const compact = density === "compact";
  const [showOriginal, setShowOriginal] = useState(language === "original");
  useEffect(() => setShowOriginal(language === "original"), [language]);
  const [noteOpen, setNoteOpen] = useState(false);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const pointerInputRef = useRef(false);
  const actionInFlightRef = useRef(false);
  const [pendingAction, setPendingAction] = useState<"favorite" | "cart" | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ProductCardActionFeedback>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => () => { if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current); }, []);
  async function runAction(kind:"favorite"|"cart", action:()=>void|Promise<void|boolean>, success:string) {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setPendingAction(kind);
    setActionFeedback({text:"正在保存…",error:false});
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    try {
      const result = await action();
      setActionFeedback({text:result === false ? "保存失败，已恢复原状态" : success,error:result === false});
    } catch (reason) { setActionFeedback({text:reason instanceof Error ? reason.message : "保存失败，已恢复原状态",error:true}); }
    finally { actionInFlightRef.current = false; setPendingAction(null); feedbackTimerRef.current = setTimeout(()=>setActionFeedback(null),2400); }
  }
  const displayTitle = itemDisplayTitle(
    item,
    showOriginal ? "original" : language,
    translatedTitle,
  );
  return (
    <article
      data-item-id={item.id}
      data-density={compact ? "compact" : undefined}
      onPointerDownCapture={() => { pointerInputRef.current = true; }}
      onKeyDownCapture={(event) => { pointerInputRef.current = false; if(event.key === "Escape" && moreActionsOpen) { event.stopPropagation(); setMoreActionsOpen(false); moreTriggerRef.current?.focus(); } }}
      className={`ios-card product-card js-product-card motion-layer group flex min-w-0 flex-col overflow-hidden rounded-[18px] shadow-panel ${item.note ? "product-card-has-note" : ""}${compact ? ` product-card-compact ${styles.compact}` : ""}`}
    >
      <ProductCardMedia
        item={item}
        displayTitle={displayTitle}
        serverOffset={serverOffset}
        nowTick={nowTick}
        onOpen={onOpen}
        onOpenNote={() => setNoteOpen(true)}
      />

      <div className="product-card-body flex flex-1 flex-col p-3">
        <ProductCardTags item={item} />
        <button
          onClick={onOpen}
          className="product-card-title line-clamp-2 min-h-11 w-full text-left text-sm font-black leading-[1.35rem] text-ink transition-colors hover:text-moss"
        >
          {displayTitle}
        </button>
        <ProductCardPrice item={item} exchangeRate={exchangeRate} />
        {onToggleBundleShare && (
          <div className="product-card-seller mt-2 flex items-center justify-end gap-1.5 text-[10px] text-ink/50">
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleBundleShare();
                }}
                aria-pressed={inBundleShare}
                aria-label={
                  inBundleShare ? "移出集合分享篮" : "加入集合分享篮"
                }
                title={
                  inBundleShare
                    ? "已加入集合分享篮，点击移出"
                    : "加入集合分享篮（与同店商品一起发给搭档砍价）"
                }
                className={`inline-flex h-5 items-center rounded-md px-1.5 text-[10px] font-semibold transition active:scale-[0.96] ${
                  inBundleShare
                    ? "bg-ink text-white"
                    : "bg-black/[0.05] text-ink/65 hover:bg-black/[0.09] hover:text-ink"
                }`}
              >
                {inBundleShare ? "✓ 已凑" : "+ 凑单"}
              </button>
            </div>
          </div>
        )}
        {item.note && (
          <div className="product-card-note mt-1">
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              aria-label={`查看或编辑采购备注：${item.note}`}
              title={item.note}
              className="product-card-note-desktop flex w-full min-w-0 items-center gap-1.5 rounded-lg bg-fog/55 px-2 text-left text-[11px] text-ink/65"
            >
              <CommentIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.note}</span>
            </button>
            <div
              className="product-card-note-mobile hidden min-w-0 items-center gap-1 rounded-md bg-fog/55 px-1.5 text-[10px] font-medium leading-5 text-ink/65"
              title={item.note}
            >
              <CommentIcon className="h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.note}</span>
            </div>
          </div>
        )}
        <ProductCardActions
          item={item}
          inCart={inCart}
          pendingAction={pendingAction}
          actionFeedback={actionFeedback}
          moreActionsOpen={moreActionsOpen}
          moreTriggerRef={moreTriggerRef}
          pointerInputRef={pointerInputRef}
          onFavoriteAction={() => void runAction("favorite",()=>onPatch({ favorite: !item.favorite }),item.favorite ? "已取消收藏" : "已收藏")}
          onCartAction={() => void runAction("cart",onCart,inCart ? "已移出采购清单" : "已加入采购清单")}
          onToggleMore={() => setMoreActionsOpen((current) => !current)}
          onCloseMore={() => setMoreActionsOpen(false)}
          onIgnore={onIgnore}
          onDelete={onDelete}
          onPurchase={onPurchase}
          onShare={onShare}
          onSendToManager={onSendToManager}
        />
      </div>
      <NoteDialog
        open={noteOpen}
        value={item.note}
        onClose={() => setNoteOpen(false)}
        onSave={async (note) => {
          if (note !== (item.note ?? null) && await onPatch({ note }) === false) throw new Error("备注保存失败，请重试");
        }}
      />
    </article>
  );
}
