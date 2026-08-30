import * as cheerio from "cheerio";
import { createRequire } from "node:module";
import { isExcludedCollectibleText, normalizeRawItem } from "@tokusatsu/shared";
import type {
  ItemStatus,
  ItemStatusUpdate,
  RawItemDetail,
  SearchQuery,
  SearchResult,
  SourceAdapter,
  StoredItem,
} from "@tokusatsu/shared";
import { sanitizeProductImageUrls } from "./images.js";
import { shippingEvidence } from "./shipping.js";

const SEARCH_ORIGIN = "https://fril.jp";
const DETAIL_ORIGIN = "https://item.fril.jp";

type RobotPolicy = {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
};
const require = createRequire(import.meta.url);
const robotsParser = require("robots-parser") as (
  url: string,
  text: string,
) => RobotPolicy;

function compact(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function yen(value: unknown): number | undefined {
  const match = compact(value)
    .replace(/,/g, "")
    .match(/(?:¥|￥|JPY)?\s*(\d{1,9})/i);
  return match ? Number(match[1]) : undefined;
}

function objects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(objects);
  return value && typeof value === "object"
    ? [value as Record<string, unknown>]
    : [];
}

function productJson(html: string) {
  const $ = cheerio.load(html);
  for (const node of $('script[type="application/ld+json"]').toArray()) {
    try {
      const entries = objects(JSON.parse($(node).text()));
      const product = entries.find((entry) => entry["@type"] === "Product");
      if (product) return product;
    } catch {
      // A malformed third-party structured-data block does not invalidate the page.
    }
  }
  return undefined;
}

function tableDetails($: cheerio.CheerioAPI) {
  const details: Record<string, string> = {};
  $("tr").each((_, row) => {
    const key = compact($(row).find("th").first().text());
    const value = compact($(row).find("td").first().text());
    if (key && value && !(key in details)) details[key] = value;
  });
  return details;
}

export function parseRakumaSearchHtml(
  html: string,
  limit = 40,
): SearchResult[] {
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  $(".item").each((_, element) => {
    if (results.length >= limit) return false;
    const card = $(element);
    const anchor = card.find('a[href*="item.fril.jp/"]').first();
    const href = anchor.attr("href");
    if (!href) return;
    let parsed: URL;
    try {
      parsed = new URL(href, DETAIL_ORIGIN);
    } catch {
      return;
    }
    if (parsed.hostname !== "item.fril.jp") return;
    const sourceItemId = parsed.pathname.split("/").filter(Boolean).at(-1);
    if (!sourceItemId || !/^[a-f0-9]{20,64}$/i.test(sourceItemId)) return;
    if (seen.has(sourceItemId)) return;
    const titleRaw =
      compact(card.find(".link_search_title").first().text()) ||
      compact(anchor.attr("data-rat-item_name")) ||
      compact(anchor.attr("title")).replace(
        /の商品詳細ページへのリンク.*$/i,
        "",
      );
    if (!titleRaw || isExcludedCollectibleText(titleRaw)) return;
    const categoryText = compact(anchor.find("img").attr("alt"));
    if (isExcludedCollectibleText(categoryText)) return;
    const priceCurrent =
      yen(anchor.attr("data-rat-price")) ??
      yen(card.find(".item-box__item-price").first().text());
    if (priceCurrent == null) return;
    const dataItemId = compact(anchor.attr("data-rat-itemid"));
    const sellerId = dataItemId.split("/")[0] || undefined;
    const sellerTypeText = compact(anchor.attr("data-rat-sgenre"));
    const imageUrl =
      card.find("img[data-original]").first().attr("data-original") ??
      card.find("img[src]").first().attr("src");
    const detailHint: RawItemDetail = {
      sourcePlatform: "rakuma",
      sourceItemId,
      sourceUrl: parsed.toString(),
      titleRaw,
      sellerName: sellerId ? `ラクマ出品者 ${sellerId}` : "ラクマ出品者",
      sellerType: /公式|ショップ|法人/.test(sellerTypeText)
        ? "store"
        : "individual",
      sellerData: { sellerId, sellerTypeText },
      priceCurrent,
      conditionRaw: undefined,
      imageUrls: sanitizeProductImageUrls(imageUrl ? [imageUrl] : []),
      sourceData: {
        searchCard: {
          brand: compact(card.find(".brand-name").first().text()) || undefined,
          categoryText,
          sellerId,
          sellerTypeText,
        },
      },
      status: "active",
      channel: "online",
    };
    seen.add(sourceItemId);
    results.push({
      sourceItemId,
      sourceUrl: parsed.toString(),
      titleHint: titleRaw,
      detailHint,
    });
  });
  return results;
}

