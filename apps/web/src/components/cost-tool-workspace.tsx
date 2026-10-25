"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { motionTokens, springs } from "../lib/motion-tokens";
import { displayListingTitle } from "../lib/listing-title";
import { TERMS } from "../lib/terms";
import type { CostToolSegment } from "../lib/workspace-navigation";
import styles from "./operations-editorial.module.css";
import {
  calculateQuote,
  cents,
  customerQuoteText,
  DEFAULT_FEE_PERCENT,
  DEFAULT_SHIPPING_PER_UNIT_CNY,
  DEFAULT_TARGET_PROFIT_PER_UNIT_CNY,
  inputNumber,
  internalEarnings,
  procurementCeiling,
} from "../lib/procurement-calculator";

type Draft = Record<
  | "quantity"
  | "market"
  | "domestic"
  | "exchange"
  | "fee"
  | "shipping"
  | "target"
  | "actualMarket"
  | "actualShipping",
  string
>;
const blankDraft: Draft = {
  quantity: "",
  market: "",
  domestic: "",
  exchange: "",
  fee: String(DEFAULT_FEE_PERCENT),
  shipping: String(DEFAULT_SHIPPING_PER_UNIT_CNY),
  target: String(DEFAULT_TARGET_PROFIT_PER_UNIT_CNY),
  actualMarket: "",
  actualShipping: "",
};
const fmt = (n: number | null | undefined) =>
  n == null
    ? "待填写"
    : n.toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

function NumberField({
  name,
  label,
  unit,
  draft,
  onChange,
  min = 0,
  max = 1_000_000_000,
  integer = false,
}: {
  name: keyof Draft;
  label: string;
  unit: string;
  draft: Draft;
  onChange: (key: keyof Draft, value: string) => void;
  min?: number;
  max?: number;
  integer?: boolean;
}) {
  const invalid =
    !!draft[name] && inputNumber(draft[name], min, max, integer) === null;
  return (
    <label className="procurement-calc-field">
      <span>{label}</span>
      <span className="procurement-calc-input">
        <input
          aria-label={label}
          type="number"
          inputMode={integer ? "numeric" : "decimal"}
          min={min}
          max={max}
          step={integer ? "1" : "any"}
          value={draft[name]}
          onChange={(event) => onChange(name, event.target.value)}
          placeholder="填写数值"
          aria-invalid={invalid}
        />
        <small>{unit}</small>
      </span>
      {invalid && (
        <small className="procurement-calc-invalid">
          {integer ? "请输入范围内的正整数" : `请输入 ${min} 至 ${max} 的数值`}
        </small>
      )}
    </label>
  );
}

function MoneyRow({
  label,
  value,
  unit = "元",
}: {
  label: string;
  value: number | null | undefined;
  unit?: string;
}) {
  return (
    <div className="procurement-calc-row">
      <dt>{label}</dt>
      <dd>
        {fmt(value)}
        {value != null && <small>{unit}</small>}
      </dd>
    </div>
  );
}

