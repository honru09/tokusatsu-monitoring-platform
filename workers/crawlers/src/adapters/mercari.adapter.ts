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
  const descriptionRaw =
    String(
      $("meta[property='og:description']").attr("content") ??
        $("meta[name='description']").attr("content") ??
        "",
    ).trim() || undefined;
  const priceCurrent = yen(
    $("meta[name='product:price:amount']").attr("content"),
  );
  if (priceCurrent == null)
    throw new Error("Mercari detail page did not contain a public price");
  const imageSet = new Set<string>();
  $("meta[property='og:image'], meta[name='twitter:image']").each(
    (_, element) => {
      const value = $(element).attr("content");
      if (value) imageSet.add(new URL(value, sourceUrl).toString());
    },
  );
  const bodyText = $("body").text();
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
    sellerName: "Mercari 卖家",
    sellerType: "individual",
    priceCurrent,
    imageUrls: [...imageSet].slice(0, 30),
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

  async search(_query: SearchQuery): Promise<SearchResult[]> {
    return [];
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
