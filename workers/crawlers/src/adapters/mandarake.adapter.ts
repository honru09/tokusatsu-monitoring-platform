import * as cheerio from "cheerio";
import { createRequire } from "node:module";
import { normalizeRawItem } from "@tokusatsu/shared";
import type {
  ItemStatus,
  ItemStatusUpdate,
  RawItemDetail,
  SearchQuery,
  SearchResult,
  SourceAdapter,
  StoredItem,
} from "@tokusatsu/shared";

const BASE_URL = "https://order.mandarake.co.jp";
type RobotPolicy = {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
};
const require = createRequire(import.meta.url);
const robotsParser = require("robots-parser") as (
  url: string,
  text: string,
) => RobotPolicy;

function yen(value: unknown): number | undefined {
  const match = String(value ?? "")
    .replace(/,/g, "")
    .match(/(?:¥|￥)?\s*(\d{2,9})/);
  return match ? Number(match[1]) : undefined;
}

function productJson(html: string): Record<string, unknown> | undefined {
  const $ = cheerio.load(html);
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed = JSON.parse($(element).text()) as
        | Record<string, unknown>
        | Record<string, unknown>[];
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      const product = candidates.find((entry) => entry["@type"] === "Product");
      if (product) return product;
    } catch {
      /* Malformed third-party JSON-LD is ignored. */
    }
  }
  return undefined;
}

export function parseMandarakeSearch(html: string, limit = 50): SearchResult[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  $('a[href*="/order/detailPage/item"], a[href*="detailPage/item"]').each(
    (_, element) => {
      if (results.length >= limit) return false;
      const href = $(element).attr("href");
      if (!href) return;
      const sourceUrl = new URL(href, BASE_URL).toString();
      const url = new URL(sourceUrl);
      const sourceItemId =
        url.searchParams.get("itemCode") ??
        url.pathname.split("/").filter(Boolean).at(-1);
      if (!sourceItemId || seen.has(sourceItemId)) return;
      seen.add(sourceItemId);
      results.push({
        sourceItemId,
        sourceUrl,
        titleHint:
          ($(element).attr("title") ?? $(element).text().trim()) || undefined,
      });
    },
  );
  return results;
}

export function validateMandarakeSearchResponse(
  html: string,
  finalUrl: string,
  limit = 50,
): SearchResult[] {
  const loadedUrl = new URL(finalUrl);
  if (
    loadedUrl.hostname !== "order.mandarake.co.jp" ||
    !loadedUrl.pathname.startsWith("/order/listPage/")
  ) {
    throw new Error(
      `Mandarake redirected outside the public order search (${loadedUrl.toString()})`,
    );
  }
  const results = parseMandarakeSearch(html, limit);
  if (
    results.length === 0 &&
    !/該当する商品|商品が見つかりません|no\s+(?:items|results)/i.test(html)
  ) {
    throw new Error(
      "Mandarake search returned no product links and no valid empty state",
    );
  }
  return results;
}