export function ProcurementCalculatorWorkspace({
  exchangeRate,
  managerId,
}: {
  exchangeRate?: number;
  managerId: string;
}) {
  const reducedMotion = useReducedMotion();
  const [keyboardMotion, setKeyboardMotion] = useState(false);
  const instantMotion = reducedMotion || keyboardMotion;
  const customerTabRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [mode, setMode] = useState<"customer" | "internal">("customer");
  const [hydrated, setHydrated] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const [copyFallback, setCopyFallback] = useState("");
  const storageKey = `kamen-procurement-calculator-v1:${managerId}`;
  useEffect(() => {
    let next = { ...blankDraft };
    try {
      const stored: unknown = JSON.parse(
        sessionStorage.getItem(storageKey) ?? "null",
      );
      if (stored && typeof stored === "object")
        for (const key of Object.keys(next) as (keyof Draft)[]) {
          const value = (stored as Record<string, unknown>)[key];
          if (typeof value === "string" && value.length <= 32)
            next[key] = value;
        }
    } catch {
      /* A disabled session store still permits local calculation. */
    }
    if (!next.exchange && exchangeRate && exchangeRate > 0)
      next.exchange = String(Number((exchangeRate * 100).toFixed(6)));
    setDraft(next);
    setHydrated(true);
    // Rates only prefill once. A user-entered rate must never move mid-quote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {
    if (hydrated)
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(draft));
      } catch {
        /* Keep the calculator usable without storage. */
      }
  }, [draft, hydrated, storageKey]);
  useEffect(() => {
    if (!hydrated || !exchangeRate || exchangeRate <= 0) return;
    setDraft((current) =>
      current.exchange
        ? current
        : {
            ...current,
            exchange: String(Number((exchangeRate * 100).toFixed(6))),
          },
    );
  }, [exchangeRate, hydrated]);

  const quantity = inputNumber(draft.quantity, 1, 1_000_000, true);
  const exchange = inputNumber(draft.exchange, 0.000001, 1_000_000);
  const market = inputNumber(draft.market);
  const domestic = inputNumber(draft.domestic);
  const fee = inputNumber(draft.fee, 0, 100);
  const shipping = inputNumber(draft.shipping, 0, 1_000_000);
  const target = inputNumber(draft.target);
  const base =
    quantity !== null && exchange !== null && fee !== null && shipping !== null
      ? {
          quantity,
          exchangePer100: exchange,
          feePercent: fee,
          shippingPerUnit: shipping,
        }
      : null;
  const input = base && market !== null ? { ...base, marketYen: market } : null;
  const quote = input && calculateQuote(input);
  const ceiling =
    base && domestic !== null && target !== null
      ? procurementCeiling({
          ...base,
          domesticCny: domestic,
          unitProfit: target,
        })
      : null;
  const customerProfit =
    quote && domestic !== null ? cents(domestic - quote.receivable) : null;
  const actualMarket = inputNumber(draft.actualMarket);
  const actualShipping = inputNumber(draft.actualShipping);
  const internal =
    quote &&
    exchange !== null &&
    actualMarket !== null &&
    actualShipping !== null
      ? internalEarnings(quote, exchange, actualMarket, actualShipping)
      : null;
  const update = (key: keyof Draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setCopyMessage("");
    setCopyFallback("");
  };
  const field = (
    name: keyof Draft,
    label: string,
    unit: string,
    limits = {},
  ) => (
    <NumberField
      name={name}
      label={label}
      unit={unit}
      draft={draft}
      onChange={update}
      {...limits}
    />
  );
  async function copyQuote() {
    if (!input || !quote) return;
    const text = customerQuoteText(input, quote, domestic);
    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage("客户报价已复制");
    } catch {
      setCopyFallback(text);
      setCopyMessage("请长按或全选下方报价复制");
    }
  }
  return (
    <section
      className={`procurement-calculator ${styles.workspace} ${styles.calculator}`}
      aria-labelledby="procurement-calculator-title"
      data-keyboard-motion={keyboardMotion ? "true" : "false"}
      onPointerDownCapture={() => setKeyboardMotion(false)}
      onKeyDownCapture={() => setKeyboardMotion(true)}
    >
      <header className={`procurement-calc-heading ${styles.heading}`}>
        <div>
          <h2 id="procurement-calculator-title">进货计算器</h2>
        </div>
        <details className="procurement-calc-help">
          <summary aria-label="查看计算公式">ⓘ</summary>
          <div>
            <p>客户应付 = 商品报价 × 汇率 + 采购费 + 运税。</p>
            <p>客户预计利润 = 国内整批售价 − 客户应付。</p>
            <p>内部实际收益 = 客户应付 − 实际商品成本 − 实际运税。</p>
            <p>
              默认运税按每4件1公斤、100元/公斤折算为25元/件。目标利润只用于倒推采购上限，不额外计入应付。
            </p>
            <p>
              按填写数据测算，不构成成交或收益保证。对内视图不是密码保护；不要把管理工作区链接提供给客户。
            </p>
          </div>
        </details>
      </header>
      <div className="procurement-calc-tabs" role="group" aria-label="核算视图">
        <button
          ref={customerTabRef}
          type="button"
          aria-pressed={mode === "customer"}
          onClick={() => {
            setMode("customer");
            setCopyFallback("");
          }}
        >
          {mode === "customer" && (
            <motion.span
              className={styles.tabIndicator}
              layoutId="calculator-mode-indicator"
              transition={
                instantMotion ? { duration: 0 } : springs.appleSelection
              }
              aria-hidden="true"
            />
          )}
          <span className={styles.tabLabel}>对外 · 客户报价</span>
        </button>
        <button
          type="button"
          aria-pressed={mode === "internal"}
          onClick={() => {
            setMode("internal");
            setCopyFallback("");
          }}
        >
          {mode === "internal" && (
            <motion.span
              className={styles.tabIndicator}
              layoutId="calculator-mode-indicator"
              transition={
                instantMotion ? { duration: 0 } : springs.appleSelection
              }
              aria-hidden="true"
            />
          )}
          <span className={styles.tabLabel}>对内 · 实际收益</span>
        </button>
      </div>
      <motion.div
        className="procurement-calc-layout"
        key={mode}
        initial={
          instantMotion
            ? false
            : { opacity: 0.6, transform: "translateY(12px) scale(0.985)" }
        }
        animate={{ opacity: 1, transform: "translateY(0) scale(1)" }}
        transition={instantMotion ? { duration: 0 } : springs.appleSpatial}
      >
        <div className="procurement-calc-editor">
          {mode === "customer" ? (
            <>
              <section className="procurement-calc-group">
                <h3>商品与售价</h3>
                <div className="procurement-calc-fields">
                  {field("quantity", "商品数量", "件", {
                    min: 1,
                    max: 1_000_000,
                    integer: true,
                  })}
                  {field("market", "日本整批商品报价", "日元 / 批")}
                  {field("domestic", "预计国内整批售价", "元 / 批")}
                  {field("exchange", "换算汇率", "元 / 100日元", {
                    min: 0.000001,
                    max: 1_000_000,
                  })}
                </div>
                {exchangeRate && exchangeRate > 0 ? (
                  <button
                    type="button"
                    className="procurement-calc-rate"
                    onClick={() =>
                      update(
                        "exchange",
                        String(Number((exchangeRate * 100).toFixed(6))),
                      )
                    }
                  >
                    使用系统汇率 · 100日元 = {(exchangeRate * 100).toFixed(4)}元
                  </button>
                ) : (
                  <p className="procurement-calc-caption">
                    系统汇率未就绪，可手动填写。
                  </p>
                )}
              </section>
              <section className="procurement-calc-group">
                <h3>报价参数</h3>
                <div className="procurement-calc-fields">
                  {field("fee", "采购费率", "%", { max: 100 })}
                  {field("shipping", "单件运税", "元 / 件", { max: 1_000_000 })}
                  {field("target", "客户单件目标利润", "元 / 件")}
                </div>
              </section>
            </>
          ) : (
            <>
              <section className="procurement-calc-group">
                <h3>实际支付成本</h3>
                <div className="procurement-calc-fields">
                  {field("actualMarket", "实际整批采购价", "日元 / 批")}
                  {field("actualShipping", "实际整批运税", "元 / 批")}
                </div>
                <p className="procurement-calc-caption">
                  只影响内部核算，不改变客户报价。
                </p>
              </section>
              <section className="procurement-calc-group">
                <h3>客户报价同步</h3>
                <dl>
                  <MoneyRow label="商品报价" value={quote?.marketCny} />
                  <MoneyRow label="采购费" value={quote?.fee} />
                  <MoneyRow label="运税" value={quote?.shipping} />
                  <MoneyRow label="客户应付" value={quote?.receivable} />
                </dl>
                <button
                  type="button"
                  className="procurement-calc-rate"
                  onClick={() => {
                    setMode("customer");
                    customerTabRef.current?.focus({ preventScroll: true });
                  }}
                >
                  修改对外报价
                </button>
              </section>
            </>
          )}
        </div>
        <aside
          className="procurement-calc-summary"
          aria-label={mode === "customer" ? "客户报价结果" : "内部收益结果"}
        >
          <section
            className="procurement-calc-result"
            data-loss={
              mode === "internal" && internal && internal.profit < 0
                ? "true"
                : "false"
            }
          >
            <h3>{mode === "customer" ? "客户应付合计" : "内部实际收益"}</h3>
            <output data-testid="calculator-primary-result">
              {fmt(mode === "customer" ? quote?.receivable : internal?.profit)}
              <small>人民币 / 批</small>
            </output>
            <p>
              {quantity
                ? `共 ${quantity.toLocaleString("zh-CN")} 件 · 单件 ${fmt(mode === "customer" ? quote?.perUnit : internal ? cents(internal.profit / quantity) : null)} 元`
                : "填写数量、汇率及价格后计算"}
            </p>
            <dl>
              {mode === "customer" ? (
                <>
                  <MoneyRow label="商品折合人民币" value={quote?.marketCny} />
                  <MoneyRow label="国际运税" value={quote?.shipping} />
                  <MoneyRow label="采购费" value={quote?.fee} />
                  <MoneyRow label="客户预计转售利润" value={customerProfit} />
                  <MoneyRow
                    label="客户单件预计利润"
                    value={
                      customerProfit !== null && quantity
                        ? cents(customerProfit / quantity)
                        : null
                    }
                  />
                </>
              ) : (
                <>
                  <MoneyRow
                    label="实际商品成本"
                    value={internal?.purchaseCny}
                  />
                  <MoneyRow label="实际成本合计" value={internal?.cost} />
                  <MoneyRow label="采购费收入" value={quote?.fee} />
                  <MoneyRow
                    label="商品价差"
                    value={internal?.purchaseDifference}
                  />
                  <MoneyRow
                    label="运税差额"
                    value={internal?.shippingDifference}
                  />
                </>
              )}
            </dl>
            {mode === "customer" && (
              <button
                type="button"
                className="procurement-calc-copy"
                data-copied={
                  copyMessage === "客户报价已复制" ? "true" : "false"
                }
                disabled={!quote || !input}
                onClick={() => void copyQuote()}
              >
                复制客户报价
              </button>
            )}
            <motion.p
              role="status"
              className="procurement-calc-caption"
              key={copyMessage}
              initial={instantMotion || !copyMessage ? false : { opacity: 0.6 }}
              animate={{ opacity: 1 }}
              transition={{
                duration: instantMotion ? 0 : motionTokens.duration.feedback,
              }}
            >
              {copyMessage}
            </motion.p>
            {!!copyFallback && (
              <textarea
                aria-label="客户报价文本"
                readOnly
                rows={8}
                value={copyFallback}
                onFocus={(event) => event.target.select()}
              />
            )}
          </section>
          {mode === "customer" && (
            <section className="procurement-calc-ceiling">
              <h3>建议采购上限</h3>
              <output>
                {ceiling
                  ? ceiling.possible
                    ? `${ceiling.yen.toLocaleString("zh-CN")} 日元`
                    : "预算不足"
                  : "待填写售价与目标利润"}
              </output>
              <p>
                {ceiling?.possible
                  ? `整批约 ${fmt(ceiling.cny)} 元；报价不高于该金额时，满足填写的客户利润目标。`
                  : "按国内售价倒推，包含采购费与运税。"}
              </p>
              {ceiling?.possible && market !== null && market > ceiling.yen && (
                <p className="procurement-calc-invalid">
                  当前报价超过上限{" "}
                  {(market - ceiling.yen).toLocaleString("zh-CN")} 日元
                </p>
              )}
            </section>
          )}
        </aside>
      </motion.div>
    </section>
  );
}

