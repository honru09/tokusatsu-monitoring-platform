import * as cheerio from "cheerio";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
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
import { shippingEvidence } from "./shipping.js";

type RobotPolicy = {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
};
const require = createRequire(import.meta.url);
const robotsParser = require("robots-parser") as (
  url: string,
  text: string,
) => RobotPolicy;

function blockedAddress(host: string) {
  if (host === "localhost" || host === "::1") return true;
  if (isIP(host) !== 4) return false;
  return (
    /^(10|127)\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

function yen(value: unknown): number | undefined {
  const match = String(value ?? "")
    .replace(/[,，\s]/g, "")
    .match(/(?:¥|￥|JPY|価格[:：]?)\s*(\d{1,10})/i);
  return match ? Number(match[1]) : undefined;
}

function numericYen(value: unknown): number | undefined {
  const direct = yen(value);
  if (direct != null) return direct;
  const match = String(value ?? "")
    .replace(/[,，\s]/g, "")
    .match(/^(\d{1,10})(?:\.\d+)?$/);
  return match ? Number(match[1]) : undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    return (
      value
        .map(record)
        .find((entry): entry is Record<string, unknown> => Boolean(entry)) ??
      null
    );
  }
  return record(value);
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  return [];
}

function productNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(productNodes);
  const object = record(value);
  if (!object) return [];
  const graph = Array.isArray(object["@graph"])
    ? object["@graph"]
    : object["@graph"]
      ? [object["@graph"]]
      : [];
  const nested = graph.flatMap(productNodes);
  const type = strings(object["@type"]).map((entry) => entry.toLowerCase());
  return type.some((entry) => entry === "product" || entry === "productgroup")
    ? [object, ...nested]
    : nested;
}

function parseWeightAndDimensions(text: string, structured: unknown) {
  const candidates = [text];
  for (const node of productNodes(structured)) {
    for (const key of [
      "weight",
      "width",
      "height",
      "depth",
      "length",
      "size",
      "dimensions",
    ]) {
      const value = node[key];
      if (value != null) candidates.push(`${key}: ${JSON.stringify(value)}`);
    }
    const additional = Array.isArray(node.additionalProperty)
      ? node.additionalProperty
      : [];
    for (const property of additional) {
      const entry = record(property);
      if (entry) candidates.push(`${entry.name ?? ""}: ${entry.value ?? ""}`);
    }
  }
  const corpus = candidates.join(" ").replace(/\s+/g, " ");
  const weightMatch = corpus.match(
    /(?:重量|重さ|weight|mass)\s*[:：=]?\s*(\d+(?:[.,]\d+)?)\s*(kg|キロ|g|グラム)/i,
  );
  const dimensionsMatch = corpus.match(
    /(?:寸法|サイズ|dimension|dimensions|梱包サイズ)\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(mm|cm)?/i,
  );
  const unit = dimensionsMatch?.[4]?.toLowerCase();
  const scale = unit === "cm" ? 10 : 1;
  return {
    weightGrams: weightMatch
      ? Math.round(
          Number(weightMatch[1].replace(",", ".")) *
            (/kg|キロ/i.test(weightMatch[2]) ? 1000 : 1),
        )
      : undefined,
    lengthMm: dimensionsMatch
      ? Math.round(Number(dimensionsMatch[1]) * scale)
      : undefined,
    widthMm: dimensionsMatch
      ? Math.round(Number(dimensionsMatch[2]) * scale)
      : undefined,
    heightMm: dimensionsMatch
      ? Math.round(Number(dimensionsMatch[3]) * scale)
      : undefined,
  };
}

