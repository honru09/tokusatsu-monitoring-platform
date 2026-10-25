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
import { sanitizeProductImageUrls } from "./images.js";
import { shippingEvidence } from "./shipping.js";
import {
  ListingUnavailableError,
  NoPublicPriceError,
  publicListingUiStatus,
  schemaListingPrice,
  schemaListingStatus,
} from "./public-listing-status.js";

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
  const jwk = publicKey.export({ format: "jwk" }) as {
    crv: string;
    x: string;
    y: string;
    kty: string;
  };
  const encode = (value: string) => Buffer.from(value).toString("base64url");
  const header = { typ: "dpop+jwt", alg: "ES256", jwk };
  const payload = {
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
    htu: url,
    htm: method,
  };
  const input = `${encode(JSON.stringify(header))}.${encode(JSON.stringify(payload))}`;
  const signature = createSign("SHA256")
    .update(input)
    .sign({ key: privateKey, dsaEncoding: "ieee-p1363" })
    .toString("base64url");
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
    add(
      $(element).attr("href") ?? "",
      $(element).attr("aria-label") ?? $(element).text(),
    ),
  );
  // Mercari currently renders result links in an RSC payload rather than
  // ordinary anchors; keep a conservative escaped-URL fallback for that case.
  for (const match of html.matchAll(
    /(?:https?:\\?\/\\?\/jp\.mercari\.com)?\\?\/item\\?\/(m[a-z0-9]+)/gi,
  )) {
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
  return rows
    .flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const value = row as Record<string, unknown>;
      // The public search endpoint exposes the marketplace's authoritative
      // listing status. Keep on-sale rows as crawl candidates and sold /
      // trading rows as well, so a stored listing that has since sold can
      // be retired from the search row itself. Other states stay dropped.
      const rowStatus = String(value.status ?? "");
      const isSoldRow = /SOLD|TRADING|STOP/i.test(rowStatus);
      if (rowStatus !== "ITEM_STATUS_ON_SALE" && !isSoldRow) return [];
      const id = typeof value.id === "string" ? value.id : "";
      const name = typeof value.name === "string" ? value.name : undefined;
      if (!/^[a-z0-9]{8,40}$/i.test(id) || !name) return [];
      const isShop =
        value.itemType === "ITEM_TYPE_BEYOND" || Boolean(value.shop);
      const sourceUrl = isShop
        ? `https://jp.mercari.com/shops/product/${id}`
        : `https://jp.mercari.com/item/${id}`;
      const photos = Array.isArray(value.photos) ? value.photos : [];
      const thumbnails = Array.isArray(value.thumbnails)
        ? value.thumbnails
        : [];
      const imageUrls = sanitizeProductImageUrls([
        ...photos.map((photo) =>
          photo &&
          typeof photo === "object" &&
          typeof (photo as Record<string, unknown>).uri === "string"
            ? String((photo as Record<string, unknown>).uri)
            : "",
        ),
        ...thumbnails.filter(
          (image): image is string => typeof image === "string",
        ),
      ]);
      const priceCurrent = yen(value.price);
      if (priceCurrent == null) return [];
      const conditionLabels: Record<string, string> = {
        "1": "新品、未使用",
        "2": "未使用に近い",
        "3": "目立った傷や汚れなし",
        "4": "やや傷や汚れあり",
        "5": "傷や汚れあり",
        "6": "全体的に状態が悪い",
      };
      const createdSeconds = Number(value.created);
      const auction =
        value.auction && typeof value.auction === "object"
          ? (value.auction as Record<string, unknown>)
          : undefined;
      const auctionEndSeconds = Number(
        auction?.endAt ??
          auction?.endTime ??
          auction?.auctionEndTime ??
          auction?.end,
      );
      const sellerId = typeof value.sellerId === "string" ? value.sellerId : "";
      const shopName =
        typeof value.shopName === "string" ? value.shopName.trim() : "";
      const detailHint: RawItemDetail = {
        sourcePlatform: "mercari",
        listingType: auction ? "auction" : "direct",
        sourceItemId: id,
        sourceUrl,
        titleRaw: name,
        sellerName:
          shopName || (sellerId ? `Mercari 卖家 ${sellerId}` : "Mercari 卖家"),
        sellerType: isShop ? "store" : "individual",
        sellerProfileUrl: sellerId
          ? `https://jp.mercari.com/user/profile/${sellerId}`
          : undefined,
        priceCurrent,
        shippingFee: String(value.shippingPayerId) === "2" ? 0 : undefined,
        listedAt: Number.isFinite(createdSeconds)
          ? new Date(createdSeconds * 1000)
          : undefined,
        auctionEndAt: Number.isFinite(auctionEndSeconds)
          ? new Date(auctionEndSeconds * 1000)
          : undefined,
        bidCount: Number.isFinite(Number(auction?.bidCount))
          ? Number(auction?.bidCount)
          : undefined,
        conditionRaw:
          conditionLabels[String(value.itemConditionId)] ?? undefined,
        imageUrls,
        sourceData: {
          ...value,
          sellerProfileUrl: sellerId
            ? `https://jp.mercari.com/user/profile/${sellerId}`
            : undefined,
        },
        status: isSoldRow ? "sold" : "active",
        channel: "online",
      };
      return [{ sourceItemId: id, sourceUrl, titleHint: name, detailHint }];
    })
    .slice(0, limit);
}

