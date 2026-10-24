"use client";

import React, { type RefObject } from "react";
import { motion, useReducedMotion } from "motion/react";
import { motionTokens, springs } from "../../lib/motion-tokens";
import transactionStyles from "../transaction-feedback.module.css";
import type { ProductCardItem } from "./product-card-item";
import {
  ArchiveIcon,
  CartIcon,
  HeartIcon,
  MessageIcon,
  MoneyIcon,
  MoreIcon,
  ShareIcon,
  TrashIcon,
} from "./product-card-icons";

export type ProductCardActionFeedback = {
  text: string;
  error: boolean;
} | null;

/**
 * Operations row: favorite / cart / more, the expanded more-menu and the
 * transient save feedback. Pending state and the runAction guard live in
 * the card shell; this row only renders and forwards clicks.
 */
export function ProductCardActions({
  item,
  inCart,
  pendingAction,
  actionFeedback,
  moreActionsOpen,
  moreTriggerRef,
  pointerInputRef,
  onFavoriteAction,
  onCartAction,
  onToggleMore,
  onCloseMore,
  onIgnore,
  onDelete,
  onPurchase,
  onShare,
  onSendToManager,
}: {
  item: ProductCardItem;
  inCart: boolean;
  pendingAction: "favorite" | "cart" | null;
  actionFeedback: ProductCardActionFeedback;
  moreActionsOpen: boolean;
  moreTriggerRef: RefObject<HTMLButtonElement | null>;
  pointerInputRef: { current: boolean };
  onFavoriteAction: () => void;
  onCartAction: () => void;
  onToggleMore: () => void;
  onCloseMore: () => void;
  onIgnore: () => void;
  onDelete: () => void;
  onPurchase: () => void;
  onShare: () => void;
  onSendToManager: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <>
      <div className="product-card-actions relative mt-auto grid grid-cols-3 gap-1.5 pt-1">
        <button
          onClick={onFavoriteAction}
          disabled={pendingAction !== null}
          data-pending={pendingAction === "favorite" || undefined}
          data-pointer-motion={pointerInputRef.current}
          aria-pressed={item.favorite}
          aria-label={item.favorite ? "取消收藏" : "收藏商品"}
          title={item.favorite ? "取消收藏" : "收藏"}
          className={`${transactionStyles.stateAction} grid min-h-11 place-items-center rounded-lg border transition-colors ${item.favorite ? "border-lime bg-lime text-ink" : "border-ink/10 bg-white hover:border-moss/35"}`}
        >
          <motion.span data-apple-motion-owned tabIndex={-1} className={transactionStyles.actionIcon} initial={false} animate={{ transform:item.favorite && pointerInputRef.current && !reduceMotion ? "scale(1.12)" : "scale(1)" }} transition={reduceMotion || !pointerInputRef.current ? {duration:0} : springs.applePress}><HeartIcon filled={item.favorite} /></motion.span>
        </button>
        <button
          onClick={onCartAction}
          disabled={pendingAction !== null}
          data-pending={pendingAction === "cart" || undefined}
          data-pointer-motion={pointerInputRef.current}
          aria-pressed={inCart}
          aria-label={inCart ? "移出购物车" : "加入购物车"}
          title={inCart ? "移出购物车" : "加入购物车"}
          className={`${transactionStyles.stateAction} grid min-h-11 place-items-center rounded-lg border transition-colors ${inCart ? "border-blue-300 bg-blue-50 text-moss" : "border-ink/10 bg-white text-ink hover:border-moss/35"}`}
        >
          <motion.span data-apple-motion-owned tabIndex={-1} className={transactionStyles.actionIcon} initial={false} animate={{transform:inCart && pointerInputRef.current && !reduceMotion ? "translateY(-2px) scale(1.08)" : "translateY(0px) scale(1)"}} transition={reduceMotion || !pointerInputRef.current ? {duration:0} : springs.applePress}><CartIcon /></motion.span>
        </button>
        <button
          type="button"
          ref={moreTriggerRef}
          onClick={onToggleMore}
          aria-label={moreActionsOpen ? "收起更多操作" : "更多商品操作"}
          aria-expanded={moreActionsOpen}
          title="更多"
          className={`grid min-h-11 place-items-center rounded-lg border transition-colors ${moreActionsOpen ? "border-ink bg-ink text-white" : "border-ink/10 bg-white text-ink hover:border-moss/35"}`}
        >
          <MoreIcon />
        </button>
      </div>
      {moreActionsOpen && (
        <motion.div data-apple-motion-owned className={`product-card-more-actions ${transactionStyles.moreMenu} absolute bottom-[68px] right-3 z-30 grid w-[248px] grid-cols-5 gap-1.5 rounded-2xl border border-ink/10 bg-white/95 p-2 shadow-modal`} initial={reduceMotion || !pointerInputRef.current ? false : {opacity:0,transform:"translateY(10px) scale(.94)"}} animate={{opacity:1,transform:"translateY(0px) scale(1)"}} transition={reduceMotion || !pointerInputRef.current ? {duration:0} : springs.appleSpatial}>
          <button
            onClick={() => {
              onCloseMore();
              onIgnore();
            }}
            aria-label="标记为不感兴趣"
            title="不感兴趣"
            className="grid min-h-11 place-items-center rounded-lg border border-ink/10 bg-white text-ink transition-colors hover:border-rust/40 hover:text-rust"
          >
            <ArchiveIcon />
          </button>
          <button
            onClick={() => {
              onCloseMore();
              onDelete();
            }}
            aria-label="删除商品"
            title="删除"
            className="grid min-h-11 place-items-center rounded-lg border border-ink/10 bg-white text-ink transition-colors hover:border-rust/40 hover:text-rust"
          >
            <TrashIcon />
          </button>
          <button
            onClick={() => {
              onCloseMore();
              onPurchase();
            }}
            aria-label="记录购买"
            title="记录购买"
            className="grid min-h-11 place-items-center rounded-lg border border-rust/25 bg-rust/5 text-rust transition-colors hover:bg-rust/10"
          >
            <MoneyIcon />
          </button>
          <button
            onClick={() => {
              onCloseMore();
              onShare();
            }}
            aria-label="分享商品"
            title="分享"
            className="grid min-h-11 place-items-center rounded-lg border border-ink/10 bg-white text-ink transition-colors hover:border-moss/35"
          >
            <ShareIcon />
          </button>
          <button
            onClick={() => {
              onCloseMore();
              onSendToManager();
            }}
            aria-label="发送给另一位管理者"
            title="发送给管理者"
            className="grid min-h-11 place-items-center rounded-lg border border-blue-200 bg-blue-50 text-[color:var(--color-accent)] transition-colors hover:bg-blue-100"
          >
            <MessageIcon />
          </button>
        </motion.div>
      )}
      {actionFeedback && <motion.span role="status" aria-live="polite" className={transactionStyles.status} data-error={actionFeedback.error} initial={reduceMotion || !pointerInputRef.current ? false : {opacity:0,transform:"translateY(6px)"}} animate={{opacity:1,transform:"translateY(0px)"}} transition={{duration:reduceMotion || !pointerInputRef.current ? 0 : motionTokens.duration.fast}}>{actionFeedback.text}</motion.span>}
    </>
  );
}