export function parsePublicProductPage(
  html: string,
  sourceUrl: string,
): RawItemDetail {
  const $ = cheerio.load(html);
  const titleRaw = String(
    $("meta[property='og:title']").attr("content") ??
      $("meta[name='twitter:title']").attr("content") ??
      $("h1").first().text() ??
      $("title").first().text() ??
      "",
  )
    .replace(/\s+/g, " ")
    .trim();
  if (!titleRaw) throw new Error("公开商品页没有可识别标题");
  const structuredData = $('script[type="application/ld+json"]')
    .toArray()
    .flatMap((element) => {
      try {
        return [JSON.parse($(element).text()) as unknown];
      } catch {
        return [];
      }
    });
  const product = productNodes(structuredData)[0] ?? null;
  const offer = firstRecord(product?.offers);
  const seller = firstRecord(product?.seller);
  const body = $("body").text().replace(/\s+/g, " ").trim();
  const descriptionRaw =
    String(
      product?.description ??
        $("[itemprop='description']").first().text() ??
        $("meta[property='og:description']").attr("content") ??
        $("meta[name='description']").attr("content") ??
        $("article, main").first().text() ??
        "",
    )
      .replace(/\s+/g, " ")
      .trim() || undefined;
  const priceCurrent =
    numericYen(offer?.price) ??
    numericYen(product?.price) ??
    numericYen(
      $("meta[property='product:price:amount'], meta[itemprop='price']").attr(
        "content",
      ),
    ) ??
    yen(body);
  if (priceCurrent == null) throw new Error("公开商品页没有可识别公开价格");
  const shipping = shippingEvidence(structuredData, body);
  const status: ItemStatus =
    /sold\s*out|売り切れ|取引完了|落札済|在庫なし|out\s*of\s*stock/i.test(body)
      ? "sold"
      : "active";
  const images = new Set<string>();
  strings(product?.image).forEach((value) => {
    try {
      images.add(new URL(value, sourceUrl).toString());
    } catch {}
  });
  $(
    "meta[property='og:image'], meta[name='twitter:image'], img[src], img[data-src]",
  ).each((_, element) => {
    const value =
      $(element).attr("content") ??
      $(element).attr("data-src") ??
      $(element).attr("src");
    if (!value || value.startsWith("data:")) return;
    try {
      images.add(new URL(value, sourceUrl).toString());
    } catch {}
  });
  const parsed = new URL(sourceUrl);
  const logisticsHints = parseWeightAndDimensions(body, product);
  const sellerName =
    (typeof seller?.name === "string" && seller.name.trim()) ||
    $("[itemprop='seller'], .seller-name, .shop-name").first().text().trim() ||
    parsed.hostname;
  const sourceData = {
    title: titleRaw,
    description: descriptionRaw,
    canonicalUrl: $("link[rel='canonical']").attr("href"),
    publishedAt: $("time[datetime]").first().attr("datetime"),
    bodyText: body.slice(0, 20_000),
    shippingText: shipping.evidence,
    shippingStatus: shipping.status,
    seller: seller
      ? { name: seller.name, url: seller.url, type: seller["@type"] }
      : undefined,
    product: product
      ? {
          sku: product.sku,
          mpn: product.mpn,
          brand: product.brand,
          category: product.category,
          availability: offer?.availability,
          condition: offer?.itemCondition,
        }
      : undefined,
    logisticsHints,
  };
  const sourceItemId = createHash("sha256")
    .update(sourceUrl)
    .digest("hex")
    .slice(0, 24);
  return {
    sourcePlatform: "public_page",
    sourceItemId,
    sourceUrl,
    titleRaw,
    descriptionRaw,
    sellerName,
    sellerType:
      seller?.["@type"] === "Organization" || seller?.["@type"] === "Store"
        ? "store"
        : "unknown",
    sellerProfileUrl: typeof seller?.url === "string" ? seller.url : undefined,
    sellerData: seller ?? undefined,
    priceCurrent,
    shippingFee: shipping.fee,
    imageUrls: [...images],
    sourceData,
    status,
    channel: "online",
  };
}

export class PublicPageAdapter implements SourceAdapter {
  readonly key = "public_page";
  readonly displayName = "网页来源";
  private readonly userAgent =
    process.env.CRAWLER_USER_AGENT ?? "TokusatsuMonitor/1.0";
  private readonly robots = new Map<string, RobotPolicy>();
  private lastRequestAt = 0;

  async search(_query: SearchQuery): Promise<SearchResult[]> {
    return [];
  }

  async fetchDetail(item: SearchResult): Promise<RawItemDetail> {
    const url = new URL(item.sourceUrl);
    if (url.protocol !== "https:" || blockedAddress(url.hostname))
      throw new Error("仅允许公开 HTTPS 商品页");
    const address = await lookup(url.hostname);
    if (blockedAddress(address.address))
      throw new Error("目标域名解析到内网地址，已拒绝");
    const robotsUrl = `${url.origin}/robots.txt`;
    let robots = this.robots.get(url.origin);
    if (!robots) {
      const robotsResponse = await fetch(robotsUrl, {
        headers: { "user-agent": this.userAgent },
        signal: AbortSignal.timeout(10_000),
      });
      if (!robotsResponse.ok)
        throw new Error(`无法验证 robots.txt (${robotsResponse.status})`);
      robots = robotsParser(robotsUrl, await robotsResponse.text());
      this.robots.set(url.origin, robots);
    }
    if (!robots.isAllowed(url.toString(), this.userAgent))
      throw new Error("robots.txt 不允许抓取");
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < 2500)
      await new Promise((resolve) => setTimeout(resolve, 2500 - elapsed));
    const response = await fetch(url, {
      headers: {
        "user-agent": this.userAgent,
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(25_000),
      redirect: "follow",
    });
    this.lastRequestAt = Date.now();
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== "https:" || finalUrl.hostname !== url.hostname)
      throw new Error("商品页重定向到未验证域名，已拒绝");
    if (!response.ok) throw new Error(`公开商品页返回 ${response.status}`);
    return parsePublicProductPage(await response.text(), url.toString());
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
}
