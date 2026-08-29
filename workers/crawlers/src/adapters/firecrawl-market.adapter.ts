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
import { Firecrawl, type Document, type SearchResultWeb } from "firecrawl";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { createRequire } from "node:module";

const DEFAULT_DOMAINS = [
  "jp.mercari.com",
  "item.fril.jp",
  "www.suruga-ya.jp",
  "order.mandarake.co.jp",
];

type RobotPolicy = {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
};
const require = createRequire(import.meta.url);
const robotsParser = require("robots-parser") as (
  url: string,
  text: string,
) => RobotPolicy;

function configuredDomains(): string[] {
  const configured = process.env.FIRECRAWL_INCLUDE_DOMAINS?.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return configured?.length ? configured : DEFAULT_DOMAINS;
}

function isWebSearchResult(
  value: Document | SearchResultWeb,
): value is SearchResultWeb {
  return typeof (value as SearchResultWeb).url === "string";
}

export function isAllowedFirecrawlMarketplaceUrl(
  rawUrl: string,
  domains = configuredDomains(),
): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const allowAny = process.env.FIRECRAWL_ALLOW_ANY_DOMAIN === "true";
  if (url.protocol !== "https:" || (!domains.includes(host) && !allowAny))
    return false;
  if (
    host === "localhost" ||
    (isIP(host) === 4 &&
      (/^(10|127)\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)))
  )
    return false;
  const path = url.pathname;
  if (url.hostname === "jp.mercari.com")
    return /^\/(?:en\/)?item\/m\d+|^\/shops\/product\//.test(path);
  if (url.hostname === "item.fril.jp") return path.split("/").length >= 3;
  if (url.hostname === "www.suruga-ya.jp")
    return /\/product\/detail\//.test(path);
  if (url.hostname === "order.mandarake.co.jp")
    return /\/order\/detailPage\/item/.test(path);
  return allowAny && path !== "/";
}

function sourceItemId(url: string): string {
  const parsed = new URL(url);
  const mercariId = parsed.pathname.match(/\/item\/(m\d+)/)?.[1];
  const queryId = parsed.searchParams.get("itemCode");
  const pathId = parsed.pathname.split("/").filter(Boolean).at(-1);
  return (
    mercariId ??
    queryId ??
    pathId ??
    createHash("sha256").update(url).digest("hex").slice(0, 24)
  );
}

function yen(value: unknown): number | undefined {
  const match = String(value ?? "")
    .replace(/,/g, "")
    .match(/(?:¥|￥|JPY|価格[:：]?)\s*(\d{2,10})/i);
  return match ? Number(match[1]) : undefined;
}

export function parseFirecrawlMarketplaceDocument(
  document: Document,
  sourceUrl: string,
): RawItemDetail {
  const metadata = document.metadata ?? {};
  const variant = document.product?.variants.find(
    (candidate) => candidate.price?.amount != null,
  );
  const body = [document.markdown, metadata.description, metadata.ogDescription]
    .filter(Boolean)
    .join("\n");
  const titleRaw = String(
    document.product?.title ?? metadata.ogTitle ?? metadata.title ?? "",
  ).trim();
  if (!titleRaw)
    throw new Error("Firecrawl marketplace result did not contain a title");
  const priceCurrent =
    variant?.price?.amount != null
      ? Math.round(variant.price.amount)
      : yen(body);
  if (priceCurrent == null)
    throw new Error(
      "Firecrawl marketplace result did not contain a public price",
    );
  const status: ItemStatus =
    variant?.availability.inStock === false ||
    /sold\s*out|売り切れ|取引完了|在庫なし/i.test(body)
      ? "sold"
      : "active";
  const images = new Set<string>();
  for (const value of document.images ?? []) {
    try {
      images.add(new URL(value, sourceUrl).toString());
    } catch {
      // Ignore malformed third-party image URLs.
    }
  }
  for (const productVariant of document.product?.variants ?? []) {
    for (const image of productVariant.images ?? []) {
      try {
        images.add(new URL(image.url, sourceUrl).toString());
      } catch {
        // Ignore malformed third-party image URLs.
      }
    }
  }
  if (metadata.ogImage)
    images.add(new URL(metadata.ogImage, sourceUrl).toString());
  const listedAtText = metadata.publishedTime ?? metadata.dcDateCreated;
  const listedAt = listedAtText ? new Date(listedAtText) : undefined;
  return {
    sourcePlatform: "firecrawl_market",
    sourceItemId: sourceItemId(sourceUrl),
    sourceUrl,
    titleRaw,
    descriptionRaw: body || undefined,
    sellerName: new URL(sourceUrl).hostname,
    sellerType: "unknown",
    priceCurrent,
    listedAt:
      listedAt && !Number.isNaN(listedAt.getTime()) ? listedAt : undefined,
    conditionRaw: /未使用|新品|未開封/.test(body)
      ? "新品/未使用"
      : /中古|使用済|傷|汚れ/.test(body)
        ? "中古"
        : undefined,
    imageUrls: [...images],
    status,
    channel: "online",
  };
}

