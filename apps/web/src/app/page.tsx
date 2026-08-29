"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

gsap.registerPlugin(useGSAP);

type Item = {
  id: string;
  sourceUrl: string;
  titleRaw: string;
  descriptionRaw?: string | null;
  locationText?: string | null;
  priceCurrent: number;
  shippingFee?: number | null;
  priceTotalEst: number;
  listedAt?: string | null;
  detectedAt: string;
  lastSeenAt: string;
  auctionEndAt?: string | null;
  bidCount?: number | null;
  categoryIp: string;
  categoryToyType: string;
  manufacturer: string;
  conditionGrade: string;
  channel: string;
  quantityEst?: number | null;
  unitCostEst?: number | null;
  confidence: number;
  needsReview: boolean;
  procurementScore: number;
  status: string;
  favorite: boolean;
  ignored: boolean;
  importOrigin?: "search" | "url";
  archivedAt?: string | null;
  normalizedTitle?: string | null;
  fieldConfidences?: Record<string, unknown> | null;
  extractionEvidence?: Record<string, unknown> | null;
  matchConfidence?: number | null;
  matchDecision?: string | null;
  purchaseRecord?: PurchaseRecord | null;
  note?: string | null;
  source: { key: string; displayName: string };
  seller?: {
    name: string;
    sellerType: string;
    locationText?: string | null;
  } | null;
  images: { url: string; position: number }[];
  product?: Product | null;
};

type CatalogEntity = {
  key: string;
  nameJa: string;
  nameZh: string;
  nameEn?: string | null;
};

type Product = {
  id: string;
  canonicalName: string;
  titleZh?: string | null;
  productLine?: string | null;
  modelNumber?: string | null;
  releaseYear?: number | null;
  franchise?: CatalogEntity | null;
  series?: CatalogEntity | null;
  manufacturerEntity?: CatalogEntity | null;
  toyTypeEntity?: CatalogEntity | null;
  inventory?: {
    quantity: number;
    averageCost?: number | null;
  } | null;
  _count?: { listings: number };
};

type ReviewQueueEntry = {
  id: string;
  status: string;
  reasons: string[];
  fieldConfidences: Record<string, unknown>;
  suggestedChanges?: Record<string, unknown> | null;
  createdAt: string;
  item: Item;
  product?: Product | null;
};

type PurchaseRecord = {
  id: string;
  itemId: string;
  purchaseAmount: number;
  purchasedAt: string;
  note?: string | null;
  verifiedAt?: string | null;
  receipts: {
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
  }[];
  item: Item;
};

type UrlImport = {
  id: string;
  sourceUrl: string;
  adapterKey: string;
  status: string;
  progress: number;
  currentStep?: string | null;
  errorText?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  item?: { id: string; titleRaw: string; priceCurrent: number } | null;
};

type MarketAnalysis = {
  mode: "rules" | "ai";
  engineLabel: string;
  generatedAt: string;
  sampleSize: number;
  bestValue: Item | null;
  largestQuantity: Item | null;
  bestCondition: Item | null;
  ranking: (Item & { rank: number })[];
  recommendation: string;
};

type Filters = Record<string, string>;

type MonitoringOverview = {
  status: "active" | "attention";
  serverTime: string;
  lastScan?: string | null;
  lastDiscovery?: string | null;
  itemTotal: number;
  activeTotal: number;
  productTotal: number;
  pendingReviewTotal: number;
  inventoryTotal: number;
  discovered24h: number;
  totals24h: {
    candidates: number;
    inserted: number;
    skippedKnown: number;
    detailFailed: number;
    succeeded: number;
    failed: number;
  };
  sources: {
    key: string;
    displayName: string;
    itemCount: number;
    failureCount: number;
    circuitOpenAt?: string | null;
  }[];
  recent: {
    id: string;
    source: string;
    sourceName: string;
    status: string;
    query: {
      keyword?: string;
      scanMode?: string;
      pageStart?: number;
      pages?: number;
    };
    metrics?: {
      candidates?: number;
      inserted?: number;
      skippedKnown?: number;
      detailFailed?: number;
      pageStart?: number;
      pages?: number;
      scanMode?: string;
    };
    error?: string | null;
    startedAt: string;
    finishedAt?: string | null;
  }[];
};

type IconProps = { className?: string };

function HeartIcon({
  className = "h-4 w-4",
  filled = false,
}: IconProps & { filled?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z" />
    </svg>
  );
}

function FilterIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 5h16M7 12h10M10 19h4" />
    </svg>
  );
}

function RefreshIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
    </svg>
  );
}

function CloseIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function ExternalLinkIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
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

function MoneyIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9.5c-.45-.55-1.15-.85-2.05-.85-1.2 0-2 .58-2 1.45 0 .82.64 1.2 2.05 1.55 1.28.31 2.05.73 2.05 1.63 0 .9-.79 1.5-2.08 1.5-.95 0-1.7-.3-2.2-.92M12.45 7.4v9.2" />
    </svg>
  );
}

