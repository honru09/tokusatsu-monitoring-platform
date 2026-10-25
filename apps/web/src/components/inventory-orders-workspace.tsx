"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { getShellOverlayRoot } from "../lib/shell-overlay";
import { motion, useReducedMotion } from "motion/react";
import { springs } from "../lib/motion-tokens";
import styles from "./operations-editorial.module.css";
import { useDialogFocus } from "../lib/use-dialog-focus";
import { PurchaseRegistrationForm } from "./purchase-registration-form";
import { EmptyState } from "./empty-state";

export type InventoryOrderStatus = "in_stock" | "partially_sold" | "sold_out";

export type InventoryOrderCard = {
  id: string;
  orderNumber: string;
  name: string | null;
  platform: string | null;
  purchaseCost: number;
  initialQuantity: number;
  remainingQuantity: number;
  soldQuantity: number;
  totalSales: number;
  status: InventoryOrderStatus;
  statusLabel: string;
  averageCost: number | null;
  realizedProfit: number;
  recoveryPercent: number | null;
  finalOrderProfit: number | null;
  finalOrderMarginPercent?: number | null;
  purchasedAt: string | null;
  imageUrl: string | null;
  note: string | null;
};

type SalesRecord = {
  id: string;
  quantity: number;
  salePrice: number;
  costOfSale: number;
  profit: number;
  note: string | null;
  soldAt: string;
};

type Adjustment = {
  id: string;
  quantityDelta: number;
  reason: string;
  createdAt: string;
};

type InventoryOrderDetail = InventoryOrderCard & {
  salesRecords: SalesRecord[];
  adjustments: Adjustment[];
};

type Props = {
  apiBaseUrl: string;
  exchangeRate?: number | null;
};

const ADJUST_REASONS = ["破损", "赠送", "盘点", "丢失"] as const;

const yen = (value: number | null | undefined) =>
  value == null ? "—" : `¥${Math.round(value).toLocaleString("ja-JP")}`;

const yenSigned = (value: number | null | undefined) => {
  if (value == null) return "—";
  const rounded = Math.round(value);
  const body = `¥${Math.abs(rounded).toLocaleString("ja-JP")}`;
  if (rounded > 0) return `+${body}`;
  if (rounded < 0) return `-${body}`;
  return body;
};

const cny = (value: number | null | undefined, rate?: number | null) =>
  value == null || rate == null ? "" : `约 ¥${(value * rate).toFixed(2)}`;

function fmtDate(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function fmtDay(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));
}

/** Live sell preview — mirrors shared average-cost rounding. */
export function previewSaleCost(
  averageCost: number | null,
  quantity: number,
): number | null {
  if (averageCost == null || !Number.isSafeInteger(quantity) || quantity < 1)
    return null;
  return Math.round(averageCost * quantity);
}

export function previewSaleProfit(
  salePrice: number,
  cost: number | null,
): number | null {
  if (cost == null || !Number.isSafeInteger(salePrice) || salePrice < 0)
    return null;
  return salePrice - cost;
}

/** Margin % for sold-out orders; prefers API field, else derives from cost. */
export function clearanceMarginPercent(
  order: Pick<
    InventoryOrderCard,
    "status" | "purchaseCost" | "finalOrderProfit" | "finalOrderMarginPercent"
  >,
): number | null {
  if (order.status !== "sold_out") return null;
  if (order.finalOrderMarginPercent != null)
    return order.finalOrderMarginPercent;
  if (order.finalOrderProfit == null || order.purchaseCost === 0) return null;
  return (order.finalOrderProfit / order.purchaseCost) * 100;
}

const STATUS_FILTERS: Array<{
  value: "" | InventoryOrderStatus;
  label: string;
}> = [
  { value: "", label: "全部" },
  { value: "in_stock", label: "在库" },
  { value: "partially_sold", label: "部分售出" },
  { value: "sold_out", label: "已售完" },
];

function ProgressTrack({
  percent,
  label,
  tone = "moss",
}: {
  percent: number;
  label: string;
  tone?: "moss" | "ink";
}) {
  const capped = Math.max(0, Math.min(100, percent));
  const fill =
    tone === "ink"
      ? "inventory-order-track-fill-ink"
      : "inventory-order-track-fill-moss";
  return (
    <div
      className="inventory-order-track"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(capped)}
      aria-label={label}
    >
      <div className={fill} style={{ width: `${capped}%` }} />
    </div>
  );
}

