"use client";

import { useGSAP } from "@gsap/react";
import { PrimaryNavigation } from "../components/primary-navigation";
import { LoadError } from "../components/load-error";
import { TodoHome } from "../components/todo-home";
import { TERMS } from "../lib/terms";
import {
  buildReviewQueue,
  type ShareMessageLike,
  type ShareRoundLike,
} from "../lib/todo-queues";
import { WorkbenchWorkspace } from "../components/workbench-workspace";
import { EditorialReadingProgress } from "../components/editorial-reading-progress";
import gsap from "gsap";
import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import { motionTokens, springs } from "../lib/motion-tokens";
import transactionStyles from "../components/transaction-feedback.module.css";
import { useTransactionPresentation } from "../lib/use-transaction-presentation";
import {
  DetailDisclosure,
  DetailDescription,
} from "../components/detail-disclosure";
import { chinaComparisonSummary } from "../lib/china-comparison";
import { ImageGallery } from "../components/image-gallery";
import { NoteDialog } from "../components/note-dialog";
import {
  PurchaseReceiptPreviewDialog,
  type PurchaseReceiptPreviewRequest,
} from "../components/purchase-receipt-preview-dialog";
import {
  PurchaseRegistrationForm,
  type PurchaseRegistrationItem,
} from "../components/purchase-registration-form";
import { MarketIntelWorkspace } from "../components/market-intel-workspace";
import { CostToolWorkspace } from "../components/cost-tool-workspace";
import { CostEstimatePanel } from "../components/cost-estimate-panel";
import { YahooDiscount } from "../components/yahoo-discount";
import { InventoryOrdersWorkspace } from "../components/inventory-orders-workspace";
import { PurchaseRecordsWorkspace } from "../components/purchase-records-workspace";
import { ContextInfo } from "../components/context-info";
import { ResaleWorkspace } from "../components/resale-workspace";
import { ProductReadingPanel } from "../components/product-reading-panel";
import { AssistantChatWorkspace } from "../components/assistant-chat-workspace";
import {
  CollaborationChatWorkspace,
  buildBundleNegotiationScript,
  buildBundleShareText,
  markShareRoundItemsCopied,
  type CollaborationItem,
  type PendingCollaborationBundle,
  type ShareRound,
} from "../components/collaboration-chat-workspace";
import {
  ManagerAccountGate,
  type ManagerAccount,
} from "../components/manager-account-gate";
import { WorkspaceHistoryOrb } from "../components/workspace-history-orb";
import {
  HomeMarketOverview,
  type MarketOverviewData,
} from "../components/home-market-overview";
import {
  marketplaceSourceName as sourceName,
  marketplaceSourceOptions,
} from "../lib/source-label";
import { listingCostSummary } from "../lib/listing-cost";
import {
  fmtCny,
  fmtCnyAmount,
  fmtYen,
  itemDisplayTitle,
  listingLabels as labels,
  relativeTime,
  shippingLabel,
  useLiveAuctionTimeline,
} from "../lib/listing-display";
import { ProductCard } from "../components/product-card/product-card";
import {
  ArchiveIcon,
  CartIcon,
  CommentIcon,
  HeartIcon,
  MessageIcon,
  MoneyIcon,
  ShareIcon,
  TrashIcon,
} from "../components/product-card/product-card-icons";
import {
  isAvailableMarketListing,
  isUnverifiableListing,
  retainAvailableMarketListings,
} from "../lib/item-availability";
import {
  browseableListingTypes,
  listingTypeLabel,
  type ListingType,
} from "../lib/listing-type";
import {
  getShellOverlayRoot,
  SHELL_OVERLAY_ROOT_ID,
} from "../lib/shell-overlay";
import {
  readWorkspaceScrollTop,
  restoreWorkspaceScroll,
} from "../lib/workspace-scroll";
import {
  applyWorkspaceSearchParam,
  DEFAULT_WORKSPACE,
  goBackWorkspaceState,
  initialWorkspaceNavigationState,
  legacyCatalogView,
  legacyWorkspaceRedirect,
  legacyPurchasesTab,
  legacyCostToolSegment,
  navigateWorkspaceState,
  parsePurchasesTabParam,
  parseRecentWorkspaceEntries,
  parseWorkspaceHistoryState,
  parseWorkspaceParam,
  RECENT_WORKSPACES_STORAGE_KEY,
  recordRecentWorkspace,
  withWorkspaceHistoryState,
  type CatalogView,
  type PurchasesTab,
  type CostToolSegment,
  type RecentWorkspaceEntry,
  type Workspace,
  type WorkspaceNavigationState,
} from "../lib/workspace-navigation";
import { createVisibilityPoller } from "../lib/visibility-poller";
import {
  captureDialogReturnFocus,
  restoreDialogReturnFocus,
} from "../lib/dialog-return-focus";
import { useDialogFocus } from "../lib/use-dialog-focus";
import {
  beginDetailTranslationAttempt,
  endDetailTranslationSession,
} from "../lib/detail-translation-session";
import {
  parseItemDetailHistoryState,
  withoutItemDetailHistoryState,
  withItemDetailHistoryState,
} from "../lib/item-detail-history";
import {
  authoritativePurchaseTotal,
  mergePurchaseBundlePage,
  standalonePurchaseRecords,
} from "../lib/purchase-history";
import { parsePurchaseLinkInput } from "../lib/purchase-link-input";
import {
  friendlyImportError,
  publicUrlsFromInput,
} from "../lib/import-helpers";
import { readFetchError } from "../lib/fetch-error";
import type { MonitoringCategory } from "../components/monitoring-config-workspace";

const MonitoringConfigWorkspace = dynamic(
  () => import("../components/monitoring-config-workspace").then((module) => module.MonitoringConfigWorkspace),
  { ssr: false, loading: () => <p role="status" className="mcfg-empty">正在读取{TERMS.monitoring}…</p> },
);

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
  listingType: ListingType;
  bidCount?: number | null;
  categoryIp: string;
  categoryToyType: string;
  monitoringCategoryId?: string | null;
  shfLine?: "standard" | "shinkocchou" | null;
  shfReleaseChannel?: "retail" | "tamashii_web" | "event" | "unknown" | null;
  shfEdition?: "first" | "reissue" | "unknown" | null;
  shfRegion?: "japanese" | "agent" | "hong_kong" | "unknown" | null;
  manufacturer: string;
  conditionGrade: string;
  channel: string;
  quantityEst?: number | null;
  unitCostEst?: number | null;
  confidence: number;
  needsReview: boolean;
  status: string;
  refreshFailureCount?: number | null;
  favorite: boolean;
  ignored: boolean;
  ignoredAt?: string | null;
  ignoredReason?: string | null;
  importOrigin?: "search" | "url";
  archivedAt?: string | null;
  deletedAt?: string | null;
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
  chinaComparison?: ChinaComparison | null;
  valueKing?: {
    kind: "high_value_low_price" | "ultra_low_bundle";
    label: string;
    acquisitionCostJpy: number;
    unitCostJpy: number;
    quantity: number;
    xianyuReferencePriceCny: number | null;
    netProfitJpy: number | null;
    netMarginRatio: number | null;
    referenceBasis?: "xianyu" | "japan_inventory" | "unit_cost";
    referencePriceJpy?: number | null;
    referenceSampleCount?: number;
    savingsJpy?: number | null;
    evidenceExpiresAt: string;
    facts: string[];
  } | null;
};

type FavoriteItemPatch = Partial<Item> &
  Pick<Item, "id">;

type FavoriteSyncChange = {
  patch: FavoriteItemPatch;
  item?: Item;
};

type FavoriteChangeBatch = {
  sequence: number;
  changes: FavoriteSyncChange[];
};

const FAVORITE_CHANGE_JOURNAL_LIMIT = 500;
const MANAGER_ACCOUNT_STORAGE_KEY = "kamen-procurement-manager-v1";

function validTimestamp(value?: string | null) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isOlderFavoriteChange(item: Item, patch: FavoriteItemPatch) {
  const currentTimestamp = validTimestamp(item.updatedAt);
  const patchTimestamp = validTimestamp(patch.updatedAt);
  return (
    currentTimestamp !== null &&
    patchTimestamp !== null &&
    patchTimestamp < currentTimestamp
  );
}

function isVisibleFavorite(value: Partial<Item>) {
  return value.favorite === true && isAvailableMarketListing(value);
}

function reconcileFavoriteItems(
  current: Item[],
  changes: FavoriteSyncChange[],
) {
  const itemsById = new Map(
    current.filter(isVisibleFavorite).map((item) => [item.id, item]),
  );
  const missingItemIds: string[] = [];

  for (const change of changes) {
    const existing = itemsById.get(change.patch.id);
    if (existing && isOlderFavoriteChange(existing, change.patch)) continue;
    const base = existing ?? change.item;
    const candidate = base ? { ...base, ...change.patch } : change.patch;
    if (!isVisibleFavorite(candidate)) {
      itemsById.delete(change.patch.id);
      continue;
    }
    if (base) {
      itemsById.set(change.patch.id, candidate as Item);
      continue;
    }
    missingItemIds.push(change.patch.id);
  }

  return { items: [...itemsById.values()], missingItemIds };
}

type ChinaComparison = {
  status?: string | null;
  source?: { key?: string; displayName?: string } | null;
  referencePriceCny?: number | null;
  referenceUrl?: string | null;
  observedAt?: string | null;
  expiresAt?: string | null;
  offers?: Array<{
    title: string;
    priceCny: number;
    condition?: string | null;
    imageUrl?: string | null;
    sourceUrl: string;
    isReference: boolean;
  }>;
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

type PurchaseRecord = {
  id: string;
  itemId: string;
  bundleId?: string;
  purchaseAmount: number;
  amountAllocated?: boolean;
  quantityOverride?: number | null;
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
  bundle?: {
    id: string;
    pricingMode: "per_item" | "bundle_total";
    totalPurchaseAmount: number;
    version: number;
    archivedAt?: string | null;
  };
};

type PurchaseBundleAudit = {
  id: string;
  eventType:
    | "created"
    | "price_changed"
    | "members_changed"
    | "updated"
    | "archived";
  actor: string;
  reason: string;
  beforeData?: Record<string, unknown> | null;
  afterData: Record<string, unknown>;
  createdAt: string;
};

type PurchaseBundle = {
  id: string;
  pricingMode: "per_item" | "bundle_total";
  totalPurchaseAmount: number;
  currency: string;
  purchasedAt: string;
  note?: string | null;
  archivedAt?: string | null;
  version: number;
  purchases: PurchaseRecord[];
  audits?: PurchaseBundleAudit[];
};

type PurchaseLinkJob = {
  jobId: string;
  importId?: string | null;
  url: string;
  state: "queued" | "waiting" | "active" | "delayed" | "completed" | "failed";
  progress: number;
  item?: Item | null;
  failedReason?: string | null;
  suggestedAmountYen?: number | null;
  suggestedAmountSource?: "actual" | "listing" | null;
  paidAmountYen?: number | null;
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

type CartSharePayload = {
  itemCount?: number;
  primaryUrl?: string;
  sourceUrls?: string[];
  text?: string;
  items?: {
    id?: string;
    title?: string;
    titleZh?: string | null;
    titleRaw?: string;
    sourceUrl?: string;
    url?: string;
  }[];
  links?: {
    id?: string;
    title?: string;
    titleZh?: string | null;
    titleRaw?: string;
    sourceUrl?: string;
    url?: string;
  }[];
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
const PURCHASE_BUNDLE_PAGE_SIZE = 100;
const WORKSPACE_SCROLL_STORAGE_KEY = "kamen-procurement-workspace-scroll-v2";

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

type Filters = Record<string, string>;

const XIANYU_PRICE_BANDS = [
  { key: "lt_300", label: "¥300 以下" },
  { key: "300_999", label: "¥300–999" },
  { key: "gte_1000", label: "¥1,000 以上" },
] as const;

function xianyuPriceBandLabel(key?: string) {
  return (
    XIANYU_PRICE_BANDS.find((band) => band.key === key)?.label ?? "全部价格"
  );
}

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
  market?: MarketOverviewData;
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

function EditIcon({ className = "h-4 w-4" }: IconProps) {
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
      <path d="m4 16.5-.8 4.3 4.3-.8L19 8.5a2.8 2.8 0 0 0-4-4L4 16.5Z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}

function HistoryIcon({ className = "h-4 w-4" }: IconProps) {
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
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5M12 7v5l3 2" />
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

function ChevronDownIcon({ className = "h-4 w-4" }: IconProps) {
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
      <path d="m6 9 6 6 6-6" />
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

function RiderLogo({ className = "h-11 w-11" }: IconProps) {
  // One centered white-ground mark is shared with browser and home-screen icons.
  return (
    <img
      src="/brand-icon.svg?v=5"
      alt="假面采购标志"
      width={44}
      height={44}
      className={`${className} block max-h-full max-w-full object-contain`}
      draggable={false}
    />
  );
}

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const PAGE_SIZE = 40;
const NOTE_MAX_LENGTH = 25;
const URL_IMPORT_LIMIT = 20;

const fmtDate = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "平台未提供";

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

function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
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

function ItemImagesDialog({
  item,
  title,
  onClose,
}: {
  item: Item;
  title: string;
  onClose: () => void;
}) {
  const presentationRef = useRef<HTMLElement>(null);
  useTransactionPresentation(presentationRef);
  return createPortal(
    <div
      className="modal-backdrop absolute inset-0 z-[90] grid place-items-center bg-ink/55 p-3"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${title}的商品图片`}
        ref={presentationRef}
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
          showThumbnails
          className="aspect-[4/3] max-h-[72dvh] w-full rounded-2xl bg-ink"
          imageClassName="object-contain"
        />
      </section>
    </div>,
    getShellOverlayRoot(),
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
  onSendBundle,
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
  onSendBundle?: () => void;
  onClose: () => void;
}) {
  const presentationRef = useRef<HTMLElement>(null);
  useTransactionPresentation(presentationRef);
  const total = cart.items.reduce(
    (sum, item) => sum + item.priceCurrent + (item.shippingFee ?? 0),
    0,
  );
  return createPortal(
    <div
      className="modal-backdrop absolute inset-0 z-[85] grid place-items-center bg-ink/45 p-3"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-title"
        ref={presentationRef}
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
            <p className="text-xs text-ink/50">购物车内 {cart.count} 件</p>
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
              const title = itemDisplayTitle(
                item,
                language,
                translations[`${item.id}:title`],
              );
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
                    <YahooDiscount
                      sourceKey={item.source.key}
                      priceYen={item.priceCurrent}
                      exchangeRate={exchangeRate}
                    />
                    <p className="font-mono text-[10px] text-ink/45">
                      {fmtCny(item.priceCurrent, exchangeRate)} ·{" "}
                      {sourceName(
                        item.source.key,
                        item.source.displayName,
                        item.sourceUrl,
                      )}
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
          <div className="grid gap-2 sm:grid-cols-2">
            {onSendBundle && (
              <button
                type="button"
                disabled={!cart.count}
                onClick={onSendBundle}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-ink px-4 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-40"
              >
                <MessageIcon /> 集合发给搭档砍价
              </button>
            )}
            <button
              type="button"
              disabled={!cart.count || sharing}
              onClick={onShare}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-moss px-4 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-40"
            >
              <ShareIcon /> {sharing ? "正在生成…" : "分享原始商品链接"}
            </button>
          </div>
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
    </div>,
    getShellOverlayRoot(),
  );
}

/**
 * Favorites as a catalog view: this component keeps the collection's own
 * sync engine (full-load + change journal + targeted refetch) but renders
 * the shared ProductCard grid, so favorites behave and look exactly like
 * every other item surface. Card patches stay on the engine's journal
 * path; cart/share/ignore/delete/bundle actions delegate to the
 * dashboard handlers through props.
 */
function FavoritesWorkspace({
  apiBaseUrl,
  actor,
  language,
  translations,
  nowTick: nowTickMs,
  exchangeRate,
  serverOffset,
  changeBatch,
  onPublishChanges,
  cartItemIds,
  bundleShareItemIds,
  onOpenItem,
  onPurchaseItem,
  onCartItem,
  onShareItem,
  onIgnoreItem,
  onDeleteItem,
  onSendToManagerItem,
  onToggleBundleShareItem,
}: {
  apiBaseUrl: string;
  actor?: string;
  language: "zh" | "original";
  translations: Record<string, string>;
  nowTick: number;
  exchangeRate?: number;
  serverOffset: number;
  changeBatch?: FavoriteChangeBatch;
  onPublishChanges: (changes: FavoriteSyncChange[]) => void;
  cartItemIds: ReadonlySet<string>;
  bundleShareItemIds: ReadonlySet<string>;
  onOpenItem: (item: Item) => void;
  onPurchaseItem: (item: Item) => void;
  onCartItem: (item: Item) => void;
  onShareItem: (item: Item) => void;
  onIgnoreItem: (item: Item) => void;
  onDeleteItem: (item: Item) => void;
  onSendToManagerItem: (item: Item) => void;
  onToggleBundleShareItem: (item: Item) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [listingMode, setListingMode] = useState<ListingType>("direct");
  const [sortMode, setSortMode] = useState<
    "price-asc" | "price-desc" | "ending-asc" | "ending-desc"
  >("price-asc");
  const [nowTick, setNowTick] = useState(0);
  const hasLoadedRef = useRef(false);
  const itemsRef = useRef<Item[]>([]);
  const requestSequenceRef = useRef(0);
  const collectionRequestRef = useRef<AbortController | null>(null);
  const targetedRequestsRef = useRef(new Map<string, AbortController>());
  const targetedRetryStateRef = useRef(
    new Map<string, { failures: number; nextAttemptAt: number }>(),
  );
  const changeJournalRef = useRef(new Map<string, FavoriteSyncChange>());
  const noteMutationSequenceRef = useRef(0);
  const pendingNoteMutationsRef = useRef(
    new Map<string, { sequence: number; note: string | null }>(),
  );

  const commitItems = useCallback((next: Item[]) => {
    const available = next.every(isVisibleFavorite) ? next : next.filter(isVisibleFavorite);
    if (available === itemsRef.current) return;
    itemsRef.current = available;
    setItems(available);
    setTotal(available.length);
  }, []);

  const trimChangeJournal = useCallback((currentItems: Item[]) => {
    const currentIds = new Set(currentItems.map((item) => item.id));
    for (const id of currentIds) {
      targetedRetryStateRef.current.delete(id);
      if (
        !targetedRequestsRef.current.has(id) &&
        !pendingNoteMutationsRef.current.has(id)
      )
        changeJournalRef.current.delete(id);
    }
    if (changeJournalRef.current.size <= FAVORITE_CHANGE_JOURNAL_LIMIT) return;
    for (const id of changeJournalRef.current.keys()) {
      if (
        targetedRequestsRef.current.has(id) ||
        pendingNoteMutationsRef.current.has(id)
      )
        continue;
      changeJournalRef.current.delete(id);
      targetedRetryStateRef.current.delete(id);
      if (changeJournalRef.current.size <= FAVORITE_CHANGE_JOURNAL_LIMIT) break;
    }
  }, []);

  const recordChanges = useCallback((changes: FavoriteSyncChange[]) => {
    const recorded: FavoriteSyncChange[] = [];
    for (const change of changes) {
      const previous = changeJournalRef.current.get(change.patch.id);
      const previousTimestamp = validTimestamp(previous?.patch.updatedAt);
      const nextTimestamp = validTimestamp(change.patch.updatedAt);
      if (
        previous &&
        previousTimestamp !== null &&
        nextTimestamp !== null &&
        nextTimestamp < previousTimestamp
      ) {
        recorded.push(previous);
        continue;
      }
      const mergedPatch: FavoriteItemPatch = previous
        ? { ...previous.patch, ...change.patch }
        : change.patch;
      const merged: FavoriteSyncChange = {
        patch: mergedPatch,
        item: change.item ?? previous?.item,
      };
      changeJournalRef.current.set(change.patch.id, merged);
      recorded.push(merged);
    }
    return recorded;
  }, []);

  const requestTargetedItem = useCallback(
    async (id: string) => {
      if (targetedRequestsRef.current.has(id)) return;
      const controller = new AbortController();
      targetedRequestsRef.current.set(id, controller);
      try {
        const response = await fetch(`${apiBaseUrl}/items/${id}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`API ${response.status}`);
        const payload = (await response.json()) as { item?: Item };
        controller.signal.throwIfAborted();
        const latest = changeJournalRef.current.get(id);
        if (!payload.item || !latest || !isVisibleFavorite({ ...payload.item, ...latest.patch }))
          return;
        const reconciled = reconcileFavoriteItems(itemsRef.current, [
          { item: payload.item, patch: latest.patch },
        ]);
        commitItems(reconciled.items);
        changeJournalRef.current.delete(id);
        targetedRetryStateRef.current.delete(id);
        setError("");
      } catch (reason) {
        if (
          !controller.signal.aborted &&
          !(reason instanceof DOMException && reason.name === "AbortError")
        ) {
          const failures =
            (targetedRetryStateRef.current.get(id)?.failures ?? 0) + 1;
          const delayMs = Math.min(
            60_000,
            500 * 2 ** Math.min(failures - 1, 7),
          );
          targetedRetryStateRef.current.set(id, {
            failures,
            nextAttemptAt: Date.now() + delayMs,
          });
          setError(
            reason instanceof Error ? reason.message : "收藏商品补取失败",
          );
        }
      } finally {
        if (targetedRequestsRef.current.get(id) === controller)
          targetedRequestsRef.current.delete(id);
        trimChangeJournal(itemsRef.current);
      }
    },
    [apiBaseUrl, commitItems, trimChangeJournal],
  );

  const applyFavoriteChanges = useCallback(
    (changes: FavoriteSyncChange[]) => {
      const currentIds = new Set(itemsRef.current.map((item) => item.id));
      const relevantChanges = hasLoadedRef.current
        ? changes.filter(
            (change) =>
              isVisibleFavorite(change.patch) ||
              currentIds.has(change.patch.id) ||
              targetedRequestsRef.current.has(change.patch.id) ||
              changeJournalRef.current.has(change.patch.id),
          )
        : changes;
      if (!relevantChanges.length) return;
      const recorded = recordChanges(relevantChanges).map((change) => {
        const pending = pendingNoteMutationsRef.current.get(change.patch.id);
        return pending && Object.hasOwn(change.patch, "note")
          ? { ...change, patch: { ...change.patch, note: pending.note } }
          : change;
      });
      for (const change of recorded) {
        const base = itemsRef.current.find((item) => item.id === change.patch.id) ?? change.item;
        if (!isVisibleFavorite({ ...base, ...change.patch })) {
          targetedRequestsRef.current.get(change.patch.id)?.abort();
          targetedRequestsRef.current.delete(change.patch.id);
          targetedRetryStateRef.current.delete(change.patch.id);
          changeJournalRef.current.set(change.patch.id, {
            patch: change.patch,
          });
        }
      }
      if (!hasLoadedRef.current) return;
      const reconciled = reconcileFavoriteItems(itemsRef.current, recorded);
      commitItems(reconciled.items);
      for (const id of reconciled.missingItemIds) void requestTargetedItem(id);
      trimChangeJournal(reconciled.items);
    },
    [commitItems, recordChanges, requestTargetedItem, trimChangeJournal],
  );

  const load = useCallback(async () => {
    collectionRequestRef.current?.abort();
    const controller = new AbortController();
    collectionRequestRef.current = controller;
    const sequence = ++requestSequenceRef.current;
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const firstResponse = await fetch(
        `${apiBaseUrl}/items?favorite=true&limit=100&offset=0`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!firstResponse.ok) throw new Error(`API ${firstResponse.status}`);
      const first = (await firstResponse.json()) as {
        items?: Item[];
        total?: number;
      };
      const expectedTotal = first.total ?? first.items?.length ?? 0;
      const collected = [...(first.items ?? [])];
      let nextOffset = collected.length;
      while (nextOffset < expectedTotal) {
        const response = await fetch(
          `${apiBaseUrl}/items?favorite=true&limit=100&offset=${nextOffset}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error(`API ${response.status}`);
        const page = (await response.json()) as { items?: Item[] };
        const batch = page.items ?? [];
        if (!batch.length) break;
        collected.push(...batch);
        nextOffset += batch.length;
      }
      controller.signal.throwIfAborted();
      if (sequence !== requestSequenceRef.current) return;
      const reconciled = reconcileFavoriteItems(collected, [
        ...changeJournalRef.current.values(),
      ]);
      commitItems(reconciled.items);
      setError("");
      hasLoadedRef.current = true;
      for (const id of reconciled.missingItemIds) void requestTargetedItem(id);
      trimChangeJournal(reconciled.items);
    } catch (reason) {
      if (!controller.signal.aborted && sequence === requestSequenceRef.current)
        setError(reason instanceof Error ? reason.message : "收藏加载失败");
    } finally {
      if (sequence === requestSequenceRef.current) setLoading(false);
      if (collectionRequestRef.current === controller)
        collectionRequestRef.current = null;
    }
  }, [apiBaseUrl, commitItems, requestTargetedItem, trimChangeJournal]);
  useEffect(() => {
    void load();
    return () => collectionRequestRef.current?.abort();
  }, [load]);
  useEffect(() => {
    if (changeBatch?.changes.length) applyFavoriteChanges(changeBatch.changes);
  }, [applyFavoriteChanges, changeBatch]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentIds = new Set(itemsRef.current.map((item) => item.id));
      for (const [id, retry] of targetedRetryStateRef.current) {
        const latest = changeJournalRef.current.get(id);
        if (!latest || !isVisibleFavorite(latest.patch) || currentIds.has(id)) {
          targetedRetryStateRef.current.delete(id);
          continue;
        }
        if (retry.nextAttemptAt <= Date.now()) void requestTargetedItem(id);
      }
      trimChangeJournal(itemsRef.current);
    }, 250);
    return () => window.clearInterval(timer);
  }, [requestTargetedItem, trimChangeJournal]);
  useEffect(
    () => () => {
      for (const controller of targetedRequestsRef.current.values())
        controller.abort();
      targetedRequestsRef.current.clear();
      targetedRetryStateRef.current.clear();
    },
    [],
  );
  useEffect(() => {
    const timer = window.setInterval(
      () => setNowTick((current) => current + 1),
      30_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const deadlines = items
      .filter((item) => item.listingType === "auction" && item.auctionEndAt)
      .map((item) => Date.parse(item.auctionEndAt!))
      .filter(Number.isFinite);
    if (!deadlines.length) return;
    const delay = Math.max(1, Math.min(2_147_483_647, Math.min(...deadlines) - Date.now()));
    const timer = window.setTimeout(() =>
      commitItems(itemsRef.current.filter(isVisibleFavorite)), delay);
    return () => window.clearTimeout(timer);
  }, [commitItems, items, nowTick]);
  const counts = useMemo(
    () => ({
      direct: items.filter((item) => item.listingType === "direct").length,
      auction: items.filter((item) => item.listingType === "auction").length,
      unknown: items.filter((item) => item.listingType === "unknown").length,
    }),
    [items],
  );
  const visibleItems = useMemo(() => {
    const selected = items.filter((item) => item.listingType === listingMode);
    return [...selected].sort((left, right) => {
      if (sortMode === "price-asc" || sortMode === "price-desc") {
        const difference = left.priceCurrent - right.priceCurrent;
        return sortMode === "price-asc" ? difference : -difference;
      }
      if (!left.auctionEndAt && !right.auctionEndAt) return 0;
      if (!left.auctionEndAt) return 1;
      if (!right.auctionEndAt) return -1;
      const leftEnd = new Date(left.auctionEndAt).getTime();
      const rightEnd = new Date(right.auctionEndAt).getTime();
      const difference = leftEnd - rightEnd;
      return sortMode === "ending-asc" ? difference : -difference;
    });
  }, [items, listingMode, sortMode, nowTick]);
  async function saveNote(item: Item, note: string | null) {
    const previous =
      itemsRef.current.find((entry) => entry.id === item.id)?.note ?? null;
    const sequence = ++noteMutationSequenceRef.current;
    pendingNoteMutationsRef.current.set(item.id, { sequence, note });
    commitItems(
      itemsRef.current.map((entry) =>
        entry.id === item.id ? { ...entry, note } : entry,
      ),
    );
    try {
      const response = await fetch(`${apiBaseUrl}/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          note,
          actor: actor || "favorites-workspace",
          reason: "更新采购备注",
        }),
      });
      if (!response.ok) throw new Error(`备注保存失败（${response.status}）`);
      const payload = (await response.json()) as { item?: Item };
      if (pendingNoteMutationsRef.current.get(item.id)?.sequence !== sequence)
        return;
      pendingNoteMutationsRef.current.delete(item.id);
      if (payload.item)
        applyFavoriteChanges([{ item: payload.item, patch: payload.item }]);
    } catch (reason) {
      if (pendingNoteMutationsRef.current.get(item.id)?.sequence === sequence) {
        pendingNoteMutationsRef.current.delete(item.id);
        const rolledBack = itemsRef.current.map((entry) =>
          entry.id === item.id ? { ...entry, note: previous } : entry,
        );
        const latest = changeJournalRef.current.get(item.id);
        const reconciled = latest
          ? reconcileFavoriteItems(rolledBack, [latest])
          : { items: rolledBack };
        commitItems(reconciled.items);
        trimChangeJournal(reconciled.items);
        setError(reason instanceof Error ? reason.message : "备注保存失败");
      }
      throw reason;
    }
  }
  async function patchFavoriteItem(
    item: Item,
    patch: { favorite?: boolean; note?: string | null },
  ) {
    if (patch.note !== undefined) {
      await saveNote(item, patch.note);
      return true;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...patch,
          actor: actor || "favorites-workspace",
        }),
      });
      if (!response.ok) return false;
      const payload = (await response.json()) as { item?: Item };
      if (payload.item) {
        const change = { item: payload.item, patch: payload.item };
        applyFavoriteChanges([change]);
        onPublishChanges([change]);
      }
      return true;
    } catch {
      return false;
    }
  }
  return (
    <section
      className="favorites-workspace portal-page"
      aria-labelledby="favorites-title"
    >
      <div className="portal-heading">
        <div>
          <h2 id="favorites-title">收藏</h2>
          <p className="mt-1 text-xs text-ink/45">共 {total} 件</p>
        </div>
      </div>
      {error && (
        <LoadError
          message={error}
          onRetry={() => void load()}
          retryTestId="retry-favorites"
          className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-rust p-3 text-xs font-bold text-white"
          actionClassName="shrink-0 rounded-lg bg-white/20 px-3 py-1.5 text-xs font-bold text-white"
        />
      )}
      {loading ? (
        <p className="favorites-empty mt-6 rounded-2xl p-8 text-center text-sm">
          正在读取收藏…
        </p>
      ) : items.length === 0 ? (
        <p className="favorites-empty mt-6 rounded-2xl p-8 text-center text-sm">
          还没有收藏商品
        </p>
      ) : (
        <>
          <div className="favorites-toolbar mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-2">
            <div
              role="tablist"
              aria-label="收藏商品类型"
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]"));
                const selected = tabs.findIndex((tab) => tab === document.activeElement);
                const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (selected + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                tabs[next]?.focus(); tabs[next]?.click();
              }}
              className="grid min-w-[220px] flex-1 grid-cols-2 rounded-xl p-1 sm:flex-none"
            >
              {browseableListingTypes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={listingMode === mode}
                  tabIndex={listingMode === mode ? 0 : -1}
                  onClick={() => {
                    setListingMode(mode);
                    if (mode !== "auction" && sortMode.startsWith("ending"))
                      setSortMode("price-asc");
                  }}
                  className={`min-h-11 rounded-lg px-3 text-xs font-bold transition-[background-color,color,box-shadow] ${listingMode === mode ? "text-ink" : "text-ink/50"}`}
                >
                  {listingTypeLabel(mode)} · {counts[mode]}
                </button>
              ))}
            </div>
            <label className="flex min-h-11 items-center gap-2 text-xs font-semibold text-ink/50">
              排序
              <select
                value={sortMode}
                onChange={(event) =>
                  setSortMode(
                    event.target.value as
                      | "price-asc"
                      | "price-desc"
                      | "ending-asc"
                      | "ending-desc",
                  )
                }
                className="min-h-11 rounded-xl px-3 text-xs font-bold"
              >
                <option value="price-asc">价格从低到高</option>
                <option value="price-desc">价格从高到低</option>
                {listingMode === "auction" && (
                  <>
                    <option value="ending-asc">即将结束</option>
                    <option value="ending-desc">结束时间最晚</option>
                  </>
                )}
              </select>
            </label>
          </div>
          <div className="procurement-grid mt-6 grid auto-rows-max grid-cols-2 items-start gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {visibleItems.length ? (
              visibleItems.map((item) => (
                <ProductCard
                  key={item.id}
                  item={item}
                  language={language}
                  translatedTitle={translations[`${item.id}:title`]}
                  exchangeRate={exchangeRate}
                  serverOffset={serverOffset}
                  nowTick={nowTickMs}
                  onOpen={() => onOpenItem(item)}
                  onPatch={(patch) => patchFavoriteItem(item, patch)}
                  onIgnore={() => onIgnoreItem(item)}
                  onDelete={() => onDeleteItem(item)}
                  onPurchase={() => onPurchaseItem(item)}
                  inCart={cartItemIds.has(item.id)}
                  onCart={() => onCartItem(item)}
                  onShare={() => onShareItem(item)}
                  onSendToManager={() => onSendToManagerItem(item)}
                  inBundleShare={bundleShareItemIds.has(item.id)}
                  onToggleBundleShare={() => onToggleBundleShareItem(item)}
                />
              ))
            ) : (
              <p className="favorites-empty rounded-2xl p-8 text-center text-sm col-span-2 md:col-span-3 lg:col-span-4 2xl:col-span-5">
                收藏中暂无{listingTypeLabel(listingMode)}商品
              </p>
            )}
          </div>
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
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDialogFocus({
    active: true,
    dialogRef,
    initialFocusRef: closeRef,
    onClose,
  });
  const itemTitle = (item: Item) =>
    itemDisplayTitle(item, language, translations[`${item.id}:title`]);
  return createPortal(
    <div
      className="modal-backdrop absolute inset-0 z-[75] grid place-items-center bg-ink/45 p-3 sm:p-5"
      onMouseDown={onClose}
    >
      <section
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="market-analysis-title"
        className="modal-panel market-analysis-dialog max-h-[76dvh] w-full overflow-y-auto rounded-3xl bg-paper p-4 shadow-modal sm:p-5"
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
              按需读取当前在售库
            </p>
          </div>
          <button
            ref={closeRef}
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
              综合价格、运费、数量、品相与结束时间。
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
    </div>,
    getShellOverlayRoot(),
  );
}