export function parseMandarakeDetailHtml(
  html: string,
  sourceUrl: string,
  sourceItemId: string,
): RawItemDetail {
  const $ = cheerio.load(html);
  const json = productJson(html);
  const offers = (json?.offers ?? {}) as Record<string, unknown>;
  const titleRaw = String(
    json?.name ??
      $("h1").first().text() ??
      $('meta[property="og:title"]').attr("content") ??
      "",
  ).trim();
  if (!titleRaw)
    throw new Error("Mandarake detail page did not contain a title");
  const descriptionRaw =
    String(
      json?.description ??
        $('meta[name="description"]').attr("content") ??
        $(".description, .item-description").first().text(),
    ).trim() || undefined;
  const priceCurrent = yen(
    offers.price ??
      $('[itemprop="price"]').attr("content") ??
      $(".price").first().text(),
  );
  if (priceCurrent == null)
    throw new Error("Mandarake detail page did not contain a price");
  const availability = String(offers.availability ?? "").toLowerCase();
  const status: ItemStatus =
    availability.includes("outofstock") ||
    /sold\s*out|売り切れ|品切れ/i.test(html)
      ? "sold"
      : "active";
  const imageSet = new Set<string>();
  const jsonImages = Array.isArray(json?.image) ? json?.image : [json?.image];
  for (const value of jsonImages)
    if (typeof value === "string")
      imageSet.add(new URL(value, BASE_URL).toString());
  $(
    'meta[property="og:image"], img[data-src], img[data-image-url], img[src], .item-image img',
  ).each((_, element) => {
    const value =
      $(element).attr("content") ??
      $(element).attr("data-src") ??
      $(element).attr("src");
    if (value) imageSet.add(new URL(value, BASE_URL).toString());
  });
  const conditionRaw =
    $('.condition, [class*="condition"]').first().text().trim() || undefined;
  return {
    sourcePlatform: "mandarake",
    sourceItemId,
    sourceUrl,
    titleRaw,
    descriptionRaw,
    sellerName: "Mandarake",
    sellerType: "store",
    priceCurrent,
    conditionRaw,
    imageUrls: [...imageSet],
    sourceData: {
      structuredData: json ?? undefined,
      conditionText: conditionRaw,
      descriptionText: descriptionRaw,
      bodyText: $("body").text().replace(/\s+/g, " ").trim().slice(0, 20_000),
    },
    status,
    channel: "online",
  };
}

export class MandarakeAdapter implements SourceAdapter {
  readonly key = "mandarake";
  readonly displayName = "Mandarake";
  private lastRequestAt = 0;
  private robots?: RobotPolicy;
  private readonly userAgent =
    process.env.CRAWLER_USER_AGENT ?? "TokusatsuMonitor/1.0";

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const url = new URL("/order/listPage/list", BASE_URL);
    url.searchParams.set("keyword", query.keyword);
    url.searchParams.set("lang", "ja");
    url.searchParams.set("soldOut", "1");
    const response = await this.fetchAllowedResponse(url.toString());
    return validateMandarakeSearchResponse(
      response.html,
      response.finalUrl,
      query.limit ?? 50,
    );
  }

  async fetchDetail(item: SearchResult): Promise<RawItemDetail> {
    return parseMandarakeDetailHtml(
      await this.fetchAllowed(item.sourceUrl),
      item.sourceUrl,
      item.sourceItemId,
    );
  }

  async refreshStatus(item: StoredItem): Promise<ItemStatusUpdate> {
    const detail = await this.fetchDetail({
      sourceItemId: item.sourceItemId,
      sourceUrl: item.sourceUrl,
    });
    return {
      status: detail.status,
      priceCurrent: detail.priceCurrent,
      shippingFee: detail.shippingFee,
    };
  }

  async normalize(raw: RawItemDetail) {
    return normalizeRawItem(raw);
  }

  private async fetchAllowed(url: string): Promise<string> {
    return (await this.fetchAllowedResponse(url)).html;
  }

  private async fetchAllowedResponse(
    url: string,
  ): Promise<{ html: string; finalUrl: string }> {
    const robots = await this.getRobots();
    if (!robots.isAllowed(url, this.userAgent))
      throw new Error(`robots.txt disallows ${url}`);
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < 2500)
      await new Promise((resolve) => setTimeout(resolve, 2500 - elapsed));
    const response = await fetch(url, {
      headers: {
        "user-agent": this.userAgent,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ja,en;q=0.8",
      },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
    this.lastRequestAt = Date.now();
    if (!response.ok) throw new Error(`Mandarake returned ${response.status}`);
    return { html: await response.text(), finalUrl: response.url };
  }

  private async getRobots() {
    if (this.robots) return this.robots;
    const url = `${BASE_URL}/robots.txt`;
    const response = await fetch(url, {
      headers: { "user-agent": this.userAgent },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(
        `Cannot verify robots.txt (${response.status}); refusing crawl`,
      );
    this.robots = robotsParser(url, await response.text());
    return this.robots;
  }
}
