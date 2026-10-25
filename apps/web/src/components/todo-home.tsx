"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { LoadError } from "./load-error";
import { WorkspaceHeaderArt } from "./workspace-header-art";
import { FinancePanel } from "./finance-panel";
import { EmptyState } from "./empty-state";
import { ImageGlyph, SafeItemImage } from "./item-image";
import { TERMS } from "../lib/terms";
import {
  SHIPPING_TARGET_MAX_CNY,
  SHIPPING_TARGET_MIN_CNY,
} from "../lib/shipping-constants";
import { fmtYen, relativeTime } from "../lib/listing-display";
import { readFetchError } from "../lib/fetch-error";
import type { Workspace } from "../lib/workspace-navigation";
import {
  buildNegotiatingQueue,
  buildPackableReminder,
  buildRegisterQueue,
  buildReviewQueue,
  buildSystemQueue,
  todoPendingCount,
  type AiResourcesLike,
  type InventoryOrderLike,
  type NegotiationLike,
  type PurchaseAnalysisLike,
  type ShareMessageLike,
  type ShareRoundLike,
  type TodoItemRef,
} from "../lib/todo-queues";
import styles from "./todo-home.module.css";

const ROW_LIMIT = 8;

export const BRAND_HOME_SRC = "/illustrations/brand-home.webp";

/**
 * Shelf scene across the header zone, above the finance panel. The
 * panel itself stays illustration-free - its three figures are the
 * heroes there - so the scene gets its own fixed-ratio band instead.
 * Hidden entirely if the asset fails to load.
 */
function BrandHomeArt() {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div className={styles.brandArt} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={BRAND_HOME_SRC}
        alt=""
        width={1280}
        height={480}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </div>
  );
}

type TodoHomeProps = {
  apiBaseUrl: string;
  accountId: string;
  purchasedItemIds: ReadonlySet<string>;
  dislikedItemIds: ReadonlySet<string>;
  purchaseAnalyses: readonly PurchaseAnalysisLike[];
  failedJobs24h: number;
  onNavigate: (workspace: Workspace) => void;
  /** Opens the unified purchase registration form for a register-queue row. */
  onRegisterItem?: (item: TodoItemRef) => void;
  /** 组包 is the shipping tab of the merged 采购 workspace. */
  onOpenShipping?: () => void;
  /** Live JPY→CNY rate; without it the packable reminder cannot judge. */
  exchangeRate?: number;
  onPendingCountChange: (count: number) => void;
};