function SellerProfileDialog({
  sellerId,
  onClose,
  onOpenItem,
  onSendBundle,
  onBundleCopied,
  exchangeRate,
}: {
  sellerId: string;
  onClose: () => void;
  onOpenItem: (item: Item) => void;
  onSendBundle?: (items: Item[], targetPriceYen?: number | null) => void;
  onBundleCopied?: (itemIds: string[]) => void;
  exchangeRate?: number;
}) {
  const [data, setData] = useState<SellerAnalysis | null>(null);
  const [targetPrice, setTargetPrice] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [copiedBundleJa, setCopiedBundleJa] = useState(false);
  const [copiedBundleShare, setCopiedBundleShare] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const selectedItems = useMemo(
    () => (data?.items ?? []).filter((item) => selectedIds.has(item.id)),
    [data?.items, selectedIds],
  );
  const selectedTotalYen = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.priceCurrent, 0),
    [selectedItems],
  );
  const parsedTargetPriceYen = useMemo(() => {
    const num = Number(targetPrice.trim());
    return Number.isFinite(num) && num > 0 ? Math.round(num) : null;
  }, [targetPrice]);
  const toggleSelectItem = useCallback((itemId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);
  const copySelectedBundleScript = useCallback(() => {
    if (!selectedItems.length) return;
    const script = buildBundleNegotiationScript(
      selectedItems,
      parsedTargetPriceYen,
    );
    void navigator.clipboard?.writeText(script);
    setCopiedBundleJa(true);
    window.setTimeout(() => setCopiedBundleJa(false), 1800);
    onBundleCopied?.(selectedItems.map((item) => item.id));
  }, [onBundleCopied, parsedTargetPriceYen, selectedItems]);
  const copySelectedBundleShareText = useCallback(() => {
    if (!selectedItems.length) return;
    void navigator.clipboard?.writeText(
      buildBundleShareText(selectedItems, null, parsedTargetPriceYen),
    );
    setCopiedBundleShare(true);
    window.setTimeout(() => setCopiedBundleShare(false), 1800);
    onBundleCopied?.(selectedItems.map((item) => item.id));
  }, [onBundleCopied, parsedTargetPriceYen, selectedItems]);
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
  return createPortal(
    <div
      className="modal-backdrop absolute inset-0 z-[80] grid place-items-center bg-ink/50 p-3 sm:p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="seller-profile-title"
        className="modal-panel relative max-h-[88dvh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-paper p-4 shadow-modal sm:p-5"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold tracking-tight text-ink/50">
              商家画像 · 同店凑单工作台
            </p>
            <h2
              id="seller-profile-title"
              className="mt-0.5 font-heading text-xl font-black text-ink"
            >
              {data?.seller.name ?? "正在读取商家…"}
            </h2>
            {data?.seller && (
              <p className="mt-1 text-xs text-ink/55">
                {sourceName(
                  data.seller.source.key,
                  data.seller.source.displayName,
                )}{" "}
                · {data.items.length} 件在售 · 勾选多件可一键集合发给搭档合并砍价
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid h-10 w-10 place-items-center rounded-full border border-black/10 bg-white text-ink transition active:scale-95 hover:bg-fog"
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
          <LoadError
            message={error}
            onRetry={() => void load()}
            retryTestId="retry-seller-profile"
            className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-rust p-3 text-sm font-bold text-white"
            actionClassName="shrink-0 rounded-lg bg-white/20 px-3 py-1.5 text-xs font-bold text-white"
          />
        )}
        {data && (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.2fr]">
              <div className="rounded-2xl border border-black/[0.07] bg-white p-4">
                <div className="text-xs font-semibold text-ink/50">类型</div>
                <div className="mt-1 text-lg font-black text-ink">
                  {data.analysis.sellerType}
                </div>
                <p className="mt-2.5 text-sm leading-6 text-ink/75">
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
              <div className="rounded-2xl border border-black/[0.07] bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-ink/55">
                    {selectedItems.length > 0
                      ? `已选 ${selectedItems.length} 件合并砍价日语`
                      : "砍价语录"}
                  </div>
                  <span className="text-[10px] font-semibold text-moss">
                    {selectedItems.length > 0
                      ? "同店凑单模板"
                      : data.mode === "ai"
                        ? "AI"
                        : "规则建议"}
                  </span>
                </div>
                <p
                  lang="ja"
                  className="mt-2.5 max-h-36 overflow-y-auto whitespace-pre-wrap text-[13px] font-medium leading-6 text-ink"
                >
                  {selectedItems.length > 0
                    ? buildBundleNegotiationScript(
                        selectedItems,
                        parsedTargetPriceYen,
                      )
                    : (data.analysis.negotiationJa ?? data.analysis.negotiation)}
                </p>
                {selectedItems.length === 0 && (
                  <p className="mt-2.5 border-t border-ink/8 pt-2.5 text-[11px] leading-5 text-ink/55">
                    {data.analysis.negotiationZh}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <input
                    inputMode="numeric"
                    value={targetPrice}
                    onChange={(event) =>
                      setTargetPrice(event.target.value.replace(/[^\d]/g, ""))
                    }
                    placeholder={
                      selectedItems.length > 0
                        ? "目标打包总价（日元）"
                        : "目标价（日元）"
                    }
                    className="h-10 min-w-0 flex-1 rounded-xl border border-black/12 bg-fog/45 px-3 font-mono text-sm tabular-nums"
                  />
                  {selectedItems.length > 0 ? (
                    <button
                      type="button"
                      onClick={copySelectedBundleScript}
                      className="min-h-10 rounded-xl bg-ink px-3.5 text-xs font-semibold text-white transition active:scale-95"
                    >
                      {copiedBundleJa ? "✓ 已复制" : "复制日语"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void load(targetPrice)}
                      disabled={analyzing}
                      className="min-h-10 rounded-xl bg-moss px-3.5 text-xs font-bold text-white disabled:opacity-50"
                    >
                      {analyzing ? "生成中" : "生成"}
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-heading text-sm font-black text-ink">
                  该商家全部商品（勾选多件可集合分享）
                </h3>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedIds(
                        new Set(data.items.map((entry) => entry.id)),
                      )
                    }
                    className="rounded-lg bg-black/[0.05] px-2.5 py-1 text-xs font-semibold text-ink/75 transition active:scale-95 hover:bg-black/[0.09]"
                  >
                    全选当前 ({data.items.length})
                  </button>
                  {selectedIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedIds(new Set())}
                      className="rounded-lg bg-black/[0.05] px-2.5 py-1 text-xs font-semibold text-ink/60 transition active:scale-95 hover:bg-black/[0.09]"
                    >
                      清空 ({selectedIds.size})
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.items.map((item) => {
                  const previewImage = item.images?.[0];
                  const isChecked = selectedIds.has(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`flex min-w-0 items-center gap-2.5 rounded-2xl border p-2 text-left transition ${
                        isChecked
                          ? "border-ink bg-ink/[0.03] ring-1 ring-ink/15"
                          : "border-black/[0.07] bg-white hover:border-black/20"
                      }`}
                    >
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isChecked}
                        aria-label={`选择商品凑单：${itemDisplayTitle(item, "zh")}`}
                        onClick={() => toggleSelectItem(item.id)}
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg border text-xs font-bold transition active:scale-90 ${
                          isChecked
                            ? "border-ink bg-ink text-white"
                            : "border-black/20 bg-white text-transparent hover:border-ink"
                        }`}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenItem(item)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-ink">
                          {previewImage && (
                            <img
                              src={previewImage.url}
                              alt=""
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          )}
                        </div>
                        <span className="min-w-0 flex-1">
                          <b className="line-clamp-2 text-xs font-semibold leading-5 text-ink">
                            {itemDisplayTitle(item, "zh")}
                          </b>
                          <span className="mt-0.5 block font-mono text-[10px] font-bold text-rust tabular-nums">
                            {fmtYen(item.priceCurrent)} ·{" "}
                            {listingTypeLabel(item.listingType)}
                          </span>
                          <span className="block font-mono text-[9px] text-ink/45 tabular-nums">
                            {fmtCny(item.priceCurrent, exchangeRate)}
                          </span>
                          <YahooDiscount
                            sourceKey={item.source.key}
                            priceYen={item.priceCurrent}
                            exchangeRate={exchangeRate}
                          />
                        </span>
                      </button>
                    </div>
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
            {selectedItems.length > 0 && (
              <div className="sticky bottom-0 z-20 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white/95 p-3 shadow-modal backdrop-blur-md">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center rounded-full bg-ink px-2.5 py-0.5 text-xs font-bold text-white">
                      已选 {selectedItems.length} 件同店商品
                    </span>
                    <strong className="font-mono text-sm font-black text-ink tabular-nums">
                      合计 {fmtYen(selectedTotalYen)}
                    </strong>
                    <span className="font-mono text-xs text-ink/50 tabular-nums">
                      ({fmtCny(selectedTotalYen, exchangeRate)})
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-ink/55">目标总价：</span>
                    {[
                      {
                        label: "9折",
                        val: Math.round((selectedTotalYen * 0.9) / 100) * 100,
                      },
                      {
                        label: "85折",
                        val: Math.round((selectedTotalYen * 0.85) / 100) * 100,
                      },
                      {
                        label: "8折",
                        val: Math.round((selectedTotalYen * 0.8) / 100) * 100,
                      },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setTargetPrice(String(preset.val))}
                        className={`rounded-lg px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums transition active:scale-95 ${
                          targetPrice === String(preset.val)
                            ? "bg-ink text-white"
                            : "bg-black/[0.05] text-ink/75 hover:bg-black/[0.1]"
                        }`}
                      >
                        {preset.label} {fmtYen(preset.val)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={copySelectedBundleScript}
                    className="min-h-10 rounded-xl border border-black/12 bg-white px-3 text-xs font-semibold text-ink transition active:scale-95 hover:bg-black/[0.04]"
                  >
                    {copiedBundleJa ? "✓ 已复制合并日语" : "📋 复制合并日语"}
                  </button>
                  <button
                    type="button"
                    onClick={copySelectedBundleShareText}
                    className="min-h-10 rounded-xl border border-black/12 bg-white px-3 text-xs font-semibold text-ink transition active:scale-95 hover:bg-black/[0.04]"
                  >
                    {copiedBundleShare
                      ? "✓ 已复制链接+目标价"
                      : "复制链接+目标价"}
                  </button>
                  {onSendBundle && (
                    <button
                      type="button"
                      onClick={() =>
                        onSendBundle(
                          selectedItems.map((entry) => ({
                            ...entry,
                            seller: data.seller,
                          })),
                          parsedTargetPriceYen,
                        )
                      }
                      className="min-h-10 rounded-xl bg-ink px-4 text-xs font-semibold text-white shadow-sm transition active:scale-95 hover:bg-ink/90"
                    >
                      一键集合发给搭档 ({selectedItems.length} 件) →
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>,
    getShellOverlayRoot(),
  );
}

function DetailDrawer({
  item,
  language,
  translatedTitle,
  translatedDescription,
  translationError,
  onRetryTranslation,
  onClose,
  onSaved,
  onSendToManager,
  onOpenSeller,
  inCart,
  onToggleFavorite,
  onToggleCart,
  onShare,
  onPurchase,
  onIgnore,
  onDelete,
  exchangeRate,
  serverOffset,
}: {
  item: Item;
  language: "zh" | "original";
  translatedTitle?: string;
  translatedDescription?: string;
  translationError?: string;
  onRetryTranslation: () => void;
  onClose: () => void;
  onSaved: (item: Item) => void;
  onSendToManager: () => void;
  onOpenSeller?: (sellerId: string) => void;
  inCart: boolean;
  onToggleFavorite: () => void;
  onToggleCart: () => void;
  onShare: () => void;
  onPurchase: () => void;
  onIgnore: () => void;
  onDelete: () => void;
  exchangeRate?: number;
  serverOffset: number;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLDetailsElement>(null);
  useTransactionPresentation(dialogRef);
  const auction = useLiveAuctionTimeline(item, serverOffset);
  const cost = listingCostSummary(item);
  useDialogFocus({
    active: true,
    dialogRef,
    initialFocusRef: closeRef,
    onClose,
  });
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
  const [saveMessage, setSaveMessage] = useState("");
  const [aiFeedback, setAiFeedback] = useState<"correct" | "incorrect" | null>(
    null,
  );
  const purchaseAnalysis = (item.detailsZh ?? []).filter((field) =>
    field.path.startsWith("ai."),
  );
  const translatedPublicDetails = (item.detailsZh ?? []).filter(
    (field) => !field.path.startsWith("ai."),
  );
  const chinaComparison = chinaComparisonSummary(item);
  const chinaPrice = fmtCnyAmount(chinaComparison.priceCny);
  const chinaSourceUrl = chinaComparison.sourceUrl;
  const chinaOffers = chinaComparison.offers;
  const detailTitle = itemDisplayTitle(
    item,
    showOriginal ? "original" : "zh",
    translatedTitle,
  );
  const descriptionText = showOriginal
    ? (item.descriptionRaw ?? "无详情描述")
    : (translatedDescription ??
      item.descriptionZh ??
      item.descriptionRaw ??
      "无详情描述");
  async function save() {
    const quantity = draft.quantityEst.trim()
      ? Number(draft.quantityEst)
      : null;
    if (
      quantity !== null &&
      (!Number.isSafeInteger(quantity) || quantity < 1)
    ) {
      setSaveMessage("数量须为正整数");
      return;
    }
    setSaving(true);
    setSaveMessage("");
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
      if (!response.ok)
        throw new Error(await readFetchError(response, "保存失败，请重试"));
      onSaved((await response.json()).item);
      setSaveMessage("已保存");
    } catch (reason) {
      setSaveMessage(
        reason instanceof Error ? reason.message : "保存失败，请重试",
      );
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
  return createPortal(
    <div
      className="modal-backdrop product-detail-backdrop fixed inset-0 z-50"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-drawer-title"
        tabIndex={-1}
        className="modal-panel product-detail-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="product-detail-toolbar">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="返回上一步"
            title="返回上一步"
            className="detail-icon-button"
          >
            <ArrowLeftIcon />
          </button>
          <div className="min-w-0 flex-1">
            <h2 id="detail-drawer-title">商品详情</h2>
          </div>
          <button
            onClick={() => setShowOriginal((current) => !current)}
            aria-label={showOriginal ? "切换为中文" : "切换为原文"}
            title={showOriginal ? "中文" : "原文"}
            className="detail-language-button"
            aria-pressed={showOriginal}
          >
            <TranslateIcon />
            <span>{showOriginal ? "原文" : "中文"}</span>
          </button>
        </header>
        <div className="product-detail-scroll scrollbar-thin">
          <div className="product-detail-overview">
            <div className="product-detail-media">
              <ImageGallery
                images={item.images}
                alt={detailTitle}
                showThumbnails
                className="detail-gallery"
                imageClassName="object-contain"
              />
            </div>
            <div className="product-detail-identity">
              <p className="detail-platform">
                {sourceName(
                  item.source.key,
                  item.source.displayName,
                  item.sourceUrl,
                )}
                <span>·</span>
                {listingTypeLabel(item.listingType)}
              </p>
              <h3 className="detail-product-title">{detailTitle}</h3>
              <div className="detail-price">
                <span>
                  {item.listingType === "auction" ? "当前出价" : "商品价格"}
                </span>
                <strong>{fmtYen(item.priceCurrent)}</strong>
                <small>{fmtCny(item.priceCurrent, exchangeRate)}</small>
              </div>
              <YahooDiscount
                sourceKey={item.source.key}
                priceYen={item.priceCurrent}
                exchangeRate={exchangeRate}
              />
              <dl className="detail-key-facts">
                <div>
                  <dt>数量</dt>
                  <dd>
                    {item.quantityEst ? `${item.quantityEst} 件` : "待确认"}
                  </dd>
                </div>
                <div>
                  <dt>品相</dt>
                  <dd>{labels[item.conditionGrade] ?? "待确认"}</dd>
                </div>
                <div>
                  <dt>邮费</dt>
                  <dd>
                    {shippingLabel(item)}
                    {item.shippingFee != null && (
                      <small>{fmtCny(item.shippingFee, exchangeRate)}</small>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{cost.unitLabel}</dt>
                  <dd>{cost.unit == null ? "待确认" : fmtYen(cost.unit)}</dd>
                </div>
              </dl>
              <CostEstimatePanel
                priceYen={item.priceCurrent}
                shippingYen={item.shippingFee}
                quantity={item.quantityEst ?? undefined}
                exchangeRate={exchangeRate}
                listingType={item.listingType}
              />
              {auction && (
                <div className="detail-auction" aria-label="拍卖倒计时">
                  <span>
                    {auction.remainingMs <= 0 ? "拍卖已结束" : "距离结束"}
                  </span>
                  <strong>{auction.remaining}</strong>
                  <div
                    role="progressbar"
                    aria-label="拍卖进度"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(auction.progress * 100)}
                  >
                    <i style={{ transform: `scaleX(${auction.progress})` }} />
                  </div>
                </div>
              )}
              {item.seller?.name && (
                <p className="detail-seller-line flex flex-wrap items-center gap-2">
                  卖家 <span>{item.seller.name}</span>
                  {item.seller.id && onOpenSeller && (
                    <button
                      type="button"
                      onClick={() => {
                        const targetSellerId = item.seller?.id;
                        if (targetSellerId) onOpenSeller(targetSellerId);
                      }}
                      className="inline-flex items-center gap-1 rounded-full bg-black/[0.06] px-2.5 py-0.5 text-[11px] font-semibold text-ink transition active:scale-95 hover:bg-black/[0.1]"
                    >
                      查看同店商品 / 凑单 →
                    </button>
                  )}
                </p>
              )}
              {item.note && (
                <p className="detail-team-note">
                  <CommentIcon />
                  <span>{item.note}</span>
                </p>
              )}
            </div>
          </div>
          <div className="product-detail-reading">
            {!showOriginal && item.translationStatus !== "completed" && item.translationStatus !== "processing" && !translationError && (
              <div className="detail-translation-status">
                <span>需要中文内容时再翻译</span>
                <button type="button" onClick={onRetryTranslation}>翻译商品</button>
              </div>
            )}
            {!showOriginal &&
              (translationError || item.translationStatus === "processing") && (
                <div
                  role={translationError ? "alert" : "status"}
                  className={`detail-translation-status ${translationError ? "is-error" : "is-loading"}`}
                >
                  <span>
                    {translationError ? "翻译暂不可用" : "正在完整翻译…"}
                  </span>
                  {translationError && (
                    <button type="button" onClick={onRetryTranslation}>
                      重试
                    </button>
                  )}
                </div>
              )}
            <DetailDescription
              key={showOriginal ? "original" : "zh"}
              text={descriptionText}
            />
            <ProductReadingPanel key={`${item.id}:${item.updatedAt ?? item.lastSeenAt}`} itemId={item.id} version={item.updatedAt ?? item.lastSeenAt} />
            {item.shfLine && (
              <DetailDisclosure
                title="系列与版本"
                summary={labels[item.shfLine]}
              >
                <dl
                  className="shf-detail-summary mt-3"
                  aria-label="S.H.Figuarts 分类信息"
                >
                  <div>
                    <dt>产品线</dt>
                    <dd>{labels[item.shfLine]}</dd>
                  </div>
                  <div>
                    <dt>发售渠道</dt>
                    <dd>{labels[item.shfReleaseChannel ?? "unknown"]}</dd>
                  </div>
                  <div>
                    <dt>版本</dt>
                    <dd>{labels[item.shfEdition ?? "unknown"]}</dd>
                  </div>
                  <div>
                    <dt>地区</dt>
                    <dd>{labels[item.shfRegion ?? "unknown"]}</dd>
                  </div>
                </dl>
              </DetailDisclosure>
            )}
            <DetailDisclosure
              title="闲鱼同款"
              summary={chinaPrice ?? "暂无对比"}
            >
              <div className="detail-reference-summary">
                <div className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-ink/65">
                    {chinaPrice && chinaSourceUrl
                      ? `${chinaComparison.platformName}参考价`
                      : "中国参考价"}
                  </span>
                  {chinaPrice && chinaSourceUrl ? (
                    <b className="block truncate font-mono text-base tabular-nums text-ink">
                      {chinaPrice}
                    </b>
                  ) : (
                    <span className="block text-sm font-semibold text-ink/65">
                      暂无可验证的中国参考价
                    </span>
                  )}
                </div>
                {chinaPrice && chinaSourceUrl && (
                  <a
                    href={chinaSourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`打开${chinaComparison.platformName}原商品，参考价 ${chinaPrice}`}
                    className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-fog px-3 py-2 text-sm font-bold text-ink transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss"
                  >
                    查看原商品
                    <ExternalLinkIcon />
                  </a>
                )}
              </div>
              {chinaOffers.length > 0 && (
                <section
                  className="china-comparison-offers"
                  aria-labelledby="china-comparison-offers-title"
                >
                  <div className="china-comparison-offers-head">
                    <h4 id="china-comparison-offers-title">闲鱼同款对价</h4>
                    <span>{chinaOffers.length} 件可比在售</span>
                  </div>
                  <div className="china-comparison-offers-list">
                    {chinaOffers.map((offer) => (
                      <a
                        key={offer.sourceUrl}
                        href={offer.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="china-comparison-offer"
                      >
                        <span className="china-comparison-offer-image">
                          {offer.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={offer.imageUrl} alt="" loading="lazy" />
                          ) : (
                            <span aria-hidden="true">闲</span>
                          )}
                        </span>
                        <span className="china-comparison-offer-copy">
                          <strong>{offer.title}</strong>
                          <small>
                            {offer.condition || "品相以原商品页为准"}
                          </small>
                        </span>
                        <span className="china-comparison-offer-price">
                          <b>{fmtCnyAmount(offer.priceCny)}</b>
                          {offer.isReference && <small>参考中位</small>}
                        </span>
                      </a>
                    ))}
                  </div>
                </section>
              )}
              {item.valueKing && (
                <section
                  className="value-king-evidence"
                  aria-labelledby="value-king-evidence-title"
                >
                  <div className="value-king-evidence-head">
                    <span aria-hidden="true">♛</span>
                    <div>
                      <h4 id="value-king-evidence-title">性价比之王</h4>
                      <p>{item.valueKing.label}</p>
                    </div>
                  </div>
                  <dl>
                    <div>
                      <dt>到手总价</dt>
                      <dd>{fmtYen(item.valueKing.acquisitionCostJpy)}</dd>
                    </div>
                    <div>
                      <dt>单件成本</dt>
                      <dd>{fmtYen(item.valueKing.unitCostJpy)}</dd>
                    </div>
                    {item.valueKing.xianyuReferencePriceCny != null && <div>
                      <dt>闲鱼同款</dt>
                      <dd>
                        ¥
                        {Math.round(
                          item.valueKing.xianyuReferencePriceCny,
                        ).toLocaleString("zh-CN")}
                      </dd>
                    </div>}
                    {item.valueKing.referencePriceJpy != null && <div><dt>库内同款参考</dt><dd>{fmtYen(item.valueKing.referencePriceJpy)}</dd></div>}
                    {item.valueKing.savingsJpy != null && <div><dt>低于参考价</dt><dd>{fmtYen(item.valueKing.savingsJpy)}</dd></div>}
                    {item.valueKing.referenceBasis === "unit_cost" && <div><dt>入选依据</dt><dd>明确数量与超低单件成本</dd></div>}
                    {item.valueKing.netProfitJpy != null && <div>
                      <dt>已知费用后价差</dt>
                      <dd>{fmtYen(item.valueKing.netProfitJpy)}</dd>
                    </div>}
                  </dl>
                  <p>仍需在原商品页确认库存与最终交易条件。</p>
                </section>
              )}
            </DetailDisclosure>
            <DetailDisclosure title="品相与配送" summary={shippingLabel(item)}>
              {!showOriginal && item.conditionZh && (
                <p className="detail-long-copy">{item.conditionZh}</p>
              )}
              {!showOriginal && item.shippingZh && (
                <p className="detail-long-copy">{item.shippingZh}</p>
              )}
              <dl className="detail-metadata">
                <div>
                  <dt>品相</dt>
                  <dd>{labels[item.conditionGrade] ?? "待确认"}</dd>
                </div>
                <div>
                  <dt>配送费用</dt>
                  <dd>{shippingLabel(item)}</dd>
                </div>
                {item.locationText && (
                  <div>
                    <dt>发货地</dt>
                    <dd>{item.locationText}</dd>
                  </div>
                )}
                <div>
                  <dt>上架时间</dt>
                  <dd>{fmtDate(item.listedAt)}</dd>
                </div>
                <div>
                  <dt>最近核验</dt>
                  <dd>{fmtDate(item.lastSeenAt)}</dd>
                </div>
              </dl>
            </DetailDisclosure>
            {!showOriginal && purchaseAnalysis.length > 0 && (
              <DetailDisclosure title="AI 解读">
                <div className="flex items-center justify-between gap-3">
                  <span className="detail-meta-label">判断反馈</span>
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
              </DetailDisclosure>
            )}
            {item.sourceData && Object.keys(item.sourceData).length > 0 && (
              <DetailDisclosure title="平台完整信息">
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
              </DetailDisclosure>
            )}
            <DetailDisclosure
              title="编辑商品信息"
              detailsRef={editRef}
              className="detail-editor"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  [
                    "categoryIp",
                    "系列",
                    [
                      "kamen_rider",
                      "ultraman",
                      "super_sentai",
                      "godzilla",
                      "other",
                      "unknown",
                    ],
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
                  rows={2}
                  value={draft.note}
                  maxLength={NOTE_MAX_LENGTH}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      note: event.target.value.slice(0, NOTE_MAX_LENGTH),
                    })
                  }
                  className="rounded-xl border border-ink/15 p-3 text-sm text-ink"
                />
                <span className="text-right font-mono text-[10px] font-normal text-ink/40">
                  {draft.note.length}/{NOTE_MAX_LENGTH}
                </span>
              </label>
              <button
                disabled={saving}
                onClick={() => void save()}
                className="mt-4 min-h-12 w-full rounded-xl bg-moss px-4 py-3 font-black text-white disabled:opacity-50"
              >
                {saving ? "保存中…" : "保存修改"}
              </button>
              {saveMessage && (
                <p role="status" className="detail-save-message">
                  {saveMessage}
                </p>
              )}
            </DetailDisclosure>
          </div>
        </div>
        <footer className="detail-primary-actions product-detail-footer">
          {/* Decision bar: the same six actions as the card, wired to the
              same dashboard handlers, so the detail view is never a
              dead end. Favorite/cart reflect live item state. */}
          <div
            className="detail-decision-bar"
            role="group"
            aria-label="商品操作"
          >
            <button
              type="button"
              onClick={onToggleFavorite}
              aria-pressed={item.favorite}
              aria-label={item.favorite ? "取消收藏" : "收藏商品"}
              className={`detail-decision-button ${item.favorite ? "detail-decision-active-favorite" : ""}`}
            >
              <HeartIcon filled={item.favorite} />
              <span>{item.favorite ? "已收藏" : "收藏"}</span>
            </button>
            <button
              type="button"
              onClick={onToggleCart}
              aria-pressed={inCart}
              aria-label={inCart ? "移出购物车" : "加入购物车"}
              className={`detail-decision-button ${inCart ? "detail-decision-active-cart" : ""}`}
            >
              <CartIcon />
              <span>{inCart ? "已加入" : "购物车"}</span>
            </button>
            <button
              type="button"
              onClick={onShare}
              aria-label="分享商品原链接"
              className="detail-decision-button"
            >
              <ShareIcon />
              <span>分享</span>
            </button>
            <button
              type="button"
              onClick={onPurchase}
              aria-label="记录购买"
              className="detail-decision-button"
            >
              <MoneyIcon />
              <span>记录购买</span>
            </button>
            <button
              type="button"
              onClick={onIgnore}
              aria-label="标记为不感兴趣"
              className="detail-decision-button"
            >
              <ArchiveIcon />
              <span>不感兴趣</span>
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label="删除商品"
              className="detail-decision-button detail-decision-danger"
            >
              <TrashIcon />
              <span>删除</span>
            </button>
          </div>
          <div className="detail-footer-row">
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`打开${sourceName(item.source.key, item.source.displayName)}原商品页`}
              className="detail-source-action"
            >
              查看原商品 <ExternalLinkIcon />
            </a>
            <button
              type="button"
              className="detail-icon-button"
              onClick={onSendToManager}
              aria-label="发送给管理者"
              title="发送给管理者"
            >
              <MessageIcon />
            </button>
            <button
              type="button"
              className="detail-icon-button"
              aria-label="编辑商品信息"
              title="编辑商品信息"
              onClick={() => {
                if (!editRef.current) return;
                editRef.current.open = true;
                editRef.current.scrollIntoView({
                  block: "nearest",
                  behavior: "auto",
                });
                editRef.current
                  .querySelector("summary")
                  ?.focus({ preventScroll: true });
              }}
            >
              <CommentIcon />
            </button>
          </div>
        </footer>
      </aside>
    </div>,
    getShellOverlayRoot(),
  );
}

function PurchaseBundleHistoryDialog({
  bundle,
  onClose,
}: {
  bundle: PurchaseBundle;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const eventLabels: Record<PurchaseBundleAudit["eventType"], string> = {
    created: "创建记录",
    price_changed: "修改价格",
    members_changed: "调整商品",
    updated: "更新信息",
    archived: "合并归档",
  };
  const snapshotAmount = (value?: Record<string, unknown> | null) => {
    const amount = value?.totalPurchaseAmountYen;
    return typeof amount === "number" ? amount : null;
  };
  const snapshotMembers = (value?: Record<string, unknown> | null) =>
    Array.isArray(value?.members) ? value.members.length : null;
  return createPortal(
    <div
      className="modal-backdrop absolute inset-0 z-[89] grid place-items-center overflow-y-auto bg-ink/50 p-3 sm:p-6"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-history-title"
        className="modal-panel max-h-[84dvh] w-full max-w-lg overflow-y-auto rounded-3xl bg-paper p-4 shadow-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="purchase-history-title"
              className="font-heading text-xl font-bold text-ink"
            >
              变更历史
            </h2>
            <p className="mt-1 font-mono text-xs text-ink/45">
              当前版本 {bundle.version}
            </p>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label="关闭变更历史"
            className="grid h-11 w-11 place-items-center rounded-full bg-white shadow-sm"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="mt-4 grid gap-2">
          {(bundle.audits ?? []).length ? (
            bundle.audits?.map((audit) => {
              const beforeAmount = snapshotAmount(audit.beforeData);
              const afterAmount = snapshotAmount(audit.afterData);
              const beforeMembers = snapshotMembers(audit.beforeData);
              const afterMembers = snapshotMembers(audit.afterData);
              return (
                <article
                  key={audit.id}
                  className="rounded-2xl bg-white p-3 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-sm text-ink">
                      {eventLabels[audit.eventType]}
                    </strong>
                    <time className="font-mono text-[10px] text-ink/45">
                      {fmtDate(audit.createdAt)}
                    </time>
                  </div>
                  {beforeAmount != null && afterAmount != null && (
                    <p className="mt-2 font-mono text-xs font-semibold text-rust">
                      {fmtYen(beforeAmount)} → {fmtYen(afterAmount)}
                    </p>
                  )}
                  {beforeMembers != null && afterMembers != null && (
                    <p className="mt-1 text-xs text-ink/55">
                      商品 {beforeMembers} 件 → {afterMembers} 件
                    </p>
                  )}
                  <p className="mt-1 text-xs leading-5 text-ink/60">
                    {audit.reason}
                  </p>
                </article>
              );
            })
          ) : (
            <p className="rounded-2xl bg-white p-6 text-center text-sm text-ink/45">
              暂无变更历史
            </p>
          )}
        </div>
      </section>
    </div>,
    getShellOverlayRoot(),
  );
}

function PurchaseRecordsPanel({
  purchases,
  bundles,
  bundleCount,
  bundleGrandTotal,
  bundlePage,
  bundlePageCount,
  bundlesLoading,
  bundlesError,
  exchangeRate,
  onOpenItem,
  onOpenImages,
  onViewReceipt,
  onEditBundle,
  onOpenHistory,
  onLoadMoreBundles,
  onRetryBundles,
}: {
  purchases: PurchaseRecord[];
  bundles: PurchaseBundle[];
  bundleCount: number;
  bundleGrandTotal: number;
  bundlePage: number;
  bundlePageCount: number;
  bundlesLoading: boolean;
  bundlesError: string;
  exchangeRate?: number;
  onOpenItem: (item: Item) => void;
  onOpenImages: (item: Item) => void;
  onViewReceipt: (purchase: PurchaseRecord, receiptId: string) => void;
  onEditBundle: (bundle: PurchaseBundle) => void;
  onOpenHistory: (bundle: PurchaseBundle) => void;
  onLoadMoreBundles: () => void;
  onRetryBundles: () => void;
}) {
  const standalonePurchases = standalonePurchaseRecords(purchases);
  const standaloneTotal = standalonePurchases.reduce(
    (sum, purchase) => sum + purchase.purchaseAmount,
    0,
  );
  const completeTotal = authoritativePurchaseTotal(bundleGrandTotal);

  const purchaseRow = (purchase: PurchaseRecord) => {
    const item = purchase.item;
    const title = itemDisplayTitle(item, "zh");
    return (
      <div
        key={purchase.id}
        className="grid min-w-0 grid-cols-1 gap-2 border-t border-ink/8 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
      >
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onOpenItem(item)}
            className="line-clamp-2 w-full min-w-0 break-words text-left text-sm font-semibold leading-5 text-ink transition-colors hover:text-moss"
          >
            {title}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink/50">
            <span>{sourceName(item.source.key, item.source.displayName)}</span>
            <time>{fmtDate(purchase.purchasedAt)}</time>
            <strong className="font-mono font-semibold tabular-nums text-ink/70">
              {purchase.amountAllocated === false
                ? "计入打包总价"
                : fmtYen(purchase.purchaseAmount)}
            </strong>
          </div>
          {purchase.note && (
            <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-ink/60">
              {purchase.note}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <button
            type="button"
            disabled={!item.images.length}
            onClick={() => onOpenImages(item)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-fog px-3 text-xs font-semibold text-ink/70 disabled:opacity-35"
          >
            <PhotoIcon className="h-4 w-4" />
            查看图片
          </button>
          {purchase.receipts.map((receipt, index) => (
            <button
              key={receipt.id}
              type="button"
              onClick={() => onViewReceipt(purchase, receipt.id)}
              title={receipt.fileName}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-fog px-3 text-xs font-semibold text-ink/70"
            >
              <PhotoIcon className="h-4 w-4" />
              凭证{purchase.receipts.length > 1 ? index + 1 : ""}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <section
      aria-labelledby="purchase-records-title"
      className="ios-surface workspace-surface mb-4 rounded-2xl border border-blue-100 p-4 shadow-panel"
    >
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink/8 pb-4">
        <div>
          <h2
            id="purchase-records-title"
            className="font-heading text-xl font-black text-ink"
          >
            购买记录
          </h2>
          <p className="mt-1 text-xs text-ink/45">
            {purchases.length} 件商品 · {bundleCount} 个购买包
            {bundles.length < bundleCount
              ? ` · 已显示 ${bundles.length} 个`
              : ""}
          </p>
        </div>
        <div className="text-right">
          <span className="block text-[10px] font-semibold text-ink/45">
            总支出
          </span>
          <strong className="block font-mono text-2xl font-bold tabular-nums text-ink">
            {fmtYen(completeTotal)}
          </strong>
          <span className="block font-mono text-[10px] tabular-nums text-ink/45">
            {fmtCny(completeTotal, exchangeRate)}
          </span>
        </div>
      </div>

      {bundlesLoading && bundles.length === 0 ? (
        <p role="status" className="py-8 text-center text-sm text-ink/45">
          正在读取购买记录…
        </p>
      ) : bundlesError && bundles.length === 0 ? (
        <div className="grid justify-items-center gap-3 py-8 text-center">
          <p role="alert" className="text-sm font-semibold text-rust">
            {bundlesError}
          </p>
          <button
            type="button"
            onClick={onRetryBundles}
            className="min-h-11 rounded-xl bg-fog px-4 text-sm font-semibold text-ink"
          >
            重新读取
          </button>
        </div>
      ) : bundles.length === 0 && standalonePurchases.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink/45">暂无购买记录</p>
      ) : (
        <div className="purchase-history-list mt-3 grid min-w-0 grid-cols-1 gap-3">
          {bundles.map((bundle) => (
            <article
              key={bundle.id}
              className="purchase-history-card min-w-0 w-full rounded-2xl bg-white p-3 shadow-sm ring-1 ring-ink/5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-ink">
                    {bundle.purchases.length > 1
                      ? `打包购买 · ${bundle.purchases.length} 件`
                      : "单件购买"}
                  </h3>
                  <p className="mt-1 text-[11px] text-ink/45">
                    {fmtDate(bundle.purchasedAt)} · 版本 {bundle.version}
                  </p>
                  {bundle.note && (
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-ink/60">
                      {bundle.note}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <strong className="block font-mono text-lg font-bold tabular-nums text-ink">
                    {fmtYen(bundle.totalPurchaseAmount)}
                  </strong>
                  <span className="block font-mono text-[10px] tabular-nums text-ink/45">
                    {fmtCny(bundle.totalPurchaseAmount, exchangeRate)}
                  </span>
                </div>
              </div>
              <div className="mt-2">{bundle.purchases.map(purchaseRow)}</div>
              <div className="mt-2 flex flex-wrap justify-end gap-2 border-t border-ink/8 pt-3">
                <button
                  type="button"
                  onClick={() => onEditBundle(bundle)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-fog px-3 text-xs font-semibold text-ink/70"
                >
                  <EditIcon className="h-4 w-4" />
                  编辑 / 改价
                </button>
                <button
                  type="button"
                  onClick={() => onOpenHistory(bundle)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-ink px-3 text-xs font-semibold text-white"
                >
                  <HistoryIcon className="h-4 w-4" />
                  变更历史
                </button>
              </div>
            </article>
          ))}

          {standalonePurchases.length > 0 && (
            <article className="purchase-history-card min-w-0 w-full rounded-2xl bg-white p-3 shadow-sm ring-1 ring-ink/5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-ink">旧版单件记录</h3>
                <strong className="font-mono text-sm tabular-nums text-ink/70">
                  {fmtYen(standaloneTotal)}
                </strong>
              </div>
              <div className="mt-2">{standalonePurchases.map(purchaseRow)}</div>
            </article>
          )}

          {bundlePage < bundlePageCount && (
            <button
              type="button"
              disabled={bundlesLoading}
              onClick={onLoadMoreBundles}
              className="min-h-11 rounded-xl bg-fog px-4 text-sm font-semibold text-ink disabled:opacity-45"
            >
              {bundlesLoading
                ? "正在读取…"
                : `加载更多购买包（${bundles.length}/${bundleCount}）`}
            </button>
          )}
          {bundlesError && bundles.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rust/8 px-3 py-2">
              <p role="alert" className="text-xs font-semibold text-rust">
                {bundlesError}
              </p>
              <button
                type="button"
                onClick={onRetryBundles}
                className="min-h-11 rounded-xl bg-white px-3 text-xs font-semibold text-ink"
              >
                重试
              </button>
            </div>
          )}
        </div>
      )}
    </section>
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
  return createPortal(
    <div
      className="modal-backdrop absolute inset-0 z-[70] grid place-items-center bg-ink/60 p-4"
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
          {itemDisplayTitle(item, "zh", translatedTitle)}
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
    </div>,
    getShellOverlayRoot(),
  );
}

function DeleteConfirmationDialog({
  item,
  translatedTitle,
  onCancel,
  onConfirm,
}: {
  item: Item;
  translatedTitle?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void | boolean>;
}) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  async function confirm() {
    setSaving(true);
    setFailed(false);
    try {
      const ok = await onConfirm();
      if (ok === false) {
        setFailed(true);
        return;
      }
      onCancel();
    } finally {
      setSaving(false);
    }
  }
  return createPortal(
    <div
      className="modal-backdrop absolute inset-0 z-[70] grid place-items-center bg-ink/60 p-4"
      onMouseDown={saving ? undefined : onCancel}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
        className="modal-panel w-full max-w-sm rounded-3xl bg-paper p-5 shadow-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="grid h-11 w-11 place-items-center rounded-full bg-rust/10 text-rust">
          <TrashIcon className="h-5 w-5" />
        </div>
        <h2 id="delete-dialog-title" className="mt-4 text-lg font-black">
          删除这件商品？
        </h2>
        <p
          id="delete-dialog-description"
          className="mt-2 line-clamp-2 text-sm leading-6 text-ink/60"
        >
          {itemDisplayTitle(item, "zh", translatedTitle)}
        </p>
        <p className="mt-3 text-sm leading-6 text-ink/60">
          删除只把这件商品从平台移除，不影响扫描与推荐，也不会进入不感兴趣列表；删除后无法恢复。
        </p>
        {failed && (
          <p role="alert" className="mt-3 text-sm font-bold text-rust">
            删除失败，商品已恢复显示，请重试。
          </p>
        )}
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
            {saving ? "处理中…" : "确认删除"}
          </button>
        </div>
      </section>
    </div>,
    getShellOverlayRoot(),
  );
}

export default function Dashboard() {
  const dashboardRef = useRef<HTMLElement>(null);
  const analyzedUrlTimerRef = useRef<number | null>(null);
  const inventoryRequestRef = useRef<AbortController | null>(null);
  const inventoryRequestVersionRef = useRef(0);
  const animatedItemIdsRef = useRef(new Set<string>());
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [listingCounts, setListingCounts] = useState({
    auction: 0,
    direct: 0,
    unknown: 0,
  });
  const [urgentAuctionPool, setUrgentAuctionPool] = useState<Item[]>([]);
  const [urgentAuctionsLoading, setUrgentAuctionsLoading] = useState(true);
  const [urgentAuctionsError, setUrgentAuctionsError] = useState("");
  const [favoriteChangeBatch, setFavoriteChangeBatch] =
    useState<FavoriteChangeBatch>();
  const [page, setPage] = useState(1);
  const [overview, setOverview] = useState<MonitoringOverview | null>(null);
  const [overviewError, setOverviewError] = useState("");
  const [overviewRefreshVersion, setOverviewRefreshVersion] = useState(0);
  const [monitoringCategories, setMonitoringCategories] = useState<MonitoringCategory[]>([]);
  const loadMonitoringCategories = useCallback(async () => {
    try {
      const response = await fetch(`${API}/monitoring/config`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) return;
      const payload = (await response.json()) as { categories?: MonitoringCategory[] };
      if (Array.isArray(payload.categories)) setMonitoringCategories(payload.categories);
    } catch { /* The monitoring workspace retains its own actionable retry state. */ }
  }, []);
  useEffect(() => { void loadMonitoringCategories(); }, [loadMonitoringCategories]);
  const [filters, setFilters] = useState<Filters>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [serverOffset, setServerOffset] = useState(0);
  const [nowTick, setNowTick] = useState(0);
  const [selected, setSelected] = useState<Item | null>(null);
  const detailReturnFocusRef = useRef<HTMLElement | null>(null);
  const detailWasOpenRef = useRef(false);
  const detailHistoryActiveRef = useRef(false);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [urlMessage, setUrlMessage] = useState("");
  const [urlSubmitting, setUrlSubmitting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterDialogRef = useRef<HTMLElement>(null);
  const filterCloseRef = useRef<HTMLButtonElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  useDialogFocus({
    active: filtersOpen,
    dialogRef: filterDialogRef,
    initialFocusRef: filterCloseRef,
    returnFocusRef: filterTriggerRef,
    onClose: () => setFiltersOpen(false),
  });
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsAiSummary, setSettingsAiSummary] = useState("");
  useEffect(() => {
    if (!settingsOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${API}/ai/resources`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`API ${response.status}`);
        const data = (await response.json()) as {
          configured?: boolean;
          available?: boolean;
          model?: string;
          todayTokens?: number;
          dailyTokenLimit?: number;
          remainingLocalBudget?: number;
          expiresAt?: string | null;
        };
        if (cancelled) return;
        const remaining =
          typeof data.remainingLocalBudget === "number"
            ? data.remainingLocalBudget
            : 0;
        const expiry = data.expiresAt ? new Date(data.expiresAt) : null;
        const status = !data.configured
          ? "尚未配置"
          : data.available
            ? "赠送资源规则已启用"
            : "调用已暂停";
        setSettingsAiSummary(
          `${data.model ?? "智谱"} · ${status}；今日已用 ${(
            data.todayTokens ?? 0
          ).toLocaleString("zh-CN")} / ${(
            data.dailyTokenLimit ?? 0
          ).toLocaleString("zh-CN")} tokens · 剩余约 ${remaining.toLocaleString("zh-CN")} tokens${
            expiry
              ? ` · 赠送包 ${expiry.getMonth() + 1} 月 ${expiry.getDate()} 日到期`
              : ""
          }`,
        );
      } catch {
        if (!cancelled) setSettingsAiSummary("额度状态暂不可用");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settingsOpen]);
  const settingsDialogRef = useRef<HTMLElement>(null);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  useDialogFocus({
    active: settingsOpen,
    dialogRef: settingsDialogRef,
    initialFocusRef: settingsCloseRef,
    returnFocusRef: settingsTriggerRef,
    onClose: () => setSettingsOpen(false),
  });
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [language, setLanguage] = useState<"zh" | "original">("zh");
  const [listingMode, setListingMode] = useState<ListingType>("direct");
  const inventoryQueryKey = JSON.stringify([
    listingMode,
    page,
    Object.entries(filters).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  ]);
  const inventoryQueryKeyRef = useRef(inventoryQueryKey);
  inventoryQueryKeyRef.current = inventoryQueryKey;
  const [workspace, setWorkspace] = useState<Workspace>(DEFAULT_WORKSPACE);
  const [catalogView, setCatalogView] = useState<CatalogView>("browse");
  const [purchasesTab, setPurchasesTab] = useState<PurchasesTab>("records");
  const [costToolSegment, setCostToolSegment] =
    useState<CostToolSegment>("calculator");
  const chatVisitedRef = useRef(false);
  if (workspace === "collaboration") chatVisitedRef.current = true;
  const [workspaceTrail, setWorkspaceTrail] = useState<Workspace[]>([]);
  const [recentWorkspaces, setRecentWorkspaces] = useState<
    RecentWorkspaceEntry[]
  >([]);
  const [managerAccounts, setManagerAccounts] = useState<ManagerAccount[]>([]);
  const [activeManagerId, setActiveManagerId] = useState("");
  const [managerAccountsLoading, setManagerAccountsLoading] = useState(true);
  const [managerAccountsError, setManagerAccountsError] = useState("");
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [pendingDecisionCount, setPendingDecisionCount] = useState<
    number | null
  >(null);
  const purchasedItemIdsRef = useRef<ReadonlySet<string>>(new Set());
  const dislikedItemIdsRef = useRef<ReadonlySet<string>>(new Set());
  const [todoCount, setTodoCount] = useState(0);
  const [accountGateOpen, setAccountGateOpen] = useState(true);
  const [shellOverlayRoot, setShellOverlayRoot] = useState<HTMLElement | null>(
    null,
  );
  const [pendingChatItem, setPendingChatItem] =
    useState<CollaborationItem | null>(null);
  const [pendingChatBundle, setPendingChatBundle] =
    useState<PendingCollaborationBundle | null>(null);
  const [bundleShareItems, setBundleShareItems] = useState<Item[]>([]);
  const workspaceScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const workspaceMotionPreference = useReducedMotion();
  const workspaceHasNavigatedRef = useRef(false);
  const workspacePointerInputRef = useRef(false);
  const previousWorkspaceMotionRef = useRef<Workspace>(DEFAULT_WORKSPACE);
  const workspaceAnimationRef = useRef<Animation | null>(null);
  const workspaceScrollRef = useRef(new Map<Workspace, number>());
  const pendingWorkspaceScrollRestoreRef = useRef<{
    workspace: Workspace;
    top: number;
  } | null>(null);
  const workspaceUrlSyncedRef = useRef(false);
  const workspaceHistoryDepthRef = useRef(0);
  const workspaceStateRef = useRef<WorkspaceNavigationState>({
    workspace: DEFAULT_WORKSPACE,
    trail: [],
  });
  const recentWorkspacesRef = useRef<RecentWorkspaceEntry[]>([]);
  const [imports, setImports] = useState<UrlImport[]>([]);
  const [importsError, setImportsError] = useState("");
  const [importsExpanded, setImportsExpanded] = useState(false);
  const [importActionId, setImportActionId] = useState<string | null>(null);
  const [linkItems, setLinkItems] = useState<Item[]>([]);
  const [linkError, setLinkError] = useState("");
  const [linkTotal, setLinkTotal] = useState(0);
  const [linkPage, setLinkPage] = useState(1);
  const [linkPageCount, setLinkPageCount] = useState(1);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [purchasesError, setPurchasesError] = useState("");
  const [purchaseBundles, setPurchaseBundles] = useState<PurchaseBundle[]>([]);
  const [purchaseBundlesTotal, setPurchaseBundlesTotal] = useState(0);
  const [purchaseGrandTotal, setPurchaseGrandTotal] = useState(0);
  const [purchaseBundlesPage, setPurchaseBundlesPage] = useState(1);
  const [purchaseBundlesPageCount, setPurchaseBundlesPageCount] = useState(1);
  const [purchaseBundlesLoading, setPurchaseBundlesLoading] = useState(true);
  const [purchaseBundlesError, setPurchaseBundlesError] = useState("");
  const [purchaseLinkInput, setPurchaseLinkInput] = useState("");
  const [purchaseLinkMessage, setPurchaseLinkMessage] = useState("");
  const [purchaseLinkSubmitting, setPurchaseLinkSubmitting] = useState(false);
  const [purchaseLinkJobs, setPurchaseLinkJobs] = useState<PurchaseLinkJob[]>(
    [],
  );
  const [selectedPurchaseJobIds, setSelectedPurchaseJobIds] = useState<
    string[]
  >([]);
  const [purchaseRegistration, setPurchaseRegistration] = useState<{
    items: PurchaseRegistrationItem[];
    candidateItems?: PurchaseRegistrationItem[];
    bundle?: PurchaseBundle | null;
    initialTotal?: number;
    initialAmounts?: Record<string, number>;
    platform?: string;
  } | null>(null);
  const [purchaseHistoryBundle, setPurchaseHistoryBundle] =
    useState<PurchaseBundle | null>(null);
  const [analysis, setAnalysis] = useState<MarketAnalysis | null>(null);
  const [ignoreItem, setIgnoreItem] = useState<Item | null>(null);
  const [deleteItem, setDeleteItem] = useState<Item | null>(null);
  const [dislikedItems, setDislikedItems] = useState<Item[]>([]);
  const [dislikedError, setDislikedError] = useState("");
  const [dislikedTotal, setDislikedTotal] = useState(0);
  const [dislikedPage, setDislikedPage] = useState(1);
  const [dislikedPageCount, setDislikedPageCount] = useState(1);
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null);
  const [exchangeRateFailed, setExchangeRateFailed] = useState(false);
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
  const [purchaseReceiptPreview, setPurchaseReceiptPreview] =
    useState<PurchaseReceiptPreviewRequest | null>(null);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translationErrors, setTranslationErrors] = useState<
    Record<string, string>
  >({});
  const translationRequestedRef = useRef(new Set<string>());
  const detailTranslationOpenIdRef = useRef<string | null>(null);
  const changeCursorRef = useRef(new Date(Date.now() - 2 * 60 * 60_000).toISOString());
  const changeSyncInFlightRef = useRef(false);
  const favoriteChangeSequenceRef = useRef(0);
  const itemsRef = useRef<Item[]>([]);
  const inventoryPageItemsRef = useRef<Item[]>([]);
  const itemSignature = [...items, ...linkItems]
    .map((item) => item.id)
    .join("|");
  const activeManager = useMemo(
    () =>
      managerAccounts.find((account) => account.id === activeManagerId) ?? null,
    [activeManagerId, managerAccounts],
  );

  const loadManagerAccounts = useCallback(async () => {
    setManagerAccountsLoading(true);
    setManagerAccountsError("");
    try {
      const stored = window.localStorage.getItem(MANAGER_ACCOUNT_STORAGE_KEY);
      const accountQuery = stored
        ? `?accountId=${encodeURIComponent(stored)}`
        : "";
      const response = await fetch(
        `${API}/collaboration/accounts${accountQuery}`,
        {
          cache: "no-store",
        },
      );
      if (!response.ok)
        throw new Error(`账号服务暂不可用（${response.status}）`);
      const payload = (await response.json()) as {
        accounts?: ManagerAccount[];
        unreadCount?: number;
      };
      const accounts = (payload.accounts ?? []).filter(
        (account) => account.active,
      );
      if (accounts.length !== 2) throw new Error("两位管理者账号尚未准备完成");
      setManagerAccounts(accounts);
      setUnreadMessageCount(payload.unreadCount ?? 0);
      const selected = accounts.find((account) => account.id === stored);
      if (selected) {
        setActiveManagerId(selected.id);
        setAccountGateOpen(false);
      } else {
        setAccountGateOpen(true);
      }
    } catch (reason) {
      setManagerAccountsError(
        reason instanceof Error ? reason.message : "账号服务暂不可用",
      );
      setAccountGateOpen(true);
    } finally {
      setManagerAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadManagerAccounts();
  }, [loadManagerAccounts]);

  const refreshCollaborationMeta = useCallback(
    async (signal?: AbortSignal) => {
      if (!activeManagerId) return;
      const response = await fetch(`${API}/collaboration/presence`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: activeManagerId }),
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error("协作状态同步失败");
      const payload = (await response.json()) as {
        accounts?: ManagerAccount[];
        unreadCount?: number;
      };
      if (payload.accounts) setManagerAccounts(payload.accounts);
      setUnreadMessageCount(payload.unreadCount ?? 0);
      // The messages badge counts items still awaiting a decision, not
      // unread texts. The review-queue builder is the single source for
      // what "pending" means; a failure here keeps the previous count
      // and the unread fallback in the navigation.
      try {
        const accountQuery = `?accountId=${encodeURIComponent(activeManagerId)}`;
        const [roundsResponse, messagesResponse] = await Promise.all([
          fetch(`${API}/collaboration/share-rounds${accountQuery}`, {
            cache: "no-store",
            signal,
          }),
          fetch(`${API}/collaboration/messages${accountQuery}`, {
            cache: "no-store",
            signal,
          }),
        ]);
        if (roundsResponse.ok && messagesResponse.ok) {
          const roundsPayload = (await roundsResponse.json()) as {
            rounds?: ShareRoundLike[];
          };
          const messagesPayload = (await messagesResponse.json()) as {
            messages?: ShareMessageLike[];
          };
          setPendingDecisionCount(
            buildReviewQueue(
              roundsPayload.rounds ?? [],
              messagesPayload.messages ?? [],
              activeManagerId,
              purchasedItemIdsRef.current,
              dislikedItemIdsRef.current,
            ).length,
          );
        }
      } catch {
        /* keep the previous pending count */
      }
    },
    [activeManagerId],
  );

  useEffect(() => {
    if (!activeManagerId) return;
    const poller = createVisibilityPoller({
      task: (signal) => refreshCollaborationMeta(signal),
      intervalMs: 12_000,
      maxBackoffMs: 60_000,
      isPaused: () => document.hidden,
    });
    const onVisibility = () =>
      document.hidden ? poller.pause() : poller.resume();
    poller.start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", poller.resume);
    return () => {
      poller.stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", poller.resume);
    };
  }, [activeManagerId, refreshCollaborationMeta]);

  useLayoutEffect(() => {
    setShellOverlayRoot(getShellOverlayRoot());
  }, []);

  useEffect(() => {
    if (!accountGateOpen) return;
    const body = document.body;
    const root = document.documentElement;
    const scrollY = window.scrollY;
    const previous = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    root.classList.add("manager-gate-open");
    body.classList.add("manager-gate-open");
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    return () => {
      root.classList.remove("manager-gate-open");
      body.classList.remove("manager-gate-open");
      body.style.overflow = previous.overflow;
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      window.scrollTo({ top: scrollY, behavior: "auto" });
    };
  }, [accountGateOpen]);

  useEffect(() => {
    inventoryPageItemsRef.current = items;
    itemsRef.current = [...items, ...linkItems, ...urgentAuctionPool];
  }, [items, linkItems, urgentAuctionPool]);

  useLayoutEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    try {
      const stored = JSON.parse(
        window.sessionStorage.getItem(WORKSPACE_SCROLL_STORAGE_KEY) ?? "{}",
      ) as Record<string, unknown>;
      for (const [key, value] of Object.entries(stored)) {
        const parsedWorkspace = parseWorkspaceParam(key);
        if (
          parsedWorkspace &&
          typeof value === "number" &&
          Number.isFinite(value)
        ) {
          workspaceScrollRef.current.set(parsedWorkspace, Math.max(0, value));
        }
      }
    } catch {
      window.sessionStorage.removeItem(WORKSPACE_SCROLL_STORAGE_KEY);
    }
    const storedRecentWorkspaces = parseRecentWorkspaceEntries(
      window.sessionStorage.getItem(RECENT_WORKSPACES_STORAGE_KEY),
    );
    recentWorkspacesRef.current = storedRecentWorkspaces;
    setRecentWorkspaces(storedRecentWorkspaces);

    if (!workspaceUrlSyncedRef.current) {
      workspaceUrlSyncedRef.current = true;
      // Pre-fold deep links (?workspace=favorites etc.) land on the
      // catalog with the matching view preselected.
      const legacyView = legacyCatalogView(
        new URLSearchParams(window.location.search).get("workspace"),
      );
      // Retired standalone pages (?workspace=profile / ai / operations)
      // land on the workbench, where their content lives now.
      const legacyRedirect = legacyWorkspaceRedirect(
        new URLSearchParams(window.location.search).get("workspace"),
      );
      // Pre-merge deep links (?workspace=orders, or
      // ?workspace=purchases&tab=orders) land on the inventory tab of
      // the merged purchases workspace; ?workspace=calculator/logistics
      // land on the matching segment of the merged cost tool.
      const legacyTab = legacyPurchasesTab(
        new URLSearchParams(window.location.search).get("workspace"),
      );
      const legacySegment = legacyCostToolSegment(
        new URLSearchParams(window.location.search).get("workspace"),
      );
      const fromUrl =
        parseWorkspaceParam(
          new URLSearchParams(window.location.search).get("workspace"),
        ) ??
        (legacyView ? ("catalog" as const) : null) ??
        (legacyTab ? ("purchases" as const) : null) ??
        (legacySegment ? ("cost-tool" as const) : null) ??
        legacyRedirect ??
        DEFAULT_WORKSPACE;
      if (legacyView) setCatalogView(legacyView);
      if (legacyTab) setPurchasesTab(legacyTab);
      else if (fromUrl === "purchases") {
        const tabParam = parsePurchasesTabParam(
          new URLSearchParams(window.location.search).get("tab"),
        );
        if (tabParam) setPurchasesTab(tabParam);
      }
      if (legacySegment) setCostToolSegment(legacySegment);
      const initial = initialWorkspaceNavigationState(fromUrl);
      workspaceStateRef.current = initial;
      workspaceHistoryDepthRef.current = 0;
      setWorkspace(initial.workspace);
      setWorkspaceTrail(initial.trail);
      const initialScroll =
        workspaceScrollRef.current.get(initial.workspace) ??
        readWorkspaceScrollTop(
          workspaceScrollContainerRef.current,
          window.scrollY,
        );
      window.history.replaceState(
        withWorkspaceHistoryState(window.history.state, {
          ...initial,
          depth: 0,
          scrollY: initialScroll,
        }),
        "",
        window.location.href,
      );
      if (initialScroll > 0) {
        restoreWorkspaceScroll(
          initialScroll,
          workspaceScrollContainerRef.current,
        );
      }
    }

    const onPopState = (event: PopStateEvent) => {
      const detailItemId = parseItemDetailHistoryState(event.state);
      if (detailItemId) {
        detailHistoryActiveRef.current = true;
        void fetch(`${API}/items/${encodeURIComponent(detailItemId)}`, {
          cache: "no-store",
        })
          .then(async (response) => {
            if (!response.ok) return null;
            const payload = (await response.json()) as { item?: Item };
            return payload.item ?? null;
          })
          .then((item) => {
            if (
              item &&
              parseItemDetailHistoryState(window.history.state) === item.id
            )
              setSelected(item);
          })
          .catch(() => undefined);
      } else if (detailHistoryActiveRef.current) {
        detailHistoryActiveRef.current = false;
        setSelected(null);
      }
      const current = workspaceStateRef.current;
      workspaceHasNavigatedRef.current = true;
      workspaceScrollRef.current.set(
        current.workspace,
        readWorkspaceScrollTop(
          workspaceScrollContainerRef.current,
          window.scrollY,
        ),
      );
      const fromHistory = parseWorkspaceHistoryState(event.state);
      const legacyView = legacyCatalogView(
        new URLSearchParams(window.location.search).get("workspace"),
      );
      // Retired standalone pages (?workspace=profile / ai / operations)
      // land on the workbench, where their content lives now.
      const legacyRedirect = legacyWorkspaceRedirect(
        new URLSearchParams(window.location.search).get("workspace"),
      );
      // Pre-merge deep links (?workspace=orders, or
      // ?workspace=purchases&tab=orders) land on the inventory tab of
      // the merged purchases workspace; ?workspace=calculator/logistics
      // land on the matching segment of the merged cost tool.
      const legacyTab = legacyPurchasesTab(
        new URLSearchParams(window.location.search).get("workspace"),
      );
      const legacySegment = legacyCostToolSegment(
        new URLSearchParams(window.location.search).get("workspace"),
      );
      const fromUrl =
        parseWorkspaceParam(
          new URLSearchParams(window.location.search).get("workspace"),
        ) ??
        (legacyView ? ("catalog" as const) : null) ??
        (legacyTab ? ("purchases" as const) : null) ??
        (legacySegment ? ("cost-tool" as const) : null) ??
        legacyRedirect ??
        DEFAULT_WORKSPACE;
      if (legacyView) setCatalogView(legacyView);
      if (legacyTab) setPurchasesTab(legacyTab);
      else if (fromUrl === "purchases") {
        const tabParam = parsePurchasesTabParam(
          new URLSearchParams(window.location.search).get("tab"),
        );
        if (tabParam) setPurchasesTab(tabParam);
      }
      if (legacySegment) setCostToolSegment(legacySegment);
      const next = fromHistory ?? {
        ...initialWorkspaceNavigationState(fromUrl),
        depth: 0,
        scrollY: 0,
      };
      workspaceHistoryDepthRef.current = next.depth;
      workspaceStateRef.current = {
        workspace: next.workspace,
        trail: next.trail,
      };
      pendingWorkspaceScrollRestoreRef.current = {
        workspace: next.workspace,
        top:
          workspaceScrollRef.current.get(next.workspace) ?? next.scrollY ?? 0,
      };
      setWorkspace(next.workspace);
      setWorkspaceTrail(next.trail);
    };
    const onPageHide = () => {
      const current = workspaceStateRef.current;
      const top = readWorkspaceScrollTop(
        workspaceScrollContainerRef.current,
        window.scrollY,
      );
      workspaceScrollRef.current.set(current.workspace, top);
      persistWorkspaceScrollPositions();
      replaceCurrentWorkspaceHistory(top);
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  useEffect(() => {
    workspaceStateRef.current = { workspace, trail: workspaceTrail };
  }, [workspace, workspaceTrail]);

  useLayoutEffect(() => {
    const pending = pendingWorkspaceScrollRestoreRef.current;
    if (!pending || pending.workspace !== workspace) return;
    pendingWorkspaceScrollRestoreRef.current = null;
    restoreWorkspaceScroll(pending.top, workspaceScrollContainerRef.current);
  }, [workspace]);

  useLayoutEffect(() => {
    const previous = previousWorkspaceMotionRef.current;
    previousWorkspaceMotionRef.current = workspace;
    const node = workspaceScrollContainerRef.current;
    const inFlight = workspaceAnimationRef.current;
    const currentOpacity = inFlight && node ? getComputedStyle(node).opacity : "0.78";
    const currentTransform = inFlight && node ? getComputedStyle(node).transform : "translate3d(0, 12px, 0) scale(.995)";
    inFlight?.cancel();
    workspaceAnimationRef.current = null;
    if (!node || previous === workspace || !workspaceHasNavigatedRef.current || workspaceMotionPreference || !workspacePointerInputRef.current || typeof node.animate !== "function") return;
    const persistentWindow = workspace === "collaboration";
    const animation = node.animate([
      { opacity: currentOpacity, transform: persistentWindow ? "none" : currentTransform },
      { opacity: 1, transform: "none" },
    ], { duration: motionTokens.duration.spatial * 1000, easing: "cubic-bezier(.23,1,.32,1)", fill: "none" });
    workspaceAnimationRef.current = animation;
    void animation.finished.then(() => {
      if (workspaceAnimationRef.current === animation) workspaceAnimationRef.current = null;
    }).catch(() => undefined);
  }, [workspace, workspaceMotionPreference]);
  useEffect(() => () => workspaceAnimationRef.current?.cancel(), []);

  const publishFavoriteChanges = useCallback(
    (changes: FavoriteSyncChange[]) => {
      if (!changes.length) return;
      setFavoriteChangeBatch({
        sequence: ++favoriteChangeSequenceRef.current,
        changes,
      });
    },
    [],
  );

  const commitInventoryAvailability = useCallback((next: Item[]) => {
    const previous = inventoryPageItemsRef.current;
    if (previous === next) return;
    const nextIds = new Set(next.map((item) => item.id));
    const removed = previous.filter((item) => !nextIds.has(item.id));
    inventoryPageItemsRef.current = next;
    setItems(next);
    if (!removed.length) return;
    setTotal((current) => Math.max(0, current - removed.length));
    setListingCounts((current) => ({
      auction: Math.max(0, current.auction - removed.filter((item) => item.listingType === "auction").length),
      direct: Math.max(0, current.direct - removed.filter((item) => item.listingType === "direct").length),
      unknown: Math.max(0, current.unknown - removed.filter((item) => item.listingType === "unknown").length),
    }));
  }, []);

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

  const requestFullItemTranslation = useCallback(
    async (item: Item, options: { retry?: boolean } = {}) => {
      if (item.translationStatus === "completed" && !options.retry) return;
      if (
        !beginDetailTranslationAttempt(
          translationRequestedRef.current,
          item.id,
          options,
        )
      )
        return;
      setTranslationErrors((current) => {
        if (!current[item.id]) return current;
        const next = { ...current };
        delete next[item.id];
        return next;
      });
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
        setUrgentAuctionPool((current) =>
          current.map((entry) =>
            entry.id === item.id ? { ...entry, ...translated } : entry,
          ),
        );
        setSelected((current) =>
          current?.id === item.id ? { ...current, ...translated } : current,
        );
      } catch (reason) {
        // Keep this attempt registered for the whole open cycle. A transient
        // failure must not turn selected-state updates into an automatic
        // request loop. The retry button or a later reopen starts a new try.
        const message =
          reason instanceof Error ? reason.message : "翻译服务不可用";
        setTranslationErrors((current) => ({ ...current, [item.id]: message }));
        setSelected((current) =>
          current?.id === item.id
            ? { ...current, translationStatus: "failed" }
            : current,
        );
      }
    },
    [],
  );

  useEffect(() => {
    const currentId = selected?.id ?? null;
    const previousId = detailTranslationOpenIdRef.current;
    if (previousId && previousId !== currentId) {
      endDetailTranslationSession(translationRequestedRef.current, previousId);
    }
    detailTranslationOpenIdRef.current = currentId;
  }, [selected?.id]);

  useEffect(() => {
    if (selected) {
      detailWasOpenRef.current = true;
      return;
    }
    if (!detailWasOpenRef.current) return;
    detailWasOpenRef.current = false;
    const target = detailReturnFocusRef.current;
    detailReturnFocusRef.current = null;
    restoreDialogReturnFocus(target);
  }, [selected]);

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
      const nodes = gsap.utils.toArray<HTMLElement>(".js-product-card").filter(
        (node) =>
          node.dataset.itemId &&
          !animatedItemIdsRef.current.has(node.dataset.itemId) &&
          (() => {
            const bounds = node.getBoundingClientRect();
            return bounds.top < window.innerHeight && bounds.bottom > 0;
          })(),
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
    inventoryRequestRef.current?.abort();
    const controller = new AbortController();
    const requestVersion = inventoryRequestVersionRef.current + 1;
    inventoryRequestVersionRef.current = requestVersion;
    const requestQueryKey = inventoryQueryKey;
    inventoryRequestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams(
        Object.entries(filters).filter(([, value]) => value),
      );
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String((page - 1) * PAGE_SIZE));
      params.set("listingType", listingMode);
      const response = await fetch(`${API}/items?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(
          await readFetchError(response, "商品库暂时无法读取，请稍后重试"),
        );
      const data = await response.json();
      if (
        controller.signal.aborted ||
        inventoryRequestVersionRef.current !== requestVersion ||
        inventoryQueryKeyRef.current !== requestQueryKey
      )
        return;
      const nextItems = retainAvailableMarketListings(data.items as Item[]);
      inventoryPageItemsRef.current = nextItems;
      setItems(nextItems);
      setTotal(Math.max(0, data.total - (data.items.length - nextItems.length)));
      setListingCounts(
        data.facets ?? {
          auction: nextItems.filter((item) => item.listingType === "auction")
            .length,
          direct: nextItems.filter((item) => item.listingType === "direct")
            .length,
          unknown: nextItems.filter((item) => item.listingType === "unknown")
            .length,
        },
      );
      const lastPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
      if (page > lastPage) setPage(lastPage);
      setServerOffset(new Date(data.serverTime).getTime() - Date.now());
    } catch (reason) {
      if (
        controller.signal.aborted ||
        inventoryRequestVersionRef.current !== requestVersion ||
        inventoryQueryKeyRef.current !== requestQueryKey
      )
        return;
      setError(reason instanceof Error ? reason.message : "加载失败");
    } finally {
      if (
        inventoryRequestRef.current === controller &&
        inventoryRequestVersionRef.current === requestVersion &&
        inventoryQueryKeyRef.current === requestQueryKey
      ) {
        inventoryRequestRef.current = null;
        setLoading(false);
      }
    }
  }, [filters, inventoryQueryKey, listingMode, page]);

  const loadUrgentAuctions = useCallback(async () => {
    setUrgentAuctionsLoading(true);
    setUrgentAuctionsError("");
    try {
      const params = new URLSearchParams(
        Object.entries(filters).filter(([, value]) => value),
      );
      params.delete("auctionHours");
      params.set("listingType", "auction");
      params.set("auctionMinutes", "30");
      params.set("sortBy", "auctionEndAt");
      params.set("sortOrder", "asc");
      params.set("limit", "100");
      params.set("offset", "0");
      const firstResponse = await fetch(`${API}/items?${params}`, {
        cache: "no-store",
      });
      if (!firstResponse.ok)
        throw new Error(
          await readFetchError(
            firstResponse,
            "临期拍卖暂时无法读取，请稍后重试",
          ),
        );
      const first = (await firstResponse.json()) as {
        items?: Item[];
        total?: number;
        serverTime?: string;
      };
      const expectedTotal = first.total ?? first.items?.length ?? 0;
      const collected = [...(first.items ?? [])];
      let nextOffset = collected.length;
      while (nextOffset < expectedTotal) {
        params.set("offset", String(nextOffset));
        const response = await fetch(`${API}/items?${params}`, {
          cache: "no-store",
        });
        if (!response.ok)
          throw new Error(
            await readFetchError(response, "临期拍卖暂时无法读取，请稍后重试"),
          );
        const pagePayload = (await response.json()) as { items?: Item[] };
        const batch = pagePayload.items ?? [];
        if (!batch.length) break;
        collected.push(...batch);
        nextOffset += batch.length;
      }
      setUrgentAuctionPool(retainAvailableMarketListings(collected));
      if (first.serverTime)
        setServerOffset(new Date(first.serverTime).getTime() - Date.now());
    } catch (reason) {
      setUrgentAuctionsError(
        reason instanceof Error ? reason.message : "临期拍卖加载失败",
      );
    } finally {
      setUrgentAuctionsLoading(false);
    }
  }, [filters]);

  const loadImports = useCallback(async () => {
    try {
      const response = await fetch(`${API}/imports`, { cache: "no-store" });
      if (!response.ok) throw new Error(`API ${response.status}`);
      setImports((await response.json()).imports ?? []);
      setImportsError("");
    } catch {
      setImportsError("导入任务加载失败，当前列表可能不是最新状态。");
    }
  }, []);
  const loadLinkItems = useCallback(
    async (requestedPage = linkPage) => {
      const safePage = Math.max(1, requestedPage);
      try {
        const response = await fetch(
          `${API}/items?importOrigin=url&limit=${AUXILIARY_PAGE_SIZE}&offset=${(safePage - 1) * AUXILIARY_PAGE_SIZE}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`API ${response.status}`);
        const payload = (await response.json()) as {
          items?: Item[];
          total?: number;
        };
        const nextItems = retainAvailableMarketListings((payload.items ?? []) as Item[]);
        setLinkItems(nextItems);
        const nextTotal = payload.total ?? nextItems.length;
        const nextPageCount = Math.max(
          1,
          Math.ceil(nextTotal / AUXILIARY_PAGE_SIZE),
        );
        setLinkTotal(nextTotal);
        setLinkPageCount(nextPageCount);
        setLinkPage(Math.min(safePage, nextPageCount));
        setLinkError("");
      } catch {
        setLinkError("已导入商品加载失败，当前列表可能不是最新状态。");
      }
    },
    [linkPage],
  );
  const loadExchangeRate = useCallback(async () => {
    try {
      const response = await fetch(`${API}/exchange-rate`, {
        cache: "no-store",
      });
      if (response.ok) {
        setExchangeRate((await response.json()) as ExchangeRate);
        setExchangeRateFailed(false);
      } else {
        setExchangeRateFailed(true);
      }
    } catch {
      // Non-blocking: prices keep rendering in yen and the catalog shows
      // a quiet note until a later poll recovers the rate.
      setExchangeRateFailed(true);
    }
  }, []);
  const loadCart = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`${API}/cart`, {
      cache: "no-store",
      signal,
    });
    if (!response.ok)
      throw new Error(`购物车同步失败（API ${response.status}）`);
    const next = (await response.json()) as CartPayload;
    setCart(next);
  }, []);
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
        if (!response.ok) throw new Error(`API ${response.status}`);
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
        setDislikedError("");
      } catch {
        setDislikedError("不感兴趣列表加载失败，当前列表可能不是最新状态。");
      }
    },
    [dislikedPage],
  );
  const loadPurchases = useCallback(async () => {
    try {
      const response = await fetch(`${API}/items/purchases`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`API ${response.status}`);
      const payload = (await response.json()) as {
        purchases?: PurchaseRecord[];
        totalPurchaseAmountYen?: number;
      };
      setPurchases(payload.purchases ?? []);
      if (payload.totalPurchaseAmountYen != null) {
        setPurchaseGrandTotal(payload.totalPurchaseAmountYen);
      }
      setPurchasesError("");
    } catch {
      setPurchasesError(`${TERMS.purchases}加载失败，请稍后重试`);
    }
  }, []);
  const loadPurchaseBundles = useCallback(async (pageToLoad = 1) => {
    setPurchaseBundlesLoading(true);
    setPurchaseBundlesError("");
    try {
      const response = await fetch(
        `${API}/items/purchases/bundles?page=${pageToLoad}&limit=${PURCHASE_BUNDLE_PAGE_SIZE}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`API ${response.status}`);
      const payload = (await response.json()) as {
        bundles?: PurchaseBundle[];
        total?: number;
        page?: number;
        pageCount?: number;
        grandTotalPurchaseAmountYen?: number;
      };
      setPurchaseBundles((current) =>
        pageToLoad === 1
          ? (payload.bundles ?? [])
          : mergePurchaseBundlePage(current, payload.bundles ?? []),
      );
      setPurchaseBundlesTotal(payload.total ?? payload.bundles?.length ?? 0);
      setPurchaseGrandTotal(payload.grandTotalPurchaseAmountYen ?? 0);
      setPurchaseBundlesPage(payload.page ?? pageToLoad);
      setPurchaseBundlesPageCount(payload.pageCount ?? 1);
    } catch (reason) {
      setPurchaseBundlesError(
        reason instanceof Error ? reason.message : "购买记录读取失败",
      );
    } finally {
      setPurchaseBundlesLoading(false);
    }
  }, []);

  const completedPurchaseJobs = useMemo(
    () =>
      purchaseLinkJobs.filter((job) => job.state === "completed" && job.item),
    [purchaseLinkJobs],
  );

  const updatePurchaseLinkJob = useCallback(
    (jobId: string, patch: Partial<PurchaseLinkJob>) => {
      setPurchaseLinkJobs((current) =>
        current.map((job) =>
          job.jobId === jobId ? { ...job, ...patch } : job,
        ),
      );
    },
    [],
  );

  // Purchase analyses are persisted server-side, so rebuild the workspace
  // list from the database on mount and merge it with whatever polling
  // state is already in memory instead of starting empty after a refresh.
  const loadPurchaseAnalyses = useCallback(async () => {
    try {
      const response = await fetch(`${API}/items/purchases/analyses`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        analyses?: {
          id: string;
          jobId?: string | null;
          url: string;
          state?: PurchaseLinkJob["state"];
          progress?: number;
          item?: Item | null;
          failedReason?: string | null;
          suggestedAmountYen?: number | null;
          suggestedAmountSource?: "actual" | "listing" | null;
          paidAmountYen?: number | null;
        }[];
      };
      const rows = payload.analyses ?? [];
      if (!rows.length) return;
      setPurchaseLinkJobs((current) => {
        const byJobId = new Map(current.map((job) => [job.jobId, job]));
        const merged: PurchaseLinkJob[] = [];
        for (const row of rows) {
          if (!row.jobId) continue;
          const existing = byJobId.get(row.jobId);
          byJobId.delete(row.jobId);
          const persistedTerminal =
            row.state === "completed" || row.state === "failed";
          merged.push({
            jobId: row.jobId,
            importId: row.id,
            url: row.url,
            state: existing
              ? persistedTerminal
                ? row.state!
                : existing.state
              : (row.state ?? "waiting"),
            progress: persistedTerminal
              ? (row.progress ?? 100)
              : Math.max(existing?.progress ?? 0, row.progress ?? 0),
            item: existing?.item ?? row.item ?? null,
            failedReason: existing?.failedReason ?? row.failedReason ?? null,
            suggestedAmountYen:
              existing?.suggestedAmountYen ?? row.suggestedAmountYen ?? null,
            suggestedAmountSource:
              existing?.suggestedAmountSource ??
              row.suggestedAmountSource ??
              null,
            paidAmountYen: row.paidAmountYen ?? existing?.paidAmountYen ?? null,
          });
        }
        // Jobs submitted in this session that the list has not caught up
        // with yet stay at the front.
        return [...byJobId.values(), ...merged].slice(0, 40);
      });
    } catch {
      // The persisted list is a recovery aid; live polling still works
      // without it, so a failed load leaves the current list untouched.
    }
  }, []);

  const pollPurchaseLinkJob = useCallback(
    async (jobId: string) => {
      try {
        const response = await fetch(
          `${API}/items/purchases/analyze-links/${encodeURIComponent(jobId)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          state?: PurchaseLinkJob["state"];
          progress?: number;
          item?: Item | null;
          failedReason?: string | null;
          pricingOptions?: {
            perItem?: {
              suggestedAmountYen?: number | null;
              suggestedAmountSource?: "actual" | "listing" | null;
            } | null;
          } | null;
        };
        if (!response.ok) {
          updatePurchaseLinkJob(jobId, {
            state: "failed",
            progress: 100,
            item: null,
            failedReason: "购买链接分析任务已过期，请重新提交",
          });
          return;
        }
        updatePurchaseLinkJob(jobId, {
          state: payload.state ?? "waiting",
          progress: Number(payload.progress ?? 0),
          item: payload.item ?? null,
          failedReason: payload.failedReason ?? null,
          suggestedAmountYen:
            payload.pricingOptions?.perItem?.suggestedAmountYen ?? null,
          suggestedAmountSource:
            payload.pricingOptions?.perItem?.suggestedAmountSource ?? null,
        });
      } catch {
        updatePurchaseLinkJob(jobId, {
          failedReason: "网络暂时不可用，稍后会自动重试",
        });
      }
    },
    [updatePurchaseLinkJob],
  );

  const submitPurchaseLinks = useCallback(async () => {
    const { urls, amountsByUrl } = parsePurchaseLinkInput(purchaseLinkInput);
    if (!urls.length) {
      setPurchaseLinkMessage("请至少输入一个有效的公开商品链接");
      return;
    }
    setPurchaseLinkSubmitting(true);
    setPurchaseLinkMessage("");
    try {
      const response = await fetch(`${API}/items/purchases/analyze-links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          urls,
          ...(Object.keys(amountsByUrl).length ? { amountsByUrl } : {}),
        }),
      });
      const payload = (await response
        .json()
        .catch(() => ({ error: `API ${response.status}` }))) as {
        results?: {
          url: string;
          accepted: boolean;
          jobId?: string | number;
          importId?: string;
          error?: string;
        }[];
        acceptedCount?: number;
        rejectedCount?: number;
        message?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          payload.message ?? payload.error ?? `API ${response.status}`,
        );
      const results = payload.results ?? [];
      const acceptedJobs = results
        .filter((entry) => entry.accepted && entry.jobId != null)
        .map((entry) => ({
          jobId: String(entry.jobId),
          importId: entry.importId ?? null,
          url: entry.url,
          state: "waiting" as const,
          progress: 0,
          item: null,
          failedReason: null,
          paidAmountYen: amountsByUrl[entry.url] ?? null,
        }));
      if (!acceptedJobs.length)
        throw new Error(
          results.find((entry) => !entry.accepted)?.error ??
            "链接未加入分析队列",
        );
      setPurchaseLinkJobs((current) => {
        const existing = new Set(current.map((job) => job.jobId));
        return [
          ...acceptedJobs.filter((job) => !existing.has(job.jobId)),
          ...current,
        ].slice(0, 40);
      });
      setSelectedPurchaseJobIds([]);
      setPurchaseLinkInput(
        results
          .filter((entry) => !entry.accepted)
          .map((entry) =>
            amountsByUrl[entry.url]
              ? `${entry.url} ${amountsByUrl[entry.url]}`
              : entry.url,
          )
          .join("\n"),
      );
      setPurchaseLinkMessage(
        `已提交 ${payload.acceptedCount ?? acceptedJobs.length} 个链接${payload.rejectedCount ? `，${payload.rejectedCount} 个未接受` : ""}`,
      );
      await Promise.all(
        acceptedJobs.map((job) => pollPurchaseLinkJob(job.jobId)),
      );
    } catch (reason) {
      setPurchaseLinkMessage(
        friendlyImportError(
          reason instanceof Error ? reason.message : "购买链接分析失败",
        ),
      );
    } finally {
      setPurchaseLinkSubmitting(false);
    }
  }, [pollPurchaseLinkJob, purchaseLinkInput]);

  const registrationItemFromItem = useCallback(
    (item: Item): PurchaseRegistrationItem => ({
      itemId: item.id,
      title: itemDisplayTitle(item, "zh", translations[`${item.id}:title`]),
      imageUrl: item.images[0]?.url ?? null,
      platform: item.source.displayName,
      sourceUrl: item.sourceUrl,
      amountYen: item.purchaseRecord?.purchaseAmount ?? item.priceTotalEst,
      quantity: item.purchaseRecord?.quantityOverride ?? null,
      quantityEst: item.quantityEst ?? null,
    }),
    [translations],
  );

  const openPurchaseRegistrationForItem = useCallback(
    (item: Item) => {
      setPurchaseRegistration({ items: [registrationItemFromItem(item)] });
    },
    [registrationItemFromItem],
  );

  const openPurchaseRegistrationForJobs = useCallback(
    (jobs: PurchaseLinkJob[]) => {
      const nextItems = jobs
        .map((job) => job.item)
        .filter((item): item is Item => Boolean(item));
      if (!nextItems.length) return;
      // Prefill from the price the analysis suggested for each item: the
      // actual paid amount when one was entered with the link, otherwise
      // the listing price the API falls back to.
      const initialAmounts = Object.fromEntries(
        jobs
          .filter((job) => job.item && job.suggestedAmountYen != null)
          .map((job) => [job.item!.id, job.suggestedAmountYen!]),
      );
      const everyItemPriced = nextItems.every(
        (item) => initialAmounts[item.id] != null,
      );
      setPurchaseRegistration({
        items: nextItems.map(registrationItemFromItem),
        ...(Object.keys(initialAmounts).length ? { initialAmounts } : {}),
        ...(everyItemPriced
          ? {
              initialTotal: nextItems.reduce(
                (sum, item) => sum + initialAmounts[item.id],
                0,
              ),
            }
          : {}),
      });
    },
    [registrationItemFromItem],
  );

  const openPurchaseRegistrationForBundle = useCallback(
    (bundle: PurchaseBundle) => {
      setPurchaseRegistration({
        items: bundle.purchases.map((purchase) =>
          registrationItemFromItem(purchase.item),
        ),
        candidateItems: [
          ...bundle.purchases.map((purchase) => purchase.item),
          ...purchases.map((purchase) => purchase.item),
          ...completedPurchaseJobs
            .map((job) => job.item)
            .filter((item): item is Item => Boolean(item)),
        ].map(registrationItemFromItem),
        bundle,
      });
    },
    [completedPurchaseJobs, purchases, registrationItemFromItem],
  );

  const openPurchaseRegistrationForTodo = useCallback(
    (entry: {
      id: string;
      title: string;
      imageUrl: string | null;
      priceYen: number | null;
      sourceName: string | null;
    }) => {
      const full =
        [...items, ...linkItems].find((item) => item.id === entry.id) ??
        completedPurchaseJobs.find((job) => job.item?.id === entry.id)?.item ??
        null;
      if (full) {
        openPurchaseRegistrationForItem(full);
        return;
      }
      setPurchaseRegistration({
        items: [
          {
            itemId: entry.id,
            title: entry.title,
            imageUrl: entry.imageUrl,
            platform: entry.sourceName,
            amountYen: entry.priceYen,
          },
        ],
      });
    },
    [completedPurchaseJobs, items, linkItems, openPurchaseRegistrationForItem],
  );

  const openPurchaseHistory = useCallback(async (bundle: PurchaseBundle) => {
    try {
      const response = await fetch(
        `${API}/items/purchases/bundles/${encodeURIComponent(bundle.id)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("无法读取购买变更历史");
      const payload = (await response.json()) as { bundle?: PurchaseBundle };
      setPurchaseHistoryBundle(payload.bundle ?? bundle);
    } catch (reason) {
      setPurchaseLinkMessage(
        reason instanceof Error ? reason.message : "无法读取购买变更历史",
      );
    }
  }, []);
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
    } catch (reason) {
      setAnalysisError(
        reason instanceof Error ? reason.message : "AI 分析暂时不可用",
      );
    } finally {
      setAnalysisLoading(false);
    }
  }, []);
  const syncChanges = useCallback(
    async (signal?: AbortSignal) => {
      if (changeSyncInFlightRef.current || document.hidden) return;
      changeSyncInFlightRef.current = true;
      try {
        type ChangePage = {
          changes?: FavoriteItemPatch[];
          nextCursor?: string;
          serverTime?: string;
          hasMore?: boolean;
        };
        const changes: NonNullable<ChangePage["changes"]> = [];
        let nextChangeCursor = changeCursorRef.current;
        let hasMore = true;
        let pageCount = 0;
        while (hasMore && pageCount < 20) {
          const since = encodeURIComponent(nextChangeCursor);
          const response = await fetch(`${API}/items/changes?since=${since}`, {
            cache: "no-store",
            signal,
          });
          if (!response.ok)
            throw new Error(`协作同步失败（API ${response.status}）`);
          const data = (await response.json()) as ChangePage;
          changes.push(...(data.changes ?? []));
          const pageCursor = data.nextCursor ?? data.serverTime;
          if (pageCursor) nextChangeCursor = pageCursor;
          hasMore = data.hasMore === true && Boolean(pageCursor);
          pageCount += 1;
        }
        signal?.throwIfAborted();
        changeCursorRef.current = nextChangeCursor;
        if (!changes.length) return;
        const changesById = new Map<string, FavoriteItemPatch>();
        for (const change of changes) {
          const previous = changesById.get(change.id);
          changesById.set(change.id, { ...previous, ...change });
        }
        const latestChanges = [...changesById.values()];
        const merge = (current: Item[]) =>
          current
            .map((item) => {
              const changed = changesById.get(item.id);
              return changed && !isOlderFavoriteChange(item, changed)
                ? { ...item, ...changed } : item;
            })
            .filter((item) => isAvailableMarketListing(item));
        commitInventoryAvailability(merge(inventoryPageItemsRef.current));
        setLinkItems(merge);
        setUrgentAuctionPool(merge);
        publishFavoriteChanges(
          latestChanges.map((change) => {
            const source = itemsRef.current.find(
              (item) => item.id === change.id,
            );
            return {
              patch: change,
              ...(source ? { item: { ...source, ...change } } : {}),
            };
          }),
        );
        setDislikedItems((current) => {
          const next = current
            .map((item) => {
              const changed = changesById.get(item.id);
              return changed ? { ...item, ...changed } : item;
            })
            .filter((item) => item.ignored && !item.archivedAt);
          for (const changed of latestChanges) {
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
          const changed = changesById.get(current.id);
          return changed ? { ...current, ...changed } : current;
        });
      } finally {
        changeSyncInFlightRef.current = false;
      }
    },
    [commitInventoryAvailability, publishFavoriteChanges],
  );

  useEffect(() => {
    const timeout = setTimeout(() => void load(), 250);
    return () => clearTimeout(timeout);
  }, [load]);
  useEffect(() => {
    const timeout = window.setTimeout(() => void loadUrgentAuctions(), 250);
    const timer = window.setInterval(() => void loadUrgentAuctions(), 60_000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(timer);
    };
  }, [loadUrgentAuctions]);
  useEffect(() => {
    void Promise.all([
      loadImports(),
      loadLinkItems(),
      loadDisliked(),
      loadPurchases(),
      loadPurchaseBundles(),
      loadPurchaseAnalyses(),
    ]);
    const timer = setInterval(
      () =>
        void Promise.all([
          loadImports(),
          loadLinkItems(),
          loadDisliked(),
          loadPurchases(),
          loadPurchaseBundles(),
          loadPurchaseAnalyses(),
        ]),
      30_000,
    );
    return () => clearInterval(timer);
  }, [
    loadImports,
    loadLinkItems,
    loadDisliked,
    loadPurchases,
    loadPurchaseBundles,
    loadPurchaseAnalyses,
  ]);
  useEffect(() => {
    void loadExchangeRate();
    const rateTimer = window.setInterval(
      () => void loadExchangeRate(),
      15 * 60_000,
    );
    return () => window.clearInterval(rateTimer);
  }, [loadExchangeRate]);
  useEffect(() => {
    const isPaused = () => document.hidden;
    const cartPoller = createVisibilityPoller({
      task: (signal) => loadCart(signal),
      intervalMs: 2_000,
      maxBackoffMs: 60_000,
      isPaused,
    });
    const changesPoller = createVisibilityPoller({
      task: (signal) => syncChanges(signal),
      intervalMs: 2_000,
      maxBackoffMs: 60_000,
      isPaused,
    });
    const resumeVisiblePollers = () => {
      if (document.hidden) return;
      cartPoller.resume();
      changesPoller.resume();
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        cartPoller.pause();
        changesPoller.pause();
      } else {
        resumeVisiblePollers();
      }
    };

    cartPoller.start();
    changesPoller.start(false);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", resumeVisiblePollers);
    return () => {
      cartPoller.stop();
      changesPoller.stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", resumeVisiblePollers);
    };
  }, [loadCart, syncChanges]);
  useEffect(() => {
    const activeJobs = purchaseLinkJobs.filter(
      (job) =>
        job.state === "waiting" ||
        job.state === "queued" ||
        job.state === "active" ||
        job.state === "delayed",
    );
    if (!activeJobs.length) return;
    void Promise.all(activeJobs.map((job) => pollPurchaseLinkJob(job.jobId)));
    const timer = window.setInterval(
      () =>
        void Promise.all(
          activeJobs.map((job) => pollPurchaseLinkJob(job.jobId)),
        ),
      3_000,
    );
    return () => window.clearInterval(timer);
  }, [pollPurchaseLinkJob, purchaseLinkJobs]);
  useEffect(() => {
    const needsLiveClock =
      workspace === "inventory" ||
      workspace === "catalog" ||
      urgentAuctionPool.some(
        (item) => item.listingType === "auction" && item.auctionEndAt,
      );
    if (!needsLiveClock) return;
    const update = () => {
      setNowTick(Date.now());
      // Expiry is a clock event even when no crawler/audit has run yet. Keep
      // stable array references until something actually leaves the market.
      commitInventoryAvailability(retainAvailableMarketListings(inventoryPageItemsRef.current));
      setLinkItems((current) => retainAvailableMarketListings(current));
      setUrgentAuctionPool((current) => retainAvailableMarketListings(current));
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [commitInventoryAvailability, urgentAuctionPool, workspace]);
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
        if (!response.ok) throw new Error("市场数据暂时无法更新，请重试");
        const data = (await response.json()) as MonitoringOverview;
        if (active) { setOverview(data); setOverviewError(""); }
      } catch {
        if (active) setOverviewError("市场数据暂时无法更新，请重试");
      }
    }
    void refreshOverview();
    const timer = setInterval(() => void refreshOverview(), 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [overviewRefreshVersion]);
  useEffect(() => {
    if (
      !filtersOpen &&
      !selected &&
      !purchaseRegistration &&
      !deleteItem &&
      !ignoreItem &&
      !analysisOpen &&
      !settingsOpen &&
      !purchaseReceiptPreview &&
      !sellerId &&
      !cartOpen &&
      !purchaseGallery &&
      !purchaseHistoryBundle
    )
      return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (filtersOpen) setFiltersOpen(false);
      else if (selected) return;
      else if (purchaseRegistration) setPurchaseRegistration(null);
      else if (deleteItem) setDeleteItem(null);
      else if (ignoreItem) setIgnoreItem(null);
      else if (analysisOpen) setAnalysisOpen(false);
      else if (settingsOpen) setSettingsOpen(false);
      else if (cartOpen) setCartOpen(false);
      else if (purchaseGallery) setPurchaseGallery(null);
      else if (purchaseHistoryBundle) setPurchaseHistoryBundle(null);
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
    settingsOpen,
    purchaseReceiptPreview,
    filtersOpen,
    deleteItem,
    ignoreItem,
    purchaseRegistration,
    selected,
    sellerId,
    cartOpen,
    purchaseGallery,
    purchaseHistoryBundle,
  ]);
  useEffect(
    () => () => {
      if (analyzedUrlTimerRef.current != null)
        window.clearTimeout(analyzedUrlTimerRef.current);
      inventoryRequestRef.current?.abort();
    },
    [],
  );

  function beginInventoryQueryTransition() {
    inventoryRequestVersionRef.current += 1;
    inventoryRequestRef.current?.abort();
    inventoryRequestRef.current = null;
    setItems([]);
    setTotal(0);
    setListingCounts({ auction: 0, direct: 0, unknown: 0 });
    setLoading(true);
    setError("");
  }
  function changeFilter(name: string, value: string) {
    beginInventoryQueryTransition();
    setPage(1);
    setFilters((current) => {
      const next = { ...current, [name]: value };
      if (name === "ip" || name === "collection") delete next.monitoringCategoryId;
      if (name === "collection") {
        if (value === "sic") next.ip = "kamen_rider";
        if (
          value === "shf" &&
          next.ip &&
          !["kamen_rider", "ultraman"].includes(next.ip)
        )
          next.ip = "";
        if (value !== "shf") {
          delete next.shfLine;
          delete next.shfReleaseChannel;
          delete next.shfEdition;
          delete next.shfRegion;
        }
      }
      if (name === "ip") {
        const collectionCompatible =
          !next.collection ||
          (next.collection === "shf" &&
            ["", "kamen_rider", "ultraman"].includes(value)) ||
          (next.collection === "sic" && value === "kamen_rider");
        if (!collectionCompatible) {
          delete next.collection;
          delete next.shfLine;
          delete next.shfReleaseChannel;
          delete next.shfEdition;
          delete next.shfRegion;
        }
      }
      return next;
    });
  }
  function selectHomeCategory(key: string) {
    beginInventoryQueryTransition();
    setPage(1);
    setFilters((current) => {
      const next: Filters = { ...current, ip: key === "all" ? "" : key };
      delete next.monitoringCategoryId;
      delete next.collection;
      delete next.shfLine;
      delete next.shfReleaseChannel;
      delete next.shfEdition;
      delete next.shfRegion;
      delete next.valueKing;
      return next;
    });
  }
  function selectHomeCollection(key: string, categoryIp: string) {
    beginInventoryQueryTransition();
    setPage(1);
    setFilters((current) => {
      const next: Filters = { ...current, collection: key, ip: categoryIp };
      delete next.monitoringCategoryId;
      if (key !== "shf") {
        delete next.shfLine;
        delete next.shfReleaseChannel;
        delete next.shfEdition;
        delete next.shfRegion;
      }
      delete next.valueKing;
      return next;
    });
  }
  function resetFilters() {
    beginInventoryQueryTransition();
    setPage(1);
    setFilters({});
  }
  function changeListingMode(mode: ListingType) {
    if (mode === listingMode && filters.valueKing !== "true") return;
    beginInventoryQueryTransition();
    setPage(1);
    setListingMode(mode);
    setFilters((current) => {
      if (current.valueKing !== "true") return current;
      const next = { ...current };
      delete next.valueKing;
      return next;
    });
  }
  function openCatalog() {
    if (filters.valueKing === "true") beginInventoryQueryTransition();
    setFilters((current) => {
      if (current.valueKing !== "true") return current;
      const next = { ...current };
      delete next.valueKing;
      return next;
    });
    setCatalogView("browse");
    navigateWorkspace("catalog");
  }
  function openCatalogCategory(key: string) {
    selectHomeCategory(key);
    setCatalogView("browse");
    navigateWorkspace("catalog");
  }
  function openCatalogCollection(key: string, categoryIp: string) {
    selectHomeCollection(key, categoryIp);
    setCatalogView("browse");
    navigateWorkspace("catalog");
  }
  function openMonitoringCategory(id: string) {
    beginInventoryQueryTransition();
    setPage(1);
    setFilters((current) => ({
      monitoringCategoryId: id,
      ...(current.sortBy ? { sortBy: current.sortBy } : {}),
      ...(current.sortOrder ? { sortOrder: current.sortOrder } : {}),
    }));
    setCatalogView("browse");
    navigateWorkspace("catalog");
  }
  function monitoringConfigChanged() {
    void loadMonitoringCategories();
    void load();
  }
  function openCatalogListingMode(mode: ListingType) {
    changeListingMode(mode);
    setCatalogView("browse");
    navigateWorkspace("catalog");
  }
  function openUrgentAuctionCatalog() {
    beginInventoryQueryTransition();
    setPage(1);
    setListingMode("auction");
    setFilters({
      auctionMinutes: "30",
      sortBy: "auctionEndAt",
      sortOrder: "asc",
    });
    setCatalogView("browse");
    navigateWorkspace("catalog");
  }
  function openValueKingCatalog() {
    beginInventoryQueryTransition();
    setPage(1);
    setListingMode("direct");
    setFilters({ valueKing: "true" });
    setCatalogView("browse");
    navigateWorkspace("catalog");
  }
  function openXianyuComparisonCatalog(
    priceBand?: "lt_300" | "300_999" | "gte_1000",
    sortOrder: "asc" | "desc" = "asc",
  ) {
    beginInventoryQueryTransition();
    setPage(1);
    setFilters({
      hasXianyuComparison: "true",
      ...(priceBand ? { xianyuPriceBand: priceBand } : {}),
      sortBy: "xianyuPrice",
      sortOrder,
    });
    setCatalogView("browse");
    navigateWorkspace("catalog");
  }
  function currentWorkspaceScrollTop() {
    return readWorkspaceScrollTop(
      workspaceScrollContainerRef.current,
      window.scrollY,
    );
  }
  function persistWorkspaceScrollPositions() {
    try {
      window.sessionStorage.setItem(
        WORKSPACE_SCROLL_STORAGE_KEY,
        JSON.stringify(Object.fromEntries(workspaceScrollRef.current)),
      );
    } catch {
      // Navigation must still work when session storage is unavailable.
    }
  }
  function persistRecentWorkspaces(entries: RecentWorkspaceEntry[]) {
    try {
      window.sessionStorage.setItem(
        RECENT_WORKSPACES_STORAGE_KEY,
        JSON.stringify(entries),
      );
    } catch {
      // Page navigation remains available when session storage is restricted.
    }
  }
  function rememberRecentWorkspace(destination: Workspace, scrollY: number) {
    const current = workspaceStateRef.current;
    const recorded = recordRecentWorkspace(recentWorkspacesRef.current, {
      ...current,
      scrollY,
      visitedAt: Date.now(),
    }).filter((entry) => entry.workspace !== destination);
    recentWorkspacesRef.current = recorded;
    setRecentWorkspaces(recorded);
    persistRecentWorkspaces(recorded);
  }
  function rememberWorkspaceScrollPosition(target: Workspace) {
    const top = currentWorkspaceScrollTop();
    workspaceScrollRef.current.set(target, top);
    persistWorkspaceScrollPositions();
    return top;
  }
  function replaceCurrentWorkspaceHistory(
    scrollY = currentWorkspaceScrollTop(),
  ) {
    if (typeof window === "undefined") return;
    window.history.replaceState(
      withWorkspaceHistoryState(window.history.state, {
        ...workspaceStateRef.current,
        depth: workspaceHistoryDepthRef.current,
        scrollY,
      }),
      "",
      window.location.href,
    );
  }
  function syncWorkspaceUrl(
    next: WorkspaceNavigationState,
    mode: "push" | "replace",
    depth: number,
    scrollY = 0,
  ) {
    if (typeof window === "undefined") return;
    const url = applyWorkspaceSearchParam(
      new URL(window.location.href),
      next.workspace,
    );
    const nextHref = `${url.pathname}${url.search}${url.hash}`;
    const historyState = withWorkspaceHistoryState(window.history.state, {
      ...next,
      depth,
      scrollY,
    });
    if (mode === "push") window.history.pushState(historyState, "", nextHref);
    else window.history.replaceState(historyState, "", nextHref);
  }
  /** Open the catalog with a folded filter view preselected. */
  function openCatalogView(view: CatalogView) {
    setCatalogView(view);
    if (workspace !== "catalog") navigateWorkspace("catalog");
  }

  /** Open the merged 采购 workspace with a tab preselected. */
  function openPurchasesTab(tab: PurchasesTab) {
    setPurchasesTab(tab);
    if (workspace !== "purchases") navigateWorkspace("purchases");
  }

  /** Open the merged cost tool with a segment preselected. */
  function openCostTool(segment: CostToolSegment) {
    setCostToolSegment(segment);
    if (workspace !== "cost-tool") navigateWorkspace("cost-tool");
  }

  function navigateWorkspace(next: Workspace) {
    if (next === workspace) return;
    workspaceHasNavigatedRef.current = true;
    const currentScroll = rememberWorkspaceScrollPosition(workspace);
    replaceCurrentWorkspaceHistory(currentScroll);
    rememberRecentWorkspace(next, currentScroll);
    const nextState = navigateWorkspaceState(
      { workspace, trail: workspaceTrail },
      next,
    );
    const nextDepth = workspaceHistoryDepthRef.current + 1;
    workspaceHistoryDepthRef.current = nextDepth;
    workspaceStateRef.current = nextState;
    setWorkspace(nextState.workspace);
    setWorkspaceTrail(nextState.trail);
    const nextScroll = workspaceScrollRef.current.get(nextState.workspace) ?? 0;
    pendingWorkspaceScrollRestoreRef.current = {
      workspace: nextState.workspace,
      top: nextScroll,
    };
    syncWorkspaceUrl(nextState, "push", nextDepth, nextScroll);
  }
  function revisitWorkspace(entry: RecentWorkspaceEntry) {
    if (entry.workspace === workspace) return;
    workspaceHasNavigatedRef.current = true;
    const currentScroll = rememberWorkspaceScrollPosition(workspace);
    replaceCurrentWorkspaceHistory(currentScroll);
    rememberRecentWorkspace(entry.workspace, currentScroll);
    workspaceScrollRef.current.set(entry.workspace, entry.scrollY);
    persistWorkspaceScrollPositions();
    const nextState: WorkspaceNavigationState = {
      workspace: entry.workspace,
      trail: entry.trail,
    };
    const nextDepth = workspaceHistoryDepthRef.current + 1;
    workspaceHistoryDepthRef.current = nextDepth;
    workspaceStateRef.current = nextState;
    pendingWorkspaceScrollRestoreRef.current = {
      workspace: entry.workspace,
      top: entry.scrollY,
    };
    setWorkspace(entry.workspace);
    setWorkspaceTrail(entry.trail);
    syncWorkspaceUrl(nextState, "push", nextDepth, entry.scrollY);
  }
  function goBackWorkspace() {
    const previousState = goBackWorkspaceState({
      workspace,
      trail: workspaceTrail,
    });
    if (previousState.workspace === workspace) return;
    workspaceHasNavigatedRef.current = true;
    const currentScroll = rememberWorkspaceScrollPosition(workspace);
    replaceCurrentWorkspaceHistory(currentScroll);
    if (workspaceHistoryDepthRef.current > 0) {
      window.history.back();
      return;
    }
    workspaceHistoryDepthRef.current = 0;
    workspaceStateRef.current = previousState;
    setWorkspace(previousState.workspace);
    setWorkspaceTrail(previousState.trail);
    const previousScroll =
      workspaceScrollRef.current.get(previousState.workspace) ?? 0;
    pendingWorkspaceScrollRestoreRef.current = {
      workspace: previousState.workspace,
      top: previousScroll,
    };
    syncWorkspaceUrl(previousState, "replace", 0, previousScroll);
  }

  function selectManagerAccount(account: ManagerAccount) {
    window.localStorage.setItem(MANAGER_ACCOUNT_STORAGE_KEY, account.id);
    setActiveManagerId(account.id);
    setAccountGateOpen(false);
    setUnreadMessageCount(0);
  }

  function openManagerConversation(item?: Item | CollaborationItem) {
    if (item) {
      setPendingChatItem(item);
      setPendingChatBundle(null);
    }
    setCartOpen(false);
    setSellerId(null);
    if (detailHistoryActiveRef.current) {
      detailHistoryActiveRef.current = false;
      window.history.replaceState(
        withoutItemDetailHistoryState(window.history.state),
        "",
        window.location.href,
      );
    }
    setSelected(null);
    navigateWorkspace("collaboration");
  }

  function openManagerBundleConversation(
    bundleItems: (Item | CollaborationItem)[],
    targetPriceYen?: number | null,
  ) {
    if (!bundleItems.length) return;
    if (bundleItems.length === 1 && !targetPriceYen) {
      openManagerConversation(bundleItems[0]);
      return;
    }
    setPendingChatItem(null);
    setPendingChatBundle({
      items: bundleItems,
      targetPriceYen: targetPriceYen ?? null,
    });
    setCartOpen(false);
    setSellerId(null);
    if (detailHistoryActiveRef.current) {
      detailHistoryActiveRef.current = false;
      window.history.replaceState(
        withoutItemDetailHistoryState(window.history.state),
        "",
        window.location.href,
      );
    }
    setSelected(null);
    navigateWorkspace("collaboration");
  }

  function toggleBundleShareItem(item: Item) {
    setBundleShareItems((current) =>
      current.some((entry) => entry.id === item.id)
        ? current.filter((entry) => entry.id !== item.id)
        : [...current, item],
    );
  }

  async function updateCart(
    itemId: string,
    present: boolean,
    fallbackItem?: Item,
  ) {
    const previous = cart;
    const source =
      items.find((item) => item.id === itemId) ??
      linkItems.find((item) => item.id === itemId) ??
      urgentAuctionPool.find((item) => item.id === itemId) ??
      cart.items.find((item) => item.id === itemId) ??
      (selected?.id === itemId ? selected : undefined) ??
      (fallbackItem?.id === itemId ? fallbackItem : undefined);
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
      return true;
    } catch (reason) {
      setCart(previous);
      setError(reason instanceof Error ? reason.message : "购物车保存失败");
      return false;
    }
  }
  async function shareItems(itemIds?: string[]) {
    setCartSharing(true);
    setShareMessage("");
    try {
      const response = await fetch(`${API}/cart/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(itemIds?.length ? { itemIds } : {}),
          accountId: activeManagerId || undefined,
        }),
      });
      if (!response.ok)
        throw new Error(`读取原始链接失败（${response.status}）`);
      const result = (await response.json()) as CartSharePayload;
      const knownItems = [
        ...items,
        ...linkItems,
        ...urgentAuctionPool,
        ...cart.items,
      ].filter(
        (item, index, collection) =>
          collection.findIndex((entry) => entry.id === item.id) === index,
      );
      const requestedItems = itemIds?.length
        ? itemIds
            .map((id) => knownItems.find((item) => item.id === id))
            .filter((item): item is Item => Boolean(item))
        : cart.items;
      const responseItems = result.items ?? result.links ?? [];
      const rawEntries = responseItems.length
        ? responseItems.map((entry, index) => {
            const local =
              (entry.id
                ? knownItems.find((item) => item.id === entry.id)
                : undefined) ?? requestedItems[index];
            return {
              sourceUrl: entry.sourceUrl ?? entry.url ?? local?.sourceUrl ?? "",
              title:
                (local
                  ? (translations[`${local.id}:title`] ??
                    local.titleZh ??
                    local.titleRaw)
                  : undefined) ??
                entry.titleZh ??
                entry.title ??
                entry.titleRaw ??
                local?.titleRaw ??
                "商品",
            };
          })
        : (result.sourceUrls ?? []).map((sourceUrl, index) => {
            const local =
              requestedItems.find((item) => item.sourceUrl === sourceUrl) ??
              requestedItems[index];
            return {
              sourceUrl,
              title:
                (local
                  ? (translations[`${local.id}:title`] ??
                    local.titleZh ??
                    local.titleRaw)
                  : undefined) ?? "商品",
            };
          });
      const seenUrls = new Set<string>();
      const shareEntries = rawEntries.filter((entry) => {
        try {
          const parsed = new URL(entry.sourceUrl);
          if (!/^https?:$/.test(parsed.protocol)) return false;
          if (
            typeof window !== "undefined" &&
            parsed.origin === window.location.origin
          )
            return false;
          if (seenUrls.has(parsed.href)) return false;
          seenUrls.add(parsed.href);
          entry.sourceUrl = parsed.href;
          return true;
        } catch {
          return false;
        }
      });
      if (!shareEntries.length)
        throw new Error("所选商品没有可分享的原始来源链接");
      const linksText = shareEntries
        .map((entry) => `${entry.title.trim() || "商品"}\n${entry.sourceUrl}`)
        .join("\n\n");
      const shareData: ShareData = {
        title:
          shareEntries.length === 1
            ? shareEntries[0].title.trim() || "商品分享"
            : `假面采购 · ${shareEntries.length} 件商品`,
        text: linksText,
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
  // The seller dialog's items come from seller analysis, not from a round,
  // so a copy there is accounted by looking up which rounds currently
  // contain the copied items and marking those round rows. Best-effort and
  // fire-and-forget: a failed lookup never affects the copy itself.
  function markCopiedForItems(itemIds: string[]) {
    if (!itemIds.length) return;
    void (async () => {
      try {
        const query = activeManagerId
          ? `?accountId=${encodeURIComponent(activeManagerId)}`
          : "";
        const response = await fetch(`${API}/collaboration/share-rounds${query}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = (await response.json()) as { rounds?: ShareRound[] };
        const roundByItem = new Map<string, string>();
        for (const round of data.rounds ?? []) {
          for (const row of round.items ?? []) {
            if (!roundByItem.has(row.itemId))
              roundByItem.set(row.itemId, round.id);
          }
        }
        const byRound = new Map<string, string[]>();
        for (const itemId of itemIds) {
          const roundId = roundByItem.get(itemId);
          if (!roundId) continue;
          byRound.set(roundId, [...(byRound.get(roundId) ?? []), itemId]);
        }
        await Promise.all(
          [...byRound].map(([roundId, ids]) =>
            markShareRoundItemsCopied(
              API,
              activeManagerId || undefined,
              roundId,
              ids,
            ),
          ),
        );
      } catch {
        // Copy accounting is best-effort only.
      }
    })();
  }
  async function patchItem(
    id: string,
    patch: Partial<Item>,
    fallbackItem?: Item,
  ) {
    const previous =
      items.find((item) => item.id === id) ??
      linkItems.find((item) => item.id === id) ??
      urgentAuctionPool.find((item) => item.id === id) ??
      cart.items.find((item) => item.id === id) ??
      (selected?.id === id ? selected : undefined) ??
      (fallbackItem?.id === id ? fallbackItem : undefined);
    if (!previous) return;
    const optimistic = { ...previous, ...patch } as Item;
    const apply = (value: Item) => {
      setItems((current) =>
        current
          .map((item) => (item.id === id ? { ...item, ...value } : item))
          .filter((item) => isAvailableMarketListing(item)),
      );
      setLinkItems((current) =>
        current
          .map((item) => (item.id === id ? { ...item, ...value } : item))
          .filter((item) => isAvailableMarketListing(item)),
      );
      setUrgentAuctionPool((current) =>
        current
          .map((item) => (item.id === id ? { ...item, ...value } : item))
          .filter((item) => isAvailableMarketListing(item)),
      );
      setCart((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.id === id ? { ...item, ...value } : item,
        ),
      }));
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
    publishFavoriteChanges([{ item: optimistic, patch: optimistic }]);
    try {
      const response = await fetch(`${API}/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...patch,
          actor: activeManagerId || "dashboard-operator",
        }),
      });
      if (!response.ok) throw new Error(`保存失败（API ${response.status}）`);
      const updated = (await response.json()).item as Partial<Item>;
      const confirmed = { ...optimistic, ...updated } as Item;
      apply(confirmed);
      publishFavoriteChanges([{ item: confirmed, patch: confirmed }]);
      return true;
    } catch (reason) {
      apply(previous);
      publishFavoriteChanges([{ item: previous, patch: previous }]);
      setError(reason instanceof Error ? reason.message : "保存失败");
      return false;
    }
  }

  async function deleteItemRequest(
    id: string,
    fallbackItem?: Item,
  ): Promise<boolean> {
    const previous =
      items.find((item) => item.id === id) ??
      linkItems.find((item) => item.id === id) ??
      urgentAuctionPool.find((item) => item.id === id) ??
      cart.items.find((item) => item.id === id) ??
      (selected?.id === id ? selected : undefined) ??
      (fallbackItem?.id === id ? fallbackItem : undefined);
    if (!previous) return false;
    const optimistic = {
      ...previous,
      deletedAt: new Date().toISOString(),
    } as Item;
    const apply = (value: Item) => {
      setItems((current) =>
        current
          .map((item) => (item.id === id ? { ...item, ...value } : item))
          .filter((item) => isAvailableMarketListing(item)),
      );
      setLinkItems((current) =>
        current
          .map((item) => (item.id === id ? { ...item, ...value } : item))
          .filter((item) => isAvailableMarketListing(item)),
      );
      setUrgentAuctionPool((current) =>
        current
          .map((item) => (item.id === id ? { ...item, ...value } : item))
          .filter((item) => isAvailableMarketListing(item)),
      );
      setCart((current) => ({
        ...current,
        items: current.items.filter((item) => item.id !== id),
      }));
      setBundleShareItems((current) =>
        current.filter((item) => item.id !== id),
      );
      if (value.deletedAt) {
        setSelected((current) => (current?.id === id ? null : current));
      } else {
        setSelected((current) =>
          current?.id === id ? { ...current, ...value } : current,
        );
      }
    };
    const restore = () => {
      setItems((current) =>
        current.some((item) => item.id === id) ? current : [previous, ...current],
      );
      apply({ ...previous, deletedAt: null });
      setCart((current) =>
        current.items.some((item) => item.id === id)
          ? current
          : { ...current, items: [...current.items, previous] },
      );
    };
    apply(optimistic);
    publishFavoriteChanges([{ item: optimistic, patch: optimistic }]);
    try {
      const response = await fetch(`${API}/items/${id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actor: activeManagerId || "dashboard-operator",
        }),
      });
      if (!response.ok) throw new Error(`删除失败（API ${response.status}）`);
      publishFavoriteChanges([{ item: optimistic, patch: optimistic }]);
      return true;
    } catch (reason) {
      restore();
      publishFavoriteChanges([{ item: previous, patch: previous }]);
      setError(reason instanceof Error ? reason.message : "删除失败");
      return false;
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
    openItemDetail(item);
    return true;
  }

  function openItemDetail(item: Item) {
    detailReturnFocusRef.current = captureDialogReturnFocus(
      [...document.querySelectorAll<HTMLElement>("[data-item-id]")].find(
        (element) => element.dataset.itemId === item.id,
      ) ?? null,
    );
    if (detailHistoryActiveRef.current) {
      window.history.replaceState(
        withItemDetailHistoryState(window.history.state, item.id),
        "",
        window.location.href,
      );
    } else {
      window.history.pushState(
        withItemDetailHistoryState(window.history.state, item.id),
        "",
        window.location.href,
      );
      detailHistoryActiveRef.current = true;
    }
    setSelected(item);
    // Open immediately, then hydrate the detail-only comparison evidence.
    // The list payload stays compact while the drawer can show three verified
    // same-product Xianyu offers without delaying the first paint.
    void fetch(`${API}/items/${item.id}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { item?: Item };
      })
      .then((data) => {
        if (!data?.item) return;
        setSelected((current) =>
          current?.id === item.id ? data.item! : current,
        );
      })
      .catch(() => undefined);
  }

  function closeItemDetail() {
    if (detailHistoryActiveRef.current) {
      window.history.back();
      return;
    }
    setSelected(null);
  }

  async function analyzeUrl() {
    const urls = publicUrlsFromInput(urlInput);
    if (!urls.length) {
      setUrlMessage("请至少输入一个有效的公开 http(s) 商品链接");
      return;
    }
    setUrlSubmitting(true);
    setUrlMessage("");
    try {
      const batches = Array.from(
        { length: Math.ceil(urls.length / URL_IMPORT_LIMIT) },
        (_, index) =>
          urls.slice(index * URL_IMPORT_LIMIT, (index + 1) * URL_IMPORT_LIMIT),
      );
      let acceptedCount = 0;
      let detectedAdapter = "public_page";
      const rejected: { accepted?: boolean; url?: string; error?: string }[] =
        [];
      for (const batch of batches) {
        const response = await fetch(`${API}/items/analyze-url`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            batch.length === 1 ? { url: batch[0] } : { urls: batch },
          ),
        });
        const result = await response.json().catch(() => ({
          accepted: false,
          error: `API ${response.status}`,
        }));
        if (!response.ok) {
          rejected.push(
            ...batch.map((url) => ({
              accepted: false,
              url,
              error: result.error ?? `API ${response.status}`,
            })),
          );
          continue;
        }
        const results = Array.isArray(result.results) ? result.results : [];
        const batchAccepted =
          result.acceptedCount ??
          (results.length
            ? results.filter((entry: { accepted?: boolean }) => entry.accepted)
                .length
            : result.accepted
              ? 1
              : 0);
        acceptedCount += batchAccepted;
        detectedAdapter =
          result.adapter ?? results[0]?.adapter ?? detectedAdapter;
        if (results.length) {
          rejected.push(
            ...results.filter(
              (entry: { accepted?: boolean; url?: string }) => !entry.accepted,
            ),
          );
        } else if (!batchAccepted) {
          rejected.push(
            ...batch.map((url) => ({
              accepted: false,
              url,
              error: result.error ?? "链接未接受",
            })),
          );
        }
      }
      if (!acceptedCount) throw new Error(rejected[0]?.error ?? "链接未接受");
      setImportsExpanded(true);
      if (urls.length === 1) {
        setUrlMessage(`已识别为${sourceName(detectedAdapter)}，正在后台分析。`);
      } else {
        setUrlMessage(
          `${batches.length > 1 ? `已自动分成 ${batches.length} 批，` : ""}已提交 ${acceptedCount} 个链接${rejected.length ? `，${rejected.length} 个未接受并已保留在输入框` : ""}。`,
        );
      }
      setUrlInput(
        rejected
          .map((entry: { url?: string }) => entry.url)
          .filter(Boolean)
          .join("\n"),
      );
      if (analyzedUrlTimerRef.current != null)
        window.clearTimeout(analyzedUrlTimerRef.current);
      let refreshAttempt = 0;
      const refreshAnalyzedItem = () => {
        analyzedUrlTimerRef.current = window.setTimeout(async () => {
          await Promise.all([loadImports(), loadLinkItems(), load()]);
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

  async function retryImport(importId: string) {
    setImportActionId(importId);
    setUrlMessage("");
    try {
      const response = await fetch(`${API}/imports/${importId}/retry`, {
        method: "POST",
      });
      const result = await response
        .json()
        .catch(() => ({ accepted: false, error: `API ${response.status}` }));
      if (!response.ok || !result.accepted)
        throw new Error(result.error ?? "任务暂时无法重试");
      setImportsExpanded(true);
      setUrlMessage("失败任务已重新排队");
      await loadImports();
    } catch (reason) {
      setUrlMessage(
        friendlyImportError(
          reason instanceof Error ? reason.message : "任务重试失败",
        ),
      );
    } finally {
      setImportActionId(null);
    }
  }

  async function removeImport(importId: string) {
    setImportActionId(importId);
    setUrlMessage("");
    try {
      const response = await fetch(`${API}/imports/${importId}`, {
        method: "DELETE",
      });
      const result = await response
        .json()
        .catch(() => ({ error: `API ${response.status}` }));
      if (!response.ok)
        throw new Error(result.message ?? result.error ?? "任务暂时无法清除");
      setImports((current) => current.filter((entry) => entry.id !== importId));
    } catch (reason) {
      setUrlMessage(
        friendlyImportError(
          reason instanceof Error ? reason.message : "任务清除失败",
        ),
      );
    } finally {
      setImportActionId(null);
    }
  }

  function viewReceipt(purchase: PurchaseRecord, receiptId: string) {
    const receipt = purchase.receipts.find((entry) => entry.id === receiptId);
    if (!receipt) return;
    setPurchaseReceiptPreview({
      endpoint: `${API}/items/${purchase.item.id}/purchase/receipts/${receiptId}`,
      fileName: receipt.fileName,
      mimeType: receipt.mimeType,
    });
  }

  const urgentAuctionSelection = useMemo(() => {
    const now = Date.now() + serverOffset;
    const active = urgentAuctionPool.filter((item) => {
      if (item.listingType !== "auction" || !item.auctionEndAt) return false;
      const remaining = new Date(item.auctionEndAt).getTime() - now;
      return remaining > 0 && remaining <= 30 * 60_000;
    });
    const knownLandedPrices = active.map(
      (item) => item.priceCurrent + (item.shippingFee ?? 0),
    );
    const effectiveUnitCost = (item: Item) =>
      item.unitCostEst ??
      (item.quantityEst && item.quantityEst > 0
        ? (item.priceCurrent + (item.shippingFee ?? 0)) / item.quantityEst
        : null);
    const knownUnitCosts = active
      .map(effectiveUnitCost)
      .filter((value): value is number => value != null);
    const priceMedian = median(knownLandedPrices);
    const unitMedian = median(knownUnitCosts);
    const lowerPriced = active.filter(
      (item) =>
        priceMedian == null ||
        item.priceCurrent + (item.shippingFee ?? 0) <= priceMedian,
    );
    const factualValue = lowerPriced.filter((item) => {
      const unitCost = effectiveUnitCost(item);
      return (
        (item.quantityEst ?? 0) >= 2 ||
        (unitCost != null && unitMedian != null && unitCost <= unitMedian)
      );
    });
    const candidates = factualValue.length ? factualValue : lowerPriced;
    const ranked = [...candidates].sort((left, right) => {
      const endingDifference =
        new Date(left.auctionEndAt ?? 0).getTime() -
        new Date(right.auctionEndAt ?? 0).getTime();
      if (endingDifference) return endingDifference;
      const leftUnit = effectiveUnitCost(left) ?? Number.POSITIVE_INFINITY;
      const rightUnit = effectiveUnitCost(right) ?? Number.POSITIVE_INFINITY;
      if (leftUnit !== rightUnit) return leftUnit - rightUnit;
      return (
        left.priceCurrent +
        (left.shippingFee ?? 0) -
        (right.priceCurrent + (right.shippingFee ?? 0))
      );
    });
    return {
      activeCount: active.length,
      items: ranked.slice(0, 5),
      priceMedian,
      unitMedian,
      usedUnitFacts: factualValue.length > 0,
    };
  }, [urgentAuctionPool, serverOffset, nowTick]);
  const urgentCount = urgentAuctionSelection.activeCount;
  const urlInputCount = publicUrlsFromInput(urlInput).length;
  const importSummary = useMemo(
    () => ({
      active: imports.filter(
        (entry) => entry.status === "queued" || entry.status === "running",
      ).length,
      failed: imports.filter((entry) => entry.status === "failed").length,
      succeeded: imports.filter((entry) => entry.status === "succeeded").length,
    }),
    [imports],
  );
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const purchasedItemIds = useMemo(
    () => new Set(purchases.map((purchase) => purchase.itemId)),
    [purchases],
  );
  const dislikedItemIds = useMemo(
    () => new Set(dislikedItems.map((item) => item.id)),
    [dislikedItems],
  );
  useEffect(() => {
    purchasedItemIdsRef.current = purchasedItemIds;
  }, [purchasedItemIds]);
  useEffect(() => {
    dislikedItemIdsRef.current = dislikedItemIds;
  }, [dislikedItemIds]);
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
  const cartItemIdSet = useMemo(
    () => new Set(cart.items.map((item) => item.id)),
    [cart.items],
  );
  const bundleShareItemIdSet = useMemo(
    () => new Set(bundleShareItems.map((item) => item.id)),
    [bundleShareItems],
  );
  const navigationWorkspace:
    | "inventory"
    | "catalog"
    | "collaboration"
    | "workbench" =
    workspace === "collaboration"
      ? "collaboration"
      : workspace === "catalog"
        ? "catalog"
        : [
              "purchases",
              "intel",
              "cost-tool",
              "workbench",
              "monitoring",
              "resale",
              "assistant",
            ].includes(workspace)
          ? "workbench"
          : "inventory";
  return (
    <main
      ref={dashboardRef}
      className={`ios-shell procurement-shell scanline min-h-dvh workspace-${workspace}`}
      onPointerDownCapture={() => { workspacePointerInputRef.current = true; }}
      onKeyDownCapture={() => { workspacePointerInputRef.current = false; }}
    >
      <a
        href={
          workspace === "cost-tool"
            ? "#cost-tool-title"
            : workspace === "catalog"
              ? "#inventory"
              : "#workspace-content"
        }
        className="skip-link"
      >
        {workspace === "cost-tool"
          ? "跳到算账"
          : workspace === "catalog"
            ? "跳到商品列表"
            : "跳到当前工作区"}
      </a>
      <header
        className={`ios-header procurement-header ${workspaceTrail.length > 0 ? "procurement-header-back" : ""}`}
      >
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5 lg:px-8">
          <div className="header-identity flex min-w-0 items-center gap-3">
            {workspaceTrail.length > 0 && (
              <button
                type="button"
                onClick={goBackWorkspace}
                aria-label="返回上一步"
                title="返回上一步"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/70 bg-white/50 text-ink shadow-sm backdrop-blur-xl"
              >
                <ArrowLeftIcon />
              </button>
            )}
            <div className="brand-logo grid h-11 w-11 shrink-0 place-items-center rounded-xl text-black">
              <RiderLogo />
            </div>
            <div className="header-brand-copy min-w-0">
              <h1 className="brand-name truncate font-heading text-base font-black tracking-tight sm:text-lg">
                假面采购
              </h1>
              {exchangeRate && (
                <span
                  className="exchange-rate-inline"
                  title={`${exchangeRate.source} · ${new Date(exchangeRate.referenceDate).toLocaleDateString("zh-CN")}${exchangeRate.warning ? ` · ${exchangeRate.warning}` : ""}`}
                >
                  100 日元 ≈ ¥{(exchangeRate.rate * 100).toFixed(2)}
                  {exchangeRate.stale ? " · 最近值" : ""}
                </span>
              )}
            </div>
          </div>
          <div className="header-tools flex items-center gap-1 text-xs font-semibold">
            <div className="header-tool-cluster" role="group" aria-label="显示与设置">
            <button
              type="button"
              onClick={() =>
                setLanguage((current) => (current === "zh" ? "original" : "zh"))
              }
              aria-pressed={language === "original"}
              aria-label={language === "zh" ? "切换为原文" : "切换为中文"}
              title={language === "zh" ? "原文" : "中文"}
              className="header-translate-button grid h-11 w-11 place-items-center rounded-lg transition-colors hover:bg-white/70"
            >
              <TranslateIcon />
            </button>
            <button
              ref={settingsTriggerRef}
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="打开设置"
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
              aria-controls={settingsOpen ? "settings-dialog" : undefined}
              title="设置"
              className="header-settings-button grid h-11 w-11 place-items-center rounded-lg transition-colors hover:bg-white/70"
            >
              <SettingsIcon />
            </button>
            </div>
            <button
              type="button"
              onClick={() => navigateWorkspace("workbench")}
              aria-label={`打开工作台账号区，当前账号：${activeManager?.displayName ?? "未选择"}`}
              title="账号"
              className="header-account-button flex min-h-11 items-center gap-2 rounded-lg px-2 transition-colors hover:bg-white/70"
            >
              <span>{activeManager?.displayName ?? "账号"}</span>
            </button>
          </div>
        </div>
      </header>

      <EditorialReadingProgress scrollTarget={workspaceScrollContainerRef} workspace={workspace} />
      <div
        id="workspace-content"
        tabIndex={-1}
        ref={workspaceScrollContainerRef}
        className="procurement-content mx-auto max-w-[1600px] px-4 py-4 sm:px-5 lg:px-8"
      >
        {workspace === "assistant" && (
          <AssistantChatWorkspace
            apiBaseUrl={API}
            exchangeRate={exchangeRate?.rate}
            onOpenItem={openAnalysisItem}
          />
        )}
        {chatVisitedRef.current && activeManager && (
          <div className="persistent-chat-workspace" hidden={workspace !== "collaboration"} inert={workspace !== "collaboration"}>
          <CollaborationChatWorkspace
            key={activeManager.id}
            apiBaseUrl={API}
            account={activeManager}
            accounts={managerAccounts}
            pendingItem={pendingChatItem}
            onPendingItemConsumed={() => setPendingChatItem(null)}
            pendingBundle={pendingChatBundle}
            onPendingBundleConsumed={() => setPendingChatBundle(null)}
            onOpenItem={openAnalysisItem}
            onSwitchAccount={() => setAccountGateOpen(true)}
            cartCount={cart.count}
            onCartMigrated={() => void loadCart()}
            onUnreadCleared={() => setUnreadMessageCount(0)}
            onActivityChanged={() => void refreshCollaborationMeta()}
            active={workspace === "collaboration"}
          />
          </div>
        )}
        {workspace === "workbench" && (
          <WorkbenchWorkspace
            onNavigate={navigateWorkspace}
            onOpenDisliked={() => openCatalogView("disliked")}
            accounts={managerAccounts}
            activeManagerId={activeManagerId}
            onSwitchIdentity={() => setAccountGateOpen(true)}
            onOpenChat={() => navigateWorkspace("collaboration")}
            activeCount={overview?.market?.activeTotal}
            cartCount={cart.count}
            language={language}
            onToggleLanguage={() => setLanguage((current) => current === "zh" ? "original" : "zh")}
            onOpenSettings={() => setSettingsOpen(true)}
            apiBaseUrl={API}
            accountId={activeManagerId || null}
          />
        )}
        {workspace === "intel" && <MarketIntelWorkspace apiBaseUrl={API} />}
        {workspace === "cost-tool" && (
          <CostToolWorkspace
            key={activeManagerId}
            apiBaseUrl={API}
            managerId={activeManagerId}
            exchangeRate={exchangeRate?.rate}
            segment={costToolSegment}
            onSegmentChange={setCostToolSegment}
          />
        )}
        {workspace === "inventory" && (
          <TodoHome
            apiBaseUrl={API}
            accountId={activeManagerId}
            purchasedItemIds={purchasedItemIds}
            dislikedItemIds={dislikedItemIds}
            purchaseAnalyses={purchaseLinkJobs}
            failedJobs24h={overview?.totals24h.failed ?? 0}
            onRegisterItem={openPurchaseRegistrationForTodo}
            onNavigate={(next) => {
              // The register queue lives on the records tab; every
              // other todo target is a plain workspace jump.
              if (next === "purchases") openPurchasesTab("records");
              else navigateWorkspace(next);
            }}
            onOpenInventory={() => openPurchasesTab("orders")}
            onPendingCountChange={setTodoCount}
          >
            <details className="todo-overview">
              <summary>
                {TERMS.overview}
                <span>市场与筛选</span>
              </summary>
              <HomeMarketOverview
                data={overview?.market}
                error={overviewError}
                onRetry={() => setOverviewRefreshVersion((version) => version + 1)}
                updatedAt={overview?.serverTime}
                activeCategory={filters.ip || "all"}
                activeCollection={filters.collection}
                customCategories={monitoringCategories}
                activeCustomCategoryId={filters.monitoringCategoryId}
                onSelectCustomCategory={openMonitoringCategory}
                activeListingType={listingMode}
                onSelectCategory={openCatalogCategory}
                onSelectCollection={openCatalogCollection}
                onSelectListingType={openCatalogListingMode}
                onOpenInventory={openCatalog}
                onOpenValueKings={openValueKingCatalog}
                onOpenUrgentAuctions={openUrgentAuctionCatalog}
                onOpenXianyuComparison={openXianyuComparisonCatalog}
                onOpenWorkspace={(target) => {
                  // The overview's purchase entries name the records
                  // tab; the orders tab has its own entry below.
                  if (target === "purchases") openPurchasesTab("records");
                  else if (target === "cost-tool") openCostTool("logistics");
                  else navigateWorkspace(target);
                }}
                onOpenCatalogView={openCatalogView}
                onOpenPurchasesTab={openPurchasesTab}
                onOpenAnalysis={() => setAnalysisOpen(true)}
                hasAnalysis={Boolean(analysis)}
                urgentAuctionCount={urgentCount}
              />
            </details>
          </TodoHome>
        )}
        {workspace === "purchases" && (
          <div className="procurement-workspace">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-heading text-xl font-black">
                {TERMS.procurement}
              </h2>
            </div>
            <div
              className="purchases-view-switcher mb-3 flex gap-1 overflow-x-auto rounded-2xl border border-blue-100 bg-white p-1"
              role="tablist"
              aria-label="采购视图"
            >
              {(
                [
                  ["records", TERMS.purchases],
                  ["orders", TERMS.orders],
                ] as const
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={purchasesTab === tab}
                  onClick={() => setPurchasesTab(tab)}
                  className={`min-h-11 flex-1 whitespace-nowrap rounded-xl px-3 text-xs font-bold transition ${purchasesTab === tab ? "bg-ink text-white" : "text-ink/55 hover:bg-fog"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {purchasesTab === "records" && (
              <PurchaseRecordsWorkspace
                purchaseLinkInput={purchaseLinkInput}
                onPurchaseLinkInputChange={setPurchaseLinkInput}
                purchaseLinkUrlCount={
                  publicUrlsFromInput(purchaseLinkInput).length
                }
                purchaseLinkSubmitting={purchaseLinkSubmitting}
                purchaseLinkMessage={purchaseLinkMessage}
                purchaseLinkJobs={purchaseLinkJobs}
                completedPurchaseJobCount={completedPurchaseJobs.length}
                selectedPurchaseJobIds={selectedPurchaseJobIds}
                onTogglePurchaseJob={(jobId) =>
                  setSelectedPurchaseJobIds((current) =>
                    current.includes(jobId)
                      ? current.filter((id) => id !== jobId)
                      : [...current, jobId],
                  )
                }
                onSubmitPurchaseLinks={submitPurchaseLinks}
                onRegisterJob={(jobId) => {
                  const job = purchaseLinkJobs.find(
                    (entry) => entry.jobId === jobId,
                  );
                  if (job) openPurchaseRegistrationForJobs([job]);
                }}
                onRegisterSelected={() =>
                  openPurchaseRegistrationForJobs(
                    completedPurchaseJobs.filter((job) =>
                      selectedPurchaseJobIds.length
                        ? selectedPurchaseJobIds.includes(job.jobId)
                        : true,
                    ),
                  )
                }
                purchasesError={purchasesError}
                onRetryPurchases={() => void loadPurchases()}
                onOpenOrdersTab={() => setPurchasesTab("orders")}
                recordsPanel={
                  <PurchaseRecordsPanel
                    purchases={purchases}
                    bundles={purchaseBundles}
                    bundleCount={purchaseBundlesTotal}
                    bundleGrandTotal={purchaseGrandTotal}
                    bundlePage={purchaseBundlesPage}
                    bundlePageCount={purchaseBundlesPageCount}
                    bundlesLoading={purchaseBundlesLoading}
                    bundlesError={purchaseBundlesError}
                    exchangeRate={exchangeRate?.rate}
                    onOpenItem={(item) => void openAnalysisItem(item.id)}
                    onOpenImages={(item) => setPurchaseGallery(item)}
                    onViewReceipt={(purchase, receiptId) =>
                      void viewReceipt(purchase, receiptId)
                    }
                    onEditBundle={openPurchaseRegistrationForBundle}
                    onOpenHistory={(bundle) => void openPurchaseHistory(bundle)}
                    onLoadMoreBundles={() =>
                      void loadPurchaseBundles(purchaseBundlesPage + 1)
                    }
                    onRetryBundles={() =>
                      void loadPurchaseBundles(purchaseBundlesPage)
                    }
                  />
                }
              />
            )}
            {purchasesTab === "orders" && (
              <section className="inventory-orders-page" aria-label="库存订单">
                <InventoryOrdersWorkspace
                  apiBaseUrl={API}
                  exchangeRate={exchangeRate?.rate}
                />
              </section>
            )}
          </div>
        )}
        <ResaleWorkspace
          active={workspace === "resale"}
          apiBaseUrl={API}
          accountId={activeManagerId || null}
          onOpenMonitoring={() => navigateWorkspace("monitoring")}
          onOpenSource={openAnalysisItem}
        />
        {workspace === "monitoring" && (
          <>
            <div className="ios-surface rounded-2xl p-4 mb-4">
              <MonitoringConfigWorkspace apiBaseUrl={API} accountId={activeManagerId || null} onConfigChanged={monitoringConfigChanged} />
            </div>
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
                  <div className="rounded-lg bg-blue-50 px-3 py-2 text-right text-[11px] text-blue-950/70">
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
                    ["标准商品", overview?.productTotal ?? 0, "按来源持续归并"],
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
                      `库存订单 · 登记 ${purchases.length}`,
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
                        className="flex shrink-0 items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-950/80"
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

        {workspace === "catalog" && (
          <>
            <div
              className="catalog-view-switcher mb-3 flex gap-1 overflow-x-auto rounded-2xl border border-blue-100 bg-white p-1"
              role="tablist"
              aria-label="选货视图"
            >
              {(
                [
                  ["browse", "全部"],
                  ["favorites", TERMS.favorites],
                  ["links", TERMS.links],
                  ["disliked", TERMS.disliked],
                ] as const
              ).map(([view, label]) => (
                <button
                  key={view}
                  type="button"
                  role="tab"
                  aria-selected={catalogView === view}
                  onClick={() => setCatalogView(view)}
                  className={`min-h-11 flex-1 whitespace-nowrap rounded-xl px-3 text-xs font-bold transition ${catalogView === view ? "bg-ink text-white" : "text-ink/55 hover:bg-fog"}`}
                >
                  {label}
                  {view === "disliked" && dislikedTotal > 0
                    ? ` · ${dislikedTotal}`
                    : ""}
                </button>
              ))}
            </div>
            {catalogView === "browse" && (
              <>
            {filtersOpen &&
              createPortal(
                <div
                  className="modal-backdrop js-filter-overlay absolute inset-0 z-40 grid place-items-center bg-ink/55 p-3 sm:p-4"
                  onMouseDown={() => setFiltersOpen(false)}
                >
                  <section
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="filter-dialog-title"
                    ref={filterDialogRef}
                    className="ios-surface modal-panel js-filter-modal scrollbar-thin max-h-[92dvh] w-full max-w-5xl overflow-y-auto rounded-3xl bg-paper p-4 shadow-modal sm:p-5"
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <div className="mb-4 flex items-center justify-between gap-3 border-b border-blue-100 pb-3">
                      <div>
                        <h2
                          id="filter-dialog-title"
                          className="font-heading text-lg font-black"
                        >
                          采购筛选器
                        </h2>
                        {activeFilterCount > 0 && (
                          <p className="text-xs text-slate-500">
                            已启用 {activeFilterCount} 项
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => setFiltersOpen(false)}
                        ref={filterCloseRef}
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
                        <option value="super_sentai">超级战队</option>
                        <option value="godzilla">哥斯拉</option>
                      </FilterSelect>
                      <FilterSelect
                        label="专区"
                        name="collection"
                        value={filters.collection ?? ""}
                        onChange={changeFilter}
                      >
                        <option value="shf">S.H.Figuarts</option>
                        <option value="sic">S.I.C.</option>
                      </FilterSelect>
                      {filters.collection === "shf" && (
                        <>
                          <FilterSelect
                            label="SHF 产品线"
                            name="shfLine"
                            value={filters.shfLine ?? ""}
                            onChange={changeFilter}
                          >
                            <option value="standard">普通 SHF</option>
                            <option value="shinkocchou">真骨雕制法</option>
                          </FilterSelect>
                          <FilterSelect
                            label="发售渠道"
                            name="shfReleaseChannel"
                            value={filters.shfReleaseChannel ?? ""}
                            onChange={changeFilter}
                          >
                            <option value="retail">通贩</option>
                            <option value="tamashii_web">魂限定</option>
                            <option value="event">会场限定</option>
                            <option value="unknown">待识别</option>
                          </FilterSelect>
                          <FilterSelect
                            label="版本"
                            name="shfEdition"
                            value={filters.shfEdition ?? ""}
                            onChange={changeFilter}
                          >
                            <option value="first">初版</option>
                            <option value="reissue">再版</option>
                            <option value="unknown">待识别</option>
                          </FilterSelect>
                          <FilterSelect
                            label="地区"
                            name="shfRegion"
                            value={filters.shfRegion ?? ""}
                            onChange={changeFilter}
                          >
                            <option value="japanese">日版</option>
                            <option value="agent">代理版</option>
                            <option value="hong_kong">港版</option>
                            <option value="unknown">待识别</option>
                          </FilterSelect>
                        </>
                      )}
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
                        {marketplaceSourceOptions(overview?.sources ?? []).map(
                          (source) => (
                            <option key={source.value} value={source.value}>
                              {source.label}
                            </option>
                          ),
                        )}
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
                        label="收藏"
                        name="favorite"
                        value={filters.favorite ?? ""}
                        onChange={changeFilter}
                      >
                        <option value="true">仅收藏</option>
                        <option value="false">未收藏</option>
                      </FilterSelect>
                      <FilterSelect
                        label="闲鱼同款"
                        name="hasXianyuComparison"
                        value={filters.hasXianyuComparison ?? ""}
                        onChange={changeFilter}
                      >
                        <option value="true">仅看已有可信同款</option>
                      </FilterSelect>
                      <FilterSelect
                        label="闲鱼参考价"
                        name="xianyuPriceBand"
                        value={filters.xianyuPriceBand ?? ""}
                        onChange={changeFilter}
                      >
                        <option value="lt_300">¥300 以下</option>
                        <option value="300_999">¥300–999</option>
                        <option value="gte_1000">¥1,000 以上</option>
                      </FilterSelect>
                      <FilterSelect
                        label="闲鱼价格排序"
                        name="sortOrder"
                        value={
                          filters.sortBy === "xianyuPrice"
                            ? (filters.sortOrder ?? "asc")
                            : ""
                        }
                        onChange={(_, value) => {
                          changeFilter("sortBy", value ? "xianyuPrice" : "");
                          changeFilter("sortOrder", value);
                        }}
                      >
                        <option value="asc">从低到高</option>
                        <option value="desc">从高到低</option>
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
                </div>,
                getShellOverlayRoot(),
              )}

            <details
              className="urgent-auction-zone urgent-auction-drawer workspace-surface js-shell-reveal mt-3"
              aria-labelledby="urgent-auction-title"
            >
              <summary className="urgent-auction-drawer-summary">
                <span className="urgent-auction-drawer-copy">
                  <small>拍卖提醒</small>
                  <strong id="urgent-auction-title">30 分钟临期拍卖</strong>
                </span>
                <span className="urgent-auction-drawer-metrics">
                  <b>{urgentCount}</b>
                  <small>临期</small>
                  <b>{urgentAuctionSelection.items.length}</b>
                  <small>优先</small>
                </span>
                <span className="urgent-auction-drawer-chevron">
                  <ChevronDownIcon />
                </span>
              </summary>
              <div className="urgent-auction-drawer-body">
                <div className="urgent-auction-drawer-toolbar">
                  <ContextInfo
                    label="查看临期拍卖筛选说明"
                    title="临期拍卖筛选"
                  >
                    <p>
                      结束时间在 30 分钟内，商品价加已知邮费不高于当前批次中位数
                      {urgentAuctionSelection.priceMedian != null
                        ? ` ${fmtYen(Math.round(urgentAuctionSelection.priceMedian))}`
                        : ""}
                      。
                    </p>
                    <p className="mt-2">
                      {urgentAuctionSelection.usedUnitFacts &&
                      urgentAuctionSelection.unitMedian != null
                        ? `优先多件装或单位价不高于中位数 ${fmtYen(Math.round(urgentAuctionSelection.unitMedian))}。`
                        : "缺少可比较的数量或单位价时，仅保留低价半区。"}
                      本区不使用 AI 评分。
                    </p>
                  </ContextInfo>
                  <span>临期商品按剩余时间持续更新</span>
                </div>
                <button
                  type="button"
                  onClick={() => void loadUrgentAuctions()}
                  disabled={urgentAuctionsLoading}
                  aria-label="刷新临期拍卖"
                  className="urgent-auction-refresh"
                >
                  <RefreshIcon
                    className={`h-4 w-4 ${urgentAuctionsLoading ? "animate-spin" : ""}`}
                  />
                </button>
                {urgentAuctionsError && !urgentAuctionPool.length ? (
                  <p
                    role="alert"
                    className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800"
                  >
                    临期拍卖暂时无法读取：{urgentAuctionsError}
                  </p>
                ) : urgentAuctionsLoading && !urgentAuctionPool.length ? (
                  <p className="mt-3 rounded-xl bg-fog/55 p-6 text-center text-xs text-ink/45">
                    正在核对全库临期拍卖…
                  </p>
                ) : urgentAuctionSelection.items.length ? (
                  <div className="urgent-auction-grid procurement-grid mt-3 grid auto-rows-max grid-cols-1 items-start gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {urgentAuctionSelection.items.map((item) => (
                      <ProductCard
                        key={`urgent-${item.id}`}
                        item={item}
                        serverOffset={serverOffset}
                        nowTick={nowTick}
                        language={language}
                        translatedTitle={translations[`${item.id}:title`]}
                        onOpen={() => openItemDetail(item)}
                        onPatch={(patch) => patchItem(item.id, patch)}
                        onIgnore={() => setIgnoreItem(item)}
                        onDelete={() => setDeleteItem(item)}
                        onPurchase={() => openPurchaseRegistrationForItem(item)}
                        exchangeRate={exchangeRate?.rate}
                        inCart={cart.items.some(
                          (entry) => entry.id === item.id,
                        )}
                        onCart={() =>
                          updateCart(
                            item.id,
                            !cart.items.some((entry) => entry.id === item.id),
                          )
                        }
                        onShare={() => void shareItems([item.id])}
                        onSendToManager={() => openManagerConversation(item)}
                        inBundleShare={bundleShareItems.some(
                          (entry) => entry.id === item.id,
                        )}
                        onToggleBundleShare={() => toggleBundleShareItem(item)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 rounded-xl border border-dashed border-amber-200 bg-amber-50/35 p-6 text-center text-xs text-ink/50">
                    当前全库筛选条件下，没有同时满足临期与价格事实条件的拍卖。
                  </p>
                )}
              </div>
            </details>

            <section className="catalog-toolbar workspace-surface js-shell-reveal mt-3 rounded-2xl border border-blue-100 bg-white p-3 shadow-panel">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-1">
                  <h2
                    id="inventory"
                    className="font-heading text-lg font-black"
                  >
                    {filters.monitoringCategoryId
                      ? `${monitoringCategories.find((category) => category.id === filters.monitoringCategoryId)?.name ?? "监控分类"} · ${listingTypeLabel(listingMode)} · ${total} 件`
                      : filters.valueKing === "true"
                      ? `性价比之王 · ${total} 件`
                      : filters.hasXianyuComparison === "true"
                        ? `闲鱼同款 · ${xianyuPriceBandLabel(filters.xianyuPriceBand)} · ${listingTypeLabel(listingMode)} · ${total} 条`
                        : `${listingTypeLabel(listingMode)} · ${total.toLocaleString("zh-CN")} 件`}
                  </h2>
                  <ContextInfo
                    label={
                      filters.valueKing === "true"
                        ? "查看入选事实"
                        : filters.hasXianyuComparison === "true"
                          ? "查看闲鱼同款规则"
                          : "查看商品分区说明"
                    }
                    title={
                      filters.valueKing === "true"
                        ? "性价比之王"
                        : filters.hasXianyuComparison === "true"
                          ? "闲鱼同款对价"
                          : "拍卖与直购"
                    }
                  >
                    {filters.valueKing === "true"
                      ? "这里只保留直购、仍在售、数量和邮费明确、品相可售，并具有至少 3 个可信闲鱼同款和有效费用证据的商品。系统不会自动购买。"
                      : filters.hasXianyuComparison === "true"
                        ? "这里只显示至少有 3 个可信同款、带真实闲鱼原链接且仍在有效期内的商品。"
                        : "拍卖和直购分别统计并独立分页，切换时不会混入另一类商品。"}
                  </ContextInfo>
                </div>
                <div
                  className="catalog-actions flex flex-wrap gap-2"
                >
                  {filters.valueKing !== "true" && (
                    <div className="catalog-mode-switch" role="group" aria-label="在售商品类型">
                      <span className="catalog-mode-indicator" aria-hidden="true" style={{transform: `translateX(${listingMode === "direct" ? "100%" : "0%"})`}} />
                      <button
                        type="button"
                        aria-pressed={listingMode === "auction"}
                        onClick={() => changeListingMode("auction")}
                        className={`min-h-11 rounded-lg border px-3 text-xs font-black transition-colors ${listingMode === "auction" ? "border-ink bg-ink text-lime" : "border-blue-200 bg-white text-ink"}`}
                      >
                        拍卖 · {listingCounts.auction}
                      </button>
                      <button
                        type="button"
                        aria-pressed={listingMode === "direct"}
                        onClick={() => changeListingMode("direct")}
                        className={`min-h-11 rounded-lg border px-3 text-xs font-black transition-colors ${listingMode === "direct" ? "border-ink bg-ink text-lime" : "border-blue-200 bg-white text-ink"}`}
                      >
                        直购 · {listingCounts.direct}
                      </button>
                    </div>
                  )}
                  {activeFilterCount > 0 && (
                    <button
                      onClick={resetFilters}
                      className="catalog-clear-button min-h-11 rounded-lg px-3 text-xs font-semibold"
                    >
                      清除 {activeFilterCount} 项
                    </button>
                  )}
                  <button
                    onClick={() => setFiltersOpen(true)}
                    ref={filterTriggerRef}
                    aria-haspopup="dialog"
                    className="catalog-filter-button flex min-h-11 items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 text-xs font-semibold text-moss transition-colors hover:bg-blue-50"
                  >
                    <FilterIcon /> 筛选
                    {activeFilterCount ? ` · ${activeFilterCount}` : ""}
                  </button>
                  <button
                    onClick={() => void load()}
                    disabled={loading}
                    aria-label={loading ? "正在刷新商品" : "刷新商品"}
                    title={loading ? "正在刷新" : "刷新商品"}
                    className="catalog-refresh-button grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:opacity-50"
                  >
                    <RefreshIcon
                      className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                    />
                  </button>
                </div>
              </div>
              {filters.hasXianyuComparison === "true" && (
                <div
                  className="xianyu-catalog-bands"
                  role="group"
                  aria-label="按闲鱼参考价分类"
                >
                  <button
                    type="button"
                    aria-pressed={!filters.xianyuPriceBand}
                    onClick={() =>
                      openXianyuComparisonCatalog(
                        undefined,
                        filters.sortOrder === "desc" ? "desc" : "asc",
                      )
                    }
                  >
                    <span>全部</span>
                    <strong>
                      {overview?.market?.xianyuComparison?.total ?? 0}
                    </strong>
                  </button>
                  {XIANYU_PRICE_BANDS.map((band) => {
                    const count =
                      overview?.market?.xianyuComparison?.priceBands.find(
                        (entry) => entry.key === band.key,
                      )?.count ?? 0;
                    return (
                      <button
                        type="button"
                        key={band.key}
                        aria-pressed={filters.xianyuPriceBand === band.key}
                        disabled={count === 0}
                        onClick={() =>
                          openXianyuComparisonCatalog(
                            band.key,
                            filters.sortOrder === "desc" ? "desc" : "asc",
                          )
                        }
                      >
                        <span>{band.label}</span>
                        <strong>{count}</strong>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="xianyu-catalog-sort"
                    aria-label={
                      filters.sortOrder === "desc"
                        ? "当前闲鱼价格从高到低，点击改为从低到高"
                        : "当前闲鱼价格从低到高，点击改为从高到低"
                    }
                    onClick={() =>
                      openXianyuComparisonCatalog(
                        filters.xianyuPriceBand as
                          | "lt_300"
                          | "300_999"
                          | "gte_1000"
                          | undefined,
                        filters.sortOrder === "desc" ? "asc" : "desc",
                      )
                    }
                  >
                    {filters.sortOrder === "desc" ? "价格 ↓" : "价格 ↑"}
                  </button>
                </div>
              )}
            </section>
            {exchangeRateFailed && !exchangeRate && (
              <p className="mt-3 text-xs font-semibold text-ink/50">
                汇率暂不可用，人民币价格稍后恢复。
              </p>
            )}
            {error && (
              <LoadError
                message="商品同步暂时不可用，当前已加载内容会继续保留。"
                onRetry={() => void load()}
                retrying={loading}
                retryTestId="retry-catalog"
              />
            )}
            {loading && items.length === 0 ? (
              <div className="mt-3 grid min-h-52 place-items-center rounded-2xl border border-dashed border-blue-200 bg-white py-16 text-sm font-bold text-slate-500">
                正在同步采购情报…
              </div>
            ) : (
              <div className="mt-3">
                {items.length ? (
                  <div className="procurement-grid grid auto-rows-max grid-cols-2 items-start gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                    {items.map((item) => (
                      <ProductCard
                        key={item.id}
                        item={item}
                        serverOffset={serverOffset}
                        nowTick={nowTick}
                        language={language}
                        translatedTitle={translations[`${item.id}:title`]}
                        onOpen={() => openItemDetail(item)}
                        onPatch={(patch) => patchItem(item.id, patch)}
                        onIgnore={() => setIgnoreItem(item)}
                        onDelete={() => setDeleteItem(item)}
                        onPurchase={() => openPurchaseRegistrationForItem(item)}
                        exchangeRate={exchangeRate?.rate}
                        inCart={cart.items.some(
                          (entry) => entry.id === item.id,
                        )}
                        onCart={() =>
                          updateCart(
                            item.id,
                            !cart.items.some((entry) => entry.id === item.id),
                          )
                        }
                        onShare={() => void shareItems([item.id])}
                        onSendToManager={() => openManagerConversation(item)}
                        inBundleShare={bundleShareItems.some(
                          (entry) => entry.id === item.id,
                        )}
                        onToggleBundleShare={() => toggleBundleShareItem(item)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-blue-200 bg-white p-6 text-center text-sm text-ink/50">
                    {filters.valueKing === "true"
                      ? "当前没有证据完整且无需砍价的直购商品"
                      : filters.hasXianyuComparison === "true"
                        ? `暂无${listingTypeLabel(listingMode)} · ${xianyuPriceBandLabel(filters.xianyuPriceBand)}的可信闲鱼同款`
                        : "当前筛选条件下没有商品"}
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
            {catalogView === "favorites" && (
              <FavoritesWorkspace
                apiBaseUrl={API}
                actor={activeManagerId || undefined}
                language={language}
                translations={translations}
                nowTick={nowTick}
                exchangeRate={exchangeRate?.rate}
                serverOffset={serverOffset}
                changeBatch={favoriteChangeBatch}
                onPublishChanges={publishFavoriteChanges}
                cartItemIds={cartItemIdSet}
                bundleShareItemIds={bundleShareItemIdSet}
                onOpenItem={openItemDetail}
                onPurchaseItem={openPurchaseRegistrationForItem}
                onCartItem={(item) =>
                  void updateCart(item.id, !cartItemIdSet.has(item.id), item)
                }
                onShareItem={(item) => void shareItems([item.id])}
                onIgnoreItem={(item) => setIgnoreItem(item)}
                onDeleteItem={(item) => setDeleteItem(item)}
                onSendToManagerItem={(item) => openManagerConversation(item)}
                onToggleBundleShareItem={toggleBundleShareItem}
              />
            )}
            {catalogView === "links" && (
              <div className="link-editorial-layout">
                <section className="ios-surface workspace-surface mb-4 rounded-2xl border border-blue-100 p-4 shadow-panel">
                <div className="link-editorial-heading">
                  <div className="flex min-w-0 items-center gap-1">
                    <h2 className="font-heading text-xl font-black">
                      链接导入
                    </h2>
                    <ContextInfo
                      label="查看链接导入说明"
                      title="链接导入说明"
                    >
                      <p>
                        每行可粘贴一个公开商品链接，一次最多导入
                        {URL_IMPORT_LIMIT}{" "}
                        个。系统会自动识别来源并在后台分析。
                      </p>
                      <p className="mt-2">
                        分析完成后会生成标准商品卡，不会自动加入收藏夹。
                      </p>
                    </ContextInfo>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void Promise.all([loadImports(), loadLinkItems()])
                    }
                    aria-label="刷新链接专区"
                    title="刷新"
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-moss shadow-sm transition-colors hover:bg-blue-50"
                  >
                    <RefreshIcon />
                  </button>
                </div>
                <div className="link-entry-form link-import-plane">
                  <div className="flex items-center justify-between gap-3">
                    <label
                      htmlFor="product-url-links"
                      className="text-sm font-bold text-ink"
                    >
                      商品链接
                    </label>
                    <span
                      className={`font-mono text-[11px] tabular-nums ${urlInputCount > URL_IMPORT_LIMIT ? "font-semibold text-moss" : "text-ink/45"}`}
                    >
                      {urlInputCount} 个
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <textarea
                      id="product-url-links"
                      inputMode="url"
                      rows={3}
                      value={urlInput}
                      onChange={(event) => setUrlInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          (event.ctrlKey || event.metaKey)
                        ) {
                          event.preventDefault();
                          void analyzeUrl();
                        }
                      }}
                      aria-describedby="url-help-links"
                      placeholder={"粘贴商品链接，每行一个"}
                      className="min-h-[92px] min-w-0 resize-y rounded-xl border border-ink/10 bg-fog/55 px-3 py-2 text-sm leading-6 text-ink placeholder:text-ink/35"
                    />
                    <button
                      type="button"
                      disabled={urlSubmitting || urlInputCount === 0}
                      onClick={() => void analyzeUrl()}
                      className="min-h-11 shrink-0 rounded-xl bg-moss px-4 text-sm font-bold text-white transition-[background-color,transform] hover:bg-blue-800 disabled:opacity-45"
                    >
                      {urlSubmitting ? "提交中…" : "开始导入"}
                    </button>
                  </div>
                  <div
                    id="url-help-links"
                    className={`mt-2 min-h-5 text-xs ${urlMessage ? "font-semibold text-moss" : "text-ink/45"}`}
                    aria-live="polite"
                  >
                    {urlMessage}
                  </div>
                </div>
                <div className="link-task-list mt-3 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-ink/5">
                  <button
                    type="button"
                    aria-expanded={importsExpanded}
                    aria-controls="link-import-tasks"
                    onClick={() => setImportsExpanded((value) => !value)}
                    className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left transition-colors hover:bg-fog/45"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-ink">
                        导入任务 · {imports.length}
                      </span>
                      <span className="block truncate text-[11px] text-ink/45">
                        {importSummary.active
                          ? `${importSummary.active} 个进行中`
                          : `${importSummary.succeeded} 个完成`}
                        {importSummary.failed
                          ? ` · ${importSummary.failed} 个待重试`
                          : ""}
                      </span>
                    </span>
                    <ChevronDownIcon
                      className={`h-4 w-4 shrink-0 text-ink/45 transition-transform duration-200 ${importsExpanded ? "rotate-180" : ""}`}
                    />
                  </button>
                  {importsError && (
                    <div className="border-t border-ink/8 bg-white px-3 py-2">
                      <LoadError
                        message={importsError}
                        onRetry={() => void loadImports()}
                        retryTestId="retry-imports"
                        className="quiet-inline-alert"
                      />
                    </div>
                  )}
                  {importsExpanded && (
                    <div
                      id="link-import-tasks"
                      className="grid gap-px border-t border-ink/8 bg-ink/8"
                    >
                      {imports.length === 0 ? (
                        importsError ? null : (
                          <p className="bg-white px-3 py-6 text-center text-sm text-ink/45">
                            暂无导入任务
                          </p>
                        )
                      ) : (
                        imports.map((entry) => {
                          const active =
                            entry.status === "queued" ||
                            entry.status === "running";
                          const failed = entry.status === "failed";
                          return (
                            <article
                              key={entry.id}
                              className="grid min-w-0 gap-2 bg-white px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span
                                    aria-hidden="true"
                                    className={`h-2 w-2 shrink-0 rounded-full ${failed ? "bg-rust" : active ? "bg-amber-500" : "bg-emerald-400"}`}
                                  />
                                  <span className="text-[11px] font-semibold text-ink/60">
                                    {entry.status === "queued"
                                      ? "排队中"
                                      : entry.status === "running"
                                        ? "分析中"
                                        : entry.status === "succeeded"
                                          ? "已完成"
                                          : "失败"}
                                  </span>
                                  <span className="font-mono text-[11px] tabular-nums text-ink/40">
                                    {entry.progress}%
                                  </span>
                                </div>
                                <p
                                  className="mt-1 truncate text-xs font-semibold text-ink"
                                  title={entry.sourceUrl}
                                >
                                  {entry.sourceUrl}
                                </p>
                                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fog">
                                  <div
                                    className={`h-full rounded-full transition-[width] duration-300 ${failed ? "bg-rust" : "bg-moss"}`}
                                    style={{
                                      width: `${Math.min(100, Math.max(0, entry.progress))}%`,
                                    }}
                                  />
                                </div>
                                <p className="mt-1 truncate text-[10px] text-ink/45">
                                  {entry.errorText
                                    ? friendlyImportError(entry.errorText)
                                    : (entry.currentStep ?? "等待任务状态")}
                                </p>
                              </div>
                              <div className="flex min-h-11 items-center justify-end gap-2">
                                {failed && (
                                  <button
                                    type="button"
                                    disabled={importActionId === entry.id}
                                    onClick={() => void retryImport(entry.id)}
                                    className="min-h-11 rounded-xl bg-moss px-3 text-xs font-semibold text-white disabled:opacity-45"
                                  >
                                    重试
                                  </button>
                                )}
                                {!active && (
                                  <button
                                    type="button"
                                    disabled={importActionId === entry.id}
                                    onClick={() =>
                                      void removeImport(entry.id)
                                    }
                                    className="min-h-11 rounded-xl bg-fog px-3 text-xs font-semibold text-ink/60 disabled:opacity-45"
                                  >
                                    清除
                                  </button>
                                )}
                              </div>
                            </article>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
                <div className="mt-5 flex items-center justify-between gap-3">
                  <h3 className="font-heading text-base font-black">
                    已导入商品 · {linkTotal}
                  </h3>
                </div>
                {linkError && (
                  <LoadError
                    message={linkError}
                    onRetry={() => void loadLinkItems()}
                    retryTestId="retry-link-items"
                  />
                )}
                <div className="mt-2 grid auto-rows-max grid-cols-2 items-start gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {linkItems.length === 0 ? (
                    linkError ? null : (
                      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-ink/50 sm:col-span-2 lg:col-span-3">
                        分析完成后商品会显示在这里
                      </p>
                    )
                  ) : (
                    linkItems.map((item) => (
                      <ProductCard
                        key={`link-${item.id}`}
                        item={item}
                        serverOffset={serverOffset}
                        nowTick={nowTick}
                        language={language}
                        translatedTitle={translations[`${item.id}:title`]}
                        onOpen={() => openItemDetail(item)}
                        onPatch={(patch) => patchItem(item.id, patch)}
                        onIgnore={() => setIgnoreItem(item)}
                        onDelete={() => setDeleteItem(item)}
                        onPurchase={() => openPurchaseRegistrationForItem(item)}
                        exchangeRate={exchangeRate?.rate}
                        inCart={cart.items.some(
                          (entry) => entry.id === item.id,
                        )}
                        onCart={() =>
                          updateCart(
                            item.id,
                            !cart.items.some((entry) => entry.id === item.id),
                          )
                        }
                        onShare={() => void shareItems([item.id])}
                        onSendToManager={() => openManagerConversation(item)}
                        inBundleShare={bundleShareItems.some(
                          (entry) => entry.id === item.id,
                        )}
                        onToggleBundleShare={() => toggleBundleShareItem(item)}
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
                </section>
              </div>
            )}
            {catalogView === "disliked" && (
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
                {dislikedError && (
                  <LoadError
                    message={dislikedError}
                    onRetry={() => void loadDisliked()}
                    retryTestId="retry-disliked"
                  />
                )}
                {dislikedItems.length === 0 ? (
                  dislikedError ? null : (
                    <p className="mt-3 rounded-xl border border-dashed border-blue-200 p-8 text-center text-sm text-ink/50">
                      暂无商品
                    </p>
                  )
                ) : (
                  <div className="procurement-grid mt-3 grid auto-rows-max grid-cols-2 items-start gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                    {dislikedItems.map((item) => (
                      <ProductCard
                        key={item.id}
                        item={item}
                        language={language}
                        translatedTitle={translations[`${item.id}:title`]}
                        exchangeRate={exchangeRate?.rate}
                        serverOffset={serverOffset}
                        nowTick={nowTick}
                        onOpen={() => openItemDetail(item)}
                        onPatch={(patch) => patchItem(item.id, patch, item)}
                        onIgnore={() =>
                          void patchItem(item.id, { ignored: false }, item)
                        }
                        onDelete={() => setDeleteItem(item)}
                        onPurchase={() => openPurchaseRegistrationForItem(item)}
                        inCart={cartItemIdSet.has(item.id)}
                        onCart={() =>
                          void updateCart(
                            item.id,
                            !cartItemIdSet.has(item.id),
                            item,
                          )
                        }
                        onShare={() => void shareItems([item.id])}
                        onSendToManager={() => openManagerConversation(item)}
                        inBundleShare={bundleShareItemIdSet.has(item.id)}
                        onToggleBundleShare={() =>
                          toggleBundleShareItem(item)
                        }
                      />
                    ))}
                  </div>
                )}
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
          </>
        )}
      </div>
      <div id="floating-controls-root" />
      <WorkspaceHistoryOrb
        entries={recentWorkspaces}
        currentWorkspace={workspace}
        onSelect={revisitWorkspace}
      />
      <PrimaryNavigation
        activeWorkspace={navigationWorkspace}
        unreadCount={unreadMessageCount}
        pendingDecisionCount={pendingDecisionCount}
        todoCount={todoCount}
        onNavigate={navigateWorkspace}
      />
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
      {settingsOpen &&
        createPortal(
          <div
            className="modal-backdrop absolute inset-0 z-[95] grid place-items-center bg-ink/50 p-4"
            onMouseDown={() => setSettingsOpen(false)}
          >
            <section
              id="settings-dialog"
              ref={settingsDialogRef}
              role="dialog"
              tabIndex={-1}
              aria-modal="true"
              aria-labelledby="settings-dialog-title"
              className="modal-panel settings-dialog-panel ios-surface w-full rounded-3xl p-4 shadow-modal"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <h2
                  id="settings-dialog-title"
                  className="font-heading text-xl font-black text-ink"
                >
                  设置
                </h2>
                <button
                  ref={settingsCloseRef}
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="关闭设置"
                  className="grid h-11 w-11 place-items-center rounded-full bg-white shadow-sm"
                >
                  <CloseIcon />
                </button>
              </div>
              <div className="mt-4 grid gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setLanguage((current) =>
                      current === "zh" ? "original" : "zh",
                    )
                  }
                  className="flex min-h-12 items-center gap-3 rounded-2xl bg-white px-3 text-left shadow-sm"
                >
                  <TranslateIcon className="h-5 w-5" />
                  <span className="min-w-0 flex-1 text-sm font-semibold">
                    显示语言
                  </span>
                  <span className="text-xs text-ink/50">
                    {language === "zh" ? "中文" : "原文"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSettingsOpen(false);
                    navigateWorkspace("monitoring");
                  }}
                  className="flex min-h-12 items-center gap-3 rounded-2xl bg-white px-3 text-left shadow-sm"
                >
                  <SettingsIcon className="h-5 w-5" />
                  <span className="min-w-0 flex-1 text-sm font-semibold">
                    {TERMS.monitoring}
                  </span>
                  <span aria-hidden="true" className="text-ink/35">
                    ›
                  </span>
                </button>
                <div className="rounded-2xl bg-white px-3 py-3 shadow-sm">
                  <div className="flex min-h-6 items-center gap-3">
                    <AnalysisIcon className="h-5 w-5" />
                    <span className="min-w-0 flex-1 text-sm font-semibold">
                      AI 状态
                    </span>
                  </div>
                  <p className="mt-1 pl-8 text-xs text-ink/50">
                    {settingsAiSummary || "正在读取额度状态…"}
                  </p>
                </div>
              </div>
            </section>
          </div>,
          getShellOverlayRoot(),
        )}
      {selected && (
        <DetailDrawer
          item={selected}
          language={language}
          translatedTitle={translations[`${selected.id}:title`]}
          translatedDescription={translations[`${selected.id}:description`]}
          translationError={translationErrors[selected.id]}
          onRetryTranslation={() =>
            void requestFullItemTranslation(selected, { retry: true })
          }
          exchangeRate={exchangeRate?.rate}
          serverOffset={serverOffset}
          onClose={closeItemDetail}
          onSendToManager={() => openManagerConversation(selected)}
          inCart={cart.items.some((entry) => entry.id === selected.id)}
          onToggleFavorite={() =>
            void patchItem(selected.id, { favorite: !selected.favorite })
          }
          onToggleCart={() =>
            void updateCart(
              selected.id,
              !cart.items.some((entry) => entry.id === selected.id),
            )
          }
          onShare={() => void shareItems([selected.id])}
          onPurchase={() => openPurchaseRegistrationForItem(selected)}
          onIgnore={() => setIgnoreItem(selected)}
          onDelete={() => setDeleteItem(selected)}
          onOpenSeller={(targetSellerId) => {
            closeItemDetail();
            setSellerId(targetSellerId);
          }}
          onSaved={(updated) => {
            setSelected(updated);
            setItems((current) =>
              current.map((item) => (item.id === updated.id ? updated : item)),
            );
            setLinkItems((current) =>
              current.map((item) => (item.id === updated.id ? updated : item)),
            );
            setUrgentAuctionPool((current) =>
              current.map((item) => (item.id === updated.id ? updated : item)),
            );
            publishFavoriteChanges([{ item: updated, patch: updated }]);
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
            void openAnalysisItem(item.id);
          }}
          onSendBundle={(selectedSellerItems, targetPriceYen) => {
            openManagerBundleConversation(selectedSellerItems, targetPriceYen);
          }}
          onBundleCopied={(itemIds) => markCopiedForItems(itemIds)}
        />
      )}
      {purchaseRegistration && (
        <PurchaseRegistrationForm
          apiBaseUrl={API}
          accountId={activeManagerId || undefined}
          exchangeRate={exchangeRate?.rate}
          items={purchaseRegistration.items}
          candidateItems={purchaseRegistration.candidateItems}
          bundle={purchaseRegistration.bundle ?? null}
          initialTotal={purchaseRegistration.initialTotal}
          initialAmounts={purchaseRegistration.initialAmounts}
          platform={purchaseRegistration.platform}
          onClose={() => setPurchaseRegistration(null)}
          onSaved={(savedBundle) => {
            setPurchaseRegistration(null);
            setSelectedPurchaseJobIds([]);
            const savedItemIds = new Set(
              savedBundle.purchases.map((purchase) => purchase.itemId),
            );
            setPurchaseLinkJobs((current) =>
              current.filter(
                (job) => !job.item || !savedItemIds.has(job.item.id),
              ),
            );
            void Promise.all([
              loadPurchases(),
              loadPurchaseBundles(),
              load(),
              loadLinkItems(),
            ]);
          }}
        />
      )}
      {purchaseHistoryBundle && (
        <PurchaseBundleHistoryDialog
          bundle={purchaseHistoryBundle}
          onClose={() => setPurchaseHistoryBundle(null)}
        />
      )}
      <PurchaseReceiptPreviewDialog
        request={purchaseReceiptPreview}
        onClose={() => setPurchaseReceiptPreview(null)}
      />
      {deleteItem && (
        <DeleteConfirmationDialog
          item={deleteItem}
          translatedTitle={translations[`${deleteItem.id}:title`]}
          onCancel={() => setDeleteItem(null)}
          onConfirm={async () => {
            const ok = await deleteItemRequest(deleteItem.id, deleteItem);
            if (ok) {
              if (selected?.id === deleteItem.id) closeItemDetail();
              await syncChanges().catch(() => undefined);
            }
            return ok;
          }}
        />
      )}
      {ignoreItem && (
        <IgnoreConfirmationDialog
          item={ignoreItem}
          translatedTitle={translations[`${ignoreItem.id}:title`]}
          onCancel={() => setIgnoreItem(null)}
          onConfirm={async () => {
            await patchItem(ignoreItem.id, { ignored: true }, ignoreItem);
            if (selected?.id === ignoreItem.id) closeItemDetail();
            await syncChanges().catch(() => undefined);
          }}
        />
      )}
      {workspace !== "collaboration" && bundleShareItems.length > 0 && (
        <div
          role="region"
          aria-label="待分享凑单篮"
          className="fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white/95 px-3.5 py-2.5 shadow-modal backdrop-blur-md"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center rounded-full bg-ink px-2 py-0.5 text-[11px] font-bold text-white">
                凑单篮 · {bundleShareItems.length} 件
              </span>
              <strong className="truncate font-mono text-xs font-bold text-ink tabular-nums">
                合计{" "}
                {fmtYen(
                  bundleShareItems.reduce(
                    (sum, entry) => sum + entry.priceCurrent,
                    0,
                  ),
                )}
              </strong>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-ink/55">
              {(() => {
                const sellerIds = Array.from(
                  new Set(
                    bundleShareItems
                      .map((entry) => entry.seller?.id)
                      .filter((id): id is string => Boolean(id)),
                  ),
                );
                const firstSellerName = bundleShareItems[0]?.seller?.name;
                if (sellerIds.length === 1 && firstSellerName) {
                  return `同店：${firstSellerName}（可一键生成合并砍价日语）`;
                }
                return "可继续勾选商品，或直接集合发给搭档砍价";
              })()}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {(() => {
              const singleSellerId =
                bundleShareItems.length > 0 &&
                bundleShareItems.every(
                  (entry) =>
                    entry.seller?.id &&
                    entry.seller.id === bundleShareItems[0]?.seller?.id,
                )
                  ? bundleShareItems[0]?.seller?.id
                  : null;
              return singleSellerId ? (
                <button
                  type="button"
                  onClick={() => setSellerId(singleSellerId)}
                  className="min-h-9 rounded-xl border border-black/10 bg-black/[0.04] px-2.5 text-xs font-semibold text-ink transition active:scale-95 hover:bg-black/[0.08]"
                >
                  看同店
                </button>
              ) : null;
            })()}
            <button
              type="button"
              onClick={() => setBundleShareItems([])}
              className="min-h-9 rounded-xl border border-black/10 bg-white px-2.5 text-xs font-medium text-ink/65 transition active:scale-95 hover:bg-black/[0.04]"
            >
              清空
            </button>
            <button
              type="button"
              onClick={() => {
                const toSend = [...bundleShareItems];
                setBundleShareItems([]);
                openManagerBundleConversation(toSend);
              }}
              className="min-h-9 rounded-xl bg-ink px-3.5 text-xs font-semibold text-white shadow-sm transition active:scale-95 hover:bg-ink/90"
            >
              集合发给搭档 →
            </button>
          </div>
        </div>
      )}
      {workspace !== "collaboration" && (
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          aria-label={`打开购物车${cart.count ? `，${cart.count} 件` : ""}`}
          title="购物车"
          className="cart-fab fixed bottom-[7.25rem] right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-black text-white shadow-modal transition-transform active:scale-[.97] motion-reduce:transition-none"
        >
          <CartIcon className="h-6 w-6" />
          {cart.count > 0 && (
            <span className="absolute -right-1 -top-1 grid h-6 min-w-6 place-items-center rounded-full bg-rust px-1 font-mono text-[10px] font-bold text-white">
              {cart.count}
            </span>
          )}
        </button>
      )}
      {cartOpen && (
        <CartDialog
          cart={cart}
          exchangeRate={exchangeRate?.rate}
          language={language}
          translations={translations}
          sharing={cartSharing}
          message={shareMessage}
          onRemove={(itemId) => updateCart(itemId, false)}
          onOpen={(item) => {
            setCartOpen(false);
            void openAnalysisItem(item.id);
          }}
          onShare={() => void shareItems()}
          onSendBundle={() => openManagerBundleConversation(cart.items)}
          onClose={() => setCartOpen(false)}
        />
      )}
      {purchaseGallery && (
        <ItemImagesDialog
          item={purchaseGallery}
          title={itemDisplayTitle(purchaseGallery, language)}
          onClose={() => setPurchaseGallery(null)}
        />
      )}
      <div id={SHELL_OVERLAY_ROOT_ID} className="shell-overlay-root" />
      {accountGateOpen &&
        shellOverlayRoot &&
        createPortal(
          <ManagerAccountGate
            accounts={managerAccounts}
            loading={managerAccountsLoading}
            error={managerAccountsError}
            onRetry={() => void loadManagerAccounts()}
            onSelect={selectManagerAccount}
            logo={<RiderLogo className="h-9 w-9" />}
          />,
          shellOverlayRoot,
        )}
    </main>
  );
}
