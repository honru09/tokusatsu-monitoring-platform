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
  const descriptionRaw =
    String(
      $("meta[property='og:description']").attr("content") ??
        $("meta[name='description']").attr("content") ??
        "",
    ).trim() || undefined;
  const priceCurrent =
    yen(
      $("meta[property='product:price:amount'], meta[itemprop='price']").attr(
        "content",
      ),
    ) ?? yen($("body").text());
  if (priceCurrent == null) throw new Error("公开商品页没有可识别公开价格");
  const body = $("body").text();
  const status: ItemStatus =
    /sold\s*out|売り切れ|取引完了|落札済|在庫なし|out\s*of\s*stock/i.test(body)
      ? "sold"
      : "active";
  const images = new Set<string>();
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
    sellerName: parsed.hostname,
    sellerType: "unknown",
    priceCurrent,
    imageUrls: [...images].slice(0, 30),
    status,
    channel: "online",
  };
}

export class PublicPageAdapter implements SourceAdapter {
  readonly key = "public_page";
  readonly displayName = "自动适配来源";
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
