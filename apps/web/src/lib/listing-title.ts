/** Shared listing-title cleanup for discovery, favorites, detail, and related workspaces. */

export type ListingTitleSource = {
  titleRaw: string;
  titleZh?: string | null;
  product?: {
    canonicalName?: string | null;
    titleZh?: string | null;
  } | null;
};

const TITLE_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

/** Marketplace payloads sometimes persist HTML entities as literal title text. */
function decodeTitleEntities(value: string) {
  return value.replace(
    /&(?:#(\d{1,7})|#x([\da-f]{1,6})|(amp|apos|gt|lt|nbsp|quot));/giu,
    (
      match,
      decimal: string | undefined,
      hexadecimal: string | undefined,
      named: string | undefined,
    ) => {
      if (named) return TITLE_HTML_ENTITIES[named.toLowerCase()] ?? match;
      const codePoint = Number.parseInt(
        decimal ?? hexadecimal ?? "",
        decimal ? 10 : 16,
      );
      if (
        !Number.isFinite(codePoint) ||
        codePoint <= 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      )
        return match;
      return String.fromCodePoint(codePoint);
    },
  );
}

/** Strip seller attribution / accessory-only noise from marketplace listing titles. */
export function normalizeDiscoveryTitle(value: string) {
  let next = decodeTitleEntities(value).normalize("NFKC").trim();
  if (!next) return "";
  // "附赠品 by Seller" / "… by：店名" — English/machine-translation leftovers.
  next = next.replace(/\s+by\s*[:：]?\s*.+$/iu, "").trim();
  // JP/CN seller suffixes hanging off the title (with optional separators).
  next = next.replace(
    /\s*[|/｜·•]?\s*(?:出品者|出品|販売者|卖家)\s*[:：].+$/u,
    "",
  );
  if (/^["'「『【［\[]/u.test(next) && /["'」』】］\]]$/u.test(next)) {
    next = next.replace(/^["'「『【［\[]+|["'」』】］\]]+$/gu, "").trim();
  }
  next = next.replace(/[\s\u3000]+/g, " ").trim();
  next = next.replace(/[\s|/｜·•]+$/u, "").trim();
  return next;
}

export function isAccessoryOnlyTitle(value: string) {
  const compact = value.replace(/[\[\]【】()（）\s\-_/|｜·•]/gu, "");
  return /^(附赠品|附属品|付属品|おまけ|特典|赠品|配件)$/u.test(compact);
}

/**
 * Resolve a display title for a marketplace listing, normalizing seller noise
 * and falling back from an explicitly translated accessory-only title to product
 * identity when available. A local word-replacement function is deliberately not
 * accepted here: without a persisted/full AI result, the complete source title is
 * safer than a partly translated hybrid.
 */
export function displayListingTitle(
  item: ListingTitleSource,
  language: "zh" | "original",
  translatedTitle?: string,
) {
  const listingTranslation = translatedTitle?.trim() || item.titleZh?.trim();
  const raw =
    language === "original"
      ? item.titleRaw
      : (listingTranslation ?? item.titleRaw);
  const normalized = normalizeDiscoveryTitle(raw);
  if (listingTranslation && (!normalized || isAccessoryOnlyTitle(normalized))) {
    const fallback = normalizeDiscoveryTitle(
      item.product?.canonicalName ?? item.product?.titleZh ?? "",
    );
    if (fallback && fallback !== normalized) return fallback;
  }
  return normalized || item.titleRaw;
}
