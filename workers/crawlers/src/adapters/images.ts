const REJECTED_HOSTS = new Set(["s.yimg.jp", "displayname-pctr.c.yimg.jp"]);

const NON_PRODUCT_PATH =
  /(?:^|[\/_\-.])(?:avatar|banner|common|favicon|header|footer|icon|logo|no[-_]?image|placeholder|profile|sprite|tracking|pixel)(?:[\/_\-.]|$)/i;

function canonicalImageUrl(raw: string): string | undefined {
  try {
    let parsed = new URL(raw);
    if (!/^https?:$/.test(parsed.protocol)) return undefined;
    const hostname = parsed.hostname.toLowerCase();
    if (REJECTED_HOSTS.has(hostname)) return undefined;
    if (
      ["auctions.yahoo.co.jp", "page.auctions.yahoo.co.jp"].includes(
        hostname,
      ) &&
      parsed.pathname.startsWith("/jp/auction/")
    ) {
      return undefined;
    }
    if (
      hostname === "auc-pctr.c.yimg.jp" &&
      parsed.pathname.startsWith("/i/")
    ) {
      const embedded = parsed.pathname.slice(3);
      if (/^[a-z0-9.-]+\//i.test(embedded)) {
        parsed = new URL(`https://${embedded}`);
      }
    }
    const decodedPath = decodeURIComponent(parsed.pathname).toLowerCase();
    if (NON_PRODUCT_PATH.test(decodedPath)) return undefined;
    if (/\.svg$/i.test(decodedPath)) return undefined;
    if (
      (parsed.searchParams.get("w") === "1" ||
        parsed.searchParams.get("width") === "1") &&
      (parsed.searchParams.get("h") === "1" ||
        parsed.searchParams.get("height") === "1")
    ) {
      return undefined;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

type ImageCandidate = {
  identity: string;
  quality: number;
  url: string;
};

/**
 * Mercari publishes one gallery photo through several rendition paths (thumb,
 * webp and orig).  Their paths differ, but the product photo identifier after
 * `/photos/` does not.  Use that stable identifier only for Mercari hosts so
 * unrelated marketplace images with similar filenames remain independent.
 */
function mercariPhotoIdentity(parsed: URL): string | undefined {
  if (!/(?:^|\.)mercdn\.net$/i.test(parsed.hostname)) return undefined;

  const path = decodeURIComponent(parsed.pathname);
  const photosIndex = path.toLowerCase().lastIndexOf("/photos/");
  if (photosIndex === -1) return undefined;

  const photoPath = path.slice(photosIndex + "/photos/".length);
  if (!photoPath || photoPath.includes("/")) return undefined;
  const photoId = photoPath.replace(/\.(?:avif|jpe?g|png|webp)$/i, "");
  if (!photoId) return undefined;

  return `mercari:${parsed.hostname.toLowerCase()}:${photoId.toLowerCase()}`;
}

function mercariImageQuality(parsed: URL): number {
  const path = decodeURIComponent(parsed.pathname).toLowerCase();
  if (/(?:^|\/)(?:orig|original)(?:\/|$)/.test(path)) return 400;
  if (/(?:^|\/)(?:large|highres|high-res)(?:\/|$)/.test(path)) return 300;
  if (/(?:^|\/)(?:medium|detail)(?:\/|$)/.test(path)) return 200;
  if (/(?:^|\/)(?:thumb|thumbnail|small)(?:\/|$)/.test(path)) return 100;
  return 150;
}

function imageCandidate(url: string): ImageCandidate {
  const parsed = new URL(url);
  return {
    identity: mercariPhotoIdentity(parsed) ?? url,
    quality: mercariImageQuality(parsed),
    url,
  };
}

/** Keep public product-gallery images, preserving first-seen order. */
export function sanitizeProductImageUrls(values: Iterable<string>): string[] {
  const result: ImageCandidate[] = [];
  const indexByIdentity = new Map<string, number>();
  for (const value of values) {
    const normalized = canonicalImageUrl(value);
    if (!normalized) continue;

    const candidate = imageCandidate(normalized);
    const existingIndex = indexByIdentity.get(candidate.identity);
    if (existingIndex === undefined) {
      indexByIdentity.set(candidate.identity, result.length);
      result.push(candidate);
    } else if (candidate.quality > result[existingIndex].quality) {
      // Preserve the source-gallery position while upgrading to the best
      // available rendition of that same photo.
      result[existingIndex] = candidate;
    }
  }
  return result.map((candidate) => candidate.url);
}

/**
 * Recover product-gallery URLs from a persisted marketplace payload.
 * Adapters intentionally keep the source payload shape, so historical rows
 * can contain `image`, `images`, `photos`, `thumbnails`, or nested URL fields.
 * Only values below an image-like key are considered; seller/profile/source
 * URLs are never promoted to product images.
 */
export function extractProductImageUrls(value: unknown): string[] {
  const values: string[] = [];
  const imageKey =
    /^(?:image|images|imageUrls|photos?|thumbnails?|gallery|media)$/i;
  const urlKey =
    /^(?:url|uri|src|href|original|large|medium|highRes|imageUrl)$/i;
  const visit = (node: unknown, imageContext = false, depth = 0) => {
    if (depth > 10 || node == null) return;
    if (typeof node === "string") {
      if (imageContext && /^https?:\/\//i.test(node)) values.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry, imageContext, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    for (const [key, child] of Object.entries(
      node as Record<string, unknown>,
    )) {
      const childImageContext = imageContext || imageKey.test(key);
      if (childImageContext && typeof child === "string" && urlKey.test(key)) {
        visit(child, true, depth + 1);
      } else {
        visit(child, childImageContext, depth + 1);
      }
    }
  };
  visit(value);
  return sanitizeProductImageUrls(values);
}