export function parseRakumaDetailHtml(
  html: string,
  sourceUrl: string,
  sourceItemId: string,
): RawItemDetail {
  const $ = cheerio.load(html);
  const json = productJson(html);
  const offers = objects(json?.offers)[0] ?? {};
  const titleRaw = compact(
    json?.name ??
      $('meta[property="og:title"]').attr("content") ??
      $("h1").first().text(),
  ).replace(/\s*[|｜]\s*フリマアプリ\s*ラクマ.*$/i, "");
  const priceCurrent = yen(
    offers.price ?? $('meta[property="product:price:amount"]').attr("content"),
  );
  if (!titleRaw || priceCurrent == null)
    throw new Error("Rakuma detail did not contain title and price");
  const descriptionRaw = compact(
    json?.description ?? $('meta[property="og:description"]').attr("content"),
  );
  const details = tableDetails($);
  const body = $("body").clone();
  body.find("script, style, noscript, template").remove();
  const bodyText = compact(body.text());
  const shippingText =
    details["配送料の負担"] ??
    compact($(".item__postage, .postage-included").first().text());
  const shipping = shippingEvidence(offers, shippingText || bodyText);
  const conditionRaw =
    details["商品の状態"] ?? (compact(offers.itemCondition) || undefined);
  const availability = compact(offers.availability).toLowerCase();
  const status: ItemStatus =
    availability.includes("instock") &&
    !/売り切れ|sold\s*out|購入申請できません/i.test(bodyText)
      ? "active"
      : "sold";
  const sellerStructured = objects(offers.seller)[0] ?? {};
  const sellerAnchor = $('a[href*="/shop/"]')
    .filter((_, anchor) => !/review/.test($(anchor).attr("href") ?? ""))
    .first();
  const sellerHref = sellerAnchor.attr("href");
  const sellerProfileUrl = sellerHref
    ? new URL(sellerHref, SEARCH_ORIGIN).toString()
    : undefined;
  const sellerName =
    compact(sellerStructured.name) ||
    compact(sellerAnchor.text()) ||
    "ラクマ出品者";
  const reviewText = compact($('a[href*="/review"]').first().text());
  const galleryImages = $(".sp-slides .sp-slide img[src]")
    .map((_, image) => $(image).attr("src") ?? "")
    .get();
  // JSON-LD often repeats the first gallery image at a different thumbnail
  // size. Prefer the complete visible gallery and use JSON-LD only as a
  // fallback so one product photo does not appear twice in our carousel.
  const imageUrls = sanitizeProductImageUrls(
    galleryImages.length
      ? galleryImages
      : [
          ...objects(json?.image).flatMap((value) =>
            typeof value === "string" ? [value] : [],
          ),
          ...(typeof json?.image === "string" ? [json.image] : []),
        ],
  );
  const sellerTypeText =
    compact(
      $("[data-rat-cp-seller_user_type], [data-rat-sgenre]")
        .first()
        .attr("data-rat-cp-seller_user_type") ??
        $("[data-rat-sgenre]").first().attr("data-rat-sgenre"),
    ) || "一般";
  return {
    sourcePlatform: "rakuma",
    sourceItemId,
    sourceUrl,
    titleRaw,
    descriptionRaw: descriptionRaw || undefined,
    sellerName,
    sellerType: /公式|ショップ|法人/.test(sellerTypeText)
      ? "store"
      : "individual",
    sellerProfileUrl,
    sellerData: {
      sellerProfileUrl,
      sellerTypeText,
      reviewText,
      structuredSeller: sellerStructured,
    },
    locationText: details["発送元の地域"],
    priceCurrent,
    shippingFee: shipping.fee,
    conditionRaw,
    imageUrls,
    sourceData: {
      structuredData: json,
      details,
      shippingText,
      shippingStatus: shipping.status,
      shippingEvidence: shipping.evidence,
      sellerProfileUrl,
      sellerTypeText,
      reviewText,
      bodyText: bodyText.slice(0, 20_000),
    },
    status,
    channel: "online",
  };
}

