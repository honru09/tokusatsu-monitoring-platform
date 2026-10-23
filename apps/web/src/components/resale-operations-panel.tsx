"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { springs } from "../lib/motion-tokens";
import type { ResaleListing, ResaleRequest } from "./resale-workspace";
import { createVisibilityPoller } from "../lib/visibility-poller";
import styles from "./resale-workspace.module.css";

type Monitor = {
  id: string;
  keyword: string;
  minPriceCny: number;
  maxPriceCny: number;
  excludedKeywords: string[];
  requiredKeywords: string[];
  regions: string[];
  intervalMinutes: number;
  active: boolean;
  lastScanAt: string | null;
  nextScanAt: string | null;
  lastError: string | null;
  _count: { observations: number };
};
type Discovery = {
  id: string;
  title: string;
  priceCny: number;
  region: string;
  imageUrl: string | null;
  sourceUrl: string;
  discoveredAt: string;
  readAt: string | null;
  monitor: { keyword: string };
};
type SellerTask = {
  id: string;
  listingId?: string;
  kind: string;
  status: string;
  priceCny: number | null;
  scheduledAt: string;
  targetItemId: string;
  lastError: string | null;
  listing: { title: string };
};
type Overview = {
  monitors: Monitor[];
  discoveries: Discovery[];
  unread: number;
  published: number;
  metricCount: number;
  tasks: SellerTask[];
  capabilities: {
    searchConfigured: boolean;
    searchReady?: boolean;
    sellerActions: string[];
    publishing: boolean;
  };
};
type MetricKey = "views" | "wants" | "orders" | "revenueCny";
type Snapshot = Record<MetricKey, number | null> & {
  observedAt: string;
  origin: string;
};
type MetricListing = {
  id: string;
  title: string;
  status: string;
  latest: Snapshot | null;
  periodChange: Record<MetricKey, number | null>;
  metricsError: string | null;
};
type Metrics = {
  days: number;
  listingCount: number;
  totals: Record<MetricKey, { value: number | null; coverage: number }>;
  listings: MetricListing[];
  series: (Pick<Snapshot, MetricKey> & { day: string; recorded: number })[];
  truncated: boolean;
};
type MonitorDraft = {
  id?: string;
  keyword: string;
  minPriceCny: number;
  maxPriceCny: number;
  excluded: string;
  required: string;
  regions: string;
  intervalMinutes: number;
  active: boolean;
};

