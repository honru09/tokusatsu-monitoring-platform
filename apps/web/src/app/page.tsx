"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DiscoveryWorkspace } from "../components/discovery-workspace";
import { ImageGallery } from "../components/image-gallery";
import { MarketIntelWorkspace } from "../components/market-intel-workspace";
import { AiSystemWorkspace } from "../components/ai-system-workspace";
import { LogisticsWorkspace } from "../components/logistics-workspace";
import { AssistantChatWorkspace } from "../components/assistant-chat-workspace";
import {
  goBackWorkspaceState,
  navigateWorkspaceState,
  type Workspace,
} from "../lib/workspace-navigation";

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
  updatedAt?: string;
  auctionEndAt?: string | null;
  listingType: "auction" | "direct";
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
  status: string;
  favorite: boolean;
  ignored: boolean;
  ignoredAt?: string | null;
  importOrigin?: "search" | "url";
  archivedAt?: string | null;
  normalizedTitle?: string | null;
  fieldConfidences?: Record<string, unknown> | null;
  extractionEvidence?: Record<string, unknown> | null;
  sourceData?: Record<string, unknown> | null;
  titleZh?: string | null;
  descriptionZh?: string | null;
  conditionZh?: string | null;
  shippingZh?: string | null;
  detailsZh?: { path: string; labelZh?: string; valueZh: string }[] | null;
  translationStatus?: "pending" | "processing" | "completed" | "failed";
  translatedAt?: string | null;
  matchConfidence?: number | null;
  matchDecision?: string | null;
  purchaseRecord?: PurchaseRecord | null;
  note?: string | null;
  source: { key: string; displayName: string };
  seller?: {
    id?: string;
    name: string;
    sellerType: string;
    locationText?: string | null;
    profileUrl?: string | null;
    sourceData?: Record<string, unknown> | null;
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

type ExchangeRate = {
  pair: "JPY_CNY";
  rate: number;
  source: string;
  referenceDate: string;
  fetchedAt: string;
  stale: boolean;
  warning?: string;
};

type CartPayload = {
  cartId: string;
  items: Item[];
  count: number;
  updatedAt: string;
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

const AUXILIARY_PAGE_SIZE = 24;

type MarketAnalysis = {
  mode: "rules" | "ai";
  engineLabel: string;
  generatedAt: string;
  sampleSize: number;
  bestValue: Item | null;
  largestQuantity: Item | null;
  bestCondition: Item | null;
  recommendation: string;
  rankedRecommendations: { item: Item; reason: string }[];
  insights: string[];
  risks: string[];
};

type SellerAnalysis = {
  seller: {
    id: string;
    name: string;
    sellerType: string;
    locationText?: string | null;
    profileUrl?: string | null;
    sourceData?: Record<string, unknown> | null;
    source: { key: string; displayName: string };
  };
  items: Item[];
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

type SellerSummary = {
  id: string;
  name: string;
  sellerType: string;
  locationText?: string | null;
  profileUrl?: string | null;
  source: { key: string; displayName: string };
  _count: { items: number };
  segment?: SellerSegment;
};

type SellerSegment = {
  key: string;
  label: string;
  description: string;
  count?: number;
  reasons?: string[];
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

function ArrowLeftIcon({ className = "h-5 w-5" }: IconProps) {
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
      <path d="M19 12H5m7-7-7 7 7 7" />
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

function CommentIcon({ className = "h-4 w-4" }: IconProps) {
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
      <path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.8 8.8 0 0 1-3.6-.8L4 20l1.1-3.2A7.2 7.2 0 0 1 4 12c0-4.1 3.6-7.5 8-7.5s8 3.1 8 7Z" />
      <path d="M8 12h.01M12 12h.01M16 12h.01" />
    </svg>
  );
}

function CartIcon({ className = "h-5 w-5" }: IconProps) {
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
      <path d="M3 4h2l1.8 10.2a2 2 0 0 0 2 1.7h7.9a2 2 0 0 0 1.9-1.4L21 7H6" />
      <circle cx="9" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
    </svg>
  );
}

function ShareIcon({ className = "h-5 w-5" }: IconProps) {
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
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" />
    </svg>
  );
}

function PhotoIcon({ className = "h-5 w-5" }: IconProps) {
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
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="m4 17 4.7-4.7a2 2 0 0 1 2.8 0l2.1 2.1 1.2-1.2a2 2 0 0 1 2.8 0L21 16.6" />
    </svg>
  );
}

function TranslateIcon({ className = "h-4 w-4" }: IconProps) {
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
      <path d="M4 5h8M8 3v2c0 4-2 7-5 9M5 10c1.2 1.3 2.7 2.4 4.5 3.2M13 21l4.5-11L22 21M14.5 18h6" />
    </svg>
  );
}

function InfoIcon({ className = "h-4 w-4" }: IconProps) {
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
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.5v5M12 7.5h.01" />
    </svg>
  );
}

function AnalysisIcon({ className = "h-4 w-4" }: IconProps) {
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
      <path d="M4 18V9m5 9V5m5 13v-7" />
      <circle cx="17.5" cy="8.5" r="3.5" />
      <path d="m20 11 2 2" />
    </svg>
  );
}

function ArchiveIcon({ className = "h-4 w-4" }: IconProps) {
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
      <path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6" />
    </svg>
  );
}

function BagIcon({ className = "h-5 w-5" }: IconProps) {
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
      <path d="M5 8h14l1 12H4L5 8ZM9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

function CompassIcon({ className = "h-5 w-5" }: IconProps) {
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
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </svg>
  );
}

function LinkIcon({ className = "h-5 w-5" }: IconProps) {
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
      <path d="M10 13.5a4 4 0 0 0 5.7.2l2-2a4 4 0 0 0-5.7-5.7l-1.1 1.1" />
      <path d="M14 10.5a4 4 0 0 0-5.7-.2l-2 2A4 4 0 0 0 8 18l1.1-1.1" />
    </svg>
  );
}

function ListIcon({ className = "h-5 w-5" }: IconProps) {
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
      <path d="M7 5h13M7 12h13M7 19h13M3 5h.01M3 12h.01M3 19h.01" />
    </svg>
  );
}

function UsersIcon({ className = "h-5 w-5" }: IconProps) {
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
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20c.5-3.2 2.3-5 5.5-5s5 1.8 5.5 5" />
      <path d="M15.5 5.5a3 3 0 0 1 0 5.8M17 15c2.2.4 3.5 2 3.8 4.5" />
    </svg>
  );
}

function SettingsIcon({ className = "h-5 w-5" }: IconProps) {
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
      <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
      <path d="m19.4 15 .1.1a1.8 1.8 0 0 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3.1 1.3v.2a1.8 1.8 0 0 1-3.6 0v-.2a1.8 1.8 0 0 0-3.1-1.3l-.1.1a1.8 1.8 0 1 1-2.5-2.5l.1-.1A1.8 1.8 0 0 0 3.3 12a1.8 1.8 0 0 0 1.3-3.1l-.1-.1A1.8 1.8 0 0 1 7 6.3l.1.1A1.8 1.8 0 0 0 10.2 5v-.2a1.8 1.8 0 0 1 3.6 0V5a1.8 1.8 0 0 0 3.1 1.3l.1-.1a1.8 1.8 0 0 1 2.5 2.5l-.1.1A1.8 1.8 0 0 0 20.7 12a1.8 1.8 0 0 0-1.3 3Z" />
    </svg>
  );
}

function SparklesIcon({ className = "h-5 w-5" }: IconProps) {
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
      <path d="M12 2.8c.8 4.2 2.7 6.1 6.9 6.9-4.2.8-6.1 2.7-6.9 6.9-.8-4.2-2.7-6.1-6.9-6.9 4.2-.8 6.1-2.7 6.9-6.9Z" />
      <path d="M19 15.6c.35 1.9 1.2 2.75 3.1 3.1-1.9.35-2.75 1.2-3.1 3.1-.35-1.9-1.2-2.75-3.1-3.1 1.9-.35 2.75-1.2 3.1-3.1Z" />
    </svg>
  );
}

function WorkbenchIcon({ className = "h-5 w-5" }: IconProps) {
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
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </svg>
  );
}

function MenuIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function RiderLogo({ className = "h-11 w-11" }: IconProps) {
  // Brand logo locked by user: white ground and black line art. Do not redesign.
  return (
    <svg
      aria-label="假面采购标志"
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
    mock: "本地测试来源",
  })[key] ??
  (fallback?.trim() || key);

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const PAGE_SIZE = 40;
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

