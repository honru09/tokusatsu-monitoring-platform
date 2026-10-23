"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { springs, motionTokens } from "../lib/motion-tokens";
import styles from "./operations-editorial.module.css";
import {
  calculateQuote,
  cents,
  customerQuoteText,
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
  fee: "15",
  shipping: "25",
  target: "30",
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