export function mergeMercariDetails(
  cached: RawItemDetail,
  detail: RawItemDetail,
): RawItemDetail {
  const genericDetailSeller = /^Mercari 卖家(?: \d+)?$/.test(
    detail.sellerName ?? "",
  );
  const mergedSourceData = { ...cached.sourceData, ...detail.sourceData };
  if (!detail.sellerProfileUrl && cached.sellerProfileUrl) {
    mergedSourceData.sellerProfileUrl = cached.sellerProfileUrl;
  }
  const listingType =
    cached.listingType === "auction" || detail.listingType === "auction"
      ? "auction"
      : cached.listingType === "direct" || detail.listingType === "direct"
        ? "direct"
        : "unknown";
  return {
    ...cached,
    ...detail,
    listingType,
    descriptionRaw: detail.descriptionRaw ?? cached.descriptionRaw,
    sellerName: genericDetailSeller ? cached.sellerName : detail.sellerName,
    sellerProfileUrl: detail.sellerProfileUrl ?? cached.sellerProfileUrl,
    sellerType: genericDetailSeller
      ? cached.sellerType
      : (detail.sellerType ?? cached.sellerType),
    shippingFee: detail.shippingFee ?? cached.shippingFee,
    listedAt: detail.listedAt ?? cached.listedAt,
    conditionRaw: detail.conditionRaw ?? cached.conditionRaw,
    imageUrls: sanitizeProductImageUrls([
      ...cached.imageUrls,
      ...detail.imageUrls,
    ]),
    sourceData: mergedSourceData,
    // Search results know the actual state. The unauthenticated item HTML is
    // mostly a shell and must not downgrade it based on global locale strings.
    status: detail.status === "unknown" ? cached.status : detail.status,
  };
}

export function parseMercariDetailHtml(
  html: string,
  sourceUrl: string,
  sourceItemId: string,
): RawItemDetail {
  const $ = cheerio.load(html);
  const uiStatus = publicListingUiStatus($);
  const structuredData = (() => {
    const schemas: unknown[] = [];
    $("script[type='application/ld+json']").each((_, element) => {
      try {
        schemas.push(JSON.parse($(element).text()));
      } catch {}
    });
    return schemas.length === 1 ? schemas[0] : schemas;
  })();
  const status: ItemStatus =
    uiStatus ?? schemaListingStatus(structuredData) ?? "unknown";
  const titleRaw = String(
    $("meta[property='og:title']").attr("content") ??
      $("title").first().text() ??
      $("h1").first().text() ??
      "",
  ).trim();
  if (!titleRaw) {
    if (status === "sold" || status === "ended")
      throw new ListingUnavailableError(status);
    throw new Error("Mercari detail page did not contain a title");
  }
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
  if (
    descriptionRaw &&
    /メルカリでお得に通販|安心して簡単に売り買い|支払いはクレジットカード/i.test(
      descriptionRaw,
    )
  ) {
    descriptionRaw = undefined;
  }
  // Price sources, most authoritative first: the product meta, the JSON-LD
  // offers block the status already comes from, then the visible price
  // element. Mercari serves page variants that drop the meta (shell pages,
  // Shops layouts); a single-source parse turned every such variant into a
  // permanently failing refresh.
  const priceCurrent =
    yen($("meta[name='product:price:amount']").attr("content")) ??
    schemaListingPrice(structuredData) ??
    yen($("meta[itemprop='price']").attr("content")) ??
    yen(
      $("[data-testid*='price' i], [itemprop='price']").first().text(),
    );
  if (priceCurrent == null) {
    if (status === "sold" || status === "ended")
      throw new ListingUnavailableError(status);
    throw new NoPublicPriceError(
      "Mercari detail page did not contain a public price",
    );
  }
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
  const visibleBody = $("body").clone();
  visibleBody.find("script, style, noscript, template").remove();
  const bodyText = visibleBody.text();
  const sellerName =
    $(
      "a[href*='/user/profile'], [data-testid*='seller'], [data-testid*='user']",
    )
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim() || "Mercari 卖家";
  const sellerProfileUrl = (() => {
    const href = $(
      "a[href*='/user/profile'], [data-testid*='seller'] a, [data-testid*='user'] a",
    )
      .first()
      .attr("href");
    if (!href) return undefined;
    try {
      return new URL(href, sourceUrl).toString();
    } catch {
      return undefined;
    }
  })();
  const normalizedBody = bodyText.replace(/\s+/g, " ").trim();
  const shipping = shippingEvidence(structuredData, normalizedBody);
  const shippingFee = shipping.fee;
  const locationText =
    String(
      $('[data-testid*="location"], [class*="location"], [class*="prefecture"]')
        .first()
        .text(),
    )
      .replace(/\s+/g, " ")
      .trim() || undefined;
  const conditionRaw =
    String($('[data-testid*="condition"], [class*="condition"]').first().text())
      .replace(/\s+/g, " ")
      .trim() || undefined;
  const listedAtValue = $("time[datetime]").first().attr("datetime");
  const listedAt = listedAtValue ? new Date(listedAtValue) : undefined;
  return {
    sourcePlatform: "mercari",
    // A standalone Mercari public product page is a fixed-price listing unless
    // the marketplace search payload supplies explicit auction evidence. When
    // such evidence exists mergeMercariDetails preserves `auction`; defaulting
    // the HTML fallback to `direct` prevents known Mercari inventory from
    // leaking back into the "待识别" bucket after every new crawl/import.
    listingType: "direct",
    sourceItemId,
    sourceUrl,
    titleRaw,
    descriptionRaw,
    sellerName,
    sellerType: "individual",
    sellerProfileUrl,
    locationText,
    priceCurrent,
    shippingFee,
    listedAt:
      listedAt && !Number.isNaN(listedAt.getTime()) ? listedAt : undefined,
    conditionRaw,
    imageUrls: sanitizeProductImageUrls(imageSet),
    sourceData: {
      structuredData,
      shippingText: shipping.evidence,
      shippingStatus: shipping.status,
      sellerText: sellerName,
      sellerProfileUrl,
      locationText,
      conditionText: conditionRaw,
      descriptionText: descriptionRaw,
      bodyText: normalizedBody.slice(0, 20_000),
    },
    status,
    channel: "online",
  };
}

