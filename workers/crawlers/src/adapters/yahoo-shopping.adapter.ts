import { isExcludedCollectibleText, normalizeRawItem } from "@tokusatsu/shared";
import type {
  ItemStatusUpdate,
  RawItemDetail,
  SearchQuery,
  SearchResult,
  SourceAdapter,
  StoredItem,
} from "@tokusatsu/shared";
import { sanitizeProductImageUrls } from "./images.js";

const API_URL =
  process.env.YAHOO_SHOPPING_API_URL ??
  "https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function parseYahooShoppingResponse(payload: unknown): SearchResult[] {
  const root = record(payload);
  const resultSet = record(root.ResultSet ?? root.resultSet);
  const resultBlock = record(resultSet["0"] ?? resultSet[0]);
  const resultObject = record(resultBlock.Result ?? resultBlock.result);
  const resultEntries = Object.keys(resultObject)
    .filter((key) => /^\d+$/.test(key))
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => resultObject[key]);
  const hits = Array.isArray(root.hits)
    ? root.hits
    : Array.isArray(root.Hits)
      ? root.Hits
      : resultEntries;
  const results: SearchResult[] = [];
  for (const value of hits) {
    const hit = record(value);
    const code = text(hit.Code ?? hit.code);
    const titleRaw = text(hit.Name ?? hit.name);
    const sourceUrl = text(hit.Url ?? hit.url);
    const priceCurrent = number(hit.Price ?? hit.price);
    if (
      !code ||
      !titleRaw ||
      !sourceUrl ||
      priceCurrent == null ||
      isExcludedCollectibleText(titleRaw)
    )
      continue;
    const image = record(hit.Image ?? hit.image);
    const seller = record(hit.Seller ?? hit.seller);
    const shipping = record(hit.Shipping ?? hit.shipping);
    const shippingText =
      text(shipping.Name ?? shipping.name) ??
      text(hit.Postage ?? hit.postage) ??
      undefined;
    const shippingFee =
      /送料無料|free shipping/i.test(shippingText ?? "") ||
      Number(shipping.Code ?? shipping.code) === 1
        ? 0
        : undefined;
    const images = sanitizeProductImageUrls(
      [
        text(image.Medium ?? image.medium),
        text(image.Small ?? image.small),
        text(hit.ImageUrl ?? hit.imageUrl),
      ].filter((entry): entry is string => Boolean(entry)),
    );
    const detailHint: RawItemDetail = {
      sourcePlatform: "yahoo_shopping",
      sourceItemId: code,
      sourceUrl,
      titleRaw,
      descriptionRaw:
        text(hit.Description ?? hit.description) ??
        text(hit.HeadLine ?? hit.headLine),
      sellerName: text(seller.Name ?? seller.name) ?? "Yahoo!ショッピング店铺",
      sellerType: "store",
      sellerProfileUrl: text(seller.Url ?? seller.url),
      sellerData: seller,
      priceCurrent,
      shippingFee,
      conditionRaw: text(hit.Condition ?? hit.condition),
      imageUrls: images,
      sourceData: {
        officialApi: true,
        item: hit,
        shippingText,
        shippingStatus: shippingFee === 0 ? "free" : "unknown",
        bodyText: [
          titleRaw,
          text(hit.Description ?? hit.description),
          text(hit.HeadLine ?? hit.headLine),
          shippingText,
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 20_000),
      },
      status: "active",
      channel: "online",
    };
    results.push({
      sourceItemId: code,
      sourceUrl,
      titleHint: titleRaw,
      detailHint,
    });
  }
  return results;
}

export class YahooShoppingAdapter implements SourceAdapter {
  readonly key = "yahoo_shopping";
  readonly displayName = "Yahoo!ショッピング";
  private lastRequestAt = 0;

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const pages = Math.max(1, Math.min(query.pages ?? 1, 4));
    const limit = Math.max(1, Math.min(query.limit ?? 50, pages * 100));
    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < pages && results.length < limit; page += 1) {
      const payload = await this.request({
        query: query.keyword,
        results: String(Math.min(100, limit - results.length)),
        start: String(
          Math.max(1, (query.pageStart ?? 0) * 100 + page * 100 + 1),
        ),
      });
      for (const result of parseYahooShoppingResponse(payload)) {
        if (seen.has(result.sourceItemId)) continue;
        seen.add(result.sourceItemId);
        results.push(result);
      }
    }
    return results;
  }

  async fetchDetail(item: SearchResult): Promise<RawItemDetail> {
    if (item.detailHint) return item.detailHint;
    const result = parseYahooShoppingResponse(
      await this.request({ itemcode: item.sourceItemId, results: "1" }),
    )[0];
    if (!result?.detailHint)
      throw new Error("Yahoo Shopping item is no longer available");
    return result.detailHint;
  }

  async refreshStatus(item: StoredItem): Promise<ItemStatusUpdate> {
    const result = parseYahooShoppingResponse(
      await this.request({ itemcode: item.sourceItemId, results: "1" }),
    )[0];
    if (!result?.detailHint) return { status: "sold" };
    return {
      status: "active",
      priceCurrent: result.detailHint.priceCurrent,
      shippingFee: result.detailHint.shippingFee,
    };
  }

  async normalize(raw: RawItemDetail) {
    return normalizeRawItem(raw);
  }

  private async request(parameters: Record<string, string>) {
    const clientId = process.env.YAHOO_SHOPPING_CLIENT_ID?.trim();
    if (!clientId)
      throw new Error(
        "Yahoo Shopping official API requires YAHOO_SHOPPING_CLIENT_ID",
      );
    const delay = Math.max(
      1_000,
      Number(process.env.YAHOO_SHOPPING_CRAWL_DELAY_MS ?? 1_100),
    );
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < delay)
      await new Promise((resolve) => setTimeout(resolve, delay - elapsed));
    const url = new URL(API_URL);
    url.searchParams.set("appid", clientId);
    url.searchParams.set("output", "json");
    for (const [key, value] of Object.entries(parameters))
      url.searchParams.set(key, value);
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": process.env.CRAWLER_USER_AGENT ?? "TokusatsuMonitor/1.0",
      },
      signal: AbortSignal.timeout(30_000),
    });
    this.lastRequestAt = Date.now();
    if (!response.ok)
      throw new Error(`Yahoo Shopping API returned ${response.status}`);
    return response.json();
  }
}
