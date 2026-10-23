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
import { sanitizeProductImageUrls } from "./images.js";
import { shippingEvidence } from "./shipping.js";
import {
  ListingUnavailableError,
  publicListingUiStatus,
  schemaListingStatus,
} from "./public-listing-status.js";

const SEARCH_ORIGIN = "https://auctions.yahoo.co.jp";
const DETAIL_ORIGIN = SEARCH_ORIGIN;
const DEFAULT_PAGE_SIZE = 50;
const MINIMUM_REQUEST_SPACING_MS = 1_000;
const MINIMUM_TRANSIENT_COOLDOWN_MS = 60_000;
const MAXIMUM_TRANSIENT_COOLDOWN_MS = 6 * 60 * 60_000;

type YahooAuctionsRequestGateOptions = {
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
};

/** A process-wide, atomic lane for every Yahoo Auctions detail request. */
export class YahooAuctionsRequestGate {
  private tail: Promise<void> = Promise.resolve();
  private nextAllowedAt = 0;
  private readonly now: () => number;
  private readonly wait: (milliseconds: number) => Promise<void>;

  constructor(options: YahooAuctionsRequestGateOptions = {}) {
    this.now = options.now ?? Date.now;
    this.wait =
      options.wait ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  run<T>(minimumDelayMs: number, operation: () => Promise<T>): Promise<T> {
    const boundedDelay = Number.isFinite(minimumDelayMs)
      ? Math.max(0, Math.floor(minimumDelayMs))
      : 0;
    const execute = async () => {
      const waitMs = Math.max(0, this.nextAllowedAt - this.now());
      if (waitMs > 0) await this.wait(waitMs);
      this.nextAllowedAt = Math.max(
        this.nextAllowedAt,
        this.now() + boundedDelay,
      );
      return operation();
    };
    const pending = this.tail.then(execute, execute);
    this.tail = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  defer(milliseconds: number) {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
    this.nextAllowedAt = Math.max(
      this.nextAllowedAt,
      this.now() + Math.floor(milliseconds),
    );
  }
}

export function yahooAuctionsRetryAfterMs(
  value: string | null,
  attempt: number,
  now = Date.now(),
) {
  const normalizedAttempt = Number.isFinite(attempt)
    ? Math.max(0, Math.min(Math.floor(attempt), 5))
    : 0;
  const fallback = MINIMUM_TRANSIENT_COOLDOWN_MS * 2 ** normalizedAttempt;
  const trimmed = value?.trim();
  let requested: number | undefined;
  if (trimmed && /^\d+(?:\.\d+)?$/.test(trimmed)) {
    requested = Number(trimmed) * 1_000;
  } else if (trimmed) {
    const retryAt = Date.parse(trimmed);
    if (Number.isFinite(retryAt)) requested = retryAt - now;
  }
  const cooldown = Number.isFinite(requested) ? requested! : fallback;
  return Math.max(
    MINIMUM_TRANSIENT_COOLDOWN_MS,
    Math.min(Math.ceil(cooldown), MAXIMUM_TRANSIENT_COOLDOWN_MS),
  );
}

const sharedYahooAuctionsRequestGate = new YahooAuctionsRequestGate();

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

function publicYahooSeller(html: string) {
  const $ = cheerio.load(html);
  const raw = $("#__NEXT_DATA__").text();
  if (!raw) return undefined;
  try {
    const root = JSON.parse(raw) as unknown;
    const visit = (
      value: unknown,
      depth = 0,
    ): Record<string, unknown> | undefined => {
      if (!value || typeof value !== "object" || depth > 12) return undefined;
      if (!Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        if (
          typeof record.displayName === "string" &&
          (typeof record.aucUserId === "string" ||
            typeof record.listUrl === "string")
        )
          return record;
        for (const child of Object.values(record)) {
          const found = visit(child, depth + 1);
          if (found) return found;
        }
      } else {
        for (const child of value) {
          const found = visit(child, depth + 1);
          if (found) return found;
        }
      }
      return undefined;
    };
    const seller = visit(root);
    if (!seller) return undefined;
    const location =
      seller.location && typeof seller.location === "object"
        ? (seller.location as Record<string, unknown>)
        : undefined;
    return {
      displayName: seller.displayName,
      aucUserId: seller.aucUserId,
      profileUrl: seller.listUrl,
      isStore: seller.isStore === true,
      isBestStore: seller.isBestStore === true,
      isExcellentSeller: seller.isExcellentSeller === true,
      isIdentityVerified: seller.isEkycVerified === true,
      sellerMessage: seller.sellerMessage,
      rating: seller.rating,
      sellerPerformance: seller.sellerPerformance,
      location: location
        ? {
            prefecture: location.prefecture,
            prefectureCode: location.prefCode,
          }
        : undefined,
    };
  } catch {
    return undefined;
  }
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
  const observedStatus = publicListingUiStatus($) ?? schemaListingStatus(json);
  const status: ItemStatus =
    observedStatus === "sold" || observedStatus === "ended"
      ? "ended"
      : (observedStatus ?? "unknown");
  const offers = (json?.offers ?? {}) as Record<string, unknown>;
  const titleRaw = String(
    json?.name ??
      $('meta[property="og:title"]').attr("content") ??
      $("h1").first().text() ??
      "",
  ).trim();
  if (!titleRaw) {
    if (status === "ended") throw new ListingUnavailableError("ended");
    throw new Error("Yahoo Auctions detail page did not contain a title");
  }
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
  if (priceCurrent == null) {
    if (status === "ended") throw new ListingUnavailableError("ended");
    throw new Error(
      "Yahoo Auctions detail page did not contain a public price",
    );
  }
  const visibleBody = $("body").clone();
  visibleBody.find("script, style, noscript, template").remove();
  const bodyText = visibleBody.text().replace(/\s+/g, " ").trim();
  const imageSet = new Set<string>();
  const jsonImages = Array.isArray(json?.image) ? json.image : [json?.image];
  for (const image of jsonImages) {
    if (typeof image === "string")
      imageSet.add(new URL(image, sourceUrl).toString());
  }
  const ogImage = $('meta[property="og:image"]').attr("content");
  if (ogImage) imageSet.add(new URL(ogImage, sourceUrl).toString());
  $(
    "img[src], img[data-src], img[data-image-url], img[data-original], picture source[srcset]",
  ).each((_, element) => {
    const raw =
      $(element).attr("data-image-url") ??
      $(element).attr("data-original") ??
      $(element).attr("data-src") ??
      $(element).attr("src") ??
      $(element).attr("srcset");
    if (!raw) return;
    for (const value of raw
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])) {
      if (!value || value.startsWith("data:")) continue;
      try {
        imageSet.add(new URL(value, sourceUrl).toString());
      } catch {}
    }
  });
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
    : String(
        $('[class*="condition"], [data-testid*="condition"]').first().text(),
      ).trim() || undefined;
  const shipping = shippingEvidence(json, bodyText);
  const shippingFee = shipping.fee;
  const bidText = bodyText.match(
    /(?:入札(?:件数)?|bid(?:s)?)[^\d]{0,12}(\d+)\s*(?:件|人|回)?/i,
  )?.[0];
  const parsedBidCount = bidText
    ? Number(bidText.match(/(\d+)/)?.[1])
    : undefined;
  // The public page contains unrelated large numeric IDs next to the bid
  // label. Keep only a plausible count that fits PostgreSQL INT4.
  const bidCount =
    parsedBidCount != null && parsedBidCount >= 0 && parsedBidCount <= 2_000_000
      ? parsedBidCount
      : undefined;
  const embeddedSeller = publicYahooSeller(html);
  const sellerAnchor = $(
    '[data-testid*="seller"], [class*="Seller"], a[href*="/seller/"], a[href*="/user/"]',
  ).first();
  const sellerName =
    (typeof embeddedSeller?.displayName === "string"
      ? embeddedSeller.displayName.trim()
      : "") ||
    String(sellerAnchor.text()).replace(/\s+/g, " ").trim() ||
    "Yahoo!オークション出品者";
  const sellerHref =
    (typeof embeddedSeller?.profileUrl === "string"
      ? embeddedSeller.profileUrl
      : undefined) ?? sellerAnchor.attr("href");
  const sellerProfileUrl = sellerHref
    ? (() => {
        try {
          return new URL(sellerHref, sourceUrl).toString();
        } catch {
          return undefined;
        }
      })()
    : undefined;
  const locationText =
    (typeof embeddedSeller?.location === "object" &&
    embeddedSeller.location &&
    typeof (embeddedSeller.location as Record<string, unknown>).prefecture ===
      "string"
      ? String(
          (embeddedSeller.location as Record<string, unknown>).prefecture,
        ).trim()
      : "") ||
    String($('[class*="location"], [data-testid*="location"]').first().text())
      .replace(/\s+/g, " ")
      .trim() ||
    undefined;
  const listedAtValue = $("time[datetime]").first().attr("datetime");
  const listedAt = listedAtValue ? new Date(listedAtValue) : undefined;
  return {
    sourcePlatform: "yahoo_auctions",
    listingType: "auction",
    sourceItemId,
    sourceUrl,
    titleRaw,
    descriptionRaw,
    sellerName,
    sellerType: embeddedSeller?.isStore ? "store" : "individual",
    sellerProfileUrl,
    sellerData: embeddedSeller,
    locationText,
    priceCurrent,
    shippingFee,
    listedAt:
      listedAt && !Number.isNaN(listedAt.getTime()) ? listedAt : undefined,
    auctionEndAt: safeAuctionEndAt,
    bidCount,
    conditionRaw,
    imageUrls: sanitizeProductImageUrls(imageSet),
    sourceData: {
      structuredData: json ?? undefined,
      shippingText: shipping.evidence,
      shippingStatus: shipping.status,
      sellerText: sellerName,
      sellerProfileUrl,
      sellerPublicData: embeddedSeller,
      locationText,
      bidText,
      conditionText: conditionRaw,
      // Preserve the complete public page text for later AI translation and
      // seller analysis; normalized columns remain the fast query surface.
      bodyText: bodyText.slice(0, 20_000),
    },
    status,
    channel: "online",
  };
}