export class RakumaAdapter implements SourceAdapter {
  readonly key = "rakuma";
  readonly displayName = "ラクマ";
  private lastRequestAt = new Map<string, number>();
  private robots = new Map<string, RobotPolicy>();
  private readonly userAgent =
    process.env.CRAWLER_USER_AGENT ?? "TokusatsuMonitor/1.0";

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const pages = Math.max(1, Math.min(query.pages ?? 1, 4));
    const pageStart = Math.max(0, query.pageStart ?? 0);
    const limit = Math.max(1, Math.min(query.limit ?? 40, pages * 40));
    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < pages && results.length < limit; index += 1) {
      const url = new URL("/s", SEARCH_ORIGIN);
      url.searchParams.set("query", query.keyword);
      const page = pageStart + index + 1;
      if (page > 1) url.searchParams.set("page", String(page));
      const html = await this.fetchAllowed(url.toString());
      for (const result of parseRakumaSearchHtml(html, limit)) {
        if (seen.has(result.sourceItemId) || results.length >= limit) continue;
        seen.add(result.sourceItemId);
        results.push(result);
      }
    }
    return results;
  }

  async fetchDetail(item: SearchResult): Promise<RawItemDetail> {
    return parseRakumaDetailHtml(
      await this.fetchAllowed(item.sourceUrl),
      item.sourceUrl,
      item.sourceItemId,
    );
  }

  async refreshStatus(item: StoredItem): Promise<ItemStatusUpdate> {
    try {
      const detail = await this.fetchDetail({
        sourceItemId: item.sourceItemId,
        sourceUrl: item.sourceUrl,
      });
      return {
        status: detail.status,
        priceCurrent: detail.priceCurrent,
        shippingFee: detail.shippingFee,
      };
    } catch (error) {
      if (/Rakuma returned (?:404|410)/i.test(String(error)))
        return { status: "sold" };
      throw error;
    }
  }

  async normalize(raw: RawItemDetail) {
    return normalizeRawItem(raw);
  }

  private async fetchAllowed(url: string) {
    const parsed = new URL(url);
    if (!["fril.jp", "item.fril.jp"].includes(parsed.hostname))
      throw new Error(`Unsupported Rakuma URL (${url})`);
    const robots = await this.getRobots(parsed.origin);
    if (!robots.isAllowed(url, this.userAgent))
      throw new Error(`robots.txt disallows ${url}`);
    const delay = Math.max(
      3_000,
      Number(process.env.RAKUMA_CRAWL_DELAY_MS ?? 3_000),
    );
    const previous = this.lastRequestAt.get(parsed.origin) ?? 0;
    const elapsed = Date.now() - previous;
    if (elapsed < delay)
      await new Promise((resolve) => setTimeout(resolve, delay - elapsed));
    const response = await fetch(url, {
      headers: {
        "user-agent": this.userAgent,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ja,en;q=0.8",
      },
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
    });
    this.lastRequestAt.set(parsed.origin, Date.now());
    if (!response.ok) throw new Error(`Rakuma returned ${response.status}`);
    if (!["fril.jp", "item.fril.jp"].includes(new URL(response.url).hostname))
      throw new Error(`Rakuma redirected unexpectedly (${response.url})`);
    return response.text();
  }

  private async getRobots(origin: string) {
    const cached = this.robots.get(origin);
    if (cached) return cached;
    const url = `${origin}/robots.txt`;
    const response = await fetch(url, {
      headers: { "user-agent": this.userAgent },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(
        `Cannot verify Rakuma robots.txt (${response.status}); refusing crawl`,
      );
    const policy = robotsParser(url, await response.text());
    this.robots.set(origin, policy);
    return policy;
  }
}
