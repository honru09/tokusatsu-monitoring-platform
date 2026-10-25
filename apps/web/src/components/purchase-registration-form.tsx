"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import { springs } from "../lib/motion-tokens";
import { getShellOverlayRoot } from "../lib/shell-overlay";
import { useTransactionPresentation } from "../lib/use-transaction-presentation";
import { TERMS } from "../lib/terms";
import { CostEstimatePanel } from "./cost-estimate-panel";
import transactionStyles from "./transaction-feedback.module.css";

/**
 * The one purchase registration form for the whole site.
 *
 * Every entry point (card menu, detail drawer, todo register queue,
 * link-import completion, share rounds, the purchases page and the
 * inventory workspace) opens this component; the differences between
 * them are only in how `items` / `candidateItems` are prefilled:
 *
 * - single item: one catalog row, amount prefilled from the listing
 *   total (or the item's recorded purchase when re-opened);
 * - bundle / share round: several catalog rows, all pre-selected;
 * - link analysis: rows prefilled from the analysis result
 *   (`initialAmounts` / `initialTotal` carry the suggested amounts);
 * - blank / inventory mode: no rows - the form starts with one empty
 *   off-catalog row whose title the user types in.
 *
 * Submitting always goes to the bundle endpoint
 * (POST /items/purchases/bundles, PATCH .../:id when editing an
 * existing bundle). There is no second registration path in the web
 * app any more; the legacy single-item endpoint is only kept
 * server-side for receipt uploads and delegates to the same service.
 */

export type PurchaseRegistrationItem = {
  /** Catalog item id. Omit (or null) for an off-catalog buy. */
  itemId?: string | null;
  title: string;
  imageUrl?: string | null;
  platform?: string | null;
  sourceUrl?: string | null;
  /** Prefilled actual paid amount for this row. */
  amountYen?: number | null;
  /** Prefilled quantity (the override that will be submitted). */
  quantity?: number | null;
  /** Recognised quantity estimate, shown as a hint next to the field. */
  quantityEst?: number | null;
};

export type PurchaseRegistrationBundlePurchase = {
  itemId: string;
  purchaseAmount: number;
  amountAllocated?: boolean;
  quantityOverride?: number | null;
};

export type PurchaseRegistrationBundle = {
  id: string;
  pricingMode: "per_item" | "bundle_total";
  totalPurchaseAmount: number;
  purchasedAt: string;
  note?: string | null;
  version: number;
  purchases: PurchaseRegistrationBundlePurchase[];
};

export type PurchaseRegistrationSavedBundle = {
  id: string;
  purchases: { itemId: string }[];
  [key: string]: unknown;
};

type Row = PurchaseRegistrationItem & { key: string };

export type PurchaseRegistrationFormProps = {
  apiBaseUrl: string;
  /** Active manager account id; sent as the registration actor so the
   * purchase (and the bought decision it records) is attributed. */
  accountId?: string;
  /** JPY→CNY rate for the embedded cost estimate, when the caller has it. */
  exchangeRate?: number;
  /** Prefilled, pre-selected rows. Empty array = blank mode. */
  items: PurchaseRegistrationItem[];
  /** Selectable pool; prefilled rows plus extra candidates. */
  candidateItems?: PurchaseRegistrationItem[];
  /** Set when editing an existing bundle instead of registering anew. */
  bundle?: PurchaseRegistrationBundle | null;
  initialTotal?: number;
  /** Suggested per-item amounts, keyed by catalog item id. */
  initialAmounts?: Record<string, number>;
  /** Bundle-level source/platform label (mainly off-catalog buys). */
  platform?: string;
  onClose: () => void;
  onSaved: (bundle: PurchaseRegistrationSavedBundle) => void;
};

function CloseGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

let blankRowSequence = 0;

