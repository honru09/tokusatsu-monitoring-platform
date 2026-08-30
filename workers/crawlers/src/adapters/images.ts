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

/** Keep public product-gallery images, preserving first-seen order. */
export function sanitizeProductImageUrls(values: Iterable<string>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = canonicalImageUrl(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
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