function RiderLogo({ className = "h-11 w-11" }: IconProps) {
  return (
    <svg
      aria-label="采购中心标志"
      role="img"
      viewBox="0 0 64 64"
      className={className}
      fill="none"
    >
      <path
        d="M15 25 19 13l9 5 4-2 4 2 9-5 4 12v15L44 55H20l-5-15V25Z"
        fill="white"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="m19 18 8 10 5-4 5 4 8-10M24 33l4 4m12-4-4 4M25 43h14M22 48h20"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M32 21v6"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

const sourceName = (key: string, fallback?: string) =>
  ({
    mandarake: "日本中古店",
    mercari: "日本二手市场",
    yahoo_auctions: "日本拍卖市场",
    firecrawl_market: "自动适配来源",
    apify_ecommerce: "Apify 电商检索",
    playwright_page: "动态商品页",
    mock: "本地测试来源",
  })[key] ??
  (fallback && !/mandarake|mercari|firecrawl/i.test(fallback)
    ? fallback
    : "自动适配来源");

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
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
  dx_belt: "DX腰带",
  henshin_item: "变身道具",
  medal: "Medal",
  model: "模型",
  set: "套装",
  bandai: "BANDAI",
  bandai_spirits: "BANDAI SPIRITS",
  banpresto: "Banpresto",
  megahouse: "Megahouse",
  plex: "PLEX",
  new_sealed: "全新/未开封",
  like_new: "近新",
  used: "普通二手",
  stained_or_damaged: "污损/瑕疵",
  junk: "JUNK",
  online: "线上",
  physical_store: "线下店",
};

const confidenceFieldLabels: Record<string, string> = {
  franchise: "作品系列",
  series: "具体系列",
  characters: "角色",
  toyTypes: "玩具类型",
  manufacturers: "厂商",
  quantity: "数量",
  sealedCount: "未开封数量",
  packaging: "包装",
  condition: "成色",
  visibleDamage: "可见损伤",
  missingParts: "缺件",
  backMarkings: "背标",
  year: "年份",
  modelNumber: "型号",
  copyrightText: "版权文字",
  productMatch: "标准商品匹配",
};

const translationRules: [RegExp, string][] = [
  [/&amp;/gi, "&"],
  [/&nbsp;|&#160;/gi, " "],
  [/仮面ライダーウィザード/gi, "假面骑士巫师"],
  [/仮面ライダー/gi, "假面骑士"],
  [/ウィザードリング/gi, "巫师戒指"],
  [/ウルトラマン/gi, "奥特曼"],
  [/スーパー戦隊|戦隊シリーズ/gi, "超级战队系列"],
  [/ガッチャード/gi, "歌查德"],
  [/ギーツ/gi, "极狐"],
  [/ゼロワン/gi, "零一"],
  [/ジオウ/gi, "时王"],
  [/エグゼイド/gi, "艾克赛德"],
  [/ビルド/gi, "创骑"],
  [/リバイス/gi, "利维斯"],
  [/ディケイド/gi, "帝骑"],
  [/オーズ/gi, "欧兹"],
  [/ダブル/gi, "W"],
  [/鎧武/gi, "铠武"],
  [/キバ/gi, "月骑"],
  [/カブト/gi, "甲斗"],
  [/ガシャット/gi, "卡带"],
  [/ロックシード/gi, "锁种"],
  [/ライドウォッチ/gi, "骑士手表"],
  [/ドライバー/gi, "驱动器"],
  [/ライドケミートレカ/gi, "骑乘炼金卡"],
  [/プログライズキー/gi, "程式升华钥匙"],
  [/バイスタンプ/gi, "罪恶印章"],
  [/ガンバライド/gi, "Ganbaride 街机卡"],
  [/カードダス/gi, "卡片机卡牌"],
  [/カード/gi, "卡片"],
  [/シリーズ/gi, "系列"],
  [/コンプリート/gi, "齐套"],
  [/バラ売り不可/gi, "不可拆卖"],
  [/現状販売/gi, "按现状出售"],
  [/昭和ライダー/gi, "昭和骑士"],
  [/ライダーマシン/gi, "骑士载具"],
  [/怪人/gi, "怪人"],
  [/エヴァンゲリオン/gi, "新世纪福音战士"],
  [/コラボ/gi, "联名"],
  [/チップス/gi, "薯片"],
  [/フィギュアーツ/gi, "真骨雕/可动手办"],
  [/オークション出品者/gi, "拍卖卖家"],
  [/出品者/gi, "卖家"],
  [/入りBOX/gi, "装盒"],
  [/含む/gi, "包含"],
  [/他/gi, "其他"],
  [/装動|創動/gi, "装动"],
  [/本体のみ/gi, "仅本体"],
  [/動作品|動作確認済み/gi, "功能正常"],
  [/ダブリな(?:し|無し)/gi, "无重复"],
  [/箱なし|箱無し/gi, "无盒"],
  [/付属品/gi, "配件"],
  [/目立った傷や汚れなし/gi, "无明显划痕或污渍"],
  [/やや傷や汚れあり/gi, "有轻微划痕或污渍"],
  [/送料無料|送料無(?:料)?/gi, "包邮"],
  [/未開封/gi, "未开封"],
  [/新品/gi, "新品"],
  [/中古/gi, "二手"],
  [/美品/gi, "品相好"],
  [/まとめ売り/gi, "批量出售"],
  [/大量/gi, "大量"],
  [/セット/gi, "套装"],
  [/グッズ/gi, "周边"],
  [/開封品/gi, "已开封"],
  [/未使用/gi, "未使用"],
  [/ジャンク/gi, "故障品"],
  [/欠品/gi, "缺件"],
  [/傷|キズ/gi, "划痕"],
  [/汚れ/gi, "污渍"],
  [/フィギュア/gi, "手办"],
  [/ガシャポン|ガチャ/gi, "扭蛋"],
  [/ソフビ/gi, "软胶"],
  [/食玩/gi, "食玩"],
  [/変身ベルト/gi, "变身腰带"],
  [/変身/gi, "变身"],
  [/個|点|体|枚|本/gi, "件"],
  [/送料/gi, "运费"],
  [/福袋/gi, "福袋"],
  [/おもちゃ/gi, "玩具"],
  [/ベルト/gi, "腰带"],
  [/クウガ/gi, "空我"],
  [/アギト/gi, "亚极陀"],
  [/電王/gi, "电王"],
  [/ブレイド/gi, "剑"],
  [/約(?=\d)/gi, "约"],
  [/東京都/gi, "东京都"],
  [/\s+by\s+Mercari/gi, " · Mercari"],
  [/Find\s+/gi, "商品："],
  [/\s+on\s+Mercari/gi, "（Mercari）"],
  [
    /,\s*a marketplace where anyone can buy and sell items safely and easily\./gi,
    "，日本二手交易平台。",
  ],
  [
    /Mercari carries plenty of new and unused items\./gi,
    "Mercari 有大量全新和未使用商品。",
  ],
  [/Pay by credit card[^.]*\./gi, "支持多种支付方式。"],
  [/Mercari's system ensures safe transactions[^.]*\./gi, "平台提供交易保障。"],
];

function translateText(value?: string | null) {
  if (!value) return value;
  return translationRules.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
}

const fmtYen = (value?: number | null) =>
  value == null ? "未知" : `¥${value.toLocaleString("ja-JP")}`;
const fmtDate = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "平台未提供";

function confidenceValue(value: unknown) {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "confidence" in value) {
    const confidence = (value as { confidence?: unknown }).confidence;
    return typeof confidence === "number" ? confidence : null;
  }
  return null;
}

const confidenceLabel = (value?: number | null) =>
  value == null ? "待识别" : `${Math.round(value * 100)}%`;

function relativeTime(value?: string | null) {
  if (!value) return "尚无记录";
  const seconds = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 1000),
  );
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function countdown(endAt: string | null | undefined, serverOffset: number) {
  if (!endAt) return null;
  const ms = new Date(endAt).getTime() - (Date.now() + serverOffset);
  if (ms <= 0) return "已结束";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days} 天 ${hours} 小时`;
  if (hours) return `${hours} 小时 ${minutes} 分`;
  return `${Math.max(1, minutes)} 分钟`;
}

function FilterSelect({
  label,
  name,
  value,
  onChange,
  children,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (name: string, value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-xs font-bold text-ink/60">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(name, event.target.value)}
        className="h-11 min-w-0 rounded-lg border border-ink/15 bg-white px-3 text-sm font-medium text-ink shadow-sm transition-colors hover:border-moss/40"
      >
        <option value="">全部</option>
        {children}
      </select>
    </label>
  );
}

function ProductCard({
  item,
  serverOffset,
  nowTick,
  language,
  onOpen,
  onPatch,
  onPurchase,
}: {
  item: Item;
  serverOffset: number;
  nowTick: number;
  language: "zh" | "original";
  onOpen: () => void;
  onPatch: (patch: Partial<Item>) => void;
  onPurchase: () => void;
}) {
  const remaining = useMemo(
    () => countdown(item.auctionEndAt, serverOffset),
    [item.auctionEndAt, serverOffset, nowTick],
  );
  const urgent =
    item.auctionEndAt &&
    new Date(item.auctionEndAt).getTime() - (Date.now() + serverOffset) <
      10 * 60_000;
  const displayTitle =
    language === "zh"
      ? (item.product?.titleZh ??
        item.product?.canonicalName ??
        translateText(item.titleRaw))
      : item.titleRaw;
  const productTags = [
    item.product?.series?.nameZh,
    item.product?.toyTypeEntity?.nameZh ?? labels[item.categoryToyType],
    item.product?.manufacturerEntity?.nameZh ?? labels[item.manufacturer],
    labels[item.conditionGrade],
  ].filter((tag): tag is string => Boolean(tag));
  return (
    <article
      data-item-id={item.id}
      className="js-product-card motion-layer group overflow-hidden rounded-[18px] border border-ink/10 bg-white shadow-panel transition-shadow duration-200 hover:border-moss/30 hover:shadow-lg"
    >
      <button
        onClick={onOpen}
        aria-label={`打开商品：${translateText(item.titleRaw)}`}
        className="relative block aspect-[16/7] w-full overflow-hidden bg-gradient-to-br from-moss to-ink text-left"
      >
        {item.images[0] ? (
          <img
            src={item.images[0].url}
            alt={
              language === "zh"
                ? (translateText(item.titleRaw) ?? item.titleRaw)
                : item.titleRaw
            }
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover opacity-90 transition-transform duration-300 group-hover:scale-[1.025]"
          />
        ) : (
          <div className="grid h-full place-items-center font-heading text-5xl font-black text-lime/80">
            特
          </div>
        )}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-2.5">
          <span className="rounded-md bg-ink/90 px-2 py-1 text-[10px] font-black tracking-wide text-white">
            {labels[item.categoryIp] ?? item.categoryIp}
          </span>
          <span className="rounded-md bg-lime px-2 py-1 font-mono text-[11px] font-black text-ink">
            SCORE {item.procurementScore}
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-ink/90 to-transparent p-2.5 pt-10 text-white">
          <span className="text-[11px] font-semibold">
            {sourceName(item.source.key, item.source.displayName)} ·{" "}
            {labels[item.channel] ?? item.channel}
          </span>
          <span className="font-mono text-[10px]">
            IMG {item.images.length}
          </span>
        </div>
      </button>

      <div className="p-3">
        <div className="mb-2 flex min-h-6 flex-wrap gap-1">
          {productTags.map((tag, index) => (
            <span
              key={`${tag}-${index}`}
              className={`rounded px-1.5 py-1 text-[10px] font-bold ${tag === labels.junk || tag === labels.stained_or_damaged ? "bg-rust/10 text-rust" : "bg-fog/70 text-moss"}`}
            >
              {tag}
            </span>
          ))}
          {item.needsReview && (
            <span className="rounded bg-amber-100 px-1.5 py-1 text-[10px] font-bold text-amber-800">
              待确认
            </span>
          )}
        </div>
        <button
          onClick={onOpen}
          className="line-clamp-2 min-h-11 w-full text-left text-sm font-black leading-[1.35rem] text-ink transition-colors hover:text-moss"
        >
          {displayTitle}
        </button>
        {item.product && (
          <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-ink/50">
            <span className="truncate">
              标准商品 · {item.product._count?.listings ?? 1} 个在售来源
            </span>
            <span className="shrink-0 font-mono font-bold text-moss">
              匹配 {confidenceLabel(item.matchConfidence)}
            </span>
          </div>
        )}
        <div className="mt-2 flex items-end justify-between gap-3 border-y border-ink/8 py-2">
          <div>
            <div className="text-[10px] font-bold text-ink/45">当前价</div>
            <div className="font-mono text-lg font-black text-rust">
              {fmtYen(item.priceCurrent)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-bold text-ink/45">估算单件</div>
            <div className="font-mono text-base font-black">
              {fmtYen(item.unitCostEst)}
            </div>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-3 divide-x divide-ink/10 rounded-lg bg-fog/55 px-1 py-2 text-center">
          <div className="px-1">
            <span className="block text-[9px] font-bold text-ink/45">数量</span>
            <b className="font-mono text-xs">{item.quantityEst ?? "?"} 件</b>
          </div>
          <div className="px-1">
            <span className="block text-[9px] font-bold text-ink/45">到手</span>
            <b className="font-mono text-xs">{fmtYen(item.priceTotalEst)}</b>
          </div>
          <div className="px-1">
            <span className="block text-[9px] font-bold text-ink/45">
              置信度
            </span>
            <b className="font-mono text-xs">
              {Math.round(item.confidence * 100)}%
            </b>
          </div>
        </div>
        {remaining && (
          <div
            className={`mt-2 flex min-h-9 items-center justify-between rounded-lg px-2.5 py-1.5 ${urgent ? "bg-rust text-white" : "bg-ink text-lime"}`}
          >
            <span className="text-[10px] font-bold">
              拍卖 · {item.bidCount ?? 0} 竞拍
            </span>
            <b className="font-mono text-xs">剩 {remaining}</b>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-ink/50">
          <span className="truncate">
            {language === "zh"
              ? (translateText(item.seller?.name) ?? "卖家未知")
              : (item.seller?.name ?? "卖家未知")}
          </span>
          <span className="shrink-0">发现 {relativeTime(item.detectedAt)}</span>
        </div>
        <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
          <button
            onClick={() => onPatch({ favorite: !item.favorite })}
            aria-label={item.favorite ? "取消收藏" : "收藏商品"}
            className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-bold transition-colors ${item.favorite ? "border-lime bg-lime text-ink" : "border-ink/10 bg-white hover:border-moss/35"}`}
          >
            <HeartIcon filled={item.favorite} />
            {item.favorite ? "已收藏" : "收藏"}
          </button>
          <button
            onClick={onOpen}
            className="min-h-11 rounded-lg bg-moss px-2 text-xs font-bold text-white transition-colors hover:bg-moss/90"
          >
            详情纠错
          </button>
          <button
            onClick={() => onPatch({ ignored: true })}
            aria-label="忽略这条商品线索"
            className="min-h-11 rounded-lg border border-ink/10 bg-white px-3 text-xs font-bold transition-colors hover:border-rust/40 hover:text-rust"
          >
            忽略
          </button>
        </div>
        <button
          onClick={onPurchase}
          className="mt-2 min-h-11 w-full rounded-lg border border-rust/25 bg-rust/5 px-3 text-xs font-black text-rust transition-colors hover:bg-rust/10"
        >
          标记为已购买 · 记录金额与凭证
        </button>
      </div>
    </article>
  );
}