export function PurchaseRegistrationForm({
  apiBaseUrl,
  accountId,
  exchangeRate,
  items,
  candidateItems,
  bundle,
  initialTotal,
  initialAmounts,
  platform,
  onClose,
  onSaved,
}: PurchaseRegistrationFormProps) {
  const presentationRef = useRef<HTMLElement>(null);
  const savingRef = useRef(false);
  const pointerInputRef = useRef(false);
  const reduceMotion = useReducedMotion();
  useTransactionPresentation(presentationRef);
  const editing = Boolean(bundle);

  const initialRows = useMemo<Row[]>(() => {
    const pool = candidateItems?.length ? candidateItems : items;
    const seen = new Set<string>();
    const rows: Row[] = [];
    for (const entry of pool) {
      const key = entry.itemId ?? `off-${rows.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ ...entry, key });
    }
    return rows;
    // Prefill is fixed at open time, like the dialogs this replaces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [rows, setRows] = useState<Row[]>(() =>
    initialRows.length
      ? initialRows
      : [
          {
            key: `off-blank-${++blankRowSequence}`,
            title: "",
            quantity: 1,
          },
        ],
  );
  const [selectedKeys, setSelectedKeys] = useState<string[]>(() =>
    items.length
      ? items
          .map(
            (entry, index) => entry.itemId ?? `off-${index}`,
          )
          .filter((key) =>
            initialRows.some((row) => row.key === key),
          )
      : rows.map((row) => row.key),
  );
  const selectedRows = rows.filter((row) => selectedKeys.includes(row.key));

  const purchaseFor = (row: Row) =>
    row.itemId
      ? bundle?.purchases.find((entry) => entry.itemId === row.itemId)
      : undefined;

  const [pricingMode, setPricingMode] = useState<"per_item" | "bundle_total">(
    bundle?.pricingMode ?? (items.length > 1 ? "bundle_total" : "per_item"),
  );
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialRows.map((row) => {
        const purchase = purchaseFor(row);
        const value =
          purchase?.amountAllocated === false
            ? ((row.itemId ? initialAmounts?.[row.itemId] : undefined) ??
              row.amountYen ??
              0)
            : (purchase?.purchaseAmount ??
              (row.itemId ? initialAmounts?.[row.itemId] : undefined) ??
              row.amountYen ??
              0);
        return [row.key, String(value)];
      }),
    ),
  );
  // Quantities always submit: the field starts at the current effective
  // count (recorded override, else the recognised estimate), so an
  // untouched field simply re-confirms that count as the override.
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialRows.map((row) => [
        row.key,
        String(
          purchaseFor(row)?.quantityOverride ??
            row.quantity ??
            row.quantityEst ??
            1,
        ),
      ]),
    ),
  );
  const [total, setTotal] = useState(
    String(
      bundle?.totalPurchaseAmount ??
        initialTotal ??
        items.reduce((sum, item) => sum + (item.amountYen ?? 0), 0),
    ),
  );
  const [purchasedAt, setPurchasedAt] = useState(
    (bundle?.purchasedAt ?? new Date().toISOString()).slice(0, 10),
  );
  const [note, setNote] = useState(bundle?.note ?? "");
  const [sourceLabel, setSourceLabel] = useState(platform ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, saving]);

  function updateRow(key: string, patch: Partial<PurchaseRegistrationItem>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function addBlankRow() {
    const key = `off-blank-${++blankRowSequence}`;
    setRows((current) => [...current, { key, title: "", quantity: 1 }]);
    setSelectedKeys((current) => [...current, key]);
    setQuantities((current) => ({ ...current, [key]: "1" }));
    setAmounts((current) => ({ ...current, [key]: "0" }));
  }

  function removeRow(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
    setSelectedKeys((current) => current.filter((entry) => entry !== key));
  }

  async function submit() {
    if (savingRef.current) return;
    if (!selectedRows.length) {
      setMessage("至少选择一个商品");
      return;
    }
    for (const row of selectedRows) {
      if (!row.itemId && !row.title.trim()) {
        setMessage("站外购买的商品需要填写名称");
        return;
      }
    }
    const members = selectedRows.map((row) => ({
      ...(row.itemId
        ? { itemId: row.itemId }
        : {
            title: row.title.trim(),
            ...(row.platform?.trim() || sourceLabel.trim()
              ? { platform: row.platform?.trim() || sourceLabel.trim() }
              : {}),
            ...(row.imageUrl?.trim() ? { imageUrl: row.imageUrl.trim() } : {}),
            ...(row.sourceUrl?.trim()
              ? { sourceUrl: row.sourceUrl.trim() }
              : {}),
          }),
      quantity: Number(quantities[row.key] ?? row.quantity ?? 1),
      ...(pricingMode === "per_item"
        ? { amountYen: Number(amounts[row.key] ?? row.amountYen ?? 0) }
        : {}),
    }));
    if (
      members.some(
        (member) => !Number.isInteger(member.quantity) || member.quantity < 1,
      )
    ) {
      setMessage("请填写每件商品的有效数量（至少 1）");
      return;
    }
    if (
      pricingMode === "per_item" &&
      members.some(
        (member) =>
          !Number.isFinite(member.amountYen) || (member.amountYen ?? 0) < 0,
      )
    ) {
      setMessage("请填写每件商品的购买金额");
      return;
    }
    const totalValue =
      pricingMode === "bundle_total"
        ? Number(total)
        : members.reduce((sum, member) => sum + (member.amountYen ?? 0), 0);
    if (!Number.isFinite(totalValue) || totalValue < 0) {
      setMessage(
        selectedRows.length > 1 ? "请填写打包价格" : "请填写购买金额",
      );
      return;
    }
    if (editing && !reason.trim()) {
      setMessage("修改价格或成员时需要填写变更原因");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/items/purchases/bundles${bundle ? `/${bundle.id}` : ""}`,
        {
          method: bundle ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...(bundle ? { expectedVersion: bundle.version } : {}),
            pricingMode,
            members,
            totalPurchaseAmountYen: totalValue,
            purchasedAt: new Date(
              `${purchasedAt}T12:00:00+09:00`,
            ).toISOString(),
            note: note.trim() || null,
            ...(sourceLabel.trim() ? { platform: sourceLabel.trim() } : {}),
            actor: accountId || "shared-user",
            reason:
              reason.trim() ||
              (selectedRows.length > 1
                ? "将多个商品登记为同一购买包"
                : "通过购买链接登记商品"),
          }),
        },
      );
      const result = await response
        .json()
        .catch(() => ({ message: `API ${response.status}` }));
      if (!response.ok)
        throw new Error(
          Array.isArray(result.message)
            ? result.message.join("；")
            : (result.message ?? "保存购买记录失败"),
        );
      onSaved(result.bundle as PurchaseRegistrationSavedBundle);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存购买记录失败");
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  const hasCatalogRows = rows.some((row) => row.itemId);
  const title = editing
    ? "编辑购买包"
    : selectedRows.length > 1
      ? `${TERMS.registerPurchase} · ${selectedRows.length} 件`
      : TERMS.registerPurchase;

  return createPortal(
    <div
      className="modal-backdrop absolute inset-0 z-[88] grid place-items-center overflow-y-auto bg-ink/50 p-3 sm:p-6"
      onMouseDown={saving ? undefined : onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-registration-title"
        ref={presentationRef}
        aria-busy={saving}
        data-submit-state={message ? "error" : saving ? "saving" : "idle"}
        onPointerDownCapture={() => {
          pointerInputRef.current = true;
        }}
        onKeyDownCapture={() => {
          pointerInputRef.current = false;
        }}
        className={`modal-panel ${transactionStyles.dialog} max-h-[88dvh] w-full max-w-xl overflow-y-auto rounded-3xl bg-paper p-4 shadow-modal`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="purchase-registration-title"
              className="font-heading text-xl font-bold text-ink"
            >
              {title}
            </h2>
            <p className="mt-1 text-xs text-ink/50">
              {editing ? `版本 ${bundle?.version}` : "保存后进入库存订单"}
            </p>
            {rows.length > 1 && (
              <p className="mt-2 text-xs font-semibold text-ink/55">
                {editing
                  ? `已选 ${selectedRows.length} / 候选 ${rows.length}，可勾选增删成员`
                  : `已选 ${selectedRows.length} 件，可勾选要登记的商品`}
              </p>
            )}
          </div>
          <button
            type="button"
            autoFocus
            disabled={saving}
            onClick={onClose}
            aria-label="关闭登记购买"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-ink shadow-sm disabled:opacity-45"
          >
            <CloseGlyph />
          </button>
        </div>

        {rows.length > 1 && (
          <div
            className="ios-segment mt-4 grid grid-cols-2 rounded-xl p-1"
            aria-label="购买计价方式"
          >
            <button
              type="button"
              aria-pressed={pricingMode === "bundle_total"}
              onClick={() => setPricingMode("bundle_total")}
              className="relative isolate min-h-11 rounded-lg px-3 text-xs font-semibold"
            >
              {pricingMode === "bundle_total" && (
                <motion.span
                  data-apple-motion-owned
                  tabIndex={-1}
                  aria-hidden="true"
                  className={transactionStyles.pricingSelection}
                  layoutId="purchase-pricing-selection"
                  transition={
                    reduceMotion || !pointerInputRef.current
                      ? { duration: 0 }
                      : springs.appleSelection
                  }
                />
              )}
              打包总价
            </button>
            <button
              type="button"
              aria-pressed={pricingMode === "per_item"}
              onClick={() => setPricingMode("per_item")}
              className="relative isolate min-h-11 rounded-lg px-3 text-xs font-semibold"
            >
              {pricingMode === "per_item" && (
                <motion.span
                  data-apple-motion-owned
                  tabIndex={-1}
                  aria-hidden="true"
                  className={transactionStyles.pricingSelection}
                  layoutId="purchase-pricing-selection"
                  transition={
                    reduceMotion || !pointerInputRef.current
                      ? { duration: 0 }
                      : springs.appleSelection
                  }
                />
              )}
              分别计价
            </button>
          </div>
        )}

        <div className="mt-3 grid gap-2">
          {rows.map((row) => {
            const selected = selectedKeys.includes(row.key);
            const offCatalog = !row.itemId;
            return (
              <div
                key={row.key}
                className={`grid grid-cols-[44px_48px_minmax(0,1fr)] items-center gap-2 rounded-2xl p-2 shadow-sm ${selected ? "bg-white" : "bg-fog/40 opacity-60"}`}
              >
                <label className="grid h-11 w-11 place-items-center">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() =>
                      setSelectedKeys((current) =>
                        selected
                          ? current.filter((key) => key !== row.key)
                          : [...current, row.key],
                      )
                    }
                    aria-label={`选择商品 ${row.title || "站外商品"}`}
                    className="h-5 w-5 accent-moss"
                  />
                </label>
                <div className="h-12 w-12 overflow-hidden rounded-xl bg-fog">
                  {row.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={row.imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    {offCatalog ? (
                      <input
                        value={row.title}
                        onChange={(event) =>
                          updateRow(row.key, { title: event.target.value })
                        }
                        placeholder="商品名称"
                        aria-label="站外商品名称"
                        data-testid="purchase-registration-offcatalog-title"
                        className="min-h-11 min-w-0 flex-1 rounded-xl border border-ink/10 bg-fog/50 px-3 text-sm text-ink"
                      />
                    ) : (
                      <p className="line-clamp-2 text-xs font-semibold leading-5 text-ink">
                        {row.title}
                      </p>
                    )}
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${selected ? "bg-moss/10 text-moss" : "bg-fog text-ink/45"}`}
                    >
                      {selected ? "已选" : editing ? "候选" : "待选"}
                    </span>
                  </div>
                  {offCatalog && selected && (
                    <label className="mt-1 flex items-center gap-2 text-[11px] text-ink/50">
                      平台
                      <input
                        value={row.platform ?? ""}
                        onChange={(event) =>
                          updateRow(row.key, { platform: event.target.value })
                        }
                        placeholder="Mercari / 闲鱼…"
                        aria-label="站外商品平台"
                        className="min-h-11 min-w-0 flex-1 rounded-xl border border-ink/10 bg-fog/50 px-3 text-sm text-ink"
                      />
                    </label>
                  )}
                  {selected && pricingMode === "per_item" && (
                    <label className="mt-1 flex items-center gap-2 text-[11px] text-ink/50">
                      实付金额
                      <input
                        type="number"
                        min="0"
                        value={amounts[row.key] ?? ""}
                        onChange={(event) =>
                          setAmounts((current) => ({
                            ...current,
                            [row.key]: event.target.value,
                          }))
                        }
                        aria-label={`实付金额 ${row.title || "站外商品"}`}
                        data-testid="purchase-registration-amount"
                        className="min-h-11 min-w-0 flex-1 rounded-xl border border-ink/10 bg-fog/50 px-3 font-mono text-sm text-ink"
                      />
                    </label>
                  )}
                  {selected && (
                    <label className="mt-1 flex items-center gap-2 text-[11px] text-ink/50">
                      数量
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={quantities[row.key] ?? ""}
                        onChange={(event) =>
                          setQuantities((current) => ({
                            ...current,
                            [row.key]: event.target.value,
                          }))
                        }
                        aria-label={`商品数量 ${row.title || "站外商品"}`}
                        className="min-h-11 w-24 rounded-xl border border-ink/10 bg-fog/50 px-3 font-mono text-sm text-ink"
                      />
                      {row.quantityEst != null && (
                        <span className="text-[10px] text-ink/40">
                          识别 {row.quantityEst} 件，可改
                        </span>
                      )}
                    </label>
                  )}
                  {offCatalog && !editing && (
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      className="mt-1 min-h-11 text-[11px] font-semibold text-rust"
                    >
                      移除这一件
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {!hasCatalogRows && (
          <button
            type="button"
            onClick={addBlankRow}
            className="mt-2 min-h-11 rounded-xl bg-white px-3 text-xs font-semibold text-moss shadow-sm"
          >
            添加一件站外商品
          </button>
        )}
        {editing && rows.length > selectedRows.length && (
          <p className="mt-2 text-xs text-ink/45">
            未选中的候选成员会保留在列表里，方便后续补录。
          </p>
        )}

        {pricingMode === "bundle_total" && (
          <label className="mt-3 grid gap-1 text-xs font-semibold text-ink/55">
            打包价格
            <input
              type="number"
              min="0"
              value={total}
              onChange={(event) => setTotal(event.target.value)}
              className="min-h-12 rounded-xl border border-ink/10 bg-white px-3 font-mono text-base font-bold text-ink"
            />
          </label>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-ink/55">
            购买日期
            <input
              type="date"
              value={purchasedAt}
              onChange={(event) => setPurchasedAt(event.target.value)}
              className="min-h-11 rounded-xl border border-ink/10 bg-white px-3 text-sm text-ink"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-ink/55">
            来源 / 平台
            <input
              value={sourceLabel}
              maxLength={80}
              onChange={(event) => setSourceLabel(event.target.value)}
              placeholder="例如 Mercari"
              className="min-h-11 rounded-xl border border-ink/10 bg-white px-3 text-sm text-ink"
            />
          </label>
        </div>
        <label className="mt-3 grid gap-1 text-xs font-semibold text-ink/55">
          备注
          <input
            value={note}
            maxLength={1000}
            onChange={(event) => setNote(event.target.value)}
            placeholder="例如：含国际转运费"
            className="min-h-11 rounded-xl border border-ink/10 bg-white px-3 text-sm text-ink"
          />
        </label>
        {/* Live cost sanity check on the amounts being registered: the
            same estimate panel the detail drawer shows, fed with the
            form's current total and quantity. */}
        <CostEstimatePanel
          priceYen={
            pricingMode === "bundle_total"
              ? Number(total) || 0
              : selectedRows.reduce(
                  (sum, row) =>
                    sum + (Number(amounts[row.key] ?? row.amountYen ?? 0) || 0),
                  0,
                )
          }
          quantity={selectedRows.reduce(
            (sum, row) =>
              sum + (Number(quantities[row.key] ?? row.quantity ?? 1) || 0),
            0,
          )}
          exchangeRate={exchangeRate}
        />
        {editing && (
          <label className="mt-3 grid gap-1 text-xs font-semibold text-ink/55">
            变更原因
            <input
              value={reason}
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例如：补录实际付款金额"
              className="min-h-11 rounded-xl border border-ink/10 bg-white px-3 text-sm text-ink"
            />
          </label>
        )}
        {message && (
          <p
            role="alert"
            className={`${transactionStyles.error} mt-3 text-xs font-semibold text-rust`}
          >
            {message}
          </p>
        )}
        <button
          type="button"
          disabled={saving}
          onClick={() => void submit()}
          className={`${transactionStyles.submit} mt-4 min-h-12 w-full rounded-xl bg-moss px-4 text-sm font-bold text-white disabled:opacity-45`}
        >
          {saving ? "保存中…" : editing ? "保存并记录历史" : "确认登记"}
        </button>
      </section>
    </div>,
    getShellOverlayRoot(),
  );
}
