"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { TERMS } from "../lib/terms";
import { readFetchError } from "../lib/fetch-error";
import styles from "./finance-panel.module.css";

export type FinanceSummary = {
  totalCostYen: number;
  totalIncomeYen: number;
  netProfitYen: number;
};

const yen = (value: number) =>
  `${value < 0 ? "−" : ""}¥${Math.abs(Math.round(value)).toLocaleString("ja-JP")}`;

/** Ease-out count-up; snaps straight to the value under reduced motion. */
function useCountUp(target: number | null, reduceMotion: boolean) {
  const [display, setDisplay] = useState(0);
  const frameRef = useRef(0);
  useEffect(() => {
    if (target === null) return;
    if (reduceMotion) {
      setDisplay(target);
      return;
    }
    const started = performance.now();
    const duration = 900;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(target * eased));
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, reduceMotion]);
  return display;
}

function Figure({
  label,
  value,
  reduceMotion,
  tone,
  subtitle,
}: {
  label: string;
  value: number | null;
  reduceMotion: boolean;
  tone?: "positive" | "negative";
  subtitle?: string;
}) {
  const display = useCountUp(value, reduceMotion);
  // The value is nowrap in a ~113px column on phones, so its size steps
  // down by the target's glyph count (the target, not the animating
  // display value, so the tier never jumps mid-count-up): 9-10 glyphs
  // use long (e.g. −¥105,309), 11+ use xlong.
  const glyphs = value === null ? 0 : yen(value).length;
  const tier = glyphs >= 11 ? "xlong" : glyphs >= 9 ? "long" : "default";
  return (
    <div className={styles.figure}>
      <span className={styles.label}>{label}</span>
      <strong
        className={`${styles.value} ${tier === "long" ? styles.valueLong : ""} ${tier === "xlong" ? styles.valueXlong : ""} ${tone ? styles[tone] : ""}`}
        data-tier={tier}
        aria-label={value === null ? undefined : `${label} ${yen(value)}`}
      >
        {value === null ? "—" : yen(display)}
      </strong>
      {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
    </div>
  );
}

/**
 * The home money strip: one pool, three numbers - everything ever
 * spent on purchases, everything ever taken in from sales, and the
 * difference. Pinned above the todo queues; no copy beyond the labels.
 * Refetches whenever `refreshKey` changes identity: the dashboard
 * hands it the purchased-id set, which is rebuilt on every purchase
 * sync, so a purchase registered while the home stays mounted does
 * not leave stale totals on screen.
 */
export function FinancePanel({
  apiBaseUrl,
  refreshKey,
}: {
  apiBaseUrl: string;
  refreshKey?: unknown;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    void (async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/finance/summary`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(await readFetchError(response, "财务汇总加载失败"));
        const payload = (await response.json()) as FinanceSummary;
        setSummary({
          totalCostYen: payload.totalCostYen ?? 0,
          totalIncomeYen: payload.totalIncomeYen ?? 0,
          netProfitYen: payload.netProfitYen ?? 0,
        });
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [apiBaseUrl, attempt, refreshKey]);

  const net = summary?.netProfitYen ?? null;
  return (
    <section className={styles.panel} aria-label="财务汇总">
      <Figure
        label={TERMS.totalCost}
        value={summary?.totalCostYen ?? null}
        reduceMotion={reduceMotion}
        subtitle="累计支出"
      />
      <Figure
        label={TERMS.totalIncome}
        value={summary?.totalIncomeYen ?? null}
        reduceMotion={reduceMotion}
        subtitle="售出到账"
      />
      <Figure
        label={TERMS.netProfit}
        value={net}
        reduceMotion={reduceMotion}
        tone={net === null ? undefined : net >= 0 ? "positive" : "negative"}
        subtitle="全周期利润"
      />
      {failed && (
        <button
          type="button"
          className={styles.retry}
          onClick={() => setAttempt((value) => value + 1)}
        >
          重试
        </button>
      )}
    </section>
  );
}
