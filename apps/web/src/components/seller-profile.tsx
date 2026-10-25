"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { LoadError } from "./load-error";
import {
  buildBundleNegotiationScript,
  buildBundleShareText,
  type CollaborationItem,
} from "./collaboration-chat-workspace";
import {
  fmtCny,
  fmtYen,
  itemDisplayTitle,
  relativeTime,
} from "../lib/listing-display";
import { listingTypeLabel, type ListingType } from "../lib/listing-type";
import { marketplaceSourceName as sourceName } from "../lib/source-label";
import { getShellOverlayRoot } from "../lib/shell-overlay";
import { useDialogFocus } from "../lib/use-dialog-focus";
import { yahooFleamarketDiscount } from "../lib/yahoo-discount";
import styles from "./seller-profile.module.css";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const PAGE_LIMIT = 48;
const UNKNOWN_SOURCE = { key: "unknown", displayName: "来源待确认" };

type SourceRef = { key: string; displayName: string };

/**
 * The slice of an item this page reads. Relations (`source`, `images`) are
 * optional on purpose: a row that arrives without one renders without that
 * decoration instead of taking the whole page down.
 */
export type SellerProfileItem = {
  id: string;
  titleRaw: string;
  titleZh?: string | null;
  sourceUrl: string;
  priceCurrent: number;
  listingType?: ListingType | string | null;
  status?: string | null;
  listedAt?: string | null;
  conditionGrade?: string | null;
  source?: SourceRef | null;
  images?: { url: string; position: number }[] | null;
  product?: { canonicalName?: string | null; titleZh?: string | null } | null;
};

/** Aggregates over the seller's whole visible catalogue (not just loaded pages). */
export type SellerStats = {
  activeCount: number;
  soldCount: number;
  priceMinJpy: number | null;
  priceMaxJpy: number | null;
  lastListedAt: string | null;
};

type SellerAnalysis<TItem extends SellerProfileItem> = {
  seller: {
    id: string;
    name: string;
    sellerType?: string;
    locationText?: string | null;
    profileUrl?: string | null;
    sourceData?: Record<string, unknown> | null;
    source?: SourceRef | null;
    segment?: { key: string; label: string; reasons?: string[] } | null;
  };
  items: TItem[];
  stats?: SellerStats | null;
  total: number;
  page: number;
  limit: number;
  pageCount: number;
  analysis: {
    sellerType: string;
    profile: string;
    negotiation?: string;
    negotiationJa: string;
    negotiationZh: string;
    suggestedPrice?: number | null;
    confidence?: string;
  };
  mode: "rules" | "ai";
};

export type SellerStatusFilter = "all" | "active" | "sold";
export type SellerSort = "default" | "priceAsc" | "priceDesc" | "listedDesc";

const STATUS_FILTERS: { key: SellerStatusFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "active", label: "在售" },
  { key: "sold", label: "已售" },
];

const SORTS: { key: SellerSort; label: string }[] = [
  { key: "default", label: "默认（最新检出）" },
  { key: "priceAsc", label: "价格从低到高" },
  { key: "priceDesc", label: "价格从高到低" },
  { key: "listedDesc", label: "上架最新" },
];

const AVATAR_TONES = [
  "#0b6bcb",
  "#2e7d4f",
  "#b4532a",
  "#7a4fb5",
  "#0f766e",
  "#b3345a",
  "#8a5a00",
  "#475569",
] as const;

