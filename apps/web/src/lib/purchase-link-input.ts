/**
 * Purchase-link textarea input: one URL per line, with an optional actual
 * paid amount after the URL on the same line, in the forms people paste
 * from an order page ("https://… 12800", "https://… ¥12,800",
 * "https://… 12800円"). Anything after the URL that is not exactly one
 * amount is ignored, so chat text around a link does not invent a price.
 */
export function parsePurchaseLinkInput(value: string) {
  const urls: string[] = [];
  const amountsByUrl: Record<string, number> = {};
  for (const line of value.split(/\r?\n/)) {
    const match = /https?:\/\/[^\s<>"'，。；;]+/i.exec(line);
    if (!match) continue;
    const candidate = match[0].replace(/[)\]}>、，。；;]+$/g, "");
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(parsed.protocol) || urls.includes(parsed.href))
      continue;
    urls.push(parsed.href);
    const rest = line.slice(match.index + match[0].length).trim();
    const amount = rest.match(/^[¥￥]?\s*([0-9][0-9,]*)\s*(?:円|yen|jpy)?$/i);
    if (!amount) continue;
    const amountYen = Number(amount[1].replace(/,/g, ""));
    if (
      Number.isInteger(amountYen) &&
      amountYen > 0 &&
      amountYen <= 100_000_000
    )
      amountsByUrl[parsed.href] = amountYen;
  }
  return { urls, amountsByUrl };
}

/**
 * Deduplicate jobs by url, keeping the first occurrence (convention: new -> old).
 */
export function dedupeJobsByUrl<T extends { url: string }>(
  jobs: readonly T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const job of jobs) {
    if (seen.has(job.url)) continue;
    seen.add(job.url);
    result.push(job);
  }
  return result;
}

/**
 * Return a compact human-friendly label for a URL on the purchase workspace:
 * - Mercari (/item/(m\d+)) -> `Mercari · m<id>`
 * - Yahoo Auctions (/auction/([a-z0-9]+)) -> `雅虎拍卖 · <id>`
 * - Other -> Hostname (e.g. `jp.mercari.com`)
 */
export function compactLinkLabel(url: string): string {
  const mercariMatch = url.match(/\/item\/(m\d+)/i);
  if (mercariMatch) {
    return `Mercari · ${mercariMatch[1]}`;
  }
  const yahooAuctionMatch = url.match(/\/auction\/([a-z0-9]+)/i);
  if (yahooAuctionMatch) {
    return `雅虎拍卖 · ${yahooAuctionMatch[1]}`;
  }
  try {
    const parsed = new URL(url);
    if (parsed.hostname) {
      return parsed.hostname;
    }
  } catch {
    // If not a parseable URL, fall through
  }
  return url;
}

