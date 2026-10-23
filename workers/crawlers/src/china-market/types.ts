export type ChinaMarketplaceKey = "xianyu" | "taobao";

export type RawChinaMarketOffer = {
  platform: ChinaMarketplaceKey;
  sourceListingId: string;
  sourceUrl: string;
  titleRaw: string;
  priceCny: number;
  imageUrl?: string;
  locationText?: string;
  conditionRaw?: string;
  status: "active" | "sold" | "ended" | "unknown";
  sourceData?: Record<string, unknown>;
  provenance?: {
    providerKey: string;
    providerRunId?: string;
    queryKeyword: string;
  };
};

export type ChinaMarketSearchResult = {
  offers: RawChinaMarketOffer[];
  complete: boolean;
  stats: {
    requestedKeywords: number;
    attemptedKeywords: number;
    rejectedRows: number;
  };
};

export type ChinaMarketProvider = {
  key: ChinaMarketplaceKey;
  search(
    keywords: string[],
    totalLimit: number,
    context?: {
      resumeProviderRuns?: Record<string, string>;
      onProviderRun?: (keyword: string, runId: string) => Promise<void>;
      onProviderRunTerminal?: (
        keyword: string,
        runId: string,
        status: string,
      ) => Promise<void>;
    },
  ): Promise<ChinaMarketSearchResult>;
};

export type ChinaProductReference = {
  productId: string;
  itemId?: string;
  canonicalName: string;
  normalizedName: string;
  titleZh?: string | null;
  productLine?: string | null;
  modelNumber?: string | null;
  releaseYear?: number | null;
  franchiseNames: string[];
  seriesNames: string[];
  manufacturerNames: string[];
  toyTypeNames: string[];
  categoryIp?:
    | "kamen_rider"
    | "ultraman"
    | "super_sentai"
    | "godzilla"
    | "other"
    | "unknown"
    | null;
  collectibleSeries?: "shf" | "sic" | null;
  shfLine?: "standard" | "shinkocchou" | null;
  shfReleaseChannel?: "retail" | "tamashii_web" | "event" | "unknown" | null;
  shfEdition?: "first" | "reissue" | "unknown" | null;
  shfRegion?: "japanese" | "agent" | "hong_kong" | "unknown" | null;
  conditionGrade?:
    | "new_sealed"
    | "like_new"
    | "used"
    | "stained_or_damaged"
    | "junk"
    | "unknown"
    | null;
  listingTitleRaw: string;
  listingTitleZh?: string | null;
  listingDescription?: string | null;
  listingCondition?: string | null;
  quantity?: number | null;
  referenceImageUrls: string[];
};

export type DeterministicMatch = {
  score: number;
  excluded: boolean;
  reasons: string[];
  factors: {
    title: number;
    attributes: number;
    modelNumber: number;
    query: number;
  };
};

export type AiCandidateDecision = {
  sourceListingId: string;
  sameProduct: boolean;
  confidence: number;
  accessoryOnly?: boolean;
  damaged?: boolean;
  quantityConflict?: boolean;
  modelConflict?: boolean;
  versionConflict?: boolean;
  scaleConflict?: boolean;
  conditionConflict?: boolean;
  evidence: string[];
};

export type ChinaCandidateForAi = {
  offer: RawChinaMarketOffer;
  deterministic: DeterministicMatch;
};
