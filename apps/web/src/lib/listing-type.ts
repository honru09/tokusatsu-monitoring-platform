export const listingTypes = ["direct", "auction", "unknown"] as const;
/** Listing modes users can actively browse. Unknown remains a data-level value
 * for defensive parsing, but is never a product section. */
export const browseableListingTypes = ["direct", "auction"] as const;

export type ListingType = (typeof listingTypes)[number];

export function listingTypeLabel(value: ListingType) {
  if (value === "auction") return "拍卖";
  if (value === "direct") return "直购";
  return "待识别";
}