export class MercariAdapter implements SourceAdapter {
  readonly key = "mercari";
  readonly displayName = "Mercari";
  private lastRequestAt = 0;
  private readonly userAgent =
    process.env.CRAWLER_USER_AGENT ?? "TokusatsuMonitor/1.0";
  private robots = new Map<string, RobotPolicy>();
  private readonly details = new Map<string, RawItemDetail>();

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
          // Sold-out rows are requested alongside on-sale rows so the
          // parser can surface them as sold search rows (see above).
          status: ["STATUS_ON_SALE", "STATUS_SOLD_OUT"],
          sizeId: [],
          categoryId: [],
          brandId: [],
          sellerId: query.sellerId
            ? Array.isArray(query.sellerId)
              ? query.sellerId
              : [query.sellerId]
            : [],
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
    if (!response.ok)
      throw new Error(`Mercari search returned ${response.status}`);
    const results = parseMercariSearchResponse(await response.json(), limit);
    for (const result of results) {
      if (result.detailHint)
        this.details.set(result.sourceItemId, result.detailHint);
    }
    return results;
  }

  async fetchDetail(
    item: SearchResult,
    options: { allowCachedFallback?: boolean } = {},
  ): Promise<RawItemDetail> {
    const cached = item.detailHint ?? this.details.get(item.sourceItemId);
    try {
      const detail = parseMercariDetailHtml(
        await this.fetchAllowed(item.sourceUrl),
        item.sourceUrl,
        item.sourceItemId,
      );
      return cached && options.allowCachedFallback !== false
        ? mergeMercariDetails(cached, detail)
        : detail;
    } catch (error) {
      if (
        cached &&
        options.allowCachedFallback !== false &&
        !(error instanceof ListingUnavailableError) &&
        !/^Mercari returned (?:404|410)$/.test(
          String(error instanceof Error ? error.message : error),
        )
      )
        return cached;
      throw error;
    }
  }

  async refreshStatus(item: StoredItem): Promise<ItemStatusUpdate> {
    try {
      const detail = await this.fetchDetail(
        {
          sourceItemId: item.sourceItemId,
          sourceUrl: item.sourceUrl,
        },
        { allowCachedFallback: false },
      );
      return {
        status: detail.status,
        listingType:
          item.listingType === "auction" ? "auction" : detail.listingType,
        priceCurrent: detail.priceCurrent,
        shippingFee: detail.shippingFee,
      };
    } catch (error) {
      if (error instanceof ListingUnavailableError)
        return {
          status: error.status,
          listingType: item.listingType ?? "unknown",
        };
      // Missing price is not terminal evidence: login/challenge/shell pages can
      // omit it too. Only an explicit unavailable notice or HTTP 404/410 retires.
      if (/Mercari returned (?:404|410)\b/i.test(String(error)))
        return { status: "sold", listingType: item.listingType ?? "unknown" };
      throw error;
    }
  }

  async normalize(raw: RawItemDetail) {
    return normalizeRawItem(raw);
  }

  async fetchSellerListings(
    sellerExternalId: string,
    limit = 60,
  ): Promise<SearchResult[]> {
    const safeLimit = Math.max(1, Math.min(limit, 120));
    return this.search({
      keyword: "",
      sellerId: [sellerExternalId],
      limit: safeLimit,
    });
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
    if (response.url) {
      const finalUrl = new URL(response.url);
      if (
        finalUrl.origin !== origin ||
        finalUrl.pathname.replace(/\/$/, "") !==
          parsed.pathname.replace(/\/$/, "")
      )
        throw new Error(
          "Mercari redirected away from the requested public listing",
        );
    }
    return response.text();
  }
}