const fmtCny = (yen: number | null | undefined, rate?: number) =>
  yen == null || !rate
    ? ""
    : `约 ¥${(yen * rate).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function shippingLabel(item: Item) {
  if (item.shippingFee === 0) return "包邮";
  if (item.shippingFee != null) return fmtYen(item.shippingFee);
  const status = item.sourceData?.shippingStatus;
  return status === "calculated" ? "按地区计算" : "平台未提供";
}
const fmtDate = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "平台未提供";

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

function auctionTimeline(item: Item, serverOffset: number) {
  if (!item.auctionEndAt) return null;
  const end = new Date(item.auctionEndAt).getTime();
  const detected = new Date(item.detectedAt).getTime();
  const listed = item.listedAt ? new Date(item.listedAt).getTime() : Number.NaN;
  const start = Number.isFinite(listed) && listed < end ? listed : detected;
  const now = Date.now() + serverOffset;
  const duration = Math.max(60_000, end - start);
  const remainingMs = end - now;
  return {
    remaining: countdown(item.auctionEndAt, serverOffset),
    remainingMs,
    progress: Math.max(0, Math.min(1, (now - start) / duration)),
    estimatedStart: !Number.isFinite(listed) || listed >= end,
  };
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
  translatedTitle,
  onOpen,
  onPatch,
  onIgnore,
  onPurchase,
  onSeller,
  exchangeRate,
  inCart,
  onCart,
  onShare,
}: {
  item: Item;
  serverOffset: number;
  nowTick: number;
  language: "zh" | "original";
  translatedTitle?: string;
  onOpen: () => void;
  onPatch: (patch: Partial<Item>) => void | Promise<void>;
  onIgnore: () => void;
  onPurchase: () => void;
  onSeller: (sellerId: string) => void;
  exchangeRate?: number;
  inCart: boolean;
  onCart: () => void;
  onShare: () => void;
}) {
  const [showOriginal, setShowOriginal] = useState(language === "original");
  useEffect(() => setShowOriginal(language === "original"), [language]);
  const [noteDraft, setNoteDraft] = useState(item.note ?? "");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  useEffect(() => setNoteDraft(item.note ?? ""), [item.note]);
  async function saveNote() {
    const next = noteDraft.slice(0, 10);
    if (next === (item.note ?? "")) {
      if (!next) setNoteOpen(false);
      return;
    }
    setNoteSaving(true);
    try {
      await onPatch({ note: next || null });
      if (!next) setNoteOpen(false);
    } finally {
      setNoteSaving(false);
    }
  }
  const auction = useMemo(
    () => auctionTimeline(item, serverOffset),
    [item, serverOffset, nowTick],
  );
  const displayTitle = showOriginal
    ? item.titleRaw
    : language === "zh"
      ? (translatedTitle ??
        item.titleZh ??
        item.product?.titleZh ??
        translateText(item.titleRaw) ??
        item.titleRaw)
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
      className="ios-card product-card js-product-card motion-layer group flex h-full min-w-0 flex-col overflow-hidden rounded-[18px] shadow-panel"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
        aria-label={`打开商品：${displayTitle}`}
        className="product-card-media relative block aspect-[3/2] w-full overflow-hidden bg-ink text-left outline-none focus-visible:ring-4 focus-visible:ring-moss/30"
      >
        <ImageGallery
          images={item.images}
          alt={displayTitle ?? item.titleRaw}
          className="h-full w-full"
          imageClassName="opacity-90 transition-transform duration-300 group-hover:scale-[1.025]"
        />
        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-2.5">
          <span className="rounded-md bg-ink/90 px-2 py-1 text-[10px] font-black tracking-wide text-white">
            {labels[item.categoryIp] ?? item.categoryIp}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setShowOriginal((current) => !current);
              }}
              aria-label={showOriginal ? "切换为中文" : "切换为原文"}
              title={showOriginal ? "中文" : "原文"}
              className="grid h-11 w-11 place-items-center rounded-full bg-ink/75 text-white backdrop-blur transition-colors hover:bg-ink"
            >
              <TranslateIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-ink/90 to-transparent p-2.5 pt-10 text-white">
          <span className="text-[11px] font-semibold">
            {sourceName(item.source.key, item.source.displayName)}
          </span>
          <span className="font-mono text-[10px]">
            IMG {item.images.length}
          </span>
        </div>
      </div>

      <div className="product-card-body flex flex-1 flex-col p-3">
        <div className="product-card-tags mb-2 flex min-h-6 flex-wrap gap-1">
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
          className="product-card-title line-clamp-2 min-h-11 w-full text-left text-sm font-black leading-[1.35rem] text-ink transition-colors hover:text-moss"
        >
          {displayTitle}
        </button>
        {item.product && (
          <div className="product-card-standard mt-1 flex items-center justify-between gap-2 text-[10px] text-ink/50">
            <span className="truncate">
              标准商品 · {item.product._count?.listings ?? 1} 个在售来源
            </span>
          </div>
        )}
        <div className="product-card-market mt-2 flex items-end justify-between gap-3 border-y border-ink/8 py-2.5">
          <div>
            <div className="text-[10px] font-bold text-ink/45">当前价</div>
            <div className="font-mono text-lg font-black text-rust">
              {fmtYen(item.priceCurrent)}
            </div>
            <div className="font-mono text-[10px] font-semibold text-ink/45">
              {fmtCny(item.priceCurrent, exchangeRate)}
            </div>
            <div className="text-[10px] font-semibold text-ink/50">
              邮费 {shippingLabel(item)}
              {item.shippingFee != null && (
                <span className="ml-1 font-mono text-[9px] text-ink/40">
                  {fmtCny(item.shippingFee, exchangeRate)}
                </span>
              )}
            </div>
          </div>
          <div className="grid gap-0.5 text-right text-[10px] text-ink/50">
            <div>
              <span>数量 </span>
              <b className="font-mono text-xs text-ink">
                {item.quantityEst ?? "?"} 件
              </b>
            </div>
            <div>
              <span>单件 </span>
              <b className="font-mono text-xs text-ink">
                {fmtYen(item.unitCostEst)}
              </b>
              {item.unitCostEst != null && (
                <span className="ml-1 font-mono text-[9px] text-ink/40">
                  {fmtCny(item.unitCostEst, exchangeRate)}
                </span>
              )}
            </div>
          </div>
        </div>
        {auction?.remaining && (
          <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50/70 px-2.5 py-2 text-ink">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold text-ink/60">
                拍卖 · {item.bidCount ?? 0} 竞拍
              </span>
              <b
                className={`font-mono text-xs tabular-nums ${auction.remainingMs < 10 * 60_000 ? "text-rust" : auction.remainingMs < 60 * 60_000 ? "text-amber-700" : "text-moss"}`}
              >
                剩 {auction.remaining}
              </b>
            </div>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10"
              aria-label={`拍卖进度 ${Math.round(auction.progress * 100)}%`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(auction.progress * 100)}
            >
              <span
                className={`block h-full origin-left rounded-full transition-transform duration-1000 ease-linear motion-reduce:transition-none ${auction.remainingMs < 10 * 60_000 ? "bg-rust" : auction.remainingMs < 60 * 60_000 ? "bg-amber-500" : "bg-moss"}`}
                style={{ transform: `scaleX(${auction.progress})` }}
              />
            </div>
          </div>
        )}
        <div className="product-card-seller mt-2 flex items-center justify-between gap-2 text-[10px] text-ink/50">
          <button
            type="button"
            disabled={!item.seller?.id}
            onClick={(event) => {
              event.stopPropagation();
              if (item.seller?.id) onSeller(item.seller.id);
            }}
            className="truncate text-left hover:text-moss disabled:cursor-default"
          >
            {language === "zh"
              ? (translateText(item.seller?.name) ?? "卖家未知")
              : (item.seller?.name ?? "卖家未知")}
          </button>
          <span className="shrink-0">发现 {relativeTime(item.detectedAt)}</span>
        </div>
        <div className="product-card-note mt-2 min-h-11">
          {noteOpen ? (
            <div className="flex min-h-11 items-center gap-2 rounded-xl border border-ink/10 bg-fog/35 px-2.5 transition-[opacity,transform] duration-200 motion-reduce:transition-none">
              <CommentIcon className="h-4 w-4 shrink-0 text-ink/40" />
              <input
                autoFocus
                value={noteDraft}
                maxLength={10}
                onChange={(event) =>
                  setNoteDraft(event.target.value.slice(0, 10))
                }
                onBlur={() => void saveNote()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    setNoteDraft(item.note ?? "");
                    setNoteOpen(false);
                  }
                }}
                aria-label="商品备注"
                placeholder="最多 10 字"
                disabled={noteSaving}
                className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink/35"
              />
              <span className="shrink-0 font-mono text-[9px] text-ink/35">
                {noteDraft.length}/10
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              aria-label={item.note ? `编辑备注：${item.note}` : "添加商品备注"}
              title={item.note ? "编辑备注" : "添加备注"}
              className={`flex h-11 max-w-full items-center gap-1.5 rounded-full border border-ink/10 bg-white px-3 text-xs text-ink/60 transition-[width,background-color] duration-200 hover:bg-fog motion-reduce:transition-none ${item.note ? "w-fit" : "w-11 justify-center px-0"}`}
            >
              <CommentIcon className="h-4 w-4 shrink-0" />
              {item.note && <span className="truncate">{item.note}</span>}
            </button>
          )}
        </div>
        <div className="product-card-actions mt-auto grid grid-cols-6 gap-1.5 pt-2">
          <button
            onClick={() => onPatch({ favorite: !item.favorite })}
            aria-label={item.favorite ? "取消收藏" : "收藏商品"}
            title={item.favorite ? "取消收藏" : "收藏"}
            className={`grid min-h-11 place-items-center rounded-lg border transition-colors ${item.favorite ? "border-lime bg-lime text-ink" : "border-ink/10 bg-white hover:border-moss/35"}`}
          >
            <HeartIcon filled={item.favorite} />
          </button>
          <button
            onClick={onOpen}
            aria-label="查看详情"
            title="详情"
            className="grid min-h-11 place-items-center rounded-lg bg-moss text-white transition-colors hover:bg-moss/90"
          >
            <InfoIcon />
          </button>
          <button
            onClick={onIgnore}
            aria-label="标记为不感兴趣"
            title="不感兴趣"
            className="grid min-h-11 place-items-center rounded-lg border border-ink/10 bg-white text-ink transition-colors hover:border-rust/40 hover:text-rust"
          >
            <ArchiveIcon />
          </button>
          <button
            onClick={onPurchase}
            aria-label="记录购买"
            title="记录购买"
            className="grid min-h-11 place-items-center rounded-lg border border-rust/25 bg-rust/5 text-rust transition-colors hover:bg-rust/10"
          >
            <MoneyIcon />
          </button>
          <button
            onClick={onCart}
            aria-label={inCart ? "移出购物车" : "加入购物车"}
            title={inCart ? "移出购物车" : "加入购物车"}
            className={`grid min-h-11 place-items-center rounded-lg border transition-colors ${inCart ? "border-blue-300 bg-blue-50 text-moss" : "border-ink/10 bg-white text-ink hover:border-moss/35"}`}
          >
            <CartIcon />
          </button>
          <button
            onClick={onShare}
            aria-label="分享商品"
            title="分享"
            className="grid min-h-11 place-items-center rounded-lg border border-ink/10 bg-white text-ink transition-colors hover:border-moss/35"
          >
            <ShareIcon />
          </button>
        </div>
      </div>
    </article>
  );
}

function ItemImagesDialog({
  item,
  title,
  onClose,
}: {
  item: Item;
  title: string;
  onClose: () => void;
}) {
  return (
    <div
      className="modal-backdrop fixed inset-0 z-[90] grid place-items-center bg-ink/55 p-3"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${title}的商品图片`}
        className="modal-panel w-full max-w-2xl rounded-3xl bg-white p-3 shadow-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-1 pb-3">
          <h2 className="line-clamp-1 text-sm font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭图片"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-fog"
          >
            <CloseIcon />
          </button>
        </div>
        <ImageGallery
          images={item.images}
          alt={title}
          className="aspect-[4/3] max-h-[72dvh] w-full rounded-2xl bg-ink"
          imageClassName="object-contain"
        />
      </section>
    </div>
  );
}

