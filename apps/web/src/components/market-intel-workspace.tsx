"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  const [items, setItems] = useState<MarketIntel[]>([]);
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setQuery(search.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: "30" });
      if (kind) params.set("kind", kind);
      if (query) params.set("search", query);
      const response = await fetch(`${apiBaseUrl}/market-intel?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`API ${response.status}`);
      const payload = (await response.json()) as {
        items?: MarketIntel[];
        total?: number;
        pageCount?: number;
        lastUpdatedAt?: string | null;
      };
      setItems(payload.items ?? []);
      setTotal(payload.total ?? 0);
      setPageCount(payload.pageCount ?? 1);
      setLastUpdatedAt(payload.lastUpdatedAt ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资讯读取失败");
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, kind, page, query]);

  useEffect(() => {
    void load();
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
          <span className="line-clamp-2 font-bold leading-5">
            {info.getValue()}
          </span>
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
    setRefreshing(true);
    try {
      const response = await fetch(`${apiBaseUrl}/market-intel/refresh`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(`API ${response.status}`);
      window.setTimeout(() => void load(), 2_500);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "刷新排队失败");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="market-intel-heading">
      <div className="ios-surface rounded-2xl border border-white/70 p-4 shadow-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold text-moss">每小时自动更新</p>
            <h2
              id="market-intel-heading"
              className="mt-1 font-heading text-xl font-black"
            >
              资讯专区
            </h2>
            <p className="mt-1 text-xs text-ink/50">
              {total} 条公开新闻与论坛出售信息 · 最近更新{" "}
              {displayDate(lastUpdatedAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void requestRefresh()}
            disabled={refreshing}
            className="min-h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            {refreshing ? "排队中…" : "立即更新"}
          </button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label className="sr-only" htmlFor="intel-search">
            搜索资讯
          </label>
          <input
            id="intel-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索平台、用户、商品或出售信息"
            className="h-11 min-w-0 rounded-xl border border-ink/10 bg-white px-3 text-base outline-none focus:border-moss sm:text-sm"
          />
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-ink/[.04] p-1">
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
                className={`min-h-11 rounded-lg px-3 text-xs font-bold ${kind === value ? "bg-white text-moss shadow-sm" : "text-ink/55"}`}
              >
                {label}
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
        </p>
      )}
      {loading ? (
        <div className="ios-surface rounded-2xl p-12 text-center text-sm font-bold text-ink/50">
          正在整理公开资讯…
        </div>
      ) : items.length === 0 ? (
        <div className="ios-surface rounded-2xl p-12 text-center text-sm font-bold text-ink/50">
          暂无匹配资讯，后台仍会每小时继续检索。
        </div>
      ) : (
        <>
          <div className="ios-surface hidden overflow-hidden rounded-2xl border border-white/70 shadow-panel md:block">
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
                  {table.getRowModel().rows.map((row) => (
                    <tr
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="grid gap-2 md:hidden">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelected(item);
                  setShowOriginal(false);
                }}
                className="ios-surface min-w-0 rounded-2xl border border-white/70 p-4 text-left shadow-sm"
              >
                <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-ink/45">
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
              </button>
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

      {selected && (
        <div
          className="modal-backdrop fixed inset-0 z-[90] grid place-items-center bg-ink/55 p-3 sm:p-5"
          onMouseDown={() => setSelected(null)}
        >
          <article
            role="dialog"
            aria-modal="true"
            aria-labelledby="intel-dialog-title"
            className="modal-panel max-h-[92dvh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-paper shadow-modal"
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
            <div className="p-5 sm:p-7">
              <h3 className="text-balance text-xl font-black leading-tight sm:text-2xl">
                {showOriginal
                  ? selected.titleRaw
                  : (selected.titleZh ?? selected.titleRaw)}
              </h3>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-ink/50">
                <span>{displayDate(selected.publishedAt)}</span>
                <span>
                  {selected.sourceData?.completeBody ? "完整正文" : "来源摘要"}
                </span>
                <span>
                  {selected.translationStatus === "completed"
                    ? "AI Gateway 完整翻译"
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
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
