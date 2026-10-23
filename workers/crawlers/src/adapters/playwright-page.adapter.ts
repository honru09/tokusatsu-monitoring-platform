import { chromium } from "playwright-core";
import { parsePublicProductPage } from "./public-page.adapter.js";
import { normalizeRawItem } from "@tokusatsu/shared";
import type {
  ItemStatusUpdate,
  RawItemDetail,
  SearchQuery,
  SearchResult,
  SourceAdapter,
  StoredItem,
} from "@tokusatsu/shared";

export class PlaywrightPageAdapter implements SourceAdapter {
  readonly key = "playwright_page";
  readonly displayName = "Playwright";

  async search(_query: SearchQuery): Promise<SearchResult[]> {
    return [];
  }

  async fetchDetail(item: SearchResult): Promise<RawItemDetail> {
    const endpoint = process.env.PLAYWRIGHT_WS_ENDPOINT;
    const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
    if (!endpoint && !executablePath)
      throw new Error(
        "Playwright fallback requires PLAYWRIGHT_WS_ENDPOINT or PLAYWRIGHT_EXECUTABLE_PATH",
      );
    const browser = endpoint
      ? await chromium.connect(endpoint)
      : await chromium.launch({ headless: true, executablePath });
    try {
      const context = await browser.newContext({
        userAgent: process.env.CRAWLER_USER_AGENT ?? "TokusatsuMonitor/1.0",
        locale: "ja-JP",
      });
      const page = await context.newPage();
      await page.goto(item.sourceUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.locator("body").waitFor({ state: "visible", timeout: 15_000 });
      const html = await page.content();
      const finalUrl = page.url() || item.sourceUrl;
      await context.close();
      const parsed = parsePublicProductPage(html, finalUrl);
      return { ...parsed, sourcePlatform: this.key };
    } finally {
      await browser.close();
    }
  }

  async refreshStatus(item: StoredItem): Promise<ItemStatusUpdate> {
    const detail = await this.fetchDetail({
      sourceItemId: item.sourceItemId,
      sourceUrl: item.sourceUrl,
    });
    return {
      status: detail.status,
      listingType: detail.listingType,
      priceCurrent: detail.priceCurrent,
    };
  }

  async normalize(raw: RawItemDetail) {
    return normalizeRawItem(raw);
  }
}
