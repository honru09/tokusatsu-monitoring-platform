"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { readFetchError } from "../lib/fetch-error";
import { createVisibilityPoller } from "../lib/visibility-poller";
import { motionTokens, springs } from "../lib/motion-tokens";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import styles from "./resale-workspace.module.css";
import { ResaleOperationsPanel } from "./resale-operations-panel";
import { XianyuAccountBar } from "./xianyu-account-bar";

export const resaleLabels: Record<string, string> = {
  draft: "待编辑",
  ready: "已审核",
  queued: "待发布",
  publishing: "发布中",
  published: "已发布",
  paused: "已暂停",
  blocked: "货源有变化",
  uncertain: "结果待核实",
  withdrawing: "下架中",
  withdrawn: "已下架",
};
type SourceItem = {
  id: string;
  titleRaw: string;
  titleZh: string | null;
  descriptionRaw: string | null;
  descriptionZh: string | null;
  conditionRaw: string | null;
  conditionZh: string | null;
  sourceUrl: string;
  status: string;
  priceCurrent: number;
  shippingFee: number | null;
  lastSeenAt: string;
  images: { url: string; position: number }[];
  suggestedPriceCny?: number;
};
export type ResaleListing = {
  id: string;
  itemId: string;
  version: number;
  status: string;
  humanControl: boolean;
  title: string;
  description: string;
  titleCandidates?: string[];
  contentKeywords?: string[];
  contentWarnings?: string[];
  publishAt?: string | null;
  priceCny: number;
  imageUrls: string[];
  deliveryText: string;
  shippingMode?: string;
  shippingFeeCny?: number;
  locationText?: string;
  rightsConfirmed: boolean;
  fulfillmentConfirmed: boolean;
  targetItemId: string | null;
  targetUrl: string | null;
  publishedAt: string | null;
  publishOrigin: string | null;
  requiresWithdrawal: boolean;
  lastError: string | null;
  generationError: string | null;
  generationToken: string | null;
  generationRequestedBy: string | null;
  item: SourceItem;
};
type Settings = {
  paused: boolean;
  autoImport: boolean;
  autoGenerate: boolean;
  autoPublish: boolean;
  autoMetrics?: boolean;
  titleStyle?: string;
  titleMaxLength?: number;
  excludedKeywords?: string[];
  requiredKeywords?: string[];
  dailyPublishLimit: number;
  keywords: string[];
  minPriceJpy: number;
  maxPriceJpy: number;
  exchangeRate: number;
  markupPercent: number;
  extraCostCny: number;
  sourceFreshMinutes: number;
  deliveryText: string;
  shippingMode?: string;
  shippingFeeCny?: number;
  locationText?: string;
};
type Payload = {
  listings: ResaleListing[];
  total: number;
  settings: Settings;
  counts: Record<string, number>;
  todayAttempts: number;
  publisher: {
    configured: boolean;
    mode: string;
    label: string;
    sellerActions?: string[];
  };
};
type Event = {
  id: string;
  accountId: string | null;
  detail: string;
  createdAt: string;
};
type EditDraft = Pick<
  ResaleListing,
  | "title"
  | "description"
  | "priceCny"
  | "imageUrls"
  | "deliveryText"
  | "shippingMode"
  | "shippingFeeCny"
  | "locationText"
  | "rightsConfirmed"
  | "fulfillmentConfirmed"
