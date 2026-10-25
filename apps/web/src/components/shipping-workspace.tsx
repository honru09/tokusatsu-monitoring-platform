"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { LoadError } from "./load-error";
import { EmptyState } from "./empty-state";
import { SafeItemImage } from "./item-image";
import { TERMS } from "../lib/terms";
import { fmtYen } from "../lib/listing-display";
import { readFetchError } from "../lib/fetch-error";
import { readJsonResponse } from "../lib/http-json";
import {
  capJpyFromCny,
  packParcel,
  packedTotal,
  toCny,
  toCny1dp,
  type PackedLine,
} from "../lib/shipping-packing";
import type { InventoryOrderCard } from "./inventory-orders-workspace";

/**
 * The cap and target band are CNY: 2,000 CNY is the China customs
 * personal-postal limit for a small packet to China, and 1,800-1,900
 * CNY is the band worth aiming for. Stock values stay in yen and are
 * converted with the live rate (see shipping-packing.ts).
 */
export const SHIPPING_DECLARED_CAP_CNY = 2000;
export const SHIPPING_TARGET_MIN_CNY = 1800;
export const SHIPPING_TARGET_MAX_CNY = 1900;

type ExchangeRateInfo = {
  rate: number;
  source: string;
  referenceDate: string;
  fetchedAt: string;
  stale: boolean;
};

type ShipmentLine = {
  id: string;
  inventoryOrderId: string;
  itemName: string | null;
  quantity: number;
  unitDeclaredYen: number;
  lineTotalYen: number;
};

type Shipment = {
  id: string;
  totalDeclared: number;
  /** CNY total recorded at confirm time; older rows may not have one. */
  totalDeclaredCny?: number | null;
  /** JPY/CNY rate the CNY total was computed with, when recorded. */
  exchangeRate?: number | null;
  createdById: string;
  createdByName: string | null;
  createdAt: string;
  lines: ShipmentLine[];
};

type ParcelLineDraft = PackedLine;

const unitDeclaredDefault = (order: InventoryOrderCard) =>
  Math.max(
    0,
    Math.round(
      order.averageCost ?? order.purchaseCost / Math.max(1, order.initialQuantity),
    ),
  );

const orderTitle = (order: InventoryOrderCard) =>
  order.name?.trim() || order.orderNumber;

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const fmtCnyInt = (value: number) => `${value.toLocaleString("zh-CN")} 元`;

const fmtCny1dp = (value: number) =>
  `${value.toLocaleString("zh-CN", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} 元`;

/**
 * 发货 tab: compose one Japan Post small-packet parcel from stock on
 * hand. Declared values default to unit purchase prices in yen; the
 * cap is the 2,000 CNY customs limit converted at the live rate. The
 * auto-pack fills the parcel as close to the cap as the stock allows,
 * and confirming persists the shipment (with the rate and the CNY
 * total it produced) and decrements the stock.
 */
