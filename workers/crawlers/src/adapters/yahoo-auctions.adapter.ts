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
import { CheerioCrawler } from "@crawlee/cheerio";
import { Configuration } from "@crawlee/core";
import * as cheerio from "cheerio";
import { createRequire } from "node:module";

const SEARCH_ORIGIN = "https://auctions.yahoo.co.jp";
const DETAIL_ORIGIN = SEARCH_ORIGIN;
const DEFAULT_PAGE_SIZE = 50;

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
    .match(/(?:¥|￥|JPY)?\s*(\d{1,10})/i);
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
      // Third-party JSON-LD can be malformed without invalidating the page.
    }
  }
  return undefined;
}

export function parseYahooAuctionSearch(
  html: string,
  limit = DEFAULT_PAGE_SIZE,
): SearchResult[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  $('a[href*="/jp/auction/"]').each((_, element) => {
    if (results.length >= limit) return false;
    const href = $(element).attr("href");
    if (!href) return;
    const sourceUrl = new URL(href, DETAIL_ORIGIN).toString();
    const parsed = new URL(sourceUrl);
    if (
      parsed.hostname !== "page.auctions.yahoo.co.jp" &&
      parsed.hostname !== "auctions.yahoo.co.jp"
    )
      return;
    const sourceItemId = parsed.pathname.split("/").filter(Boolean).at(-1);
    if (!sourceItemId || seen.has(sourceItemId)) return;
    seen.add(sourceItemId);
    results.push({
      sourceItemId,
      sourceUrl: `${DETAIL_ORIGIN}/jp/auction/${sourceItemId}`,
      titleHint:
        (
          $(element).attr("aria-label") ??
          $(element).attr("title") ??
          $(element).text()
        )
          .replace(/\s+/g, " ")
          .trim() || undefined,
    });
  });
  return results;
}

export function parseYahooAuctionDetailHtml(
  html: string,
  sourceUrl: string,
  sourceItemId: string,
): RawItemDetail {
  const $ = cheerio.load(html);
  const json = productJson(html);
  const offers = (json?.offers ?? {}) as Record<string, unknown>;
  const titleRaw = String(
    json?.name ??
      $('meta[property="og:title"]').attr("content") ??
      $("h1").first().text() ??
      "",
  ).trim();
  if (!titleRaw)
    throw new Error("Yahoo Auctions detail page did not contain a title");
  const descriptionRaw =
    String(
      json?.description ??
        $('meta[property="og:description"]').attr("content") ??
        $('meta[name="description"]').attr("content") ??
        "",
    ).trim() || undefined;
  const priceCurrent = yen(
    offers.price ??
      $('[itemprop="price"]').attr("content") ??
      $('[class*="Price"]').first().text(),
  );
  if (priceCurrent == null)
    throw new Error(
      "Yahoo Auctions detail page did not contain a public price",
    );
  const availability = String(offers.availability ?? "").toLowerCase();
  const status: ItemStatus =
    availability.includes("outofstock") ||
    /このオークションは終了|落札されました|終了しました/i.test($("body").text())
      ? "ended"
      : "active";
  const imageSet = new Set<string>();
  const jsonImages = Array.isArray(json?.image) ? json.image : [json?.image];
  for (const image of jsonImages) {
    if (typeof image === "string")
      imageSet.add(new URL(image, sourceUrl).toString());
  }
  const ogImage = $('meta[property="og:image"]').attr("content");
  if (ogImage) imageSet.add(new URL(ogImage, sourceUrl).toString());
  const auctionEndAt = offers.priceValidUntil
    ? new Date(String(offers.priceValidUntil))
    : undefined;
  const safeAuctionEndAt =
    auctionEndAt && !Number.isNaN(auctionEndAt.getTime())
      ? auctionEndAt
      : undefined;
  const conditionRaw = String(offers.itemCondition ?? "").includes(
    "UsedCondition",
  )
    ? "中古"
    : undefined;
  return {
    sourcePlatform: "yahoo_auctions",
    sourceItemId,
    sourceUrl,
    titleRaw,
    descriptionRaw,
    sellerName: "Yahoo!オークション出品者",
    sellerType: "unknown",
    priceCurrent,
    auctionEndAt: safeAuctionEndAt,
    conditionRaw,
    imageUrls: [...imageSet].slice(0, 30),
    status,
    channel: "online",
  };
}