export function TodoHome({
  apiBaseUrl,
  accountId,
  purchasedItemIds,
  dislikedItemIds,
  purchaseAnalyses,
  failedJobs24h,
  onNavigate,
  onRegisterItem,
  onOpenShipping,
  exchangeRate,
  onPendingCountChange,
}: TodoHomeProps) {
  const [rounds, setRounds] = useState<ShareRoundLike[]>([]);
  const [messages, setMessages] = useState<ShareMessageLike[]>([]);
  const [negotiations, setNegotiations] = useState<NegotiationLike[]>([]);
  const [orders, setOrders] = useState<InventoryOrderLike[]>([]);
  const [resources, setResources] = useState<AiResourcesLike | null>(null);
  const [loading, setLoading] = useState(true);
  const [collaborationError, setCollaborationError] = useState("");
  const [ordersError, setOrdersError] = useState("");

  const loadCollaboration = useCallback(
    async (signal?: AbortSignal) => {
      const account = encodeURIComponent(accountId);
      const [roundsResponse, messagesResponse, negotiationsResponse] =
        await Promise.all([
          fetch(`${apiBaseUrl}/collaboration/share-rounds?accountId=${account}`, {
            cache: "no-store",
            signal,
          }),
          fetch(`${apiBaseUrl}/collaboration/messages?accountId=${account}`, {
            cache: "no-store",
            signal,
          }),
          fetch(`${apiBaseUrl}/collaboration/negotiations?accountId=${account}`, {
            cache: "no-store",
            signal,
          }),
        ]);
      if (!roundsResponse.ok)
        throw new Error(await readFetchError(roundsResponse, "分享同步失败"));
      if (!messagesResponse.ok)
        throw new Error(await readFetchError(messagesResponse, "消息同步失败"));
      if (!negotiationsResponse.ok)
        throw new Error(
          await readFetchError(negotiationsResponse, "砍价进度同步失败"),
        );
      const roundsPayload = (await roundsResponse.json()) as {
        rounds?: ShareRoundLike[];
      };
      const messagesPayload = (await messagesResponse.json()) as {
        messages?: ShareMessageLike[];
      };
      const negotiationsPayload = (await negotiationsResponse.json()) as {
        cases?: NegotiationLike[];
      };
      setRounds(roundsPayload.rounds ?? []);
      setMessages(messagesPayload.messages ?? []);
      setNegotiations(negotiationsPayload.cases ?? []);
    },
    [accountId, apiBaseUrl],
  );

  const loadOrders = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        `${apiBaseUrl}/inventory-orders?page=1&limit=100`,
        { cache: "no-store", signal },
      );
      if (!response.ok)
        throw new Error(await readFetchError(response, "库存同步失败"));
      const payload = (await response.json()) as {
        orders?: InventoryOrderLike[];
      };
      setOrders(payload.orders ?? []);
    },
    [apiBaseUrl],
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      const [collaboration, inventory] = await Promise.allSettled([
        loadCollaboration(signal),
        loadOrders(signal),
      ]);
      if (signal?.aborted) return;
      setCollaborationError(
        collaboration.status === "rejected"
          ? collaboration.reason instanceof Error
            ? collaboration.reason.message
            : "协作数据同步失败"
          : "",
      );
      setOrdersError(
        inventory.status === "rejected"
          ? inventory.reason instanceof Error
            ? inventory.reason.message
            : "库存同步失败"
          : "",
      );
      // The AI resource snapshot only feeds the system queue; a failure
      // there hides the AI notices instead of blocking the home.
      try {
        const response = await fetch(`${apiBaseUrl}/ai/resources`, {
          cache: "no-store",
          signal,
        });
        if (response.ok) setResources((await response.json()) as AiResourcesLike);
      } catch {
        /* system notices degrade silently */
      }
      if (!signal?.aborted) setLoading(false);
    },
    [loadCollaboration, loadOrders],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const queues = useMemo(
    () => ({
      review: buildReviewQueue(
        rounds,
        messages,
        accountId,
        purchasedItemIds,
        dislikedItemIds,
      ),
      negotiating: buildNegotiatingQueue(negotiations, rounds, messages),
      register: buildRegisterQueue(negotiations, purchaseAnalyses, purchasedItemIds),
      packable: buildPackableReminder(orders, exchangeRate),
      system: buildSystemQueue({ resources, failedJobs24h }),
    }),
    [
      rounds,
      messages,
      negotiations,
      orders,
      exchangeRate,
      resources,
      accountId,
      purchasedItemIds,
      dislikedItemIds,
      purchaseAnalyses,
      failedJobs24h,
    ],
  );
  const total = todoPendingCount(queues);

  useEffect(() => {
    onPendingCountChange(total);
  }, [onPendingCountChange, total]);

  const hasError = Boolean(collaborationError || ordersError);
  const allClear = !loading && !hasError && total === 0;

  const statusStatement = useMemo(() => {
    if (hasError) {
      return "协作或库存同步异常，请点击重试。";
    }
    if (loading && total === 0) {
      return "正在整理待处理事项…";
    }
    if (total === 0) {
      return `${TERMS.allClear}，当前没有积压待办。`;
    }
    const latestRound = rounds[0];
    const partnerName = latestRound?.createdBy?.name || "搭档";
    const roundCount = latestRound?.items?.length ?? 0;
    if (roundCount > 0) {
      return `${partnerName}最新分享了 ${roundCount} 件新候选，当前共 ${total} 件待处理。`;
    }
    if (queues.review.length > 0) {
      return `当前共 ${total} 件待处理，其中 ${queues.review.length} 件来自最新分享。`;
    }
    return `当前共 ${total} 件待处理，各项决策队列运转正常。`;
  }, [hasError, loading, total, rounds, queues.review.length]);

  return (
    <section className={styles.home} aria-labelledby="todo-title">
      <header className={styles.header}>
        <div className={styles.heroVisual}>
          <div className={styles.heroTopRow}>
            <div className={styles.heroTagGroup}>
              <WorkspaceHeaderArt art="todo" />
              <div className={styles.heroBadge}>
                <span className={styles.heroBadgeDot} />
                <span>{TERMS.todo}</span>
                <span className={styles.heroPendingChip}>
                  {loading
                    ? "同步中…"
                    : hasError
                      ? "同步异常"
                      : total > 0
                        ? `${total} 件待处理`
                        : "今天没有积压"}
                </span>
              </div>
            </div>
            <button
              type="button"
              className={styles.refresh}
              disabled={loading}
              onClick={() => void load()}
            >
              {loading ? "刷新中…" : "刷新"}
            </button>
          </div>

          <h2 id="todo-title" className={styles.heroStatement}>
            {statusStatement}
          </h2>

          <BrandHomeArt />
        </div>
      </header>

      <FinancePanel apiBaseUrl={apiBaseUrl} refreshKey={purchasedItemIds} />

      {loading && total === 0 && (
        <div className="skeleton-rows" aria-hidden="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="skeleton-row">
              <span className="skeleton-block skeleton-thumb" />
              <span className="skeleton-lines">
                <span className="skeleton-block skeleton-line" />
                <span className="skeleton-block skeleton-line short" />
              </span>
            </div>
          ))}
        </div>
      )}

      {allClear && (
        <div className={styles.allClear}>
          <EmptyState
            art="check"
            title={`${TERMS.allClear}，队列都是空的。`}
            compact
          />
        </div>
      )}

      {collaborationError && (
        <LoadError
          message={collaborationError}
          onRetry={() => void load()}
          retryTestId="retry-todo-collaboration"
        />
      )}

      {queues.review.length > 0 && (
        <QueueSection
          title={TERMS.queueReview}
          count={queues.review.length}
          moreLabel={`去${TERMS.messages}处理`}
          onMore={() => onNavigate("collaboration")}
        >
          {queues.review.slice(0, ROW_LIMIT).map((entry) => (
            <ItemRow
              key={entry.key}
              item={entry.item}
              meta={`${entry.sharedByName ? `${entry.sharedByName} 分享 · ` : ""}${relativeTime(entry.sharedAt)}`}
              onOpen={() => onNavigate("collaboration")}
            />
          ))}
        </QueueSection>
      )}

      {queues.negotiating.length > 0 && (
        <QueueSection
          title={TERMS.queueNegotiating}
          count={queues.negotiating.length}
          moreLabel={`去${TERMS.messages}处理`}
          onMore={() => onNavigate("collaboration")}
        >
          {queues.negotiating.slice(0, ROW_LIMIT).map((entry) => (
            <ItemRow
              key={entry.key}
              item={entry.item}
              tag={entry.key.startsWith("decision") ? "已定砍价" : "砍价中"}
              meta={`已等待 ${relativeTime(entry.statusChangedAt)}`}
              onOpen={() => onNavigate("collaboration")}
            />
          ))}
        </QueueSection>
      )}

      {queues.register.length > 0 && (
        <QueueSection
          title={TERMS.queueRegister}
          count={queues.register.length}
          moreLabel={`去${TERMS.purchases}登记`}
          onMore={() => onNavigate("purchases")}
        >
          {queues.register.slice(0, ROW_LIMIT).map((entry) => (
            <ItemRow
              key={entry.key}
              item={entry.item}
              actionLabel={TERMS.registerPurchase}
              meta={
                entry.origin === "negotiation"
                  ? `砍价成功${entry.at ? ` · ${relativeTime(entry.at)}` : ""}`
                  : `链接分析完成${entry.at ? ` · ${relativeTime(entry.at)}` : ""}`
              }
              onOpen={() =>
                onRegisterItem
                  ? onRegisterItem(entry.item)
                  : onNavigate("purchases")
              }
            />
          ))}
        </QueueSection>
      )}

      {ordersError && (
        <LoadError
          message={ordersError}
          onRetry={() => void load()}
          retryTestId="retry-todo-inventory"
        />
      )}

      {queues.packable.length > 0 && (
        <QueueSection
          title={TERMS.queuePackable}
          count={queues.packable[0].orderCount}
          moreLabel="去组包"
          onMore={() => (onOpenShipping ?? (() => onNavigate("purchases")))()}
        >
          {queues.packable.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={styles.row}
              onClick={() =>
                (onOpenShipping ?? (() => onNavigate("purchases")))()
              }
            >
              <span className={styles.rowBody}>
                <span className={styles.rowTitle}>库存够组一包了</span>
                <span className={styles.rowMeta}>
                  共 {entry.totalQuantity} 件 · 申报估算{" "}
                  {fmtYen(entry.totalDeclaredYen)} ≈{" "}
                  {entry.totalDeclaredCny.toLocaleString("zh-CN")} 元 · 目标{" "}
                  {SHIPPING_TARGET_MIN_CNY.toLocaleString("zh-CN")}–
                  {SHIPPING_TARGET_MAX_CNY.toLocaleString("zh-CN")} 元/包
                </span>
              </span>
            </button>
          ))}
        </QueueSection>
      )}

      {queues.system.length > 0 && (
        <QueueSection title={TERMS.queueSystem} count={queues.system.length}>
          {queues.system.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={styles.row}
              onClick={() => onNavigate(entry.target)}
            >
              <span className={styles.rowBody}>
                <span className={styles.rowTitle}>{entry.title}</span>
                <span className={styles.rowMeta}>{entry.detail}</span>
              </span>
            </button>
          ))}
        </QueueSection>
      )}
    </section>
  );
}

