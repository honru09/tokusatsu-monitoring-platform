"use client";

import React, { useMemo, useRef } from "react";
import "../styles/monitoring-config.css";
import { AppleActionRail } from "./apple-action-rail";
import {
  browseableListingTypes as selectableListingTypes,
  listingTypeLabel,
  type ListingType,
} from "../lib/listing-type";

export type MarketOverviewData = {
  activeTotal: number;
  valueKingTotal?: number;
  categories: { key: string; count: number }[];
  collections?: { key: string; categoryIp: string; count: number }[];
  listingTypes: { key: string; count: number }[];
  sources: { key: string; displayName: string; count: number }[];
  discoveryTrend: { date: string; count: number }[];
  xianyuComparison?: {
    total: number;
    priceBands: {
      key: "lt_300" | "300_999" | "gte_1000";
      label: string;
      count: number;
    }[];
  };
};

export type HomeWorkspaceEntry =
  | "purchases"
  | "orders"
  | "intel"
  | "logistics"
  | "resale"
  | "workbench";

export type XianyuPriceBand = "lt_300" | "300_999" | "gte_1000";

type Props = {
  data?: MarketOverviewData;
  error?: string;
  onRetry?: () => void;
  activeCategory: string;
  activeCollection?: string;
  activeListingType: ListingType;
  updatedAt?: string | null;
  onSelectCategory: (key: string) => void;
  onSelectCollection: (key: string, categoryIp: string) => void;
  onSelectListingType: (key: ListingType) => void;
  onOpenInventory: () => void;
  onOpenValueKings: () => void;
  onOpenUrgentAuctions: () => void;
  onOpenXianyuComparison: (
    priceBand?: XianyuPriceBand,
    sortOrder?: "asc" | "desc",
  ) => void;
  onOpenWorkspace: (workspace: HomeWorkspaceEntry) => void;
  /** Favorites and link imports are catalog views now, not pages. */
  onOpenCatalogView: (view: "favorites" | "links") => void;
  onOpenAnalysis: () => void;
  hasAnalysis: boolean;
  urgentAuctionCount?: number;
  customCategories?: Array<{
    id: string;
    name: string;
    activeItems?: number;
    parentId?: string | null;
    scope?: string;
  }>;
  activeCustomCategoryId?: string;
  onSelectCustomCategory?: (id: string) => void;
};

const categoryNames: Record<string, string> = {
  kamen_rider: "假面骑士",
  ultraman: "奥特曼",
  super_sentai: "超级战队",
  godzilla: "哥斯拉",
  other: "其他",
  unknown: "待识别",
};

const integer = new Intl.NumberFormat("zh-CN");

