"use client";

import {
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type PanInfo,
} from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ImageGallery } from "./image-gallery";
import { motionTokens, springs } from "../lib/motion-tokens";

type DiscoveryAction = "dislike" | "favorite" | "detail_view";
type ExitDirection = "left" | "right" | "down";

type DiscoveryListing = {
  id: string;
  productId?: string | null;
  sourceUrl: string;
  titleRaw: string;
  titleZh?: string | null;
  priceCurrent: number;
  shippingFee?: number | null;
  priceTotalEst: number;
  listedAt?: string | null;
  detectedAt: string;
  auctionEndAt?: string | null;
  listingType: "auction" | "direct";
  categoryIp: string;
  categoryToyType: string;
  conditionGrade: string;
  quantityEst?: number | null;
  unitCostEst?: number | null;
  note?: string | null;
  source: { key: string; displayName: string };
  images: { url: string; position: number }[];
  product?: {
    canonicalName: string;
    titleZh?: string | null;
    series?: { nameZh: string; nameJa: string } | null;
    toyTypeEntity?: { nameZh: string; nameJa: string } | null;
  } | null;
};

function HeartIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z" />
    </svg>
  );
}

type FeedbackRecord = {
  id: string;
  listingId: string;
  productId?: string | null;
  action: DiscoveryAction | "undo";
  timestamp: string;
  position: number;
};

type LastAction = {
  feedback: FeedbackRecord;
  item: DiscoveryListing;
};

const labels: Record<string, string> = {
  kamen_rider: "假面骑士",
  ultraman: "奥特曼",
  other: "其他",
  unknown: "待识别",
  gashapon: "扭蛋",
  shokugan: "食玩",
  figure: "手办",
  sofubi: "软胶",
  finger_puppet: "指人形",
  dx_belt: "DX 腰带",
  henshin_item: "变身道具",
  medal: "徽章 / Medal",
  model: "模型",
  set: "套装",
  new_sealed: "全新未开封",
  like_new: "近新",
  used: "普通二手",
  stained_or_damaged: "污损或瑕疵",
  junk: "故障品",
};

const sourceLabels: Record<string, string> = {
  mandarake: "Mandarake",
  mercari: "Mercari",
  yahoo_auctions: "Yahoo!オークション",
  yahoo_fleamarket: "Yahoo!フリマ",
  yahoo_shopping: "Yahoo!ショッピング",
  rakuma: "ラクマ",
  surugaya: "駿河屋",
  firecrawl_market: "Firecrawl",
  apify_ecommerce: "Apify",
  playwright_page: "Playwright",
  public_page: "网页来源",
};

function sourceLabel(item: DiscoveryListing) {
  return sourceLabels[item.source.key] ?? item.source.displayName;
}

const simpleTranslations: [RegExp, string][] = [
  [/仮面ライダー/gi, "假面骑士"],
  [/ウルトラマン/gi, "奥特曼"],
  [/まとめ売り/gi, "批量出售"],
  [/大量/gi, "大量"],
  [/セット/gi, "套装"],
  [/未開封/gi, "未开封"],
  [/中古/gi, "二手"],
  [/美品/gi, "品相好"],
  [/フィギュア/gi, "手办"],
  [/ソフビ/gi, "软胶"],
  [/変身ベルト/gi, "变身腰带"],
  [/ドライバー/gi, "驱动器"],
];

function translateTitle(value: string) {
  return simpleTranslations.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  );
}

function displayTitle(
  item: DiscoveryListing,
  language: "zh" | "original",
  translatedTitle?: string,
) {
  if (language === "original") return item.titleRaw;
  return (
    translatedTitle ??
    item.titleZh ??
    item.product?.titleZh ??
    translateTitle(item.titleRaw) ??
    item.titleRaw
  );
}

const fmtYen = (value?: number | null) =>
  value == null ? "未知" : `¥${value.toLocaleString("ja-JP")}`;

const fmtCny = (value?: number | null, exchangeRate?: number) =>
  value == null || !exchangeRate
    ? ""
    : `约 ¥${(value * exchangeRate).toFixed(2)}`;