function QueueSection({
  title,
  count,
  moreLabel,
  onMore,
  children,
}: {
  title: string;
  count: number;
  moreLabel?: string;
  onMore?: () => void;
  children: ReactNode;
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3>
          {title} <span className={styles.count}>{count}</span>
        </h3>
        {moreLabel && onMore && count > ROW_LIMIT && (
          <button type="button" className={styles.more} onClick={onMore}>
            {moreLabel} →
          </button>
        )}
      </div>
      <div className={styles.rows}>{children}</div>
    </div>
  );
}

function RowThumb({
  imageUrl,
  title,
}: {
  imageUrl: string | null;
  title: string;
}) {
  if (!imageUrl)
    return (
      <span className={styles.thumbEmpty} aria-hidden="true">
        <ImageGlyph className="h-4 w-4" />
      </span>
    );
  return (
    <span className={`${styles.thumb} block overflow-hidden`}>
      <SafeItemImage
        src={imageUrl}
        alt={title}
        className="h-full w-full object-cover"
      />
    </span>
  );
}

function ItemRow({
  item,
  meta,
  tag,
  actionLabel,
  onOpen,
}: {
  item: TodoItemRef;
  meta: string;
  tag?: string;
  actionLabel?: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" className={styles.row} onClick={onOpen}>
      <RowThumb imageUrl={item.imageUrl} title={item.title} />
      <span className={styles.rowBody}>
        <span className={styles.rowTitle}>{item.title}</span>
        <span className={styles.rowMeta}>
          {tag ? <span className={styles.rowTag}>{tag}</span> : null}
          {item.sourceName ? `${item.sourceName} · ` : ""}
          {meta}
        </span>
      </span>
      {actionLabel ? (
        <span className={styles.rowAside}>
          <span className={styles.rowPrice}>{fmtYen(item.priceYen)}</span>
          <span className={styles.rowAction}>{actionLabel}</span>
        </span>
      ) : (
        <span className={styles.rowPrice}>{fmtYen(item.priceYen)}</span>
      )}
    </button>
  );
}
