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
  priceCurrent: number;
  priceTotalEst: number;
  listedAt?: string | null;
  detectedAt: string;
  auctionEndAt?: string | null;
  categoryIp: string;
  categoryToyType: string;
  conditionGrade: string;
  quantityEst?: number | null;
  unitCostEst?: number | null;
  procurementScore: number;
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
  recommendationScore: number;
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
  mandarake: "日本中古店",
  mercari: "日本二手市场",
  yahoo_auctions: "日本拍卖市场",
  firecrawl_market: "自动适配来源",
  apify_ecommerce: "Apify 电商检索",
  playwright_page: "动态商品页",
  public_page: "公开商品页",
};

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

function displayTitle(item: DiscoveryListing, language: "zh" | "original") {
  if (language === "original") return item.titleRaw;
  return (
    item.product?.titleZh ??
    item.product?.canonicalName ??
    translateTitle(item.titleRaw)
  );
}

const fmtYen = (value?: number | null) =>
  value == null ? "未知" : `¥${value.toLocaleString("ja-JP")}`;

function relativeTime(value?: string | null) {
  if (!value) return "平台未提供";
  const difference = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(difference / 60_000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function ArrowIcon({ direction }: { direction: ExitDirection }) {
  const transform =
    direction === "left"
      ? "rotate(180 12 12)"
      : direction === "down"
        ? "rotate(90 12 12)"
        : undefined;
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
      transform={transform}
    >
      <path d="M5 12h14m-5-5 5 5-5 5" />
    </svg>
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

function CardContent({
  item,
  language,
  translatedTitle,
}: {
  item: DiscoveryListing;
  language: "zh" | "original";
  translatedTitle?: string;
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
    : (translatedTitle ?? displayTitle(item, "zh"));
  return (
    <>
      <div className="relative min-h-0 overflow-hidden bg-ink md:h-full">
        <ImageGallery
          images={item.images}
          alt={title}
          className="h-[258px] w-full md:h-full"
          imageClassName="select-none"
        />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-ink/90 via-ink/30 to-transparent p-4 pt-14 text-white">
          <span className="rounded-md bg-white/90 px-2 py-1 text-[10px] font-black text-ink">
            {item.auctionEndAt ? "拍卖" : "直接购买"}
          </span>
          <span className="font-mono text-xs font-black text-amber-300">
            采购分 {item.procurementScore}
          </span>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setShowOriginal((current) => !current);
          }}
          aria-label={showOriginal ? "切换为中文" : "切换为原文"}
          title={showOriginal ? "中文" : "原文"}
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-ink/75 text-white backdrop-blur transition-colors hover:bg-ink"
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
      <div className="flex min-h-0 flex-col p-4 md:p-5">
        <h2 className="line-clamp-3 text-lg font-black leading-6 text-ink md:text-xl md:leading-7">
          {title}
        </h2>
        <div className="mt-3 flex items-end justify-between gap-3 border-b border-ink/10 pb-3">
          <div>
            <span className="block text-[10px] font-bold text-ink/60">
              当前价
            </span>
            <b className="font-mono text-2xl font-black text-rust tabular-nums">
              {fmtYen(item.priceCurrent)}
            </b>
          </div>
          <span className="text-right text-xs font-bold text-moss">
            {sourceLabels[item.source.key] ?? item.source.displayName}
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
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
          <div>
            <dt className="text-ink/60">玩具类型</dt>
            <dd className="mt-0.5 font-bold">
              {toyType ?? labels[item.categoryToyType] ?? "待识别"}
            </dd>
          </div>
          <div>
            <dt className="text-ink/60">品相</dt>
            <dd className="mt-0.5 font-bold">
              {labels[item.conditionGrade] ?? "待识别"}
            </dd>
          </div>
          <div>
            <dt className="text-ink/60">采购价值</dt>
            <dd className="mt-0.5 font-bold">
              评分 {item.procurementScore} · 单件 {fmtYen(item.unitCostEst)}
            </dd>
          </div>
          <div>
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
  index,
}: {
  item: DiscoveryListing;
  language: "zh" | "original";
  translatedTitle?: string;
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
      className="pointer-events-none absolute inset-0 grid overflow-hidden rounded-2xl bg-white shadow-panel md:grid-cols-[1.08fr_.92fr]"
    >
      <CardContent
        item={item}
        language={language}
        translatedTitle={translatedTitle}
      />
    </motion.article>
  );
}

function SwipeCard({
  item,
  language,
  translatedTitle,
  busy,
  exitDirection,
  onConsume,
  onDetail,
  onExitComplete,
}: {
  item: DiscoveryListing;
  language: "zh" | "original";
  translatedTitle?: string;
  busy: boolean;
  exitDirection: ExitDirection | null;
  onConsume: (action: "dislike" | "favorite", direction: ExitDirection) => void;
  onDetail: () => void;
  onExitComplete: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const didDragRef = useRef(false);
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
      aria-label={`商品：${displayTitle(item, language)}。拖动筛选，点击查看详情。`}
      initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
      animate={exitTarget}
      transition={exitDirection ? springs.release : springs.gentle}
      drag={!reducedMotion && !busy}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragElastic={motionTokens.gesture.elastic}
      dragMomentum
      dragTransition={springs.release}
      onPointerDown={() => {
        didDragRef.current = false;
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
      style={{ x, y, rotate, touchAction: "none" }}
      className="absolute inset-0 grid cursor-grab select-none overflow-hidden rounded-2xl bg-white shadow-modal outline-none focus-visible:ring-4 focus-visible:ring-moss/30 active:cursor-grabbing md:grid-cols-[1.08fr_.92fr]"
    >
      <CardContent
        item={item}
        language={language}
        translatedTitle={translatedTitle}
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
    </motion.article>
  );
}

export function DiscoveryWorkspace({
  apiBaseUrl,
  language,
  translations = {},
  onOpenDetail,
  onFavoriteChange,
  interactionDisabled = false,
}: {
  apiBaseUrl: string;
  language: "zh" | "original";
  translations?: Record<string, string>;
  onOpenDetail: (listingId: string) => Promise<boolean>;
  onFavoriteChange: () => void;
  interactionDisabled?: boolean;
}) {
  const [queue, setQueue] = useState<DiscoveryListing[]>([]);
  const [total, setTotal] = useState(0);
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
  const positionRef = useRef(0);
  const refillLengthRef = useRef<number | null>(null);

  const loadFeed = useCallback(
    async (append: boolean) => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${apiBaseUrl}/discovery?limit=12`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`API ${response.status}`);
        const data = (await response.json()) as {
          items: DiscoveryListing[];
          total: number;
        };
        setTotal(data.total);
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
        setError(reason instanceof Error ? reason.message : "发现队列加载失败");
      } finally {
        setLoading(false);
        setLoadedOnce(true);
      }
    },
    [apiBaseUrl],
  );

  useEffect(() => {
    void loadFeed(false);
  }, [loadFeed]);

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
  }, [exitFinished, onFavoriteChange, pendingFeedback, queue]);

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
            recommendationScore: item.procurementScore,
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
          recommendationScore: item.procurementScore,
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
      positionRef.current = Math.max(0, positionRef.current - 1);
      setLastAction(null);
      setStatus("已撤销，上一个商品已回到队首");
      onFavoriteChange();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "撤销失败");
    } finally {
      setBusy(false);
    }
  }, [apiBaseUrl, busy, interactionDisabled, lastAction, onFavoriteChange]);

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
    <section aria-labelledby="discovery-heading" className="js-shell-reveal">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-blue-100 pb-3">
        <div>
          <h2
            id="discovery-heading"
            className="font-heading text-xl font-black"
          >
            发现
          </h2>
          <p className="mt-1 max-w-2xl text-base/6 text-slate-600 sm:text-sm/6">
            快速处理尚未判断的商品。系统会保存每一次选择，用于后续偏好排序。
          </p>
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

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-xl bg-rust px-4 py-3 text-sm font-bold text-white"
        >
          {error}
        </div>
      )}

      <div className="mx-auto max-w-4xl">
        <div className="relative h-[600px] sm:h-[580px] md:h-[520px]">
          {visible.length >= 3 && (
            <BackCard
              item={visible[2]}
              language={language}
              translatedTitle={translations[visible[2].id]}
              index={2}
            />
          )}
          {visible.length >= 2 && (
            <BackCard
              item={visible[1]}
              language={language}
              translatedTitle={translations[visible[1].id]}
              index={1}
            />
          )}
          {visible[0] && (
            <SwipeCard
              key={visible[0].id}
              item={visible[0]}
              language={language}
              translatedTitle={translations[visible[0].id]}
              busy={busy || interactionDisabled}
              exitDirection={exitDirection}
              onConsume={(action, direction) => void consume(action, direction)}
              onDetail={() => void openDetail()}
              onExitComplete={() => setExitFinished(true)}
            />
          )}
          {loading && !visible.length && (
            <div className="absolute inset-0 grid place-items-center rounded-2xl border border-dashed border-blue-200 bg-white text-sm font-bold text-slate-500">
              正在预载商品卡片…
            </div>
          )}
          {!loading && loadedOnce && !visible.length && (
            <div className="absolute inset-0 grid place-items-center rounded-2xl border border-dashed border-blue-200 bg-white px-6 text-center">
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

        <div className="relative z-10 mt-9 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            type="button"
            disabled={!visible[0] || busy || interactionDisabled}
            onClick={() => void consume("dislike", "left")}
            aria-label="不感兴趣"
            title="不感兴趣"
            className="grid min-h-11 place-items-center rounded-lg border border-rust/25 bg-white text-rust transition-colors hover:bg-rust/5 disabled:opacity-40"
          >
            <ArrowIcon direction="left" />
          </button>
          <button
            type="button"
            disabled={!visible[0] || busy || interactionDisabled}
            onClick={() => void openDetail()}
            aria-label="查看详情"
            title="查看详情"
            className="grid min-h-11 place-items-center rounded-lg border border-ink/15 bg-white text-ink transition-colors hover:bg-blue-50 disabled:opacity-40"
          >
            <ArrowIcon direction="down" />
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <p aria-live="polite">{status}</p>
          <p className="hidden font-mono sm:block" aria-hidden="true">
            ← · → · ↓ · Backspace
          </p>
        </div>
      </div>
    </section>
  );
}
