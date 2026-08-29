import * as cheerio from "cheerio";
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
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
    .match(/(?:¥|￥|JPY)?\s*(\d{1,9})/i);
  return match ? Number(match[1]) : undefined;
}

function createDpopProof(url: string, method: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = publicKey.export({ format: "jwk" }) as { crv: string; x: string; y: string; kty: string };
  const encode = (value: string) => Buffer.from(value).toString("base64url");
  const header = { typ: "dpop+jwt", alg: "ES256", jwk };
  const payload = { iat: Math.floor(Date.now() / 1000), jti: randomUUID(), htu: url, htm: method };
  const input = `${encode(JSON.stringify(header))}.${encode(JSON.stringify(payload))}`;
  const signature = createSign("SHA256").update(input).sign({ key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${input}.${signature}`;
}

export function parseMercariSearchHtml(
  html: string,
  searchUrl: string,
  limit = 50,
): SearchResult[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  const add = (rawUrl: string, titleHint?: string) => {
    if (results.length >= limit) return;
    const match = rawUrl.match(/\/item\/(m[a-z0-9]+)/i);
    if (!match) return;
    const sourceItemId = match[1];
    if (seen.has(sourceItemId)) return;
    seen.add(sourceItemId);
    results.push({
      sourceItemId,
      sourceUrl: `https://jp.mercari.com/item/${sourceItemId}`,
      titleHint: titleHint?.replace(/\s+/g, " ").trim() || undefined,
    });
  };
  $("a[href*='/item/']").each((_, element) =>
    add($(element).attr("href") ?? "", $(element).attr("aria-label") ?? $(element).text()),
  );
  // Mercari currently renders result links in an RSC payload rather than
  // ordinary anchors; keep a conservative escaped-URL fallback for that case.
  for (const match of html.matchAll(/(?:https?:\\?\/\\?\/jp\.mercari\.com)?\\?\/item\\?\/(m[a-z0-9]+)/gi)) {
    add(`/item/${match[1]}`);
    if (results.length >= limit) break;
  }
  return results;
}

export function parseMercariSearchResponse(
  payload: unknown,
  limit = 50,
): SearchResult[] {
  const rows = (payload as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, limit).flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const value = row as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id : "";
    const name = typeof value.name === "string" ? value.name : undefined;
    if (!/^m[a-z0-9]+$/i.test(id)) return [];
    return [{ sourceItemId: id, sourceUrl: `https://jp.mercari.com/item/${id}`, titleHint: name }];
  });
}

export function parseMercariDetailHtml(
  html: string,
  sourceUrl: string,
  sourceItemId: string,
): RawItemDetail {
  const $ = cheerio.load(html);
  const titleRaw = String(
    $("meta[property='og:title']").attr("content") ??
      $("title").first().text() ??
      $("h1").first().text() ??
      "",
  ).trim();
  if (!titleRaw) throw new Error("Mercari detail page did not contain a title");
  let descriptionRaw =
    String(
      $("meta[property='og:description']").attr("content") ??
        $("meta[name='description']").attr("content") ??
        "",
    ).trim() || undefined;
  // The public og:description is often only Mercari's generic marketing copy;
  // it mentions cards and payment methods and must not trigger our collectible
  // exclusion filter. Keep it out until a detail extractor provides a real
  // seller description.
  if (descriptionRaw && /メルカリでお得に通販|安心して簡単に売り買い|支払いはクレジットカード/i.test(descriptionRaw)) {
    descriptionRaw = undefined;
  }
  const priceCurrent = yen(
    $("meta[name='product:price:amount']").attr("content"),
  );
  if (priceCurrent == null)
    throw new Error("Mercari detail page did not contain a public price");
  const imageSet = new Set<string>();
  const addImages = (value: unknown) => {
    if (typeof value !== "string") return;
    for (const candidate of value
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])) {
      if (!candidate || candidate.startsWith("data:")) continue;
      try {
        imageSet.add(new URL(candidate, sourceUrl).toString());
      } catch {}
    }
  };
  $(
    "meta[property='og:image'], meta[name='twitter:image'], img[src], img[data-src], img[data-image-url], img[data-testid*='image'], picture source[srcset]",
  ).each((_, element) => {
    addImages(
      $(element).attr("content") ??
        $(element).attr("data-image-url") ??
        $(element).attr("data-src") ??
        $(element).attr("src") ??
        $(element).attr("srcset"),
    );
  });
  const bodyText = $("body").text();
  const sellerName =
    $("a[href*='/user/profile'], [data-testid*='seller'], [data-testid*='user']")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim() || "Mercari 卖家";
  const soldBadge = />\s*Sold\s*</i.test(html);
  const status: ItemStatus =
    /sold\s*out|売り切れ|取引完了/i.test(bodyText) || soldBadge
      ? "sold"
      : "active";
  return {
    sourcePlatform: "mercari",
    sourceItemId,
    sourceUrl,
    titleRaw,
    descriptionRaw,
    sellerName,
    sellerType: "individual",
    priceCurrent,
    imageUrls: [...imageSet],
    status,
    channel: "online",
  };
}

