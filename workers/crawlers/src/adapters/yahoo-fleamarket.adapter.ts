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

const ORIGIN = "https://paypayfleamarket.yahoo.co.jp";
const ROBOTS_URL = `${ORIGIN}/robots.txt`;

type RobotPolicy = {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
};
const require = createRequire(import.meta.url);
const robotsParser = require("robots-parser") as (
  url: string,
  text: string,
) => RobotPolicy;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function date(value: unknown): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function isYahooFleamarketPlaceholderSellerName(value: unknown) {
  const name = text(value);
  if (!name) return false;
  return (
    name === "Yahoo!フリマ" ||
    name === "Yahoo！フリマ" ||
    /^Yahoo(?:!|！)フリマ(?:出品者|卖家)(?:\s+[a-z0-9_-]+)?$/i.test(name)
  );
}

function publicSellerName(...values: unknown[]) {
  return values
    .map(text)
    .find((value) => value && !isYahooFleamarketPlaceholderSellerName(value));
}

function nextState(html: string) {
  const $ = cheerio.load(html);
  const raw = $("#__NEXT_DATA__").text();
  if (!raw) return {};
  try {
    const root = record(JSON.parse(raw));
    return record(record(root.props).initialState);
  } catch {
    return {};
  }
}

function conditionText(value: unknown) {
  const labels: Record<string, string> = {
    new: "未使用",
    used10: "目立った傷や汚れなし",
    used20: "やや傷や汚れあり",
    used40: "傷や汚れあり",
    used60: "全体的に状態が悪い",
  };
  const key = String(value ?? "");
  return labels[key] ?? (key || undefined);
}

export function parseYahooFleamarketSearchHtml(
  html: string,
  limit = 100,
): SearchResult[] {
  const state = nextState(html);
  const search = record(record(state.searchState).search);
  const result = record(search.result);
  const rows = array(result.items);
  const results: SearchResult[] = [];
  for (const raw of rows) {
    if (results.length >= limit) break;
    const row = record(raw);
    const sourceItemId = text(row.id);
    const titleRaw = text(row.title);
    const priceCurrent = number(row.price);
    if (
      !sourceItemId ||
      !/^z\d+$/i.test(sourceItemId) ||
      !titleRaw ||
      priceCurrent == null ||
      isExcludedCollectibleText(titleRaw)
    )
      continue;
    const category = record(row.category);
    const categoryPath = array(category.path).map(record);
    const categoryText = categoryPath
      .map((entry) => text(entry.name))
      .filter(Boolean)
      .join(" / ");
    if (isExcludedCollectibleText(categoryText)) continue;
    const sourceUrl = `${ORIGIN}/item/${sourceItemId}`;
    const seller = record(row.seller);
    const sellerId = text(row.sellerId) ?? text(seller.id);
    const sellerName = publicSellerName(
      row.sellerNickname,
      row.sellerName,
      seller.nickname,
      seller.name,
      seller.displayName,
    );
    const status: ItemStatus =
      String(row.itemStatus ?? "").toUpperCase() === "OPEN" ? "active" : "sold";
    const imageUrls = sanitizeProductImageUrls(
      [text(row.thumbnailImageUrl)].filter((value): value is string =>
        Boolean(value),
      ),
    );
    const detailHint: RawItemDetail = {
      sourcePlatform: "yahoo_fleamarket",
      sourceItemId,
      sourceUrl,
      titleRaw,
      sellerName,
      sellerType: sellerName ? "individual" : undefined,
      sellerProfileUrl: sellerId ? `${ORIGIN}/user/${sellerId}` : undefined,
      sellerData: {
        sellerId,
        nickname: sellerName,
        goodRatio: number(seller.goodRatio),
        numRating: number(seller.numRating),
      },
      priceCurrent,
      shippingFee: 0,
      listedAt: date(row.openTime),
      conditionRaw: conditionText(row.condition),
      imageUrls,
      sourceData: {
        searchItem: row,
        categoryText,
        shippingText: "Yahoo!フリマは全品送料無料・匿名配送",
        shippingStatus: "free",
      },
      status,
      channel: "online",
    };
    results.push({ sourceItemId, sourceUrl, titleHint: titleRaw, detailHint });
  }
  return results;
}