function formatTime(value?: string | null) {
  if (!value) return "正在连接";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚更新";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function dateLabel(value: string) {
  const date = new Date(`${value}T00:00:00+09:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        month: "numeric",
        day: "numeric",
      }).format(date);
}

function fallbackCategoryName(key: string) {
  return categoryNames[key] ?? key.replaceAll("_", " ");
}

function AnalysisIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3.5 13.7 8l4.8 1.7-4.8 1.7L12 16l-1.7-4.6-4.8-1.7L10.3 8 12 3.5Z" />
      <path d="m18.5 15 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
    </svg>
  );
}

function DisclosureChevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

type EntryIconKind =
  | "store"
  | "direct"
  | "auction"
  | "compare"
  | "heart"
  | "link"
  | "receipt"
  | "box"
  | "seller"
  | "news"
  | "logistics"
  | "crown"
  | "discover"
  | "workbench";

function EntryIcon({ kind }: { kind: EntryIconKind }) {
  const paths: Record<EntryIconKind, React.ReactNode> = {
    store: (
      <>
        <path d="M5 8.5h14l-1 11H6l-1-11Z" />
        <path d="M9 9V6.5a3 3 0 0 1 6 0V9" />
      </>
    ),
    direct: (
      <>
        <rect x="4" y="5" width="16" height="14" rx="3" />
        <path d="M8 10h8M8 14h5" />
      </>
    ),
    auction: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    compare: (
      <>
        <path d="M5 7h12m0 0-3-3m3 3-3 3" />
        <path d="M19 17H7m0 0 3 3m-3-3 3-3" />
      </>
    ),
    heart: (
      <path d="M20 8.5c0 5-8 10-8 10s-8-5-8-10a4.5 4.5 0 0 1 8-2.8 4.5 4.5 0 0 1 8 2.8Z" />
    ),
    link: (
      <>
        <path d="m9 15 6-6" />
        <path
          d="M7.5 17.5 5 20a4 4 0 0 1-5.7-5.7l3.5-3.5a4 4 0 0 1 5.7 0"
          transform="translate(4 -3)"
        />
        <path
          d="M16.5 6.5 19 4a4 4 0 0 1 5.7 5.7l-3.5 3.5a4 4 0 0 1-5.7 0"
          transform="translate(-4 3)"
        />
      </>
    ),
    receipt: (
      <>
        <path d="M7 3h10v18l-2-1.5L12 21l-3-1.5L7 21V3Z" />
        <path d="M10 8h4m-4 4h4m-4 4h3" />
      </>
    ),
    box: (
      <>
        <path d="m4 7 8-4 8 4-8 4-8-4Z" />
        <path d="M4 7v10l8 4 8-4V7M12 11v10" />
      </>
    ),
    seller: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 7.5a2.5 2.5 0 0 1 0 5M17 15a4 4 0 0 1 3.5 4" />
      </>
    ),
    news: (
      <>
        <path d="M5 4h14v16H5z" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </>
    ),
    logistics: (
      <>
        <path d="M3 6h11v10H3zM14 10h4l3 3v3h-7" />
        <circle cx="7" cy="18" r="2" />
        <circle cx="18" cy="18" r="2" />
      </>
    ),
    crown: (
      <>
        <path d="M4.5 8.5 8.5 12l3.5-6 3.5 6 4-3.5-1.5 9H6l-1.5-9Z" />
        <path d="M6 17.5h12" />
      </>
    ),
    discover: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m15.5 8.5-2.1 4.9-4.9 2.1 2.1-4.9 4.9-2.1Z" />
      </>
    ),
    workbench: (
      <>
        <rect x="4" y="4" width="6" height="6" rx="1.5" />
        <rect x="14" y="4" width="6" height="6" rx="1.5" />
        <rect x="4" y="14" width="6" height="6" rx="1.5" />
        <rect x="14" y="14" width="6" height="6" rx="1.5" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[kind]}
    </svg>
  );
}

function HomeMenuEntry({
  icon,
  label,
  onClick,
}: {
  icon: EntryIconKind;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="home-menu-entry">
      <span className="home-menu-entry-icon">
        <EntryIcon kind={icon} />
      </span>
      <span className="home-menu-entry-copy">
        <strong>{label}</strong>
      </span>
      <span className="home-menu-entry-chevron" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

export function HomeMarketOverview({
  error,
  onRetry,
  data,
  activeCategory,
  activeCollection,
  updatedAt,
  onSelectCategory,
  onSelectCollection,
  onSelectListingType,
  onOpenInventory,
  onOpenValueKings,
  onOpenUrgentAuctions,
  onOpenXianyuComparison,
  onOpenWorkspace,
  onOpenCatalogView,
  onOpenAnalysis,
  hasAnalysis,
  urgentAuctionCount = 0,
  customCategories = [],
  activeCustomCategoryId,
  onSelectCustomCategory,
}: Props) {
  const categoryDrawerRef = useRef<HTMLDetailsElement>(null);
  const listingTypes = useMemo(
    () => new Map(data?.listingTypes.map((entry) => [entry.key, entry.count])),
    [data?.listingTypes],
  );
  const xianyuComparison = data?.xianyuComparison;
  const hasXianyuComparison = (xianyuComparison?.total ?? 0) > 0;
  const largestTrend = Math.max(
    1,
    ...(data?.discoveryTrend.map((entry) => entry.count) ?? [1]),
  );
  const largestSource = Math.max(
    1,
    ...(data?.sources.map((entry) => entry.count) ?? [1]),
  );
  const selectableCategories = data
    ? [
        { key: "all", count: data.activeTotal },
        ...data.categories.filter((entry) => entry.count > 0),
      ]
    : [];
  const collectionCount = (key: string, categoryIp: string) =>
    data?.collections?.find(
      (entry) => entry.key === key && entry.categoryIp === categoryIp,
    )?.count ?? 0;
  const collectionOptions: Record<
    string,
    Array<{ key: string; label: string; detail: string }>
  > = {
    kamen_rider: [
      {
        key: "shf",
        label: "S.H.Figuarts",
        detail: "假面骑士 · 普通 · 真骨雕",
      },
      { key: "sic", label: "S.I.C.", detail: "假面骑士" },
    ],
    ultraman: [{ key: "shf", label: "S.H.Figuarts", detail: "奥特曼" }],
  };
  const activeCollectionOption = activeCollection
    ? collectionOptions[activeCategory]?.find(
        (entry) => entry.key === activeCollection,
      )
    : undefined;
  const activeCustomCategory = customCategories.find(
    (entry) => entry.id === activeCustomCategoryId,
  );
  const activeCategoryCount = activeCustomCategory
    ? activeCustomCategory.activeItems
    : activeCollection
      ? collectionCount(activeCollection, activeCategory)
      : activeCategory === "all"
        ? (data?.activeTotal ?? 0)
        : (data?.categories.find((entry) => entry.key === activeCategory)
            ?.count ?? 0);
  const activeCategoryLabel = activeCustomCategory
    ? activeCustomCategory.name
    : activeCollectionOption
      ? `${fallbackCategoryName(activeCategory)} · ${activeCollectionOption.label}`
      : activeCategory === "all"
        ? "全部玩具"
        : fallbackCategoryName(activeCategory);

  const directCount = listingTypes.get("direct") ?? 0;
  const auctionCount = listingTypes.get("auction") ?? 0;
  return (
    <div className="home-dashboard">
      <section
        className="home-market-overview js-shell-reveal"
        aria-labelledby="home-market-title"
        aria-busy={!data && !error}
      >
        <div className="home-market-head">
          <div className="min-w-0">
            <p className="home-editorial-kicker">市场总览</p>
            <h2 id="home-market-title">全库在售态势</h2>
            {data ? (
              <p>
                <strong>{integer.format(data.activeTotal)}</strong> 件在售
                {" · "}
                {formatTime(updatedAt)} 更新
              </p>
            ) : (
              <p>{error ? "数据暂未就绪" : "正在汇总全库实时数据…"}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onOpenAnalysis}
            aria-haspopup="dialog"
            className="home-analysis-button"
          >
            <span className="home-analysis-icon">
              <AnalysisIcon />
            </span>
            <span>AI 采购分析</span>
            {hasAnalysis && <i aria-label="已有分析结果" />}
          </button>
        </div>

        {error && <div className="home-overview-error" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>重新读取</button></div>}
        {data ? (
          <>
            <div className="home-market-grid">
              <figure className="home-trend" aria-labelledby="home-trend-title">
                <figcaption>
                  <span id="home-trend-title">近 7 日发现</span>
                  <strong>
                    {integer.format(
                      data.discoveryTrend.reduce(
                        (sum, entry) => sum + entry.count,
                        0,
                      ),
                    )}
                    <small> 件</small>
                  </strong>
                </figcaption>
                <div className="home-trend-bars">
                  {data.discoveryTrend.map((entry) => (
                    <div key={entry.date} className="home-trend-day">
                      <span className="home-trend-value">
                        {integer.format(entry.count)}
                      </span>
                      <span className="home-trend-track" aria-hidden="true">
                        <i
                          style={{
                            height: `${entry.count === 0 ? 0 : Math.max(2, (entry.count / largestTrend) * 100)}%`,
                          }}
                        />
                      </span>
                      <time dateTime={entry.date}>{dateLabel(entry.date)}</time>
                    </div>
                  ))}
                </div>
              </figure>

              <div className="home-market-structure">
                <div className="home-market-structure-head">
                  <h3>交易方式</h3>
                  <span>全库构成</span>
                </div>
                <div
                  className="home-listing-switch"
                  role="group"
                  aria-label="交易方式构成"
                >
                  {selectableListingTypes.map((key) => {
                    const count = listingTypes.get(key) ?? 0;
                    const ratio = data.activeTotal
                      ? Math.round((count / data.activeTotal) * 100)
                      : 0;
                    return (
                      <div key={key} className="home-trade-summary">
                        <span>{listingTypeLabel(key)}</span>
                        <strong>{integer.format(count)}</strong>
                        <small>{ratio}%</small>
                      </div>
                    );
                  })}
                </div>
                <div className="home-trade-mix" aria-hidden="true">
                  {selectableListingTypes.map((key) => (
                    <span
                      key={key}
                      style={{
                        width: `${data.activeTotal ? Math.min(100, ((listingTypes.get(key) ?? 0) / data.activeTotal) * 100) : 0}%`,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="home-market-lower">
              <div className="home-source-list">
                <h3>来源分布</h3>
                <div>
                  {data.sources.slice(0, 6).map((source) => (
                    <span key={source.key} className="home-source-row">
                      <b title={source.displayName}>{source.displayName}</b>
                      <i aria-hidden="true">
                        <span
                          style={{
                            width: `${(source.count / largestSource) * 100}%`,
                          }}
                        />
                      </i>
                      <strong>{integer.format(source.count)}</strong>
                    </span>
                  ))}
                </div>
              </div>

              <details ref={categoryDrawerRef} className="home-category-drawer">
                <summary>
                  <span className="home-category-drawer-copy">
                    <small>商品分类</small>
                    <strong>{activeCategoryLabel}</strong>
                  </span>
                  <span className="home-category-drawer-count">
                    {activeCategoryCount == null
                      ? "待统计"
                      : integer.format(activeCategoryCount)}
                  </span>
                  <span className="home-category-drawer-chevron">
                    <DisclosureChevron />
                  </span>
                </summary>
                <nav className="home-category-list" aria-label="按商品类别查看">
                  <div>
                    {selectableCategories.map((entry) => (
                      <React.Fragment key={entry.key}>
                        <button
                          type="button"
                          aria-pressed={
                            activeCategory === entry.key &&
                            !activeCollection &&
                            !activeCustomCategoryId
                          }
                          onClick={() => {
                            onSelectCategory(entry.key);
                            if (categoryDrawerRef.current)
                              categoryDrawerRef.current.open = false;
                          }}
                        >
                          <span>
                            {entry.key === "all"
                              ? "全部玩具"
                              : fallbackCategoryName(entry.key)}
                          </span>
                          <strong>{integer.format(entry.count)}</strong>
                        </button>
                        {collectionOptions[entry.key]?.map((collection) => {
                          const count = collectionCount(
                            collection.key,
                            entry.key,
                          );
                          if (!count) return null;
                          return (
                            <button
                              type="button"
                              key={`${entry.key}-${collection.key}`}
                              className="home-category-subitem"
                              aria-pressed={
                                activeCategory === entry.key &&
                                activeCollection === collection.key &&
                                !activeCustomCategoryId
                              }
                              onClick={() => {
                                onSelectCollection(collection.key, entry.key);
                                if (categoryDrawerRef.current)
                                  categoryDrawerRef.current.open = false;
                              }}
                            >
                              <span>{collection.label}</span>
                              <strong>{integer.format(count)}</strong>
                              <small>{collection.detail}</small>
                            </button>
                          );
                        })}
                      </React.Fragment>
                    ))}
                    {onSelectCustomCategory && customCategories.length > 0 && (
                      <div className="home-monitoring-category-group">
                        <h3>监控分类</h3>
                        {customCategories.map((category) => (
                          <button
                            type="button"
                            key={category.id}
                            aria-label={`查看 ${category.name}`}
                            aria-pressed={
                              activeCustomCategoryId === category.id
                            }
                            className={
                              category.parentId
                                ? "home-category-subitem"
                                : undefined
                            }
                            onClick={() => {
                              onSelectCustomCategory(category.id);
                              if (categoryDrawerRef.current)
                                categoryDrawerRef.current.open = false;
                            }}
                          >
                            <span>{category.name}</span>
                            <strong>
                              {category.activeItems == null
                                ? "待统计"
                                : integer.format(category.activeItems)}
                            </strong>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </nav>
              </details>
            </div>
          </>
        ) : !error ? (
          <div className="home-market-loading" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        ) : null}
      </section>

      {data && (
        <section
          className="home-entry-directory js-shell-reveal"
          aria-labelledby="home-entry-directory-title"
        >
          <header className="home-entry-directory-head">
            <div>
              <h2 id="home-entry-directory-title">商品库</h2>
            </div>
            <span>{integer.format(data.activeTotal)} 件在售</span>
          </header>

          <div className="home-task-bridge" aria-label="商品流转">
            <button type="button" onClick={onOpenInventory}><span>01</span><strong>选货</strong><b aria-hidden="true">→</b></button>
            <button type="button" onClick={()=>onOpenWorkspace("orders")}><span>02</span><strong>采购</strong><b aria-hidden="true">→</b></button>
            <button type="button" onClick={()=>onOpenWorkspace("resale")}><span>03</span><strong>闲鱼售卖</strong><b aria-hidden="true">↗</b></button>
          </div>

          <button
            type="button"
            onClick={onOpenInventory}
            className="home-library-entry"
          >
            <span className="home-library-entry-icon">
              <EntryIcon kind="store" />
            </span>
            <span className="home-library-entry-copy">
              <strong>在售商品</strong>
            </span>
            <b>{integer.format(data.activeTotal)}</b>
            <span aria-hidden="true">›</span>
          </button>

          <button
            type="button"
            onClick={onOpenValueKings}
            className="home-value-king-entry"
          >
            <span className="home-value-king-icon">
              <EntryIcon kind="crown" />
            </span>
            <span className="home-value-king-copy">
              <strong>性价比之王</strong>
              <small>精选直购</small>
            </span>
            <b>{integer.format(data.valueKingTotal ?? 0)}</b>
            <span aria-hidden="true">›</span>
          </button>

          <AppleActionRail className="home-catalog-entry-grid">
            <button type="button" onClick={() => onSelectListingType("direct")}>
              <span>
                <EntryIcon kind="direct" />
              </span>
              <small>直购</small>
              <strong>{integer.format(directCount)}</strong>
            </button>
            <button
              type="button"
              onClick={() => onSelectListingType("auction")}
            >
              <span>
                <EntryIcon kind="auction" />
              </span>
              <small>拍卖</small>
              <strong>{integer.format(auctionCount)}</strong>
            </button>
            <button
              type="button"
              onClick={onOpenUrgentAuctions}
              className="is-urgent"
            >
              <span>
                <EntryIcon kind="auction" />
              </span>
              <small>30 分钟内</small>
              <strong>{integer.format(urgentAuctionCount)}</strong>
            </button>
          </AppleActionRail>

          <details className="home-xianyu-drawer">
            <summary>
              <span className="home-xianyu-icon">
                <EntryIcon kind="compare" />
              </span>
              <span className="home-xianyu-copy">
                <strong>闲鱼同款对价</strong>
                <small>
                  {hasXianyuComparison ? "同款参考价" : "暂未生成可信同款"}
                </small>
              </span>
              <b>{integer.format(xianyuComparison?.total ?? 0)}</b>
              <span className="home-xianyu-chevron">
                <DisclosureChevron />
              </span>
            </summary>
            <div className="home-xianyu-body">
              {hasXianyuComparison ? (
                <>
                  <div
                    className="home-xianyu-sort"
                    role="group"
                    aria-label="闲鱼参考价排序"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenXianyuComparison(undefined, "asc")}
                    >
                      价格从低到高
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenXianyuComparison(undefined, "desc")}
                    >
                      价格从高到低
                    </button>
                  </div>
                  <div className="home-xianyu-bands">
                    {(xianyuComparison?.priceBands ?? []).map((band) => (
                      <button
                        type="button"
                        key={band.key}
                        disabled={band.count === 0}
                        onClick={() => onOpenXianyuComparison(band.key, "asc")}
                      >
                        <span>{band.label}</span>
                        <strong>{integer.format(band.count)}</strong>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="home-xianyu-empty" role="status">
                  目前没有达到公开条件的闲鱼同款；生成后会自动归入这里。
                </p>
              )}
            </div>
          </details>

          <section
            className="home-entry-group"
            aria-labelledby="home-flow-title"
          >
            <h3 id="home-flow-title">收藏与流转</h3>
            <div className="home-menu-group">
              <HomeMenuEntry
                icon="heart"
                label="收藏"
                onClick={() => onOpenCatalogView("favorites")}
              />
              <HomeMenuEntry
                icon="link"
                label="链接导入"
                onClick={() => onOpenCatalogView("links")}
              />
              <HomeMenuEntry
                icon="receipt"
                label="购买记录"
                onClick={() => onOpenWorkspace("purchases")}
              />
              <HomeMenuEntry
                icon="box"
                label="库存订单"
                onClick={() => onOpenWorkspace("orders")}
              />
            </div>
          </section>

          <section
            className="home-entry-group"
            aria-labelledby="home-research-title"
          >
            <h3 id="home-research-title">发现与研究</h3>
            <div className="home-menu-group">
              <HomeMenuEntry
                icon="news"
                label="资讯专区"
                onClick={() => onOpenWorkspace("intel")}
              />
              <HomeMenuEntry
                icon="logistics"
                label="物流测算"
                onClick={() => onOpenWorkspace("logistics")}
              />
              <HomeMenuEntry
                icon="workbench"
                label="工作台"
                onClick={() => onOpenWorkspace("workbench")}
              />
            </div>
          </section>
        </section>
      )}
    </div>
  );
}
