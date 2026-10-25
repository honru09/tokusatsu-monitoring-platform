import type { CheerioAPI } from "cheerio";
import type { ItemStatus } from "@tokusatsu/shared";

/** A terminal public listing notice, distinct from a parser/network failure. */
export class ListingUnavailableError extends Error {
  constructor(readonly status: "sold" | "ended") {
    super(`Public listing is ${status}`);
    this.name = "ListingUnavailableError";
  }
}

/**
 * The page loaded and parsed, but none of the known public price sources
 * is present (challenge/shell pages, and sold pages whose sold signal the
 * status detectors did not recognise). Distinct from a fetch failure:
 * retrying the same page cannot produce a price that is not on it, so the
 * refresh pipeline counts it as a failed check and moves on instead of
 * burning its retry budget.
 */
export class NoPublicPriceError extends Error {
  constructor(message = "Detail page did not contain a public price") {
    super(message);
    this.name = "NoPublicPriceError";
  }
}

function yenAmount(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
  const match = String(value ?? "")
    .replace(/,/g, "")
    .match(/(?:¥|￥|JPY)?\s*(\d{1,9})/i);
  return match ? Number(match[1]) : undefined;
}

/** The offers price from the same JSON-LD Product block the status comes from. */
export function schemaListingPrice(value: unknown): number | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const price = schemaListingPrice(entry);
      if (price != null) return price;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Record<string, unknown>;
  if (entry["@graph"]) return schemaListingPrice(entry["@graph"]);
  const types = Array.isArray(entry["@type"])
    ? entry["@type"]
    : [entry["@type"]];
  if (!types.includes("Product")) return undefined;
  const offers = Array.isArray(entry.offers) ? entry.offers : [entry.offers];
  for (const offer of offers) {
    if (!offer || typeof offer !== "object") continue;
    const price = yenAmount((offer as Record<string, unknown>).price);
    if (price != null) return price;
  }
  return undefined;
}

export function schemaListingStatus(value: unknown): ItemStatus | undefined {
  if (Array.isArray(value)) {
    const states = value.map(schemaListingStatus).filter(Boolean);
    return states.length === 1 ? states[0] : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Record<string, unknown>;
  if (entry["@graph"]) return schemaListingStatus(entry["@graph"]);
  const types = Array.isArray(entry["@type"])
    ? entry["@type"]
    : [entry["@type"]];
  if (!types.includes("Product")) return undefined;
  const offers = Array.isArray(entry.offers) ? entry.offers : [entry.offers];
  const states = offers
    .map((offer): ItemStatus | undefined => {
      if (!offer || typeof offer !== "object") return undefined;
      const availability = String(
        (offer as Record<string, unknown>).availability ?? "",
      )
        .split(/[\/#]/)
        .at(-1)
        ?.toLowerCase();
      if (availability === "soldout" || availability === "outofstock")
        return "sold";
      if (availability === "discontinued") return "ended";
      if (availability === "instock" || availability === "limitedavailability")
        return "active";
      return undefined;
    })
    .filter(Boolean);
  return states.length > 0 && states.every((state) => state === states[0])
    ? states[0]
    : undefined;
}

/** Only marketplace chrome counts as availability evidence, never seller prose. */
export function publicListingUiStatus($: CheerioAPI): ItemStatus | undefined {
  const body = $("body").clone();
  body
    .find(
      [
        "script",
        "style",
        "noscript",
        "template",
        "[hidden]",
        '[aria-hidden="true"]',
        '[style*="display:none"]',
        '[style*="display: none"]',
        '[data-testid*="description" i]',
        '[class*="description" i]',
        '[id*="description" i]',
        '[itemprop="description"]',
        '[data-testid*="recommend" i]',
        '[class*="recommend" i]',
        "nav",
        "footer",
      ].join(","),
    )
    .remove();
  const signals: string[] = [];
  body
    .find(
      [
        "h1",
        "h2",
        "button",
        '[role="alert"]',
        '[role="status"]',
        '[data-testid*="sold" i]',
        '[data-testid*="status" i]',
        '[class*="Sold"]',
        '[aria-label*="売り切れ"]',
        '[aria-label*="sold out" i]',
      ].join(","),
    )
    .each((_, element) => {
      const node = $(element);
      signals.push(node.text().replace(/\s+/g, " ").trim());
      const label = node.attr("aria-label");
      if (label) signals.push(label.trim());
    });
  if (
    signals.some((signal) =>
      /^(?:SOLD(?:\s*OUT)?|売り切れ(?:ました)?|売り切れです|取引完了|購入されました|落札されました)[。.!！]?$/i.test(
        signal,
      ),
    )
  )
    return "sold";
  if (
    signals.some((signal) =>
      /^(?:このオークションは終了(?:しました|しています)?|オークションは終了しました|終了しました|この商品は(?:削除されました|公開を停止しています|販売を終了しました)|商品が見つかりません|お探しの商品は(?:見つかりません|削除されました))[。.!！]?$/i.test(
        signal,
      ),
    )
  )
    return "ended";
  return undefined;
}
