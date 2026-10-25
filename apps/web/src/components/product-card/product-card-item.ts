import type { ChinaComparisonEvidence } from "../../lib/china-comparison";
import type { ListingType } from "../../lib/listing-type";

/** The only patches a card can send back to its parent list. */
export type ProductCardPatch = {
  favorite?: boolean;
  note?: string | null;
};

/**
 * Structural subset of the dashboard Item that the card actually renders.
 * Lists keep passing their full item objects; nothing is fetched or reshaped
 * for the card.
 */
export type ProductCardItem = {
  id: string;
  sourceUrl: string;
  titleRaw: string;
  titleZh?: string | null;
  priceCurrent: number;
  shippingFee?: number | null;
  quantityEst?: number | null;
  status?: string | null;
  lastSeenAt?: string | null;
  refreshFailureCount?: number | null;
  listingType: ListingType;
  auctionEndAt?: string | null;
  detectedAt: string;
  listedAt?: string | null;
  categoryIp: string;
  categoryToyType: string;
  shfLine?: "standard" | "shinkocchou" | null;
  manufacturer: string;
  conditionGrade: string;
  needsReview: boolean;
  favorite: boolean;
  /** Set when the card renders inside the 不感兴趣 view: the ignore
   * action becomes a restore, and the reason chip can show. */
  ignored?: boolean;
  ignoredReason?: string | null;
  note?: string | null;
  sourceData?: Record<string, unknown> | null;
  source: { key: string; displayName: string };
  images: { url: string; position: number }[];
  product?: {
    canonicalName?: string | null;
    titleZh?: string | null;
    series?: { nameZh: string } | null;
    toyTypeEntity?: { nameZh: string } | null;
    manufacturerEntity?: { nameZh: string } | null;
  } | null;
  chinaComparison?: ChinaComparisonEvidence | null;
  valueKing?: {
    label: string;
    facts: string[];
  } | null;
};

export type ProductCardProps = {
  item: ProductCardItem;
  serverOffset: number;
  nowTick: number;
  language: "zh" | "original";
  translatedTitle?: string;
  onOpen: () => void;
  onPatch: (patch: ProductCardPatch) => void | Promise<void | boolean>;
  onIgnore: () => void;
  onDelete: () => void;
  onPurchase: () => void;
  exchangeRate?: number;
  inCart: boolean;
  onCart: () => void | Promise<void | boolean>;
  onShare: () => void;
  onSendToManager: () => void;
  inBundleShare?: boolean;
  onToggleBundleShare?: () => void;
};
