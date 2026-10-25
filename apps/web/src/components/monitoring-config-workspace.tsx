"use client";

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import { springs } from "../lib/motion-tokens";
import { readFetchError } from "../lib/fetch-error";
import { TERMS } from "../lib/terms";
import { getShellOverlayRoot } from "../lib/shell-overlay";
import { useDialogFocus } from "../lib/use-dialog-focus";
import "../styles/monitoring-config.css";
import styles from "./operations-editorial.module.css";
import { EmptyState } from "./empty-state";

export type MonitoringCategory = {
  id: string;
  name: string;
  parentId?: string | null;
  scope: "toys" | "general";
  activeItems?: number;
  _count?: { items?: number };
};

type MonitoringKeyword = {
  id: string;
  keyword: string;
  enabled: boolean;
  intervalMinutes: number;
  categoryId: string;
  sourceKeys: string[];
  category?: { id: string; name: string; scope?: string } | null;
  _count?: { matches?: number };
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
  runs?: Array<{ startedAt?: string; finishedAt?: string; status?: string }>;
};

type MonitoringConfig = {
  keywords: MonitoringKeyword[];
  categories: MonitoringCategory[];
  platforms: Array<{ key: string; displayName: string; enabled: boolean }>;
};

type KeywordDraft = {
  id?: string;
  keyword: string;
  enabled: boolean;
  intervalMinutes: string;
  categoryId: string;
  sourceKeys: string[];
};

type CategoryDraft = {
  id?: string;
  name: string;
  scope: "toys" | "general";
  parentId: string;
};
type DispatchResult = { queued?: number; skipped?: number; error?: string };

function ConfigIcon({
  kind,
}: {
  kind: "add" | "close" | "search" | "scan" | "refresh" | "edit";
}) {
  const paths: Record<typeof kind, ReactNode> = {
    add: <path d="M12 5v14M5 12h14" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    scan: (
      <>
        <path d="M7 3H3v4m14-4h4v4M3 17v4h4m14-4v4h-4M3 12h18" />
      </>
    ),
    refresh: (
      <>
        <path d="M19 7a8 8 0 1 0 1 9M19 3v5h-5" />
      </>
    ),
    edit: (
      <>
        <path d="m5 15-1 5 5-1L20 8l-4-4L5 15Z" />
        <path d="m13 7 4 4" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[kind]}
    </svg>
  );
}