function CartDialog({
  cart,
  exchangeRate,
  language,
  translations,
  sharing,
  message,
  onRemove,
  onOpen,
  onShare,
  onClose,
}: {
  cart: CartPayload;
  exchangeRate?: number;
  language: "zh" | "original";
  translations: Record<string, string>;
  sharing: boolean;
  message: string;
  onRemove: (itemId: string) => void;
  onOpen: (item: Item) => void;
  onShare: () => void;
  onClose: () => void;
}) {
  const total = cart.items.reduce(
    (sum, item) => sum + item.priceCurrent + (item.shippingFee ?? 0),
    0,
  );
  return (
    <div
      className="modal-backdrop fixed inset-0 z-[85] grid place-items-center bg-ink/45 p-3"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-title"
        className="modal-panel flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-white shadow-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-ink/8 p-4">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-blue-50 text-moss">
            <CartIcon />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="cart-title" className="text-lg font-bold">
              即时购物车
            </h2>
            <p className="text-xs text-ink/50">{cart.count} 件待确认</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭购物车"
            className="grid h-11 w-11 place-items-center rounded-full bg-fog"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {cart.items.length === 0 ? (
            <p className="rounded-2xl bg-fog/60 p-10 text-center text-sm text-ink/50">
              购物车还是空的
            </p>
          ) : (
            cart.items.map((item) => {
              const title =
                language === "original"
                  ? item.titleRaw
                  : (translations[`${item.id}:title`] ??
                    item.titleZh ??
                    item.product?.titleZh ??
                    item.titleRaw);
              return (
                <article
                  key={`cart-${item.id}`}
                  className="grid grid-cols-[72px_minmax(0,1fr)_44px] items-center gap-3 rounded-2xl border border-ink/8 p-2"
                >
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className="h-[72px] overflow-hidden rounded-xl bg-fog"
                    aria-label={`查看 ${title}`}
                  >
                    {item.images[0] ? (
                      <img
                        src={item.images[0].url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className="min-w-0 text-left"
                  >
                    <h3 className="line-clamp-2 text-xs font-semibold leading-5">
                      {title}
                    </h3>
                    <p className="mt-1 font-mono text-sm font-bold text-rust">
                      {fmtYen(item.priceCurrent)}
                    </p>
                    <p className="font-mono text-[10px] text-ink/45">
                      {fmtCny(item.priceCurrent, exchangeRate)} ·{" "}
                      {sourceName(item.source.key, item.source.displayName)}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(item.id)}
                    aria-label={`移出购物车：${title}`}
                    className="grid h-11 w-11 place-items-center rounded-full bg-fog text-ink/60"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </article>
              );
            })
          )}
        </div>
        <div className="border-t border-ink/8 p-4">
          <div className="mb-3 flex items-end justify-between gap-3">
            <span className="text-xs text-ink/50">商品与已知邮费合计</span>
            <div className="text-right">
              <b className="block font-mono text-lg">{fmtYen(total)}</b>
              <span className="font-mono text-[10px] text-ink/45">
                {fmtCny(total, exchangeRate)}
              </span>
            </div>
          </div>
          <button
            type="button"
            disabled={!cart.count || sharing}
            onClick={onShare}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#0071e3] px-4 text-sm font-bold text-white disabled:opacity-40"
          >
            <ShareIcon /> {sharing ? "正在生成…" : "分享购物车确认页"}
          </button>
          {message && (
            <p
              className="mt-2 text-center text-xs text-ink/55"
              aria-live="polite"
            >
              {message}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function FavoriteMiniCard({
  item,
  language,
  translatedTitle,
  exchangeRate,
  onOpen,
}: {
  item: Item;
  language: "zh" | "original";
  translatedTitle?: string;
  exchangeRate?: number;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="favorite-mini-card grid min-h-[84px] w-full grid-cols-[64px_1fr_auto] items-center gap-3 rounded-xl bg-white p-2 text-left shadow-sm"
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
          {language === "zh"
            ? (translatedTitle ??
              item.product?.titleZh ??
              translateText(item.titleRaw) ??
              item.titleRaw)
            : item.titleRaw}
        </span>
        <span className="mt-1 flex gap-2 font-mono text-[10px] text-ink/55">
          <b className="text-rust">{fmtYen(item.priceCurrent)}</b>
          <span className="text-[9px] text-ink/45">
            {fmtCny(item.priceCurrent, exchangeRate)}
          </span>
          <span>{sourceName(item.source.key)}</span>
        </span>
      </span>
      <HeartIcon filled className="h-4 w-4 text-moss" />
    </button>
  );
}

function FavoritesWorkspace({
  apiBaseUrl,
  language,
  exchangeRate,
  onOpenItem,
}: {
  apiBaseUrl: string;
  language: "zh" | "original";
  exchangeRate?: number;
  onOpenItem: (item: Item) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(
    async (nextOffset = 0, append = false) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `${apiBaseUrl}/items?favorite=true&limit=100&offset=${nextOffset}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`API ${response.status}`);
        const payload = (await response.json()) as {
          items?: Item[];
          total?: number;
        };
        setItems((current) =>
          append
            ? [...current, ...(payload.items ?? [])]
            : (payload.items ?? []),
        );
        setTotal(payload.total ?? 0);
        setOffset(nextOffset + (payload.items?.length ?? 0));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "收藏加载失败");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [apiBaseUrl],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section
      className="favorites-workspace portal-page"
      aria-labelledby="favorites-title"
    >
      <div className="portal-heading">
        <h2 id="favorites-title">收藏</h2>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-rust p-3 text-xs font-bold text-white"
        >
          {error}
        </p>
      )}
      {loading ? (
        <p className="mt-6 rounded-2xl border border-dashed border-black/10 p-8 text-center text-sm text-ink/45">
          正在读取收藏…
        </p>
      ) : items.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-black/10 p-8 text-center text-sm text-ink/45">
          还没有收藏商品
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item) => (
              <FavoriteMiniCard
                key={item.id}
                item={item}
                language={language}
                translatedTitle={item.titleZh ?? undefined}
                exchangeRate={exchangeRate}
                onOpen={() => onOpenItem(item)}
              />
            ))}
          </div>
          {offset < total && (
            <button
              type="button"
              onClick={() => void load(offset, true)}
              disabled={loadingMore}
              className="mt-4 min-h-11 w-full rounded-xl border border-black/10 bg-white text-sm font-semibold text-ink disabled:opacity-50"
            >
              {loadingMore ? "正在加载…" : `加载更多 · ${total - offset} 件`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function MarketAnalysisDialog({
  analysis,
  loading,
  error,
  language,
  translations,
  onStart,
  onOpenItem,
  onClose,
  exchangeRate,
}: {
  analysis: MarketAnalysis | null;
  loading: boolean;
  error: string;
  language: "zh" | "original";
  translations: Record<string, string>;
  onStart: () => void;
  onOpenItem: (id: string) => void;
  onClose: () => void;
  exchangeRate?: number;
}) {
  const itemTitle = (item: Item) =>
    language === "zh"
      ? (translations[`${item.id}:title`] ??
        item.titleZh ??
        translateText(item.titleRaw) ??
        item.titleRaw)
      : item.titleRaw;
  return (
    <div
      className="modal-backdrop fixed inset-0 z-[75] grid place-items-center bg-ink/45 p-3 backdrop-blur-sm sm:p-5"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="market-analysis-title"
        className="modal-panel max-h-[82dvh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-paper p-4 shadow-modal sm:p-5"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-moss">
              <AnalysisIcon className="h-5 w-5" />
              <h2
                id="market-analysis-title"
                className="text-lg font-bold text-ink"
              >
                AI 采购分析
              </h2>
            </div>
            <p className="mt-1 text-xs leading-5 text-ink/55">
              仅在你点击开始后，AI Gateway 才读取当前在售库并生成分析。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭 AI 分析"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-ink shadow-sm"
          >
            <CloseIcon />
          </button>
        </div>

        {!analysis && !loading && !error && (
          <div className="mt-5 rounded-2xl bg-white p-4 text-center shadow-sm">
            <p className="text-sm leading-6 text-ink/65">
              分析会综合真实平台、拍卖或直购、价格、运费、数量、品相、卖家描述和结束时间，不生成评分。
            </p>
            <button
              type="button"
              onClick={onStart}
              className="mt-4 min-h-11 rounded-xl bg-moss px-5 text-sm font-semibold text-white"
            >
              开始分析
            </button>
          </div>
        )}
        {loading && (
          <div
            className="mt-5 grid min-h-36 place-items-center rounded-2xl bg-white p-5 text-center shadow-sm"
            aria-live="polite"
          >
            <div>
              <span className="mx-auto block h-6 w-6 animate-spin rounded-full border-2 border-moss/20 border-t-moss" />
              <p className="mt-3 text-sm font-semibold text-ink">
                正在读取当前在售商品并分析
              </p>
              <p className="mt-1 text-xs text-ink/50">
                窗口可以保持打开，完成后会直接显示可点击商品。
              </p>
            </div>
          </div>
        )}
        {error && !loading && (
          <div
            role="alert"
            className="mt-5 rounded-2xl bg-rust/10 p-4 text-sm text-rust"
          >
            <p>{error}</p>
            <button
              type="button"
              onClick={onStart}
              className="mt-3 min-h-11 rounded-xl bg-rust px-4 text-xs font-semibold text-white"
            >
              重新分析
            </button>
          </div>
        )}
        {analysis && !loading && (
          <div className="mt-5 space-y-4">
            <p className="rounded-2xl bg-white p-4 text-sm leading-6 text-ink/75 shadow-sm">
              {analysis.recommendation}
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                ["性价比", analysis.bestValue],
                ["数量", analysis.largestQuantity],
                ["品相", analysis.bestCondition],
              ].map(([label, item]) => (
                <button
                  key={label as string}
                  type="button"
                  disabled={!item}
                  onClick={() => item && onOpenItem((item as Item).id)}
                  className="min-h-24 rounded-2xl bg-white p-3 text-left shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:opacity-45"
                >
                  <span className="text-[11px] font-semibold text-moss">
                    {label as string}
                  </span>
                  <b className="mt-1 block line-clamp-2 text-xs leading-5 text-ink">
                    {item ? itemTitle(item as Item) : "暂无可靠结果"}
                  </b>
                  {item && (
                    <span className="mt-1 block font-mono text-[10px] text-ink/50">
                      {sourceName(
                        (item as Item).source.key,
                        (item as Item).source.displayName,
                      )}{" "}
                      · {fmtYen((item as Item).priceCurrent)}
                      <span className="ml-1 text-[9px] text-ink/40">
                        {fmtCny((item as Item).priceCurrent, exchangeRate)}
                      </span>
                    </span>
                  )}
                </button>
              ))}
            </div>
            {analysis.rankedRecommendations?.length > 0 && (
              <section aria-labelledby="analysis-ranking-title">
                <h3
                  id="analysis-ranking-title"
                  className="text-sm font-bold text-ink"
                >
                  采购优先顺序
                </h3>
                <div className="mt-2 grid gap-2">
                  {analysis.rankedRecommendations.map((entry, index) => (
                    <button
                      key={entry.item.id}
                      type="button"
                      onClick={() => onOpenItem(entry.item.id)}
                      className="grid min-h-16 grid-cols-[28px_1fr_auto] items-center gap-2 rounded-xl bg-white p-3 text-left shadow-sm transition-colors hover:bg-fog/60"
                    >
                      <span className="font-mono text-xs font-bold text-moss">
                        {index + 1}
                      </span>
                      <span className="min-w-0">
                        <b className="block truncate text-xs text-ink">
                          {itemTitle(entry.item)}
                        </b>
                        <span className="mt-0.5 block line-clamp-2 text-[11px] leading-4 text-ink/55">
                          {entry.reason}
                        </span>
                      </span>
                      <span className="font-mono text-[10px] text-rust">
                        {fmtYen(entry.item.priceCurrent)}
                        <span className="ml-1 text-[9px] text-ink/40">
                          {fmtCny(entry.item.priceCurrent, exchangeRate)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <section className="rounded-2xl bg-white p-4 shadow-sm">
                <h3 className="text-xs font-bold text-ink">市场发现</h3>
                <ul className="mt-2 space-y-2 text-xs leading-5 text-ink/65">
                  {analysis.insights?.map((text, index) => (
                    <li key={index}>{text}</li>
                  ))}
                </ul>
              </section>
              <section className="rounded-2xl bg-white p-4 shadow-sm">
                <h3 className="text-xs font-bold text-ink">需要核验</h3>
                <ul className="mt-2 space-y-2 text-xs leading-5 text-ink/65">
                  {analysis.risks?.map((text, index) => (
                    <li key={index}>{text}</li>
                  ))}
                </ul>
              </section>
            </div>
            <div className="flex items-center justify-between gap-3 text-[10px] text-ink/45">
              <span>
                {analysis.engineLabel} · {analysis.sampleSize} 件
              </span>
              <button
                type="button"
                onClick={onStart}
                className="min-h-11 rounded-xl border border-ink/10 bg-white px-3 font-semibold text-moss"
              >
                重新分析
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function SellerDirectory({
  apiBaseUrl,
  onOpenSeller,
}: {
  apiBaseUrl: string;
  onOpenSeller: (sellerId: string) => void;
}) {
  const [sellers, setSellers] = useState<SellerSummary[]>([]);
  const [search, setSearch] = useState("");
  const [sellerPage, setSellerPage] = useState(1);
  const [sellerPageCount, setSellerPageCount] = useState(1);
  const [sellerTotal, setSellerTotal] = useState(0);
  const [segments, setSegments] = useState<SellerSegment[]>([]);
  const [activeSegment, setActiveSegment] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(
    async (
      query: string,
      nextPage = 1,
      append = false,
      segment = activeSegment,
    ) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          page: String(nextPage),
          limit: "60",
        });
        if (query.trim()) params.set("search", query.trim());
        if (segment) params.set("segment", segment);
        const response = await fetch(
          `${apiBaseUrl}/items/sellers?${params.toString()}`,
          {
            cache: "no-store",
          },
        );
        if (!response.ok) throw new Error(`API ${response.status}`);
        const data = (await response.json()) as {
          sellers?: SellerSummary[];
          segments?: SellerSegment[];
          activeSegment?: string | null;
          total?: number;
          page?: number;
          pageCount?: number;
        };
        setSellers((current) =>
          append ? [...current, ...(data.sellers ?? [])] : (data.sellers ?? []),
        );
        setSegments(data.segments ?? []);
        setActiveSegment(data.activeSegment ?? segment);
        setSellerTotal(data.total ?? 0);
        setSellerPage(data.page ?? nextPage);
        setSellerPageCount(data.pageCount ?? 1);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "商家目录加载失败");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [activeSegment, apiBaseUrl],
  );
  useEffect(() => {
    const timer = window.setTimeout(
      () => void load(search, 1, false, activeSegment),
      220,
    );
    return () => window.clearTimeout(timer);
  }, [activeSegment, load, search]);
  const activeSegmentDefinition = segments.find(
    (segment) => segment.key === activeSegment,
  );
  return (
    <section
      className="seller-directory ios-surface mt-3 rounded-2xl border border-white/70 p-4 shadow-panel"
      aria-labelledby="seller-directory-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3
            id="seller-directory-heading"
            className="font-heading text-lg font-black"
          >
            商家目录
          </h3>
          <p className="mt-1 text-xs text-ink/55">
            已整合 {sellerTotal} 个公开卖家，按经营特征归为五类。
          </p>
        </div>
        <label className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <span className="sr-only">搜索商家</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索卖家名称"
            className="h-11 w-full rounded-xl border border-ink/10 bg-white/75 px-3 text-sm outline-none transition focus:border-moss/40"
          />
        </label>
      </div>
      {segments.length > 0 && (
        <div className="seller-segment-section mt-4">
          <div
            className="seller-segment-strip"
            role="group"
            aria-label="卖家群体分类"
          >
            <button
              type="button"
              aria-pressed={!activeSegment}
              onClick={() => setActiveSegment("")}
              className="seller-segment-chip"
            >
              全部
            </button>
            {segments.map((segment) => (
              <button
                key={segment.key}
                type="button"
                aria-pressed={activeSegment === segment.key}
                onClick={() => setActiveSegment(segment.key)}
                className="seller-segment-chip"
                title={segment.description}
              >
                <span>{segment.label}</span>
                <b>{segment.count ?? 0}</b>
              </button>
            ))}
          </div>
          {activeSegmentDefinition && (
            <p className="seller-segment-description" aria-live="polite">
              {activeSegmentDefinition.description}
            </p>
          )}
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-rust px-3 py-2 text-xs font-bold text-white"
        >
          {error}
        </p>
      )}
      {loading ? (
        <p className="mt-4 rounded-xl border border-dashed border-ink/10 p-6 text-center text-xs text-ink/50">
          正在读取商家…
        </p>
      ) : sellers.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-ink/10 p-6 text-center text-xs text-ink/50">
          暂无匹配商家
        </p>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sellers.map((seller) => (
            <button
              type="button"
              key={seller.id}
              onClick={() => onOpenSeller(seller.id)}
              className="seller-directory-card group min-w-0 rounded-xl bg-white p-3 text-left shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <b className="line-clamp-2 min-w-0 text-sm text-ink">
                  {seller.name}
                </b>
                <span className="shrink-0 rounded-full bg-moss/10 px-2 py-1 text-[10px] font-bold text-moss">
                  {seller._count.items} 件
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-ink/55">
                <span className="rounded-md bg-fog/80 px-1.5 py-1">
                  {sourceName(seller.source.key, seller.source.displayName)}
                </span>
                <span className="rounded-md bg-fog/80 px-1.5 py-1">
                  {seller.segment?.label ??
                    (seller.sellerType === "store"
                      ? "专业售卖"
                      : seller.sellerType === "individual"
                        ? "个人卖家"
                        : "待分析")}
                </span>
                {seller.locationText && (
                  <span className="rounded-md bg-fog/80 px-1.5 py-1">
                    {seller.locationText}
                  </span>
                )}
              </div>
              {seller.segment?.reasons?.[0] && (
                <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-ink/55">
                  {seller.segment.reasons[0]}
                </p>
              )}
              <span className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold text-moss opacity-75 transition group-hover:opacity-100">
                查看商家画像 <ExternalLinkIcon className="h-3 w-3" />
              </span>
            </button>
          ))}
        </div>
      )}
      {!loading && sellerPage < sellerPageCount && (
        <button
          type="button"
          onClick={() => void load(search, sellerPage + 1, true, activeSegment)}
          disabled={loadingMore}
          className="mt-3 min-h-10 w-full rounded-xl border border-moss/25 bg-moss/5 text-xs font-bold text-moss transition hover:bg-moss/10 disabled:opacity-50"
        >
          {loadingMore ? "正在加载…" : "加载更多商家"}
        </button>
      )}
    </section>
  );
}

function SellerProfileDialog({
  sellerId,
  onClose,
  onOpenItem,
  exchangeRate,
}: {
  sellerId: string;
  onClose: () => void;
  onOpenItem: (item: Item) => void;
  exchangeRate?: number;
}) {
  const [data, setData] = useState<SellerAnalysis | null>(null);
  const [targetPrice, setTargetPrice] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const load = useCallback(
    async (price?: string) => {
      setAnalyzing(true);
      setError("");
      try {
        const params = price?.trim()
          ? `?targetPrice=${encodeURIComponent(price.trim())}&page=1&limit=48`
          : "?page=1&limit=48";
        const response = await fetch(
          `${API}/analysis/seller/${sellerId}${params}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`API ${response.status}`);
        const next = (await response.json()) as SellerAnalysis;
        setData(next);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "商家分析失败");
      } finally {
        setLoading(false);
        setAnalyzing(false);
      }
    },
    [sellerId],
  );
  const loadMore = useCallback(async () => {
    if (!data || loadingMore || data.page >= data.pageCount) return;
    setLoadingMore(true);
    try {
      const nextPage = data.page + 1;
      const response = await fetch(
        `${API}/items/sellers/${sellerId}?page=${nextPage}&limit=${data.limit}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`API ${response.status}`);
      const next = (await response.json()) as {
        items?: Item[];
        page?: number;
        pageCount?: number;
        total?: number;
      };
      setData((current) =>
        current
          ? {
              ...current,
              items: [...current.items, ...(next.items ?? [])],
              page: next.page ?? nextPage,
              pageCount: next.pageCount ?? current.pageCount,
              total: next.total ?? current.total,
            }
          : current,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "商品加载失败");
    } finally {
      setLoadingMore(false);
    }
  }, [data, loadingMore, sellerId]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div
      className="modal-backdrop fixed inset-0 z-[80] grid place-items-center bg-ink/60 p-4"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="seller-profile-title"
        className="modal-panel max-h-[88dvh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-paper p-4 shadow-modal sm:p-5"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.2em] text-moss">
              商家画像
            </p>
            <h2
              id="seller-profile-title"
              className="mt-1 font-heading text-xl font-black"
            >
              {data?.seller.name ?? "正在读取商家…"}
            </h2>
            {data?.seller && (
              <p className="mt-1 text-xs text-ink/55">
                {sourceName(
                  data.seller.source.key,
                  data.seller.source.displayName,
                )}{" "}
                · {data.items.length} 件在售
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid h-11 w-11 place-items-center rounded-full border border-ink/15 bg-white text-ink hover:bg-fog"
          >
            <CloseIcon />
          </button>
        </div>
        {loading && (
          <p className="py-12 text-center text-sm font-bold text-ink/55">
            正在分析商家商品与描述…
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-rust p-3 text-sm font-bold text-white"
          >
            {error}
          </p>
        )}
        {data && (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.2fr]">
              <div className="rounded-xl border border-blue-100 bg-white p-4">
                <div className="text-xs font-bold text-ink/50">类型</div>
                <div className="mt-1 text-lg font-black text-moss">
                  {data.analysis.sellerType}
                </div>
                <p className="mt-3 text-sm leading-6 text-ink/75">
                  {data.analysis.profile}
                </p>
                {data.seller.locationText && (
                  <p className="mt-2 text-xs text-ink/55">
                    所在地：{data.seller.locationText}
                  </p>
                )}
                {data.seller.profileUrl && (
                  <a
                    href={data.seller.profileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-moss"
                  >
                    打开公开卖家页 <ExternalLinkIcon className="h-3 w-3" />
                  </a>
                )}
                {data.seller.sourceData &&
                  Object.keys(data.seller.sourceData).length > 0 && (
                    <details className="mt-3 rounded-xl border border-ink/10 bg-fog/35 p-2">
                      <summary className="cursor-pointer text-xs font-bold text-ink/65">
                        平台公开字段
                      </summary>
                      <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-4 text-ink/60">
                        {JSON.stringify(data.seller.sourceData, null, 2)}
                      </pre>
                    </details>
                  )}
              </div>
              <div className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-bold text-ink/55">砍价语录</div>
                  <span className="text-[10px] font-semibold text-moss">
                    {data.mode === "ai" ? "AI Gateway" : "规则建议"}
                  </span>
                </div>
                <p
                  lang="ja"
                  className="mt-3 whitespace-pre-wrap text-[15px] font-medium leading-7 text-ink"
                >
                  {data.analysis.negotiationJa ?? data.analysis.negotiation}
                </p>
                <p className="mt-3 border-t border-ink/8 pt-3 text-[11px] leading-5 text-ink/55">
                  {data.analysis.negotiationZh}
                </p>
                <div className="mt-4 flex gap-2">
                  <input
                    inputMode="numeric"
                    value={targetPrice}
                    onChange={(event) => setTargetPrice(event.target.value)}
                    placeholder="目标价（日元）"
                    className="h-11 min-w-0 flex-1 rounded-lg border border-ink/15 bg-fog/45 px-3 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void load(targetPrice)}
                    disabled={analyzing}
                    className="min-h-11 rounded-lg bg-moss px-3 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {analyzing ? "生成中" : "生成"}
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-5">
              <h3 className="font-heading text-sm font-black">
                该商家全部商品
              </h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.items.map((item) => {
                  const previewImage = item.images?.[0];
                  return (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => onOpenItem(item)}
                      className="flex min-w-0 items-center gap-3 rounded-xl border border-blue-100 bg-white p-2 text-left hover:border-moss/50"
                    >
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-ink">
                        {previewImage && (
                          <img
                            src={previewImage.url}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        )}
                      </div>
                      <span className="min-w-0">
                        <b className="line-clamp-2 text-xs leading-5">
                          {translateText(item.titleRaw)}
                        </b>
                        <span className="mt-1 block font-mono text-[10px] text-rust">
                          {fmtYen(item.priceCurrent)} ·{" "}
                          {item.listingType === "auction" ? "拍卖" : "直购"}
                        </span>
                        <span className="block font-mono text-[9px] text-ink/45">
                          {fmtCny(item.priceCurrent, exchangeRate)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {data.page < data.pageCount && (
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="mt-3 min-h-10 w-full rounded-xl border border-moss/25 bg-moss/5 text-xs font-bold text-moss transition hover:bg-moss/10 disabled:opacity-50"
                >
                  {loadingMore
                    ? "正在加载…"
                    : `加载更多（${data.items.length}/${data.total}）`}
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function DetailDrawer({
  item,
  language,
  translatedTitle,
  translatedDescription,
  translationError,
  onClose,
  onSaved,
  exchangeRate,
}: {
  item: Item;
  language: "zh" | "original";
  translatedTitle?: string;
  translatedDescription?: string;
  translationError?: string;
  onClose: () => void;
  onSaved: (item: Item) => void;
  exchangeRate?: number;
}) {
  const [showOriginal, setShowOriginal] = useState(language === "original");
  useEffect(() => setShowOriginal(language === "original"), [language]);
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
  const [aiFeedback, setAiFeedback] = useState<"correct" | "incorrect" | null>(
    null,
  );
  const purchaseAnalysis = (item.detailsZh ?? []).filter((field) =>
    field.path.startsWith("ai."),
  );
  const translatedPublicDetails = (item.detailsZh ?? []).filter(
    (field) => !field.path.startsWith("ai."),
  );
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
  async function submitAiFeedback(action: "correct" | "incorrect") {
    const previous = aiFeedback;
    setAiFeedback(action);
    try {
      const response = await fetch(`${API}/ai/feedback/${item.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error("feedback_failed");
    } catch {
      setAiFeedback(previous);
    }
  }
  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 grid place-items-center bg-ink/55 p-3 sm:p-6"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-drawer-title"
        className="modal-panel scrollbar-thin max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-paper shadow-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-ink/10 bg-paper/95 px-4 py-3 backdrop-blur sm:px-5">
          <button
            type="button"
            onClick={onClose}
            aria-label="返回商品列表"
            title="返回"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white shadow transition-colors hover:bg-fog"
          >
            <ArrowLeftIcon />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-black uppercase tracking-[.2em] text-moss">
              商品情报
            </div>
            <h2 id="detail-drawer-title" className="mt-1 text-lg font-black">
              商品详情
            </h2>
          </div>
          <button
            onClick={() => setShowOriginal((current) => !current)}
            aria-label={showOriginal ? "切换为中文" : "切换为原文"}
            title={showOriginal ? "中文" : "原文"}
            className="grid h-11 w-11 place-items-center rounded-full bg-white shadow transition-colors hover:bg-fog"
          >
            <TranslateIcon />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭详情"
            title="关闭"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white shadow transition-colors hover:bg-fog"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="p-5">
          <ImageGallery
            images={item.images}
            alt={
              showOriginal
                ? item.titleRaw
                : (translatedTitle ??
                  item.titleZh ??
                  translateText(item.titleRaw) ??
                  item.titleRaw)
            }
            className="mb-5 aspect-video w-full rounded-3xl bg-ink"
          />
          <h3 className="text-2xl font-black leading-tight">
            {showOriginal
              ? item.titleRaw
              : (translatedTitle ??
                item.titleZh ??
                item.product?.titleZh ??
                translateText(item.titleRaw) ??
                item.titleRaw)}
          </h3>
          <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-white p-4 text-sm shadow-sm sm:grid-cols-4">
            <div>
              <span className="block text-ink/45">当前价</span>
              <b>{fmtYen(item.priceCurrent)}</b>
              <span className="block font-mono text-[10px] text-ink/45">
                {fmtCny(item.priceCurrent, exchangeRate)}
              </span>
            </div>
            <div>
              <span className="block text-ink/45">邮费</span>
              <b>{shippingLabel(item)}</b>
              {item.shippingFee != null && (
                <span className="ml-1 font-mono text-[10px] text-ink/45">
                  {fmtCny(item.shippingFee, exchangeRate)}
                </span>
              )}
              {item.shippingZh && !showOriginal && (
                <span className="mt-1 block text-[10px] font-normal leading-4 text-ink/55">
                  {item.shippingZh}
                </span>
              )}
            </div>
            <div>
              <span className="block text-ink/45">预计到手</span>
              <b>{fmtYen(item.priceTotalEst)}</b>
              <span className="block font-mono text-[10px] text-ink/45">
                {fmtCny(item.priceTotalEst, exchangeRate)}
              </span>
            </div>
            <div>
              <span className="block text-ink/45">数量</span>
              <b>{item.quantityEst ?? "未知"}</b>
            </div>
          </div>
          {!showOriginal && translationError && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700"
            >
              完整 AI 翻译暂时失败：{translationError}
              。你仍可切换查看原文，稍后重新打开详情会自动重试。
            </p>
          )}
          {!showOriginal && item.translationStatus === "processing" && (
            <p className="mt-4 rounded-xl bg-blue-50 p-3 text-xs font-bold text-moss">
              AI Gateway 正在逐项翻译商品标题、正文、品相、运费与交易条件…
            </p>
          )}
          <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-ink/75">
            {showOriginal
              ? (item.descriptionRaw ?? "无详情描述")
              : (translatedDescription ??
                item.descriptionZh ??
                translateText(item.descriptionRaw) ??
                "无详情描述")}
          </p>
          {!showOriginal && item.conditionZh && (
            <div className="mt-4 rounded-2xl bg-white p-4 text-sm leading-6 shadow-sm">
              <span className="block text-xs font-bold text-ink/45">
                完整品相说明
              </span>
              <p className="mt-1 whitespace-pre-wrap text-ink/75">
                {item.conditionZh}
              </p>
            </div>
          )}
          {!showOriginal && purchaseAnalysis.length > 0 && (
            <section
              className="mt-4 rounded-2xl border border-moss/15 bg-white p-4 shadow-sm"
              aria-labelledby="purchase-analysis-title"
            >
              <div className="flex items-center justify-between gap-3">
                <h4
                  id="purchase-analysis-title"
                  className="text-sm font-bold text-ink"
                >
                  AI 采购解读
                </h4>
                <div className="flex gap-1" aria-label="AI 判断反馈">
                  <button
                    type="button"
                    onClick={() => void submitAiFeedback("correct")}
                    aria-label="AI 判断正确"
                    aria-pressed={aiFeedback === "correct"}
                    className={`grid h-11 w-11 place-items-center rounded-full text-base transition-colors ${aiFeedback === "correct" ? "bg-emerald-100" : "bg-fog"}`}
                  >
                    👍
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitAiFeedback("incorrect")}
                    aria-label="AI 判断错误"
                    aria-pressed={aiFeedback === "incorrect"}
                    className={`grid h-11 w-11 place-items-center rounded-full text-base transition-colors ${aiFeedback === "incorrect" ? "bg-red-100" : "bg-fog"}`}
                  >
                    👎
                  </button>
                </div>
              </div>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                {purchaseAnalysis.map((field) => (
                  <div key={field.path} className="rounded-xl bg-fog/55 p-3">
                    <dt className="text-[11px] font-semibold text-ink/50">
                      {field.labelZh ?? field.path}
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap text-xs leading-5 text-ink/75">
                      {field.valueZh}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {item.sourceData && Object.keys(item.sourceData).length > 0 && (
            <details className="mt-5 rounded-2xl border border-ink/10 bg-white/70 p-3">
              <summary className="cursor-pointer text-sm font-black text-ink/70">
                平台公开信息
              </summary>
              {!showOriginal && translatedPublicDetails.length ? (
                <dl className="mt-3 grid gap-2">
                  {translatedPublicDetails.map((field, index) => (
                    <div
                      key={`${field.path}-${index}`}
                      className="grid gap-1 rounded-xl bg-ink/[.04] p-3 sm:grid-cols-[minmax(120px,0.35fr)_1fr]"
                    >
                      <dt
                        className="break-words text-xs font-bold text-ink/50"
                        title={field.path}
                      >
                        {field.labelZh ?? field.path}
                      </dt>
                      <dd className="whitespace-pre-wrap break-words text-xs leading-5 text-ink/70">
                        {field.valueZh}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-ink/[.04] p-3 text-[11px] leading-5 text-ink/65">
                  {JSON.stringify(item.sourceData, null, 2)}
                </pre>
              )}
            </details>
          )}
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
                maxLength={10}
                onChange={(event) =>
                  setDraft({ ...draft, note: event.target.value.slice(0, 10) })
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
  translatedTitle,
  onClose,
  onSaved,
}: {
  item: Item;
  translatedTitle?: string;
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
    if (!file.type.startsWith("image/") || file.size > 3 * 1024 * 1024) {
      setMessage("仅支持不超过 3MB 的图片凭证");
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
      className="modal-backdrop fixed inset-0 z-[60] grid place-items-center bg-ink/60 p-4"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-dialog-title"
        className="modal-panel w-full max-w-lg rounded-3xl bg-paper p-5 shadow-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="purchase-dialog-title" className="mt-1 text-xl font-black">
              记录已购买商品
            </h2>
            <p className="mt-1 line-clamp-2 text-xs text-ink/60">
              {translatedTitle ??
                item.product?.titleZh ??
                translateText(item.titleRaw) ??
                item.titleRaw}
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
          购买金额
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
          购买凭证
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
          {saving ? "保存中…" : "确认购买"}
        </button>
      </section>
    </div>
  );
}

function IgnoreConfirmationDialog({
  item,
  translatedTitle,
  onCancel,
  onConfirm,
}: {
  item: Item;
  translatedTitle?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  async function confirm() {
    setSaving(true);
    try {
      await onConfirm();
      onCancel();
    } finally {
      setSaving(false);
    }
  }
  return (
    <div
      className="modal-backdrop fixed inset-0 z-[70] grid place-items-center bg-ink/60 p-4"
      onMouseDown={saving ? undefined : onCancel}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ignore-dialog-title"
        aria-describedby="ignore-dialog-description"
        className="modal-panel w-full max-w-sm rounded-3xl bg-paper p-5 shadow-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="grid h-11 w-11 place-items-center rounded-full bg-rust/10 text-rust">
          <ArchiveIcon className="h-5 w-5" />
        </div>
        <h2 id="ignore-dialog-title" className="mt-4 text-lg font-black">
          移入不感兴趣？
        </h2>
        <p
          id="ignore-dialog-description"
          className="mt-2 line-clamp-2 text-sm leading-6 text-ink/60"
        >
          {translatedTitle ?? item.product?.titleZh ?? item.titleRaw}
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            autoFocus
            disabled={saving}
            onClick={onCancel}
            className="min-h-11 rounded-lg border border-ink/15 bg-white px-4 text-sm font-bold text-ink transition-colors hover:bg-fog disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void confirm()}
            className="min-h-11 rounded-lg bg-rust px-4 text-sm font-black text-white transition-colors hover:bg-rust/90 disabled:opacity-50"
          >
            {saving ? "处理中…" : "确认移入"}
          </button>
        </div>
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
  const [listingCounts, setListingCounts] = useState({
    auction: 0,
    direct: 0,
  });
  const [page, setPage] = useState(1);
  const [overview, setOverview] = useState<MonitoringOverview | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [serverOffset, setServerOffset] = useState(0);
  const [nowTick, setNowTick] = useState(0);
  const [selected, setSelected] = useState<Item | null>(null);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [urlMessage, setUrlMessage] = useState("");
  const [urlSubmitting, setUrlSubmitting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [language, setLanguage] = useState<"zh" | "original">("zh");
  const [listingMode, setListingMode] = useState<"all" | "auction" | "direct">(
    "all",
  );
  const [workspace, setWorkspace] = useState<Workspace>("inventory");
  const [workspaceTrail, setWorkspaceTrail] = useState<Workspace[]>([]);
  const workspaceScrollRef = useRef(new Map<Workspace, number>());
  const [imports, setImports] = useState<UrlImport[]>([]);
  const [linkItems, setLinkItems] = useState<Item[]>([]);
  const [linkTotal, setLinkTotal] = useState(0);
  const [linkPage, setLinkPage] = useState(1);
  const [linkPageCount, setLinkPageCount] = useState(1);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [analysis, setAnalysis] = useState<MarketAnalysis | null>(null);
  const [reviews, setReviews] = useState<ReviewQueueEntry[]>([]);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [reviewActionId, setReviewActionId] = useState<string | null>(null);
  const [purchaseItem, setPurchaseItem] = useState<Item | null>(null);
  const [ignoreItem, setIgnoreItem] = useState<Item | null>(null);
  const [dislikedItems, setDislikedItems] = useState<Item[]>([]);
  const [dislikedTotal, setDislikedTotal] = useState(0);
  const [dislikedPage, setDislikedPage] = useState(1);
  const [dislikedPageCount, setDislikedPageCount] = useState(1);
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null);
  const [cart, setCart] = useState<CartPayload>({
    cartId: "",
    items: [],
    count: 0,
    updatedAt: "",
  });
  const [cartOpen, setCartOpen] = useState(false);
  const [cartSharing, setCartSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const [purchaseGallery, setPurchaseGallery] = useState<Item | null>(null);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translationErrors, setTranslationErrors] = useState<
    Record<string, string>
  >({});
  const translationRequestedRef = useRef(new Set<string>());
  const changeCursorRef = useRef(new Date().toISOString());
  const changeSyncInFlightRef = useRef(false);
  const itemsRef = useRef<Item[]>([]);
  const itemSignature = [...items, ...linkItems]
    .map((item) => item.id)
    .join("|");

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

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

  const requestTranslations = useCallback(
    async (sourceItems: Item[], includeDescriptions = false) => {
      const jobs: { key: string; text: string; itemId?: string }[] = [];
      for (const item of sourceItems) {
        const candidates = [
          ...(item.titleZh
            ? []
            : [
                {
                  key: `${item.id}:title`,
                  text: item.titleRaw,
                  itemId: item.id,
                },
              ]),
          ...(includeDescriptions
            ? [
                {
                  key: `${item.id}:description`,
                  // Keep the complete public description for AI Gateway. The
                  // API validates a 12k-character ceiling; we only skip an
                  // empty value here.
                  text: item.descriptionRaw ?? "",
                },
              ]
            : []),
        ];
        for (const candidate of candidates) {
          if (
            candidate.text.trim() &&
            !translationRequestedRef.current.has(candidate.key)
          ) {
            translationRequestedRef.current.add(candidate.key);
            jobs.push(candidate);
          }
        }
      }
      if (!jobs.length) return;
      for (let start = 0; start < jobs.length; start += 12) {
        const batch = jobs.slice(start, start + 12);
        try {
          const response = await fetch(`${API}/analysis/translate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              texts: batch.map((job) => job.text),
              ...(batch.every((job) => job.itemId)
                ? { itemIds: batch.map((job) => job.itemId) }
                : {}),
            }),
          });
          if (!response.ok)
            throw new Error(`translation API ${response.status}`);
          const data = (await response.json()) as { translations?: string[] };
          const translated = data.translations ?? [];
          setTranslations((current) => {
            const next = { ...current };
            batch.forEach((job, index) => {
              const value = translated[index]?.trim();
              if (value) next[job.key] = value;
            });
            return next;
          });
        } catch {
          batch.forEach((job) =>
            translationRequestedRef.current.delete(job.key),
          );
        }
      }
    },
    [],
  );

  const requestFullItemTranslation = useCallback(async (item: Item) => {
    const key = `${item.id}:complete`;
    if (
      item.translationStatus === "completed" ||
      translationRequestedRef.current.has(key)
    )
      return;
    translationRequestedRef.current.add(key);
    setSelected((current) =>
      current?.id === item.id
        ? { ...current, translationStatus: "processing" }
        : current,
    );
    try {
      const response = await fetch(`${API}/analysis/item/${item.id}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`API ${response.status}`);
      const payload = (await response.json()) as {
        translation?: Partial<Item>;
      };
      if (!payload.translation) throw new Error("翻译结果为空");
      const translated = payload.translation;
      setTranslations((current) => ({
        ...current,
        ...(translated.titleZh
          ? { [`${item.id}:title`]: translated.titleZh }
          : {}),
        ...(translated.descriptionZh
          ? { [`${item.id}:description`]: translated.descriptionZh }
          : {}),
      }));
      setTranslationErrors((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, ...translated } : entry,
        ),
      );
      setLinkItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, ...translated } : entry,
        ),
      );
      setSelected((current) =>
        current?.id === item.id ? { ...current, ...translated } : current,
      );
    } catch (reason) {
      translationRequestedRef.current.delete(key);
      const message =
        reason instanceof Error ? reason.message : "翻译服务不可用";
      setTranslationErrors((current) => ({ ...current, [item.id]: message }));
      setSelected((current) =>
        current?.id === item.id
          ? { ...current, translationStatus: "failed" }
          : current,
      );
    }
  }, []);

  useEffect(() => {
    if (selected) void requestFullItemTranslation(selected);
  }, [requestFullItemTranslation, selected]);

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
    },
    {
      scope: dashboardRef,
      dependencies: [filtersOpen],
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
      const entranceNodes = nodes.slice(0, 8);
      entranceNodes.forEach((node) =>
        animatedItemIdsRef.current.add(node.dataset.itemId ?? ""),
      );
      if (
        !nodes.length ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        return;
      gsap.fromTo(
        entranceNodes,
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
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String((page - 1) * PAGE_SIZE));
      if (listingMode !== "all") params.set("listingType", listingMode);
      const response = await fetch(`${API}/items?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`API ${response.status}`);
      const data = await response.json();
      const nextItems = data.items as Item[];
      setItems(nextItems);
      setTotal(data.total);
      setListingCounts(
        data.facets ?? {
          auction: nextItems.filter((item) => item.listingType === "auction")
            .length,
          direct: nextItems.filter((item) => item.listingType === "direct")
            .length,
        },
      );
      void requestTranslations(nextItems);
      const lastPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
      if (page > lastPage) setPage(lastPage);
      setServerOffset(new Date(data.serverTime).getTime() - Date.now());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [filters, listingMode, page, requestTranslations]);

  const loadImports = useCallback(async () => {
    try {
      const response = await fetch(`${API}/imports`, { cache: "no-store" });
      if (response.ok) setImports((await response.json()).imports ?? []);
    } catch {}
  }, []);
  const loadLinkItems = useCallback(
    async (requestedPage = linkPage) => {
      const safePage = Math.max(1, requestedPage);
      try {
        const response = await fetch(
          `${API}/items?importOrigin=url&limit=${AUXILIARY_PAGE_SIZE}&offset=${(safePage - 1) * AUXILIARY_PAGE_SIZE}`,
          { cache: "no-store" },
        );
        if (response.ok) {
          const payload = (await response.json()) as {
            items?: Item[];
            total?: number;
          };
          const nextItems = (payload.items ?? []) as Item[];
          setLinkItems(nextItems);
          const nextTotal = payload.total ?? nextItems.length;
          const nextPageCount = Math.max(
            1,
            Math.ceil(nextTotal / AUXILIARY_PAGE_SIZE),
          );
          setLinkTotal(nextTotal);
          setLinkPageCount(nextPageCount);
          setLinkPage(Math.min(safePage, nextPageCount));
          void requestTranslations(nextItems);
        }
      } catch {}
    },
    [linkPage, requestTranslations],
  );
  const loadExchangeRate = useCallback(async () => {
    try {
      const response = await fetch(`${API}/exchange-rate`, {
        cache: "no-store",
      });
      if (response.ok) setExchangeRate((await response.json()) as ExchangeRate);
    } catch {}
  }, []);
  const loadCart = useCallback(async () => {
    try {
      const response = await fetch(`${API}/cart`, { cache: "no-store" });
      if (response.ok) {
        const next = (await response.json()) as CartPayload;
        setCart(next);
        void requestTranslations(next.items);
      }
    } catch {}
  }, [requestTranslations]);
  const loadDisliked = useCallback(
    async (requestedPage = dislikedPage) => {
      const safePage = Math.max(1, requestedPage);
      try {
        const response = await fetch(
          `${API}/items?ignored=true&limit=${AUXILIARY_PAGE_SIZE}&offset=${(safePage - 1) * AUXILIARY_PAGE_SIZE}`,
          {
            cache: "no-store",
          },
        );
        if (response.ok) {
          const payload = (await response.json()) as {
            items?: Item[];
            total?: number;
          };
          const nextItems = (payload.items ?? []) as Item[];
          setDislikedItems(nextItems.filter((item) => item.ignored));
          const nextTotal = payload.total ?? nextItems.length;
          const nextPageCount = Math.max(
            1,
            Math.ceil(nextTotal / AUXILIARY_PAGE_SIZE),
          );
          setDislikedTotal(nextTotal);
          setDislikedPageCount(nextPageCount);
          setDislikedPage(Math.min(safePage, nextPageCount));
          void requestTranslations(nextItems);
        }
      } catch {}
    },
    [dislikedPage, requestTranslations],
  );
  const loadPurchases = useCallback(async () => {
    try {
      const response = await fetch(`${API}/items/purchases`, {
        cache: "no-store",
      });
      if (response.ok) {
        const nextPurchases = ((await response.json()).purchases ??
          []) as PurchaseRecord[];
        setPurchases(nextPurchases);
        void requestTranslations(
          nextPurchases.map((purchase) => purchase.item),
        );
      }
    } catch {}
  }, [requestTranslations]);
  const loadAnalysis = useCallback(async () => {
    setAnalysisLoading(true);
    setAnalysisError("");
    try {
      const response = await fetch(`${API}/analysis/market`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`分析服务返回 ${response.status}`);
      const nextAnalysis = (await response.json()) as MarketAnalysis;
      setAnalysis(nextAnalysis);
      const highlights = [
        nextAnalysis.bestValue,
        nextAnalysis.largestQuantity,
        nextAnalysis.bestCondition,
        ...(nextAnalysis.rankedRecommendations ?? []).map(
          (entry) => entry.item,
        ),
      ].filter((item): item is Item => Boolean(item));
      void requestTranslations(highlights);
    } catch (reason) {
      setAnalysisError(
        reason instanceof Error ? reason.message : "AI 分析暂时不可用",
      );
    } finally {
      setAnalysisLoading(false);
    }
  }, [requestTranslations]);
  const loadReviews = useCallback(async () => {
    try {
      const response = await fetch(`${API}/items/reviews/pending`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = await response.json();
      setReviews(data.reviews ?? []);
      setReviewTotal(data.total ?? 0);
      void requestTranslations(
        (data.reviews ?? []).map((review: ReviewQueueEntry) => review.item),
      );
    } catch {}
  }, [requestTranslations]);

  const syncChanges = useCallback(async () => {
    if (changeSyncInFlightRef.current || document.visibilityState === "hidden")
      return;
    changeSyncInFlightRef.current = true;
    try {
      const since = encodeURIComponent(changeCursorRef.current);
      const response = await fetch(`${API}/items/changes?since=${since}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as {
        changes?: Pick<
          Item,
          | "id"
          | "favorite"
          | "ignored"
          | "ignoredAt"
          | "archivedAt"
          | "note"
          | "updatedAt"
        >[];
        serverTime?: string;
      };
      if (data.serverTime) changeCursorRef.current = data.serverTime;
      const changes = data.changes ?? [];
      if (!changes.length) return;
      const merge = (current: Item[]) =>
        current
          .map((item) => {
            const changed = changes.find((entry) => entry.id === item.id);
            return changed ? { ...item, ...changed } : item;
          })
          .filter((item) => !item.ignored && !item.archivedAt);
      setItems(merge);
      setLinkItems(merge);
      setDislikedItems((current) => {
        const next = current
          .map((item) => {
            const changed = changes.find((entry) => entry.id === item.id);
            return changed ? { ...item, ...changed } : item;
          })
          .filter((item) => item.ignored && !item.archivedAt);
        for (const changed of changes) {
          if (
            changed.ignored &&
            !changed.archivedAt &&
            !next.some((item) => item.id === changed.id)
          ) {
            const source = itemsRef.current.find(
              (item) => item.id === changed.id,
            );
            if (source) next.unshift({ ...source, ...changed });
          }
        }
        return next;
      });
      setSelected((current) => {
        if (!current) return current;
        const changed = changes.find((entry) => entry.id === current.id);
        return changed ? { ...current, ...changed } : current;
      });
    } finally {
      changeSyncInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => void load(), 250);
    return () => clearTimeout(timeout);
  }, [load]);
  useEffect(() => {
    void Promise.all([
      loadImports(),
      loadLinkItems(),
      loadDisliked(),
      loadPurchases(),
      loadReviews(),
    ]);
    const timer = setInterval(
      () =>
        void Promise.all([
          loadImports(),
          loadLinkItems(),
          loadDisliked(),
          loadPurchases(),
          loadReviews(),
        ]),
      30_000,
    );
    return () => clearInterval(timer);
  }, [loadImports, loadLinkItems, loadDisliked, loadPurchases, loadReviews]);
  useEffect(() => {
    void Promise.all([loadExchangeRate(), loadCart()]);
    const rateTimer = window.setInterval(
      () => void loadExchangeRate(),
      15 * 60_000,
    );
    const cartTimer = window.setInterval(() => void loadCart(), 2_000);
    return () => {
      window.clearInterval(rateTimer);
      window.clearInterval(cartTimer);
    };
  }, [loadCart, loadExchangeRate]);
  useEffect(() => {
    // Keep a short polling window so a collaborator's favorite/note appears
    // quickly even when the public tunnel is shared by separate browsers.
    const timer = window.setInterval(() => void syncChanges(), 2_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncChanges();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [syncChanges]);
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
    if (
      !filtersOpen &&
      !selected &&
      !purchaseItem &&
      !ignoreItem &&
      !settingsOpen &&
      !analysisOpen &&
      !sellerId &&
      !cartOpen &&
      !purchaseGallery
    )
      return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (filtersOpen) setFiltersOpen(false);
      else if (selected) setSelected(null);
      else if (purchaseItem) setPurchaseItem(null);
      else if (ignoreItem) setIgnoreItem(null);
      else if (analysisOpen) setAnalysisOpen(false);
      else if (settingsOpen) setSettingsOpen(false);
      else if (cartOpen) setCartOpen(false);
      else if (purchaseGallery) setPurchaseGallery(null);
      else setSellerId(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    analysisOpen,
    filtersOpen,
    ignoreItem,
    purchaseItem,
    selected,
    sellerId,
    settingsOpen,
    cartOpen,
    purchaseGallery,
  ]);
  useEffect(
    () => () => {
      if (analyzedUrlTimerRef.current != null)
        window.clearTimeout(analyzedUrlTimerRef.current);
    },
    [],
  );

  function changeFilter(name: string, value: string) {
    setPage(1);
    setFilters((current) => ({ ...current, [name]: value }));
  }
  function resetFilters() {
    setPage(1);
    setFilters({});
  }
  function changeListingMode(mode: "auction" | "direct") {
    setPage(1);
    setListingMode((current) => (current === mode ? "all" : mode));
  }
  function navigateWorkspace(next: Workspace) {
    if (next === workspace) return;
    workspaceScrollRef.current.set(workspace, window.scrollY);
    const nextState = navigateWorkspaceState(
      { workspace, trail: workspaceTrail },
      next,
    );
    setWorkspace(nextState.workspace);
    setWorkspaceTrail(nextState.trail);
    window.requestAnimationFrame(() =>
      window.scrollTo({ top: workspaceScrollRef.current.get(next) ?? 0 }),
    );
  }
  function goBackWorkspace() {
    const previousState = goBackWorkspaceState({
      workspace,
      trail: workspaceTrail,
    });
    if (previousState.workspace === workspace) return;
    workspaceScrollRef.current.set(workspace, window.scrollY);
    setWorkspace(previousState.workspace);
    setWorkspaceTrail(previousState.trail);
    window.requestAnimationFrame(() =>
      window.scrollTo({
        top: workspaceScrollRef.current.get(previousState.workspace) ?? 0,
      }),
    );
  }
  async function updateCart(itemId: string, present: boolean) {
    const previous = cart;
    const source =
      items.find((item) => item.id === itemId) ??
      linkItems.find((item) => item.id === itemId) ??
      cart.items.find((item) => item.id === itemId);
    if (present && source && !cart.items.some((item) => item.id === itemId))
      setCart({
        ...cart,
        items: [...cart.items, source],
        count: cart.count + 1,
      });
    if (!present)
      setCart({
        ...cart,
        items: cart.items.filter((item) => item.id !== itemId),
        count: Math.max(0, cart.count - 1),
      });
    try {
      const response = await fetch(`${API}/cart/items/${itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ present }),
      });
      if (!response.ok) throw new Error(`购物车保存失败（${response.status}）`);
      setCart((await response.json()) as CartPayload);
    } catch (reason) {
      setCart(previous);
      setError(reason instanceof Error ? reason.message : "购物车保存失败");
    }
  }
  async function shareItems(itemIds?: string[]) {
    setCartSharing(true);
    setShareMessage("");
    try {
      const response = await fetch(`${API}/cart/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(itemIds?.length ? { itemIds } : {}),
      });
      if (!response.ok)
        throw new Error(`读取原始链接失败（${response.status}）`);
      const result = (await response.json()) as {
        itemCount: number;
        primaryUrl: string;
        sourceUrls: string[];
      };
      const linksText =
        result.sourceUrls.length === 1
          ? result.sourceUrls[0]
          : result.sourceUrls
              .map((url, index) => `${index + 1}. ${url}`)
              .join("\n");
      const shareData: ShareData = {
        title:
          itemIds?.length === 1
            ? "假面采购 · 商品分享"
            : "假面采购 · 商品原链接",
        text:
          result.sourceUrls.length === 1
            ? "商品原始来源"
            : `${result.itemCount} 件商品原始来源：\n${linksText}`,
        ...(result.sourceUrls.length === 1 ? { url: result.primaryUrl } : {}),
      };
      if (navigator.share) {
        try {
          await navigator.share(shareData);
          setShareMessage("已打开系统分享面板，可选择微信");
          return;
        } catch (reason) {
          if (reason instanceof DOMException && reason.name === "AbortError") {
            setShareMessage("已取消分享");
            return;
          }
        }
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(linksText);
      } else {
        const helper = document.createElement("textarea");
        helper.value = linksText;
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.appendChild(helper);
        helper.select();
        document.execCommand("copy");
        helper.remove();
      }
      setShareMessage("商品原链接已复制，可粘贴到微信");
    } catch (reason) {
      setShareMessage(reason instanceof Error ? reason.message : "分享失败");
    } finally {
      setCartSharing(false);
    }
  }
  async function patchItem(id: string, patch: Partial<Item>) {
    const previous = items.find((item) => item.id === id);
    if (!previous) return;
    const optimistic = { ...previous, ...patch } as Item;
    const apply = (value: Item) => {
      setItems((current) =>
        current
          .map((item) => (item.id === id ? { ...item, ...value } : item))
          .filter((item) => !item.ignored && !item.archivedAt),
      );
      setLinkItems((current) =>
        current
          .map((item) => (item.id === id ? { ...item, ...value } : item))
          .filter((item) => !item.ignored && !item.archivedAt),
      );
      setDislikedItems((current) => {
        const next = current
          .map((item) => (item.id === id ? { ...item, ...value } : item))
          .filter((item) => item.ignored && !item.archivedAt);
        if (value.ignored && !next.some((item) => item.id === id))
          next.unshift({ ...previous, ...value });
        return next;
      });
      setSelected((current) =>
        current?.id === id ? { ...current, ...value } : current,
      );
    };
    apply(optimistic);
    try {
      const response = await fetch(`${API}/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...patch, actor: "dashboard-operator" }),
      });
      if (!response.ok) throw new Error(`保存失败（API ${response.status}）`);
      const updated = (await response.json()).item as Partial<Item>;
      apply({ ...optimistic, ...updated } as Item);
      if (updated.updatedAt) changeCursorRef.current = updated.updatedAt;
    } catch (reason) {
      apply(previous);
      setError(reason instanceof Error ? reason.message : "保存失败");
    }
  }

  async function openAnalysisItem(itemId: string): Promise<boolean> {
    const response = await fetch(`${API}/items/${itemId}`, {
      cache: "no-store",
    });
    if (!response.ok) return false;
    const data = await response.json();
    if (!data.item) return false;
    const item = data.item as Item;
    void requestTranslations([item]);
    setSelected(item);
    return true;
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
  const auctionItems = items.filter(
    (item) =>
      item.listingType === "auction" ||
      (!item.listingType && Boolean(item.auctionEndAt)),
  );
  const directItems = items.filter(
    (item) =>
      item.listingType === "direct" ||
      (!item.listingType && !item.auctionEndAt),
  );
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const pageEnd = Math.min(page * PAGE_SIZE, total);
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
  const navigationWorkspace:
    | "inventory"
    | "discovery"
    | "assistant"
    | "workbench"
    | "menu" =
    workspace === "assistant"
      ? "assistant"
      : workspace === "discovery"
        ? "discovery"
        : [
              "links",
              "purchases",
              "favorites",
              "sellers",
              "intel",
              "logistics",
              "workbench",
            ].includes(workspace)
          ? "workbench"
          : ["disliked", "reviews", "monitoring", "ai", "menu"].includes(
                workspace,
              )
            ? "menu"
            : "inventory";
  return (
    <main
      ref={dashboardRef}
      className={`ios-shell procurement-shell scanline min-h-dvh workspace-${workspace}`}
    >
      <a href="#inventory" className="skip-link">
        跳到商品列表
      </a>
      <header className="ios-header procurement-header">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            {workspaceTrail.length > 0 && (
              <button
                type="button"
                onClick={goBackWorkspace}
                aria-label="返回上一步"
                title="返回上一步"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/80 text-ink shadow-sm"
              >
                <ArrowLeftIcon />
              </button>
            )}
            <div className="brand-logo grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-black/15 bg-white text-black shadow-sm">
              <RiderLogo />
            </div>
            <div className="min-w-0">
              <h1 className="brand-name truncate font-heading text-base font-black tracking-tight sm:text-lg">
                假面采购
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
            {exchangeRate && (
              <span
                className="exchange-rate-chip flex min-h-11 items-center rounded-lg border border-ink/10 bg-white/60 px-3 font-mono text-[10px] tabular-nums"
                title={`${exchangeRate.source} · ${new Date(exchangeRate.referenceDate).toLocaleDateString("zh-CN")}${exchangeRate.warning ? ` · ${exchangeRate.warning}` : ""}`}
              >
                100 日元 ≈ ¥{(exchangeRate.rate * 100).toFixed(2)}
                {exchangeRate.stale ? " · 最近值" : ""}
              </span>
            )}
            <span className="monitor-status flex min-h-11 items-center gap-2 rounded-lg border border-ink/10 bg-white/60 px-3">
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
              aria-label={language === "zh" ? "切换为原文" : "切换为中文"}
              title={language === "zh" ? "原文" : "中文"}
              className="header-translate-button grid h-11 w-11 place-items-center rounded-lg border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/15"
            >
              <TranslateIcon />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen((current) => !current)}
              aria-label="设置"
              aria-expanded={settingsOpen}
              title="设置"
              className="header-settings-button grid h-11 w-11 place-items-center rounded-lg border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/15"
            >
              <SettingsIcon />
            </button>
          </div>
        </div>
      </header>

      {settingsOpen && (
        <div
          className="modal-backdrop settings-backdrop fixed inset-0 z-[70] grid place-items-center bg-ink/40 p-4"
          onMouseDown={() => setSettingsOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            className="modal-panel settings-dialog w-full max-w-sm rounded-3xl bg-paper p-3 shadow-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="settings-dialog-header flex items-center justify-between gap-3 px-2 pb-2">
              <h2 id="settings-title" className="text-base font-bold text-ink">
                设置
              </h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="关闭设置"
                className="grid h-11 w-11 place-items-center rounded-full bg-white text-ink shadow-sm"
              >
                <CloseIcon />
              </button>
            </div>
            <button
              type="button"
              onClick={() =>
                setLanguage((current) => (current === "zh" ? "original" : "zh"))
              }
              className="settings-row mb-1 flex min-h-12 w-full items-center gap-3 rounded-2xl bg-white px-3 text-left text-sm font-semibold text-ink shadow-sm"
            >
              <TranslateIcon />
              <span className="flex-1">显示语言</span>
              <span className="text-xs text-ink/50">
                {language === "zh" ? "中文" : "原文"}
              </span>
            </button>
            {(
              [
                ["disliked", "不感兴趣", dislikedItems.length, ArchiveIcon],
                ["reviews", "待确认", reviewTotal, InfoIcon],
                [
                  "monitoring",
                  "监控",
                  overview?.status === "attention" ? "!" : "",
                  SettingsIcon,
                ],
                ["ai", "AI System", "", AnalysisIcon],
                ["intel", "资讯专区", "", InfoIcon],
                ["logistics", "物流测算", "", BagIcon],
              ] as const
            ).map(([key, label, count, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  navigateWorkspace(key);
                  setSettingsOpen(false);
                }}
                className={`settings-row flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-sm font-semibold transition-colors hover:bg-white ${workspace === key ? "bg-white text-moss shadow-sm" : "text-ink"}`}
              >
                <Icon />
                <span className="flex-1">{label}</span>
                {count !== "" && (
                  <span className="font-mono text-[10px] text-ink/50">
                    {count}
                  </span>
                )}
              </button>
            ))}
          </section>
        </div>
      )}

      <div className="procurement-content mx-auto max-w-[1600px] px-4 py-4 pb-24 sm:px-5 lg:px-8">
        {workspace === "assistant" && (
          <AssistantChatWorkspace
            apiBaseUrl={API}
            exchangeRate={exchangeRate?.rate}
            onOpenItem={openAnalysisItem}
          />
        )}
        {workspace === "workbench" && (
          <section className="portal-page" aria-labelledby="workbench-title">
            <div className="portal-heading">
              <h2 id="workbench-title">工作台</h2>
            </div>
            <div className="portal-grid">
              {(
                [
                  ["links", "链接专区", LinkIcon],
                  ["purchases", "购买记录", ListIcon],
                  ["favorites", "收藏", HeartIcon],
                  ["sellers", "卖家", UsersIcon],
                  ["intel", "资讯专区", InfoIcon],
                  ["logistics", "物流测算", BagIcon],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => navigateWorkspace(key)}
                  className="portal-card"
                >
                  <span className="portal-card-icon">
                    <Icon />
                  </span>
                  <strong>{label}</strong>
                </button>
              ))}
            </div>
          </section>
        )}
        {workspace === "menu" && (
          <section
            className="portal-page menu-page"
            aria-labelledby="menu-title"
          >
            <div className="portal-heading">
              <h2 id="menu-title">菜单</h2>
            </div>
            <div className="menu-groups">
              <div className="menu-group">
                {(
                  [
                    ["disliked", "不感兴趣", ArchiveIcon],
                    ["reviews", "待确认", InfoIcon],
                  ] as const
                ).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => navigateWorkspace(key)}
                  >
                    <Icon />
                    <span>{label}</span>
                    <span className="menu-chevron">›</span>
                  </button>
                ))}
              </div>
              <div className="menu-group">
                {(
                  [
                    ["monitoring", "监控", SettingsIcon],
                    ["ai", "AI System", AnalysisIcon],
                  ] as const
                ).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => navigateWorkspace(key)}
                  >
                    <Icon />
                    <span>{label}</span>
                    <span className="menu-chevron">›</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}
        {workspace === "intel" && <MarketIntelWorkspace apiBaseUrl={API} />}
        {workspace === "ai" && <AiSystemWorkspace apiBaseUrl={API} />}
        {workspace === "logistics" && (
          <LogisticsWorkspace
            apiBaseUrl={API}
            exchangeRate={exchangeRate?.rate}
          />
        )}
        {workspace === "favorites" && (
          <FavoritesWorkspace
            apiBaseUrl={API}
            language={language}
            exchangeRate={exchangeRate?.rate}
            onOpenItem={(item) => setSelected(item)}
          />
        )}
        {workspace === "sellers" && (
          <SellerDirectory
            apiBaseUrl={API}
            onOpenSeller={(id) => setSellerId(id)}
          />
        )}
        {workspace === "discovery" && (
          <DiscoveryWorkspace
            apiBaseUrl={API}
            language={language}
            translations={Object.fromEntries(
              Object.entries(translations)
                .filter(([key]) => key.endsWith(":title"))
                .map(([key, value]) => [key.slice(0, -6), value]),
            )}
            exchangeRate={exchangeRate?.rate}
            onOpenDetail={openAnalysisItem}
            onFavoriteChange={() => void syncChanges()}
            interactionDisabled={Boolean(
              selected ||
                purchaseItem ||
                filtersOpen ||
                analysisOpen ||
                settingsOpen ||
                sellerId,
            )}
          />
        )}
        {workspace === "inventory" && (
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={() => setAnalysisOpen(true)}
              aria-haspopup="dialog"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-ink/10 bg-white px-3 text-xs font-semibold text-ink shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <AnalysisIcon className="h-4 w-4 text-moss" />
              AI 采购分析
              {analysis && (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-[#34c759]"
                  aria-label="已有分析结果"
                />
              )}
            </button>
          </div>
        )}
        {(workspace === "links" || workspace === "purchases") && (
          <section className="ios-surface workspace-surface mb-4 rounded-2xl border border-blue-100 p-4 shadow-panel">
            {workspace === "links" ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
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
                    已导入商品 · {linkTotal}
                  </h3>
                  <span className="text-[10px] text-ink/50">
                    链接来源不会进入收藏夹
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
                        translatedTitle={translations[`${item.id}:title`]}
                        onOpen={() => setSelected(item)}
                        onPatch={(patch) => void patchItem(item.id, patch)}
                        onIgnore={() => setIgnoreItem(item)}
                        onPurchase={() => setPurchaseItem(item)}
                        onSeller={(sellerId) => setSellerId(sellerId)}
                        exchangeRate={exchangeRate?.rate}
                        inCart={cart.items.some(
                          (entry) => entry.id === item.id,
                        )}
                        onCart={() =>
                          void updateCart(
                            item.id,
                            !cart.items.some((entry) => entry.id === item.id),
                          )
                        }
                        onShare={() => void shareItems([item.id])}
                      />
                    ))
                  )}
                </div>
                {linkTotal > 0 && linkPageCount > 1 && (
                  <nav
                    aria-label="链接商品分页"
                    className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-blue-100 bg-white px-3 py-2"
                  >
                    <span className="text-[10px] text-ink/50">
                      第 {linkPage} / {linkPageCount} 页 · 共 {linkTotal} 条
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={linkPage <= 1}
                        onClick={() => {
                          const next = Math.max(1, linkPage - 1);
                          setLinkPage(next);
                          void loadLinkItems(next);
                        }}
                        className="min-h-9 rounded-lg border border-blue-200 px-2.5 text-[10px] font-bold text-moss disabled:opacity-35"
                      >
                        上一页
                      </button>
                      <button
                        type="button"
                        disabled={linkPage >= linkPageCount}
                        onClick={() => {
                          const next = Math.min(linkPageCount, linkPage + 1);
                          setLinkPage(next);
                          void loadLinkItems(next);
                        }}
                        className="min-h-9 rounded-lg border border-blue-200 px-2.5 text-[10px] font-bold text-moss disabled:opacity-35"
                      >
                        下一页
                      </button>
                    </div>
                  </nav>
                )}
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-heading text-xl font-black">
                      购买记录 · {purchases.length} 件
                    </h2>
                    <p className="mt-1 font-mono text-sm font-bold text-rust">
                      总价{" "}
                      {fmtYen(
                        purchases.reduce(
                          (sum, purchase) => sum + purchase.purchaseAmount,
                          0,
                        ),
                      )}
                      <span className="ml-2 text-[10px] font-semibold text-ink/45">
                        {fmtCny(
                          purchases.reduce(
                            (sum, purchase) => sum + purchase.purchaseAmount,
                            0,
                          ),
                          exchangeRate?.rate,
                        )}
                      </span>
                    </p>
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
                <div className="mt-4 grid gap-2 md:hidden">
                  {purchases.length === 0 ? (
                    <p className="rounded-2xl bg-white p-8 text-center text-sm text-ink/50">
                      暂无购买记录
                    </p>
                  ) : (
                    purchases.map((purchase) => (
                      <article
                        key={`mobile-${purchase.id}`}
                        className="rounded-2xl bg-white p-3 shadow-sm"
                      >
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                          <div className="min-w-0">
                            <h3 className="line-clamp-2 text-xs font-semibold leading-5 text-ink">
                              {language === "zh"
                                ? (translations[`${purchase.item.id}:title`] ??
                                  purchase.item.product?.titleZh ??
                                  translateText(purchase.item.titleRaw) ??
                                  purchase.item.titleRaw)
                                : purchase.item.titleRaw}
                            </h3>
                            <p className="mt-1 font-mono text-base font-bold text-rust">
                              {fmtYen(purchase.purchaseAmount)}
                            </p>
                            <p className="font-mono text-[10px] text-ink/45">
                              {fmtCny(
                                purchase.purchaseAmount,
                                exchangeRate?.rate,
                              )}
                            </p>
                            <p className="text-[10px] text-ink/45">
                              {fmtDate(purchase.purchasedAt)}
                            </p>
                          </div>
                          <span
                            aria-label={
                              purchase.verifiedAt ? "已认证购买" : "未上传凭证"
                            }
                            title={
                              purchase.verifiedAt ? "已认证购买" : "未上传凭证"
                            }
                            className={`grid h-11 w-11 place-items-center rounded-full ${purchase.verifiedAt ? "bg-[#34c759]/12 text-[#248a3d]" : "bg-fog text-ink/30"}`}
                          >
                            <MoneyIcon />
                          </span>
                        </div>
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => setPurchaseGallery(purchase.item)}
                            aria-label="查看商品图片"
                            title="查看商品图片"
                            className="grid h-11 w-11 place-items-center rounded-full bg-fog text-moss"
                          >
                            <PhotoIcon />
                          </button>
                        </div>
                        {(purchase.note || purchase.receipts.length > 0) && (
                          <div className="mt-3 flex items-center justify-between gap-2 border-t border-ink/8 pt-2">
                            <span className="min-w-0 truncate text-[11px] text-ink/55">
                              {purchase.note || "无备注"}
                            </span>
                            <div className="flex shrink-0 gap-1">
                              {purchase.receipts.map((receipt) => (
                                <button
                                  key={receipt.id}
                                  type="button"
                                  onClick={() =>
                                    void viewReceipt(purchase, receipt.id)
                                  }
                                  aria-label={`查看购买凭证：${receipt.fileName}`}
                                  className="grid h-11 w-11 place-items-center rounded-full bg-fog text-moss"
                                >
                                  <MoneyIcon />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </article>
                    ))
                  )}
                </div>
                <div className="mt-4 hidden overflow-x-auto rounded-xl border border-ink/10 md:block">
                  <table className="w-full min-w-[680px] text-left text-xs">
                    <thead className="bg-fog/70 text-[10px] uppercase tracking-wide text-ink/55">
                      <tr>
                        <th className="p-3">商品</th>
                        <th className="p-3">购买金额</th>
                        <th className="p-3">购买时间</th>
                        <th className="p-3">认证</th>
                        <th className="p-3">备注</th>
                        <th className="p-3">凭证</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchases.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
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
                                  ? (translations[
                                      `${purchase.item.id}:title`
                                    ] ??
                                    purchase.item.product?.titleZh ??
                                    translateText(purchase.item.titleRaw) ??
                                    purchase.item.titleRaw)
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
                              <button
                                type="button"
                                onClick={() =>
                                  setPurchaseGallery(purchase.item)
                                }
                                title="查看商品图片"
                                aria-label="查看商品图片"
                                className="ml-2 inline-grid h-9 w-9 place-items-center rounded-full bg-fog text-moss align-middle"
                              >
                                <PhotoIcon className="h-4 w-4" />
                              </button>
                            </td>
                            <td className="p-3 font-mono font-black text-rust">
                              {fmtYen(purchase.purchaseAmount)}
                              <span className="ml-1 block text-[10px] font-semibold text-ink/45">
                                {fmtCny(
                                  purchase.purchaseAmount,
                                  exchangeRate?.rate,
                                )}
                              </span>
                            </td>
                            <td className="p-3 text-ink/60">
                              {fmtDate(purchase.purchasedAt)}
                            </td>
                            <td className="p-3">
                              {purchase.verifiedAt ? (
                                <span
                                  title="已认证购买"
                                  aria-label="已认证购买"
                                  className="grid h-9 w-9 place-items-center rounded-full bg-emerald-100 text-emerald-800"
                                >
                                  <MoneyIcon />
                                </span>
                              ) : (
                                <span
                                  title="未上传凭证"
                                  aria-label="未上传凭证"
                                  className="grid h-9 w-9 place-items-center rounded-full border border-ink/10 text-ink/30"
                                >
                                  <MoneyIcon />
                                </span>
                              )}
                            </td>
                            <td className="max-w-[220px] p-3 text-ink/60">
                              {purchase.note ? (
                                <span
                                  title={purchase.note}
                                  className="inline-flex max-w-full items-center gap-1 truncate"
                                >
                                  <CommentIcon className="h-4 w-4 shrink-0 text-moss" />
                                  <span className="truncate">
                                    {purchase.note}
                                  </span>
                                </span>
                              ) : (
                                "无"
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
                                      className="grid h-11 w-11 place-items-center rounded-md border border-moss/20 text-moss transition-colors hover:bg-moss/5"
                                    >
                                      <MoneyIcon className="h-4 w-4" />
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                "未上传"
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
            className="ios-surface js-shell-reveal rounded-2xl border border-blue-100 p-4 shadow-panel"
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
                          ? (translations[`${review.item.id}:title`] ??
                            review.item.product?.titleZh ??
                            translateText(review.item.titleRaw) ??
                            review.item.titleRaw)
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
                          {translations[`${review.item.id}:title`] ??
                            review.product?.titleZh ??
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
                      <p className="mt-2 text-[10px] leading-4 text-slate-500">
                        {review.reasons.join("；") ||
                          "请核对商品标题、图片和分类"}
                      </p>
                    </div>
                    <div className="flex gap-2 md:flex-col">
                      <button
                        type="button"
                        onClick={() => void openAnalysisItem(review.item.id)}
                        className="min-h-11 rounded-lg border border-blue-200 px-3 text-xs font-bold text-moss hover:bg-blue-50"
                      >
                        查看详情
                      </button>
                      <button
                        type="button"
                        disabled={reviewActionId === review.id}
                        onClick={() => void confirmReview(review)}
                        className="min-h-11 rounded-lg bg-moss px-3 text-xs font-black text-white hover:bg-blue-800 disabled:opacity-50"
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
        {workspace === "disliked" && (
          <section className="ios-surface js-shell-reveal rounded-2xl border border-blue-100 p-4 shadow-panel">
            <div className="flex items-center justify-between gap-3 border-b border-blue-100 pb-3">
              <h2 className="font-heading text-lg font-black">
                不感兴趣 · {dislikedTotal}
              </h2>
              <button
                type="button"
                onClick={() => void loadDisliked()}
                aria-label="刷新不感兴趣商品"
                title="刷新"
                className="grid h-11 w-11 place-items-center rounded-lg border border-blue-200 text-moss hover:bg-blue-50"
              >
                <RefreshIcon />
              </button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {dislikedItems.length === 0 ? (
                <p className="rounded-xl border border-dashed border-blue-200 p-8 text-center text-sm text-ink/50 sm:col-span-2 lg:col-span-3">
                  暂无商品
                </p>
              ) : (
                dislikedItems.map((item) => (
                  <article
                    key={`disliked-${item.id}`}
                    className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-ink/10 p-2"
                  >
                    <ImageGallery
                      images={item.images}
                      alt={
                        translations[`${item.id}:title`] ??
                        translateText(item.titleRaw) ??
                        item.titleRaw
                      }
                      className="h-[72px] w-[88px] rounded-lg bg-ink"
                    />
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setSelected(item)}
                        className="line-clamp-2 text-left text-xs font-black leading-5 hover:text-moss"
                      >
                        {language === "original"
                          ? item.titleRaw
                          : (translations[`${item.id}:title`] ??
                            translateText(item.titleRaw))}
                      </button>
                      <span className="mt-1 block font-mono text-xs font-black text-rust">
                        {fmtYen(item.priceCurrent)}
                      </span>
                      <span className="block font-mono text-[9px] text-ink/45">
                        {fmtCny(item.priceCurrent, exchangeRate?.rate)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void patchItem(item.id, { ignored: false })
                      }
                      aria-label="恢复到在售商品"
                      title="恢复"
                      className="grid h-11 w-11 place-items-center rounded-full border border-moss/20 text-moss hover:bg-blue-50"
                    >
                      <RefreshIcon />
                    </button>
                  </article>
                ))
              )}
            </div>
            {dislikedTotal > 0 && dislikedPageCount > 1 && (
              <nav
                aria-label="不感兴趣商品分页"
                className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-blue-100 bg-white px-3 py-2"
              >
                <span className="text-[10px] text-ink/50">
                  第 {dislikedPage} / {dislikedPageCount} 页 · 共{" "}
                  {dislikedTotal} 条
                </span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    disabled={dislikedPage <= 1}
                    onClick={() => {
                      const next = Math.max(1, dislikedPage - 1);
                      setDislikedPage(next);
                      void loadDisliked(next);
                    }}
                    className="min-h-9 rounded-lg border border-blue-200 px-2.5 text-[10px] font-bold text-moss disabled:opacity-35"
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    disabled={dislikedPage >= dislikedPageCount}
                    onClick={() => {
                      const next = Math.min(
                        dislikedPageCount,
                        dislikedPage + 1,
                      );
                      setDislikedPage(next);
                      void loadDisliked(next);
                    }}
                    className="min-h-9 rounded-lg border border-blue-200 px-2.5 text-[10px] font-bold text-moss disabled:opacity-35"
                  >
                    下一页
                  </button>
                </div>
              </nav>
            )}
          </section>
        )}
        {workspace === "monitoring" && (
          <>
            <section aria-labelledby="ops-heading" className="js-shell-reveal">
              <div className="ios-surface rounded-2xl border border-blue-100 p-4 shadow-panel">
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
          </>
        )}

        {workspace === "inventory" && (
          <>
            {filtersOpen && (
              <div
                className="modal-backdrop js-filter-overlay fixed inset-0 z-40 grid place-items-center bg-ink/55 p-3 sm:p-4"
                onMouseDown={() => setFiltersOpen(false)}
              >
                <section
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="filter-dialog-title"
                  className="ios-surface modal-panel js-filter-modal scrollbar-thin max-h-[92dvh] w-full max-w-5xl overflow-y-auto rounded-3xl bg-paper p-4 shadow-modal sm:p-5"
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
                      label="平台"
                      name="platform"
                      value={filters.platform ?? ""}
                      onChange={changeFilter}
                    >
                      <option value="mandarake">Mandarake</option>
                      <option value="mercari">Mercari</option>
                      <option value="yahoo_auctions">Yahoo!オークション</option>
                      <option value="firecrawl_market">Firecrawl</option>
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
                      onClick={resetFilters}
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

            <section className="workspace-surface js-shell-reveal mt-3 rounded-2xl border border-blue-100 bg-white p-3 shadow-panel">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2
                    id="inventory"
                    className="font-heading text-lg font-black"
                  >
                    在售商品 · {total} 条采购线索
                  </h2>
                  <p className="text-xs text-slate-500">
                    按发现时间排序 · 30 分钟内结束 {urgentCount} 件
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={
                      listingMode === "all" || listingMode === "auction"
                    }
                    onClick={() => changeListingMode("auction")}
                    className={`min-h-11 rounded-lg border px-3 text-xs font-black transition-colors ${listingMode === "all" || listingMode === "auction" ? "border-ink bg-ink text-lime" : "border-blue-200 bg-white text-ink"}`}
                  >
                    拍卖 · {listingCounts.auction}
                  </button>
                  <button
                    type="button"
                    aria-pressed={
                      listingMode === "all" || listingMode === "direct"
                    }
                    onClick={() => changeListingMode("direct")}
                    className={`min-h-11 rounded-lg border px-3 text-xs font-black transition-colors ${listingMode === "all" || listingMode === "direct" ? "border-ink bg-ink text-lime" : "border-blue-200 bg-white text-ink"}`}
                  >
                    直购 · {listingCounts.direct}
                  </button>
                  {activeFilterCount > 0 && (
                    <button
                      onClick={resetFilters}
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
            {loading && items.length === 0 ? (
              <div className="mt-3 grid min-h-52 place-items-center rounded-2xl border border-dashed border-blue-200 bg-white py-16 text-sm font-bold text-slate-500">
                正在同步采购情报…
              </div>
            ) : (
              <div className="mt-3">
                {items.length ? (
                  <div className="procurement-grid grid auto-rows-fr grid-cols-2 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                    {items.map((item) => (
                      <ProductCard
                        key={item.id}
                        item={item}
                        serverOffset={serverOffset}
                        nowTick={nowTick}
                        language={language}
                        translatedTitle={translations[`${item.id}:title`]}
                        onOpen={() => setSelected(item)}
                        onPatch={(patch) => void patchItem(item.id, patch)}
                        onIgnore={() => setIgnoreItem(item)}
                        onPurchase={() => setPurchaseItem(item)}
                        onSeller={(sellerId) => setSellerId(sellerId)}
                        exchangeRate={exchangeRate?.rate}
                        inCart={cart.items.some(
                          (entry) => entry.id === item.id,
                        )}
                        onCart={() =>
                          void updateCart(
                            item.id,
                            !cart.items.some((entry) => entry.id === item.id),
                          )
                        }
                        onShare={() => void shareItems([item.id])}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-blue-200 bg-white p-6 text-center text-sm text-ink/50">
                    当前筛选条件下没有商品
                  </p>
                )}
              </div>
            )}
            {total > 0 && (
              <nav
                aria-label="商品分页"
                className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-white px-3 py-2 shadow-panel"
              >
                <p className="text-xs text-slate-500" aria-live="polite">
                  显示第 <b className="font-mono text-ink">{pageStart}</b>–
                  <b className="font-mono text-ink">{pageEnd}</b> 条，共 {total}{" "}
                  条
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="转到第一页"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage(1)}
                    className="relative min-h-11 rounded-lg border border-blue-200 bg-white px-3 text-xs font-bold text-moss hover:bg-blue-50 disabled:opacity-35"
                  >
                    首页
                  </button>
                  <button
                    type="button"
                    aria-label="上一页"
                    disabled={page <= 1 || loading}
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))
                    }
                    className="relative min-h-11 rounded-lg border border-blue-200 bg-white px-3 text-xs font-bold text-moss hover:bg-blue-50 disabled:opacity-35"
                  >
                    上一页
                  </button>
                  <span className="hidden min-w-24 text-center font-mono text-xs font-bold text-ink sm:inline">
                    {page} / {totalPages}
                  </span>
                  <span className="min-w-14 text-center font-mono text-xs font-bold text-ink sm:hidden">
                    {page}/{totalPages}
                  </span>
                  <button
                    type="button"
                    aria-label="下一页"
                    disabled={page >= totalPages || loading}
                    onClick={() =>
                      setPage((current) => Math.min(totalPages, current + 1))
                    }
                    className="relative min-h-11 rounded-lg border border-blue-200 bg-white px-3 text-xs font-bold text-moss hover:bg-blue-50 disabled:opacity-35"
                  >
                    下一页
                  </button>
                  <button
                    type="button"
                    aria-label="转到最后一页"
                    disabled={page >= totalPages || loading}
                    onClick={() => setPage(totalPages)}
                    className="relative min-h-11 rounded-lg border border-blue-200 bg-white px-3 text-xs font-bold text-moss hover:bg-blue-50 disabled:opacity-35"
                  >
                    末页
                  </button>
                </div>
              </nav>
            )}
            {!loading && !error && items.length === 0 && (
              <div className="mt-3 rounded-2xl border border-dashed border-blue-200 bg-white py-16 text-center text-sm font-bold text-slate-500">
                当前筛选条件下没有商品。请清除筛选或稍后刷新。
              </div>
            )}
          </>
        )}
      </div>
      <nav
        aria-label="主要工作区"
        className="ios-nav primary-navigation fixed bottom-0 left-0 z-30 grid w-full grid-cols-5 bg-black text-white"
      >
        {(
          [
            ["inventory", "在售", BagIcon],
            ["discovery", "发现", CompassIcon],
            ["assistant", "AI", SparklesIcon],
            ["workbench", "工作台", WorkbenchIcon],
            ["menu", "菜单", MenuIcon],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => navigateWorkspace(key)}
            aria-label={label}
            title={label}
            aria-current={navigationWorkspace === key ? "page" : undefined}
            className="primary-navigation-item"
          >
            <span className="primary-navigation-icon">
              <Icon className="h-5 w-5" />
            </span>
            <span className="primary-navigation-label">{label}</span>
          </button>
        ))}
      </nav>
      {analysisOpen && (
        <MarketAnalysisDialog
          analysis={analysis}
          loading={analysisLoading}
          error={analysisError}
          language={language}
          translations={translations}
          exchangeRate={exchangeRate?.rate}
          onStart={() => void loadAnalysis()}
          onOpenItem={(id) => {
            setAnalysisOpen(false);
            void openAnalysisItem(id);
          }}
          onClose={() => setAnalysisOpen(false)}
        />
      )}
      {selected && (
        <DetailDrawer
          item={selected}
          language={language}
          translatedTitle={translations[`${selected.id}:title`]}
          translatedDescription={translations[`${selected.id}:description`]}
          translationError={translationErrors[selected.id]}
          exchangeRate={exchangeRate?.rate}
          onClose={() => setSelected(null)}
          onSaved={(updated) => {
            setSelected(updated);
            setItems((current) =>
              current.map((item) => (item.id === updated.id ? updated : item)),
            );
          }}
        />
      )}
      {sellerId && (
        <SellerProfileDialog
          sellerId={sellerId}
          exchangeRate={exchangeRate?.rate}
          onClose={() => setSellerId(null)}
          onOpenItem={(item) => {
            setSellerId(null);
            setSelected(item);
          }}
        />
      )}
      {purchaseItem && (
        <PurchaseDialog
          item={purchaseItem}
          translatedTitle={translations[`${purchaseItem.id}:title`]}
          onClose={() => setPurchaseItem(null)}
          onSaved={() => {
            setPurchaseItem(null);
            void Promise.all([loadPurchases(), load(), loadLinkItems()]);
          }}
        />
      )}
      {ignoreItem && (
        <IgnoreConfirmationDialog
          item={ignoreItem}
          translatedTitle={translations[`${ignoreItem.id}:title`]}
          onCancel={() => setIgnoreItem(null)}
          onConfirm={async () => {
            await patchItem(ignoreItem.id, { ignored: true });
            await syncChanges();
          }}
        />
      )}
      <button
        type="button"
        onClick={() => setCartOpen(true)}
        aria-label={`打开购物车${cart.count ? `，${cart.count} 件` : ""}`}
        title="购物车"
        className="cart-fab fixed bottom-[7.25rem] right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-black text-white shadow-modal transition-transform hover:scale-105"
      >
        <CartIcon className="h-6 w-6" />
        {cart.count > 0 && (
          <span className="absolute -right-1 -top-1 grid h-6 min-w-6 place-items-center rounded-full bg-rust px-1 font-mono text-[10px] font-bold text-white">
            {cart.count}
          </span>
        )}
      </button>
      {cartOpen && (
        <CartDialog
          cart={cart}
          exchangeRate={exchangeRate?.rate}
          language={language}
          translations={translations}
          sharing={cartSharing}
          message={shareMessage}
          onRemove={(itemId) => void updateCart(itemId, false)}
          onOpen={(item) => {
            setCartOpen(false);
            setSelected(item);
          }}
          onShare={() => void shareItems()}
          onClose={() => setCartOpen(false)}
        />
      )}
      {purchaseGallery && (
        <ItemImagesDialog
          item={purchaseGallery}
          title={purchaseGallery.titleZh ?? purchaseGallery.titleRaw}
          onClose={() => setPurchaseGallery(null)}
        />
      )}
    </main>
  );
}