function FavoriteMiniCard({
  item,
  language,
  onOpen,
}: {
  item: Item;
  language: "zh" | "original";
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="grid min-h-[84px] w-full grid-cols-[64px_1fr_auto] items-center gap-3 rounded-xl border border-moss/15 bg-white p-2 text-left shadow-sm transition-colors hover:border-moss/40"
    >
      <div className="h-16 w-16 overflow-hidden rounded-lg bg-ink">
        {item.images[0] ? (
          <img
            src={item.images[0].url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="grid h-full place-items-center font-heading text-2xl font-black text-lime">
            特
          </span>
        )}
      </div>
      <span className="min-w-0">
        <span className="line-clamp-2 text-xs font-black leading-5 text-ink">
          {language === "zh" ? translateText(item.titleRaw) : item.titleRaw}
        </span>
        <span className="mt-1 flex gap-2 font-mono text-[10px] text-ink/55">
          <b className="text-rust">{fmtYen(item.priceCurrent)}</b>
          <span>SCORE {item.procurementScore}</span>
        </span>
      </span>
      <HeartIcon filled className="h-4 w-4 text-moss" />
    </button>
  );
}

function DetailDrawer({
  item,
  language,
  onClose,
  onSaved,
}: {
  item: Item;
  language: "zh" | "original";
  onClose: () => void;
  onSaved: (item: Item) => void;
}) {
  const [draft, setDraft] = useState({
    categoryIp: item.categoryIp,
    categoryToyType: item.categoryToyType,
    manufacturer: item.manufacturer,
    conditionGrade: item.conditionGrade,
    quantityEst: String(item.quantityEst ?? ""),
    note: item.note ?? "",
    reason: "",
  });
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      const response = await fetch(`${API}/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...draft,
          quantityEst: draft.quantityEst
            ? Number(draft.quantityEst)
            : undefined,
          actor: "dashboard-operator",
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      onSaved((await response.json()).item);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-ink/55 backdrop-blur-sm"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-drawer-title"
        className="scrollbar-thin h-full w-full max-w-2xl overflow-y-auto bg-paper shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink/10 bg-paper/95 px-5 py-4 backdrop-blur">
          <div>
            <div className="text-xs font-black uppercase tracking-[.2em] text-moss">
              商品情报 / 人工审计
            </div>
            <h2 id="detail-drawer-title" className="mt-1 text-lg font-black">
              详情与纠错
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭详情"
            className="grid h-11 w-11 place-items-center rounded-full bg-white shadow transition-colors hover:bg-fog"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="p-5">
          {item.images[0] && (
            <img
              src={item.images[0].url}
              alt={
                language === "zh"
                  ? (translateText(item.titleRaw) ?? item.titleRaw)
                  : item.titleRaw
              }
              className="mb-5 aspect-video w-full rounded-3xl object-cover"
            />
          )}
          <h3 className="text-2xl font-black leading-tight">
            {language === "zh" ? translateText(item.titleRaw) : item.titleRaw}
          </h3>
          <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-white p-4 text-sm shadow-sm md:grid-cols-4">
            <div>
              <span className="block text-ink/45">当前价</span>
              <b>{fmtYen(item.priceCurrent)}</b>
            </div>
            <div>
              <span className="block text-ink/45">到手价</span>
              <b>{fmtYen(item.priceTotalEst)}</b>
            </div>
            <div>
              <span className="block text-ink/45">数量</span>
              <b>{item.quantityEst ?? "未知"}</b>
            </div>
            <div>
              <span className="block text-ink/45">单件</span>
              <b>{fmtYen(item.unitCostEst)}</b>
            </div>
          </div>
          <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-ink/75">
            {language === "zh"
              ? (translateText(item.descriptionRaw) ?? "无详情描述")
              : (item.descriptionRaw ?? "无详情描述")}
          </p>
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-ink px-4 py-2 text-sm font-bold text-lime"
          >
            打开原始商品页
            <ExternalLinkIcon />
          </a>

          <section className="mt-8 rounded-3xl border border-ink/10 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <div className="text-xs font-black uppercase tracking-[.18em] text-rust">
                Manual review
              </div>
              <h4 className="text-xl font-black">人工纠错</h4>
              <p className="mt-1 text-xs text-ink/50">
                每次保存都会保留修改前后数据和操作人。
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                [
                  "categoryIp",
                  "IP",
                  ["kamen_rider", "ultraman", "other", "unknown"],
                ],
                [
                  "categoryToyType",
                  "玩具类型",
                  [
                    "gashapon",
                    "shokugan",
                    "figure",
                    "sofubi",
                    "finger_puppet",
                    "dx_belt",
                    "henshin_item",
                    "medal",
                    "model",
                    "set",
                    "other",
                    "unknown",
                  ],
                ],
                [
                  "manufacturer",
                  "厂商",
                  [
                    "bandai",
                    "bandai_spirits",
                    "banpresto",
                    "megahouse",
                    "plex",
                    "other",
                    "unknown",
                  ],
                ],
                [
                  "conditionGrade",
                  "成色",
                  [
                    "new_sealed",
                    "like_new",
                    "used",
                    "stained_or_damaged",
                    "junk",
                    "unknown",
                  ],
                ],
              ].map(([key, label, options]) => (
                <label
                  key={key as string}
                  className="grid gap-1 text-xs font-bold text-ink/55"
                >
                  {label as string}
                  <select
                    value={draft[key as keyof typeof draft]}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        [key as string]: event.target.value,
                      })
                    }
                    className="min-h-11 rounded-xl border border-ink/15 p-3 text-sm text-ink"
                  >
                    {(options as string[]).map((option) => (
                      <option key={option} value={option}>
                        {labels[option] ?? option}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="grid gap-1 text-xs font-bold text-ink/55">
                估算数量
                <input
                  type="number"
                  min="1"
                  value={draft.quantityEst}
                  onChange={(event) =>
                    setDraft({ ...draft, quantityEst: event.target.value })
                  }
                  className="min-h-11 rounded-xl border border-ink/15 p-3 text-sm text-ink"
                />
              </label>
              <label className="grid gap-1 text-xs font-bold text-ink/55">
                修改原因
                <input
                  value={draft.reason}
                  onChange={(event) =>
                    setDraft({ ...draft, reason: event.target.value })
                  }
                  className="min-h-11 rounded-xl border border-ink/15 p-3 text-sm text-ink"
                  placeholder="例如：图片显示实际为 18 件"
                />
              </label>
            </div>
            <label className="mt-4 grid gap-1 text-xs font-bold text-ink/55">
              采购备注
              <textarea
                rows={4}
                value={draft.note}
                onChange={(event) =>
                  setDraft({ ...draft, note: event.target.value })
                }
                className="rounded-xl border border-ink/15 p-3 text-sm text-ink"
              />
            </label>
            <button
              disabled={saving}
              onClick={save}
              className="mt-4 min-h-12 w-full rounded-xl bg-moss px-4 py-3 font-black text-white disabled:opacity-50"
            >
              {saving ? "保存中…" : "保存纠错并写入审计"}
            </button>
          </section>
        </div>
      </aside>
    </div>
  );
}

function PurchaseDialog({
  item,
  onClose,
  onSaved,
}: {
  item: Item;
  onClose: () => void;
  onSaved: (purchase: PurchaseRecord) => void;
}) {
  const [amount, setAmount] = useState(
    String(item.priceTotalEst ?? item.priceCurrent),
  );
  const [note, setNote] = useState("");
  const [receipt, setReceipt] = useState<{
    name: string;
    type: string;
    data: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  async function submit() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 1) {
      setMessage("请输入有效购买金额");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`${API}/items/${item.id}/purchase`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purchaseAmount: value,
          note,
          receiptFileName: receipt?.name,
          receiptMimeType: receipt?.type,
          receiptDataBase64: receipt?.data,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      onSaved(result.purchase);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }
  function onFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      setMessage("仅支持 5MB 内的图片凭证");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setReceipt({
        name: file.name,
        type: file.type,
        data: String(reader.result).split(",")[1] ?? "",
      });
    reader.readAsDataURL(file);
  }
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-ink/60 p-4"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-dialog-title"
        className="w-full max-w-lg rounded-2xl bg-paper p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[.2em] text-rust">
              Purchase record
            </div>
            <h2 id="purchase-dialog-title" className="mt-1 text-xl font-black">
              记录已购买商品
            </h2>
            <p className="mt-1 line-clamp-2 text-xs text-ink/60">
              {translateText(item.titleRaw)}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭购买记录"
            className="grid h-11 w-11 place-items-center rounded-full bg-white shadow-sm"
          >
            <CloseIcon />
          </button>
        </div>
        <label className="mt-5 grid gap-1 text-xs font-bold text-ink/60">
          实时购买金额（人民币或日元按当前项目单位）
          <input
            type="number"
            min="1"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="min-h-11 rounded-xl border border-ink/15 bg-white px-3 text-base text-ink"
          />
        </label>
        <label className="mt-3 grid gap-1 text-xs font-bold text-ink/60">
          备注
          <textarea
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="rounded-xl border border-ink/15 bg-white p-3 text-sm text-ink"
            placeholder="例如：含国际转运费"
          />
        </label>
        <label className="mt-3 grid gap-1 text-xs font-bold text-ink/60">
          购买凭证（可选，5MB 内图片）
          <input
            type="file"
            accept="image/*"
            onChange={(event) => onFile(event.target.files?.[0])}
            className="min-h-11 rounded-xl border border-dashed border-ink/20 bg-white p-2 text-sm text-ink"
          />
        </label>
        {receipt && (
          <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
            已选择：{receipt.name} · 保存后标记为已认证购买
          </div>
        )}
        {message && (
          <p role="alert" className="mt-3 text-xs font-bold text-rust">
            {message}
          </p>
        )}
        <button
          disabled={saving}
          onClick={() => void submit()}
          className="mt-5 min-h-12 w-full rounded-xl bg-rust px-4 py-3 font-black text-white disabled:opacity-50"
        >
          {saving ? "写入购买记录…" : "确认购买并移入购买记录"}
        </button>
      </section>
    </div>
  );
}

export default function Dashboard() {
  const dashboardRef = useRef<HTMLElement>(null);
  const analyzedUrlTimerRef = useRef<number | null>(null);
  const animatedItemIdsRef = useRef(new Set<string>());
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [overview, setOverview] = useState<MonitoringOverview | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [serverOffset, setServerOffset] = useState(0);
  const [nowTick, setNowTick] = useState(0);
  const [selected, setSelected] = useState<Item | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [urlMessage, setUrlMessage] = useState("");
  const [urlSubmitting, setUrlSubmitting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [language, setLanguage] = useState<"zh" | "original">("zh");
  const [workspace, setWorkspace] = useState<
    "inventory" | "links" | "purchases" | "reviews" | "monitoring"
  >("inventory");
  const [imports, setImports] = useState<UrlImport[]>([]);
  const [linkItems, setLinkItems] = useState<Item[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [analysis, setAnalysis] = useState<MarketAnalysis | null>(null);
  const [reviews, setReviews] = useState<ReviewQueueEntry[]>([]);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [reviewActionId, setReviewActionId] = useState<string | null>(null);
  const [analysisOpeningId, setAnalysisOpeningId] = useState<string | null>(
    null,
  );
  const [purchaseItem, setPurchaseItem] = useState<Item | null>(null);
  const itemSignature = [...items, ...linkItems]
    .map((item) => item.id)
    .join("|");

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.fromTo(
        ".js-shell-reveal",
        { autoAlpha: 0, y: 12 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.38,
          stagger: 0.055,
          ease: "power2.out",
          clearProps: "transform,opacity,visibility",
        },
      );
    },
    { scope: dashboardRef },
  );

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      if (filtersOpen) {
        gsap.fromTo(
          ".js-filter-overlay",
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: 0.18, ease: "power1.out" },
        );
        gsap.fromTo(
          ".js-filter-modal",
          { autoAlpha: 0, y: 16, scale: 0.985 },
          { autoAlpha: 1, y: 0, scale: 1, duration: 0.26, ease: "power2.out" },
        );
      }
      if (favoritesOpen) {
        gsap.fromTo(
          ".js-favorites-content",
          { autoAlpha: 0, y: 8 },
          { autoAlpha: 1, y: 0, duration: 0.24, ease: "power2.out" },
        );
      }
    },
    {
      scope: dashboardRef,
      dependencies: [filtersOpen, favoritesOpen],
      revertOnUpdate: true,
    },
  );

  useGSAP(
    () => {
      const nodes = gsap.utils
        .toArray<HTMLElement>(".js-product-card")
        .filter(
          (node) =>
            node.dataset.itemId &&
            !animatedItemIdsRef.current.has(node.dataset.itemId),
        );
      nodes.forEach((node) =>
        animatedItemIdsRef.current.add(node.dataset.itemId ?? ""),
      );
      if (
        !nodes.length ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        return;
      gsap.fromTo(
        nodes.slice(0, 20),
        { autoAlpha: 0, y: 10 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.32,
          stagger: 0.035,
          ease: "power2.out",
          clearProps: "transform,opacity,visibility",
        },
      );
    },
    {
      scope: dashboardRef,
      dependencies: [itemSignature],
      revertOnUpdate: true,
    },
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams(
        Object.entries(filters).filter(([, value]) => value),
      );
      const response = await fetch(`${API}/items?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`API ${response.status}`);
      const data = await response.json();
      setItems(data.items);
      setTotal(data.total);
      setServerOffset(new Date(data.serverTime).getTime() - Date.now());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadImports = useCallback(async () => {
    try {
      const response = await fetch(`${API}/imports`, { cache: "no-store" });
      if (response.ok) setImports((await response.json()).imports ?? []);
    } catch {}
  }, []);
  const loadLinkItems = useCallback(async () => {
    try {
      const response = await fetch(`${API}/items?importOrigin=url&limit=100`, {
        cache: "no-store",
      });
      if (response.ok) setLinkItems((await response.json()).items ?? []);
    } catch {}
  }, []);
  const loadPurchases = useCallback(async () => {
    try {
      const response = await fetch(`${API}/items/purchases`, {
        cache: "no-store",
      });
      if (response.ok) setPurchases((await response.json()).purchases ?? []);
    } catch {}
  }, []);
  const loadAnalysis = useCallback(async () => {
    try {
      const response = await fetch(`${API}/analysis/market`, {
        cache: "no-store",
      });
      if (response.ok) setAnalysis(await response.json());
    } catch {}
  }, []);
  const loadReviews = useCallback(async () => {
    try {
      const response = await fetch(`${API}/items/reviews/pending`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = await response.json();
      setReviews(data.reviews ?? []);
      setReviewTotal(data.total ?? 0);
    } catch {}
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => void load(), 250);
    return () => clearTimeout(timeout);
  }, [load]);
  useEffect(() => {
    void Promise.all([
      loadImports(),
      loadLinkItems(),
      loadPurchases(),
      loadAnalysis(),
      loadReviews(),
    ]);
    const timer = setInterval(
      () =>
        void Promise.all([
          loadImports(),
          loadLinkItems(),
          loadPurchases(),
          loadAnalysis(),
          loadReviews(),
        ]),
      30_000,
    );
    return () => clearInterval(timer);
  }, [loadImports, loadLinkItems, loadPurchases, loadAnalysis, loadReviews]);
  useEffect(() => {
    const timer = setInterval(() => setNowTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`${API}/time`);
        const data = await response.json();
        setServerOffset(new Date(data.serverTime).getTime() - Date.now());
      } catch {}
    }, 45_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    async function refreshOverview() {
      try {
        const response = await fetch(`${API}/monitoring/overview`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = (await response.json()) as MonitoringOverview;
        if (active) setOverview(data);
      } catch {}
    }
    void refreshOverview();
    const timer = setInterval(() => void refreshOverview(), 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!filtersOpen && !selected && !purchaseItem) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (filtersOpen) setFiltersOpen(false);
      else if (selected) setSelected(null);
      else setPurchaseItem(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [filtersOpen, selected, purchaseItem]);
  useEffect(
    () => () => {
      if (analyzedUrlTimerRef.current != null)
        window.clearTimeout(analyzedUrlTimerRef.current);
    },
    [],
  );

  function changeFilter(name: string, value: string) {
    setFilters((current) => ({ ...current, [name]: value }));
  }
  async function patchItem(id: string, patch: Partial<Item>) {
    const response = await fetch(`${API}/items/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...patch, actor: "dashboard-operator" }),
    });
    if (!response.ok) return;
    const updated = (await response.json()).item as Item;
    setItems((current) =>
      current
        .map((item) => (item.id === id ? updated : item))
        .filter((item) => !item.ignored),
    );
    setLinkItems((current) =>
      current
        .map((item) => (item.id === id ? updated : item))
        .filter((item) => !item.ignored),
    );
  }

  async function openAnalysisItem(itemId: string) {
    setAnalysisOpeningId(itemId);
    try {
      const response = await fetch(`${API}/items/${itemId}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data.item) setSelected(data.item as Item);
    } finally {
      setAnalysisOpeningId(null);
    }
  }

  async function analyzeUrl() {
    if (!urlInput.trim()) return;
    setUrlSubmitting(true);
    setUrlMessage("");
    try {
      const response = await fetch(`${API}/items/analyze-url`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      const result = await response.json();
      if (!result.accepted) throw new Error(result.error ?? "链接未接受");
      setUrlMessage(
        `已识别为${sourceName(result.adapter)}，任务已排队（${result.importId ?? result.jobId}）。请在“链接专区”查看实时进度。`,
      );
      setUrlInput("");
      if (analyzedUrlTimerRef.current != null)
        window.clearTimeout(analyzedUrlTimerRef.current);
      let refreshAttempt = 0;
      const refreshAnalyzedItem = () => {
        analyzedUrlTimerRef.current = window.setTimeout(async () => {
          await Promise.all([loadImports(), load()]);
          refreshAttempt += 1;
          if (refreshAttempt < 4) refreshAnalyzedItem();
        }, 5_000);
      };
      refreshAnalyzedItem();
    } catch (reason) {
      setUrlMessage(reason instanceof Error ? reason.message : "链接分析失败");
    } finally {
      setUrlSubmitting(false);
    }
  }

  async function viewReceipt(purchase: PurchaseRecord, receiptId: string) {
    try {
      const response = await fetch(
        `${API}/items/${purchase.item.id}/purchase/receipts/${receiptId}`,
      );
      if (!response.ok) return;
      const data = await response.json();
      const tab = window.open();
      if (tab)
        tab.location.href = `data:${data.mimeType};base64,${data.dataBase64}`;
    } catch {}
  }

  async function confirmReview(review: ReviewQueueEntry) {
    setReviewActionId(review.id);
    try {
      const response = await fetch(`${API}/items/${review.item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          needsReview: false,
          actor: "review-workspace",
          reason: "人工确认当前标准商品识别",
        }),
      });
      if (response.ok) await Promise.all([loadReviews(), load()]);
    } finally {
      setReviewActionId(null);
    }
  }

  const urgentCount = items.filter(
    (item) =>
      item.auctionEndAt &&
      new Date(item.auctionEndAt).getTime() - (Date.now() + serverOffset) <
        30 * 60_000,
  ).length;
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const favoriteItems = items.filter((item) => item.favorite);
  const auctionItems = items.filter((item) => Boolean(item.auctionEndAt));
  const directItems = items.filter((item) => !item.auctionEndAt);
  const latestBackfill = overview?.recent.find(
    (job) =>
      job.query.scanMode === "backfill" || job.metrics?.scanMode === "backfill",
  );
  const completedJobs24h =
    (overview?.totals24h.succeeded ?? 0) + (overview?.totals24h.failed ?? 0);
  const successRate24h = completedJobs24h
    ? Math.round(
        ((overview?.totals24h.succeeded ?? 0) / completedJobs24h) * 100,
      )
    : 100;
  return (
    <main ref={dashboardRef} className="scanline min-h-dvh">
      <a href="#inventory" className="skip-link">
        跳到商品列表
      </a>
      <header className="border-b border-white/10 bg-ink text-white">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-ink shadow-md">
              <RiderLogo />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-heading text-base font-black tracking-tight sm:text-lg">
                采购中心
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
            <span className="flex min-h-11 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3">
              <span
                className={`h-2 w-2 rounded-full ${overview?.status === "attention" ? "bg-amber-400" : "bg-emerald-400"}`}
              />
              {overview?.status === "attention" ? "来源需要关注" : "监控运行中"}
            </span>
            <button
              onClick={() =>
                setLanguage((current) => (current === "zh" ? "original" : "zh"))
              }
              aria-pressed={language === "original"}
              className="min-h-11 rounded-lg border border-white/20 bg-white/10 px-3 text-white transition-colors hover:bg-white/15"
            >
              {language === "zh" ? "中文 · 切换原文" : "原文 · 切换中文"}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-5 lg:px-8">
        <nav
          aria-label="采购工作区"
          className="mb-4 flex flex-wrap gap-2 rounded-2xl border border-blue-100 bg-white p-2 shadow-panel"
        >
          {(
            [
              ["inventory", "在售商品", "实时库"],
              ["links", "链接专区", `${imports.length} 条任务`],
              ["purchases", "购买记录", `${purchases.length} 条`],
              ["reviews", "人工审核", `${reviewTotal} 条待办`],
              [
                "monitoring",
                "监控运行",
                overview?.status === "attention" ? "需关注" : "正常",
              ],
            ] as const
          ).map(([key, label, hint]) => (
            <button
              key={key}
              onClick={() => setWorkspace(key)}
              aria-pressed={workspace === key}
              className={`min-h-11 flex-1 rounded-xl px-4 text-left transition-colors sm:flex-none ${workspace === key ? "bg-ink text-lime" : "text-ink hover:bg-blue-50"}`}
            >
              <span className="block text-sm font-black">{label}</span>
              <span
                className={`block text-[10px] ${workspace === key ? "text-white/70" : "text-ink/50"}`}
              >
                {hint}
              </span>
            </button>
          ))}
        </nav>
        {workspace === "inventory" && (
          <section
            className="mb-3 rounded-xl border border-ink/10 bg-ink p-3 text-white shadow-panel"
            aria-labelledby="analysis-heading"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2
                  id="analysis-heading"
                  className="font-heading text-base font-black"
                >
                  AI 采购分析
                </h2>
                <p className="mt-0.5 max-w-3xl text-[11px] leading-4 text-white/65">
                  持续计算当前库的性价比、数量与成色，点击任意结论可查看对应商品。
                </p>
              </div>
              <button
                onClick={() => void loadAnalysis()}
                className="min-h-11 rounded-lg border border-white/20 bg-white/10 px-3 text-xs font-black text-white"
              >
                立即分析
              </button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {[
                ["最高性价比", analysis?.bestValue],
                ["数量最大", analysis?.largestQuantity],
                ["质量最好", analysis?.bestCondition],
              ].map(([label, item]) => (
                <button
                  key={label as string}
                  type="button"
                  disabled={!item || analysisOpeningId === (item as Item).id}
                  onClick={() =>
                    item && void openAnalysisItem((item as Item).id)
                  }
                  className="group rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left transition-colors hover:border-lime/50 hover:bg-white/10 disabled:cursor-wait disabled:opacity-70"
                >
                  <span className="block text-[10px] font-bold text-lime">
                    {label as string}
                  </span>
                  <b className="mt-1 block line-clamp-2 text-sm">
                    {item
                      ? language === "zh"
                        ? translateText((item as Item).titleRaw)
                        : (item as Item).titleRaw
                      : "分析中…"}
                  </b>
                  <span className="mt-1 block font-mono text-[11px] text-white/60">
                    {item
                      ? `评分 ${(item as Item).procurementScore} · 单件 ${fmtYen((item as Item).unitCostEst)}`
                      : "等待数据"}
                  </span>
                  {item && (
                    <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-lime/80 transition-colors group-hover:text-lime">
                      {analysisOpeningId === (item as Item).id
                        ? "正在打开…"
                        : "查看商品详情"}
                      <ExternalLinkIcon className="h-3 w-3" />
                    </span>
                  )}
                </button>
              ))}
            </div>
            {analysis && (
              <>
                <p className="mt-3 rounded-xl bg-white/8 p-3 text-xs leading-5 text-white/80">
                  {analysis.recommendation}
                </p>
                <div className="mt-3 flex items-center justify-between text-[10px] text-white/55">
                  <span>
                    {analysis.engineLabel} · 样本 {analysis.sampleSize} 件
                  </span>
                  <span>更新于 {relativeTime(analysis.generatedAt)}</span>
                </div>
                <div className="mt-3 grid min-w-0 gap-1.5 md:grid-cols-2">
                  {analysis.ranking.slice(0, 6).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      disabled={analysisOpeningId === item.id}
                      onClick={() => void openAnalysisItem(item.id)}
                      className="group flex min-w-0 items-center gap-2 overflow-hidden rounded-lg bg-white/5 px-2.5 py-2 text-left text-xs transition-colors hover:bg-white/10 disabled:cursor-wait disabled:opacity-70"
                    >
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-lime font-mono font-black text-ink">
                        {item.rank}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {language === "zh"
                          ? translateText(item.titleRaw)
                          : item.titleRaw}
                      </span>
                      <span className="font-mono text-lime">
                        {item.procurementScore}
                      </span>
                      <ExternalLinkIcon className="h-3 w-3 shrink-0 text-white/40 transition-colors group-hover:text-lime" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
        {(workspace === "links" || workspace === "purchases") && (
          <section className="mb-4 rounded-2xl border border-blue-100 bg-white p-4 shadow-panel">
            {workspace === "links" ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[.2em] text-moss">
                      URL workspace
                    </div>
                    <h2 className="font-heading text-xl font-black">
                      链接专区
                    </h2>
                    <p className="mt-1 text-xs text-ink/60">
                      所有通过链接导入的商品与后台分析任务都集中在这里，不占用收藏夹。
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      void Promise.all([loadImports(), loadLinkItems()])
                    }
                    className="min-h-11 rounded-lg border border-ink/15 px-3 text-xs font-black"
                  >
                    刷新任务
                  </button>
                </div>
                <div className="mt-4 rounded-xl bg-ink p-3 text-white">
                  <div className="text-[10px] font-black uppercase tracking-[.2em] text-blue-300">
                    链接智能分析
                  </div>
                  <label
                    htmlFor="product-url-links"
                    className="mt-1 block text-sm font-black"
                  >
                    输入公开商品链接
                  </label>
                  <p className="mt-1 text-xs leading-5 text-slate-300">
                    自动识别来源，后台分析完成后会生成标准商品卡片，不会自动加入收藏。
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      id="product-url-links"
                      type="url"
                      inputMode="url"
                      value={urlInput}
                      onChange={(event) => setUrlInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void analyzeUrl();
                      }}
                      aria-describedby="url-help-links"
                      placeholder="粘贴任意公开商品链接…"
                      className="h-11 min-h-11 min-w-0 flex-1 rounded-lg border border-white/15 bg-white/10 px-3 text-sm text-white placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      disabled={urlSubmitting || !urlInput.trim()}
                      onClick={() => void analyzeUrl()}
                      className="min-h-11 shrink-0 rounded-lg bg-lime px-4 text-sm font-black text-ink transition-colors hover:bg-amber-400 disabled:opacity-45"
                    >
                      {urlSubmitting ? "提交中…" : "分析并导入"}
                    </button>
                  </div>
                  <div
                    id="url-help-links"
                    className={`mt-2 min-h-5 text-xs ${urlMessage ? "font-bold text-amber-300" : "text-slate-400"}`}
                    aria-live="polite"
                  >
                    {urlMessage || "分析任务和导入商品会显示在下方。"}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {imports.length === 0 ? (
                    <p className="rounded-xl border border-dashed p-8 text-center text-sm text-ink/50 md:col-span-2">
                      暂无链接导入任务
                    </p>
                  ) : (
                    imports.map((entry) => (
                      <article
                        key={entry.id}
                        className="rounded-xl border border-ink/10 bg-fog/30 p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="rounded-md bg-ink px-2 py-1 text-[10px] font-black text-lime">
                            {entry.status === "queued"
                              ? "排队中"
                              : entry.status === "running"
                                ? "分析中"
                                : entry.status === "succeeded"
                                  ? "已完成"
                                  : "失败"}
                          </span>
                          <span className="font-mono text-xs text-moss">
                            {entry.progress}%
                          </span>
                        </div>
                        <div
                          className="mt-2 truncate text-xs font-bold text-ink"
                          title={entry.sourceUrl}
                        >
                          {entry.sourceUrl}
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink/10">
                          <div
                            className={`h-full rounded-full transition-[width] duration-300 ${entry.status === "failed" ? "bg-rust" : "bg-moss"}`}
                            style={{
                              width: `${Math.min(100, Math.max(0, entry.progress))}%`,
                            }}
                          />
                        </div>
                        <div className="mt-2 flex justify-between gap-2 text-[10px] text-ink/55">
                          <span>{entry.currentStep ?? "等待任务状态"}</span>
                          <span>{entry.item ? "已进入链接商品库" : ""}</span>
                        </div>
                        {entry.errorText && (
                          <div className="mt-2 text-[10px] font-bold text-rust">
                            {entry.errorText}
                          </div>
                        )}
                      </article>
                    ))
                  )}
                </div>
                <div className="mt-5 flex items-center justify-between gap-3">
                  <h3 className="font-heading text-base font-black">
                    已导入商品 · {linkItems.length}
                  </h3>
                  <span className="text-[10px] text-ink/50">
                    链接来源不会进入收藏夹
                  </span>
                </div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {linkItems.length === 0 ? (
                    <p className="rounded-xl border border-dashed p-6 text-center text-sm text-ink/50 sm:col-span-2 lg:col-span-3">
                      分析完成后商品会显示在这里
                    </p>
                  ) : (
                    linkItems.map((item) => (
                      <ProductCard
                        key={`link-${item.id}`}
                        item={item}
                        serverOffset={serverOffset}
                        nowTick={nowTick}
                        language={language}
                        onOpen={() => setSelected(item)}
                        onPatch={(patch) => void patchItem(item.id, patch)}
                        onPurchase={() => setPurchaseItem(item)}
                      />
                    ))
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[.2em] text-rust">
                      Purchase workspace
                    </div>
                    <h2 className="font-heading text-xl font-black">
                      购买记录
                    </h2>
                    <p className="mt-1 text-xs text-ink/60">
                      已购买商品独立保存，金额与凭证不会被两小时清理任务删除。
                    </p>
                  </div>
                  <button
                    onClick={() => void loadPurchases()}
                    className="min-h-11 rounded-lg border border-ink/15 px-3 text-xs font-black"
                  >
                    刷新记录
                  </button>
                </div>
                <div className="mt-4 overflow-x-auto rounded-xl border border-ink/10">
                  <table className="w-full min-w-[680px] text-left text-xs">
                    <thead className="bg-fog/70 text-[10px] uppercase tracking-wide text-ink/55">
                      <tr>
                        <th className="p-3">商品</th>
                        <th className="p-3">购买金额</th>
                        <th className="p-3">购买时间</th>
                        <th className="p-3">认证</th>
                        <th className="p-3">凭证</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchases.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="p-8 text-center text-ink/50"
                          >
                            暂无购买记录
                          </td>
                        </tr>
                      ) : (
                        purchases.map((purchase) => (
                          <tr
                            key={purchase.id}
                            className="border-t border-ink/10"
                          >
                            <td className="max-w-[320px] p-3">
                              <div className="line-clamp-2 font-bold">
                                {language === "zh"
                                  ? translateText(purchase.item.titleRaw)
                                  : purchase.item.titleRaw}
                              </div>
                              <a
                                href={purchase.item.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-flex items-center gap-1 text-[10px] text-moss"
                              >
                                原始链接 <ExternalLinkIcon />
                              </a>
                            </td>
                            <td className="p-3 font-mono font-black text-rust">
                              {fmtYen(purchase.purchaseAmount)}
                            </td>
                            <td className="p-3 text-ink/60">
                              {fmtDate(purchase.purchasedAt)}
                            </td>
                            <td className="p-3">
                              {purchase.verifiedAt ? (
                                <span className="rounded-md bg-emerald-100 px-2 py-1 font-bold text-emerald-800">
                                  已认证购买
                                </span>
                              ) : (
                                <span className="text-ink/50">未上传凭证</span>
                              )}
                            </td>
                            <td className="p-3">
                              {purchase.receipts.length ? (
                                <div className="flex flex-wrap gap-1">
                                  {purchase.receipts.map((receipt) => (
                                    <button
                                      key={receipt.id}
                                      onClick={() =>
                                        void viewReceipt(purchase, receipt.id)
                                      }
                                      type="button"
                                      title={`查看购买凭证：${receipt.fileName}`}
                                      aria-label={`查看购买凭证：${receipt.fileName}`}
                                      className="grid h-9 w-9 place-items-center rounded-md border border-moss/20 text-moss transition-colors hover:bg-moss/5"
                                    >
                                      <MoneyIcon className="h-4 w-4" />
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}
        {workspace === "reviews" && (
          <section
            aria-labelledby="reviews-heading"
            className="js-shell-reveal rounded-2xl border border-blue-100 bg-white p-4 shadow-panel"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-blue-100 pb-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[.18em] text-amber-700">
                  识别质量控制
                </div>
                <h2
                  id="reviews-heading"
                  className="font-heading text-lg font-black"
                >
                  人工审核 · {reviewTotal}
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  70%–89% 的识别结果在这里确认；低于 70% 的字段不会被系统猜测。
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadReviews()}
                className="min-h-11 rounded-lg border border-blue-200 bg-white px-3 text-xs font-black text-moss hover:bg-blue-50"
              >
                刷新审核队列
              </button>
            </div>
            <div className="mt-3 divide-y divide-blue-100">
              {reviews.length === 0 ? (
                <p className="py-12 text-center text-sm font-bold text-slate-500">
                  当前没有待审核识别结果
                </p>
              ) : (
                reviews.map((review) => (
                  <article
                    key={review.id}
                    className="grid gap-3 py-4 md:grid-cols-[84px_minmax(0,1fr)_minmax(260px,.8fr)_auto] md:items-start"
                  >
                    <button
                      type="button"
                      onClick={() => void openAnalysisItem(review.item.id)}
                      className="h-20 w-20 overflow-hidden rounded-lg bg-fog text-left"
                      aria-label="打开待审核商品"
                    >
                      {review.item.images[0] ? (
                        <img
                          src={review.item.images[0].url}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="grid h-full place-items-center font-heading text-2xl font-black text-moss">
                          特
                        </span>
                      )}
                    </button>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => void openAnalysisItem(review.item.id)}
                        className="line-clamp-2 text-left text-sm font-black leading-5 hover:text-moss"
                      >
                        {language === "zh"
                          ? translateText(review.item.titleRaw)
                          : review.item.titleRaw}
                      </button>
                      <div className="mt-1 text-[10px] text-slate-500">
                        {sourceName(
                          review.item.source.key,
                          review.item.source.displayName,
                        )}{" "}
                        · 入队 {relativeTime(review.createdAt)}
                      </div>
                      <div className="mt-2 rounded-lg bg-blue-50 px-2.5 py-2 text-xs">
                        <b className="block text-ink">
                          {review.product?.titleZh ??
                            review.product?.canonicalName ??
                            "尚未匹配标准商品"}
                        </b>
                        <span className="mt-0.5 block text-[10px] text-slate-600">
                          {[
                            review.product?.franchise?.nameZh,
                            review.product?.series?.nameZh,
                            review.product?.manufacturerEntity?.nameZh,
                            review.product?.toyTypeEntity?.nameZh,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "标准实体字段待确认"}
                        </span>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(review.fieldConfidences ?? {}).map(
                          ([field, rawValue]) => {
                            const value = confidenceValue(rawValue);
                            if (value == null) return null;
                            const level =
                              value >= 0.9
                                ? "bg-emerald-50 text-emerald-700"
                                : value >= 0.7
                                  ? "bg-amber-50 text-amber-800"
                                  : "bg-red-50 text-red-700";
                            return (
                              <span
                                key={field}
                                className={`rounded px-2 py-1 text-[10px] font-bold ${level}`}
                              >
                                {confidenceFieldLabels[field] ?? field}{" "}
                                {confidenceLabel(value)}
                              </span>
                            );
                          },
                        )}
                      </div>
                      <p className="mt-2 text-[10px] leading-4 text-slate-500">
                        {review.reasons.join("；") || "字段可信度需要人工确认"}
                      </p>
                    </div>
                    <div className="flex gap-2 md:flex-col">
                      <button
                        type="button"
                        onClick={() => void openAnalysisItem(review.item.id)}
                        className="min-h-10 rounded-lg border border-blue-200 px-3 text-xs font-bold text-moss hover:bg-blue-50"
                      >
                        查看详情
                      </button>
                      <button
                        type="button"
                        disabled={reviewActionId === review.id}
                        onClick={() => void confirmReview(review)}
                        className="min-h-10 rounded-lg bg-moss px-3 text-xs font-black text-white hover:bg-blue-800 disabled:opacity-50"
                      >
                        {reviewActionId === review.id ? "确认中…" : "确认识别"}
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        )}
        {workspace === "monitoring" && (
          <section aria-labelledby="ops-heading" className="js-shell-reveal">
            <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-panel">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[.2em] text-moss">
                    实时运营
                  </div>
                  <h2
                    id="ops-heading"
                    className="font-heading text-lg font-black"
                  >
                    实时监控与存量搜罗
                  </h2>
                  <p className="mt-1 text-xs text-slate-600">
                    新上架增量扫描 + 现有商品分页回扫并行运行
                  </p>
                </div>
                <div className="rounded-lg bg-blue-50 px-3 py-2 text-right text-[11px] text-slate-600">
                  <span className="block">
                    最近扫描{" "}
                    <b className="text-ink">
                      {relativeTime(overview?.lastScan)}
                    </b>
                  </span>
                  <span className="block">
                    最近发现{" "}
                    <b className="text-ink">
                      {relativeTime(overview?.lastDiscovery)}
                    </b>
                  </span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 divide-x divide-blue-100 border-y border-blue-100 py-3 xl:grid-cols-5">
                {[
                  [
                    "标准商品",
                    overview?.productTotal ?? 0,
                    `${overview?.pendingReviewTotal ?? reviewTotal} 条待审核`,
                  ],
                  [
                    "活跃商品",
                    overview?.activeTotal ?? total,
                    "持续刷新价格与状态",
                  ],
                  [
                    "24h 新发现",
                    overview?.discovered24h ?? 0,
                    `候选 ${overview?.totals24h.candidates ?? 0}`,
                  ],
                  [
                    "已购库存",
                    overview?.inventoryTotal ?? 0,
                    `购买记录 ${purchases.length} 条`,
                  ],
                  [
                    "任务成功率",
                    `${successRate24h}%`,
                    `${overview?.totals24h.failed ?? 0} 次失败`,
                  ],
                ].map(([label, value, hint]) => (
                  <div key={label} className="min-w-0 px-3 py-1">
                    <span className="block text-[10px] font-bold text-slate-500">
                      {label}
                    </span>
                    <b className="mt-0.5 block font-mono text-lg text-ink tabular-nums">
                      {value}
                    </b>
                    <span className="block truncate text-[10px] text-slate-500">
                      {hint}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-blue-100 px-3 py-2.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <b>存量回扫</b>
                    <span className="font-mono text-moss">
                      {latestBackfill
                        ? `第 ${(latestBackfill.metrics?.pageStart ?? latestBackfill.query.pageStart ?? 0) + 1} 页起`
                        : "等待首轮"}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[10px] text-slate-500">
                    {latestBackfill
                      ? `${latestBackfill.sourceName} · ${latestBackfill.query.keyword ?? "市场关键词"} · ${latestBackfill.status}`
                      : "回扫队列会循环遍历市场现有结果，不只盯新商品"}
                  </p>
                </div>
                <div className="flex min-w-0 gap-1.5 overflow-x-auto rounded-xl border border-blue-100 px-2.5 py-2.5">
                  {(overview?.sources ?? []).map((source) => (
                    <span
                      key={source.key}
                      className="flex shrink-0 items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1 text-[10px] font-bold text-slate-700"
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${source.failureCount > 0 ? "bg-amber-500" : "bg-emerald-500"}`}
                      />
                      {source.displayName} · {source.itemCount}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {workspace === "inventory" && (
          <>
            {filtersOpen && (
              <div
                className="js-filter-overlay fixed inset-0 z-40 grid place-items-center bg-ink/55 p-3 backdrop-blur-sm sm:p-4"
                onMouseDown={() => setFiltersOpen(false)}
              >
                <section
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="filter-dialog-title"
                  className="js-filter-modal scrollbar-thin max-h-[92dvh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-blue-100 bg-paper p-4 shadow-modal sm:p-5"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="mb-4 flex items-center justify-between gap-3 border-b border-blue-100 pb-3">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[.2em] text-moss">
                        Signals filter
                      </div>
                      <h2
                        id="filter-dialog-title"
                        className="font-heading text-lg font-black"
                      >
                        采购筛选器
                      </h2>
                      <p className="text-xs text-slate-500">
                        已启用 {activeFilterCount} 项；修改后列表会自动刷新
                      </p>
                    </div>
                    <button
                      onClick={() => setFiltersOpen(false)}
                      aria-label="关闭筛选器"
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-ink shadow-sm transition-colors hover:bg-blue-50"
                    >
                      <CloseIcon />
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <label className="grid min-w-0 gap-1 text-xs font-bold text-slate-600 sm:col-span-2">
                      关键词
                      <input
                        value={filters.search ?? ""}
                        onChange={(event) =>
                          changeFilter("search", event.target.value)
                        }
                        placeholder="标题、描述、卖家"
                        className="h-11 rounded-lg border border-ink/15 bg-white px-3 text-sm font-medium text-ink shadow-sm"
                      />
                    </label>
                    <FilterSelect
                      label="IP"
                      name="ip"
                      value={filters.ip ?? ""}
                      onChange={changeFilter}
                    >
                      <option value="kamen_rider">假面骑士</option>
                      <option value="ultraman">奥特曼</option>
                    </FilterSelect>
                    <FilterSelect
                      label="价格档"
                      name="priceBand"
                      value={filters.priceBand ?? ""}
                      onChange={changeFilter}
                    >
                      <option value="lt_1000">&lt; ¥1,000</option>
                      <option value="1000_2999">¥1,000–2,999</option>
                      <option value="3000_4999">¥3,000–4,999</option>
                      <option value="gte_5000">¥5,000+</option>
                    </FilterSelect>
                    <FilterSelect
                      label="成色"
                      name="condition"
                      value={filters.condition ?? ""}
                      onChange={changeFilter}
                    >
                      {[
                        "new_sealed",
                        "like_new",
                        "used",
                        "stained_or_damaged",
                        "junk",
                        "unknown",
                      ].map((v) => (
                        <option key={v} value={v}>
                          {labels[v]}
                        </option>
                      ))}
                    </FilterSelect>
                    <FilterSelect
                      label="玩具类型"
                      name="toyType"
                      value={filters.toyType ?? ""}
                      onChange={changeFilter}
                    >
                      {[
                        "gashapon",
                        "shokugan",
                        "figure",
                        "sofubi",
                        "finger_puppet",
                        "dx_belt",
                        "henshin_item",
                        "medal",
                        "model",
                        "set",
                      ].map((v) => (
                        <option key={v} value={v}>
                          {labels[v]}
                        </option>
                      ))}
                    </FilterSelect>
                    <FilterSelect
                      label="厂商"
                      name="manufacturer"
                      value={filters.manufacturer ?? ""}
                      onChange={changeFilter}
                    >
                      {[
                        "bandai",
                        "bandai_spirits",
                        "banpresto",
                        "megahouse",
                        "plex",
                        "unknown",
                      ].map((v) => (
                        <option key={v} value={v}>
                          {labels[v]}
                        </option>
                      ))}
                    </FilterSelect>
                    <FilterSelect
                      label="渠道"
                      name="channel"
                      value={filters.channel ?? ""}
                      onChange={changeFilter}
                    >
                      <option value="online">线上</option>
                      <option value="physical_store">线下店</option>
                    </FilterSelect>
                    <FilterSelect
                      label="平台"
                      name="platform"
                      value={filters.platform ?? ""}
                      onChange={changeFilter}
                    >
                      <option value="mandarake">日本中古店</option>
                      <option value="mercari">日本二手市场</option>
                      <option value="yahoo_auctions">日本拍卖市场</option>
                      <option value="firecrawl_market">自动适配来源</option>
                    </FilterSelect>
                    <FilterSelect
                      label="拍卖剩余"
                      name="auctionHours"
                      value={filters.auctionHours ?? ""}
                      onChange={changeFilter}
                    >
                      <option value="1">1 小时内</option>
                      <option value="6">6 小时内</option>
                      <option value="24">24 小时内</option>
                      <option value="72">3 天内</option>
                    </FilterSelect>
                    <FilterSelect
                      label="上架时间"
                      name="listedWithinHours"
                      value={filters.listedWithinHours ?? ""}
                      onChange={changeFilter}
                    >
                      <option value="24">24 小时内</option>
                      <option value="168">7 天内</option>
                      <option value="720">30 天内</option>
                    </FilterSelect>
                    <FilterSelect
                      label="首次监控"
                      name="detectedWithinHours"
                      value={filters.detectedWithinHours ?? ""}
                      onChange={changeFilter}
                    >
                      <option value="24">24 小时内</option>
                      <option value="168">7 天内</option>
                      <option value="720">30 天内</option>
                    </FilterSelect>
                    <label className="grid gap-1 text-xs font-bold text-slate-600">
                      最低数量
                      <input
                        type="number"
                        min="1"
                        value={filters.minQuantity ?? ""}
                        onChange={(event) =>
                          changeFilter("minQuantity", event.target.value)
                        }
                        className="h-11 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink"
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-bold text-slate-600">
                      最高单件成本
                      <input
                        type="number"
                        min="0"
                        value={filters.maxUnitCost ?? ""}
                        onChange={(event) =>
                          changeFilter("maxUnitCost", event.target.value)
                        }
                        className="h-11 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink"
                      />
                    </label>
                    <FilterSelect
                      label="人工复核"
                      name="needsReview"
                      value={filters.needsReview ?? ""}
                      onChange={changeFilter}
                    >
                      <option value="true">仅待确认</option>
                      <option value="false">已确认</option>
                    </FilterSelect>
                    <FilterSelect
                      label="收藏"
                      name="favorite"
                      value={filters.favorite ?? ""}
                      onChange={changeFilter}
                    >
                      <option value="true">仅收藏</option>
                      <option value="false">未收藏</option>
                    </FilterSelect>
                  </div>
                  <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-blue-100 pt-4">
                    <button
                      onClick={() => setFilters({})}
                      className="min-h-11 rounded-lg border border-ink/15 bg-white px-4 text-xs font-bold transition-colors hover:bg-blue-50"
                    >
                      重置筛选
                    </button>
                    <button
                      onClick={() => setFiltersOpen(false)}
                      className="min-h-11 rounded-lg bg-moss px-5 text-xs font-black text-white transition-colors hover:bg-blue-800"
                    >
                      应用并关闭
                    </button>
                  </div>
                </section>
              </div>
            )}

            <section className="js-shell-reveal mt-3 rounded-2xl border border-blue-100 bg-white p-3 shadow-panel">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-[.2em] text-moss">
                    在售库
                  </div>
                  <h2
                    id="inventory"
                    className="font-heading text-lg font-black"
                  >
                    {total} 条采购线索
                  </h2>
                  <p className="text-xs text-slate-500">
                    按采购评分与发现时间排序 · 30 分钟内结束 {urgentCount} 件
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {activeFilterCount > 0 && (
                    <button
                      onClick={() => setFilters({})}
                      className="min-h-11 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-moss transition-colors hover:bg-blue-100"
                    >
                      清除 {activeFilterCount} 项
                    </button>
                  )}
                  <button
                    onClick={() => setFiltersOpen(true)}
                    aria-haspopup="dialog"
                    className="flex min-h-11 items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 text-xs font-black text-moss transition-colors hover:bg-blue-50"
                  >
                    <FilterIcon /> 筛选
                    {activeFilterCount ? ` · ${activeFilterCount}` : ""}
                  </button>
                  <button
                    onClick={() => void load()}
                    disabled={loading}
                    className="flex min-h-11 items-center gap-2 rounded-lg bg-moss px-3 text-xs font-bold text-white transition-colors hover:bg-blue-800 disabled:opacity-50"
                  >
                    <RefreshIcon
                      className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                    />
                    {loading ? "同步中" : "立即刷新"}
                  </button>
                </div>
              </div>
            </section>
            {error && (
              <div
                role="alert"
                className="mt-3 rounded-xl bg-rust p-4 font-bold text-white"
              >
                无法读取 API：{error}
              </div>
            )}
            {favoriteItems.length > 0 && !filters.favorite && (
              <section className="js-shell-reveal mt-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[.2em] text-amber-700">
                      收藏区
                    </div>
                    <h3 className="font-heading text-sm font-black">
                      收藏夹 · {favoriteItems.length}
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setFavoritesOpen((open) => !open)}
                      aria-expanded={favoritesOpen}
                      aria-controls="favorite-cards"
                      className="flex min-h-11 items-center gap-2 rounded-lg bg-amber-700 px-3 text-xs font-black text-white transition-colors hover:bg-amber-800"
                    >
                      <HeartIcon filled />{" "}
                      {favoritesOpen ? "收起收藏" : "展开收藏"}
                    </button>
                    <button
                      onClick={() => changeFilter("favorite", "true")}
                      className="min-h-11 rounded-lg border border-amber-300 bg-white px-3 text-xs font-bold text-amber-800 transition-colors hover:bg-amber-100"
                    >
                      仅看收藏
                    </button>
                  </div>
                </div>
                {favoritesOpen && (
                  <div
                    id="favorite-cards"
                    className="js-favorites-content mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
                  >
                    {favoriteItems.slice(0, 8).map((item) => (
                      <FavoriteMiniCard
                        key={`favorite-${item.id}`}
                        item={item}
                        language={language}
                        onOpen={() => setSelected(item)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
            {loading && items.length === 0 ? (
              <div className="mt-3 grid min-h-52 place-items-center rounded-2xl border border-dashed border-blue-200 bg-white py-16 text-sm font-bold text-slate-500">
                正在同步采购情报…
              </div>
            ) : (
              <div className="mt-3 space-y-4">
                <section aria-labelledby="auction-items-heading">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <h3
                      id="auction-items-heading"
                      className="font-heading text-base font-black"
                    >
                      拍卖商品 · {auctionItems.length}
                    </h3>
                    <span className="text-[10px] text-ink/50">
                      实时竞拍与截止时间
                    </span>
                  </div>
                  {auctionItems.length ? (
                    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                      {auctionItems.map((item) => (
                        <ProductCard
                          key={item.id}
                          item={item}
                          serverOffset={serverOffset}
                          nowTick={nowTick}
                          language={language}
                          onOpen={() => setSelected(item)}
                          onPatch={(patch) => void patchItem(item.id, patch)}
                          onPurchase={() => setPurchaseItem(item)}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-dashed border-blue-200 bg-white p-6 text-center text-sm text-ink/50">
                      当前没有进行中的拍卖商品
                    </p>
                  )}
                </section>
                <section aria-labelledby="direct-items-heading">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <h3
                      id="direct-items-heading"
                      className="font-heading text-base font-black"
                    >
                      正常购买 · {directItems.length}
                    </h3>
                    <span className="text-[10px] text-ink/50">
                      一口价与店铺现货
                    </span>
                  </div>
                  {directItems.length ? (
                    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                      {directItems.map((item) => (
                        <ProductCard
                          key={item.id}
                          item={item}
                          serverOffset={serverOffset}
                          nowTick={nowTick}
                          language={language}
                          onOpen={() => setSelected(item)}
                          onPatch={(patch) => void patchItem(item.id, patch)}
                          onPurchase={() => setPurchaseItem(item)}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-dashed border-blue-200 bg-white p-6 text-center text-sm text-ink/50">
                      当前没有一口价或店铺现货商品
                    </p>
                  )}
                </section>
              </div>
            )}
            {!loading && !error && items.length === 0 && (
              <div className="mt-3 rounded-2xl border border-dashed border-blue-200 bg-white py-16 text-center text-sm font-bold text-slate-500">
                当前筛选条件下没有商品。请清除筛选或稍后刷新。
              </div>
            )}
          </>
        )}
      </div>
      {selected && (
        <DetailDrawer
          item={selected}
          language={language}
          onClose={() => setSelected(null)}
          onSaved={(updated) => {
            setSelected(updated);
            setItems((current) =>
              current.map((item) => (item.id === updated.id ? updated : item)),
            );
          }}
        />
      )}
      {purchaseItem && (
        <PurchaseDialog
          item={purchaseItem}
          onClose={() => setPurchaseItem(null)}
          onSaved={() => {
            setPurchaseItem(null);
            void Promise.all([loadPurchases(), load(), loadLinkItems()]);
          }}
        />
      )}
    </main>
  );
}