export function parseYahooFleamarketDetailHtml(
  html: string,
  sourceUrl: string,
  sourceItemId: string,
): RawItemDetail {
  const state = nextState(html);
  const item = record(record(record(state.itemsState).items).item);
  if (text(item.id) !== sourceItemId)
    throw new Error("Yahoo! Fleamarket detail state did not match the item");
  const titleRaw = text(item.title);
  const priceCurrent = number(item.price);
  if (!titleRaw || priceCurrent == null)
    throw new Error("Yahoo! Fleamarket detail did not contain title and price");
  const descriptionRaw = text(item.description);
  const seller = record(item.seller);
  const sellerId = text(seller.id);
  const sellerName = publicSellerName(
    seller.nickname,
    seller.name,
    seller.displayName,
  );
  const images = [
    ...array(item.images).map((entry) => text(record(entry).url)),
    ...array(item.media).map((entry) =>
      text(record(record(entry).content).url),
    ),
  ].filter((value): value is string => Boolean(value));
  const shipping = shippingEvidence(
    {
      shippingDetails: {
        shippingRate: { value: 0, currency: "JPY" },
      },
    },
    "Yahoo!フリマは全品送料無料・匿名配送",
  );
  const condition = record(item.condition);
  const categoryList = array(item.categoryList).map(record);
  const brandList = array(item.brandList).map(record);
  const statusText = String(item.status ?? "").toUpperCase();
  const status: ItemStatus =
    statusText === "OPEN" && item.isPurchased !== true ? "active" : "sold";
  const relevantItemData = {
    pvCount: number(item.pvCount),
    likeCount: number(item.likeCount),
    questionCount: number(item.questionCount),
    offerCount: number(item.offerCount),
    createDate: text(item.createDate),
    openDate: text(item.openDate),
    updateDate: text(item.updateDate),
    categoryList,
    brandList,
    deliveryMethod: record(item.deliveryMethod),
    deliverySchedule: record(item.deliverySchedule),
    location: text(item.location),
    condition,
    status: statusText,
    productCategory: record(item.productCategory),
    specs: array(item.specs),
    hashtags: array(item.hashtags),
    imageCount: images.length,
  };
  return {
    sourcePlatform: "yahoo_fleamarket",
    sourceItemId,
    sourceUrl,
    titleRaw,
    descriptionRaw,
    sellerName,
    sellerType: sellerName ? "individual" : undefined,
    sellerProfileUrl: sellerId ? `${ORIGIN}/user/${sellerId}` : undefined,
    sellerData: {
      sellerId,
      nickname: sellerName,
      rating: record(seller.rating),
      tradingRecord: record(seller.tradingRecord),
      externalTradingRecord: record(seller.externalTradingRecord),
      image: record(seller.image),
      isKycCompleted: seller.isKycCompleted === true,
      isTrusted: seller.isTrusted === true,
      isGold: seller.isGold === true,
      shipBadgeLevel: text(seller.shipBadgeLevel),
    },
    locationText: text(item.location),
    priceCurrent,
    shippingFee: shipping.fee,
    listedAt: date(item.createDate) ?? date(item.openDate),
    conditionRaw: text(condition.text) ?? conditionText(condition.key),
    imageUrls: sanitizeProductImageUrls(images),
    sourceData: {
      item: relevantItemData,
      seller: {
        id: sellerId,
        nickname: sellerName,
        rating: record(seller.rating),
        tradingRecord: record(seller.tradingRecord),
        externalTradingRecord: record(seller.externalTradingRecord),
        image: record(seller.image),
        isKycCompleted: seller.isKycCompleted === true,
        isTrusted: seller.isTrusted === true,
        isGold: seller.isGold === true,
        shipBadgeLevel: text(seller.shipBadgeLevel),
      },
      shippingText: "Yahoo!フリマは全品送料無料・匿名配送",
      shippingStatus: shipping.status,
      bodyText: [titleRaw, descriptionRaw, JSON.stringify(relevantItemData)]
        .filter(Boolean)
        .join("\n")
        .slice(0, 20_000),
    },
    status,
    channel: "online",
  };
}