type Logistics = {
  id?: string;
  weightGrams?: number | null;
  packageWeightGrams?: number | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  volumeCm3?: number | null;
  estimatedSalePriceYen?: number | null;
  notes?: string | null;
};

type LogisticsItem = {
  id: string;
  titleRaw: string;
  titleZh?: string | null;
  priceCurrent: number;
  shippingFee?: number | null;
  favorite: boolean;
  purchaseRecord?: { id: string; purchaseAmount: number } | null;
  source: { key: string; displayName: string };
  images?: { url: string }[];
  logistics?: Logistics | null;
};

type Carrier = {
  id: string;
  displayName: string;
  enabled: boolean;
};

type Plan = {
  shippingYen: number | null;
  itemCostYen: number;
  saleYen: number | null;
  profitYen: number | null;
};

type Props = { apiBaseUrl: string; exchangeRate?: number | null };

const yen = (value: number | null | undefined) =>
  value == null ? "暂无" : `¥${Math.round(value).toLocaleString("ja-JP")}`;

const cny = (value: number | null | undefined, rate?: number | null) =>
  value == null || !rate ? "" : `约人民币 ¥${(value * rate).toFixed(2)}`;

function Field({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number | string;
  onChange: (value: string) => void;
  suffix: string;
}) {
  return (
    <label className="logistics-field grid min-w-0 gap-1.5 text-xs font-semibold text-ink/55">
      <span>{label}</span>
      <span className="flex min-h-11 min-w-0 items-center rounded-xl border border-black/10 bg-white/70 px-3 focus-within:border-moss focus-within:ring-2 focus-within:ring-moss/10">
        <input
          aria-label={label}
          aria-description={suffix}
          type="number"
          min={0}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 min-w-0 flex-1 bg-transparent text-base font-semibold text-ink sm:text-sm"
        />
        <span className="ml-2 text-[11px] text-ink/35">{suffix}</span>
      </span>
    </label>
  );
}