const newMonitor = (): MonitorDraft => ({
  keyword: "",
  minPriceCny: 0,
  maxPriceCny: 10000,
  excluded: "",
  required: "",
  regions: "",
  intervalMinutes: 60,
  active: false,
});
const words = (text: string) => [
  ...new Set(
    text
      .split(/\n|,|，/)
      .map((word) => word.trim())
      .filter(Boolean),
  ),
];
const datetime = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const localNow = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};
const money = (value: number) =>
  `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const metricFields = [
  ["views", "浏览量"],
  ["wants", "想要数"],
  ["orders", "订单数"],
  ["revenueCny", "累计收入（元）"],
] as const;
const taskLabels: Record<string, string> = {
  queued: "待执行",
  running: "执行中",
  manual: "待人工操作",
  uncertain: "结果待核实",
  succeeded: "已完成",
  cancelled: "已取消 / 未执行",
  failed: "未执行",
};
const metricValue = (key: MetricKey, value: number | null | undefined) =>
  value == null
    ? "未记录"
    : key === "revenueCny"
      ? money(value)
      : value.toLocaleString("zh-CN");
function monitorDraft(monitor: Monitor): MonitorDraft {
  return {
    id: monitor.id,
    keyword: monitor.keyword,
    minPriceCny: monitor.minPriceCny,
    maxPriceCny: monitor.maxPriceCny,
    excluded: monitor.excludedKeywords.join("\n"),
    required: monitor.requiredKeywords.join("\n"),
    regions: monitor.regions.join("\n"),
    intervalMinutes: monitor.intervalMinutes,
    active: monitor.active,
  };
}
function monitorBody(draft: MonitorDraft) {
  return {
    id: draft.id,
    keyword: draft.keyword.trim(),
    minPriceCny: draft.minPriceCny,
    maxPriceCny: draft.maxPriceCny,
    excludedKeywords: words(draft.excluded),
    requiredKeywords: words(draft.required),
    regions: words(draft.regions),
    intervalMinutes: draft.intervalMinutes,
    active: draft.active,
  };
}

export function ResaleOperationsPanel({
  request,
  apiBaseUrl,
  accountId,
  active,
  view,
  paused,
  selectedListingId = null,
  onOpenListing,
  onSelectListing,
  onOpenCandidates,
}: {
  request: ResaleRequest;
  apiBaseUrl: string;
  accountId: string | null;
  active: boolean;
  view: "market" | "maintenance" | "metrics";
  paused: boolean;
  selectedListingId?: string | null;
  onOpenListing?: (id: string) => Promise<void>;
  onSelectListing?: (id: string, title?: string) => void;
  onOpenCandidates?: () => void;
}) {
  const motionPreference = useReducedMotion();
  const [motionMounted, setMotionMounted] = useState(false);
  useEffect(() => setMotionMounted(true), []);
  const reduced = !motionMounted || Boolean(motionPreference);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [published, setPublished] = useState<ResaleListing[]>([]);
  const [days, setDays] = useState(7);
  const [metricSort, setMetricSort] = useState<"recent" | MetricKey>("recent");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<MonitorDraft>(newMonitor);
  const [monitorDirty, setMonitorDirty] = useState(false);
  const [nextDraft, setNextDraft] = useState<MonitorDraft | null>(null);
  const [importId, setImportId] = useState("");
  const [importJson, setImportJson] = useState("");
  const [taskListing, setTaskListing] = useState("");
  const [taskKind, setTaskKind] = useState("bump");
  const [taskPrice, setTaskPrice] = useState("");
  const [taskTime, setTaskTime] = useState(localNow);
  const [metricListing, setMetricListing] = useState("");
  const [metricTime, setMetricTime] = useState(localNow);
  const [metricInput, setMetricInput] = useState<Record<MetricKey, string>>({
    views: "",
    wants: "",
    orders: "",
    revenueCny: "",
  });
  const contextId = useRef("");
  const contextDrafts = useRef<
    Record<
      string,
      {
        taskKind: string;
        taskPrice: string;
        taskTime: string;
        metricTime: string;
        metricInput: Record<MetricKey, string>;
      }
    >
  >({});
  const latestDraft = useRef({
    taskKind,
    taskPrice,
    taskTime,
    metricTime,
    metricInput,
  });
  latestDraft.current = {
    taskKind,
    taskPrice,
    taskTime,
    metricTime,
    metricInput,
  };
  function selectContext(id: string) {
    if (id === contextId.current) return;
    contextDrafts.current[contextId.current] = latestDraft.current;
    const saved = contextDrafts.current[id];
    setTaskListing(id);
    setMetricListing(id);
    setTaskKind(saved?.taskKind ?? "bump");
    setTaskPrice(saved?.taskPrice ?? "");
    setTaskTime(saved?.taskTime ?? localNow());
    setMetricTime(saved?.metricTime ?? localNow());
    setMetricInput(
      saved?.metricInput ?? {
        views: "",
        wants: "",
        orders: "",
        revenueCny: "",
      },
    );
    contextId.current = id;
  }
  useEffect(() => {
    if (selectedListingId) selectContext(selectedListingId);
  }, [selectedListingId]);
  const alive = useRef(true);
  const sequence = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, []);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const current = ++sequence.current;
      try {
        const [data, report, goods] = await Promise.all([
          request<Overview>("/operations", "GET", undefined, signal),
          view === "metrics"
            ? request<Metrics>(
                `/metrics?days=${days}`,
                "GET",
                undefined,
                signal,
              )
            : Promise.resolve(null),
          view === "maintenance"
            ? request<{ listings: ResaleListing[] }>(
                "?status=published&limit=100",
                "GET",
                undefined,
                signal,
              )
            : Promise.resolve(null),
        ]);
        if (!alive.current || current !== sequence.current || signal?.aborted)
          return;
        setOverview(data);
        if (report) setMetrics(report);
        if (goods) setPublished(goods.listings);
        setLoadError("");
      } catch (reason) {
        if (alive.current && current === sequence.current && !signal?.aborted)
          setLoadError(
            reason instanceof Error ? reason.message : "读取运营数据失败",
          );
        throw reason;
      } finally {
        if (alive.current && current === sequence.current) setLoading(false);
      }
    },
    [request, view, days],
  );
  useEffect(() => {
    if (!active) return;
    setLoading(true);
    const poller = createVisibilityPoller({
      task: load,
      intervalMs: 20_000,
      maxBackoffMs: 120_000,
      isPaused: () => document.hidden || !active,
    });
    const visibility = () =>
      document.hidden ? poller.pause() : poller.resume();
    document.addEventListener("visibilitychange", visibility);
    poller.start();
    return () => {
      poller.stop();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [load, active]);
  async function run(key: string, task: () => Promise<string>) {
    if (pending || !accountId) return;
    setPending(key);
    setError("");
    setNotice("");
    try {
      const message = await task();
      if (alive.current) {
        setNotice(message);
        await load();
      }
    } catch (reason) {
      if (alive.current)
        setError(
          reason instanceof Error ? reason.message : "操作失败，输入仍保留",
        );
    } finally {
      if (alive.current) setPending("");
    }
  }
  function patchMonitor<K extends keyof MonitorDraft>(
    key: K,
    value: MonitorDraft[K],
  ) {
    setMonitorDirty(true);
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function chooseMonitor(next: MonitorDraft) {
    if (monitorDirty) {
      setNextDraft(next);
      return;
    }
    setDraft(next);
    setMonitorDirty(false);
  }
  const disabled = Boolean(pending) || !accountId;
  const searchConfigured =
    (overview?.capabilities.searchConfigured ?? false) &&
    overview?.capabilities.searchReady !== false;
  const sellerActions = overview?.capabilities.sellerActions ?? [];
  const metricListings = [...(metrics?.listings ?? [])]
    .filter((row) => !selectedListingId || row.id === selectedListingId)
    .sort((left, right) => {
      if (metricSort === "recent")
        return (
          (right.latest ? Date.parse(right.latest.observedAt) : 0) -
          (left.latest ? Date.parse(left.latest.observedAt) : 0)
        );
      return (
        (right.latest?.[metricSort] ?? -1) - (left.latest?.[metricSort] ?? -1)
      );
    });
  return (
    <section
      hidden={!active}
      inert={!active}
      className={styles.operations}
      aria-label="闲鱼运营工作台"
    >
      <div className={styles.operationsHeading}>
        <div>
          <h3>
            {view === "market"
              ? "市场参考"
              : view === "maintenance"
                ? "商品维护"
                : "运营数据"}
          </h3>
        </div>
        <button
          type="button"
          disabled={Boolean(pending)}
          onClick={() => void load().catch(() => {})}
        >
          刷新运营数据
        </button>
      </div>
      {(error || loadError) && (
        <p role="alert" className={styles.error}>
          {error || loadError}
        </p>
      )}
      {notice && (
        <motion.p
          key={notice}
          role="status"
          className={`${styles.notice} ${styles.feedback}`}
          initial={reduced ? false : { opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduced ? { duration: 0 } : springs.appleSelection}
        >
          <span className={styles.feedbackMark} aria-hidden="true" />
          {notice}
        </motion.p>
      )}
      {pending && <p role="status">正在处理…</p>}
      {loading && (
        <p role="status" className={styles.empty}>
          正在读取运营数据…
        </p>
      )}
      <div hidden={view !== "market"} inert={view !== "market"}>
        {!searchConfigured && (
          <p className={styles.connectionNote}>
            登录后即可扫描，也可以先保存监测条件。
          </p>
        )}
        {paused && searchConfigured && (
          <p className={styles.connectionNote}>
            自动任务已全局暂停；“扫描一次”可以手动执行。
          </p>
        )}
        <div className={styles.operationsColumns}>
          <section
            className={styles.operationsSection}
            aria-label="监测任务列表"
          >
            <div className={styles.sectionHeading}>
              <h4>监测条件 · {overview?.monitors.length ?? 0}</h4>
              <button
                type="button"
                disabled={disabled}
                onClick={() => chooseMonitor(newMonitor())}
              >
                新建监测
              </button>
            </div>
            {!overview?.monitors.length && (
              <p className={styles.empty}>添加一个关键词，开始跟踪闲鱼商品。</p>
            )}
            {overview?.monitors.map((monitor) => (
              <article className={styles.operationRow} key={monitor.id}>
                <h4>{monitor.keyword}</h4>
                <p>
                  {money(monitor.minPriceCny)} 至 {money(monitor.maxPriceCny)} ·
                  每 {monitor.intervalMinutes} 分钟
                </p>
                <p className={styles.hint}>
                  {monitor.active
                    ? !searchConfigured
                      ? "等待搜索连接"
                      : paused
                        ? "全局暂停"
                        : "自动扫描已启用"
                    : "自动扫描已暂停"}{" "}
                  · 已记录 {monitor._count.observations} 件
                  {monitor.lastScanAt
                    ? ` · 最近扫描 ${datetime(monitor.lastScanAt)}`
                    : " · 尚未扫描"}
                </p>
                {monitor.lastError && (
                  <p className={styles.warning}>{monitor.lastError}</p>
                )}
                <div className={styles.actions}>
                  <button
                    type="button"
                    onClick={() => chooseMonitor(monitorDraft(monitor))}
                  >
                    编辑条件
                  </button>
                  <button
                    type="button"
                    disabled={disabled || !searchConfigured}
                    onClick={() =>
                      void run(`scan-${monitor.id}`, async () => {
                        const result = await request<{
                          discovered: number;
                          updated: number;
                          rejected: number;
                        }>(`/monitors/${monitor.id}/scan`, "POST", {});
                        return `扫描完成：新增 ${result.discovered}，更新 ${result.updated}，过滤 ${result.rejected}`;
                      })
                    }
                  >
                    扫描一次
                  </button>
                  <button
                    type="button"
                    disabled={
                      disabled || (!monitor.active && !searchConfigured)
                    }
                    onClick={() =>
                      void run(`toggle-${monitor.id}`, async () => {
                        await request("/monitors", "POST", {
                          ...monitorBody(monitorDraft(monitor)),
                          active: !monitor.active,
                        });
                        return monitor.active
                          ? "自动扫描已暂停"
                          : "自动扫描已启用";
                      })
                    }
                  >
                    {monitor.active ? "暂停扫描" : "启用扫描"}
                  </button>
                </div>
              </article>
            ))}
          </section>
          <form
            className={styles.operationsForm}
            aria-label="编辑监测条件"
            onSubmit={(event) => {
              event.preventDefault();
              void run("monitor-save", async () => {
                const result = await request<{ monitor: Monitor }>(
                  "/monitors",
                  "POST",
                  monitorBody(draft),
                );
                setDraft(
                  monitorDraft({
                    ...result.monitor,
                    _count: { observations: 0 },
                  }),
                );
                setMonitorDirty(false);
                return "监测条件已保存";
              });
            }}
          >
            <h4>{draft.id ? "编辑监测条件" : "新建监测条件"}</h4>
            {nextDraft && (
              <div className={styles.warning}>
                当前监测条件尚未保存。
                <div className={styles.actions}>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(nextDraft);
                      setNextDraft(null);
                      setMonitorDirty(false);
                    }}
                  >
                    放弃修改并切换条件
                  </button>
                  <button type="button" onClick={() => setNextDraft(null)}>
                    继续编辑条件
                  </button>
                </div>
              </div>
            )}
            <label>
              监测关键词
              <input
                required
                maxLength={100}
                value={draft.keyword}
                onChange={(event) =>
                  patchMonitor("keyword", event.target.value)
                }
                placeholder="例如：假面骑士 龙骑"
              />
            </label>
            <div className={styles.fields}>
              <label>
                闲鱼最低价（元）
                <input
                  type="number"
                  min="0"
                  max="10000000"
                  step="0.01"
                  required
                  value={draft.minPriceCny}
                  onChange={(event) =>
                    patchMonitor("minPriceCny", Number(event.target.value))
                  }
                />
              </label>
              <label>
                闲鱼最高价（元）
                <input
                  type="number"
                  min="0.01"
                  max="10000000"
                  step="0.01"
                  required
                  value={draft.maxPriceCny}
                  onChange={(event) =>
                    patchMonitor("maxPriceCny", Number(event.target.value))
                  }
                />
              </label>
              <label>
                全部必须包含（每行一个）
                <textarea
                  rows={2}
                  value={draft.required}
                  onChange={(event) =>
                    patchMonitor("required", event.target.value)
                  }
                />
              </label>
              <label>
                排除词（每行一个）
                <textarea
                  rows={2}
                  value={draft.excluded}
                  onChange={(event) =>
                    patchMonitor("excluded", event.target.value)
                  }
                />
              </label>
              <label>
                地区（每行一个，匹配任一地区）
                <textarea
                  rows={2}
                  value={draft.regions}
                  onChange={(event) =>
                    patchMonitor("regions", event.target.value)
                  }
                />
              </label>
              <label>
                扫描间隔（分钟）
                <input
                  type="number"
                  min="30"
                  max="1440"
                  required
                  value={draft.intervalMinutes}
                  onChange={(event) =>
                    patchMonitor("intervalMinutes", Number(event.target.value))
                  }
                />
              </label>
            </div>
            <div className={styles.checks}>
              <label>
                <input
                  type="checkbox"
                  checked={draft.active}
                  disabled={!searchConfigured && !draft.active}
                  onChange={(event) =>
                    patchMonitor("active", event.target.checked)
                  }
                />
                启用自动扫描
              </label>
            </div>
            <button
              className={styles.publishAction}
              type="submit"
              disabled={disabled || !monitorDirty}
            >
              保存监测条件
            </button>
          </form>
        </div>
        <details className={styles.operationsSection}>
          <summary>导入监测结果 JSON</summary>
          <form
            className={styles.operationsForm}
            onSubmit={(event) => {
              event.preventDefault();
              void run("monitor-import", async () => {
                const input = JSON.parse(importJson);
                const items = Array.isArray(input) ? input : input.items;
                if (!Array.isArray(items))
                  throw new Error("请填写商品数组或包含 items 数组的 JSON");
                const result = await request<{
                  discovered: number;
                  updated: number;
                  rejected: number;
                }>(`/monitors/${importId}/import`, "POST", { items });
                return `导入完成：新增 ${result.discovered}，更新 ${result.updated}，过滤 ${result.rejected}`;
              });
            }}
          >
            <label>
              结果归属的监测条件
              <select
                aria-label="结果归属的监测条件"
                required
                value={importId}
                onChange={(event) => setImportId(event.target.value)}
              >
                <option value="">选择监测条件</option>
                {overview?.monitors.map((monitor) => (
                  <option key={monitor.id} value={monitor.id}>
                    {monitor.keyword}
                  </option>
                ))}
              </select>
            </label>
            <label>
              商品结果（最多 100 条）
              <textarea
                required
                rows={5}
                maxLength={200000}
                value={importJson}
                onChange={(event) => setImportJson(event.target.value)}
                placeholder='[{"id":"实际商品ID","title":"商品标题","price":100,"area":"东京或国内实际地区","link":"https://www.goofish.com/item?id=实际商品ID"}]'
              />
            </label>
            <p className={styles.hint}>
              接受 title、price、area、link
              等字段。只保存可验证的闲鱼链接，重复商品更新价格并保留发现时间。
            </p>
            <button
              type="submit"
              disabled={disabled || !overview?.monitors.length}
            >
              导入并筛选
            </button>
          </form>
        </details>
        <section className={styles.operationsSection} aria-label="闲鱼发现记录">
          <div className={styles.sectionHeading}>
            <h4>发现记录 · {overview?.unread ?? 0} 件未读</h4>
            <button
              type="button"
              disabled={disabled || !overview?.unread}
              onClick={() =>
                void run("mark-read", async () => {
                  await request("/discoveries/read", "POST", {});
                  return "发现记录已全部标为已读";
                })
              }
            >
              全部标为已读
            </button>
          </div>
          <p className={styles.hint}>
            显示最近 50 条发现。筛选结果用于市场观察，货源收录继续从 Mercari
            候选进行。
          </p>
          {onOpenCandidates && (
            <button type="button" onClick={onOpenCandidates}>
              对照 Mercari 货源<span aria-hidden="true"> →</span>
            </button>
          )}
          {!overview?.discoveries.length && (
            <p className={styles.empty}>
              尚无发现，扫描或导入结果后会显示在这里。
            </p>
          )}
          {overview?.discoveries.map((row) => (
            <article className={styles.discoveryRow} key={row.id}>
              {row.imageUrl && <img src={row.imageUrl} alt="" loading="lazy" />}
              <div>
                <a
                  href={row.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {row.title}
                </a>
                <p>
                  <strong className={styles.price}>
                    {money(row.priceCny)}
                  </strong>{" "}
                  · {row.region || "地区未提供"}
                  {!row.readAt ? " · 未读" : ""}
                </p>
                <p className={styles.hint}>
                  {row.monitor.keyword} · 发现 {datetime(row.discoveredAt)}
                </p>
              </div>
            </article>
          ))}
        </section>
      </div>
      <div hidden={view !== "maintenance"} inert={view !== "maintenance"}>
        <form
          className={styles.operationsForm}
          aria-label="安排商品维护"
          onSubmit={(event) => {
            event.preventDefault();
            void run("task-create", async () => {
              const listing = published.find((row) => row.id === taskListing);
              if (!listing) throw new Error("商品已不在当前已发布列表，请刷新");
              const result = await request<{ task: SellerTask }>(
                "/tasks",
                "POST",
                {
                  listingId: listing.id,
                  version: listing.version,
                  kind: taskKind,
                  scheduledAt: new Date(taskTime).toISOString(),
                  ...(taskKind === "reprice"
                    ? { priceCny: Number(taskPrice) }
                    : {}),
                },
              );
              return result.task.status === "manual"
                ? "已加入手动维护清单，在闲鱼操作后确认结果"
                : "已安排维护任务";
            });
          }}
        >
          <div className={styles.fields}>
            <label>
              维护商品
              <select
                aria-label="维护商品"
                required
                value={taskListing}
                onChange={(event) => {
                  selectContext(event.target.value);
                  onSelectListing?.(
                    event.target.value,
                    published.find((row) => row.id === event.target.value)
                      ?.title,
                  );
                }}
              >
                <option value="">选择已发布商品</option>
                {published.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              维护操作
              <select
                aria-label="维护操作"
                value={taskKind}
                onChange={(event) => setTaskKind(event.target.value)}
              >
                <option value="bump">擦亮商品</option>
                <option value="reprice">修改售价</option>
              </select>
            </label>
            {taskKind === "reprice" && (
              <label>
                目标售价（人民币）
                <input
                  required
                  type="number"
                  min="0.01"
                  max="10000000"
                  step="0.01"
                  value={taskPrice}
                  onChange={(event) => setTaskPrice(event.target.value)}
                />
              </label>
            )}
            <label>
              计划执行（本机时间）
              <input
                required
                type="datetime-local"
                value={taskTime}
                onChange={(event) => setTaskTime(event.target.value)}
              />
            </label>
          </div>
          <p className={styles.hint}>
            最多展示最近 100
            件已发布商品。本系统每件每天最多安排一次擦亮；实际可用次数以闲鱼为准。
          </p>
          {!sellerActions.includes(taskKind) ? (
            <p className={styles.connectionNote}>
              当前渠道未连接此操作，将加入手动维护清单。到闲鱼完成操作后回填结果。
            </p>
          ) : paused ? (
            <p className={styles.connectionNote}>
              全局自动任务已暂停，任务会保留在队列中。
            </p>
          ) : null}
          <button
            type="submit"
            className={styles.publishAction}
            disabled={disabled || !published.length}
          >
            安排维护
          </button>
        </form>
        <section className={styles.operationsSection} aria-label="商品维护任务">
          <div className={styles.sectionHeading}>
            <h4>{selectedListingId ? "当前商品维护任务" : "最近维护任务"}</h4>
            {selectedListingId && (
              <button type="button" onClick={() => onSelectListing?.("")}>
                查看全部维护
              </button>
            )}
          </div>
          {!overview?.tasks.length && (
            <p className={styles.empty}>
              暂未安排任务。先完成发布并回填闲鱼商品，再创建维护任务。
            </p>
          )}
          {overview?.tasks
            .filter(
              (task) =>
                !selectedListingId || task.listingId === selectedListingId,
            )
            .map((task) => (
              <article className={styles.operationRow} key={task.id}>
                <h4>{task.listing.title}</h4>
                <p>
                  {task.kind === "bump" ? "擦亮" : "调价"}
                  {task.priceCny != null
                    ? ` → ${money(task.priceCny)}`
                    : ""} · {taskLabels[task.status] ?? task.status} ·{" "}
                  {datetime(task.scheduledAt)}
                </p>
                {task.lastError && (
                  <p className={styles.warning}>{task.lastError}</p>
                )}
                <div className={styles.actions}>
                  <a
                    href={`https://www.goofish.com/item?id=${encodeURIComponent(task.targetItemId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    打开闲鱼核实
                  </a>
                  {[
                    ...(task.status === "queued" || task.status === "manual"
                      ? [["cancel", "取消任务"]]
                      : []),
                    ...(task.status === "manual" || task.status === "uncertain"
                      ? [
                          ["confirmed", "确认已在闲鱼执行"],
                          ["not_executed", "已核实未执行"],
                        ]
                      : []),
                  ].map(([action, label]) => (
                    <button
                      type="button"
                      key={action}
                      disabled={disabled}
                      onClick={() =>
                        void run(`resolve-${task.id}`, async () => {
                          await request(`/tasks/${task.id}/actions`, "POST", {
                            action,
                          });
                          return "维护结果已记录";
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </article>
            ))}
        </section>
      </div>
      <div hidden={view !== "metrics"} inert={view !== "metrics"}>
        {overview && (
          <p className={styles.hint}>
            在售 {overview.published} 件 · 已保存 {overview.metricCount}{" "}
            次实际观测
          </p>
        )}
        <div className={styles.reportToolbar}>
          <label>
            单品排序
            <select
              aria-label="单品排序"
              value={metricSort}
              onChange={(event) =>
                setMetricSort(event.target.value as typeof metricSort)
              }
            >
              <option value="recent">最近观测</option>
              {metricFields.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}由高到低
                </option>
              ))}
            </select>
          </label>
          <label>
            观测区间
            <select
              aria-label="观测区间"
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            >
              <option value="7">最近 7 天</option>
              <option value="14">最近 14 天</option>
              <option value="30">最近 30 天</option>
            </select>
          </label>
          <a href={`${apiBaseUrl}/resale/metrics.csv?days=${days}`} download>
            导出实际记录 CSV
          </a>
        </div>
        {metrics && (
          <>
            <p className={styles.hint}>全部商品 · 最近一次实际记录</p>
            <dl className={styles.metricTotals}>
              {metricFields.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{metricValue(key, metrics.totals[key].value)}</dd>
                  <small>
                    {metrics.totals[key].coverage} / {metrics.listingCount}{" "}
                    件有该指标
                  </small>
                </div>
              ))}
            </dl>
            <p className={styles.hint}>
              汇总来自各商品最近一次实际观测；不同商品观测时间可能不同。区间变化仅在至少两次可比较观测时计算，不代表平台整日成交数据。
            </p>
            {metrics.truncated && (
              <p className={styles.warning}>
                当前区间仅展示最近 5000 条观测，汇总仍以每件商品最新记录为准。
              </p>
            )}
            {!metrics.listings.length && (
              <p className={styles.empty}>
                暂无可记录的闲鱼商品。发布后回填商品 ID 与链接，再记录运营数据。
              </p>
            )}
            <div className={styles.metricList}>
              {metricListings.map((row) => (
                <article className={styles.operationRow} key={row.id}>
                  <div className={styles.sectionHeading}>
                    <h4>{row.title}</h4>
                    {onOpenListing && (
                      <button
                        type="button"
                        onClick={() => void onOpenListing(row.id)}
                      >
                        打开商品
                      </button>
                    )}
                  </div>
                  <p className={styles.hint}>
                    {row.latest
                      ? `${datetime(row.latest.observedAt)} · ${row.latest.origin === "bridge" ? "渠道同步" : "人工记录"}`
                      : "尚未取得实际指标"}
                  </p>
                  {row.metricsError && (
                    <p className={styles.warning}>{row.metricsError}</p>
                  )}
                  <dl className={styles.metricValues}>
                    {metricFields.map(([key, label]) => (
                      <div key={key}>
                        <dt>{label}</dt>
                        <dd>{metricValue(key, row.latest?.[key])}</dd>
                        {row.periodChange[key] != null && (
                          <small>
                            区间增加 {metricValue(key, row.periodChange[key])}
                          </small>
                        )}
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
            </div>
            <details className={styles.operationsSection}>
              <summary>查看每日观测汇总（北京时间）</summary>
              <div
                className={styles.tableScroll}
                tabIndex={0}
                aria-label="每日观测数据"
              >
                <table>
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>记录商品数</th>
                      {metricFields.map(([key, label]) => (
                        <th key={key}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.series.map((row) => (
                      <tr key={row.day}>
                        <th scope="row">{row.day}</th>
                        <td>{row.recorded || "无观测"}</td>
                        {metricFields.map(([key]) => (
                          <td key={key}>{metricValue(key, row[key])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
        <form
          className={styles.operationsForm}
          aria-label="记录实际运营数据"
          onSubmit={(event) => {
            event.preventDefault();
            void run("metric-save", async () => {
              const values = Object.fromEntries(
                metricFields
                  .filter(([key]) => metricInput[key].trim() !== "")
                  .map(([key]) => [key, Number(metricInput[key])]),
              );
              if (!Object.keys(values).length)
                throw new Error("至少填写一项实际指标，未知项留空");
              await request("/metrics", "POST", {
                listingId: metricListing,
                observedAt: new Date(metricTime).toISOString(),
                ...values,
              });
              setMetricTime(localNow());
              return "实际运营指标已记录";
            });
          }}
        >
          <h4>记录实际观测</h4>
          <div className={styles.fields}>
            <label>
              记录商品
              <select
                aria-label="记录商品"
                required
                value={metricListing}
                onChange={(event) => {
                  selectContext(event.target.value);
                  onSelectListing?.(
                    event.target.value,
                    metrics?.listings.find(
                      (row) => row.id === event.target.value,
                    )?.title,
                  );
                }}
              >
                <option value="">选择闲鱼商品</option>
                {metrics?.listings.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              观测时间（本机时间）
              <input
                required
                type="datetime-local"
                value={metricTime}
                onChange={(event) => setMetricTime(event.target.value)}
              />
            </label>
            {metricFields.map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min="0"
                  max="1000000000"
                  step={key === "revenueCny" ? "0.01" : "1"}
                  value={metricInput[key]}
                  placeholder="未知留空"
                  onChange={(event) =>
                    setMetricInput((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <p className={styles.hint}>
            填写在闲鱼实际看到的累计指标。未填项不会按 0
            计算；收入不等同于利润。
          </p>
          <div className={styles.actions}>
            <button
              className={styles.publishAction}
              type="submit"
              disabled={disabled || !metrics?.listings.length}
            >
              保存实际指标
            </button>
            <button
              type="button"
              disabled={
                disabled || !sellerActions.includes("metrics") || !metricListing
              }
              onClick={() =>
                void run("metric-sync", async () => {
                  await request("/metrics/sync", "POST", {
                    listingId: metricListing,
                  });
                  return "已同步渠道实际指标";
                })
              }
            >
              从渠道同步指标
            </button>
          </div>
          {!sellerActions.includes("metrics") && (
            <p className={styles.hint}>
              指标接口尚未连接，当前使用人工记录。连接后可在自动化设置中启用每小时同步。
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