export class YahooAuctionsAdapter implements SourceAdapter {
  readonly key = "yahoo_auctions";
  readonly displayName = "Yahoo!オークション";
  private readonly userAgent =
    process.env.CRAWLER_USER_AGENT ?? "TokusatsuMonitor/1.0";
  private robots?: RobotPolicy;
  private robotsPromise?: Promise<RobotPolicy>;
  private readonly fetchImpl: typeof fetch;
  private readonly requestGate: YahooAuctionsRequestGate;

  constructor(
    options: {
      fetchImpl?: typeof fetch;
      requestGate?: YahooAuctionsRequestGate;
    } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.requestGate = options.requestGate ?? sharedYahooAuctionsRequestGate;
  }

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
    try {
      const detail = await this.fetchDetail({
        sourceItemId: item.sourceItemId,
        sourceUrl: item.sourceUrl,
      });
      return {
        status: detail.status,
        listingType: "auction",
        priceCurrent: detail.priceCurrent,
        auctionEndAt: detail.auctionEndAt,
        bidCount: detail.bidCount,
      };
    } catch (error) {
      if (error instanceof ListingUnavailableError)
        return { status: "ended", listingType: "auction" };
      if (/Yahoo Auctions returned (?:404|410)\b/i.test(String(error)))
        return { status: "ended", listingType: "auction" };
      throw error;
    }
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
    const configuredDelay = Number(
      process.env.YAHOO_AUCTIONS_CRAWL_DELAY_MS ?? MINIMUM_REQUEST_SPACING_MS,
    );
    const delay = Number.isFinite(configuredDelay)
      ? Math.max(MINIMUM_REQUEST_SPACING_MS, configuredDelay)
      : MINIMUM_REQUEST_SPACING_MS;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.requestGate.run(delay, async () => {
        const result = await this.fetchImpl(canonicalUrl, {
          headers: {
            "user-agent": this.userAgent,
            accept: "text/html,application/xhtml+xml",
            "accept-language": "ja,en;q=0.8",
          },
          signal: AbortSignal.timeout(25_000),
          redirect: "follow",
        });
        if (result.status === 429 || result.status >= 500) {
          this.requestGate.defer(
            yahooAuctionsRetryAfterMs(
              result.headers.get("retry-after"),
              attempt,
            ),
          );
        }
        return result;
      });
      if (response.status === 429 || response.status >= 500) {
        await response.arrayBuffer().catch(() => undefined);
        if (attempt < 2) continue;
      }
      if (!response.ok)
        throw new Error(`Yahoo Auctions returned ${response.status}`);
      const finalUrl = new URL(response.url);
      if (
        !["auctions.yahoo.co.jp", "page.auctions.yahoo.co.jp"].includes(
          finalUrl.hostname,
        ) ||
        finalUrl.pathname.replace(/\/$/, "") !==
          requestedUrl.pathname.replace(/\/$/, "")
      )
        throw new Error(
          `Yahoo Auctions detail redirected unexpectedly (${response.url})`,
        );
      return response.text();
    }
    throw new Error("Yahoo Auctions exhausted transient retries");
  }

  private async getRobots() {
    if (this.robots) return this.robots;
    if (this.robotsPromise) return this.robotsPromise;
    const pending = (async () => {
      const url = `${DETAIL_ORIGIN}/robots.txt`;
      const response = await this.fetchImpl(url, {
        headers: { "user-agent": this.userAgent },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new Error(
          `Cannot verify Yahoo Auctions robots.txt (${response.status}); refusing crawl`,
        );
      const policy = robotsParser(url, await response.text());
      this.robots = policy;
      return policy;
    })();
    this.robotsPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.robotsPromise === pending) this.robotsPromise = undefined;
    }
  }
}
