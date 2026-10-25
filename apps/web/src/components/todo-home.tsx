"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { LoadError } from "./load-error";
import { TERMS } from "../lib/terms";
import { fmtYen, relativeTime } from "../lib/listing-display";
import { readFetchError } from "../lib/fetch-error";
import type { Workspace } from "../lib/workspace-navigation";
import {
  buildInventoryQueue,
  buildNegotiatingQueue,
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

type TodoHomeProps = {
  apiBaseUrl: string;
  accountId: string;
  purchasedItemIds: ReadonlySet<string>;
  dislikedItemIds: ReadonlySet<string>;
  purchaseAnalyses: readonly PurchaseAnalysisLike[];
  failedJobs24h: number;
  onNavigate: (workspace: Workspace) => void;
  onPendingCountChange: (count: number) => void;
  /** The collapsed market overview rendered below the queues. */
  children?: ReactNode;
};

export function TodoHome({
  apiBaseUrl,
  accountId,
  purchasedItemIds,
  dislikedItemIds,
  purchaseAnalyses,
  failedJobs24h,
  onNavigate,
  onPendingCountChange,
  children,
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
      negotiating: buildNegotiatingQueue(negotiations),
      register: buildRegisterQueue(negotiations, purchaseAnalyses, purchasedItemIds),
      inventory: buildInventoryQueue(orders),
      system: buildSystemQueue({ resources, failedJobs24h }),
    }),
    [
      rounds,
      messages,
      negotiations,
      orders,
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

  return (
    <section className={styles.home} aria-labelledby="todo-title">
      <header className={styles.header}>
        <div>
          <h2 id="todo-title">{TERMS.todo}</h2>
          <p>
            {loading
              ? "正在整理待处理事项…"
              : total > 0
                ? `${total} 件待处理`
                : "今天没有积压"}
          </p>
        </div>
        <button
          type="button"
          className={styles.refresh}
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "刷新中…" : "刷新"}
        </button>
      </header>

      {allClear && <p className={styles.allClear}>{TERMS.allClear}，队列都是空的。</p>}

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
              meta={
                entry.origin === "negotiation"
                  ? `砍价成功${entry.at ? ` · ${relativeTime(entry.at)}` : ""}`
                  : `链接分析完成${entry.at ? ` · ${relativeTime(entry.at)}` : ""}`
              }
              onOpen={() => onNavigate("purchases")}
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

      {queues.inventory.length > 0 && (
        <QueueSection
          title={TERMS.queueInventory}
          count={queues.inventory.length}
          moreLabel={`去${TERMS.orders}查看`}
          onMore={() => onNavigate("orders")}
        >
          {queues.inventory.slice(0, ROW_LIMIT).map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={styles.row}
              onClick={() => onNavigate("orders")}
            >
              <RowThumb imageUrl={entry.imageUrl} title={entry.title} />
              <span className={styles.rowBody}>
                <span className={styles.rowTitle}>{entry.title}</span>
                <span className={styles.rowMeta}>{entry.detail}</span>
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

      {children}
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
  if (!imageUrl) return <span className={styles.thumbEmpty} aria-hidden="true" />;
  return (
    <img
      className={styles.thumb}
      src={imageUrl}
      alt={title}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

function ItemRow({
  item,
  meta,
  onOpen,
}: {
  item: TodoItemRef;
  meta: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" className={styles.row} onClick={onOpen}>
      <RowThumb imageUrl={item.imageUrl} title={item.title} />
      <span className={styles.rowBody}>
        <span className={styles.rowTitle}>{item.title}</span>
        <span className={styles.rowMeta}>
          {item.sourceName ? `${item.sourceName} · ` : ""}
          {meta}
        </span>
      </span>
      <span className={styles.rowPrice}>{fmtYen(item.priceYen)}</span>
    </button>
  );
}
