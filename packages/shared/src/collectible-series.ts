import type { CategoryIp } from "./types.js";
import { classifyShfListing } from "./shf.js";

export const collectibleSeriesKeys = ["shf", "sic"] as const;
export type CollectibleSeriesKey = (typeof collectibleSeriesKeys)[number];

export const SIC_SEARCH_KEYWORDS = [
  "仮面ライダー S.I.C.",
  "仮面ライダー SIC まとめ売り",
  "S.I.C. 仮面ライダー",
  "S.I.C. 極魂 仮面ライダー",
] as const;

const SIC_IDENTITY =
  /(?:^|[^\p{L}\p{N}])(?:S\.?\s*I\.?\s*C\.?|SIC極魂)(?=$|[^\p{L}\p{N}])/iu;

export function isSicListing(input: {
  titleRaw: string;
  descriptionRaw?: string | null;
  categoryIp: CategoryIp | string;
}) {
  if (input.categoryIp !== "kamen_rider") return false;
  return SIC_IDENTITY.test(`${input.titleRaw}\n${input.descriptionRaw ?? ""}`);
}

/**
 * Stable collection membership shared by crawler ingestion, manual repair and
 * historical backfills. SHF and S.I.C. remain independent product families.
 */
export function classifyCollectibleSeries(input: {
  titleRaw: string;
  descriptionRaw?: string | null;
  categoryIp: CategoryIp | string;
}): CollectibleSeriesKey | null {
  if (classifyShfListing(input)) return "shf";
  return isSicListing(input) ? "sic" : null;
}