export function ShippingWorkspace({
  apiBaseUrl,
  accountId,
}: {
  apiBaseUrl: string;
  accountId: string | null;
}) {
  const [orders, setOrders] = useState<InventoryOrderCard[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cap, setCap] = useState(String(SHIPPING_DECLARED_CAP_CNY));
  const [lines, setLines] = useState<ParcelLineDraft[]>([]);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>(
    {},
  );
  const [confirming, setConfirming] = useState(false);
  const [receipt, setReceipt] = useState("");
  const [rateInfo, setRateInfo] = useState<ExchangeRateInfo | null>(null);
  const [rateFailed, setRateFailed] = useState(false);

  const rate =
    rateInfo && Number.isFinite(rateInfo.rate) && rateInfo.rate > 0
      ? rateInfo.rate
      : null;

  const capCny = useMemo(() => {
    const parsed = Number(cap);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.floor(parsed)
      : SHIPPING_DECLARED_CAP_CNY;
  }, [cap]);

  // Every cap-derived figure (packing, gating, gauge) comes from this
  // one conversion of the current cap input and rate, so editing the
  // cap mid-composition re-gates the existing lines immediately.
  const capJpy = rate != null ? capJpyFromCny(capCny, rate) : 0;
  const rateReady = rate != null && capJpy > 0;

  const loadRate = useCallback(
    async (signal?: AbortSignal): Promise<ExchangeRateInfo | null> => {
      try {
        const response = await fetch(`${apiBaseUrl}/exchange-rate`, {
          cache: "no-store",
          signal,
        });
        if (!response.ok) throw new Error("exchange rate unavailable");
        const payload = (await response.json()) as ExchangeRateInfo;
        if (!payload || !Number.isFinite(payload.rate) || payload.rate <= 0)
          throw new Error("exchange rate unavailable");
        if (!signal?.aborted) {
          setRateInfo(payload);
          setRateFailed(false);
        }
        return payload;
      } catch {
        if (!signal?.aborted) {
          setRateInfo(null);
          setRateFailed(true);
        }
        return null;
      }
    },
    [apiBaseUrl],
  );

  const load = useCallback(
    async (
      signal?: AbortSignal,
      options?: { soft?: boolean },
    ): Promise<boolean> => {
      // A soft load refreshes in the background: it must not blank the
      // composer behind the loading/error states, and it reports
      // failure through its return value instead of `error`.
      const soft = options?.soft ?? false;
      if (!soft) setLoading(true);
      try {
        const collected: InventoryOrderCard[] = [];
        let total = Number.POSITIVE_INFINITY;
        for (let page = 1; collected.length < total && page <= 10; page += 1) {
          const response = await fetch(
            `${apiBaseUrl}/inventory-orders?page=${page}&limit=100`,
            { cache: "no-store", signal },
          );
          if (!response.ok)
            throw new Error(await readFetchError(response, "库存同步失败"));
          const payload = (await response.json()) as {
            orders?: InventoryOrderCard[];
            total?: number;
          };
          collected.push(...(payload.orders ?? []));
          total = payload.total ?? collected.length;
          if (!(payload.orders?.length)) break;
        }
        if (signal?.aborted) return false;
        setOrders(
          collected.filter((order) => order.remainingQuantity > 0),
        );
        const shipmentsResponse = await fetch(
          `${apiBaseUrl}/shipments?limit=50`,
          { cache: "no-store", signal },
        );
        if (shipmentsResponse.ok) {
          const payload = (await shipmentsResponse.json()) as {
            shipments?: Shipment[];
          };
          if (!signal?.aborted) setShipments(payload.shipments ?? []);
        }
        if (!soft) setError("");
        return true;
      } catch (reason) {
        if (!signal?.aborted && !soft)
          setError(
            reason instanceof Error ? reason.message : "库存同步失败",
          );
        return false;
      } finally {
        if (!signal?.aborted && !soft) setLoading(false);
      }
    },
    [apiBaseUrl],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    void loadRate(controller.signal);
    return () => controller.abort();
  }, [load, loadRate]);

  const orderById = useMemo(
    () => new Map(orders.map((order) => [order.id, order])),
    [orders],
  );
  const overCapOrders = useMemo(
    () =>
      rateReady
        ? orders.filter((order) => unitDeclaredDefault(order) > capJpy)
        : [],
    [orders, capJpy, rateReady],
  );
  const total = packedTotal(lines);
  const totalCny = rate != null ? toCny(total, rate) : null;
  const overCap = rateReady && total > capJpy;
  const inBand =
    totalCny != null &&
    totalCny >= SHIPPING_TARGET_MIN_CNY &&
    totalCny <= SHIPPING_TARGET_MAX_CNY;
  const fillPercent =
    totalCny != null
      ? Math.min(100, Math.round((totalCny / capCny) * 100))
      : 0;
  const bandStart = Math.round((SHIPPING_TARGET_MIN_CNY / capCny) * 100);
  const bandWidth = Math.max(
    2,
    Math.round(
      ((SHIPPING_TARGET_MAX_CNY - SHIPPING_TARGET_MIN_CNY) / capCny) * 100,
    ),
  );

  const autoPack = async () => {
    setReceipt("");
    // Refetch the rate so the pack uses the freshest cap conversion;
    // if the refetch fails, rateReady drops and packing stays off
    // rather than packing against a stale or made-up rate.
    const fresh = await loadRate();
    const activeRate = fresh?.rate ?? rate;
    if (activeRate == null) return;
    const activeCapJpy = capJpyFromCny(capCny, activeRate);
    if (activeCapJpy <= 0) return;
    setQuantityDrafts({});
    setLines(
      packParcel(
        orders.map((order) => ({
          orderId: order.id,
          unitDeclaredYen: unitDeclaredDefault(order),
          available: order.remainingQuantity,
          purchasedAt: order.purchasedAt,
          createdAt: order.purchasedAt ?? "",
        })),
        activeCapJpy,
      ),
    );
  };

  const setLineQuantity = (orderId: string, quantity: number) => {
    const order = orderById.get(orderId);
    if (!order) return;
    const clamped = Math.max(0, Math.min(order.remainingQuantity, quantity));
    setLines((current) =>
      clamped === 0
        ? current.filter((line) => line.orderId !== orderId)
        : current.map((line) =>
            line.orderId === orderId ? { ...line, quantity: clamped } : line,
          ),
    );
  };

  // While a quantity input is being edited it shows the raw draft, so
  // clearing the field does not delete the line mid-keystroke. Values
  // of 1+ commit live (the gauge follows along); empty or 0 only take
  // effect on blur, where empty reverts to the committed quantity and
  // an explicit 0 removes the line.
  const onQuantityChange = (orderId: string, raw: string) => {
    const digits = raw.replace(/[^\d]/g, "");
    setQuantityDrafts((current) => ({ ...current, [orderId]: digits }));
    if (digits === "") return;
    const parsed = Number(digits);
    if (Number.isFinite(parsed) && parsed >= 1)
      setLineQuantity(orderId, parsed);
  };

  const onQuantityBlur = (orderId: string) => {
    const draft = quantityDrafts[orderId];
    setQuantityDrafts((current) => {
      if (!(orderId in current)) return current;
      const next = { ...current };
      delete next[orderId];
      return next;
    });
    if (draft == null || draft === "") return;
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) setLineQuantity(orderId, parsed);
  };

  const setLineUnitDeclared = (orderId: string, value: number) => {
    setLines((current) =>
      current.map((line) =>
        line.orderId === orderId
          ? { ...line, unitDeclaredYen: Math.max(0, Math.floor(value) || 0) }
          : line,
      ),
    );
  };

  const addOrder = (order: InventoryOrderCard) => {
    setReceipt("");
    setLines((current) => {
      const existing = current.find((line) => line.orderId === order.id);
      if (existing) {
        return current.map((line) =>
          line.orderId === order.id
            ? {
                ...line,
                quantity: Math.min(order.remainingQuantity, line.quantity + 1),
              }
            : line,
        );
      }
      return [
        ...current,
        {
          orderId: order.id,
          quantity: 1,
          unitDeclaredYen: unitDeclaredDefault(order),
        },
      ];
    });
  };

  const confirmShipment = async () => {
    if (!lines.length || overCap || confirming || !accountId || !rateReady)
      return;
    const activeRate = rate;
    if (activeRate == null) return;
    setConfirming(true);
    setReceipt("");
    const totalDeclaredCny = toCny(total, activeRate);
    try {
      const response = await fetch(`${apiBaseUrl}/shipments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          exchangeRate: activeRate,
          totalDeclaredCny,
          lines: lines.map((line) => ({
            inventoryOrderId: line.orderId,
            quantity: line.quantity,
            unitDeclaredYen: line.unitDeclaredYen,
          })),
        }),
      });
      const payload = await readJsonResponse<{ shipment: Shipment }>(
        response,
        "发货登记失败",
      );
      setLines([]);
      setQuantityDrafts({});
      const message = `已发货 · 申报合计 ${fmtYen(payload.shipment.totalDeclared)}（≈${fmtCnyInt(payload.shipment.totalDeclaredCny ?? totalDeclaredCny)}）`;
      setReceipt(message);
      // The shipment is already saved; a failed refresh must not swap
      // the composer for a load error and lose the receipt, so refresh
      // softly and surface any failure in the receipt line instead.
      const refreshed = await load(undefined, { soft: true });
      if (!refreshed)
        setReceipt(`${message} · 库存刷新失败，稍后打开会同步最新库存`);
    } catch (reason) {
      setReceipt(
        reason instanceof Error ? reason.message : "发货登记失败，请重试",
      );
    } finally {
      setConfirming(false);
    }
  };

  const packedIds = new Set(lines.map((line) => line.orderId));

  return (
    <section aria-label="发货打包" className="grid gap-3">
      <div className="ios-surface rounded-2xl p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-sm font-black text-ink">组包</h3>
          <div className="flex flex-col items-end gap-1">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-meta">
              申报上限
              <input
                inputMode="numeric"
                aria-label="申报上限"
                value={cap}
                disabled={!rateReady}
                onChange={(event) =>
                  setCap(event.target.value.replace(/[^\d]/g, ""))
                }
                className="h-9 w-[76px] rounded-lg border border-black/[0.12] bg-white px-2 font-mono text-xs text-ink tabular-nums disabled:opacity-40"
              />
              元
            </label>
            {rateInfo && rate != null ? (
              <span className="font-mono text-[10px] text-meta tabular-nums">
                1 日元 ≈ {rate.toFixed(4)} 元 · 汇率{" "}
                {dateTime(rateInfo.fetchedAt)}
                {rateInfo.stale ? "（可能过期）" : ""}
              </span>
            ) : rateFailed ? (
              <span className="text-[10px] font-semibold text-[#c81e1e]">
                汇率加载失败，上限暂不可用
                <button
                  type="button"
                  onClick={() => void loadRate()}
                  className="ml-1 underline underline-offset-2"
                >
                  重试
                </button>
              </span>
            ) : (
              <span className="text-[10px] text-meta">汇率加载中…</span>
            )}
          </div>
        </div>

        <div className="mt-3">
          <div
            className="relative h-2.5 overflow-hidden rounded-full bg-black/[0.07]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={capCny}
            aria-valuenow={totalCny ?? 0}
            aria-label="申报额填充进度"
          >
            <span
              className="absolute inset-y-0 rounded-full bg-emerald-500/25"
              style={{ left: `${bandStart}%`, width: `${bandWidth}%` }}
              aria-hidden="true"
            />
            <span
              className={`absolute inset-y-0 left-0 rounded-full transition-all ${
                overCap ? "bg-[#ff3b30]" : inBand ? "bg-emerald-500" : "bg-ink/70"
              }`}
              style={{ width: `${fillPercent}%` }}
              aria-hidden="true"
            />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between font-mono text-[11px] tabular-nums text-ink/60">
            <span>
              申报合计{" "}
              <strong className={`text-[13px] ${overCap ? "text-[#ff3b30]" : "text-ink"}`}>
                {fmtYen(total)}
              </strong>
              {totalCny != null && <> ≈ {fmtCnyInt(totalCny)}</>}
              {" / "}
              {fmtCnyInt(capCny)}
            </span>
            <span>
              目标 {SHIPPING_TARGET_MIN_CNY.toLocaleString("zh-CN")}–
              {SHIPPING_TARGET_MAX_CNY.toLocaleString("zh-CN")} 元
              {inBand ? " · 已达标" : ""}
            </span>
          </div>
        </div>

        {loading ? (
          <p className="mt-3 text-xs text-ink/50">正在读取库存…</p>
        ) : error ? (
          <LoadError
            message={error}
            onRetry={() => void load()}
            retryTestId="retry-shipping-stock"
          />
        ) : (
          <>
            {lines.length > 0 && (
              <ul className="mt-3 grid gap-1.5">
                {lines.map((line) => {
                  const order = orderById.get(line.orderId);
                  if (!order) return null;
                  return (
                    <li
                      key={line.orderId}
                      className="flex items-center gap-2 rounded-xl border border-black/[0.06] bg-white px-2.5 py-2"
                    >
                      <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-black/5">
                        <SafeItemImage
                          src={order.imageUrl ?? undefined}
                          alt={orderTitle(order)}
                          className="h-full w-full object-cover"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-xs font-semibold text-ink">
                          {orderTitle(order)}
                        </strong>
                        <span className="font-mono text-[11px] text-meta tabular-nums">
                          余 {order.remainingQuantity} 件
                        </span>
                      </span>
                      <label className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-meta">
                        件
                        <input
                          inputMode="numeric"
                          aria-label={`数量：${orderTitle(order)}`}
                          value={quantityDrafts[line.orderId] ?? line.quantity}
                          onChange={(event) =>
                            onQuantityChange(line.orderId, event.target.value)
                          }
                          onBlur={() => onQuantityBlur(line.orderId)}
                          className="h-9 w-[52px] rounded-lg border border-black/[0.12] bg-white px-1.5 text-center font-mono text-xs text-ink tabular-nums"
                        />
                      </label>
                      <label className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-meta">
                        申报 ¥
                        <input
                          inputMode="numeric"
                          aria-label={`单件申报价：${orderTitle(order)}`}
                          value={line.unitDeclaredYen}
                          onChange={(event) =>
                            setLineUnitDeclared(
                              line.orderId,
                              Number(event.target.value.replace(/[^\d]/g, "")) || 0,
                            )
                          }
                          className="h-9 w-[64px] rounded-lg border border-black/[0.12] bg-white px-1.5 text-right font-mono text-xs text-ink tabular-nums"
                        />
                      </label>
                      <span className="flex w-[76px] shrink-0 flex-col items-end">
                        <span className="font-mono text-xs font-bold text-ink tabular-nums">
                          {fmtYen(line.quantity * line.unitDeclaredYen)}
                        </span>
                        {rate != null && (
                          <span className="font-mono text-[10px] text-meta tabular-nums">
                            ≈{" "}
                            {fmtCny1dp(
                              toCny1dp(
                                line.quantity * line.unitDeclaredYen,
                                rate,
                              ),
                            )}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        aria-label={`移出：${orderTitle(order)}`}
                        onClick={() => {
                          setQuantityDrafts((current) => {
                            if (!(line.orderId in current)) return current;
                            const next = { ...current };
                            delete next[line.orderId];
                            return next;
                          });
                          setLineQuantity(line.orderId, 0);
                        }}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink/45 transition hover:bg-black/[0.05]"
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => void autoPack()}
                disabled={orders.length === 0 || !rateReady}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-ink px-4 text-xs font-bold text-white transition active:scale-[0.98] disabled:opacity-40"
              >
                自动组包
              </button>
              <button
                type="button"
                onClick={() => void confirmShipment()}
                disabled={
                  lines.length === 0 ||
                  overCap ||
                  confirming ||
                  !accountId ||
                  !rateReady
                }
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white transition active:scale-[0.98] disabled:opacity-40"
              >
                {confirming ? "登记中…" : "确认发货"}
              </button>
            </div>
            {receipt && (
              <p
                role="status"
                className="mt-2 text-xs font-semibold text-emerald-800"
              >
                {receipt}
              </p>
            )}
            {overCap && (
              <p role="alert" className="mt-2 text-xs font-semibold text-[#c81e1e]">
                申报合计超过上限（{fmtCnyInt(capCny)}），先移出或调低申报价。
              </p>
            )}

            <div className="mt-4 border-t border-black/[0.06] pt-3">
              <h4 className="text-[11px] font-bold text-meta">
                可用库存 · {orders.length} 批
              </h4>
              {orders.length === 0 ? (
                <EmptyState art="shipping" title="暂无可发货库存" compact />
              ) : (
                <ul className="mt-2 grid gap-1.5">
                  {orders.map((order) => {
                    const unit = unitDeclaredDefault(order);
                    const tooBig = rateReady && unit > capJpy;
                    return (
                      <li
                        key={order.id}
                        className="flex items-center gap-2 rounded-xl bg-black/[0.03] px-2.5 py-2"
                      >
                        <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-black/5">
                          <SafeItemImage
                            src={order.imageUrl ?? undefined}
                            alt={orderTitle(order)}
                            className="h-full w-full object-cover"
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <strong className="block truncate text-xs font-semibold text-ink">
                            {orderTitle(order)}
                          </strong>
                          <span className="font-mono text-[11px] text-meta tabular-nums">
                            余 {order.remainingQuantity} 件 · 单价 {fmtYen(unit)}
                          </span>
                        </span>
                        {tooBig ? (
                          <span className="shrink-0 rounded-md bg-[#ff3b30]/10 px-2 py-1 text-[11px] font-bold text-[#c81e1e]">
                            超限
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => addOrder(order)}
                            disabled={packedIds.has(order.id) && lines.find((line) => line.orderId === order.id)?.quantity === order.remainingQuantity}
                            className="inline-flex min-h-9 shrink-0 items-center rounded-lg border border-black/[0.1] bg-white px-3 text-[11px] font-bold text-ink transition active:scale-[0.97] disabled:opacity-40"
                          >
                            加入
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {overCapOrders.length > 0 && (
                <p className="mt-2 text-[11px] leading-relaxed text-[#c81e1e]">
                  超限：{overCapOrders.map((order) => orderTitle(order)).join("、")}
                  的单件购入价已超过申报上限（{fmtCnyInt(capCny)}），无法整包发出。
                </p>
              )}
            </div>
          </>
        )}
      </div>

      <div className="ios-surface rounded-2xl p-4">
        <h3 className="text-sm font-black text-ink">
          {TERMS.shipping}记录
        </h3>
        {shipments.length === 0 ? (
          <EmptyState art="shipping" title="暂无发货记录" compact />
        ) : (
          <ul className="mt-2 divide-y divide-black/[0.05]">
            {shipments.map((shipment) => (
              <li
                key={shipment.id}
                className="flex items-baseline justify-between gap-2 py-2"
              >
                <span className="min-w-0">
                  <strong className="block truncate text-xs font-semibold text-ink">
                    {shipment.lines
                      .map(
                        (line) =>
                          `${line.itemName ?? "商品"} ×${line.quantity}`,
                      )
                      .join("、")}
                  </strong>
                  <span className="text-[11px] text-meta">
                    {dateTime(shipment.createdAt)}
                    {shipment.createdByName
                      ? ` · ${shipment.createdByName}`
                      : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-xs font-bold text-ink tabular-nums">
                    {fmtYen(shipment.totalDeclared)}
                  </span>
                  {shipment.totalDeclaredCny != null && (
                    <span className="block font-mono text-[10px] text-meta tabular-nums">
                      ≈ {fmtCnyInt(shipment.totalDeclaredCny)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