export function LogisticsWorkspace({ apiBaseUrl, exchangeRate }: Props) {
  const reducedMotion = useReducedMotion();
  const [keyboardMotion, setKeyboardMotion] = useState(false);
  const instantMotion = reducedMotion || keyboardMotion;
  const animatedItems = useRef(new Set<string>());
  const [items, setItems] = useState<LogisticsItem[]>([]);
  useEffect(() => {
    items.forEach((item) => animatedItems.current.add(item.id));
  }, [items]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Logistics>>({});
  const [carrierId, setCarrierId] = useState("");
  const [shippingFeeYen, setShippingFeeYen] = useState("");
  const [best, setBest] = useState<Plan | null>(null);
  const [ai, setAi] = useState<{
    summaryZh?: string;
    recommendationZh?: string;
    cautionsZh?: string[];
    error?: string;
  } | null>(null);
  const [showAdjustments, setShowAdjustments] = useState(false);
  const [loading, setLoading] = useState(true);
  const [predictingIds, setPredictingIds] = useState<string[]>([]);
  const [optimizing, setOptimizing] = useState(false);
  const [message, setMessage] = useState("");
  const optimizingRef = useRef(false);
  const calculationRevision = useRef(0);
  const draftRevisions = useRef<Record<string, number>>({});
  const [saveStates, setSaveStates] = useState<Record<string, "saving" | "saved" | "dirty" | "error">>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [itemResponse, carrierResponse] = await Promise.all([
          fetch(`${apiBaseUrl}/logistics/items`, { cache: "no-store" }),
          fetch(`${apiBaseUrl}/logistics/carriers`, { cache: "no-store" }),
        ]);
        if (!itemResponse.ok || !carrierResponse.ok) {
          throw new Error("物流数据加载失败");
        }
        const itemPayload = (await itemResponse.json()) as {
          items: LogisticsItem[];
        };
        const carrierPayload = (await carrierResponse.json()) as {
          carriers: Carrier[];
        };
        if (cancelled) return;
        const enabledCarriers = carrierPayload.carriers.filter(
          (carrier) => carrier.enabled,
        );
        setItems(itemPayload.items);
        setCarriers(enabledCarriers);
        setCarrierId(enabledCarriers[0]?.id ?? "");
        setDrafts(
          Object.fromEntries(
            itemPayload.items.map((item) => [
              item.id,
              { ...(item.logistics ?? {}) },
            ]),
          ),
        );
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error ? error.message : "物流数据加载失败",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  const selected = useMemo(
    () => items.filter((item) => selectedIds.includes(item.id)),
    [items, selectedIds],
  );

  function updateDraft(id: string, key: keyof Logistics, value: string) {
    draftRevisions.current[id] = (draftRevisions.current[id] ?? 0) + 1;
    calculationRevision.current += 1;
    setSaveStates((current) => ({ ...current, [id]: "dirty" }));
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...current[id],
        [key]: value === "" ? undefined : Number(value),
      },
    }));
    setBest(null);
  }

  async function predictItem(item: LogisticsItem) {
    if (predictingIds.includes(item.id)) return;
    setPredictingIds((current) => [...current, item.id]);
    setMessage("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/logistics/items/${item.id}/predict`,
        { method: "POST" },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message || "AI 物流预估失败");
      }
      const payload = (await response.json()) as { logistics: Logistics };
      draftRevisions.current[item.id] = (draftRevisions.current[item.id] ?? 0) + 1;
      calculationRevision.current += 1;
      setDrafts((current) => ({
        ...current,
        [item.id]: payload.logistics,
      }));
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, logistics: payload.logistics }
            : entry,
        ),
      );
      setShowAdjustments(true);
      setBest(null);
      setMessage("AI 已预填重量、尺寸和预估售价，可直接修正");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI 物流预估失败");
    } finally {
      setPredictingIds((current) => current.filter((id) => id !== item.id));
    }
  }

  function toggleItem(item: LogisticsItem) {
    calculationRevision.current += 1;
    const selectedNow = selectedIds.includes(item.id);
    setSelectedIds((current) =>
      selectedNow
        ? current.filter((id) => id !== item.id)
        : current.length >= 12
          ? current
          : [...current, item.id],
    );
    setBest(null);
    if (!selectedNow && !item.logistics) void predictItem(item);
  }

  async function saveItem(item: LogisticsItem) {
    const revision = draftRevisions.current[item.id] ?? 0;
    setSaveStates((current) => ({ ...current, [item.id]: "saving" }));
    try {
      const response = await fetch(`${apiBaseUrl}/logistics/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(drafts[item.id] ?? {}),
      });
      if (!response.ok) throw new Error("物流参数保存失败");
      setSaveStates((current) => ({ ...current, [item.id]: revision === (draftRevisions.current[item.id] ?? 0) ? "saved" : "dirty" }));
    } catch (reason) {
      setSaveStates((current) => ({ ...current, [item.id]: revision === (draftRevisions.current[item.id] ?? 0) ? "error" : "dirty" }));
      throw reason;
    }
  }

  async function calculate(withAi = false) {
    if (optimizingRef.current) return;
    if (!selectedIds.length) {
      setMessage("请先选择收藏或已购买商品");
      return;
    }
    if (!carrierId || shippingFeeYen === "") {
      setMessage("请选择快递公司并填写实际快递费");
      return;
    }
    optimizingRef.current = true;
    const revision = calculationRevision.current;
    setOptimizing(true);
    setMessage("");
    setAi(null);
    try {
      await Promise.all(selected.map(saveItem));
      const response = await fetch(`${apiBaseUrl}/logistics/optimize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemIds: selectedIds,
          carrierId,
          shippingFeeYen: Number(shippingFeeYen),
          withAi,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message || "利润计算失败");
      }
      const payload = (await response.json()) as {
        best: Plan;
        ai: typeof ai;
      };
      if (revision !== calculationRevision.current) {
        setMessage("参数已修改，请重新计算");
        return;
      }
      setBest(payload.best);
      setAi(payload.ai);
      setMessage("利润结果已按实际快递费更新");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "利润计算失败");
    } finally {
      optimizingRef.current = false;
      setOptimizing(false);
    }
  }

  return (
    <section
      className={`logistics-workspace mx-auto max-w-6xl pb-28 ${styles.workspace} ${styles.logistics}`}
      aria-labelledby="logistics-title"
      data-keyboard-motion={keyboardMotion ? "true" : "false"}
      onPointerDownCapture={() => setKeyboardMotion(false)}
      onKeyDownCapture={() => setKeyboardMotion(true)}
    >
      <header className={styles.heading}>
        <div>
          <h2 id="logistics-title" className={styles.pageTitle}>
            利润与物流
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/55">
            {items.length} 件收藏与已购商品 · 按实际快递费核算
          </p>
        </div>
        {message && (
          <p
            className="mt-3 text-sm font-semibold text-blue-800"
            aria-live="polite"
          >
            {message}
          </p>
        )}
      </header>

      <div className={styles.logisticsLayout}>
        <section className={styles.catalogue}>
          <div className={styles.sectionHeading}>
            <h3 className="text-base font-bold text-ink">选择商品</h3>
            <span className="text-xs text-ink/45">
              已选 {selectedIds.length}/12
            </span>
          </div>
          <div className={styles.logisticsList}>
            {loading ? (
              <p className="p-8 text-center text-sm text-ink/45 sm:col-span-2">
                加载中…
              </p>
            ) : items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/10 p-8 text-center sm:col-span-2">
                <p className="text-sm font-semibold text-ink">暂无可计算商品</p>
                <p className="mt-1 text-xs leading-5 text-ink/45">
                  这里只显示已收藏或已购买的线上商品。
                </p>
              </div>
            ) : (
              items.map((item, index) => {
                const checked = selectedIds.includes(item.id);
                const predicting = predictingIds.includes(item.id);
                const image = item.images?.[0]?.url;
                return (
                  <motion.article
                    initial={
                      instantMotion ||
                      index >= 4 ||
                      animatedItems.current.has(item.id)
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
                    key={item.id}
                    data-selected={checked ? "true" : "false"}
                    className={`logistics-item-card min-w-0 ${styles.logisticsItem}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleItem(item)}
                      aria-pressed={checked}
                      className={`flex min-h-16 w-full min-w-0 items-center gap-3 text-left ${styles.logisticsSelect}`}
                    >
                      <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-paper">
                        {image ? (
                          <img
                            src={image}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span className="text-lg text-ink/25">物</span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong className="line-clamp-2 block text-sm leading-5 text-ink">
                          {displayListingTitle(item, "zh")}
                        </strong>
                        <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[11px] text-ink/45">
                          <span className="truncate">
                            {item.source.displayName} ·{" "}
                            {item.purchaseRecord ? "已购买" : "已收藏"}
                          </span>
                          <span className="shrink-0 font-semibold text-ink">
                            {yen(item.priceCurrent)}
                          </span>
                        </span>
                      </span>
                      <motion.span
                        initial={false}
                        animate={{
                          transform: checked ? "scale(1)" : "scale(0.86)",
                        }}
                        transition={
                          instantMotion
                            ? { duration: 0 }
                            : springs.appleSelection
                        }
                        aria-hidden="true"
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs ${
                          checked
                            ? "border-moss bg-moss text-white"
                            : "border-black/15 text-transparent"
                        }`}
                      >
                        ✓
                      </motion.span>
                    </button>
                    <AnimatePresence initial={false}>
                      {checked && (
                        <motion.button
                          type="button"
                          onClick={() => void predictItem(item)}
                          disabled={predicting}
                          className={styles.predictButton}
                          initial={instantMotion ? false : { opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{
                            duration: instantMotion
                              ? 0
                              : motionTokens.duration.fast,
                          }}
                        >
                          {predicting ? "AI 识别中…" : "重新进行 AI 预估"}
                        </motion.button>
                      )}
                    </AnimatePresence>
                  </motion.article>
                );
              })
            )}
          </div>
        </section>

        <aside className={styles.logisticsAside}>
          <section className={styles.shippingEditor}>
            <h3 className="text-base font-bold text-ink">真实物流</h3>
            <div className="mt-3 grid gap-3">
              <label className="grid gap-1.5 text-xs font-semibold text-ink/55">
                快递公司
                <select
                  value={carrierId}
                  onChange={(event) => {
                    calculationRevision.current += 1;
                    setCarrierId(event.target.value);
                    setBest(null);
                  }}
                  className="min-h-12 w-full rounded-xl border border-black/10 bg-white px-3 text-base font-semibold text-ink focus-visible:border-moss focus-visible:ring-2 focus-visible:ring-moss/15 sm:text-sm"
                >
                  {carriers.length === 0 && (
                    <option value="">暂无快递公司</option>
                  )}
                  {carriers.map((carrier) => (
                    <option key={carrier.id} value={carrier.id}>
                      {carrier.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                label="实际快递费"
                value={shippingFeeYen}
                onChange={(value) => {
                  calculationRevision.current += 1;
                  setShippingFeeYen(value);
                  setBest(null);
                }}
                suffix="JPY"
              />
            </div>

            {selected.length > 0 && (
              <div className="mt-3 border-t border-black/8 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAdjustments((current) => !current)}
                  aria-expanded={showAdjustments}
                  className="flex min-h-11 w-full items-center justify-between rounded-xl px-1 text-sm font-semibold text-ink"
                >
                  <span>商品参数 · {selected.length} 件</span>
                  <motion.svg
                    aria-hidden="true"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    initial={false}
                    animate={{
                      transform: showAdjustments
                        ? "rotate(180deg)"
                        : "rotate(0deg)",
                    }}
                    transition={
                      instantMotion ? { duration: 0 } : springs.appleSelection
                    }
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </motion.svg>
                </button>
                <AnimatePresence initial={false}>
                  {showAdjustments && (
                    <motion.div
                      className="mt-2 space-y-4"
                      initial={
                        instantMotion ? false : { height: 0, opacity: 0 }
                      }
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={
                        instantMotion ? { duration: 0 } : springs.appleSpatial
                      }
                      style={{ overflow: "hidden" }}
                    >
                      {selected.map((item) => {
                        const draft = drafts[item.id] ?? {};
                        return (
                          <fieldset
                            key={item.id}
                            className="logistics-adjust-panel min-w-0 rounded-2xl p-3"
                            data-save-state={saveStates[item.id]}
                            aria-busy={saveStates[item.id] === "saving"}
                          >
                            <legend className="max-w-full px-1 text-xs font-bold text-ink">
                              {displayListingTitle(item, "zh")}
                            </legend>
                            {saveStates[item.id] && <span className={styles.parameterStatus} role="status" data-state={saveStates[item.id]}>{saveStates[item.id] === "saving" ? "保存中…" : saveStates[item.id] === "saved" ? "已保存" : saveStates[item.id] === "error" ? "保存失败，修改仍保留" : "修改待保存"}</span>}
                            <div className="mt-2 grid min-w-0 grid-cols-2 gap-2">
                              <Field
                                label="商品重量"
                                value={draft.weightGrams ?? ""}
                                onChange={(value) =>
                                  updateDraft(item.id, "weightGrams", value)
                                }
                                suffix="g"
                              />
                              <Field
                                label="包装后重量"
                                value={draft.packageWeightGrams ?? ""}
                                onChange={(value) =>
                                  updateDraft(
                                    item.id,
                                    "packageWeightGrams",
                                    value,
                                  )
                                }
                                suffix="g"
                              />
                              <Field
                                label="长"
                                value={draft.lengthMm ?? ""}
                                onChange={(value) =>
                                  updateDraft(item.id, "lengthMm", value)
                                }
                                suffix="mm"
                              />
                              <Field
                                label="宽"
                                value={draft.widthMm ?? ""}
                                onChange={(value) =>
                                  updateDraft(item.id, "widthMm", value)
                                }
                                suffix="mm"
                              />
                              <Field
                                label="高"
                                value={draft.heightMm ?? ""}
                                onChange={(value) =>
                                  updateDraft(item.id, "heightMm", value)
                                }
                                suffix="mm"
                              />
                              <Field
                                label="预估售价"
                                value={draft.estimatedSalePriceYen ?? ""}
                                onChange={(value) =>
                                  updateDraft(
                                    item.id,
                                    "estimatedSalePriceYen",
                                    value,
                                  )
                                }
                                suffix="JPY"
                              />
                            </div>
                            {draft.notes && (
                              <p className="mt-2 whitespace-pre-line text-[11px] leading-5 text-ink/50">
                                {draft.notes}
                              </p>
                            )}
                          </fieldset>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void calculate(false)}
                disabled={optimizing}
                className="min-h-12 rounded-xl bg-black px-3 text-sm font-semibold text-white disabled:opacity-40"
              >
                {optimizing ? "计算中…" : "计算利润"}
              </button>
              <button
                type="button"
                onClick={() => void calculate(true)}
                disabled={optimizing}
                className="min-h-12 rounded-xl border border-black/10 bg-white px-3 text-sm font-semibold text-ink disabled:opacity-40"
              >
                AI 解读
              </button>
            </div>
          </section>

          {best && (
            <motion.section
              className={styles.logisticsResult}
              initial={
                instantMotion
                  ? false
                  : { opacity: 0.6, transform: "translateY(16px)" }
              }
              animate={{ opacity: 1, transform: "translateY(0)" }}
              transition={
                instantMotion ? { duration: 0 } : springs.appleSpatial
              }
            >
              <p className="text-xs font-semibold text-white/55">本次结果</p>
              <div className="mt-1 flex items-end justify-between gap-3">
                <div>
                  <p className="text-sm text-white/65">预计利润</p>
                  <strong className="block text-2xl font-black tracking-tight">
                    {best.profitYen == null ? "待补售价" : yen(best.profitYen)}
                  </strong>
                  <span className="text-[11px] text-white/45">
                    {cny(best.profitYen, exchangeRate)}
                  </span>
                </div>
                <div className="text-right text-xs text-white/55">
                  快递费
                  <strong className="block text-base text-white">
                    {yen(best.shippingYen)}
                  </strong>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-white/10 pt-3 text-xs">
                <div>
                  <dt className="text-white/45">商品成本</dt>
                  <dd className="mt-0.5 font-semibold">
                    {yen(best.itemCostYen)}
                  </dd>
                </div>
                <div>
                  <dt className="text-white/45">预计售价</dt>
                  <dd className="mt-0.5 font-semibold">{yen(best.saleYen)}</dd>
                </div>
              </dl>
              {ai && (
                <div className="mt-4 border-t border-white/10 pt-3 text-xs leading-5 text-white/70">
                  <p>{ai.error || ai.recommendationZh || ai.summaryZh}</p>
                  {ai.cautionsZh?.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-4">
                      {ai.cautionsZh.map((caution) => (
                        <li key={caution}>{caution}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
            </motion.section>
          )}
        </aside>
      </div>
    </section>
  );
}

export function CostToolWorkspace({
  apiBaseUrl,
  exchangeRate,
  managerId,
  segment,
  defaultSegment = "calculator",
  onSegmentChange,
}: {
  apiBaseUrl: string;
  exchangeRate?: number | null;
  managerId: string;
  segment?: CostToolSegment;
  defaultSegment?: CostToolSegment;
  onSegmentChange?: (segment: CostToolSegment) => void;
}) {
  const [internalSegment, setInternalSegment] =
    useState<CostToolSegment>(defaultSegment);
  const active = segment ?? internalSegment;
  const select = (next: CostToolSegment) => {
    setInternalSegment(next);
    onSegmentChange?.(next);
  };
  return (
    <div className="cost-tool-workspace">
      <header>
        <h2 id="cost-tool-title">{TERMS.costTool}</h2>
      </header>
      <div className="cost-tool-segments" role="group" aria-label="算账工具">
        <button
          type="button"
          aria-pressed={active === "calculator"}
          onClick={() => select("calculator")}
        >
          {TERMS.calculator}
        </button>
        <button
          type="button"
          aria-pressed={active === "logistics"}
          onClick={() => select("logistics")}
        >
          物流利润
        </button>
      </div>
      {active === "calculator" ? (
        <ProcurementCalculatorWorkspace
          exchangeRate={exchangeRate ?? undefined}
          managerId={managerId}
        />
      ) : (
        <LogisticsWorkspace apiBaseUrl={apiBaseUrl} exchangeRate={exchangeRate} />
      )}
    </div>
  );
}
