"use client";

import { useEffect, useMemo, useState } from "react";

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
    <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-ink/55">
      <span>{label}</span>
      <span className="flex min-h-11 min-w-0 items-center rounded-xl border border-black/10 bg-white px-3 focus-within:border-[#0071e3] focus-within:ring-2 focus-within:ring-[#0071e3]/10">
        <input
          type="number"
          min={0}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 min-w-0 flex-1 bg-transparent text-base font-semibold text-ink outline-none sm:text-sm"
        />
        <span className="ml-2 text-[11px] text-ink/35">{suffix}</span>
      </span>
    </label>
  );
}

export function LogisticsWorkspace({ apiBaseUrl, exchangeRate }: Props) {
  const [items, setItems] = useState<LogisticsItem[]>([]);
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
      setPredictingIds((current) =>
        current.filter((id) => id !== item.id),
      );
    }
  }

  function toggleItem(item: LogisticsItem) {
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
    const response = await fetch(`${apiBaseUrl}/logistics/items/${item.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(drafts[item.id] ?? {}),
    });
    if (!response.ok) throw new Error("物流参数保存失败");
  }

  async function calculate(withAi = false) {
    if (!selectedIds.length) {
      setMessage("请先选择收藏或已购买商品");
      return;
    }
    if (!carrierId || shippingFeeYen === "") {
      setMessage("请选择快递公司并填写实际快递费");
      return;
    }
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
      setBest(payload.best);
      setAi(payload.ai);
      setMessage("利润结果已按实际快递费更新");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "利润计算失败");
    } finally {
      setOptimizing(false);
    }
  }

  return (
    <section
      className="mx-auto max-w-6xl space-y-4 pb-28"
      aria-labelledby="logistics-title"
    >
      <header className="ios-surface rounded-3xl border border-white/70 p-4 shadow-panel sm:p-6">
        <p className="text-xs font-semibold text-ink/45">收藏与购买记录</p>
        <h2
          id="logistics-title"
          className="mt-1 font-heading text-2xl font-black tracking-tight text-ink"
        >
          利润与物流
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/55">
          选择商品后由 AI 预估重量、包装尺寸和售价。填写真实快递信息即可计算，错误的预估值可以手动修正。
        </p>
        {message && (
          <p className="mt-3 text-sm font-semibold text-[#0066cc]" aria-live="polite">
            {message}
          </p>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,.6fr)]">
        <section className="ios-surface min-w-0 rounded-3xl border border-white/70 p-3 shadow-panel sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <h3 className="text-base font-bold text-ink">选择商品</h3>
            <span className="text-xs text-ink/45">已选 {selectedIds.length}/12</span>
          </div>
          <div className="grid max-h-[660px] gap-2 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-2">
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
              items.map((item) => {
                const checked = selectedIds.includes(item.id);
                const predicting = predictingIds.includes(item.id);
                const image = item.images?.[0]?.url;
                return (
                  <article
                    key={item.id}
                    className={`min-w-0 rounded-2xl border p-2.5 transition-colors ${
                      checked
                        ? "border-[#0071e3]/45 bg-[#0071e3]/5"
                        : "border-black/8 bg-white/80"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleItem(item)}
                      aria-pressed={checked}
                      className="flex min-h-16 w-full min-w-0 items-center gap-3 rounded-xl text-left"
                    >
                      <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#f2f2f7]">
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
                          {item.titleZh || item.titleRaw}
                        </strong>
                        <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[11px] text-ink/45">
                          <span className="truncate">
                            {item.source.displayName} · {item.purchaseRecord ? "已购买" : "已收藏"}
                          </span>
                          <span className="shrink-0 font-semibold text-ink">
                            {yen(item.priceCurrent)}
                          </span>
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs ${
                          checked
                            ? "border-[#0071e3] bg-[#0071e3] text-white"
                            : "border-black/15 text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                    </button>
                    {checked && (
                      <button
                        type="button"
                        onClick={() => void predictItem(item)}
                        disabled={predicting}
                        className="mt-2 min-h-11 w-full rounded-xl bg-black px-3 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {predicting ? "AI 识别中…" : "重新进行 AI 预估"}
                      </button>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <section className="ios-surface rounded-3xl border border-white/70 p-4 shadow-panel">
            <h3 className="text-base font-bold text-ink">真实物流</h3>
            <div className="mt-3 grid gap-3">
              <label className="grid gap-1.5 text-xs font-semibold text-ink/55">
                快递公司
                <select
                  value={carrierId}
                  onChange={(event) => {
                    setCarrierId(event.target.value);
                    setBest(null);
                  }}
                  className="min-h-12 w-full rounded-xl border border-black/10 bg-white px-3 text-base font-semibold text-ink outline-none focus:border-[#0071e3] sm:text-sm"
                >
                  {carriers.length === 0 && <option value="">暂无快递公司</option>}
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
                  <span>修正 AI 数值</span>
                  <span aria-hidden="true">{showAdjustments ? "−" : "+"}</span>
                </button>
                {showAdjustments && (
                  <div className="mt-2 space-y-4">
                    {selected.map((item) => {
                      const draft = drafts[item.id] ?? {};
                      return (
                        <fieldset
                          key={item.id}
                          className="min-w-0 rounded-2xl bg-[#f2f2f7] p-3"
                        >
                          <legend className="max-w-full truncate px-1 text-xs font-bold text-ink">
                            {item.titleZh || item.titleRaw}
                          </legend>
                          <div className="mt-2 grid min-w-0 grid-cols-2 gap-2">
                            <Field label="商品重量" value={draft.weightGrams ?? ""} onChange={(value) => updateDraft(item.id, "weightGrams", value)} suffix="g" />
                            <Field label="包装后重量" value={draft.packageWeightGrams ?? ""} onChange={(value) => updateDraft(item.id, "packageWeightGrams", value)} suffix="g" />
                            <Field label="长" value={draft.lengthMm ?? ""} onChange={(value) => updateDraft(item.id, "lengthMm", value)} suffix="mm" />
                            <Field label="宽" value={draft.widthMm ?? ""} onChange={(value) => updateDraft(item.id, "widthMm", value)} suffix="mm" />
                            <Field label="高" value={draft.heightMm ?? ""} onChange={(value) => updateDraft(item.id, "heightMm", value)} suffix="mm" />
                            <Field label="预估售价" value={draft.estimatedSalePriceYen ?? ""} onChange={(value) => updateDraft(item.id, "estimatedSalePriceYen", value)} suffix="JPY" />
                          </div>
                          {draft.notes && (
                            <p className="mt-2 whitespace-pre-line text-[11px] leading-5 text-ink/50">
                              {draft.notes}
                            </p>
                          )}
                        </fieldset>
                      );
                    })}
                  </div>
                )}
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
            <section className="rounded-3xl bg-black p-5 text-white shadow-panel">
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
                  <dd className="mt-0.5 font-semibold">{yen(best.itemCostYen)}</dd>
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
            </section>
          )}
        </aside>
      </div>
    </section>
  );
}
