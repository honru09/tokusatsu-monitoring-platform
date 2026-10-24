import * as cheerio from "cheerio";
import { createRequire } from "node:module";
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

const ORIGIN = "https://www.suruga-ya.jp";
const ROBOTS_URL = `${ORIGIN}/robots.txt`;

type RobotPolicy = {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
};
const require = createRequire(import.meta.url);
const robotsParser = require("robots-parser") as (
  url: string,
  text: string,
) => RobotPolicy;

function compact(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function yen(value: unknown): number | undefined {
  const match = compact(value)
    .replace(/,/g, "")
    .match(/(?:¥|￥|JPY)?\s*(\d{1,9})/i);
  return match ? Number(match[1]) : undefined;
}

function absoluteUrl(value: string | undefined, base = ORIGIN) {
  if (!value) return undefined;
  try {
    return new URL(value, base).toString();
  } catch {
    return undefined;
  }
}

/**
 * Out-of-stock evidence on a catalogue card. Only badge-style markup
 * counts: an element carrying a stock / sold marker in its class / test
 * id / aria-label, or a leaf element whose whole text is the marker. The
 * product name is never scanned, so a title mentioning a sold-out item
 * elsewhere does not retire this listing. This mirrors how refreshStatus
 * already treats a catalogue absence ("not in stock") as sold.
 */
function surugayaCardStatus(
  $: cheerio.CheerioAPI,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  card: cheerio.Cheerio<any>,
): "active" | "sold" {
  let sold = false;
  card.find("[aria-label]").each((_, element) => {
    if (
      /品切れ|在庫なし|在庫切れ|売り切れ|sold\s*out|out\s*of\s*stock/i.test(
        $(element).attr("aria-label") ?? "",
      )
    )
      sold = true;
  });
  if (sold) return "sold";
  if (
    card.find(
      '[class*="sold" i], [data-testid*="sold" i], [class*="out-of-stock" i], [class*="stockout" i]',
    ).length > 0
  )
    return "sold";
  card.find("*").each((_, element) => {
    const node = $(element);
    if (node.children().length > 0) return;
    if (node.closest(".product-name").length > 0) return;
    const text = compact(node.text());
    if (
      /^(?:品切れ|在庫なし|在庫切れ|売り切れ(?:ました)?|SOLD(?:\s*OUT)?|OUT\s*OF\s*STOCK)[。.!！]?$/i.test(
        text,
      )
    )
      sold = true;
  });
  return sold ? "sold" : "active";
}

/**
 * Parse only the public catalogue cards. Surugaya currently blocks its detail
 * pages from this environment, while the catalogue itself exposes the live
 * price, stock, image, maker, release date and shipping rule. Keeping that
 * evidence is preferable to pretending a failed detail request is complete.
 */
export function parseSurugayaSearchHtml(
  html: string,
  searchUrl: string,
  limit = 50,
): SearchResult[] {
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  $(".item").each((_, element) => {
    if (results.length >= limit) return false;
    const card = $(element);
    const anchor = card.find('a[href*="/product/detail/"]').first();
    const href = anchor.attr("href");
    const match = href?.match(/\/product\/detail\/(\d+)/i);
    if (!href || !match || seen.has(match[1])) return;

    const titleRaw = compact(card.find(".product-name").first().text());
    if (!titleRaw || isExcludedCollectibleText(titleRaw)) return;

    const priceArea = card.find(".item_price").first();
    const priceCurrent =
      yen(priceArea.find(".price_teika strong").first().text()) ??
      yen(priceArea.find(".text-red strong").first().text()) ??
      yen(priceArea.text());
    if (priceCurrent == null) return;

    const sourceItemId = match[1];
    const sourceUrl = absoluteUrl(href, searchUrl);
    if (!sourceUrl) return;
    const cardText = compact(card.text());
    const categoryText = compact(
      card.find(".item_detail .condition").first().text(),
    );
    const releaseText = compact(card.find(".release_date").first().text());
    const brandText = compact(card.find(".brand").first().text());
    const shippingText = compact(
      priceArea.find(".show_shipping_fee").closest("p").text(),
    );
    const feeText = compact(priceArea.find(".panel_buy").text());
    // The card may advertise marketplace alternatives below the main item.
    // Attribute the listing to a marketplace seller only when the selected
    // listing URL itself contains that store code.
    const marketplace = /tenpo_cd=/i.test(href);
    const shippingFee =
      /999円以上は送料無料/.test(shippingText) && priceCurrent >= 999
        ? 0
        : undefined;
    const imageUrls = sanitizeProductImageUrls(
      card
        .find(".photo_box img")
        .map((__, image) =>
          absoluteUrl(
            $(image).attr("data-original") ??
              $(image).attr("data-src") ??
              $(image).attr("src"),
            searchUrl,
          ),
        )
        .get()
        .filter((value): value is string => Boolean(value)),
    );
    const descriptionRaw = [categoryText, releaseText, brandText, shippingText]
      .filter(Boolean)
      .join("\n");
    const detailHint: RawItemDetail = {
      sourcePlatform: "surugaya",
      listingType: "direct",
      sourceItemId,
      sourceUrl,
      titleRaw,
      descriptionRaw: descriptionRaw || undefined,
      sellerName: marketplace ? "駿河屋マーケットプレイス" : "駿河屋",
      sellerType: "store",
      sellerProfileUrl: ORIGIN,
      priceCurrent,
      shippingFee,
      conditionRaw: /中古/.test(cardText) ? "中古" : categoryText || undefined,
      imageUrls,
      sourceData: {
        catalogueUrl: searchUrl,
        categoryText,
        releaseText,
        brandText,
        shippingText,
        commerceFeeText: feeText,
        marketplace,
        bodyText: cardText.slice(0, 20_000),
      },
      sellerData: {
        marketplace,
        shippingText,
        commerceFeeText: feeText,
        catalogueUrl: searchUrl,
      },
      status: surugayaCardStatus($, card),
      channel: "online",
    };
    seen.add(sourceItemId);
    results.push({ sourceItemId, sourceUrl, titleHint: titleRaw, detailHint });
  });
  return results;
}

export class SurugayaAdapter implements SourceAdapter {
  readonly key = "surugaya";
  readonly displayName = "駿河屋";
  private lastRequestAt = 0;
  private robots?: RobotPolicy;
  private readonly userAgent =
    process.env.CRAWLER_USER_AGENT ?? "TokusatsuMonitor/1.0";

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const pages = Math.max(1, Math.min(query.pages ?? 1, 3));
    const pageStart = Math.max(0, query.pageStart ?? 0);
    const limit = Math.max(1, Math.min(query.limit ?? 50, pages * 50));
    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < pages && results.length < limit; index += 1) {
      const url = new URL("/search", ORIGIN);
      // 50003 is Surugaya's public toys / hobby catalogue, which avoids books,
      // media and card catalogues before our own textual exclusion runs.
      url.searchParams.set("category", "50003");
      url.searchParams.set("search_word", query.keyword);
      const page = pageStart + index + 1;
      if (page > 1) url.searchParams.set("page", String(page));
      const html = await this.fetchAllowed(url.toString());
      for (const result of parseSurugayaSearchHtml(
        html,
        url.toString(),
        limit,
      )) {
        if (seen.has(result.sourceItemId) || results.length >= limit) continue;
        seen.add(result.sourceItemId);
        results.push(result);
      }
    }
    return results;
  }

  async fetchDetail(item: SearchResult): Promise<RawItemDetail> {
    if (item.detailHint) return item.detailHint;
    // Direct catalogue details currently return 403 to non-browser clients.
    // Looking up the public product code in the allowed catalogue returns the
    // same authoritative live card and also makes pasted links importable.
    const url = new URL("/search", ORIGIN);
    url.searchParams.set("category", "50003");
    url.searchParams.set("search_word", item.sourceItemId);
    const results = parseSurugayaSearchHtml(
      await this.fetchAllowed(url.toString()),
      url.toString(),
      50,
    );
    const match = results.find(
      (candidate) => candidate.sourceItemId === item.sourceItemId,
    );
    if (!match?.detailHint)
      throw new Error(`Surugaya item ${item.sourceItemId} is not in stock`);
    return match.detailHint;
  }

  async refreshStatus(item: StoredItem): Promise<ItemStatusUpdate> {
    try {
      const detail = await this.fetchDetail({
        sourceItemId: item.sourceItemId,
        sourceUrl: item.sourceUrl,
      });
      return {
        status: detail.status,
        listingType: "direct",
        priceCurrent: detail.priceCurrent,
        shippingFee: detail.shippingFee,
      };
    } catch (error) {
      if (/Surugaya returned (?:404|410)|not in stock/i.test(String(error)))
        return { status: "sold", listingType: "direct" };
      throw error;
    }
  }

  async normalize(raw: RawItemDetail) {
    return normalizeRawItem(raw);
  }

  private async fetchAllowed(url: string) {
    const parsed = new URL(url);
    if (parsed.hostname !== "www.suruga-ya.jp" || parsed.pathname !== "/search")
      throw new Error(`Unsupported Surugaya catalogue URL (${url})`);
    const robots = await this.getRobots();
    if (!robots.isAllowed(url, this.userAgent))
      throw new Error(`robots.txt disallows ${url}`);
    // Surugaya's wildcard robots group declares a 30-second crawl delay.
    const minimumDelay = Math.max(
      30_000,
      Number(process.env.SURUGAYA_CRAWL_DELAY_MS ?? 30_000),
    );
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < minimumDelay)
      await new Promise((resolve) =>
        setTimeout(resolve, minimumDelay - elapsed),
      );
    const response = await fetch(url, {
      headers: {
        "user-agent": this.userAgent,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ja,en;q=0.8",
      },
      signal: AbortSignal.timeout(35_000),
      redirect: "follow",
    });
    this.lastRequestAt = Date.now();
    if (!response.ok) throw new Error(`Surugaya returned ${response.status}`);
    const finalUrl = new URL(response.url);
    if (
      finalUrl.hostname !== "www.suruga-ya.jp" ||
      finalUrl.pathname !== "/search"
    )
      throw new Error(
        `Surugaya search redirected unexpectedly (${response.url})`,
      );
    return response.text();
  }

  private async getRobots() {
    if (this.robots) return this.robots;
    const response = await fetch(ROBOTS_URL, {
      headers: { "user-agent": this.userAgent },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(
        `Cannot verify Surugaya robots.txt (${response.status}); refusing crawl`,
      );
    this.robots = robotsParser(ROBOTS_URL, await response.text());
    return this.robots;
  }
}