export class YahooFleamarketAdapter implements SourceAdapter {
  readonly key = "yahoo_fleamarket";
  readonly displayName = "Yahoo!フリマ";
  private lastRequestAt = 0;
  private robots?: RobotPolicy;
  private readonly userAgent =
    process.env.CRAWLER_USER_AGENT ?? "TokusatsuMonitor/1.0";

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const pages = Math.max(1, Math.min(query.pages ?? 1, 4));
    const pageStart = Math.max(0, query.pageStart ?? 0);
    const limit = Math.max(1, Math.min(query.limit ?? 50, pages * 100));
    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < pages && results.length < limit; index += 1) {
      const page = pageStart + index + 1;
      const url = new URL(
        `/search/${encodeURIComponent(query.keyword)}`,
        ORIGIN,
      );
      if (page > 1) url.searchParams.set("page", String(page));
      const html = await this.fetchAllowed(url.toString());
      for (const result of parseYahooFleamarketSearchHtml(html, limit)) {
        if (seen.has(result.sourceItemId) || results.length >= limit) continue;
        seen.add(result.sourceItemId);
        results.push(result);
      }
    }
    return results;
  }

  async fetchDetail(item: SearchResult): Promise<RawItemDetail> {
    return parseYahooFleamarketDetailHtml(
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
      if (/Yahoo! Fleamarket returned (?:404|410)/i.test(String(error)))
        return { status: "sold" };
      throw error;
    }
  }

  async normalize(raw: RawItemDetail) {
    return normalizeRawItem(raw);
  }

  private async fetchAllowed(url: string) {
    const parsed = new URL(url);
    if (parsed.hostname !== "paypayfleamarket.yahoo.co.jp")
      throw new Error(`Unsupported Yahoo! Fleamarket URL (${url})`);
    const robots = await this.getRobots();
    if (!robots.isAllowed(url, this.userAgent))
      throw new Error(`robots.txt disallows ${url}`);
    const delay = Math.max(
      5_000,
      Number(process.env.YAHOO_FLEAMARKET_CRAWL_DELAY_MS ?? 5_000),
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const elapsed = Date.now() - this.lastRequestAt;
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
      this.lastRequestAt = Date.now();
      if (response.status === 429 && attempt < 2) {
        const retryHeader = response.headers.get("retry-after");
        const retrySeconds = Number(retryHeader);
        const retryDate = retryHeader ? new Date(retryHeader) : undefined;
        const retryMs = Number.isFinite(retrySeconds)
          ? Math.max(5_000, retrySeconds * 1_000)
          : retryDate && !Number.isNaN(retryDate.getTime())
            ? Math.max(5_000, retryDate.getTime() - Date.now())
            : 30_000 * (attempt + 1);
        await response.arrayBuffer().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, retryMs));
        continue;
      }
      if (!response.ok)
        throw new Error(`Yahoo! Fleamarket returned ${response.status}`);
      if (new URL(response.url).hostname !== "paypayfleamarket.yahoo.co.jp")
        throw new Error(
          `Yahoo! Fleamarket redirected unexpectedly (${response.url})`,
        );
      return response.text();
    }
    throw new Error("Yahoo! Fleamarket exhausted rate-limit retries");
  }

  private async getRobots() {
    if (this.robots) return this.robots;
    const response = await fetch(ROBOTS_URL, {
      headers: { "user-agent": this.userAgent },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(
        `Cannot verify Yahoo! Fleamarket robots.txt (${response.status}); refusing crawl`,
      );
    this.robots = robotsParser(ROBOTS_URL, await response.text());
    return this.robots;
  }
}