function ConfigDialog({
  title,
  children,
  onClose,
  busy,
  initialFocusRef,
  suspended = false,
  instantMotion = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy: boolean;
  initialFocusRef: React.RefObject<HTMLInputElement | null>;
  suspended?: boolean;
  instantMotion?: boolean;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus({
    active: !suspended,
    dialogRef,
    initialFocusRef,
    onClose: () => {
      if (!busy) onClose();
    },
  });
  return createPortal(
    <div
      className="mcfg-backdrop"
      hidden={suspended}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <motion.section
        initial={
          instantMotion
            ? false
            : { opacity: 0.6, transform: "translateY(24px) scale(0.98)" }
        }
        animate={{ opacity: 1, transform: "translateY(0) scale(1)" }}
        transition={instantMotion ? { duration: 0 } : springs.appleSpatial}
        ref={dialogRef}
        className="mcfg-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        tabIndex={-1}
      >
        <header className="mcfg-dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button
            className="mcfg-icon-button"
            type="button"
            aria-label={`关闭${title}`}
            disabled={busy}
            onClick={onClose}
          >
            <ConfigIcon kind="close" />
          </button>
        </header>
        {children}
      </motion.section>
    </div>,
    getShellOverlayRoot(),
  );
}

function runLabel(keyword: MonitoringKeyword) {
  const value =
    keyword.lastRunAt ??
    keyword.runs?.[0]?.finishedAt ??
    keyword.runs?.[0]?.startedAt;
  if (!value) return "尚未运行";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? `${keyword.lastRunStatus === "failed" ? "最近失败" : "最近"} ${new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)}`
    : "尚未运行";
}

function dispatchLabel(result: DispatchResult) {
  if (result.error) return "已保存，扫描暂未启动，请重试";
  if (typeof result.queued === "number")
    return result.queued > 0
      ? `已安排 ${result.queued} 个扫描任务`
      : "扫描计划已更新";
  return "扫描计划已更新";
}

export function MonitoringConfigWorkspace({
  apiBaseUrl,
  accountId,
  onConfigChanged,
}: {
  apiBaseUrl: string;
  accountId: string | null;
  onConfigChanged?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [keyboardMotion, setKeyboardMotion] = useState(false);
  const instantMotion = reducedMotion || keyboardMotion;
  const animatedItems = useRef(new Set<string>());
  const [config, setConfig] = useState<MonitoringConfig | null>(null);
  useEffect(() => {
    config?.keywords.forEach((keyword) =>
      animatedItems.current.add(keyword.id),
    );
  }, [config]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [keywordDraft, setKeywordDraft] = useState<KeywordDraft | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(
    null,
  );
  const [keywordError, setKeywordError] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [savingKeyword, setSavingKeyword] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [pendingRows, setPendingRows] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const keywordInputRef = useRef<HTMLInputElement>(null);
  const categoryInputRef = useRef<HTMLInputElement>(null);
  const requestVersion = useRef(0);
  const active = useRef(true);
  const base = apiBaseUrl.replace(/\/$/, "");
  const dialogOpen = Boolean(keywordDraft || categoryDraft);

  useEffect(() => {
    if (!dialogOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [dialogOpen]);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      requestVersion.current += 1;
    };
  }, []);

  const request = useCallback(
    async <T,>(
      path: string,
      method = "GET",
      body?: Record<string, unknown>,
    ): Promise<T> => {
      if (method !== "GET" && !accountId) throw new Error("请先选择管理员账号");
      const response = await fetch(`${base}/monitoring${path}`, {
        method,
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
        ...(method !== "GET"
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ...body, accountId }),
            }
          : {}),
      });
      if (!response.ok)
        throw new Error(await readFetchError(response, "操作失败，请重试"));
      return response.status === 204
        ? (undefined as T)
        : ((await response.json()) as T);
    },
    [accountId, base],
  );

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoadError("");
    try {
      const result = await request<MonitoringConfig>("/config");
      if (active.current && version === requestVersion.current)
        setConfig(result);
    } catch (reason) {
      if (active.current && version === requestVersion.current)
        setLoadError(
          reason instanceof Error ? reason.message : "读取失败，请重试",
        );
    } finally {
      if (active.current && version === requestVersion.current)
        setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const visibleKeywords = useMemo(
    () =>
      (config?.keywords ?? []).filter((keyword) => {
        if (categoryFilter && keyword.categoryId !== categoryFilter)
          return false;
        const query = search.trim().toLocaleLowerCase();
        return (
          !query ||
          [
            keyword.keyword,
            keyword.category?.name,
            config?.categories.find(
              (category) => category.id === keyword.categoryId,
            )?.name,
          ].some((value) => value?.toLocaleLowerCase().includes(query))
        );
      }),
    [categoryFilter, config, search],
  );

  function openKeyword(keyword?: MonitoringKeyword) {
    setKeywordError("");
    setKeywordDraft(
      keyword
        ? {
            id: keyword.id,
            keyword: keyword.keyword,
            enabled: keyword.enabled,
            intervalMinutes: String(keyword.intervalMinutes),
            categoryId: keyword.categoryId,
            sourceKeys: keyword.sourceKeys ?? [],
          }
        : {
            keyword: "",
            enabled: true,
            intervalMinutes: "60",
            categoryId: categoryFilter || config?.categories[0]?.id || "",
            sourceKeys: [],
          },
    );
  }

  function openCategory(category?: MonitoringCategory) {
    setCategoryError("");
    setCategoryDraft(
      category
        ? {
            id: category.id,
            name: category.name,
            scope: category.scope,
            parentId: category.parentId ?? "",
          }
        : { name: "", scope: "general", parentId: "" },
    );
  }

  async function saveKeyword(event: React.FormEvent) {
    event.preventDefault();
    if (!keywordDraft || savingKeyword) return;
    const intervalMinutes = Number(keywordDraft.intervalMinutes);
    if (!keywordDraft.keyword.trim()) {
      setKeywordError("填写关键词");
      return;
    }
    if (!keywordDraft.categoryId) {
      setKeywordError("选择商品分类");
      return;
    }
    if (
      !Number.isSafeInteger(intervalMinutes) ||
      intervalMinutes < 15 ||
      intervalMinutes > 1440
    ) {
      setKeywordError("扫描间隔须为 15 至 1440 分钟");
      return;
    }
    setSavingKeyword(true);
    setKeywordError("");
    try {
      const result = await request<{ dispatch?: DispatchResult }>(
        keywordDraft.id
          ? `/keywords/${encodeURIComponent(keywordDraft.id)}`
          : "/keywords",
        keywordDraft.id ? "PATCH" : "POST",
        {
          keyword: keywordDraft.keyword.trim(),
          categoryId: keywordDraft.categoryId,
          enabled: keywordDraft.enabled,
          intervalMinutes,
          sourceKeys: keywordDraft.sourceKeys,
        },
      );
      if (!active.current) return;
      setKeywordDraft(null);
      setNotice(dispatchLabel(result.dispatch ?? {}));
      onConfigChanged?.();
      await load();
    } catch (reason) {
      if (active.current)
        setKeywordError(
          reason instanceof Error ? reason.message : "保存失败，请重试",
        );
    } finally {
      if (active.current) setSavingKeyword(false);
    }
  }

  async function saveCategory(event: React.FormEvent) {
    event.preventDefault();
    if (!categoryDraft || savingCategory) return;
    if (!categoryDraft.name.trim()) {
      setCategoryError("填写分类名称");
      return;
    }
    setSavingCategory(true);
    setCategoryError("");
    try {
      const result = await request<MonitoringCategory>(
        categoryDraft.id
          ? `/categories/${encodeURIComponent(categoryDraft.id)}`
          : "/categories",
        categoryDraft.id ? "PATCH" : "POST",
        {
          name: categoryDraft.name.trim(),
          scope: categoryDraft.scope,
          parentId: categoryDraft.parentId || null,
        },
      );
      if (!active.current) return;
      setConfig((value) =>
        value
          ? {
              ...value,
              categories: [
                ...value.categories.filter(
                  (category) => category.id !== result.id,
                ),
                result,
              ],
            }
          : value,
      );
      if (keywordDraft && !categoryDraft.id)
        setKeywordDraft((value) =>
          value ? { ...value, categoryId: result.id } : value,
        );
      setCategoryDraft(null);
      setNotice("分类已保存");
      onConfigChanged?.();
      await load();
    } catch (reason) {
      if (active.current)
        setCategoryError(
          reason instanceof Error ? reason.message : "保存失败，请重试",
        );
    } finally {
      if (active.current) setSavingCategory(false);
    }
  }

  async function keywordAction(
    keyword: MonitoringKeyword,
    action: "toggle" | "run" | "reindex",
  ) {
    if (pendingRows.has(keyword.id)) return;
    setPendingRows((value) => new Set(value).add(keyword.id));
    setNotice("");
    try {
      const result = await request<
        DispatchResult & {
          matched?: number;
          moved?: number;
          dispatch?: DispatchResult;
        }
      >(
        `/keywords/${encodeURIComponent(keyword.id)}${action === "toggle" ? "" : `/${action}`}`,
        action === "toggle" ? "PATCH" : "POST",
        action === "toggle" ? { enabled: !keyword.enabled } : {},
      );
      if (!active.current) return;
      if (action === "toggle") {
        setConfig((value) =>
          value
            ? {
                ...value,
                keywords: value.keywords.map((row) =>
                  row.id === keyword.id
                    ? { ...row, enabled: !row.enabled }
                    : row,
                ),
              }
            : value,
        );
        setNotice(
          keyword.enabled
            ? "监控已暂停"
            : dispatchLabel(result.dispatch ?? result),
        );
      } else if (action === "reindex")
        setNotice(
          `已匹配 ${result.matched ?? 0} 件，归类 ${result.moved ?? 0} 件`,
        );
      else setNotice(dispatchLabel(result.dispatch ?? result));
      onConfigChanged?.();
      await load();
    } catch (reason) {
      if (active.current)
        setNotice(
          reason instanceof Error ? reason.message : "操作失败，请重试",
        );
    } finally {
      if (active.current)
        setPendingRows((value) => {
          const next = new Set(value);
          next.delete(keyword.id);
          return next;
        });
    }
  }

  async function refreshPlan() {
    if (refreshing) return;
    setRefreshing(true);
    setNotice("");
    try {
      const result = await request<DispatchResult>(
        "/config/refresh",
        "POST",
        {},
      );
      if (active.current) {
        setNotice(dispatchLabel(result));
        await load();
      }
    } catch (reason) {
      if (active.current)
        setNotice(
          reason instanceof Error ? reason.message : "更新失败，请重试",
        );
    } finally {
      if (active.current) setRefreshing(false);
    }
  }

  return (
    <section
      className={`mcfg-workspace ${styles.workspace} ${styles.monitoring}`}
      aria-label={TERMS.monitoring}
      data-keyboard-motion={keyboardMotion ? "true" : "false"}
      onPointerDownCapture={() => setKeyboardMotion(false)}
      onKeyDownCapture={() => setKeyboardMotion(true)}
    >
      <header className={`mcfg-header ${styles.heading}`}>
        <div>
          <h2>{TERMS.monitoring}</h2>
          {config && (
            <p>
              {config.keywords.filter((keyword) => keyword.enabled).length}{" "}
              个关键词运行中
            </p>
          )}
        </div>
        <div className="mcfg-header-actions">
          <button
            type="button"
            className="mcfg-icon-button"
            aria-label="更新扫描计划"
            title="更新扫描计划"
            onClick={() => void refreshPlan()}
            disabled={refreshing || !config || !accountId}
          >
            <ConfigIcon kind="refresh" />
          </button>
          <button
            type="button"
            className="mcfg-button mcfg-primary"
            onClick={() => openKeyword()}
            disabled={!config || !accountId}
          >
            <ConfigIcon kind="add" />
            <span>添加关键词</span>
          </button>
        </div>
      </header>
      {notice && (
        <p className="mcfg-notice" role="status">
          {notice}
        </p>
      )}
      {loadError && (
        <div className="mcfg-error" role="alert">
          <span>{loadError}</span>
          <button
            type="button"
            className="mcfg-button"
            onClick={() => {
              setLoading(true);
              void load();
            }}
          >
            重试
          </button>
        </div>
      )}
      {loading && !config ? (
        <p className="mcfg-empty" role="status">
          正在读取{TERMS.monitoring}…
        </p>
      ) : (
        config && (
          <div className="mcfg-content">
            <section className="mcfg-keywords" aria-label="关键词库">
              <div className={styles.sectionHeading}>
                <h3>关键词库</h3>
                <span aria-live="polite">
                  {visibleKeywords.length} 个关键词
                </span>
              </div>
              <div className="mcfg-search">
                <ConfigIcon kind="search" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索关键词或分类"
                  aria-label="搜索关键词或分类"
                />
                {search && (
                  <button
                    type="button"
                    className="mcfg-icon-button"
                    aria-label="清空搜索"
                    onClick={() => setSearch("")}
                  >
                    <ConfigIcon kind="close" />
                  </button>
                )}
              </div>
              {categoryFilter && (
                <div className="mcfg-filter">
                  <span>
                    {config.categories.find(
                      (category) => category.id === categoryFilter,
                    )?.name ?? "所选分类"}
                  </span>
                  <button
                    type="button"
                    className="mcfg-button"
                    onClick={() => setCategoryFilter("")}
                  >
                    全部关键词
                  </button>
                </div>
              )}
              <div className="mcfg-keyword-list">
                <div className={styles.keywordColumns} aria-hidden="true">
                  <span>关键词 / 分类</span>
                  <span>收录 / 最近运行</span>
                  <span>扫描 / 启用</span>
                </div>
                {visibleKeywords.length ? (
                  visibleKeywords.map((keyword, index) => (
                    <motion.article
                      initial={
                        instantMotion ||
                        index >= 4 ||
                        animatedItems.current.has(keyword.id)
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
                      className="mcfg-keyword-row"
                      key={keyword.id}
                      aria-busy={pendingRows.has(keyword.id)}
                    >
                      <button
                        type="button"
                        className="mcfg-keyword-main"
                        onClick={() => openKeyword(keyword)}
                        disabled={!accountId}
                      >
                        <strong>{keyword.keyword}</strong>
                        <span>
                          {keyword.category?.name ??
                            config.categories.find(
                              (category) => category.id === keyword.categoryId,
                            )?.name ??
                            "未分类"}
                        </span>
                      </button>
                      <div className="mcfg-keyword-facts">
                        <span>
                          {keyword._count?.matches == null
                            ? "待统计"
                            : `${keyword._count.matches} 件收录`}
                        </span>
                        <span>{runLabel(keyword)}</span>
                      </div>
                      <div className="mcfg-row-actions">
                        <button
                          type="button"
                          className="mcfg-icon-button"
                          aria-label={`立即扫描 ${keyword.keyword}`}
                          title="立即扫描"
                          onClick={() => void keywordAction(keyword, "run")}
                          disabled={!accountId || pendingRows.has(keyword.id)}
                        >
                          <ConfigIcon kind="scan" />
                        </button>
                        <button
                          type="button"
                          className="mcfg-switch"
                          role="switch"
                          aria-label={`监控 ${keyword.keyword}`}
                          aria-checked={keyword.enabled}
                          onClick={() => void keywordAction(keyword, "toggle")}
                          disabled={!accountId || pendingRows.has(keyword.id)}
                        >
                          <motion.span
                            initial={false}
                            animate={{
                              transform: keyword.enabled
                                ? "translateX(22px)"
                                : "translateX(0)",
                            }}
                            transition={
                              instantMotion
                                ? { duration: 0 }
                                : springs.appleSelection
                            }
                          />
                        </button>
                      </div>
                    </motion.article>
                  ))
                ) : (
                  <div className="mcfg-empty">
                    <EmptyState
                      art="search"
                      title={
                        search || categoryFilter
                          ? "没有匹配的关键词"
                          : "还没有监控关键词"
                      }
                      description={
                        search || categoryFilter
                          ? undefined
                          : "添加关键词后，后台会按它持续搜罗新商品。"
                      }
                      compact
                    >
                      {!search && !categoryFilter && (
                        <button
                          type="button"
                          className="mcfg-button"
                          onClick={() => openKeyword()}
                          disabled={!accountId}
                        >
                          添加关键词
                        </button>
                      )}
                    </EmptyState>
                  </div>
                )}
              </div>
            </section>
            <aside className="mcfg-categories" aria-label="商品分类">
              <header>
                <h3>商品分类</h3>
                <button
                  type="button"
                  className="mcfg-icon-button"
                  aria-label="新建分类"
                  title="新建分类"
                  disabled={!accountId}
                  onClick={() => openCategory()}
                >
                  <ConfigIcon kind="add" />
                </button>
              </header>
              {config.categories.length ? (
                <div className="mcfg-category-list">
                  {config.categories.map((category) => (
                    <div className="mcfg-category-row" key={category.id}>
                      <button
                        type="button"
                        className="mcfg-category-filter"
                        aria-pressed={categoryFilter === category.id}
                        onClick={() =>
                          setCategoryFilter((value) =>
                            value === category.id ? "" : category.id,
                          )
                        }
                      >
                        {categoryFilter === category.id && (
                          <motion.span
                            className={styles.categoryIndicator}
                            layoutId="monitoring-category-indicator"
                            transition={
                              instantMotion
                                ? { duration: 0 }
                                : springs.appleSelection
                            }
                            aria-hidden="true"
                          />
                        )}
                        <span className={styles.tabLabel}>
                          <strong>{category.name}</strong>
                          <small>
                            {category.scope === "toys" ? "玩具" : "其他商品"}
                          </small>
                        </span>
                        <span className={styles.tabLabel}>
                          {category._count?.items ?? ""}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="mcfg-icon-button"
                        aria-label={`编辑分类 ${category.name}`}
                        title="编辑分类"
                        onClick={() => openCategory(category)}
                        disabled={!accountId}
                      >
                        <ConfigIcon kind="edit" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mcfg-empty">添加第一个商品分类</p>
              )}
            </aside>
          </div>
        )
      )}
      {keywordDraft && (
        <ConfigDialog
          instantMotion={Boolean(instantMotion)}
          title={keywordDraft.id ? "编辑关键词" : "新建关键词"}
          onClose={() => setKeywordDraft(null)}
          busy={savingKeyword}
          initialFocusRef={keywordInputRef}
          suspended={!!categoryDraft}
        >
          <form
            className="mcfg-form"
            onSubmit={(event) => void saveKeyword(event)}
          >
            <label>
              关键词
              <input
                ref={keywordInputRef}
                value={keywordDraft.keyword}
                maxLength={120}
                onChange={(event) =>
                  setKeywordDraft({
                    ...keywordDraft,
                    keyword: event.target.value,
                  })
                }
                autoComplete="off"
                disabled={savingKeyword}
              />
            </label>
            <div className="mcfg-category-field">
              <label>
                商品分类
                <select
                  value={keywordDraft.categoryId}
                  onChange={(event) =>
                    setKeywordDraft({
                      ...keywordDraft,
                      categoryId: event.target.value,
                    })
                  }
                  disabled={savingKeyword}
                >
                  <option value="">选择分类</option>
                  {config?.categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="mcfg-icon-button"
                aria-label="新建商品分类"
                disabled={savingKeyword}
                onClick={() => openCategory()}
              >
                <ConfigIcon kind="add" />
              </button>
            </div>
            <div className="mcfg-field-row">
              <label>
                扫描间隔（分钟）
                <input
                  type="number"
                  inputMode="numeric"
                  min="15"
                  max="1440"
                  value={keywordDraft.intervalMinutes}
                  onChange={(event) =>
                    setKeywordDraft({
                      ...keywordDraft,
                      intervalMinutes: event.target.value,
                    })
                  }
                  disabled={savingKeyword}
                />
              </label>
              <label className="mcfg-enabled-field">
                启用监控
                <input
                  type="checkbox"
                  checked={keywordDraft.enabled}
                  onChange={(event) =>
                    setKeywordDraft({
                      ...keywordDraft,
                      enabled: event.target.checked,
                    })
                  }
                  disabled={savingKeyword}
                />
              </label>
            </div>
            <details className="mcfg-platforms">
              <summary>
                搜索平台
                <span>
                  {keywordDraft.sourceKeys.length
                    ? `${keywordDraft.sourceKeys.length} 个`
                    : "全部已启用平台"}
                </span>
              </summary>
              <div>
                <label className="mcfg-platform-choice">
                  <input
                    type="checkbox"
                    checked={!keywordDraft.sourceKeys.length}
                    onChange={() =>
                      setKeywordDraft({ ...keywordDraft, sourceKeys: [] })
                    }
                    disabled={savingKeyword}
                  />
                  全部已启用平台
                </label>
                {config?.platforms
                  .filter((platform) => platform.enabled)
                  .map((platform) => (
                    <label className="mcfg-platform-choice" key={platform.key}>
                      <input
                        type="checkbox"
                        checked={keywordDraft.sourceKeys.includes(platform.key)}
                        onChange={(event) =>
                          setKeywordDraft({
                            ...keywordDraft,
                            sourceKeys: event.target.checked
                              ? [...keywordDraft.sourceKeys, platform.key]
                              : keywordDraft.sourceKeys.filter(
                                  (key) => key !== platform.key,
                                ),
                          })
                        }
                        disabled={savingKeyword}
                      />
                      {platform.displayName}
                    </label>
                  ))}
              </div>
            </details>
            {keywordDraft.id && (
              <button
                type="button"
                className="mcfg-button mcfg-reindex"
                disabled={savingKeyword || pendingRows.has(keywordDraft.id)}
                onClick={() => {
                  const keyword = config?.keywords.find(
                    (row) => row.id === keywordDraft.id,
                  );
                  if (keyword) void keywordAction(keyword, "reindex");
                }}
              >
                匹配现有商品
              </button>
            )}
            {keywordDraft.id && notice && (
              <p className="mcfg-notice" role="status">
                {notice}
              </p>
            )}
            {keywordError && (
              <p className="mcfg-error" role="alert">
                {keywordError}
              </p>
            )}
            <footer className="mcfg-form-actions">
              <button
                type="button"
                className="mcfg-button"
                onClick={() => setKeywordDraft(null)}
                disabled={savingKeyword}
              >
                取消
              </button>
              <button
                type="submit"
                className="mcfg-button mcfg-primary"
                disabled={savingKeyword}
              >
                {savingKeyword ? "保存中…" : "保存"}
              </button>
            </footer>
          </form>
        </ConfigDialog>
      )}
      {categoryDraft && (
        <ConfigDialog
          instantMotion={Boolean(instantMotion)}
          title={categoryDraft.id ? "编辑分类" : "新建分类"}
          onClose={() => setCategoryDraft(null)}
          busy={savingCategory}
          initialFocusRef={categoryInputRef}
        >
          <form
            className="mcfg-form"
            onSubmit={(event) => void saveCategory(event)}
          >
            <label>
              分类名称
              <input
                ref={categoryInputRef}
                value={categoryDraft.name}
                maxLength={80}
                onChange={(event) =>
                  setCategoryDraft({
                    ...categoryDraft,
                    name: event.target.value,
                  })
                }
                disabled={savingCategory}
              />
            </label>
            <label>
              商品范围
              <select
                aria-label="商品范围"
                value={categoryDraft.scope}
                onChange={(event) =>
                  setCategoryDraft({
                    ...categoryDraft,
                    scope: event.target.value as "toys" | "general",
                  })
                }
                disabled={savingCategory || Boolean(categoryDraft.parentId)}
              >
                <option value="toys">玩具</option>
                <option value="general">其他商品</option>
              </select>
            </label>
            <label>
              上级分类
              <select
                aria-label="上级分类"
                value={categoryDraft.parentId}
                onChange={(event) => {
                  const parentId = event.target.value;
                  const parent = config?.categories.find(
                    (category) => category.id === parentId,
                  );
                  setCategoryDraft({
                    ...categoryDraft,
                    parentId,
                    scope: parent?.scope ?? "general",
                  });
                }}
                disabled={savingCategory}
              >
                <option value="">无上级分类</option>
                {config?.categories
                  .filter((category) => category.id !== categoryDraft.id)
                  .map((category) => (
                    <option value={category.id} key={category.id}>
                      {category.name}
                    </option>
                  ))}
              </select>
            </label>
            {categoryError && (
              <p className="mcfg-error" role="alert">
                {categoryError}
              </p>
            )}
            <footer className="mcfg-form-actions">
              <button
                type="button"
                className="mcfg-button"
                onClick={() => setCategoryDraft(null)}
                disabled={savingCategory}
              >
                取消
              </button>
              <button
                type="submit"
                className="mcfg-button mcfg-primary"
                disabled={savingCategory}
              >
                {savingCategory ? "保存中…" : "保存分类"}
              </button>
            </footer>
          </form>
        </ConfigDialog>
      )}
    </section>
  );
}

export default MonitoringConfigWorkspace;