/** Deterministic tone per seller id (FNV-1a), so a seller always looks the same. */
export function avatarTone(sellerId: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < sellerId.length; index += 1) {
    hash ^= sellerId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function avatarInitial(name: string | null | undefined) {
  const first = Array.from((name ?? "").trim())[0];
  return first ? first.toUpperCase() : "?";
}

/** Compact yen for the narrow price-band brick: ¥300 / ¥1.3万. */
function compactYen(value: number) {
  if (value >= 10_000) {
    const man = value / 10_000;
    return `${Number.isInteger(man) ? man : man.toFixed(1)}万`;
  }
  return value.toLocaleString("ja-JP");
}

export function formatPriceBand(
  min: number | null | undefined,
  max: number | null | undefined,
) {
  if (min == null || max == null) return "—";
  if (min === max) return `¥${compactYen(min)}`;
  return `¥${compactYen(min)}–${compactYen(max)}`;
}

function normalizeQuery(value: string) {
  return value.normalize("NFKC").toLowerCase().trim();
}

/** Front-end only: searches titles of the items already loaded. */
export function filterSellerItems<TItem extends SellerProfileItem>(
  items: readonly TItem[],
  query: string,
  status: SellerStatusFilter,
) {
  const needle = normalizeQuery(query);
  return items.filter((item) => {
    if (status === "active" && item.status !== "active") return false;
    if (status === "sold" && item.status !== "sold") return false;
    if (!needle) return true;
    const haystack = normalizeQuery(
      `${itemDisplayTitle(item, "zh")} ${item.titleRaw}`,
    );
    return haystack.includes(needle);
  });
}

function timeOf(value?: string | null) {
  if (!value) return Number.NaN;
  return Date.parse(value);
}

export function sortSellerItems<TItem extends SellerProfileItem>(
  items: readonly TItem[],
  sort: SellerSort,
) {
  const rows = [...items];
  if (sort === "priceAsc") {
    rows.sort((left, right) => left.priceCurrent - right.priceCurrent);
  } else if (sort === "priceDesc") {
    rows.sort((left, right) => right.priceCurrent - left.priceCurrent);
  } else if (sort === "listedDesc") {
    // Rows without a listing time sink to the end; Array.sort is stable, so
    // ties keep the server's latest-detected order.
    rows.sort((left, right) => {
      const a = timeOf(left.listedAt);
      const b = timeOf(right.listedAt);
      const aKnown = Number.isFinite(a);
      const bKnown = Number.isFinite(b);
      if (aKnown && bKnown) return b - a;
      if (aKnown) return -1;
      if (bKnown) return 1;
      return 0;
    });
  }
  return rows;
}

/**
 * The payload is checked once at the boundary. Past this point `seller` and
 * `analysis` are dereferenced directly: the API always builds both (the
 * analysis falls back to rules when the model is unavailable), and anything
 * else is reported as a load error rather than rendered.
 */
function isSellerPayload(
  value: unknown,
): value is SellerAnalysis<SellerProfileItem> {
  if (!value || typeof value !== "object") return false;
  const row = value as { seller?: unknown; analysis?: unknown };
  return (
    !!row.seller &&
    typeof row.seller === "object" &&
    !!row.analysis &&
    typeof row.analysis === "object"
  );
}

function CloseGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function ExternalGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function Brick({
  label,
  value,
  hint,
  title,
  long,
  positive,
}: {
  label: string;
  value: string;
  hint?: string;
  title?: string;
  long?: boolean;
  positive?: boolean;
}) {
  return (
    <div className={styles.brick} title={title}>
      <span className={styles.brickLabel}>{label}</span>
      <strong
        className={`${styles.brickValue} ${long ? styles.brickValueLong : ""} ${positive ? styles.brickPositive : ""}`}
      >
        {value}
      </strong>
      {hint ? <span className={styles.brickHint}>{hint}</span> : null}
    </div>
  );
}

function SellerTile<TItem extends SellerProfileItem>({
  item,
  checked,
  exchangeRate,
  onToggle,
  onOpen,
}: {
  item: TItem;
  checked: boolean;
  exchangeRate?: number;
  onToggle: (itemId: string) => void;
  onOpen: (item: TItem) => void;
}) {
  const title = itemDisplayTitle(item, "zh");
  const cover = item.images?.[0];
  // `source` is a relation; without it there is simply no price hint.
  const discount = item.source?.key
    ? yahooFleamarketDiscount(item.source.key, item.priceCurrent)
    : null;
  const typeLabel = item.listingType
    ? listingTypeLabel(item.listingType as ListingType)
    : "";
  const cny = fmtCny(item.priceCurrent, exchangeRate);
  return (
    <li className={styles.tileCell} data-item-id={item.id}>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className={`${styles.tile} ${checked ? styles.tileSelected : ""}`}
      >
        <span className={styles.tileMedia}>
          {cover ? (
            <img src={cover.url} alt="" loading="lazy" decoding="async" />
          ) : null}
          {item.status === "sold" ? (
            <span className={styles.soldBadge}>已售</span>
          ) : null}
          {typeLabel || discount ? (
            <span className={styles.mediaChips}>
              {typeLabel ? (
                <span className={styles.mediaChip}>{typeLabel}</span>
              ) : null}
              {discount ? (
                <span
                  className={styles.mediaChip}
                  title="以当前标价降20%测算，不含邮费，不代表卖家已同意降价。"
                >
                  可砍至 {fmtYen(discount.targetYen)}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
        <span className={styles.tileBody}>
          <span className={styles.tilePrice}>
            <span className={styles.tilePriceYen}>
              {fmtYen(item.priceCurrent)}
            </span>
            {cny ? <span className={styles.tilePriceCny}>{cny}</span> : null}
          </span>
          <span className={styles.tileTitle}>{title}</span>
        </span>
      </button>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={`选择商品凑单：${title}`}
        onClick={() => onToggle(item.id)}
        className={`${styles.check} ${checked ? styles.checkOn : ""}`}
      >
        <span className={styles.checkMark}>
          <CheckGlyph />
        </span>
      </button>
    </li>
  );
}

export function SellerProfile<TItem extends SellerProfileItem>({
  sellerId,
  onClose,
  onOpenItem,
  onSendBundle,
  onBundleCopied,
  exchangeRate,
}: {
  sellerId: string;
  onClose: () => void;
  onOpenItem: (item: TItem) => void;
  onSendBundle?: (items: TItem[], targetPriceYen?: number | null) => void;
  onBundleCopied?: (itemIds: string[]) => void;
  exchangeRate?: number;
}) {
  const [data, setData] = useState<SellerAnalysis<TItem> | null>(null);
  const [targetPrice, setTargetPrice] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [copiedBundleJa, setCopiedBundleJa] = useState(false);
  const [copiedBundleShare, setCopiedBundleShare] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [moreError, setMoreError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<SellerStatusFilter>("all");
  const [sort, setSort] = useState<SellerSort>("default");
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const requestRef = useRef(0);

  useDialogFocus({
    active: true,
    dialogRef,
    initialFocusRef: closeRef,
    onClose,
  });

  const loadedItems = useMemo(() => data?.items ?? [], [data?.items]);
  const selectedItems = useMemo(
    () => loadedItems.filter((item) => selectedIds.has(item.id)),
    [loadedItems, selectedIds],
  );
  const selectedTotalYen = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.priceCurrent, 0),
    [selectedItems],
  );
  const parsedTargetPriceYen = useMemo(() => {
    const num = Number(targetPrice.trim());
    return Number.isFinite(num) && num > 0 ? Math.round(num) : null;
  }, [targetPrice]);
  const visibleItems = useMemo(
    () => sortSellerItems(filterSellerItems(loadedItems, query, statusFilter), sort),
    [loadedItems, query, statusFilter, sort],
  );

  /** The collaboration workspace dereferences `item.source` directly. A
   * seller only ever lists on one platform, so a row that lost its relation
   * inherits the seller's own platform on the way out. */
  const withSource = useCallback(
    (item: TItem) => ({
      ...item,
      source: item.source ?? data?.seller.source ?? UNKNOWN_SOURCE,
      images: item.images ?? [],
    }),
    [data?.seller.source],
  );
  const bundleReady = useCallback(
    (items: TItem[]) =>
      items.map((item) => ({
        ...withSource(item),
        seller: { id: sellerId, name: data?.seller.name ?? "" },
      })) as unknown as CollaborationItem[],
    [data?.seller.name, sellerId, withSource],
  );

  const toggleSelectItem = useCallback((itemId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const flash = useCallback((set: (value: boolean) => void) => {
    set(true);
    window.setTimeout(() => set(false), 1800);
  }, []);

  const copySelectedBundleScript = useCallback(() => {
    if (!selectedItems.length) return;
    const script = buildBundleNegotiationScript(
      bundleReady(selectedItems),
      parsedTargetPriceYen,
    );
    void navigator.clipboard?.writeText(script);
    flash(setCopiedBundleJa);
    onBundleCopied?.(selectedItems.map((item) => item.id));
  }, [bundleReady, flash, onBundleCopied, parsedTargetPriceYen, selectedItems]);

  const copySelectedBundleShareText = useCallback(() => {
    if (!selectedItems.length) return;
    void navigator.clipboard?.writeText(
      buildBundleShareText(
        bundleReady(selectedItems),
        null,
        parsedTargetPriceYen,
      ),
    );
    flash(setCopiedBundleShare);
    onBundleCopied?.(selectedItems.map((item) => item.id));
  }, [bundleReady, flash, onBundleCopied, parsedTargetPriceYen, selectedItems]);

  const load = useCallback(
    async (price?: string) => {
      const request = ++requestRef.current;
      setAnalyzing(true);
      setError("");
      try {
        const params = price?.trim()
          ? `?targetPrice=${encodeURIComponent(price.trim())}&page=1&limit=${PAGE_LIMIT}`
          : `?page=1&limit=${PAGE_LIMIT}`;
        const response = await fetch(
          `${API}/analysis/seller/${sellerId}${params}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`API ${response.status}`);
        const payload: unknown = await response.json();
        if (request !== requestRef.current) return;
        if (!isSellerPayload(payload)) throw new Error("商家数据不完整");
        const next = {
          ...(payload as SellerAnalysis<TItem>),
          items: Array.isArray(payload.items)
            ? (payload.items as TItem[])
            : [],
        };
        setData((current) =>
          // Regenerating the script must not throw away pages already loaded.
          price?.trim() && current
            ? { ...next, items: current.items, page: current.page }
            : next,
        );
      } catch (reason) {
        if (request !== requestRef.current) return;
        setError(reason instanceof Error ? reason.message : "商家分析失败");
      } finally {
        if (request === requestRef.current) {
          setLoading(false);
          setAnalyzing(false);
        }
      }
    },
    [sellerId],
  );

  const loadMore = useCallback(async () => {
    if (!data || loadingMore || data.page >= data.pageCount) return;
    setLoadingMore(true);
    setMoreError("");
    try {
      const nextPage = data.page + 1;
      const response = await fetch(
        `${API}/items/sellers/${sellerId}?page=${nextPage}&limit=${data.limit}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`API ${response.status}`);
      const next = (await response.json()) as {
        items?: TItem[];
        page?: number;
        pageCount?: number;
        total?: number;
      };
      setData((current) => {
        if (!current) return current;
        const known = new Set(current.items.map((item) => item.id));
        const incoming = (Array.isArray(next.items) ? next.items : []).filter(
          (item) => !known.has(item.id),
        );
        return {
          ...current,
          items: [...current.items, ...incoming],
          page: next.page ?? nextPage,
          pageCount: next.pageCount ?? current.pageCount,
          total: next.total ?? current.total,
        };
      });
    } catch (reason) {
      setMoreError(reason instanceof Error ? reason.message : "商品加载失败");
    } finally {
      setLoadingMore(false);
    }
  }, [data, loadingMore, sellerId]);

  useEffect(() => {
    void load();
    return () => {
      // Invalidate whatever is still in flight for the previous seller.
      requestRef.current += 1;
    };
  }, [load]);

  const seller = data?.seller;
  const stats = data?.stats ?? null;
  const segmentLabel = seller?.segment?.label ?? data?.analysis.sellerType;
  const platformName = seller?.source
    ? sourceName(seller.source.key, seller.source.displayName)
    : "";
  const allVisibleSelected =
    visibleItems.length > 0 &&
    visibleItems.every((item) => selectedIds.has(item.id));
  const filtering = query.trim() !== "" || statusFilter !== "all";

  const bundleTargets = [
    { label: "9折", value: Math.round((selectedTotalYen * 0.9) / 100) * 100 },
    { label: "85折", value: Math.round((selectedTotalYen * 0.85) / 100) * 100 },
    { label: "8折", value: Math.round((selectedTotalYen * 0.8) / 100) * 100 },
  ];

  let body: ReactNode = null;
  if (data && seller) {
    body = (
      <div className={styles.stack}>
        {/* Identity */}
        <section className={styles.surface} aria-label="卖家身份">
          <div className="flex items-start gap-4">
            <span
              className={styles.avatar}
              style={{ backgroundColor: avatarTone(seller.id) }}
              aria-hidden="true"
            >
              {avatarInitial(seller.name)}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className={styles.name}>{seller.name}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {platformName ? (
                  <span className={`${styles.chip} ${styles.chipPlatform}`}>
                    {platformName}
                  </span>
                ) : null}
                {segmentLabel ? (
                  <span className={styles.chip}>{segmentLabel}</span>
                ) : null}
                {seller.locationText ? (
                  <span className={styles.chip}>{seller.locationText}</span>
                ) : null}
              </div>
              {seller.profileUrl ? (
                <a
                  href={seller.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`${styles.pill} ${styles.pillCompact} mt-3`}
                >
                  打开公开卖家页 <ExternalGlyph />
                </a>
              ) : null}
            </div>
          </div>
        </section>

        {/* Number bricks: real aggregates only. */}
        <section className={styles.bricks} aria-label="卖家数据">
          <Brick
            label="在售"
            value={stats ? stats.activeCount.toLocaleString("ja-JP") : "—"}
            hint="件"
            positive={!!stats && stats.activeCount > 0}
          />
          <Brick
            label="已售"
            value={stats ? stats.soldCount.toLocaleString("ja-JP") : "—"}
            hint="件"
          />
          <Brick
            label="价格带"
            value={
              stats ? formatPriceBand(stats.priceMinJpy, stats.priceMaxJpy) : "—"
            }
            title={
              stats && stats.priceMinJpy != null && stats.priceMaxJpy != null
                ? `${fmtYen(stats.priceMinJpy)} – ${fmtYen(stats.priceMaxJpy)}`
                : undefined
            }
            hint="日元"
            long
          />
          <Brick
            label="最近上架"
            value={stats?.lastListedAt ? relativeTime(stats.lastListedAt) : "—"}
            long
          />
        </section>

        {/* Profile + bargaining */}
        <div className="grid gap-3 md:grid-cols-[1fr_1.2fr]">
          <section className={styles.surface}>
            <div className="text-xs font-semibold text-meta">类型 / 画像</div>
            <div className="mt-1 text-lg font-bold text-ink">
              {data.analysis.sellerType}
            </div>
            <p className="mt-2.5 text-sm leading-6 text-ink/75">
              {data.analysis.profile}
            </p>
            {seller.segment?.reasons?.length ? (
              <ul className="mt-3 space-y-1 text-xs leading-5 text-meta">
                {seller.segment.reasons.slice(0, 3).map((reason) => (
                  <li key={reason}>· {reason}</li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className={styles.surface}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-meta">
                {selectedItems.length > 0
                  ? `已选 ${selectedItems.length} 件合并砍价日语`
                  : "砍价语录"}
              </div>
              <span className="text-[11px] font-semibold text-moss">
                {selectedItems.length > 0
                  ? "同店凑单模板"
                  : data.mode === "ai"
                    ? "AI"
                    : "规则建议"}
              </span>
            </div>
            <p
              lang="ja"
              className="mt-2.5 max-h-40 overflow-y-auto whitespace-pre-wrap text-[13px] font-medium leading-6 text-ink"
            >
              {selectedItems.length > 0
                ? buildBundleNegotiationScript(
                    bundleReady(selectedItems),
                    parsedTargetPriceYen,
                  )
                : (data.analysis.negotiationJa ?? data.analysis.negotiation)}
            </p>
            {selectedItems.length === 0 && (
              <p className="mt-2.5 border-t border-ink/10 pt-2.5 text-xs leading-5 text-meta">
                {data.analysis.negotiationZh}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <input
                inputMode="numeric"
                aria-label={
                  selectedItems.length > 0 ? "目标打包总价（日元）" : "目标价（日元）"
                }
                value={targetPrice}
                onChange={(event) =>
                  setTargetPrice(event.target.value.replace(/[^\d]/g, ""))
                }
                placeholder={
                  selectedItems.length > 0
                    ? "目标打包总价（日元）"
                    : "目标价（日元）"
                }
                className={`${styles.field} flex-1 font-mono tabular-nums`}
              />
              {selectedItems.length > 0 ? (
                <button
                  type="button"
                  onClick={copySelectedBundleScript}
                  className={`${styles.pill} ${styles.pillSolid}`}
                >
                  {copiedBundleJa ? "✓ 已复制" : "复制日语"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void load(targetPrice)}
                  disabled={analyzing}
                  className={`${styles.pill} ${styles.pillAccent}`}
                >
                  {analyzing ? "生成中" : "生成"}
                </button>
              )}
            </div>
          </section>
        </div>

        {/* Products */}
        <section className={styles.surface} aria-label="商品">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-heading text-base font-bold text-ink">商品</h3>
            <span className="text-xs text-meta tabular-nums">
              已加载 {loadedItems.length} / {data.total} 件
            </span>
          </div>

          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="在已加载的商品里搜标题"
            aria-label="店内搜索（仅搜索已加载的商品）"
            className={`${styles.field} mt-3 w-full`}
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="按状态筛选"
              className="flex flex-wrap gap-1.5"
            >
              {STATUS_FILTERS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={statusFilter === option.key}
                  onClick={() => setStatusFilter(option.key)}
                  className={`${styles.pill} ${styles.pillCompact} ${statusFilter === option.key ? styles.pillOn : ""}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SellerSort)}
              aria-label="排序"
              className={`${styles.field} ml-auto h-9 min-h-9 text-[13px] font-semibold`}
            >
              {SORTS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                setSelectedIds((current) => {
                  const next = new Set(current);
                  if (allVisibleSelected)
                    visibleItems.forEach((item) => next.delete(item.id));
                  else visibleItems.forEach((item) => next.add(item.id));
                  return next;
                })
              }
              disabled={visibleItems.length === 0}
              className={`${styles.pill} ${styles.pillCompact}`}
            >
              {allVisibleSelected ? "取消全选" : "全选当前"} ({visibleItems.length})
            </button>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className={`${styles.pill} ${styles.pillCompact}`}
              >
                清空 ({selectedIds.size})
              </button>
            )}
          </div>

          {visibleItems.length > 0 ? (
            <ul className={`${styles.grid} mt-3`}>
              {visibleItems.map((item) => (
                <SellerTile
                  key={item.id}
                  item={item}
                  checked={selectedIds.has(item.id)}
                  exchangeRate={exchangeRate}
                  onToggle={toggleSelectItem}
                  onOpen={onOpenItem}
                />
              ))}
            </ul>
          ) : (
            <p className="mt-6 rounded-[20px] bg-paper px-4 py-8 text-center text-sm text-meta">
              {loadedItems.length === 0
                ? "该卖家当前没有在售商品"
                : filtering
                  ? "已加载的商品里没有符合条件的；搜索和筛选只覆盖已加载部分，可以先加载更多。"
                  : "没有可显示的商品"}
            </p>
          )}

          {data.page < data.pageCount && (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className={`${styles.pill} mt-3 w-full`}
            >
              {loadingMore
                ? "正在加载…"
                : `加载更多（${loadedItems.length}/${data.total}）`}
            </button>
          )}
          {moreError && (
            <p role="alert" className="mt-2 text-center text-xs text-rust">
              {moreError}
            </p>
          )}
        </section>

        {seller.sourceData && Object.keys(seller.sourceData).length > 0 && (
          <details className={styles.raw}>
            <summary>平台公开字段</summary>
            <pre className="mb-3 max-h-44 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-4 text-meta">
              {JSON.stringify(seller.sourceData, null, 2)}
            </pre>
          </details>
        )}
      </div>
    );
  }

  return createPortal(
    <div className={styles.backdrop} onMouseDown={onClose}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="seller-profile-title"
        tabIndex={-1}
        className={styles.panel}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.topbar}>
          <h2
            id="seller-profile-title"
            className="font-heading text-base font-bold text-ink"
          >
            {seller ? "卖家主页" : "正在读取商家…"}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid h-11 w-11 place-items-center rounded-full border border-black/10 bg-white text-ink transition active:scale-95"
          >
            <CloseGlyph />
          </button>
        </div>

        <div className={styles.scroll}>
          {loading && (
            <p className="py-16 text-center text-sm font-semibold text-meta">
              正在分析商家商品与描述…
            </p>
          )}
          {error && (
            <LoadError
              message={error}
              onRetry={() => void load()}
              retrying={analyzing}
              retryTestId="retry-seller-profile"
              className="mb-3 flex items-center justify-between gap-3 rounded-[20px] bg-rust p-4 text-sm font-bold text-white"
              actionClassName="shrink-0 rounded-full bg-white/20 px-4 py-2 text-xs font-bold text-white"
            />
          )}
          {body}
        </div>

        {selectedItems.length > 0 ? (
          <div className={styles.bar} aria-label="凑单">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center rounded-full bg-ink px-3 py-1 text-xs font-bold text-white">
                已选 {selectedItems.length} 件同店商品
              </span>
              <strong className="font-mono text-sm font-bold text-ink tabular-nums">
                合计 {fmtYen(selectedTotalYen)}
              </strong>
              <span className="font-mono text-xs text-meta tabular-nums">
                ({fmtCny(selectedTotalYen, exchangeRate)})
              </span>
            </div>
            <div className={`${styles.presets} mt-2 items-center`}>
              <span className="shrink-0 text-xs text-meta">目标总价：</span>
              {bundleTargets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setTargetPrice(String(preset.value))}
                  className={`${styles.pill} ${styles.pillCompact} font-mono tabular-nums ${targetPrice === String(preset.value) ? styles.pillOn : ""}`}
                >
                  {preset.label} {fmtYen(preset.value)}
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
              <button
                type="button"
                onClick={copySelectedBundleScript}
                className={styles.pill}
              >
                {copiedBundleJa ? "✓ 已复制合并日语" : "复制合并日语"}
              </button>
              <button
                type="button"
                onClick={copySelectedBundleShareText}
                className={styles.pill}
              >
                {copiedBundleShare ? "✓ 已复制链接+目标价" : "复制链接+目标价"}
              </button>
              {onSendBundle && (
                <button
                  type="button"
                  onClick={() =>
                    onSendBundle(
                      selectedItems.map(
                        (item) =>
                          ({
                            ...withSource(item),
                            seller: data?.seller,
                          }) as unknown as TItem,
                      ),
                      parsedTargetPriceYen,
                    )
                  }
                  className={`${styles.pill} ${styles.pillSolid} col-span-2`}
                >
                  一键集合发给搭档 ({selectedItems.length} 件) →
                </button>
              )}
            </div>
          </div>
        ) : data ? (
          <p className={styles.barHint}>点商品左上角的圆圈可多选，凑单后一起砍价</p>
        ) : null}
      </section>
    </div>,
    getShellOverlayRoot(),
  );
}