function relativeTime(value?: string | null) {
  if (!value) return "平台未提供";
  const difference = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(difference / 60_000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function AuctionCountdown({ item }: { item: DiscoveryListing }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (item.listingType !== "auction" || !item.auctionEndAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [item.auctionEndAt, item.listingType]);
  if (item.listingType !== "auction" || !item.auctionEndAt) return null;
  const end = new Date(item.auctionEndAt).getTime();
  const listed = item.listedAt ? new Date(item.listedAt).getTime() : Number.NaN;
  const detected = new Date(item.detectedAt).getTime();
  const start = Number.isFinite(listed) && listed < end ? listed : detected;
  const remainingSeconds = Math.max(0, Math.floor((end - now) / 1_000));
  const days = Math.floor(remainingSeconds / 86_400);
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  const label =
    remainingSeconds <= 0
      ? "已结束"
      : days > 0
        ? `${days}天 ${hours}时 ${minutes}分`
        : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  const progress = Math.max(
    0,
    Math.min(1, (now - start) / Math.max(60_000, end - start)),
  );
  const urgent = end - now < 60 * 60_000;
  return (
    <div className="w-32 rounded-lg bg-black/65 px-2 py-1.5 text-right backdrop-blur-sm sm:w-36">
      <span
        className={`block font-mono text-[11px] font-bold tabular-nums ${urgent ? "text-[#ff9f0a]" : "text-white"}`}
      >
        {label}
      </span>
      <span
        role="progressbar"
        aria-label={`拍卖剩余时间 ${label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        className="mt-1 block h-1 overflow-hidden rounded-full bg-white/25"
      >
        <span
          className={`block h-full origin-left rounded-full transition-transform duration-1000 ease-linear motion-reduce:transition-none ${urgent ? "bg-[#ff9f0a]" : "bg-[#64d2ff]"}`}
          style={{ transform: `scaleX(${progress})` }}
        />
      </span>
    </div>
  );
}

function UndoIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 7 4 12l5 5" />
      <path d="M20 17a7 7 0 0 0-7-7H4" />
    </svg>
  );
}

function DislikeIcon() {
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
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}

function DetailIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 5h14v11H9l-4 3V5Z" />
    </svg>
  );
}

function DiscoveryNote({
  note,
  onSave,
}: {
  note?: string | null;
  onSave?: (note: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  useEffect(() => setDraft(note ?? ""), [note]);

  if (!onSave) {
    if (!note) return null;
    return (
      <div
        className="discovery-note mt-2 flex min-h-9 items-center gap-2 rounded-xl bg-ink/[0.035] px-3 text-xs text-ink/65"
        title={note}
      >
        <CommentIcon />
        <span className="truncate">{note}</span>
      </div>
    );
  }
  const saveNote = onSave;

  async function save() {
    const next = draft.trim().slice(0, 25);
    if (next === (note ?? "")) {
      setOpen(false);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await saveNote(next || null);
      setOpen(false);
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "备注保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="discovery-note mt-2 min-h-11"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {open ? (
        <div className="flex min-h-11 items-center gap-2 rounded-xl border border-ink/10 bg-ink/[0.025] px-3">
          <CommentIcon />
          <input
            autoFocus
            value={draft}
            maxLength={25}
            disabled={saving}
            onChange={(event) => setDraft(event.target.value.slice(0, 25))}
            onBlur={() => void save()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setDraft(note ?? "");
                setOpen(false);
              }
            }}
            aria-label="采购备注"
            placeholder="采购备注，最多 25 字"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-ink/35"
          />
          <span className="font-mono text-[9px] text-ink/35">
            {draft.length}/25
          </span>
          {saveError && (
            <span className="sr-only" role="alert">
              {saveError}
            </span>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={note ? `编辑采购备注：${note}` : "添加采购备注"}
          title={note ?? "添加采购备注"}
          className={`flex min-h-11 max-w-full items-center gap-2 rounded-full border border-ink/10 bg-white text-xs text-ink/60 transition-[width,background-color] hover:bg-ink/[0.035] ${note ? "w-fit px-3" : "w-11 justify-center"}`}
        >
          <CommentIcon />
          {note && <span className="max-w-48 truncate">{note}</span>}
        </button>
      )}
    </div>
  );
}

function CardContent({
  item,
  language,
  translatedTitle,
  exchangeRate,
  onSaveNote,
}: {
  item: DiscoveryListing;
  language: "zh" | "original";
  translatedTitle?: string;
  exchangeRate?: number;
  onSaveNote?: (note: string | null) => Promise<void>;
}) {
  const [showOriginal, setShowOriginal] = useState(language === "original");
  useEffect(() => setShowOriginal(language === "original"), [language]);
  const series = showOriginal
    ? item.product?.series?.nameJa
    : language === "zh"
      ? item.product?.series?.nameZh
      : item.product?.series?.nameJa;
  const toyType = showOriginal
    ? item.product?.toyTypeEntity?.nameJa
    : language === "zh"
      ? item.product?.toyTypeEntity?.nameZh
      : item.product?.toyTypeEntity?.nameJa;
  const title = showOriginal
    ? item.titleRaw
    : displayTitle(item, "zh", translatedTitle);
  return (
    <>
      <div className="discovery-card-media relative min-h-0 overflow-hidden bg-ink md:h-full">
        <ImageGallery
          images={item.images}
          alt={title}
          className="h-[218px] w-full sm:h-[258px] md:h-full"
          imageClassName="select-none"
        />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-ink/90 via-ink/30 to-transparent p-4 pt-14 text-white">
          <div>
            <span className="rounded-md bg-white/90 px-2 py-1 text-[10px] font-black text-ink">
              {item.listingType === "auction" ? "拍卖" : "直接购买"}
            </span>
            <span className="mt-1.5 block max-w-36 truncate text-[10px] font-semibold text-white/90">
              {sourceLabel(item)}
            </span>
          </div>
          <AuctionCountdown item={item} />
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setShowOriginal((current) => !current);
          }}
          aria-label={showOriginal ? "切换为中文" : "切换为原文"}
          title={showOriginal ? "中文" : "原文"}
          className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full bg-ink/75 text-white backdrop-blur transition-colors hover:bg-ink"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 5h8M8 3v2c0 4-2 7-5 9M5 10c1.2 1.3 2.7 2.4 4.5 3.2M13 21l4.5-11L22 21M14.5 18h6" />
          </svg>
        </button>
      </div>
      <div className="discovery-card-content flex min-h-0 flex-col p-4 md:p-5">
        <h2 className="discovery-card-title line-clamp-2 text-base font-bold leading-5 text-ink sm:text-lg sm:leading-6 md:line-clamp-3 md:text-xl md:leading-7">
          {title}
        </h2>
        <div className="discovery-price-row mt-3 flex items-end justify-between gap-3 border-b border-ink/10 pb-3">
          <div>
            <span className="block text-[10px] font-bold text-ink/60">
              当前价
            </span>
            <b className="font-mono text-2xl font-black text-rust tabular-nums">
              {fmtYen(item.priceCurrent)}
            </b>
            <span className="block font-mono text-[10px] font-semibold text-ink/45">
              {fmtCny(item.priceCurrent, exchangeRate)}
            </span>
            <span className="mt-0.5 block text-[10px] text-ink/45">
              邮费 {item.shippingFee === 0 ? "包邮" : fmtYen(item.shippingFee)}
              {item.shippingFee != null && item.shippingFee > 0 && (
                <span className="ml-1 font-mono text-[9px]">
                  {fmtCny(item.shippingFee, exchangeRate)}
                </span>
              )}
            </span>
          </div>
          <span className="max-w-32 truncate text-right text-xs font-semibold text-moss">
            {sourceLabel(item)}
          </span>
        </div>
        <DiscoveryNote note={item.note} onSave={onSaveNote} />
        <dl className="discovery-priority-grid mt-3 grid grid-cols-3 gap-x-2 gap-y-2 text-[11px] sm:text-xs md:grid-cols-2 md:gap-x-4">
          <div>
            <dt className="text-ink/60">数量</dt>
            <dd className="mt-0.5 font-bold">
              {item.quantityEst ?? "待识别"} 件
            </dd>
          </div>
          <div>
            <dt className="text-ink/60">系列</dt>
            <dd className="mt-0.5 truncate font-bold">
              {series ?? labels[item.categoryIp] ?? "待识别"}
            </dd>
          </div>
          <div className="hidden md:block">
            <dt className="text-ink/60">玩具类型</dt>
            <dd className="mt-0.5 font-bold">
              {toyType ?? labels[item.categoryToyType] ?? "待识别"}
            </dd>
          </div>
          <div className="hidden md:block">
            <dt className="text-ink/60">品相</dt>
            <dd className="mt-0.5 font-bold">
              {labels[item.conditionGrade] ?? "待识别"}
            </dd>
          </div>
          <div>
            <dt className="text-ink/60">采购价值</dt>
            <dd className="mt-0.5 font-bold">
              单件 {fmtYen(item.unitCostEst)}
            </dd>
            {item.unitCostEst != null && (
              <span className="block font-mono text-[9px] font-semibold text-ink/45">
                {fmtCny(item.unitCostEst, exchangeRate)}
              </span>
            )}
          </div>
          <div className="hidden md:block">
            <dt className="text-ink/60">上架时间</dt>
            <dd className="mt-0.5 font-bold">
              {relativeTime(item.listedAt ?? item.detectedAt)}
            </dd>
          </div>
        </dl>
      </div>
    </>
  );
}

function BackCard({
  item,
  language,
  translatedTitle,
  exchangeRate,
  index,
}: {
  item: DiscoveryListing;
  language: "zh" | "original";
  translatedTitle?: string;
  exchangeRate?: number;
  index: 1 | 2;
}) {
  const second = index === 1;
  return (
    <motion.article
      aria-hidden="true"
      initial={{
        opacity: second
          ? motionTokens.stack.secondOpacity
          : motionTokens.stack.thirdOpacity,
        scale: second
          ? motionTokens.stack.secondScale
          : motionTokens.stack.thirdScale,
        y: second ? motionTokens.stack.secondY : motionTokens.stack.thirdY,
      }}
      animate={{
        opacity: second
          ? motionTokens.stack.secondOpacity
          : motionTokens.stack.thirdOpacity,
        scale: second
          ? motionTokens.stack.secondScale
          : motionTokens.stack.thirdScale,
        y: second ? motionTokens.stack.secondY : motionTokens.stack.thirdY,
      }}
      transition={springs.release}
      className="discovery-swipe-card discovery-stack-card pointer-events-none absolute inset-0 grid overflow-hidden rounded-2xl bg-white shadow-panel md:grid-cols-[1.08fr_.92fr]"
    >
      <CardContent
        item={item}
        language={language}
        translatedTitle={translatedTitle}
        exchangeRate={exchangeRate}
      />
    </motion.article>
  );
}

function SwipeCard({
  item,
  language,
  translatedTitle,
  exchangeRate,
  busy,
  exitDirection,
  onConsume,
  onDetail,
  onExitComplete,
  onSaveNote,
}: {
  item: DiscoveryListing;
  language: "zh" | "original";
  translatedTitle?: string;
  exchangeRate?: number;
  busy: boolean;
  exitDirection: ExitDirection | null;
  onConsume: (action: "dislike" | "favorite", direction: ExitDirection) => void;
  onDetail: () => void;
  onExitComplete: () => void;
  onSaveNote: (note: string | null) => Promise<void>;
}) {
  const reducedMotion = useReducedMotion();
  const [coarsePointer, setCoarsePointer] = useState(false);
  const [touchDetailProgress, setTouchDetailProgress] = useState(0);
  const didDragRef = useRef(false);
  const pointerStartRef = useRef<{
    x: number;
    y: number;
    pointerType: string;
  } | null>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(
    x,
    [-motionTokens.gesture.exitDistance, 0, motionTokens.gesture.exitDistance],
    [-4, 0, 4],
  );
  const favoriteOpacity = useTransform(
    x,
    [0, motionTokens.gesture.feedbackDistance],
    [0, 1],
  );
  const dislikeOpacity = useTransform(
    x,
    [-motionTokens.gesture.feedbackDistance, 0],
    [1, 0],
  );
  const detailOpacity = useTransform(
    y,
    [0, motionTokens.gesture.feedbackDistance],
    [0, 1],
  );

  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarsePointer(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  function handleDragEnd(
    _: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) {
    if (busy) return;
    const horizontal =
      Math.abs(info.offset.x) >
      Math.abs(info.offset.y) * motionTokens.gesture.axisDominance;
    const verticalDown =
      info.offset.y > 0 &&
      Math.abs(info.offset.y) >
        Math.abs(info.offset.x) * motionTokens.gesture.axisDominance;
    const horizontalIntent =
      Math.abs(info.offset.x) >= motionTokens.gesture.actionDistance ||
      (Math.abs(info.velocity.x) >= motionTokens.gesture.velocity &&
        Math.abs(info.offset.x) >= motionTokens.gesture.flickDistance);
    const detailIntent =
      info.offset.y >= motionTokens.gesture.detailDistance ||
      (info.velocity.y >= motionTokens.gesture.velocity &&
        info.offset.y >= motionTokens.gesture.flickDistance);

    if (horizontal && horizontalIntent) {
      if (info.offset.x > 0) onConsume("favorite", "right");
      else onConsume("dislike", "left");
      return;
    }
    if (verticalDown && detailIntent) onDetail();
  }

  const exitTarget = reducedMotion
    ? { opacity: 0 }
    : exitDirection === "left"
      ? { x: -motionTokens.gesture.exitDistance, opacity: 0 }
      : exitDirection === "right"
        ? { x: motionTokens.gesture.exitDistance, opacity: 0 }
        : exitDirection === "down"
          ? { y: motionTokens.gesture.exitDistance, opacity: 0 }
          : { x: 0, y: 0, opacity: 1 };

  return (
    <motion.article
      role="button"
      tabIndex={0}
      aria-label={`商品：${displayTitle(item, language, translatedTitle)}。拖动筛选，点击查看详情。`}
      initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
      animate={exitTarget}
      transition={exitDirection ? springs.release : springs.gentle}
      drag={!reducedMotion && !busy ? (coarsePointer ? "x" : true) : false}
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragElastic={motionTokens.gesture.elastic}
      dragMomentum
      dragTransition={springs.release}
      onPointerDown={(event) => {
        didDragRef.current = false;
        pointerStartRef.current = {
          x: event.clientX,
          y: event.clientY,
          pointerType: event.pointerType,
        };
      }}
      onPointerMove={(event) => {
        const start = pointerStartRef.current;
        if (!start || start.pointerType !== "touch" || busy) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.2) {
          if (dy > 8) didDragRef.current = true;
          setTouchDetailProgress(Math.min(1, dy / 96));
        } else if (touchDetailProgress) {
          setTouchDetailProgress(0);
        }
      }}
      onPointerUp={() => {
        const shouldOpen = touchDetailProgress >= 1;
        pointerStartRef.current = null;
        setTouchDetailProgress(0);
        if (shouldOpen && !busy) onDetail();
      }}
      onPointerCancel={() => {
        pointerStartRef.current = null;
        setTouchDetailProgress(0);
      }}
      onDragStart={() => {
        didDragRef.current = true;
      }}
      onDragEnd={handleDragEnd}
      onTap={() => {
        if (!didDragRef.current && !busy && !exitDirection) onDetail();
        didDragRef.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onDetail();
        }
      }}
      onAnimationComplete={() => {
        if (exitDirection) onExitComplete();
      }}
      style={{
        x,
        y,
        rotate,
        touchAction: coarsePointer ? "pan-y" : "none",
      }}
      className="discovery-swipe-card discovery-active-card absolute inset-0 grid cursor-grab select-none overflow-hidden rounded-2xl bg-white shadow-modal outline-none focus-visible:ring-4 focus-visible:ring-moss/30 active:cursor-grabbing md:grid-cols-[1.08fr_.92fr]"
    >
      <CardContent
        item={item}
        language={language}
        translatedTitle={translatedTitle}
        exchangeRate={exchangeRate}
        onSaveNote={onSaveNote}
      />
      <motion.div
        aria-hidden="true"
        style={{ opacity: favoriteOpacity }}
        className="pointer-events-none absolute right-4 top-4 rounded-lg bg-moss px-4 py-2 text-sm font-black text-white shadow-panel"
      >
        收藏
      </motion.div>
      <motion.div
        aria-hidden="true"
        style={{ opacity: dislikeOpacity }}
        className="pointer-events-none absolute left-4 top-4 rounded-lg bg-rust px-4 py-2 text-sm font-black text-white shadow-panel"
      >
        不感兴趣
      </motion.div>
      <motion.div
        aria-hidden="true"
        style={{ opacity: detailOpacity }}
        className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-ink px-4 py-2 text-sm font-black text-amber-300 shadow-panel"
      >
        查看详情
      </motion.div>
      <motion.div
        aria-hidden="true"
        animate={{ opacity: touchDetailProgress }}
        transition={{ duration: 0.08 }}
        className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-ink px-4 py-2 text-sm font-black text-amber-300 shadow-panel md:hidden"
      >
        查看详情
      </motion.div>
    </motion.article>
  );
}

export function DiscoveryWorkspace({
  apiBaseUrl,
  language,
  translations = {},
  onOpenDetail,
  onFavoriteChange,
  onNoteChange,
  exchangeRate,
  interactionDisabled = false,
}: {
  apiBaseUrl: string;
  language: "zh" | "original";
  translations?: Record<string, string>;
  onOpenDetail: (listingId: string) => Promise<boolean>;
  onFavoriteChange: () => void;
  onNoteChange?: (listingId: string, note: string | null) => Promise<void>;
  exchangeRate?: number;
  interactionDisabled?: boolean;
}) {
  const [queue, setQueue] = useState<DiscoveryListing[]>([]);
  const [total, setTotal] = useState(0);
  const [listingType, setListingType] = useState<"direct" | "auction">(
    "direct",
  );
  const [modeTotals, setModeTotals] = useState<
    Partial<Record<"direct" | "auction", number>>
  >({});
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("正在准备发现队列…");
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [exitDirection, setExitDirection] = useState<ExitDirection | null>(
    null,
  );
  const [exitFinished, setExitFinished] = useState(false);
  const [pendingFeedback, setPendingFeedback] = useState<FeedbackRecord | null>(
    null,
  );
  const [aiTranslations, setAiTranslations] = useState<Record<string, string>>(
    {},
  );
  const translationRequestedRef = useRef(new Set<string>());
  const positionRef = useRef(0);
  const refillLengthRef = useRef<number | null>(null);
  const feedRequestRef = useRef(0);

  const loadFeed = useCallback(
    async (append: boolean) => {
      const requestId = ++feedRequestRef.current;
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ limit: "12", listingType });
        const response = await fetch(`${apiBaseUrl}/discovery?${params}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`API ${response.status}`);
        const data = (await response.json()) as {
          items: DiscoveryListing[];
          total: number;
        };
        if (requestId !== feedRequestRef.current) return;
        setTotal(data.total);
        setModeTotals((current) => ({
          ...current,
          [listingType]: data.total,
        }));
        setQueue((current) => {
          if (!append) return data.items;
          const known = new Set(current.map((item) => item.id));
          return [
            ...current,
            ...data.items.filter((item) => !known.has(item.id)),
          ];
        });
        if (!append) {
          setStatus(
            data.items.length > 0
              ? `发现队列已就绪，已预载 ${data.items.length} 张商品卡片`
              : "当前没有待判断商品",
          );
        }
      } catch (reason) {
        if (requestId !== feedRequestRef.current) return;
        setError(reason instanceof Error ? reason.message : "发现队列加载失败");
      } finally {
        if (requestId === feedRequestRef.current) {
          setLoading(false);
          setLoadedOnce(true);
        }
      }
    },
    [apiBaseUrl, listingType],
  );

  useEffect(() => {
    setQueue([]);
    setTotal(modeTotals[listingType] ?? 0);
    setLoadedOnce(false);
    setLastAction(null);
    setPendingFeedback(null);
    setExitDirection(null);
    setExitFinished(false);
    refillLengthRef.current = null;
    void loadFeed(false);
  }, [listingType, loadFeed]);

  useEffect(() => {
    const candidates = queue
      .filter(
        (item) =>
          !translations[item.id] &&
          !aiTranslations[item.id] &&
          !item.titleZh &&
          !translationRequestedRef.current.has(item.id),
      )
      .slice(0, 12);
    if (!candidates.length) return;
    candidates.forEach((item) => translationRequestedRef.current.add(item.id));
    void (async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/analysis/translate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            texts: candidates.map((item) => item.titleRaw),
            itemIds: candidates.map((item) => item.id),
          }),
        });
        if (!response.ok) throw new Error(`API ${response.status}`);
        const data = (await response.json()) as { translations?: string[] };
        setAiTranslations((current) => {
          const next = { ...current };
          candidates.forEach((item, index) => {
            const value = data.translations?.[index]?.trim();
            if (value) next[item.id] = value;
          });
          return next;
        });
      } catch {
        candidates.forEach((item) =>
          translationRequestedRef.current.delete(item.id),
        );
      }
    })();
  }, [aiTranslations, apiBaseUrl, queue, translations]);

  useEffect(() => {
    if (!loadedOnce || loading || queue.length >= 6) {
      if (queue.length >= 6) refillLengthRef.current = null;
      return;
    }
    if (refillLengthRef.current === queue.length) return;
    refillLengthRef.current = queue.length;
    void loadFeed(true);
  }, [loadedOnce, loadFeed, loading, queue.length]);

  const finalizeConsume = useCallback(() => {
    if (!pendingFeedback || !exitFinished) return;
    const current = queue[0];
    if (current) setLastAction({ feedback: pendingFeedback, item: current });
    setQueue((items) => items.slice(1));
    setTotal((currentTotal) => Math.max(0, currentTotal - 1));
    setModeTotals((currentTotals) => ({
      ...currentTotals,
      [listingType]: Math.max(0, (currentTotals[listingType] ?? total) - 1),
    }));
    positionRef.current += 1;
    setStatus(
      pendingFeedback.action === "favorite"
        ? "已收藏，可撤销上一次操作"
        : "已标记为不感兴趣，可撤销上一次操作",
    );
    if (pendingFeedback.action === "favorite") onFavoriteChange();
    setPendingFeedback(null);
    setExitFinished(false);
    setExitDirection(null);
    setBusy(false);
  }, [
    exitFinished,
    listingType,
    onFavoriteChange,
    pendingFeedback,
    queue,
    total,
  ]);

  useEffect(() => {
    finalizeConsume();
  }, [finalizeConsume]);

  const consume = useCallback(
    async (action: "dislike" | "favorite", direction: ExitDirection) => {
      const item = queue[0];
      if (!item || busy || interactionDisabled) return;
      setBusy(true);
      setError("");
      setExitFinished(false);
      setExitDirection(direction);
      try {
        const response = await fetch(`${apiBaseUrl}/discovery/feedback`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listingId: item.id,
            action,
            position: positionRef.current,
          }),
        });
        if (!response.ok) throw new Error(`保存失败（API ${response.status}）`);
        const data = (await response.json()) as { feedback: FeedbackRecord };
        setPendingFeedback(data.feedback);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "操作保存失败");
        setStatus("操作未保存，卡片已返回队列");
        setExitDirection(null);
        setExitFinished(false);
        setBusy(false);
      }
    },
    [apiBaseUrl, busy, interactionDisabled, queue],
  );

  const openDetail = useCallback(async () => {
    const item = queue[0];
    if (!item || busy || interactionDisabled) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/discovery/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listingId: item.id,
          action: "detail_view",
          position: positionRef.current,
        }),
      });
      if (!response.ok)
        throw new Error(`详情浏览记录失败（API ${response.status}）`);
      const opened = await onOpenDetail(item.id);
      setStatus(
        opened ? "已记录详情浏览" : "已记录详情浏览，但详情加载失败，请重试",
      );
      if (!opened) setError("详情加载失败，请重新点击查看详情");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "详情操作保存失败");
    } finally {
      setBusy(false);
    }
  }, [apiBaseUrl, busy, interactionDisabled, onOpenDetail, queue]);

  const undo = useCallback(async () => {
    if (!lastAction || busy || interactionDisabled) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/discovery/undo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ feedbackId: lastAction.feedback.id }),
      });
      if (!response.ok) throw new Error(`撤销失败（API ${response.status}）`);
      const data = (await response.json()) as {
        item: DiscoveryListing | null;
      };
      const restored = data.item ?? lastAction.item;
      setQueue((current) => [
        restored,
        ...current.filter((item) => item.id !== restored.id),
      ]);
      setTotal((currentTotal) => currentTotal + 1);
      setModeTotals((currentTotals) => ({
        ...currentTotals,
        [listingType]: (currentTotals[listingType] ?? total) + 1,
      }));
      positionRef.current = Math.max(0, positionRef.current - 1);
      setLastAction(null);
      setStatus("已撤销，上一个商品已回到队首");
      onFavoriteChange();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "撤销失败");
    } finally {
      setBusy(false);
    }
  }, [
    apiBaseUrl,
    busy,
    interactionDisabled,
    lastAction,
    listingType,
    onFavoriteChange,
    total,
  ]);

  const saveNote = useCallback(
    async (listingId: string, note: string | null) => {
      if (interactionDisabled) return;
      if (onNoteChange) {
        await onNoteChange(listingId, note);
      } else {
        const response = await fetch(`${apiBaseUrl}/items/${listingId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ note }),
        });
        if (!response.ok)
          throw new Error(`备注保存失败（API ${response.status}）`);
      }
      setQueue((current) =>
        current.map((item) =>
          item.id === listingId ? { ...item, note } : item,
        ),
      );
      setStatus(note ? "采购备注已保存" : "采购备注已清除");
    },
    [apiBaseUrl, interactionDisabled, onNoteChange],
  );

  useEffect(() => {
    if (interactionDisabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, textarea, [contenteditable='true']"))
        return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        void consume("dislike", "left");
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        void consume("favorite", "right");
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        void openDetail();
      } else if (event.key === "Backspace") {
        event.preventDefault();
        void undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [consume, interactionDisabled, openDetail, undo]);

  const visible = queue.slice(0, 3);
  return (
    <section
      aria-labelledby="discovery-heading"
      className="discovery-workspace js-shell-reveal"
    >
      <div className="discovery-toolbar mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2
            id="discovery-heading"
            className="font-heading text-xl font-black"
          >
            发现
          </h2>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>
            待判断 <b className="font-mono text-ink">{total}</b>
          </span>
          <span>
            已预载 <b className="font-mono text-ink">{queue.length}</b>
          </span>
        </div>
      </div>

      <div
        className="ios-segment discovery-mode-switch mb-3 grid grid-cols-2 rounded-2xl p-1"
        aria-label="发现商品交易方式"
      >
        {(["direct", "auction"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={listingType === mode}
            disabled={busy || interactionDisabled}
            onClick={() => setListingType(mode)}
            className="min-h-11 rounded-xl px-3 text-sm font-bold transition-colors disabled:opacity-50"
          >
            {mode === "direct" ? "直购" : "拍卖"}
            {modeTotals[mode] != null && (
              <span className="ml-1 font-mono text-[10px] opacity-70">
                {modeTotals[mode]}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-xl bg-rust px-4 py-3 text-sm font-bold text-white"
        >
          {error}
        </div>
      )}

      <div className="mx-auto max-w-4xl">
        <div className="discovery-card-shell relative overflow-visible overscroll-contain">
          {visible.length >= 3 && (
            <BackCard
              item={visible[2]}
              language={language}
              translatedTitle={
                translations[visible[2].id] ?? aiTranslations[visible[2].id]
              }
              exchangeRate={exchangeRate}
              index={2}
            />
          )}
          {visible.length >= 2 && (
            <BackCard
              item={visible[1]}
              language={language}
              translatedTitle={
                translations[visible[1].id] ?? aiTranslations[visible[1].id]
              }
              exchangeRate={exchangeRate}
              index={1}
            />
          )}
          {visible[0] && (
            <SwipeCard
              key={visible[0].id}
              item={visible[0]}
              language={language}
              translatedTitle={
                translations[visible[0].id] ?? aiTranslations[visible[0].id]
              }
              exchangeRate={exchangeRate}
              busy={busy || interactionDisabled}
              exitDirection={exitDirection}
              onConsume={(action, direction) => void consume(action, direction)}
              onDetail={() => void openDetail()}
              onExitComplete={() => setExitFinished(true)}
              onSaveNote={(note) => saveNote(visible[0].id, note)}
            />
          )}
          {loading && !visible.length && (
            <div className="discovery-empty absolute inset-0 grid place-items-center rounded-2xl border border-dashed border-blue-200 bg-white text-sm font-bold text-slate-500">
              正在预载商品卡片…
            </div>
          )}
          {!loading && loadedOnce && !visible.length && (
            <div className="discovery-empty absolute inset-0 grid place-items-center rounded-2xl border border-dashed border-blue-200 bg-white px-6 text-center">
              <div>
                <b className="font-heading text-lg">当前队列已处理完</b>
                <p className="mt-2 text-sm text-slate-500">
                  新商品进入监控库后会自动出现在这里。
                </p>
                <button
                  type="button"
                  onClick={() => void loadFeed(false)}
                  className="mt-4 min-h-11 rounded-lg bg-moss px-4 text-sm font-black text-white hover:bg-blue-800"
                >
                  重新检查
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="discovery-actions relative z-10 mt-4 grid grid-cols-4 gap-2 sm:mt-9">
          <button
            type="button"
            disabled={!visible[0] || busy || interactionDisabled}
            onClick={() => void consume("dislike", "left")}
            aria-label="不感兴趣"
            title="不感兴趣"
            className="grid min-h-11 place-items-center rounded-lg border border-rust/25 bg-white text-rust transition-colors hover:bg-rust/5 disabled:opacity-40"
          >
            <DislikeIcon />
          </button>
          <button
            type="button"
            disabled={!visible[0] || busy || interactionDisabled}
            onClick={() => void openDetail()}
            aria-label="查看详情"
            title="查看详情"
            className="grid min-h-11 place-items-center rounded-lg border border-ink/15 bg-white text-ink transition-colors hover:bg-blue-50 disabled:opacity-40"
          >
            <DetailIcon />
          </button>
          <button
            type="button"
            disabled={!visible[0] || busy || interactionDisabled}
            onClick={() => void consume("favorite", "right")}
            aria-label="收藏"
            title="收藏"
            className="grid min-h-11 place-items-center rounded-lg bg-moss text-white transition-colors hover:bg-blue-800 disabled:opacity-40"
          >
            <HeartIcon />
          </button>
          <button
            type="button"
            disabled={!lastAction || busy || interactionDisabled}
            onClick={() => void undo()}
            aria-label="撤销"
            title="撤销"
            className="grid min-h-11 place-items-center rounded-lg border border-amber-300 bg-amber-50 text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-40"
          >
            <UndoIcon />
          </button>
        </div>
        <p className="sr-only" aria-live="polite">
          {status}
        </p>
      </div>
    </section>
  );
}