>;
export type ResaleRequest = <T>(
  path: string,
  method?: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<T>;
type Request = ResaleRequest;
const cny = (amount: number) =>
  `¥${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const time = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const busy = new Set(["publishing", "withdrawing", "uncertain"]);
const resaleMotion = {
  "--resale-motion-fast": `${motionTokens.duration.fast * 1000}ms`,
  "--resale-ease": `cubic-bezier(${motionTokens.easing.smooth.join(",")})`,
  "--resale-press-scale": motionTokens.scale.subtle,
} as CSSProperties;
function useResaleMotionPreference() {
  const preference = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    setMounted(true);
    const pointerInput = () => setKeyboard(false);
    const keyboardInput = () => setKeyboard(true);
    window.addEventListener("pointerdown", pointerInput, true);
    window.addEventListener("keydown", keyboardInput, true);
    return () => {
      window.removeEventListener("pointerdown", pointerInput, true);
      window.removeEventListener("keydown", keyboardInput, true);
    };
  }, []);
  // SSR and hydration share a still first frame; preferences apply after mount.
  return !mounted || Boolean(preference) || keyboard;
}
function draftOf(row: ResaleListing): EditDraft {
  return {
    title: row.title,
    description: row.description,
    priceCny: row.priceCny,
    imageUrls: row.imageUrls,
    deliveryText: row.deliveryText,
    shippingMode: row.shippingMode ?? "free",
    shippingFeeCny: row.shippingFeeCny ?? 0,
    locationText: row.locationText ?? "",
    rightsConfirmed: row.rightsConfirmed,
    fulfillmentConfirmed: row.fulfillmentConfirmed,
  };
}
export function resaleCopy(
  row: Pick<
    ResaleListing,
    "title" | "description" | "deliveryText" | "priceCny"
  >,
) {
  return `${row.title}\n\n${row.description}\n\n${row.deliveryText}\n\n售价：${cny(row.priceCny)}（人民币）`;
}

export function ResaleWorkspace({
  apiBaseUrl,
  accountId,
  onOpenMonitoring,
  onOpenSource,
  active = true,
}: {
  apiBaseUrl: string;
  accountId: string | null;
  onOpenMonitoring?: () => void;
  onOpenSource?: (itemId: string) => Promise<boolean>;
  active?: boolean;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const reduced = useResaleMotionPreference();
  const [view, setView] = useState<
    "listings" | "candidates" | "market" | "maintenance" | "metrics"
  >("listings");
  const [batchSelection, setBatchSelection] = useState<Record<string, number>>(
    {},
  );
  const [batchAction, setBatchAction] = useState("generate");
  const [batchSchedule, setBatchSchedule] = useState("");
  const [batchResults, setBatchResults] = useState<
    { id: string; ok: boolean; error?: string; title: string }[]
  >([]);
  const [candidates, setCandidates] = useState<SourceItem[]>([]);
  const [candidateTotal, setCandidateTotal] = useState(0);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidatePage, setCandidatePage] = useState(1);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const candidateSequence = useRef(0);
  const [operationListingId, setOperationListingId] = useState<string | null>(
    null,
  );
  const [operationListingTitle, setOperationListingTitle] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [resultMotion, setResultMotion] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ResaleListing | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState("");
  const running = useRef(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const focusEditorAfterTool = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [nextSelection, setNextSelection] = useState<ResaleListing | null>(
    null,
  );
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const mounted = useRef(true);
  const loadSequence = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loadSequence.current++;
    };
  }, []);
  const request: Request = useCallback(
    async (path, method = "GET", body, signal) => {
      const response = await fetch(`${apiBaseUrl}/resale${path}`, {
        method,
        cache: "no-store",
        signal: signal ?? AbortSignal.timeout(45_000),
        ...(body
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ...body, accountId }),
            }
          : {}),
      });
      if (!response.ok)
        throw new Error(await readFetchError(response, "操作失败，请重试"));
      return response.json();
    },
    [apiBaseUrl, accountId],
  );
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const sequence = ++loadSequence.current;
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: "30",
          ...(query ? { search: query } : {}),
          ...(status ? { status } : {}),
        });
        const data = await request<Payload>(
          `?${params}`,
          "GET",
          undefined,
          signal,
        );
        if (
          !mounted.current ||
          sequence !== loadSequence.current ||
          signal?.aborted
        )
          return;
        setPayload(data);
        const current = selectedRef.current;
        if (current) {
          const latest =
            data.listings.find((row) => row.id === current.id) ??
            (
              await request<{ listing: ResaleListing }>(
                `/${current.id}`,
                "GET",
                undefined,
                signal,
              )
            ).listing;
          if (
            mounted.current &&
            sequence === loadSequence.current &&
            !signal?.aborted
          )
            setSelected(latest);
        }
        setLoadError("");
      } catch (reason) {
        if (
          !signal?.aborted &&
          mounted.current &&
          sequence === loadSequence.current
        )
          setLoadError(
            reason instanceof Error ? reason.message : "加载失败，请重试",
          );
        throw reason;
      } finally {
        if (mounted.current && sequence === loadSequence.current)
          setLoading(false);
      }
    },
    [request, page, query, status],
  );
  const loadCandidates = useCallback(
    async (signal?: AbortSignal) => {
      const current = ++candidateSequence.current;
      setCandidateLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(candidatePage),
          limit: "30",
          ...(candidateQuery ? { search: candidateQuery } : {}),
        });
        const data = await request<{ items: SourceItem[]; total: number }>(
          `/candidates?${params}`,
          "GET",
          undefined,
          signal,
        );
        if (
          !signal?.aborted &&
          mounted.current &&
          current === candidateSequence.current
        ) {
          setCandidates(data.items);
          setCandidateTotal(data.total);
        }
      } catch (reason) {
        if (
          !signal?.aborted &&
          mounted.current &&
          current === candidateSequence.current
        )
          setError(reason instanceof Error ? reason.message : "读取货源失败");
      } finally {
        if (
          !signal?.aborted &&
          mounted.current &&
          current === candidateSequence.current
        )
          setCandidateLoading(false);
      }
    },
    [request, candidatePage, candidateQuery],
  );
  useEffect(() => {
    if (!active || view !== "candidates") return;
    const controller = new AbortController();
    void loadCandidates(controller.signal);
    return () => controller.abort();
  }, [active, view, loadCandidates]);
  useEffect(() => {
    setLoading(true);
    const poller = createVisibilityPoller({
      task: load,
      intervalMs: 10_000,
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
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  async function run(key: string, task: () => Promise<string | void>) {
    if (running.current) return;
    running.current = true;
    setPending(key);
    setNotice("");
    setError("");
    try {
      const message = await task();
      if (mounted.current) {
        setNotice(message ?? "操作已完成");
        await load();
      }
      return true;
    } catch (reason) {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : "操作失败，请重试");
      return false;
    } finally {
      running.current = false;
      if (mounted.current) setPending("");
    }
  }
  function choose(row: ResaleListing) {
    setDetailVisible(true);
    if (dirty && row.id !== selected?.id) {
      setNextSelection(row);
      return;
    }
    if (row.id !== selected?.id) {
      selectedRef.current = row;
      setSelected(row);
      setDirty(false);
    }
  }
  useEffect(() => {
    if (
      selected &&
      detailVisible &&
      active &&
      window.matchMedia("(max-width: 999px)").matches
    ) {
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({ block: "start" });
    }
  }, [selected?.id, detailVisible]);
  async function openListing(id: string) {
    try {
      const result = await request<{ listing: ResaleListing }>(`/${id}`);
      setView("listings");
      focusEditorAfterTool.current = true;
      choose(result.listing);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取商品失败");
    }
  }
  function openOperations(
    next: "maintenance" | "metrics",
    listingId: string | null = null,
  ) {
    setOperationListingId(listingId);
    setOperationListingTitle(listingId === selected?.id ? selected.title : "");
    setSettingsOpen(false);
    setView(next);
  }
  async function importCandidates(itemIds: string[]) {
    await run("import", async () => {
      const result = await request<{ imported: number }>("/import", "POST", {
        itemIds,
      });
      if (!result.imported) {
        await loadCandidates();
        return "商品已被收录或货源状态已变化";
      }
      const imported = await request<Payload>("?limit=100");
      const row = imported.listings.find((entry) =>
        itemIds.includes(entry.itemId),
      );
      setView("listings");
      if (row) {
        focusEditorAfterTool.current = true;
        choose(row);
      } else {
        setStatus("draft");
        setQuery("");
        setSearch("");
        setPage(1);
      }
      return `已收录 ${result.imported} 件${row ? "，可以继续编辑" : "到待编辑草稿"}`;
    });
  }
  const total = payload?.total ?? 0;
  const batchIds = Object.keys(batchSelection);
  const batchDirty =
    dirty && Boolean(selected && batchIds.includes(selected.id));
  return (
    <section
      className={styles.workspace}
      style={resaleMotion}
      data-detail-open={detailVisible}
      aria-labelledby="resale-title"
      hidden={!active}
      inert={!active}
    >
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>MERCARI → 闲鱼</span>
          <h2 id="resale-title">闲鱼运营</h2>
        </div>
        <div className={styles.headerActions}>
          <motion.button
            data-apple-motion-owned
            type="button"
            tabIndex={0}
            className={`${styles.springAction} ${detailVisible ? styles.quietAction : styles.publishAction}`}
            whileTap={
              reduced ? undefined : { scale: motionTokens.scale.subtle }
            }
            transition={reduced ? { duration: 0 } : springs.applePress}
            onClick={() => {
              setError("");
              setNotice("");
              setSettingsOpen(false);
              setView("candidates");
            }}
          >
            添加货源<span aria-hidden="true"> ＋</span>
          </motion.button>
          <button
            type="button"
            className={styles.quietAction}
            onClick={() => openOperations("metrics")}
          >
            经营概览<span aria-hidden="true"> ↗</span>
          </button>
          <details
            className={styles.workspaceTools}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                event.currentTarget.removeAttribute("open");
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.currentTarget.removeAttribute("open");
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}
          >
            <summary aria-label="更多页面操作">更多</summary>
            <div className={styles.workspaceMenu}>
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                  void load().catch(() => {});
                }}
                disabled={Boolean(pending)}
              >
                刷新
              </button>
              <button
                type="button"
                aria-expanded={settingsOpen}
                onClick={(event) => {
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                  setSettingsOpen((value) => !value);
                }}
              >
                自动化设置
              </button>
              {payload && (
                <button
                  type="button"
                  disabled={Boolean(pending) || !accountId}
                  onClick={(event) => {
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                    void run("toggle", async () => {
                      await request("/settings", "PATCH", {
                        ...payload.settings,
                        paused: !payload.settings.paused,
                      });
                      return payload.settings.paused
                        ? "自动任务已恢复"
                        : "自动任务已暂停，已发送的请求仍会回报结果";
                    });
                  }}
                >
                  {payload.settings.paused ? "恢复自动任务" : "暂停自动任务"}
                </button>
              )}
            </div>
          </details>
        </div>
      </header>
      <XianyuAccountBar
        request={request}
        accountId={accountId}
        active={active}
        onDisconnect={() => void load().catch(() => {})}
      />
      {payload && (
        <div className={styles.summary}>
          <span>
            {payload.settings.paused ? "自动任务已暂停" : "自动任务运行中"}
          </span>
          <span>
            今日发布 <b>{payload.todayAttempts}</b> /{" "}
            {payload.settings.dailyPublishLimit}
          </span>
        </div>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {(error || loadError) && (
        <p role="alert" className={styles.error}>
          {error || loadError}{" "}
          <button type="button" onClick={() => void load().catch(() => {})}>
            重试加载
          </button>
        </p>
      )}
      {payload && (
        <div hidden={!settingsOpen} inert={!settingsOpen}>
          <SettingsPanel
            settings={payload.settings}
            configured={payload.publisher.configured}
            metricsConfigured={
              payload.publisher.sellerActions?.includes("metrics") ?? false
            }
            pending={Boolean(pending) || !accountId}
            onSave={(settings) =>
              run("settings", async () => {
                await request("/settings", "PATCH", settings);
                return "自动化设置已保存";
              })
            }
            onRun={() =>
              void run(
                "tick",
                async () =>
                  (await request<{ message: string }>("/run", "POST", {}))
                    .message,
              )
            }
          />
        </div>
      )}
      <ResaleToolSheet
        open={active && view !== "listings"}
        title={
          view === "candidates" || view === "market" ? "货源与市场" : "商品经营"
        }
        onClose={() => setView("listings")}
        onClosed={() => {
          if (focusEditorAfterTool.current && active) {
            detailRef.current?.focus({ preventScroll: true });
            if (window.matchMedia("(max-width: 999px)").matches)
              detailRef.current?.scrollIntoView({ block: "start" });
          }
          focusEditorAfterTool.current = false;
        }}
      >
        <div className={styles.toolNavigation} aria-label="当前任务">
          {(view === "candidates" || view === "market"
            ? [
                ["candidates", "Mercari 货源"],
                ["market", "闲鱼参考"],
              ]
            : [
                ["maintenance", "商品维护"],
                ["metrics", "运营数据"],
              ]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => setView(key as typeof view)}
            >
              {label}
              {view === key && (
                <motion.span
                  tabIndex={-1}
                  className={styles.activeLine}
                  layoutId={reduced ? undefined : "resale-tool-active"}
                  transition={
                    reduced ? { duration: 0 } : springs.appleSelection
                  }
                />
              )}
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {notice && view === "candidates" && (
          <p role="status" className={styles.notice}>
            {notice}
          </p>
        )}
        {pending && view === "candidates" && (
          <p role="status" className={styles.notice}>
            正在收录，完成后继续编辑…
          </p>
        )}
        {operationListingId && view !== "candidates" && view !== "market" && (
          <div className={styles.selectedContext}>
            <span>当前商品</span>
            <strong>
              {operationListingTitle ||
                (selected?.id === operationListingId
                  ? selected.title
                  : "已选择运营商品")}
            </strong>
            <button
              type="button"
              onClick={() => void openListing(operationListingId)}
            >
              返回商品
            </button>
            <button
              type="button"
              onClick={() => {
                setOperationListingId(null);
                setOperationListingTitle("");
              }}
            >
              查看全部经营
            </button>
          </div>
        )}
        <div hidden={view !== "candidates"} inert={view !== "candidates"}>
          <div className={styles.sourceIntro}>
            <p>从采购库收录 Mercari 商品，继续编辑同一份上架草稿。</p>
            {onOpenMonitoring && (
              <button
                type="button"
                onClick={() => {
                  setView("listings");
                  onOpenMonitoring();
                }}
              >
                配置货源监测
              </button>
            )}
            <button
              type="button"
              disabled={!accountId || Boolean(pending) || !candidates.length}
              onClick={() =>
                void importCandidates(candidates.map((item) => item.id))
              }
            >
              收录本页
            </button>
          </div>
          <form
            className={styles.sourceSearch}
            onSubmit={(event) => {
              event.preventDefault();
              setCandidateQuery(candidateSearch.trim());
              setCandidatePage(1);
            }}
          >
            <input
              aria-label="搜索 Mercari 货源"
              placeholder="搜索 Mercari 商品"
              value={candidateSearch}
              onChange={(event) => setCandidateSearch(event.target.value)}
            />
            <button type="submit">搜索</button>
          </form>
          {candidateLoading && (
            <p role="status" className={styles.hint}>
              读取货源中…
            </p>
          )}
          <div className={styles.candidateList} aria-label="Mercari 候选列表">
            {candidates.map((item) => (
              <article className={styles.candidateRow} key={item.id}>
                {item.images[0] ? (
                  <img src={item.images[0].url} alt="" loading="lazy" />
                ) : (
                  <span className={styles.noImage}>暂无图片</span>
                )}
                <div className={styles.rowCopy}>
                  <strong>{item.titleZh || item.titleRaw}</strong>
                  <span>
                    Mercari · ¥{item.priceCurrent.toLocaleString()} 日元
                  </span>
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    查看原商品
                  </a>
                </div>
                <div className={styles.candidateAction}>
                  {item.suggestedPriceCny != null && (
                    <span>
                      建议售价 <b>{cny(item.suggestedPriceCny)}</b>
                    </span>
                  )}
                  <button
                    type="button"
                    className={styles.publishAction}
                    disabled={Boolean(pending) || !accountId}
                    onClick={() => void importCandidates([item.id])}
                  >
                    收录并编辑
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!candidateLoading && !candidates.length && (
            <div className={styles.empty}>
              <h3>暂无符合条件的货源</h3>
              <p>调整关键词或前往采购库配置 Mercari 监测。</p>
              <button type="button" onClick={() => setView("market")}>
                查看闲鱼参考
              </button>
            </div>
          )}
          <nav className={styles.pagination} aria-label="货源分页">
            <button
              type="button"
              disabled={candidatePage <= 1}
              onClick={() => setCandidatePage((value) => value - 1)}
            >
              上一页
            </button>
            <span>
              第 {candidatePage} 页 · {candidateTotal} 件
            </span>
            <button
              type="button"
              disabled={candidatePage * 30 >= candidateTotal}
              onClick={() => setCandidatePage((value) => value + 1)}
            >
              下一页
            </button>
          </nav>
        </div>
        {payload && (
          <ResaleOperationsPanel
            request={request}
            apiBaseUrl={apiBaseUrl}
            accountId={accountId}
            active={
              active && ["market", "maintenance", "metrics"].includes(view)
            }
            view={
              view === "maintenance" || view === "metrics" ? view : "market"
            }
            paused={payload.settings.paused}
            selectedListingId={operationListingId}
            onOpenListing={openListing}
            onSelectListing={(id, title) => {
              setOperationListingId(id || null);
              setOperationListingTitle(title || "");
            }}
            onOpenCandidates={() => setView("candidates")}
          />
        )}
      </ResaleToolSheet>
      <div className={styles.collectionHeading}>
        <h3>
          我的商品<span>{total}</span>
        </h3>
        <span className={styles.hint}>草稿、发布与经营在同一份商品中衔接</span>
      </div>
      <div className={styles.commerce}>
        <div className={styles.toolbar}>
          <form
            className={styles.search}
            onPointerDown={() => setResultMotion(!reduced)}
            onKeyDown={() => setResultMotion(false)}
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(search.trim());
              setPage(1);
            }}
          >
            <input
              aria-label="搜索货源或上架商品"
              placeholder="搜索商品"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button type="submit">搜索</button>
          </form>
          {
            <select
              aria-label="商品状态"
              value={status}
              onPointerDown={() => setResultMotion(!reduced)}
              onKeyDown={() => setResultMotion(false)}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">全部状态</option>
              {Object.entries(resaleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                  {payload?.counts[value] ? ` (${payload.counts[value]})` : ""}
                </option>
              ))}
            </select>
          }
          {
            <button
              type="button"
              disabled={Boolean(pending) || !payload?.listings.length}
              onClick={() => {
                const rows = payload?.listings ?? [];
                const allSelected = rows.every(
                  (row) => row.id in batchSelection,
                );
                setBatchSelection((current) => {
                  const next = { ...current };
                  for (const row of rows) {
                    if (allSelected) delete next[row.id];
                    else if (Object.keys(next).length < 50)
                      next[row.id] = row.version;
                  }
                  return next;
                });
              }}
            >
              选择 / 取消本页
            </button>
          }
        </div>
        <div className={styles.resultFeedbackSlot}>
          <AnimatePresence initial={false}>
            {(loading || query || status) && payload && (
              <motion.p
                key={`${loading ? "loading" : "ready"}:${query}:${status}:${page}:${payload.total}`}
                role="status"
                aria-live="polite"
                className={styles.resultFeedback}
                initial={
                  reduced || !resultMotion ? false : { opacity: 0, y: 4 }
                }
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={
                  reduced || !resultMotion
                    ? { duration: 0 }
                    : springs.appleSelection
                }
              >
                <span className={styles.resultMark} aria-hidden="true" />
                {loading ? "正在更新商品…" : `找到 ${payload.total} 件商品`}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        {
          <>
            {batchIds.length > 0 && (
              <div
                className={styles.batchBar}
                role="group"
                aria-label="批量商品操作"
              >
                <span>已选 {batchIds.length} 件 / 50</span>
                {batchIds.length > 0 && (
                  <>
                    <button
                      type="button"
                      disabled={Boolean(pending)}
                      onClick={() => setBatchSelection({})}
                    >
                      清空选择
                    </button>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run("bulk", async () => {
                          const result = await request<{
                            results: {
                              id: string;
                              ok: boolean;
                              error?: string;
                            }[];
                            succeeded: number;
                          }>("/bulk", "POST", {
                            listingIds: batchIds,
                            versions: batchSelection,
                            action: batchAction,
                            ...(batchAction === "enqueue" && batchSchedule
                              ? {
                                  publishAt: new Date(
                                    batchSchedule,
                                  ).toISOString(),
                                }
                              : {}),
                          });
                          setBatchResults(
                            result.results.map((row) => ({
                              ...row,
                              title:
                                payload?.listings.find(
                                  (listing) => listing.id === row.id,
                                )?.title ?? row.id,
                            })),
                          );
                          setBatchSelection((current) =>
                            Object.fromEntries(
                              Object.entries(current).filter(
                                ([id]) =>
                                  !result.results.some(
                                    (row) => row.id === id && row.ok,
                                  ),
                              ),
                            ),
                          );
                          return `批量完成 ${result.succeeded} / ${result.results.length} 件${result.succeeded < result.results.length ? "，未完成项仍保留选择" : ""}`;
                        });
                      }}
                    >
                      <select
                        aria-label="批量操作类型"
                        value={batchAction}
                        onChange={(event) => setBatchAction(event.target.value)}
                      >
                        <option value="generate">整理中文草稿</option>
                        <option value="approve">审核通过</option>
                        <option value="enqueue">加入发布队列</option>
                        <option value="recheck">核查货源</option>
                        <option value="takeover">人工接管</option>
                        <option value="pause">暂停商品</option>
                      </select>
                      {batchAction === "enqueue" && (
                        <label>
                          计划发布（本机时间，留空立即排队）
                          <input
                            type="datetime-local"
                            value={batchSchedule}
                            onChange={(event) =>
                              setBatchSchedule(event.target.value)
                            }
                          />
                        </label>
                      )}
                      <button
                        type="submit"
                        className={styles.publishAction}
                        disabled={Boolean(pending) || !accountId || batchDirty}
                      >
                        执行批量操作
                      </button>
                    </form>
                    {batchDirty && (
                      <p className={styles.warning}>
                        选中的商品有未保存修改，请先保存或从选择中移除。
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
            {batchResults.some((row) => !row.ok) && (
              <details className={styles.batchFailures} open>
                <summary>批量未完成项</summary>
                <ul>
                  {batchResults
                    .filter((row) => !row.ok)
                    .map((row) => (
                      <li key={row.id}>
                        <strong>{row.title}</strong>
                        <p>{row.error}</p>
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </>
        }
        {loading && !payload ? (
          <p role="status" className={styles.empty}>
            正在读取商品…
          </p>
        ) : (
          <div className={styles.layout} data-detail-open={detailVisible}>
            <div
              ref={listRef}
              tabIndex={-1}
              className={styles.list}
              aria-label="上架商品列表"
              data-updating={loading}
            >
              {payload?.listings.map((row) => (
                <div className={styles.listingRow} key={row.id}>
                  <label className={styles.batchCheck}>
                    <input
                      type="checkbox"
                      aria-label={`选择商品：${row.title}`}
                      checked={row.id in batchSelection}
                      disabled={
                        Boolean(pending) ||
                        (!batchSelection[row.id] && batchIds.length >= 50)
                      }
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setBatchSelection((current) => {
                          const next = { ...current };
                          if (checked) next[row.id] = row.version;
                          else delete next[row.id];
                          return next;
                        });
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.row}
                    aria-pressed={selected?.id === row.id}
                    onClick={() => choose(row)}
                  >
                    {selected?.id === row.id && (
                      <motion.span
                        tabIndex={-1}
                        aria-hidden="true"
                        className={styles.rowSelection}
                        layoutId={
                          reduced ? undefined : "resale-selected-listing"
                        }
                        transition={
                          reduced ? { duration: 0 } : springs.appleSelection
                        }
                      />
                    )}
                    {row.imageUrls[0] ? (
                      <img src={row.imageUrls[0]} alt="" loading="lazy" />
                    ) : (
                      <span className={styles.noImage}>暂无图片</span>
                    )}
                    <span className={styles.rowCopy}>
                      <strong>{row.title}</strong>
                      <b className={styles.price}>{cny(row.priceCny)}</b>
                      <span>
                        {resaleLabels[row.status]}
                        {row.humanControl ? " · 人工接管" : ""}
                      </span>
                      {row.status === "queued" && row.publishAt && (
                        <span>计划 {time(row.publishAt)}</span>
                      )}
                      {row.requiresWithdrawal && (
                        <span className={styles.warning}>
                          货源不可用，需下架
                        </span>
                      )}
                    </span>
                  </button>
                </div>
              ))}
              {!payload?.listings.length && (
                <div className={styles.empty}>
                  <h3>
                    {query || status ? "暂无符合条件的商品" : "还没有上架草稿"}
                  </h3>
                  <p>
                    {query || status
                      ? "调整搜索词或商品状态继续查看。"
                      : "从 Mercari 收录货源，再编辑并发布。"}
                  </p>
                  <button
                    type="button"
                    className={styles.publishAction}
                    onClick={() => setView("candidates")}
                  >
                    添加货源
                  </button>
                </div>
              )}
              <nav className={styles.pagination} aria-label="商品分页">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  上一页
                </button>
                <span>
                  第 {page} 页 · {total} 件
                </span>
                <button
                  type="button"
                  disabled={page * 30 >= total}
                  onClick={() => setPage((value) => value + 1)}
                >
                  下一页
                </button>
              </nav>
            </div>
            <div ref={detailRef} tabIndex={-1} className={styles.detail}>
              {selected && (
                <button
                  className={styles.backToList}
                  type="button"
                  onClick={() => {
                    setDetailVisible(false);
                    requestAnimationFrame(() => {
                      listRef.current?.focus({ preventScroll: true });
                      listRef.current?.scrollIntoView({ block: "start" });
                    });
                  }}
                >
                  返回商品列表
                </button>
              )}
              {nextSelection && (
                <div role="alert" className={styles.warning}>
                  当前修改尚未保存。
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(nextSelection);
                      setNextSelection(null);
                      setDirty(false);
                    }}
                  >
                    放弃修改并切换
                  </button>
                  <button type="button" onClick={() => setNextSelection(null)}>
                    继续编辑
                  </button>
                </div>
              )}
              {selected ? (
                <ListingEditor
                  key={selected.id}
                  listing={selected}
                  configured={payload?.publisher.configured ?? false}
                  request={request}
                  accountId={accountId}
                  onOpenSource={onOpenSource}
                  onOpenOperations={(next) => openOperations(next, selected.id)}
                  onDirty={setDirty}
                  onUpdated={(row) => {
                    setSelected(row);
                    void load().catch(() => {});
                  }}
                />
              ) : (
                <div className={styles.empty}>
                  <h3>选一件商品，继续操作</h3>
                  <p>
                    图片、文案、发布和经营都跟随商品。
                    当前列表与筛选会为你保留。
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ResaleToolSheet({
  open,
  title,
  onClose,
  onClosed,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onClosed: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reduced = useResaleMotionPreference();
  const animationRef = useRef<{ stop: () => void }[]>([]);
  const sheetY = useMotionValue(0);
  const sheetScale = useMotionValue(1);
  const sheetOpacity = useMotionValue(0);
  const generation = useRef(0);
  const scrollBefore = useRef<string | null>(null);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const displayedTitle = useRef(title);
  if (open) displayedTitle.current = title;
  const dragRef = useRef<{
    id: number;
    start: number;
    offset: number;
    last: number;
    time: number;
    velocity: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  function restoreSheet() {
    const spatial = reduced ? { duration: 0 } : springs.appleSpatial;
    animationRef.current = [
      animate(sheetY, 0, spatial),
      animate(sheetScale, 1, spatial),
      animate(sheetOpacity, 1, {
        duration: reduced ? 0 : motionTokens.duration.feedback,
      }),
    ];
  }
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const current = ++generation.current;
    animationRef.current.forEach((control) => control.stop());
    const finishClose = () => {
      if (current !== generation.current || open) return;
      dialog.close();
      if (scrollBefore.current !== null)
        document.documentElement.style.overflow = scrollBefore.current;
      scrollBefore.current = null;
      onClosedRef.current();
    };
    if (open) {
      if (!dialog.open) {
        sheetY.set(reduced ? 0 : window.innerWidth < 768 ? 32 : 16);
        sheetScale.set(reduced ? 1 : 0.975);
        sheetOpacity.set(0);
        scrollBefore.current = document.documentElement.style.overflow;
        document.documentElement.style.overflow = "hidden";
        dialog.showModal();
      }
    }
    if (!dialog.open) return;
    // Motion values keep the visible position and velocity when a sheet is redirected.
    const spatial = reduced ? { duration: 0 } : springs.appleSpatial;
    const controls = [
      animate(
        sheetY,
        open || reduced ? 0 : Math.max(16, sheetY.get() + 24),
        spatial,
      ),
      animate(sheetScale, open || reduced ? 1 : 0.975, spatial),
      animate(sheetOpacity, open ? 1 : 0, {
        duration: reduced ? 0 : motionTokens.duration.feedback,
        ease: motionTokens.easing.smooth,
      }),
    ];
    animationRef.current = controls;
    if (!open)
      void Promise.all(controls)
        .then(finishClose)
        .catch(() => {});
  }, [open, reduced, sheetY, sheetScale, sheetOpacity]);
  useEffect(
    () => () => {
      generation.current++;
      animationRef.current.forEach((control) => control.stop());
      dialogRef.current?.close();
      if (scrollBefore.current !== null)
        document.documentElement.style.overflow = scrollBefore.current;
    },
    [],
  );
  return (
    <motion.dialog
      ref={dialogRef}
      tabIndex={-1}
      initial={false}
      className={styles.toolSheet}
      data-dragging={dragging}
      style={{ y: sheetY, scale: sheetScale, opacity: sheetOpacity }}
      aria-labelledby="resale-tool-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <header
        className={styles.sheetHeader}
        onPointerDown={(event) => {
          if (
            !open ||
            window.innerWidth >= 768 ||
            (event.target as Element).closest("button,a,input,select")
          )
            return;
          event.preventDefault();
          animationRef.current.forEach((control) => control.stop());
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            id: event.pointerId,
            start: event.clientY,
            offset: sheetY.get(),
            last: event.clientY,
            time: event.timeStamp,
            velocity: 0,
          };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.id !== event.pointerId) return;
          const elapsed = Math.max(1, event.timeStamp - drag.time);
          drag.velocity = (event.clientY - drag.last) / elapsed;
          drag.last = event.clientY;
          drag.time = event.timeStamp;
          const distance = event.clientY - drag.start + drag.offset;
          const y = distance < 0 ? Math.max(-10, distance * 0.2) : distance;
          sheetY.set(y);
          sheetOpacity.set(1 - Math.min(Math.max(0, y) / 600, 0.16));
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.id !== event.pointerId) return;
          dragRef.current = null;
          setDragging(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
          if (sheetY.get() > 72 || (sheetY.get() > 20 && drag.velocity > 0.55))
            onClose();
          else restoreSheet();
        }}
        onPointerCancel={(event) => {
          if (!dragRef.current || dragRef.current.id !== event.pointerId)
            return;
          dragRef.current = null;
          setDragging(false);
          restoreSheet();
        }}
      >
        <div>
          <span className={styles.eyebrow}>闲鱼运营</span>
          <h3 id="resale-tool-title">{displayedTitle.current}</h3>
        </div>
        <button
          type="button"
          className={styles.sheetClose}
          aria-label="关闭运营工具"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className={styles.sheetBody}>{children}</div>
    </motion.dialog>
  );
}

function SettingsPanel({
  settings,
  configured,
  metricsConfigured,
  pending,
  onSave,
  onRun,
}: {
  settings: Settings;
  configured: boolean;
  metricsConfigured: boolean;
  pending: boolean;
  onSave: (settings: Settings) => Promise<boolean | undefined>;
  onRun: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [keywords, setKeywords] = useState(settings.keywords.join("\n"));
  const [excluded, setExcluded] = useState(
    (settings.excludedKeywords ?? []).join("\n"),
  );
  const [required, setRequired] = useState(
    (settings.requiredKeywords ?? []).join("\n"),
  );
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) {
      setDraft(settings);
      setKeywords(settings.keywords.join("\n"));
      setExcluded((settings.excludedKeywords ?? []).join("\n"));
      setRequired((settings.requiredKeywords ?? []).join("\n"));
    }
  }, [settings, dirty]);
  function patch(key: keyof Settings, value: Settings[keyof Settings]) {
    setDirty(true);
    setDraft((current) => ({ ...current, [key]: value }));
  }
  return (
    <form
      className={styles.settings}
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({
          ...draft,
          excludedKeywords: [
            ...new Set(
              excluded
                .split(/\n|,|，/)
                .map((word) => word.trim())
                .filter(Boolean),
            ),
          ],
          requiredKeywords: [
            ...new Set(
              required
                .split(/\n|,|，/)
                .map((word) => word.trim())
                .filter(Boolean),
            ),
          ],
          keywords: Array.from(
            new Set(
              keywords
                .split(/\n|,/)
                .map((word) => word.trim())
                .filter(Boolean),
            ),
          ),
        }).then((saved) => {
          if (saved) setDirty(false);
        });
      }}
    >
      <h3>自动化设置</h3>
      <div className={styles.fields}>
        <label>
          默认发货方式
          <select
            aria-label="默认发货方式"
            value={draft.shippingMode ?? "free"}
            onChange={(event) => patch("shippingMode", event.target.value)}
          >
            <option value="free">包邮</option>
            <option value="fixed">固定运费</option>
            <option value="distance">按距离计费</option>
            <option value="none">无需邮寄</option>
          </select>
        </label>
        {draft.shippingMode === "fixed" && (
          <label>
            默认运费（元）
            <input
              type="number"
              min="0"
              max="100000"
              step="0.01"
              value={draft.shippingFeeCny ?? 0}
              onChange={(event) =>
                patch("shippingFeeCny", Number(event.target.value))
              }
            />
          </label>
        )}
        <label>
          默认宝贝所在地
          <input
            maxLength={120}
            placeholder="沿用闲鱼账号选择"
            value={draft.locationText ?? ""}
            onChange={(event) => patch("locationText", event.target.value)}
          />
        </label>
      </div>
      <div className={styles.checks}>
        {(
          [
            ["autoImport", "自动收录监测货源"],
            ["autoGenerate", "自动整理已有译文"],
            ["autoPublish", "自动发布已审核且入队的商品"],
            ["autoMetrics", "每小时同步已发布商品的运营指标"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={Boolean(draft[key])}
              disabled={
                (key === "autoPublish" && !configured) ||
                (key === "autoMetrics" && !metricsConfigured)
              }
              onChange={(event) => patch(key, event.target.checked)}
            />
            {label}
          </label>
        ))}
      </div>
      <details className={styles.moreActions}>
        <summary>货源与定价规则</summary>
        <div className={styles.fields}>
          <label>
            生成标题长度上限（本系统配置）
            <input
              type="number"
              min="15"
              max="60"
              required
              value={draft.titleMaxLength ?? 40}
              onChange={(event) =>
                patch("titleMaxLength", Number(event.target.value))
              }
            />
          </label>
          <label>
            每日发布请求额度
            <input
              type="number"
              min="1"
              max="1000"
              required
              value={draft.dailyPublishLimit}
              onChange={(event) =>
                patch("dailyPublishLimit", Number(event.target.value))
              }
            />
          </label>
          <label>
            汇率（1日元兑人民币）
            <input
              type="number"
              min="0.001"
              max="1"
              step="0.0001"
              required
              value={draft.exchangeRate}
              onChange={(event) =>
                patch("exchangeRate", Number(event.target.value))
              }
            />
          </label>
          <label>
            加价比例（%）
            <input
              type="number"
              min="0"
              max="1000"
              step="0.1"
              required
              value={draft.markupPercent}
              onChange={(event) =>
                patch("markupPercent", Number(event.target.value))
              }
            />
          </label>
          <label>
            额外成本（人民币）
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={draft.extraCostCny}
              onChange={(event) =>
                patch("extraCostCny", Number(event.target.value))
              }
            />
          </label>
          <label>
            货源最低价（日元）
            <input
              type="number"
              min="0"
              required
              value={draft.minPriceJpy}
              onChange={(event) =>
                patch("minPriceJpy", Number(event.target.value))
              }
            />
          </label>
          <label>
            货源最高价（日元）
            <input
              type="number"
              min="1"
              required
              value={draft.maxPriceJpy}
              onChange={(event) =>
                patch("maxPriceJpy", Number(event.target.value))
              }
            />
          </label>
          <label>
            货源核查有效期（分钟）
            <input
              type="number"
              min="1"
              max="120"
              required
              value={draft.sourceFreshMinutes}
              onChange={(event) =>
                patch("sourceFreshMinutes", Number(event.target.value))
              }
            />
          </label>
          <label>
            匹配关键词（每行一个，留空匹配全部）
            <textarea
              rows={3}
              value={keywords}
              onChange={(event) => {
                setDirty(true);
                setKeywords(event.target.value);
              }}
            />
          </label>
          <label>
            必须包含的货源关键词（每行一个）
            <textarea
              rows={3}
              value={required}
              onChange={(event) => {
                setDirty(true);
                setRequired(event.target.value);
              }}
            />
          </label>
          <label>
            排除货源关键词（每行一个）
            <textarea
              rows={3}
              value={excluded}
              onChange={(event) => {
                setDirty(true);
                setExcluded(event.target.value);
              }}
            />
          </label>
        </div>
        <label>
          默认交付说明
          <textarea
            rows={2}
            maxLength={2000}
            placeholder="填写实际采购、运输和预计交付时间"
            value={draft.deliveryText}
            onChange={(event) => patch("deliveryText", event.target.value)}
          />
        </label>
        <p>
          建议售价 =（货源价 + 已知日本邮费）×
          汇率，加额外成本后按加价比例计算。未知邮费、国际运费和税费需补充确认；更改规则不会覆盖已有草稿。
        </p>
      </details>
      <div className={styles.actions}>
        <button
          className={styles.primary}
          type="submit"
          disabled={pending || !dirty}
        >
          保存设置
        </button>
        <button type="button" disabled={pending} onClick={onRun}>
          执行一轮任务
        </button>
      </div>
    </form>
  );
}

function ListingEditor({
  listing,
  configured,
  request,
  accountId,
  onDirty,
  onUpdated,
  onOpenSource,
  onOpenOperations,
}: {
  listing: ResaleListing;
  configured: boolean;
  request: Request;
  accountId: string | null;
  onDirty: (dirty: boolean) => void;
  onUpdated: (listing: ResaleListing) => void;
  onOpenSource?: (itemId: string) => Promise<boolean>;
  onOpenOperations: (view: "maintenance" | "metrics") => void;
}) {
  const [draft, setDraft] = useState<EditDraft>(() => draftOf(listing));
  const [version, setVersion] = useState(listing.version);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [targetId, setTargetId] = useState(listing.targetItemId ?? "");
  const [targetUrl, setTargetUrl] = useState(listing.targetUrl ?? "");
  const [events, setEvents] = useState<Event[]>([]);
  const [preview, setPreview] = useState(false);
  const [animatePreview, setAnimatePreview] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [photoMotion, setPhotoMotion] = useState(false);
  const [photoNotice, setPhotoNotice] = useState("");
  const [photoDirection, setPhotoDirection] = useState(1);
  const reduced = useResaleMotionPreference();
  const [publishSchedule, setPublishSchedule] = useState("");
  const editFormRef = useRef<HTMLFormElement>(null);
  const alive = useRef(true);
  const stale = dirty && listing.version !== version;
  const locked = busy.has(listing.status) || listing.status === "published";
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty) {
      setDraft(draftOf(listing));
      setVersion(listing.version);
    }
  }, [listing, dirty]);
  useEffect(() => {
    const controller = new AbortController();
    void request<{ events: Event[] }>(
      `/${listing.id}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setEvents(result.events);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [listing.id, listing.version, request]);
  useEffect(() => {
    onDirty(dirty);
    if (!dirty) setPhotoNotice("");
  }, [dirty, onDirty]);
  function patch<K extends keyof EditDraft>(key: K, value: EditDraft[K]) {
    setDirty(true);
    setDraft((current) => ({ ...current, [key]: value }));
  }
  async function operate(action: string, extra: Record<string, unknown> = {}) {
    if (
      pending ||
      !accountId ||
      (action === "save" &&
        (locked || stale || draft.imageUrls.filter(Boolean).length > 9))
    )
      return;
    setPending(action);
    setError("");
    setMessage("");
    try {
      const result =
        action === "save"
          ? await request<{ listing: ResaleListing }>(
              `/${listing.id}`,
              "PATCH",
              { ...draft, version },
            )
          : await request<{ listing: ResaleListing; message?: string }>(
              `/${listing.id}/actions`,
              "POST",
              { version: listing.version, action, ...extra },
            );
      if (!alive.current) return;
      setDirty(false);
      setDraft(draftOf(result.listing));
      setVersion(result.listing.version);
      onUpdated(result.listing);
      setMessage(
        "message" in result && typeof result.message === "string"
          ? result.message
          : action === "save"
            ? "已保存，商品由人工接管"
            : "操作已完成",
      );
    } catch (reason) {
      if (alive.current)
        setError(
          reason instanceof Error ? reason.message : "操作失败，修改仍保留",
        );
    } finally {
      if (alive.current) setPending("");
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(resaleCopy({ ...listing, ...draft }));
      setMessage("已复制标题、描述、交付说明和售价");
    } catch {
      setError("复制失败，请直接选择文案复制");
    }
  }
  const canAct = !dirty && !pending && Boolean(accountId);
  const selectedPhoto = Math.max(
    0,
    Math.min(photoIndex, draft.imageUrls.length - 1),
  );
  const generating = Boolean(
    listing.generationToken || listing.generationRequestedBy,
  );
  const canSave =
    dirty &&
    !stale &&
    !pending &&
    Boolean(accountId) &&
    draft.imageUrls.filter(Boolean).length <= 9;
  const usePrepareAction =
    !configured &&
    draft.rightsConfirmed &&
    draft.fulfillmentConfirmed &&
    !generating;
  function submitSave() {
    setPreview(false);
    requestAnimationFrame(() => editFormRef.current?.requestSubmit());
  }
  async function prepareInXianyu() {
    const imageCount = draft.imageUrls.filter(Boolean).length;
    if (
      pending ||
      locked ||
      stale ||
      !accountId ||
      !usePrepareAction ||
      imageCount === 0 ||
      imageCount > 9
    )
      return;
    if (!editFormRef.current?.checkValidity()) {
      setPreview(false);
      requestAnimationFrame(() => editFormRef.current?.reportValidity());
      return;
    }
    setPending("prepare");
    setError("");
    setMessage("");
    try {
      let savedListing = listing;
      if (dirty) {
        const saved = await request<{ listing: ResaleListing }>(
          `/${listing.id}`,
          "PATCH",
          { ...draft, version },
        );
        if (!alive.current) return;
        savedListing = saved.listing;
        setDraft(draftOf(savedListing));
        setVersion(savedListing.version);
        setDirty(false);
        onUpdated(savedListing);
      }
      const prepared = await request<{ message: string }>(
        `/${listing.id}/prepare`,
        "POST",
        { version: savedListing.version },
      );
      if (alive.current) setMessage(prepared.message);
    } catch (reason) {
      if (alive.current)
        setError(
          reason instanceof Error ? reason.message : "请在闲鱼页面继续完成",
        );
    } finally {
      if (alive.current) setPending("");
    }
  }
  function movePhoto(destination: number, pointer: boolean) {
    const urls = [...draft.imageUrls];
    const [url] = urls.splice(selectedPhoto, 1);
    urls.splice(destination, 0, url);
    patch("imageUrls", urls);
    setPhotoIndex(destination);
    setPhotoMotion(pointer);
    setPhotoNotice(
      destination === 0
        ? "封面已更新，保存后生效"
        : `图片已移到第 ${destination + 1} 张，保存后生效`,
    );
  }
  function selectPhoto(index: number, pointer: boolean) {
    setPhotoDirection(index > selectedPhoto ? 1 : -1);
    setPhotoMotion(pointer);
    setPhotoIndex(index);
  }
  function setPreviewMode(value: boolean, pointer: boolean) {
    setAnimatePreview(pointer);
    setPreview(value);
  }
  return (
    <section aria-label="编辑上架商品" className={styles.editor}>
      <div className={styles.editorHeading}>
        <div>
          <span className={styles.eyebrow}>
            {listing.status === "published" ? "发布后经营" : "上架准备"}
          </span>
          <h3>{listing.status === "published" ? "商品与经营" : "商品编辑"}</h3>
        </div>
        <span className={styles.editorStatus}>
          {resaleLabels[listing.status]}
        </span>
      </div>
      {listing.status === "published" && (
        <div className={styles.publishedActions}>
          <button
            type="button"
            className={styles.publishAction}
            onClick={() => onOpenOperations("maintenance")}
          >
            维护商品<span aria-hidden="true"> ↗</span>
          </button>
          <button type="button" onClick={() => onOpenOperations("metrics")}>
            查看运营数据<span aria-hidden="true"> ↗</span>
          </button>
        </div>
      )}
      <div className={styles.editorModes} aria-label="编辑与预览">
        <button
          type="button"
          aria-pressed={!preview}
          onClick={(event) => setPreviewMode(false, event.detail > 0)}
        >
          {!preview && (
            <motion.span
              tabIndex={-1}
              aria-hidden="true"
              className={styles.modeSelection}
              layoutId={
                reduced ? undefined : `resale-editor-mode-${listing.id}`
              }
              transition={
                reduced || !animatePreview
                  ? { duration: 0 }
                  : springs.appleSelection
              }
            />
          )}
          编辑商品
        </button>
        <button
          type="button"
          aria-pressed={preview}
          onClick={(event) => setPreviewMode(true, event.detail > 0)}
        >
          {preview && (
            <motion.span
              tabIndex={-1}
              aria-hidden="true"
              className={styles.modeSelection}
              layoutId={
                reduced ? undefined : `resale-editor-mode-${listing.id}`
              }
              transition={
                reduced || !animatePreview
                  ? { duration: 0 }
                  : springs.appleSelection
              }
            />
          )}
          商品预览
        </button>
        <motion.span
          tabIndex={-1}
          key={dirty ? "dirty" : "saved"}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            duration: reduced ? 0 : motionTokens.duration.feedback,
          }}
        >
          {dirty ? "有未保存的修改" : "已保存"}
        </motion.span>
      </div>
      {listing.requiresWithdrawal && (
        <p role="alert" className={styles.warning}>
          货源已不可用，请下架对应闲鱼商品。
        </p>
      )}
      {listing.lastError && (
        <p className={styles.warning}>{listing.lastError}</p>
      )}
      {listing.generationError && (
        <p className={styles.warning}>{listing.generationError}</p>
      )}
      {(listing.generationToken || listing.generationRequestedBy) && (
        <p role="status">文案正在排队或生成。保存人工修改会保留你的版本。</p>
      )}
      {stale && (
        <div role="alert" className={styles.warning}>
          商品已被后台或另一位管理者更新。你的输入仍保留，可复制后重新加载。
          <button
            type="button"
            onClick={() => {
              setDraft(draftOf(listing));
              setVersion(listing.version);
              setDirty(false);
            }}
          >
            放弃当前修改并加载新版本
          </button>
        </div>
      )}
      <details className={styles.source}>
        <summary>查看 Mercari 原始信息</summary>
        {onOpenSource && (
          <button
            type="button"
            disabled={Boolean(pending)}
            onClick={() => {
              setPending("source");
              void onOpenSource(listing.itemId)
                .then((opened) => {
                  if (!opened) setError("货源详情暂不可用，请打开原商品查看");
                })
                .catch(() => setError("货源详情加载失败，请重试"))
                .finally(() => setPending(""));
            }}
          >
            在采购平台查看货源
          </button>
        )}
        <a
          href={listing.item.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          打开货源商品
        </a>
        <dl>
          <div>
            <dt>货源状态</dt>
            <dd>
              {(
                {
                  active: "在售",
                  sold: "已售出",
                  ended: "已结束",
                  reserved: "已预订",
                  unknown: "待核查",
                } as Record<string, string>
              )[listing.item.status] ?? "待核查"}
            </dd>
          </div>
          <div>
            <dt>标价（日元）</dt>
            <dd>¥{listing.item.priceCurrent.toLocaleString()}</dd>
          </div>
          <div>
            <dt>日本邮费（日元）</dt>
            <dd>
              {listing.item.shippingFee === null
                ? "待确认"
                : `¥${listing.item.shippingFee}`}
            </dd>
          </div>
          <div>
            <dt>最近可靠观测</dt>
            <dd>{time(listing.item.lastSeenAt)}</dd>
          </div>
        </dl>
        <p>{listing.item.titleRaw}</p>
        <p className={styles.raw}>
          {listing.item.descriptionRaw || "货源未提供完整描述"}
        </p>
        <p>
          {listing.item.conditionZh ||
            listing.item.conditionRaw ||
            "成色待确认"}
        </p>
      </details>
      {preview && (
        <motion.article
          aria-label="商品预览内容"
          className={styles.productPreview}
          initial={reduced || !animatePreview ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduced || !animatePreview ? { duration: 0 } : springs.appleSpatial
          }
        >
          <div className={styles.previewPhotos}>
            <div className={styles.previewMedia}>
              {draft.imageUrls[selectedPhoto] &&
              /^https?:\/\//.test(draft.imageUrls[selectedPhoto]) ? (
                <motion.img
                  tabIndex={-1}
                  key={draft.imageUrls[selectedPhoto]}
                  src={draft.imageUrls[selectedPhoto]}
                  alt={`商品预览图片 ${selectedPhoto + 1}`}
                  initial={
                    reduced || !photoMotion
                      ? false
                      : { opacity: 0, x: photoDirection * 16, scale: 0.985 }
                  }
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  transition={
                    reduced || !photoMotion
                      ? { duration: 0 }
                      : springs.appleSelection
                  }
                />
              ) : (
                <p>尚未选择有效图片</p>
              )}
            </div>
            {draft.imageUrls.length > 1 && (
              <div className={styles.previewPager}>
                <button
                  type="button"
                  disabled={selectedPhoto === 0}
                  onClick={(event) =>
                    selectPhoto(selectedPhoto - 1, event.detail > 0)
                  }
                >
                  上一张
                </button>
                <span>
                  {selectedPhoto + 1} / {draft.imageUrls.length}
                </span>
                <button
                  type="button"
                  disabled={selectedPhoto === draft.imageUrls.length - 1}
                  onClick={(event) =>
                    selectPhoto(selectedPhoto + 1, event.detail > 0)
                  }
                >
                  下一张
                </button>
              </div>
            )}
          </div>
          <div className={styles.previewCopy}>
            <b className={styles.previewPrice}>
              {cny(draft.priceCny)}
              <small>人民币</small>
            </b>
            <h4>{draft.title || "请填写商品标题"}</h4>
            <p className={styles.previewDescription}>
              {draft.description || "请填写商品描述"}
            </p>
            <div className={styles.previewDelivery}>
              <h4>交付说明</h4>
              <p>{draft.deliveryText || "待填写"}</p>
            </div>
            <p className={styles.hint}>
              本平台内容预览，实际展示以闲鱼发布结果为准。
              {dirty ? "当前包含未保存的修改。" : ""}
            </p>
          </div>
        </motion.article>
      )}
      <motion.form
        ref={editFormRef}
        id={`resale-edit-${listing.id}`}
        hidden={preview}
        inert={preview}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void operate("save");
        }}
        className={styles.editForm}
        initial={false}
        animate={{
          opacity: preview ? 0 : 1,
          y: reduced || !animatePreview || !preview ? 0 : -6,
        }}
        transition={{
          duration:
            reduced || !animatePreview ? 0 : motionTokens.duration.feedback,
        }}
      >
        <fieldset disabled={locked || Boolean(pending) || !accountId}>
          <section className={styles.photoSection} aria-label="商品图片管理">
            <div className={styles.sectionHeading}>
              <h4>商品图片</h4>
              <span>{draft.imageUrls.filter(Boolean).length} / 9</span>
            </div>
            <div className={styles.photoGrid}>
              {draft.imageUrls.map((url, index) => (
                <motion.button
                  data-apple-motion-owned
                  type="button"
                  tabIndex={0}
                  key={`${url}:${draft.imageUrls.slice(0, index).filter((candidate) => candidate === url).length}`}
                  className={styles.photoTile}
                  layout={reduced || !photoMotion ? false : "position"}
                  animate={{
                    y:
                      !reduced && photoMotion && selectedPhoto === index
                        ? -3
                        : 0,
                  }}
                  whileTap={
                    reduced ? undefined : { scale: motionTokens.scale.subtle }
                  }
                  transition={
                    reduced || !photoMotion
                      ? { duration: 0 }
                      : springs.appleSelection
                  }
                  aria-label={`选择第 ${index + 1} 张图片${index === 0 ? "，封面" : ""}`}
                  aria-pressed={selectedPhoto === index}
                  onClick={(event) => selectPhoto(index, event.detail > 0)}
                >
                  {selectedPhoto === index && (
                    <motion.span
                      tabIndex={-1}
                      aria-hidden="true"
                      className={styles.photoSelection}
                      layoutId={
                        reduced
                          ? undefined
                          : `resale-photo-selected-${listing.id}`
                      }
                      transition={
                        reduced || !photoMotion
                          ? { duration: 0 }
                          : springs.appleSelection
                      }
                    />
                  )}
                  {/^https?:\/\//.test(url) ? (
                    <img
                      src={url}
                      alt={`上架图片 ${index + 1}`}
                      loading="lazy"
                    />
                  ) : (
                    <span>链接待修正</span>
                  )}
                  {index === 0 ? (
                    <motion.span
                      tabIndex={-1}
                      aria-hidden="true"
                      className={styles.photoCaption}
                      layoutId={
                        reduced || !photoMotion
                          ? undefined
                          : `resale-photo-cover-${listing.id}`
                      }
                      transition={
                        reduced || !photoMotion
                          ? { duration: 0 }
                          : springs.appleSelection
                      }
                    >
                      封面
                    </motion.span>
                  ) : (
                    <span className={styles.photoCaption}>{index + 1}</span>
                  )}
                </motion.button>
              ))}
              {!draft.imageUrls.length && (
                <p className={styles.photoEmpty}>
                  从货源选择图片，或展开下方链接添加。
                </p>
              )}
            </div>
            <details className={styles.imageLinks}>
              <summary>管理图片</summary>
              {draft.imageUrls.length > 0 && (
                <div className={styles.photoActions} aria-label="所选图片操作">
                  <span>第 {selectedPhoto + 1} 张</span>
                  <button
                    type="button"
                    disabled={selectedPhoto === 0}
                    onClick={(event) => movePhoto(0, event.detail > 0)}
                  >
                    设为封面
                  </button>
                  <button
                    type="button"
                    disabled={selectedPhoto === 0}
                    onClick={(event) =>
                      movePhoto(selectedPhoto - 1, event.detail > 0)
                    }
                  >
                    前移
                  </button>
                  <button
                    type="button"
                    disabled={selectedPhoto === draft.imageUrls.length - 1}
                    onClick={(event) =>
                      movePhoto(selectedPhoto + 1, event.detail > 0)
                    }
                  >
                    后移
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      setPhotoMotion(event.detail > 0);
                      setPhotoNotice("图片已移除，保存后生效");
                      patch(
                        "imageUrls",
                        draft.imageUrls.filter(
                          (_, index) => index !== selectedPhoto,
                        ),
                      );
                      setPhotoIndex(Math.max(0, selectedPhoto - 1));
                    }}
                  >
                    移除
                  </button>
                </div>
              )}
              <label>
                图片链接（每行一个，最多9张）
                <textarea
                  rows={3}
                  value={draft.imageUrls.join("\n")}
                  onChange={(event) =>
                    patch("imageUrls", event.target.value.split("\n"))
                  }
                  onBlur={() => {
                    const urls = draft.imageUrls
                      .map((url) => url.trim())
                      .filter(Boolean);
                    if (
                      JSON.stringify(urls) !== JSON.stringify(draft.imageUrls)
                    )
                      patch("imageUrls", urls);
                  }}
                />
              </label>
              {draft.imageUrls.filter(Boolean).length > 9 && (
                <p role="alert" className={styles.error}>
                  本模块每件商品最多保存 9 张图片，请移除多余链接。
                </p>
              )}
              {listing.item.images.length > 0 && (
                <button
                  type="button"
                  onClick={(event) => {
                    setPhotoMotion(event.detail > 0);
                    setPhotoNotice("货源图片已恢复，保存后生效");
                    patch(
                      "imageUrls",
                      listing.item.images.slice(0, 9).map((image) => image.url),
                    );
                    setPhotoIndex(0);
                  }}
                >
                  使用货源图片
                </button>
              )}
            </details>
            {photoNotice && (
              <motion.p
                key={photoNotice}
                className={styles.photoFeedback}
                role="status"
                initial={reduced || !photoMotion ? false : { opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                transition={
                  reduced || !photoMotion
                    ? { duration: 0 }
                    : springs.appleSelection
                }
              >
                {photoNotice}
              </motion.p>
            )}
          </section>
          <div className={styles.sectionHeading}>
            <h4>商品信息</h4>
          </div>
          <label>
            <span className={styles.labelLine}>
              标题 <small>{draft.title.length} / 60</small>
            </span>
            <input
              aria-label="标题"
              required
              maxLength={60}
              placeholder="品牌、品名、型号，写清商品特点"
              value={draft.title}
              onChange={(event) => patch("title", event.target.value)}
            />
          </label>
          {(listing.titleCandidates?.length ?? 0) > 0 && (
            <details className={styles.titleSuggestions}>
              <summary>
                标题建议（{listing.titleCandidates!.length} 个）
              </summary>
              <p className={styles.hint}>点击替换当前标题，保存后生效。</p>
              <div>
                {listing.titleCandidates!.map((title, index) => (
                  <button
                    key={`${index}:${title}`}
                    type="button"
                    aria-pressed={draft.title === title}
                    onClick={() => patch("title", title)}
                  >
                    {title}
                  </button>
                ))}
              </div>
              {!!listing.contentKeywords?.length && (
                <p className={styles.hint}>
                  建议检索词：{listing.contentKeywords.join(" · ")}
                </p>
              )}
            </details>
          )}
          {!!listing.contentWarnings?.length && (
            <div className={styles.warning}>
              <h4>待确认信息</h4>
              <ul>
                {listing.contentWarnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          <label>
            商品描述
            <textarea
              placeholder="说明成色、配件、瑕疵和购买须知"
              required
              maxLength={10000}
              rows={6}
              value={draft.description}
              onChange={(event) => patch("description", event.target.value)}
            />
          </label>
          <div className={styles.sectionHeading}>
            <h4>售价与交付</h4>
          </div>
          <div className={styles.saleFields}>
            <label>
              售价（人民币）
              <input
                required
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                max="10000000"
                value={draft.priceCny}
                onChange={(event) =>
                  patch("priceCny", Number(event.target.value))
                }
              />
            </label>
            <label>
              交付方式和预计时间
              <textarea
                rows={3}
                maxLength={2000}
                value={draft.deliveryText}
                onChange={(event) => patch("deliveryText", event.target.value)}
              />
            </label>
          </div>
          <details className={styles.moreActions}>
            <summary>运费与所在地</summary>
            <div className={styles.fields}>
              <label>
                发货方式
                <select
                  aria-label="发货方式"
                  value={draft.shippingMode ?? "free"}
                  onChange={(event) =>
                    patch("shippingMode", event.target.value)
                  }
                >
                  <option value="free">包邮</option>
                  <option value="fixed">固定运费</option>
                  <option value="distance">按距离计费</option>
                  <option value="none">无需邮寄</option>
                </select>
              </label>
              {draft.shippingMode === "fixed" && (
                <label>
                  运费（元）
                  <input
                    type="number"
                    min="0"
                    max="100000"
                    step="0.01"
                    value={draft.shippingFeeCny ?? 0}
                    onChange={(event) =>
                      patch("shippingFeeCny", Number(event.target.value))
                    }
                  />
                </label>
              )}
              <label>
                宝贝所在地
                <input
                  maxLength={120}
                  placeholder="沿用闲鱼账号选择"
                  value={draft.locationText ?? ""}
                  onChange={(event) =>
                    patch("locationText", event.target.value)
                  }
                />
              </label>
            </div>
          </details>
          <div className={styles.checks}>
            <label>
              <input
                type="checkbox"
                checked={draft.rightsConfirmed}
                onChange={(event) =>
                  patch("rightsConfirmed", event.target.checked)
                }
              />
              确认商品和图片可用于销售
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.fulfillmentConfirmed}
                onChange={(event) =>
                  patch("fulfillmentConfirmed", event.target.checked)
                }
              />
              已核对货源、成本和交付
            </label>
          </div>
        </fieldset>
      </motion.form>
      <details className={styles.moreActions}>
        <summary>更多商品操作</summary>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={!canAct}
            onClick={() =>
              void operate(listing.humanControl ? "resume" : "takeover")
            }
          >
            {listing.humanControl ? "交回自动流程" : "人工接管"}
          </button>
          <button type="button" onClick={() => void copy()}>
            复制上架文案
          </button>
          {!locked && (
            <>
              {!configured && !["ready", "queued"].includes(listing.status) && (
                <button
                  type="button"
                  disabled={!canAct || generating}
                  onClick={() => void operate("approve")}
                >
                  审核通过
                </button>
              )}
              {dirty && (
                <button
                  type="button"
                  disabled={Boolean(pending)}
                  onClick={() => {
                    setDraft(draftOf(listing));
                    setVersion(listing.version);
                    setDirty(false);
                  }}
                >
                  放弃修改
                </button>
              )}
              <button
                type="button"
                disabled={
                  !canAct ||
                  Boolean(
                    listing.generationToken || listing.generationRequestedBy,
                  )
                }
                onClick={() => void operate("generate")}
              >
                整理中文草稿
              </button>
              <button
                type="button"
                disabled={!canAct}
                onClick={() => void operate("recheck")}
              >
                重新核查货源
              </button>
              {listing.status === "ready" && (
                <form
                  className={styles.scheduleForm}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void operate(
                      "enqueue",
                      publishSchedule
                        ? { publishAt: new Date(publishSchedule).toISOString() }
                        : {},
                    );
                  }}
                >
                  <label>
                    计划发布（本机时间，留空立即排队）
                    <input
                      type="datetime-local"
                      value={publishSchedule}
                      onChange={(event) =>
                        setPublishSchedule(event.target.value)
                      }
                      disabled={!canAct}
                    />
                  </label>
                  <button type="submit" disabled={!canAct}>
                    加入发布队列
                  </button>
                </form>
              )}
              <button
                type="button"
                disabled={!canAct}
                onClick={() => void operate("pause")}
              >
                暂停此商品
              </button>
            </>
          )}
          {listing.targetUrl && listing.status !== "published" && (
            <a
              href={listing.targetUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              查看闲鱼商品
            </a>
          )}
          {configured &&
            listing.status === "published" &&
            listing.publishOrigin === "bridge" && (
              <button
                type="button"
                disabled={!canAct}
                onClick={() => void operate("withdraw")}
              >
                下架闲鱼商品
              </button>
            )}
        </div>
      </details>
      {listing.status === "queued" && listing.publishAt && (
        <p className={styles.hint}>
          计划发布时间：{time(listing.publishAt)}
          （本机时间）。任务暂停或渠道未连接时保留在队列。
        </p>
      )}
      <details
        className={styles.manual}
        open={listing.status === "uncertain" || listing.requiresWithdrawal}
      >
        <summary>手动发布与结果核实</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void operate("record", { targetItemId: targetId, targetUrl });
          }}
        >
          <label>
            闲鱼商品链接
            <input
              required
              type="url"
              placeholder="https://www.goofish.com/item?id=…"
              value={targetUrl}
              onChange={(event) => {
                setTargetUrl(event.target.value);
                try {
                  setTargetId(
                    new URL(event.target.value).searchParams.get("id") ?? "",
                  );
                } catch {
                  setTargetId("");
                }
              }}
            />
          </label>
          <button
            type="submit"
            disabled={
              !canAct || ["publishing", "withdrawing"].includes(listing.status)
            }
          >
            确认已在闲鱼发布
          </button>
        </form>
        <div className={styles.actions}>
          {["published", "uncertain"].includes(listing.status) && (
            <button
              type="button"
              disabled={!canAct}
              onClick={() => void operate("confirm_withdrawn")}
            >
              确认已在闲鱼下架
            </button>
          )}
          {listing.status === "uncertain" && (
            <button
              type="button"
              disabled={!canAct}
              onClick={() => void operate("confirm_not_published")}
            >
              已核实未发布，退回草稿
            </button>
          )}
        </div>
      </details>
      <details className={styles.history}>
        <summary>操作记录</summary>
        {events.length ? (
          <ol>
            {events.map((event) => (
              <li key={event.id}>
                <time dateTime={event.createdAt}>{time(event.createdAt)}</time>
                <span>{event.detail}</span>
                <small>{event.accountId ? "人工操作" : "自动任务"}</small>
              </li>
            ))}
          </ol>
        ) : (
          <p>暂无操作记录</p>
        )}
      </details>
      <footer
        className={styles.actionBar}
        data-feedback-state={
          error ? "error" : pending ? "pending" : message ? "success" : "idle"
        }
        aria-label="商品主要操作"
        aria-busy={Boolean(pending)}
      >
        {message && (
          <motion.p
            key={message}
            role="status"
            className={`${styles.notice} ${styles.feedback}`}
            initial={reduced ? false : { opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduced ? { duration: 0 } : springs.appleSelection}
          >
            <motion.span
              tabIndex={-1}
              aria-hidden="true"
              className={styles.feedbackMark}
              initial={reduced ? false : { scale: 0.7 }}
              animate={{ scale: 1 }}
              transition={reduced ? { duration: 0 } : springs.appleSelection}
            >
              <motion.svg
                aria-hidden="true"
                tabIndex={-1}
                viewBox="0 0 16 16"
                className={styles.feedbackSvg}
              >
                <motion.path
                  d="m3.5 8 3 3 6-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={reduced ? false : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{
                    duration: reduced ? 0 : motionTokens.duration.disclosure,
                  }}
                />
              </motion.svg>
            </motion.span>
            {message}
          </motion.p>
        )}
        {error && (
          <motion.p
            role="alert"
            className={`${styles.error} ${styles.feedback} ${styles.errorFeedback}`}
            initial={reduced ? false : { opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduced ? { duration: 0 } : springs.appleSelection}
          >
            <span className={styles.failureMark} aria-hidden="true" />
            {error}
          </motion.p>
        )}
        {pending && (
          <motion.p
            role="status"
            className={`${styles.feedback} ${styles.pendingFeedback}`}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{
              duration: reduced ? 0 : motionTokens.duration.feedback,
            }}
          >
            <motion.svg
              aria-hidden="true"
              tabIndex={-1}
              viewBox="0 0 16 16"
              className={styles.feedbackSvg}
              initial={reduced ? false : { rotate: -45 }}
              animate={{ rotate: 0 }}
              transition={reduced ? { duration: 0 } : springs.appleSelection}
            >
              <circle
                cx="8"
                cy="8"
                r="5.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="M8 4.5V8l2.5 1.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </motion.svg>
            {pending === "save" ? "正在保存修改…" : "正在处理，请稍候…"}
          </motion.p>
        )}
        <div className={styles.actionButtons}>
          {!locked && (dirty || (!configured && !usePrepareAction)) && (
            <motion.button
              data-apple-motion-owned
              tabIndex={0}
              className={`${styles.springAction} ${usePrepareAction ? styles.secondaryAction : styles.publishAction}`}
              whileTap={
                reduced ? undefined : { scale: motionTokens.scale.subtle }
              }
              transition={reduced ? { duration: 0 } : springs.applePress}
              type="button"
              disabled={!canSave}
              onClick={submitSave}
            >
              {pending === "save" ? "保存中…" : "保存修改"}
            </motion.button>
          )}
          {!locked &&
            configured &&
            !dirty &&
            !["ready", "queued"].includes(listing.status) && (
              <motion.button
                data-apple-motion-owned
                tabIndex={0}
                className={`${styles.publishAction} ${styles.springAction}`}
                whileTap={
                  reduced ? undefined : { scale: motionTokens.scale.subtle }
                }
                transition={reduced ? { duration: 0 } : springs.applePress}
                type="button"
                disabled={!canAct || generating}
                onClick={() => void operate("approve")}
              >
                审核通过
              </motion.button>
            )}
          {configured &&
            !dirty &&
            ["ready", "queued"].includes(listing.status) && (
              <motion.button
                data-apple-motion-owned
                tabIndex={0}
                className={`${styles.publishAction} ${styles.springAction}`}
                whileTap={
                  reduced ? undefined : { scale: motionTokens.scale.subtle }
                }
                transition={reduced ? { duration: 0 } : springs.applePress}
                type="button"
                disabled={!canAct}
                onClick={() => void operate("publish")}
              >
                立即发布
              </motion.button>
            )}
          {!locked && usePrepareAction && (
            <motion.button
              data-apple-motion-owned
              type="button"
              tabIndex={0}
              className={`${styles.publishAction} ${styles.springAction}`}
              whileTap={
                reduced ? undefined : { scale: motionTokens.scale.subtle }
              }
              transition={reduced ? { duration: 0 } : springs.applePress}
              disabled={
                Boolean(pending) ||
                stale ||
                !accountId ||
                draft.imageUrls.filter(Boolean).length === 0 ||
                draft.imageUrls.filter(Boolean).length > 9
              }
              onClick={() => void prepareInXianyu()}
            >
              {pending === "prepare" ? "准备中…" : "去闲鱼发布"}
            </motion.button>
          )}
          {listing.status === "published" && listing.targetUrl && (
            <a
              className={styles.publishAction}
              href={listing.targetUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              查看闲鱼商品
            </a>
          )}
        </div>
      </footer>
    </section>
  );
}
