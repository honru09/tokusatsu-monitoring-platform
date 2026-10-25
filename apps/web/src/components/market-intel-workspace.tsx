"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { getShellOverlayRoot } from "../lib/shell-overlay";
import { createVisibilityPoller } from "../lib/visibility-poller";
import { motion, useReducedMotion } from "motion/react";
import { springs, motionTokens } from "../lib/motion-tokens";
import { useDialogFocus } from "../lib/use-dialog-focus";
import styles from "./operations-editorial.module.css";
import { EmptyState } from "./empty-state";

type MarketIntel = {
  id: string;
  sourceUrl: string;
  sourcePlatform: string;
  sourceName: string;
  kind: "news" | "forum" | "post";
  author?: string | null;
  titleRaw: string;
  bodyRaw: string;
  titleZh?: string | null;
  bodyZh?: string | null;
  translationStatus: string;
  publishedAt?: string | null;
  detectedAt: string;
  sourceData?: { completeBody?: boolean; ingestion?: string } | null;
};

const columnHelper = createColumnHelper<MarketIntel>();

function displayDate(value?: string | null) {
  if (!value) return "时间未公开";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function MarketIntelWorkspace({ apiBaseUrl }: { apiBaseUrl: string }) {
  const reducedMotion = useReducedMotion();
  const [keyboardMotion, setKeyboardMotion] = useState(false);
  const instantMotion = reducedMotion || keyboardMotion;
  const animatedItems = useRef(new Set<string>());
  const dialogRef = useRef<HTMLElement>(null);
  const [items, setItems] = useState<MarketIntel[]>([]);
  useEffect(() => {
    items.forEach((item) => animatedItems.current.add(item.id));
  }, [items]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [kind, setKind] = useState<"" | "news" | "forum" | "post">("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<MarketIntel | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshTimerRef = useRef<number | null>(null);
  const refreshMountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);
  const loadRef = useRef<(() => Promise<void>) | null>(null);
  useDialogFocus({
    active: !!selected,
    dialogRef,
    onClose: () => setSelected(null),
  });

  useEffect(() => {
    refreshMountedRef.current = true;
    return () => {
      refreshMountedRef.current = false;
      if (refreshTimerRef.current != null)
        window.clearTimeout(refreshTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setQuery(search.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(
    async ({
      signal,
      background = false,
    }: {
      signal?: AbortSignal;
      background?: boolean;
    } = {}) => {
      if (!background) {
        setLoading(true);
        setError("");
      }
      try {
        const params = new URLSearchParams({ page: String(page), limit: "30" });
        if (kind) params.set("kind", kind);
        if (query) params.set("search", query);
        const response = await fetch(`${apiBaseUrl}/market-intel?${params}`, {
          cache: "no-store",
          signal,
        });
        if (!response.ok) throw new Error(`API ${response.status}`);
        const payload = (await response.json()) as {
          items?: MarketIntel[];
          total?: number;
          pageCount?: number;
          lastUpdatedAt?: string | null;
        };
        if (!refreshMountedRef.current || signal?.aborted) return;
        setItems(payload.items ?? []);
        setTotal(payload.total ?? 0);
        setPageCount(payload.pageCount ?? 1);
        setLastUpdatedAt(payload.lastUpdatedAt ?? null);
        setError("");
      } catch (reason) {
        if (signal?.aborted) return;
        if (refreshMountedRef.current)
          setError(reason instanceof Error ? reason.message : "资讯读取失败");
        if (background) throw reason;
      } finally {
        if (!background && refreshMountedRef.current && !signal?.aborted) setLoading(false);
      }
    },
    [apiBaseUrl, kind, page, query],
  );

  useEffect(() => {
    loadRef.current = () => load();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    void load({ signal: controller.signal });
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const poller = createVisibilityPoller({
      task: (signal) => load({ signal, background: true }),
      intervalMs: 60 * 60_000,
      maxBackoffMs: 4 * 60 * 60_000,
      isPaused: () => document.hidden,
    });
    const onVisibilityChange = () => {
      if (document.hidden) poller.pause();
      else poller.resume();
    };

    poller.start(false);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      poller.stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [load]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("kind", {
        header: "类型",
        cell: (info) =>
          info.getValue() === "news"
            ? "新闻"
            : info.getValue() === "forum"
              ? "论坛"
              : "动态",
        size: 72,
      }),
      columnHelper.accessor("sourceName", { header: "平台", size: 130 }),
      columnHelper.accessor((row) => row.titleZh ?? row.titleRaw, {
        id: "title",
        header: "内容",
        cell: (info) => (
          <button
            type="button"
            className={styles.intelTitle}
            onClick={() => {
              setSelected(info.row.original);
              setShowOriginal(false);
            }}
          >
            {info.getValue()}
          </button>
        ),
        size: 520,
      }),
      columnHelper.accessor("author", {
        header: "用户/作者",
        cell: (info) => info.getValue() || "未署名",
        size: 130,
      }),
      columnHelper.accessor("publishedAt", {
        header: "时间",
        cell: (info) => (
          <span className="font-mono tabular-nums">
            {displayDate(info.getValue())}
          </span>
        ),
        size: 140,
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    manualPagination: true,
    pageCount,
  });

  async function requestRefresh() {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      const response = await fetch(`${apiBaseUrl}/market-intel/refresh`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(`API ${response.status}`);
      if (!refreshMountedRef.current) return;
      if (refreshTimerRef.current != null)
        window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void loadRef.current?.();
      }, 2_500);
    } catch (reason) {
      if (refreshMountedRef.current)
        setError(reason instanceof Error ? reason.message : "刷新排队失败");
    } finally {
      refreshInFlightRef.current = false;
      if (refreshMountedRef.current) setRefreshing(false);
    }
  }

  return (
    <section
      className={`${styles.workspace} ${styles.market}`}
      aria-labelledby="market-intel-heading"
      data-keyboard-motion={keyboardMotion ? "true" : "false"}
      onPointerDownCapture={() => setKeyboardMotion(false)}
      onKeyDownCapture={() => setKeyboardMotion(true)}
    >
      <div className={styles.intelTop}>
        <div className={styles.heading}>
          <div>
            <h2 id="market-intel-heading" className={styles.pageTitle}>
              资讯专区
            </h2>
            <p className="mt-1 text-xs text-ink/50">
              {total} 条资讯 · 每小时更新 · 最近更新{" "}
              {displayDate(lastUpdatedAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void requestRefresh()}
            disabled={refreshing}
            className={styles.primaryButton}
          >
            {refreshing ? "排队中…" : "立即更新"}
          </button>
        </div>
        <div className={styles.intelTools}>
          <label className="sr-only" htmlFor="intel-search">
            搜索资讯
          </label>
          <input
            id="intel-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索平台、用户、商品或出售信息"
            className="h-11 min-w-0 rounded-xl border border-ink/10 bg-white px-3 text-base focus-visible:border-moss focus-visible:ring-2 focus-visible:ring-moss/15 sm:text-sm"
          />
          <div className={styles.intelTabs}>
            {(
              [
                ["", "全部"],
                ["news", "新闻"],
                ["forum", "论坛"],
                ["post", "动态"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value || "all"}
                type="button"
                onClick={() => {
                  setPage(1);
                  setKind(value);
                }}
                aria-pressed={kind === value}
                className={styles.intelTab}
              >
                {kind === value && (
                  <motion.span
                    className={styles.tabIndicator}
                    layoutId="intel-kind-indicator"
                    transition={
                      instantMotion ? { duration: 0 } : springs.appleSelection
                    }
                    aria-hidden="true"
                  />
                )}
                <span className={styles.tabLabel}>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-600 p-3 text-sm font-bold text-white"
        >
          无法读取资讯：{error}
          <button type="button" className={styles.recoveryAction} onClick={() => void load()}>重试</button>
        </p>
      )}
      {loading ? (
        <div className="ios-surface rounded-2xl p-12 text-center text-sm font-bold text-ink/50">
          正在整理公开资讯…
        </div>
      ) : items.length === 0 ? (
        <div className="ios-surface rounded-2xl" role="status">
          <EmptyState
            art="chart"
            title={query || kind ? "没有符合条件的资讯" : "暂无资讯"}
            description={query || kind ? undefined : "后台会继续检索，有新资讯会自动出现在这里。"}
          >
            {(query || kind) && <button type="button" className={styles.recoveryAction} onClick={() => { setSearch(""); setQuery(""); setKind(""); setPage(1); document.getElementById("intel-search")?.focus({ preventScroll: true }); }}>清除筛选</button>}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className={styles.intelTable}>
            <div className="max-h-[68dvh] overflow-auto">
              <table className="w-full table-fixed text-left text-xs">
                <thead className="sticky top-0 z-10 bg-paper/95 text-ink/50 backdrop-blur">
                  {table.getHeaderGroups().map((group) => (
                    <tr key={group.id}>
                      {group.headers.map((header) => (
                        <th
                          key={header.id}
                          style={{ width: header.getSize() }}
                          className="border-b border-ink/8 px-3 py-3 font-bold"
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row, index) => (
                    <motion.tr
                      initial={
                        instantMotion ||
                        index >= 4 ||
                        animatedItems.current.has(row.original.id)
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
                      key={row.id}
                      onClick={() => {
                        setSelected(row.original);
                        setShowOriginal(false);
                      }}
                      className="cursor-pointer border-b border-ink/[.05] transition-colors hover:bg-blue-50/70"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          className="px-3 py-3 align-top text-ink/70"
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </td>
                      ))}
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className={styles.intelMobileList}>
            {items.map((item, index) => (
              <motion.button
                data-apple-motion-owned="true"
                whileTap={
                  instantMotion ? undefined : { transform: "scale(0.98)" }
                }
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
                type="button"
                onClick={() => {
                  setSelected(item);
                  setShowOriginal(false);
                }}
                className={styles.intelMobileRow}
              >
                <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-meta">
                  <span>
                    {item.kind === "news"
                      ? "新闻"
                      : item.kind === "forum"
                        ? "论坛"
                        : "动态"}{" "}
                    · {item.sourceName}
                  </span>
                  <span className="font-mono tabular-nums">
                    {displayDate(item.publishedAt)}
                  </span>
                </div>
                <h3 className="mt-2 line-clamp-3 text-sm font-black leading-6">
                  {item.titleZh ?? item.titleRaw}
                </h3>
                {item.author && (
                  <p className="mt-2 text-xs text-ink/50">{item.author}</p>
                )}
              </motion.button>
            ))}
          </div>
        </>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            className="min-h-11 rounded-xl border border-ink/10 bg-white px-4 text-sm font-bold disabled:opacity-40"
          >
            上一页
          </button>
          <span className="font-mono text-xs tabular-nums">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
            className="min-h-11 rounded-xl border border-ink/10 bg-white px-4 text-sm font-bold disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}

      {selected &&
        createPortal(
          <div
            className="modal-backdrop absolute inset-0 z-[90] grid place-items-center bg-ink/55 p-3 sm:p-5"
            onMouseDown={() => setSelected(null)}
          >
            <motion.article
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="intel-dialog-title"
              className={`modal-panel max-h-[92dvh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-paper shadow-modal ${styles.intelDialog}`}
              initial={
                instantMotion
                  ? false
                  : { opacity: 0.6, transform: "translateY(24px) scale(0.98)" }
              }
              animate={{ opacity: 1, transform: "translateY(0) scale(1)" }}
              transition={
                instantMotion ? { duration: 0 } : springs.appleSpatial
              }
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-ink/8 bg-paper/95 px-4 py-3 backdrop-blur">
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label="返回资讯列表"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-lg shadow-sm"
                >
                  ←
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold text-moss">
                    {selected.sourceName} · {selected.author || "未署名"}
                  </p>
                  <h2
                    id="intel-dialog-title"
                    className="mt-1 truncate text-sm font-black"
                  >
                    资讯详情
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShowOriginal((value) => !value)}
                  aria-pressed={showOriginal}
                  className="min-h-11 rounded-xl bg-white px-3 text-xs font-bold shadow-sm"
                >
                  {showOriginal ? "中文" : "原文"}
                </button>
              </header>
              <motion.div
                className="p-5 sm:p-7"
                key={showOriginal ? "original" : "translated"}
                initial={instantMotion ? false : { opacity: 0.6 }}
                animate={{ opacity: 1 }}
                transition={{
                  duration: instantMotion ? 0 : motionTokens.duration.feedback,
                }}
              >
                <h3 className="text-balance text-xl font-black leading-tight sm:text-2xl">
                  {showOriginal
                    ? selected.titleRaw
                    : (selected.titleZh ?? selected.titleRaw)}
                </h3>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-meta">
                  <span>{displayDate(selected.publishedAt)}</span>
                  <span>
                    {selected.sourceData?.completeBody
                      ? "完整正文"
                      : "来源摘要"}
                  </span>
                  <span>
                    {selected.translationStatus === "completed"
                      ? "AI 完整翻译"
                      : "等待翻译"}
                  </span>
                </div>
                <p className="mt-6 whitespace-pre-wrap text-pretty text-sm leading-7 text-ink/75 sm:text-[15px] sm:leading-8">
                  {showOriginal
                    ? selected.bodyRaw
                    : (selected.bodyZh ?? selected.bodyRaw)}
                </p>
                <a
                  href={selected.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-ink px-4 text-sm font-bold text-white"
                >
                  查看公开来源
                </a>
              </motion.div>
            </motion.article>
          </div>,
          getShellOverlayRoot(),
        )}
    </section>
  );
}
