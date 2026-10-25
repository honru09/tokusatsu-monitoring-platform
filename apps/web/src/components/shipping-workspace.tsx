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
  packParcel,
  packedTotal,
  type PackedLine,
} from "../lib/shipping-packing";
import type { InventoryOrderCard } from "./inventory-orders-workspace";

export const SHIPPING_DECLARED_CAP_YEN = 2000;
export const SHIPPING_TARGET_MIN_YEN = 1800;
export const SHIPPING_TARGET_MAX_YEN = 1900;

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

/**
 * 发货 tab: compose one Japan Post small-packet parcel from stock on
 * hand. Declared values default to unit purchase prices; the auto-pack
 * fills the parcel as close to the cap as the stock allows, and
 * confirming persists the shipment and decrements the stock.
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
  const [cap, setCap] = useState(String(SHIPPING_DECLARED_CAP_YEN));
  const [lines, setLines] = useState<ParcelLineDraft[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [receipt, setReceipt] = useState("");

  const capYen = useMemo(() => {
    const parsed = Number(cap);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.floor(parsed)
      : SHIPPING_DECLARED_CAP_YEN;
  }, [cap]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
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
        if (signal?.aborted) return;
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
        setError("");
      } catch (reason) {
        if (!signal?.aborted)
          setError(
            reason instanceof Error ? reason.message : "库存同步失败",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [apiBaseUrl],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const orderById = useMemo(
    () => new Map(orders.map((order) => [order.id, order])),
    [orders],
  );
  const overCapOrders = useMemo(
    () => orders.filter((order) => unitDeclaredDefault(order) > capYen),
    [orders, capYen],
  );
  const total = packedTotal(lines);
  const overCap = total > capYen;
  const inBand = total >= SHIPPING_TARGET_MIN_YEN && total <= SHIPPING_TARGET_MAX_YEN;
  const fillPercent = Math.min(100, Math.round((total / capYen) * 100));
  const bandStart = Math.round((SHIPPING_TARGET_MIN_YEN / capYen) * 100);
  const bandWidth = Math.max(
    2,
    Math.round(
      ((SHIPPING_TARGET_MAX_YEN - SHIPPING_TARGET_MIN_YEN) / capYen) * 100,
    ),
  );

  const autoPack = () => {
    setReceipt("");
    setLines(
      packParcel(
        orders.map((order) => ({
          orderId: order.id,
          unitDeclaredYen: unitDeclaredDefault(order),
          available: order.remainingQuantity,
          purchasedAt: order.purchasedAt,
          createdAt: order.purchasedAt ?? "",
        })),
        capYen,
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
    if (!lines.length || overCap || confirming || !accountId) return;
    setConfirming(true);
    setReceipt("");
    try {
      const response = await fetch(`${apiBaseUrl}/shipments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
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
      setReceipt(
        `已发货 · 申报合计 ${fmtYen(payload.shipment.totalDeclared)}`,
      );
      await load();
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-black text-ink">组包</h3>
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-ink/55">
            申报上限 ¥
            <input
              inputMode="numeric"
              aria-label="申报上限"
              value={cap}
              onChange={(event) =>
                setCap(event.target.value.replace(/[^\d]/g, ""))
              }
              className="h-9 w-[76px] rounded-lg border border-black/[0.12] bg-white px-2 font-mono text-xs text-ink tabular-nums"
            />
          </label>
        </div>

        <div className="mt-3">
          <div
            className="relative h-2.5 overflow-hidden rounded-full bg-black/[0.07]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={capYen}
            aria-valuenow={total}
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
              </strong>{" "}
              / {fmtYen(capYen)}
            </span>
            <span>
              目标 {fmtYen(SHIPPING_TARGET_MIN_YEN)}–{fmtYen(SHIPPING_TARGET_MAX_YEN)}
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
                        <span className="font-mono text-[11px] text-ink/55 tabular-nums">
                          余 {order.remainingQuantity} 件
                        </span>
                      </span>
                      <label className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-ink/55">
                        件
                        <input
                          inputMode="numeric"
                          aria-label={`数量：${orderTitle(order)}`}
                          value={line.quantity}
                          onChange={(event) =>
                            setLineQuantity(
                              line.orderId,
                              Number(event.target.value.replace(/[^\d]/g, "")) || 0,
                            )
                          }
                          className="h-9 w-[52px] rounded-lg border border-black/[0.12] bg-white px-1.5 text-center font-mono text-xs text-ink tabular-nums"
                        />
                      </label>
                      <label className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-ink/55">
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
                      <span className="w-[68px] shrink-0 text-right font-mono text-xs font-bold text-ink tabular-nums">
                        {fmtYen(line.quantity * line.unitDeclaredYen)}
                      </span>
                      <button
                        type="button"
                        aria-label={`移出：${orderTitle(order)}`}
                        onClick={() => setLineQuantity(line.orderId, 0)}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink/45 transition hover:bg-black/[0.05]"
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={autoPack}
                disabled={orders.length === 0}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-ink px-4 text-xs font-bold text-white transition active:scale-[0.98] disabled:opacity-40"
              >
                自动组包
              </button>
              <button
                type="button"
                onClick={() => void confirmShipment()}
                disabled={
                  lines.length === 0 || overCap || confirming || !accountId
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
                申报合计超过上限，先移出或调低申报价。
              </p>
            )}

            <div className="mt-4 border-t border-black/[0.06] pt-3">
              <h4 className="text-[11px] font-bold text-ink/55">
                可用库存 · {orders.length} 批
              </h4>
              {orders.length === 0 ? (
                <EmptyState art="box" title="暂无可发货库存" compact />
              ) : (
                <ul className="mt-2 grid gap-1.5">
                  {orders.map((order) => {
                    const unit = unitDeclaredDefault(order);
                    const tooBig = unit > capYen;
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
                          <span className="font-mono text-[11px] text-ink/55 tabular-nums">
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
                  的单件购入价已超过申报上限，无法整包发出。
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
          <EmptyState art="box" title="暂无发货记录" compact />
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
                  <span className="text-[11px] text-ink/50">
                    {dateTime(shipment.createdAt)}
                    {shipment.createdByName
                      ? ` · ${shipment.createdByName}`
                      : ""}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-xs font-bold text-ink tabular-nums">
                  {fmtYen(shipment.totalDeclared)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