export class YahooAuctionsAdapter implements SourceAdapter {
  readonly key = "yahoo_auctions";
  readonly displayName = "日本拍卖市场";
  private lastRequestAt = 0;
  private readonly userAgent =
    process.env.CRAWLER_USER_AGENT ?? "TokusatsuMonitor/1.0";
  private robots?: RobotPolicy;

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const pages = Math.max(1, Math.min(query.pages ?? 1, 8));
    const pageStart = Math.max(0, query.pageStart ?? 0);
    const limit = Math.max(1, Math.min(query.limit ?? 50, pages * 50));
    const requests = Array.from({ length: pages }, (_, index) => {
      const url = new URL("/search/search", SEARCH_ORIGIN);
      url.searchParams.set("p", query.keyword);
      const offset = (pageStart + index) * DEFAULT_PAGE_SIZE + 1;
      if (offset > 1) url.searchParams.set("b", String(offset));
      return {
        url: url.toString(),
        headers: {
          "user-agent": this.userAgent,
          "accept-language": "ja,en;q=0.8",
        },
      };
    });
    const results: SearchResult[] = [];
    const seen = new Set<string>();
    const crawler = new CheerioCrawler(
      {
        minConcurrency: 1,
        maxConcurrency: 1,
        maxRequestsPerCrawl: pages,
        maxRequestRetries: 2,
        navigationTimeoutSecs: 25,
        requestHandlerTimeoutSecs: 35,
        sameDomainDelaySecs: 3,
        retryOnBlocked: false,
        respectRobotsTxtFile: { userAgent: this.userAgent },
        async requestHandler({ request, $ }) {
          const finalUrl = new URL(request.loadedUrl ?? request.url);
          if (finalUrl.hostname !== "auctions.yahoo.co.jp") {
            throw new Error(
              `Yahoo Auctions search redirected outside its public search (${finalUrl.toString()})`,
            );
          }
          const pageResults = parseYahooAuctionSearch($.html(), limit);
          for (const result of pageResults) {
            if (seen.has(result.sourceItemId) || results.length >= limit)
              continue;
            seen.add(result.sourceItemId);
            results.push(result);
          }
        },
      },
      new Configuration({ persistStorage: false }),
    );
    await crawler.run(requests);
    return results;
  }

  async fetchDetail(item: SearchResult): Promise<RawItemDetail> {
    return parseYahooAuctionDetailHtml(
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
      auctionEndAt: detail.auctionEndAt,
      bidCount: detail.bidCount,
    };
  }

  async normalize(raw: RawItemDetail) {
    return normalizeRawItem(raw);
  }

  private async fetchAllowed(url: string): Promise<string> {
    const requestedUrl = new URL(url);
    if (
      requestedUrl.hostname !== "auctions.yahoo.co.jp" &&
      requestedUrl.hostname !== "page.auctions.yahoo.co.jp"
    )
      throw new Error(`Unsupported Yahoo Auctions detail URL (${url})`);
    const canonicalUrl = new URL(
      `${requestedUrl.pathname}${requestedUrl.search}`,
      DETAIL_ORIGIN,
    ).toString();
    const robots = await this.getRobots();
    if (!robots.isAllowed(canonicalUrl, this.userAgent))
      throw new Error(`robots.txt disallows ${canonicalUrl}`);
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < 3000)
      await new Promise((resolve) => setTimeout(resolve, 3000 - elapsed));
    const response = await fetch(canonicalUrl, {
      headers: {
        "user-agent": this.userAgent,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ja,en;q=0.8",
      },
      signal: AbortSignal.timeout(25_000),
      redirect: "follow",
    });
    this.lastRequestAt = Date.now();
    if (!response.ok)
      throw new Error(`Yahoo Auctions returned ${response.status}`);
    if (new URL(response.url).hostname !== "auctions.yahoo.co.jp")
      throw new Error(
        `Yahoo Auctions detail redirected unexpectedly (${response.url})`,
      );
    return response.text();
  }

  private async getRobots() {
    if (this.robots) return this.robots;
    const url = `${DETAIL_ORIGIN}/robots.txt`;
    const response = await fetch(url, {
      headers: { "user-agent": this.userAgent },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(
        `Cannot verify Yahoo Auctions robots.txt (${response.status}); refusing crawl`,
      );
    this.robots = robotsParser(url, await response.text());
    return this.robots;
  }
}
