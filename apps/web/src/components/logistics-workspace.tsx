"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { displayListingTitle } from "../lib/listing-title";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { motionTokens, springs } from "../lib/motion-tokens";
import styles from "./operations-editorial.module.css";

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
