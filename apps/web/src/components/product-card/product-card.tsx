"use client";

import React, { useEffect, useRef, useState } from "react";
import { NoteDialog } from "../note-dialog";
import { isUnverifiableListing } from "../../lib/item-availability";
import { itemDisplayTitle } from "../../lib/listing-display";
import type { ProductCardProps } from "./product-card-item";
import { ProductCardMedia } from "./product-card-media";
import { ProductCardTags } from "./product-card-tags";
import { ProductCardPrice } from "./product-card-price";
import {
  ProductCardActions,
  type ProductCardActionFeedback,
} from "./product-card-actions";

export type { ProductCardItem, ProductCardPatch, ProductCardProps } from "./product-card-item";

/**
 * Card shell: owns the per-card state (note dialog, more menu, pending
 * action feedback, title language) and composes the media, tags, price
 * and actions blocks, rendering exactly the classes the inline card used.
 * The body is a fixed stack of slots (tags, two-line title, price, meta,
 * actions); the note text is not one of them - the media comment trigger
 * carries its active state and opens the dialog, and the full text
 * lives in the detail view.
 *
 * This is the ONE card for market items: catalog grid, the folded
 * favorites / link-import / disliked views, search results and the
 * urgent-auction zone all render it, so no surface invents its own price
 * or title presentation. The only sanctioned non-card rendering is the
 * compact checkbox row inside SellerProfileDialog (multi-select for
 * bundle sending) and the read-only public share snapshot; both are
 * selection/snapshot surfaces, not browsing cards.
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
}: ProductCardProps) {
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
      onPointerDownCapture={() => { pointerInputRef.current = true; }}
      onKeyDownCapture={(event) => { pointerInputRef.current = false; if(event.key === "Escape" && moreActionsOpen) { event.stopPropagation(); setMoreActionsOpen(false); moreTriggerRef.current?.focus(); } }}
      className={`ios-card product-card js-product-card motion-layer group flex min-w-0 flex-col overflow-hidden rounded-[18px] shadow-panel ${item.note ? "product-card-has-note" : ""} ${isUnverifiableListing(item) ? "product-card-unverifiable" : ""}`}
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
        <ProductCardTags
          item={item}
          inBundleShare={inBundleShare}
          onToggleBundleShare={onToggleBundleShare}
        />
        <button
          onClick={onOpen}
          className="product-card-title line-clamp-2 h-[var(--product-card-title-height,44px)] min-h-11 w-full break-words text-left text-sm font-black leading-[1.35rem] text-ink transition-colors hover:text-moss"
        >
          {displayTitle}
        </button>
        <ProductCardPrice item={item} exchangeRate={exchangeRate} />
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