export class MercariAdapter implements SourceAdapter {
  readonly key = "mercari";
  readonly displayName = "日本二手市场";
  private lastRequestAt = 0;
  private readonly userAgent =
    process.env.CRAWLER_USER_AGENT ?? "TokusatsuMonitor/1.0";
  private robots = new Map<string, RobotPolicy>();

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const limit = Math.max(1, Math.min(query.limit ?? 50, 120));
    const endpoint = "https://api.mercari.jp/v2/entities:search";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "user-agent": this.userAgent,
        accept: "application/json",
        "content-type": "application/json",
        "accept-language": "ja,en;q=0.8",
        "x-platform": "web",
        "x-country-code": "JP",
        dpop: createDpopProof(endpoint, "POST"),
      },
      body: JSON.stringify({
        userId: "",
        config: { responseToggles: ["QUERY_SUGGESTION_WEB_1"] },
        pageSize: limit,
        pageToken: "",
        searchSessionId: randomUUID(),
        source: "BaseSerp",
        indexRouting: "INDEX_ROUTING_UNSPECIFIED",
        searchCondition: {
          keyword: query.keyword,
          excludeKeyword: "",
          sort: "SORT_SCORE",
          order: "ORDER_DESC",
          status: [],
          sizeId: [],
          categoryId: [],
          brandId: [],
          sellerId: [],
          priceMin: 0,
          priceMax: 0,
          itemConditionId: [],
          shippingPayerId: [],
          shippingFromArea: [],
          shippingMethod: [],
          colorId: [],
          hasCoupon: false,
          attributes: [],
          itemTypes: [],
          skuIds: [],
          shopIds: [],
          excludeShippingMethodIds: [],
        },
        serviceFrom: "suruga",
        withItemBrand: true,
        withItemSizes: true,
        withAuction: true,
        withSuggestedItems: true,
        withProductSuggest: true,
        withProductArticles: true,
        withOfferPricePromotion: true,
        withShopname: true,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error(`Mercari search returned ${response.status}`);
    return parseMercariSearchResponse(await response.json(), limit);
  }

  async fetchDetail(item: SearchResult): Promise<RawItemDetail> {
    return parseMercariDetailHtml(
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
    return { status: detail.status, priceCurrent: detail.priceCurrent };
  }

  async normalize(raw: RawItemDetail) {
    return normalizeRawItem(raw);
  }

  private async fetchAllowed(url: string): Promise<string> {
    const parsed = new URL(url);
    const origin = parsed.origin;
    const robotsUrl = `${origin}/robots.txt`;
    let robots = this.robots.get(origin);
    if (!robots) {
      const robotsResponse = await fetch(robotsUrl, {
        headers: { "user-agent": this.userAgent },
        signal: AbortSignal.timeout(10_000),
      });
      if (!robotsResponse.ok)
        throw new Error(
          `Cannot verify robots.txt (${robotsResponse.status}); refusing crawl`,
        );
      robots = robotsParser(robotsUrl, await robotsResponse.text());
      this.robots.set(origin, robots);
    }
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
    if (!response.ok) throw new Error(`Mercari returned ${response.status}`);
    return response.text();
  }
}