function RecoveryBar({
  percent,
  recoveredYen,
}: {
  percent: number | null;
  recoveredYen: number;
}) {
  const capped = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="inventory-order-metric">
      <div className="inventory-order-metric-row">
        <span>
          已回款 <span className="io-num">{yen(recoveredYen)}</span>
        </span>
        <span className="io-num">
          {percent == null ? "—" : `${percent.toFixed(0)}%`}
        </span>
      </div>
      <ProgressTrack percent={capped} label="已回款进度" />
    </div>
  );
}

function StockBar({
  remaining,
  sold,
  initial,
}: {
  remaining: number;
  sold: number;
  initial: number;
}) {
  const percent = initial > 0 ? (sold / initial) * 100 : 0;
  return (
    <div className="inventory-order-metric">
      <div className="inventory-order-metric-row">
        <span>
          剩余{" "}
          <span className="io-num">
            {remaining}/{initial}
          </span>
        </span>
        <span className="io-num">
          已售 {sold}/{initial}
        </span>
      </div>
      <ProgressTrack percent={percent} label="已售进度" tone="ink" />
    </div>
  );
}

function parseApiError(raw: string, fallback: string) {
  try {
    const parsed = JSON.parse(raw) as { message?: string | string[] };
    if (Array.isArray(parsed.message)) return parsed.message.join("；");
    if (typeof parsed.message === "string" && parsed.message.trim())
      return parsed.message;
  } catch {
    /* plain text */
  }
  const trimmed = raw.trim();
  return trimmed || fallback;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="inventory-order-field mt-2.5 grid gap-1 first:mt-3.5">
      <span className="text-[11px] font-semibold tracking-[0.01em] text-meta">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass = "inventory-order-input w-full px-3 text-base text-ink";

function SheetGrabber() {
  return <div className="inventory-order-sheet-grabber" aria-hidden />;
}

export function InventoryOrdersWorkspace({ apiBaseUrl, exchangeRate }: Props) {
  const reducedMotion = useReducedMotion();
  const [keyboardMotion, setKeyboardMotion] = useState(false);
  const instantMotion = reducedMotion || keyboardMotion;
  const animatedItems = useRef(new Set<string>());
  const [orders, setOrders] = useState<InventoryOrderCard[]>([]);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    orders.forEach((order) => animatedItems.current.add(order.id));
  }, [orders]);
  const [page, setPage] = useState(1);
  const requestSequence = useRef(0);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const [totals, setTotals] = useState({
    purchaseCostYen: 0,
    totalSalesYen: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | InventoryOrderStatus>(
    "",
  );
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<InventoryOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sellOrder, setSellOrder] = useState<InventoryOrderCard | null>(null);
  const [adjustOrder, setAdjustOrder] = useState<InventoryOrderCard | null>(
    null,
  );
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formMessage, setFormMessage] = useState("");
  const [receipt, setReceipt] = useState("");

  const [sellQty, setSellQty] = useState("1");
  const [sellPrice, setSellPrice] = useState("");
  const [sellNote, setSellNote] = useState("");
  const [adjustDelta, setAdjustDelta] = useState("-1");
  const [adjustReason, setAdjustReason] = useState("");
  const detailDialogRef = useRef<HTMLElement>(null);
  const formDialogRef = useRef<HTMLElement>(null);
  const formOpen = Boolean(sellOrder || adjustOrder);
  useDialogFocus({
    active: Boolean(detail) && !formOpen,
    dialogRef: detailDialogRef,
    onClose: () => setDetail(null),
  });
  useDialogFocus({
    active: formOpen,
    dialogRef: formDialogRef,
    onClose: () => {
      if (!busy) closeForms();
    },
  });

  const sellPreview = useMemo(() => {
    if (!sellOrder || !sellPrice.trim()) return null;
    const quantity = Number(sellQty);
    const salePrice = Number(sellPrice);
    const cost = previewSaleCost(sellOrder.averageCost, quantity);
    const profit = previewSaleProfit(salePrice, cost);
    return { quantity, salePrice, cost, profit };
  }, [sellOrder, sellQty, sellPrice]);

  const adjustPreviewRemaining = useMemo(() => {
    if (!adjustOrder) return null;
    const delta = Number(adjustDelta);
    if (!Number.isSafeInteger(delta) || delta === 0) return null;
    return adjustOrder.remainingQuantity + delta;
  }, [adjustOrder, adjustDelta]);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
      });
      if (statusFilter) params.set("status", statusFilter);
      if (search.trim()) params.set("search", search.trim());
      const response = await fetch(`${apiBaseUrl}/inventory-orders?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`加载失败（${response.status}）`);
      const payload = (await response.json()) as {
        orders?: InventoryOrderCard[];
        total?: number;
        totals?: { purchaseCostYen?: number; totalSalesYen?: number };
      };
      if (sequence !== requestSequence.current) return;
      const lastPage = Math.max(1, Math.ceil((payload.total ?? 0) / pageSize));
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }
      setOrders(payload.orders ?? []);
      setTotal(payload.total ?? 0);
      setTotals({
        purchaseCostYen: payload.totals?.purchaseCostYen ?? 0,
        totalSalesYen: payload.totals?.totalSalesYen ?? 0,
      });
    } catch (reason) {
      if (sequence !== requestSequence.current) return;
      setError(reason instanceof Error ? reason.message : "加载库存订单失败");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [apiBaseUrl, page, search, statusFilter]);

  useEffect(() => {
    void load();
    return () => {
      requestSequence.current += 1;
    };
  }, [load]);

  async function openDetail(order: InventoryOrderCard) {
    setDetailLoading(true);
    setFormMessage("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/inventory-orders/${order.id}`,
        {
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error(`详情加载失败（${response.status}）`);
      const payload = (await response.json()) as {
        order: InventoryOrderDetail;
      };
      setDetail(payload.order);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "详情加载失败");
    } finally {
      setDetailLoading(false);
    }
  }

  function openSell(order: InventoryOrderCard) {
    setSellOrder(order);
    setSellQty("1");
    setSellPrice("");
    setSellNote("");
    setFormMessage("");
  }

  function openAdjust(order: InventoryOrderCard) {
    setAdjustOrder(order);
    setAdjustDelta("-1");
    setAdjustReason("");
    setFormMessage("");
  }

  async function submitSell() {
    if (!sellOrder) return;
    const quantity = Number(sellQty);
    const salePrice = Number(sellPrice);
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      setFormMessage("请输入有效出售数量");
      return;
    }
    if (quantity > sellOrder.remainingQuantity) {
      setFormMessage(`最多可卖 ${sellOrder.remainingQuantity} 件`);
      return;
    }
    if (!Number.isSafeInteger(salePrice) || salePrice < 0) {
      setFormMessage("请输入有效成交价");
      return;
    }
    setBusy(true);
    setFormMessage("");
    setReceipt("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/inventory-orders/${sellOrder.id}/sell`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            quantity,
            salePrice,
            note: sellNote.trim() || undefined,
          }),
        },
      );
      if (!response.ok)
        throw new Error(parseApiError(await response.text(), "出售失败"));
      setSellOrder(null);
      setReceipt(`已记录出售 ${quantity} 件 · ${sellOrder.name || "库存订单"}`);
      await load();
      if (detail?.id === sellOrder.id) await openDetail(sellOrder);
    } catch (reason) {
      setFormMessage(reason instanceof Error ? reason.message : "出售失败");
    } finally {
      setBusy(false);
    }
  }

  async function submitAdjust() {
    if (!adjustOrder) return;
    const quantityDelta = Number(adjustDelta);
    if (!Number.isSafeInteger(quantityDelta) || quantityDelta === 0) {
      setFormMessage("调整数量不能为 0");
      return;
    }
    if (
      adjustPreviewRemaining != null &&
      (adjustPreviewRemaining < 0 ||
        adjustPreviewRemaining > adjustOrder.initialQuantity)
    ) {
      setFormMessage("调整后剩余数量超出范围");
      return;
    }
    if (!adjustReason.trim()) {
      setFormMessage("请填写调整原因");
      return;
    }
    setBusy(true);
    setFormMessage("");
    setReceipt("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/inventory-orders/${adjustOrder.id}/adjust`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            quantityDelta,
            reason: adjustReason.trim(),
          }),
        },
      );
      if (!response.ok)
        throw new Error(parseApiError(await response.text(), "调整失败"));
      setAdjustOrder(null);
      setReceipt(`库存调整已保存 · ${adjustOrder.name || "库存订单"}`);
      await load();
      if (detail?.id === adjustOrder.id) await openDetail(adjustOrder);
    } catch (reason) {
      setFormMessage(reason instanceof Error ? reason.message : "调整失败");
    } finally {
      setBusy(false);
    }
  }

  function openCreate() {
    // Creating stock now goes through the one registration form in
    // blank mode: the buy is recorded as a purchase bundle first and
    // the inventory order is its dual-write, instead of an order that
    // bypasses the purchase records.
    setRegistrationOpen(true);
    setReceipt("");
  }

  function closeForms() {
    setSellOrder(null);
    setAdjustOrder(null);
    setFormMessage("");
  }

  return (
    <div
      className={`inventory-orders-workspace mt-2 grid min-w-0 ${styles.workspace} ${styles.inventory}`}
      data-keyboard-motion={keyboardMotion ? "true" : "false"}
      onPointerDownCapture={() => setKeyboardMotion(false)}
      onKeyDownCapture={() => setKeyboardMotion(true)}
    >
      <div className={`inventory-order-hero ${styles.heading}`}>
        <div className="min-w-0">
          <h2>
            库存订单 <span className={styles.titleCount}>{total} 批</span>
          </h2>
          <p className="inventory-order-hero-meta">
            采购 {yen(totals.purchaseCostYen)}
            <span className="io-meta-muted">
              {cny(totals.purchaseCostYen, exchangeRate)}
            </span>
            <span className="io-meta-muted">·</span>
            已售 {yen(totals.totalSalesYen)}
          </p>
        </div>
        <div className="inventory-order-toolbar">
          <button type="button" onClick={openCreate} className="io-btn-primary">
            新建订单
          </button>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="刷新库存订单"
            title="刷新"
            className="io-btn-icon"
          >
            ↻
          </button>
        </div>
      </div>

      {receipt && (
        <motion.p
          className={styles.actionReceipt}
          role="status"
          initial={instantMotion ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={instantMotion ? { duration: 0 } : springs.appleSelection}
          data-apple-motion-owned="true"
        >
          <span aria-hidden="true">✓</span>{receipt}
        </motion.p>
      )}

      <div className={styles.inventoryTools}>
        <div
          className="inventory-order-status-chips"
          role="tablist"
          aria-label="按状态筛选"
        >
          {STATUS_FILTERS.map((chip) => {
            const active = statusFilter === chip.value;
            return (
              <button
                key={chip.value || "all"}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setPage(1);
                  setStatusFilter(chip.value);
                }}
              >
                {active && (
                  <motion.span
                    className={styles.tabIndicator}
                    layoutId="inventory-status-indicator"
                    transition={
                      instantMotion ? { duration: 0 } : springs.appleSelection
                    }
                    aria-hidden="true"
                  />
                )}
                <span className={styles.tabLabel}>{chip.label}</span>
              </button>
            );
          })}
        </div>
        <input
          type="search"
          value={search}
          onChange={(event) => {
            setPage(1);
            setSearch(event.target.value);
          }}
          aria-label="搜索库存订单"
          placeholder="搜索订单号 / 名称 / 平台"
          className="inventory-order-search"
        />
      </div>

      {error && (
        <p role="alert" className="inventory-order-alert">
          {error}
          <button
            type="button"
            className="ml-3 text-xs font-semibold underline"
            onClick={() => void load()}
          >
            重试
          </button>
        </p>
      )}

      {loading ? (
        <p className="inventory-order-loading">正在加载库存订单…</p>
      ) : error ? null : orders.length === 0 ? (
        <div className="inventory-order-empty">
          <EmptyState
            art="box"
            title={
              statusFilter || search.trim()
                ? "没有符合条件的订单"
                : "还没有库存订单"
            }
            description={
              statusFilter || search.trim()
                ? "试试切换状态筛选，或清空搜索。"
                : "一批采购 = 一个订单。可点「新建订单」，或在上方链接分析后登记购买自动生成。"
            }
          >
            {!statusFilter && !search.trim() && (
              <button
                type="button"
                onClick={openCreate}
                className="io-btn-primary"
              >
                新建第一笔
              </button>
            )}
          </EmptyState>
        </div>
      ) : (
        <section className="inventory-order-list" aria-label="库存订单列表">
          <div className={styles.inventoryColumns} aria-hidden="true">
            <span>订单 / 商品</span>
            <span>采购成本</span>
            <span>库存进度</span>
            <span>销售回款</span>
            <span>已实现利润</span>
            <span>操作</span>
          </div>
          {orders.map((order, index) => (
            <motion.article
              key={order.id}
              className="inventory-order-card"
              initial={
                instantMotion ||
                index >= 4 ||
                animatedItems.current.has(order.id)
                  ? false
                  : { opacity: 0.65, transform: "translateY(12px)" }
              }
              animate={{ opacity: 1, transform: "translateY(0)" }}
              transition={
                instantMotion
                  ? { duration: 0 }
                  : {
                      ...springs.appleSpatial,
                      delay: Math.min(index, 3) * 0.035,
                    }
              }
            >
              <button
                type="button"
                onClick={() => void openDetail(order)}
                className={`grid min-w-0 grid-cols-[4.25rem_minmax(0,1fr)] gap-3 text-left ${styles.orderIdentity}`}
              >
                <span className="inventory-order-card-thumb">
                  {order.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={order.imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span
                      className="grid h-full place-items-center text-[10px]"
                      style={{ color: "var(--glass-ink-tertiary)" }}
                    >
                      无图
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  <span
                    className="inventory-order-card-name"
                    data-testid="inventory-order-card-name"
                  >
                    {order.name || "未命名订单"}
                  </span>
                  <span className="inventory-order-card-ord">
                    {order.orderNumber}
                    {order.platform ? ` · ${order.platform}` : ""}
                  </span>
                  <span className="inventory-order-card-cost-label">
                    {order.statusLabel}
                  </span>
                </span>
              </button>

              <div className={styles.orderCost}>
                <span className={styles.mobileLabel}>采购成本</span>
                <strong>{yen(order.purchaseCost)}</strong>
                <small>{cny(order.purchaseCost, exchangeRate)}</small>
              </div>
              <div className={styles.orderStock}>
                <StockBar
                  remaining={order.remainingQuantity}
                  sold={order.soldQuantity}
                  initial={order.initialQuantity}
                />
              </div>

              <div className={styles.orderRecovery}>
                <RecoveryBar
                  percent={order.recoveryPercent}
                  recoveredYen={order.totalSales}
                />
              </div>

              <div className="inventory-order-card-footer">
                <div className="min-w-0">
                  <span className="inventory-order-profit-label">
                    已实现利润
                  </span>
                  <span
                    className={`inventory-order-profit-value ${
                      order.realizedProfit >= 0 ? "text-moss" : "text-rust"
                    }`}
                  >
                    {yenSigned(order.realizedProfit)}
                  </span>
                  {order.status === "sold_out" &&
                    order.finalOrderProfit != null && (
                      <span
                        className="mt-0.5 block text-[10px] font-semibold"
                        style={{ color: "var(--glass-ink-secondary)" }}
                        data-testid="card-final-profit"
                      >
                        清仓利润{" "}
                        <span
                          className={`font-mono tabular-nums ${
                            order.finalOrderProfit >= 0
                              ? "text-moss"
                              : "text-rust"
                          }`}
                        >
                          {yenSigned(order.finalOrderProfit)}
                        </span>
                        {(() => {
                          const margin = clearanceMarginPercent(order);
                          return margin != null ? (
                            <span
                              className="ml-1 font-mono tabular-nums"
                              style={{ color: "var(--glass-ink-tertiary)" }}
                            >
                              · {margin.toFixed(0)}%
                            </span>
                          ) : null;
                        })()}
                      </span>
                    )}
                </div>
              </div>
              <button
                type="button"
                disabled={order.remainingQuantity <= 0}
                onClick={() => openSell(order)}
                className="io-btn-sell"
              >
                卖出
              </button>
            </motion.article>
          ))}
        </section>
      )}

      {total > pageSize && !error && (
        <nav
          aria-label="库存订单分页"
          className="flex items-center justify-between gap-3 py-3"
        >
          <button
            type="button"
            className="io-btn-ghost min-h-11 min-w-11"
            aria-label="上一页库存订单"
            disabled={loading || page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            上一页
          </button>
          <span className="text-sm tabular-nums" aria-live="polite">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            className="io-btn-ghost min-h-11 min-w-11"
            aria-label="下一页库存订单"
            disabled={loading || page >= pageCount}
            onClick={() =>
              setPage((current) => Math.min(pageCount, current + 1))
            }
          >
            下一页
          </button>
        </nav>
      )}

      {detail &&
        createPortal(
          <div
            className="modal-backdrop inventory-order-backdrop absolute inset-0 z-50 p-0"
            onMouseDown={() => setDetail(null)}
          >
            <motion.section
              initial={
                instantMotion
                  ? false
                  : { opacity: 0.6, transform: "translateY(24px) scale(0.98)" }
              }
              animate={{ opacity: 1, transform: "translateY(0) scale(1)" }}
              transition={
                instantMotion ? { duration: 0 } : springs.appleSpatial
              }
              ref={detailDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="inventory-order-detail-title"
              className={`modal-panel inventory-order-sheet max-h-[92dvh] overflow-y-auto p-5 ${styles.operationDialog}`}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <SheetGrabber />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] tabular-nums text-[color:var(--glass-ink-tertiary)]">
                    {detail.orderNumber}
                  </p>
                  <h2
                    id="inventory-order-detail-title"
                    data-testid="inventory-order-detail-name"
                  >
                    {detail.name || "库存订单"}
                  </h2>
                  <p className="mt-1 text-xs leading-snug text-[color:var(--glass-ink-secondary)]">
                    {detail.statusLabel}
                    {detail.platform ? ` · ${detail.platform}` : ""}
                    {detail.purchasedAt
                      ? ` · ${fmtDate(detail.purchasedAt)}`
                      : ""}
                  </p>
                  {detail.note ? (
                    <p
                      className="inventory-order-note-slot"
                      data-testid="inventory-order-detail-note"
                    >
                      <span className="font-semibold text-[color:var(--glass-ink-tertiary)]">
                        备注 ·{" "}
                      </span>
                      {detail.note}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setDetail(null)}
                  aria-label="关闭详情"
                  className="inventory-order-close"
                >
                  ×
                </button>
              </div>

              {detailLoading ? (
                <p className="mt-6 text-sm text-[color:var(--glass-ink-secondary)]">
                  加载中…
                </p>
              ) : (
                <>
                  <div className="inventory-order-inset mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                    <div>
                      <span className="block text-[10px] text-[color:var(--glass-ink-tertiary)]">
                        采购成本
                      </span>
                      <b className="font-mono tabular-nums">
                        {yen(detail.purchaseCost)}
                      </b>
                    </div>
                    <div>
                      <span className="block text-[10px] text-[color:var(--glass-ink-tertiary)]">
                        剩余
                      </span>
                      <b className="font-mono tabular-nums">
                        {detail.remainingQuantity}/{detail.initialQuantity}
                      </b>
                    </div>
                    <div>
                      <span className="block text-[10px] text-[color:var(--glass-ink-tertiary)]">
                        均价成本
                      </span>
                      <b className="font-mono tabular-nums">
                        {yen(detail.averageCost)}
                      </b>
                    </div>
                    <div>
                      <span className="block text-[10px] text-[color:var(--glass-ink-tertiary)]">
                        累计销售
                      </span>
                      <b className="font-mono tabular-nums">
                        {yen(detail.totalSales)}
                      </b>
                    </div>
                    <div>
                      <span className="block text-[10px] text-[color:var(--glass-ink-tertiary)]">
                        已实现利润
                      </span>
                      <b
                        className={`font-mono tabular-nums ${
                          detail.realizedProfit >= 0 ? "text-moss" : "text-rust"
                        }`}
                      >
                        {yenSigned(detail.realizedProfit)}
                      </b>
                    </div>
                    <div>
                      <span className="block text-[10px] text-[color:var(--glass-ink-tertiary)]">
                        已售
                      </span>
                      <b className="font-mono tabular-nums">
                        {detail.soldQuantity} 件
                      </b>
                    </div>
                  </div>

                  <StockBar
                    remaining={detail.remainingQuantity}
                    sold={detail.soldQuantity}
                    initial={detail.initialQuantity}
                  />
                  <RecoveryBar
                    percent={detail.recoveryPercent}
                    recoveredYen={detail.totalSales}
                  />

                  {detail.finalOrderProfit != null && (
                    <div
                      className={`mt-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${
                        detail.finalOrderProfit >= 0
                          ? "bg-moss/10 text-moss"
                          : "bg-rust/10 text-rust"
                      }`}
                      data-testid="detail-final-profit"
                    >
                      <span className="block text-[10px] font-semibold opacity-70">
                        清仓最终利润
                      </span>
                      <span className="font-mono tabular-nums">
                        {yenSigned(detail.finalOrderProfit)}
                      </span>
                      {(() => {
                        const margin = clearanceMarginPercent(detail);
                        return margin != null ? (
                          <span className="ml-2 font-mono text-xs tabular-nums opacity-80">
                            利润率 {margin.toFixed(1)}%
                          </span>
                        ) : null;
                      })()}
                      <span className="mt-1 block text-[11px] font-medium opacity-65">
                        销售额 {yen(detail.totalSales)} − 采购{" "}
                        {yen(detail.purchaseCost)}
                      </span>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={detail.remainingQuantity <= 0}
                      onClick={() => openSell(detail)}
                      className="io-btn-sell"
                    >
                      卖出
                    </button>
                    <button
                      type="button"
                      onClick={() => openAdjust(detail)}
                      className="io-btn-ghost"
                    >
                      调整库存
                    </button>
                  </div>

                  <h3 className="mt-6 text-sm font-bold">销售记录</h3>
                  {detail.salesRecords.length === 0 ? (
                    <div className="inventory-order-inset mt-2 px-3 py-4 text-center text-xs">
                      还没有卖出记录。点「卖出」登记一笔成交即可。
                    </div>
                  ) : (
                    <div className="inventory-order-table-wrap">
                      <table className="w-full min-w-[360px] text-left text-xs">
                        <thead className="text-[color:var(--glass-ink-secondary)]">
                          <tr>
                            <th className="px-3 py-2 text-[10px] font-semibold">
                              日期
                            </th>
                            <th className="px-3 py-2 text-right text-[10px] font-semibold">
                              数量
                            </th>
                            <th className="px-3 py-2 text-right text-[10px] font-semibold">
                              成交价
                            </th>
                            <th className="px-3 py-2 text-right text-[10px] font-semibold">
                              利润
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.salesRecords.map((sale) => (
                            <tr
                              key={sale.id}
                              className="border-t border-[rgba(29,29,31,0.06)]"
                            >
                              <td className="px-3 py-2.5 align-top">
                                <span className="block">
                                  {fmtDay(sale.soldAt)}
                                </span>
                                {sale.note ? (
                                  <span
                                    className="mt-0.5 block text-[10px] leading-snug text-[color:var(--glass-ink-tertiary)]"
                                    data-testid="inventory-order-sale-note"
                                  >
                                    备注 · {sale.note}
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                                {sale.quantity}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                                {yen(sale.salePrice)}
                              </td>
                              <td
                                className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                                  sale.profit >= 0 ? "text-moss" : "text-rust"
                                }`}
                              >
                                {yenSigned(sale.profit)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <h3 className="mt-6 text-sm font-bold">库存调整</h3>
                  {detail.adjustments.length === 0 ? (
                    <p className="mt-2 text-xs text-[color:var(--glass-ink-tertiary)]">
                      破损 / 赠送 / 损耗在这里记，不计入销售额。
                    </p>
                  ) : (
                    <ul className="mt-2 grid gap-1.5">
                      {detail.adjustments.map((adjustment) => (
                        <li
                          key={adjustment.id}
                          className="inventory-order-inset flex justify-between gap-2 px-3 py-2.5 text-xs"
                        >
                          <span>
                            <b className="font-mono tabular-nums">
                              {adjustment.quantityDelta > 0 ? "+" : ""}
                              {adjustment.quantityDelta}
                            </b>{" "}
                            {adjustment.reason}
                          </span>
                          <span className="shrink-0 text-[color:var(--glass-ink-tertiary)]">
                            {fmtDay(adjustment.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </motion.section>
          </div>,
          getShellOverlayRoot(),
        )}

      {(sellOrder || adjustOrder) &&
        createPortal(
          <div
            className="modal-backdrop inventory-order-backdrop absolute inset-0 z-[60] p-0"
            onMouseDown={closeForms}
          >
            <motion.section
              initial={
                instantMotion
                  ? false
                  : { opacity: 0.6, transform: "translateY(24px) scale(0.98)" }
              }
              animate={{ opacity: 1, transform: "translateY(0) scale(1)" }}
              transition={
                instantMotion ? { duration: 0 } : springs.appleSpatial
              }
              ref={formDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={
                sellOrder
                  ? "inventory-order-sell-title"
                  : "inventory-order-adjust-title"
              }
              className={`modal-panel inventory-order-sheet overflow-y-auto p-5 ${styles.operationDialog}`}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <SheetGrabber />
              {sellOrder && (
                <>
                  <h2 id="inventory-order-sell-title">卖出</h2>
                  <p className="mt-1 text-xs leading-snug text-[color:var(--glass-ink-secondary)]">
                    <span className="font-mono tabular-nums text-[color:var(--glass-ink-tertiary)]">
                      {sellOrder.orderNumber}
                    </span>
                    {sellOrder.name ? (
                      <>
                        {" · "}
                        <span data-testid="inventory-order-sell-name">
                          {sellOrder.name}
                        </span>
                      </>
                    ) : null}
                  </p>
                  <p className="mt-2 text-xs text-[color:var(--glass-ink-tertiary)]">
                    剩余{" "}
                    <span className="font-mono font-semibold tabular-nums text-[color:var(--glass-ink-secondary)]">
                      {sellOrder.remainingQuantity}
                    </span>
                    {" · "}
                    均价{" "}
                    <span className="font-mono font-semibold tabular-nums text-[color:var(--glass-ink-secondary)]">
                      {yen(sellOrder.averageCost)}
                    </span>
                  </p>
                  <Field label="数量">
                    <input
                      type="number"
                      min={1}
                      max={sellOrder.remainingQuantity}
                      value={sellQty}
                      onChange={(event) => setSellQty(event.target.value)}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="成交价（日元合计）">
                    <input
                      type="number"
                      min={0}
                      value={sellPrice}
                      onChange={(event) => setSellPrice(event.target.value)}
                      placeholder="这一笔的总成交价"
                      className={inputClass}
                    />
                  </Field>
                  <Field label="备注（可选）">
                    <input
                      value={sellNote}
                      onChange={(event) => setSellNote(event.target.value)}
                      placeholder="仅写入本笔销售备注"
                      className={`${inputClass} text-sm`}
                    />
                  </Field>

                  {sellPreview?.cost != null && sellPreview.profit != null && (
                    <div
                      className="inventory-order-inset mt-3.5 grid grid-cols-2 gap-3 text-xs"
                      data-testid="sell-preview"
                    >
                      <div>
                        <span className="block text-[10px] text-[color:var(--glass-ink-tertiary)]">
                          本次成本
                        </span>
                        <b className="font-mono tabular-nums">
                          {yen(sellPreview.cost)}
                        </b>
                      </div>
                      <div>
                        <span className="block text-[10px] text-[color:var(--glass-ink-tertiary)]">
                          本次利润
                        </span>
                        <b
                          className={`font-mono tabular-nums ${
                            sellPreview.profit >= 0 ? "text-moss" : "text-rust"
                          }`}
                        >
                          {yenSigned(sellPreview.profit)}
                        </b>
                      </div>
                    </div>
                  )}

                  {formMessage && (
                    <p
                      role="alert"
                      className="mt-3 text-xs font-bold text-rust"
                    >
                      {formMessage}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitSell()}
                    className="inventory-order-primary-cta io-cta-rust disabled:opacity-50"
                  >
                    {busy ? "提交中…" : "确认卖出"}
                  </button>
                </>
              )}

              {adjustOrder && (
                <>
                  <h2 id="inventory-order-adjust-title">调整库存</h2>
                  <p className="mt-1 text-xs leading-snug text-[color:var(--glass-ink-secondary)]">
                    <span className="font-mono tabular-nums text-[color:var(--glass-ink-tertiary)]">
                      {adjustOrder.orderNumber}
                    </span>
                    {adjustOrder.name ? (
                      <>
                        {" · "}
                        <span data-testid="inventory-order-adjust-name">
                          {adjustOrder.name}
                        </span>
                      </>
                    ) : null}
                    <span className="mt-0.5 block text-[color:var(--glass-ink-tertiary)]">
                      破损 / 赠送 / 损耗不计入销售额
                    </span>
                  </p>
                  <p className="mt-2 text-xs text-[color:var(--glass-ink-tertiary)]">
                    当前剩余{" "}
                    <span className="font-mono font-semibold tabular-nums text-[color:var(--glass-ink-secondary)]">
                      {adjustOrder.remainingQuantity}
                    </span>
                    {adjustPreviewRemaining != null && (
                      <>
                        {" → "}
                        <span
                          className={`font-mono font-semibold tabular-nums ${
                            adjustPreviewRemaining < 0 ||
                            adjustPreviewRemaining > adjustOrder.initialQuantity
                              ? "text-rust"
                              : "text-[color:var(--glass-ink-secondary)]"
                          }`}
                        >
                          {adjustPreviewRemaining}
                        </span>
                      </>
                    )}
                  </p>
                  <Field label="数量变化">
                    <input
                      type="number"
                      value={adjustDelta}
                      onChange={(event) => setAdjustDelta(event.target.value)}
                      className={inputClass}
                    />
                  </Field>
                  <div className="inventory-order-chip-row">
                    {ADJUST_REASONS.map((reason) => (
                      <button
                        key={reason}
                        type="button"
                        onClick={() => setAdjustReason(reason)}
                        className="inventory-order-chip"
                        data-active={adjustReason === reason ? "true" : "false"}
                      >
                        {reason}
                      </button>
                    ))}
                  </div>
                  <Field label="原因">
                    <input
                      value={adjustReason}
                      onChange={(event) => setAdjustReason(event.target.value)}
                      placeholder="破损 / 赠送 / 盘点"
                      className={`${inputClass} text-sm`}
                    />
                  </Field>
                  {formMessage && (
                    <p
                      role="alert"
                      className="mt-3 text-xs font-bold text-rust"
                    >
                      {formMessage}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitAdjust()}
                    className="inventory-order-primary-cta io-cta-ink disabled:opacity-50"
                  >
                    {busy ? "提交中…" : "确认调整"}
                  </button>
                </>
              )}

            </motion.section>
          </div>,
          getShellOverlayRoot(),
        )}
      {registrationOpen && (
        <PurchaseRegistrationForm
          apiBaseUrl={apiBaseUrl}
          items={[]}
          onClose={() => setRegistrationOpen(false)}
          onSaved={() => {
            setRegistrationOpen(false);
            setReceipt("已登记购买 · 库存订单已生成");
            void load();
          }}
        />
      )}
    </div>
  );
}