export class FirecrawlMarketplaceAdapter implements SourceAdapter {
  readonly key = "firecrawl_market";
  readonly displayName = "自动适配来源";
  private readonly userAgent =
    process.env.CRAWLER_USER_AGENT ?? "TokusatsuMonitor/1.0";
  private readonly robots = new Map<string, RobotPolicy>();
  private readonly client = new Firecrawl({
    apiKey: process.env.FIRECRAWL_API_KEY ?? null,
    apiUrl: process.env.FIRECRAWL_API_URL ?? null,
    timeoutMs: 45_000,
    maxRetries: 2,
  });

  async search(query: SearchQuery): Promise<SearchResult[]> {
    if (!process.env.FIRECRAWL_API_KEY)
      throw new Error(
        "FIRECRAWL_API_KEY is required before Firecrawl discovery can run",
      );
    const domains = configuredDomains();
    const data = await this.client.search(query.keyword, {
      sources: ["web"],
      includeDomains: domains,
      limit: Math.max(1, Math.min(query.limit ?? 20, 50)),
      highlights: false,
      timeout: 30_000,
    });
    const seen = new Set<string>();
    const results: SearchResult[] = [];
    for (const candidate of data.web ?? []) {
      const url = isWebSearchResult(candidate)
        ? candidate.url
        : (candidate.metadata?.sourceURL ?? candidate.metadata?.url);
      if (!url) continue;
      if (!isAllowedFirecrawlMarketplaceUrl(url, domains)) continue;
      const normalizedUrl = new URL(url);
      normalizedUrl.hash = "";
      for (const key of [...normalizedUrl.searchParams.keys()]) {
        if (/^utm_|^(?:ref|source)$/i.test(key))
          normalizedUrl.searchParams.delete(key);
      }
      const sourceUrl = normalizedUrl.toString();
      const id = sourceItemId(sourceUrl);
      if (seen.has(id)) continue;
      seen.add(id);
      results.push({
        sourceItemId: id,
        sourceUrl,
        titleHint: isWebSearchResult(candidate)
          ? candidate.title
          : (candidate.metadata?.title ?? candidate.metadata?.ogTitle),
      });
    }
    return results;
  }

  async fetchDetail(item: SearchResult): Promise<RawItemDetail> {
    await this.assertRobotsAllowed(item.sourceUrl);
    const document = await this.client.scrape(item.sourceUrl, {
      formats: ["markdown", "images", "product"],
      onlyMainContent: true,
      timeout: 30_000,
      proxy: "basic",
      removeBase64Images: true,
    });
    return parseFirecrawlMarketplaceDocument(document, item.sourceUrl);
  }

  async refreshStatus(item: StoredItem): Promise<ItemStatusUpdate> {
    const detail = await this.fetchDetail({
      sourceItemId: item.sourceItemId,
      sourceUrl: item.sourceUrl,
    });
    return {
      status: detail.status,
      priceCurrent: detail.priceCurrent,
    };
  }

  async normalize(raw: RawItemDetail) {
    return normalizeRawItem(raw);
  }

  private async assertRobotsAllowed(rawUrl: string) {
    const url = new URL(rawUrl);
    const robotsUrl = `${url.origin}/robots.txt`;
    let policy = this.robots.get(url.origin);
    if (!policy) {
      const response = await fetch(robotsUrl, {
        headers: { "user-agent": this.userAgent },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new Error(
          `Cannot verify robots.txt for ${url.hostname} (${response.status}); refusing Firecrawl scrape`,
        );
      policy = robotsParser(robotsUrl, await response.text());
      this.robots.set(url.origin, policy);
    }
    if (!policy.isAllowed(rawUrl, this.userAgent))
      throw new Error(`robots.txt disallows ${rawUrl}`);
  }
}
