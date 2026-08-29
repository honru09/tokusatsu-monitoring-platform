export const categoryIps = [
  "kamen_rider",
  "ultraman",
  "other",
  "unknown",
] as const;
export type CategoryIp = (typeof categoryIps)[number];

export const toyTypes = [
  "gashapon",
  "shokugan",
  "figure",
  "sofubi",
  "finger_puppet",
  "dx_belt",
  "henshin_item",
  "card",
  "medal",
  "model",
  "set",
  "other",
  "unknown",
] as const;
export type ToyType = (typeof toyTypes)[number];

export const manufacturers = [
  "bandai",
  "bandai_spirits",
  "banpresto",
  "megahouse",
  "plex",
  "other",
  "unknown",
] as const;
export type Manufacturer = (typeof manufacturers)[number];

export const conditionGrades = [
  "new_sealed",
  "like_new",
  "used",
  "stained_or_damaged",
  "junk",
  "unknown",
] as const;
export type ConditionGrade = (typeof conditionGrades)[number];

export type SourceChannel = "online" | "physical_store";
export type ItemStatus = "active" | "sold" | "ended" | "reserved" | "unknown";

export interface SearchQuery {
  keyword: string;
  ip?: CategoryIp;
  highPriority?: boolean;
  limit?: number;
  pageStart?: number;
  pages?: number;
  scanMode?: "incremental" | "backfill";
  rotatePages?: boolean;
}

export interface SearchResult {
  sourceItemId: string;
  sourceUrl: string;
  titleHint?: string;
}

export interface RawItemDetail {
  sourcePlatform: string;
  sourceItemId: string;
  sourceUrl: string;
  titleRaw: string;
  descriptionRaw?: string;
  sellerName?: string;
  sellerType?: "individual" | "store" | "unknown";
  locationText?: string;
  priceCurrent: number;
  shippingFee?: number;
  listedAt?: Date;
  auctionEndAt?: Date;
  bidCount?: number;
  conditionRaw?: string;
  imageUrls: string[];
  status: ItemStatus;
  channel: SourceChannel;
}

export interface NormalizedItem extends RawItemDetail {
  priceTotalEst: number;
  categoryIp: CategoryIp;
  categoryToyType: ToyType;
  manufacturer: Manufacturer;
  conditionGrade: ConditionGrade;
  quantityEst?: number;
  unitCostEst?: number;
  confidence: number;
  needsReview: boolean;
}

export interface StoredItem {
  sourceItemId: string;
  sourceUrl: string;
  auctionEndAt?: Date | null;
  status: ItemStatus;
}

export interface ItemStatusUpdate {
  status: ItemStatus;
  priceCurrent?: number;
  shippingFee?: number;
  auctionEndAt?: Date;
  bidCount?: number;
}

export interface SourceAdapter {
  readonly key: string;
  readonly displayName: string;
  search(query: SearchQuery): Promise<SearchResult[]>;
  fetchDetail(item: SearchResult): Promise<RawItemDetail>;
  refreshStatus(item: StoredItem): Promise<ItemStatusUpdate>;
  normalize(raw: RawItemDetail): Promise<NormalizedItem>;
}

export interface EvidenceField<T> {
  value: T | null;
  confidence: number;
  evidence: string[];
}

export interface VisionClassification {
  franchise: EvidenceField<CategoryIp[]>;
  series: EvidenceField<string[]>;
  characters: EvidenceField<string[]>;
  toyTypes: EvidenceField<ToyType[]>;
  manufacturers: EvidenceField<Manufacturer[]>;
  quantity: EvidenceField<number>;
  sealedCount: EvidenceField<number>;
  packaging: EvidenceField<string[]>;
  condition: EvidenceField<ConditionGrade>;
  visibleDamage: EvidenceField<string[]>;
  missingParts: EvidenceField<string[]>;
  backMarkings: EvidenceField<string[]>;
  year: EvidenceField<number>;
  modelNumber: EvidenceField<string>;
  copyrightText: EvidenceField<string[]>;
  confidence: number;
}
