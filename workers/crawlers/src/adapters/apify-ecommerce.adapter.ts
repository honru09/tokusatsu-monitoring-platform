import { createHash } from "node:crypto";
import { normalizeRawItem } from "@tokusatsu/shared";
import type {
  ItemStatusUpdate,
  RawItemDetail,
  SearchQuery,
  SearchResult,
  SourceAdapter,
  StoredItem,
} from "@tokusatsu/shared";

type ActorRow = Record<string, unknown>;

const MARKETPLACE_NAMES: Record<string, string> = {
  "www.amazon.co.jp": "Amazon 日本",
  "item.rakuten.co.jp": "乐天市场",
  "www.ebay.com": "eBay",
  "store.shopping.yahoo.co.jp": "Yahoo! Shopping",
  "netmall.hardoff.co.jp": "HARD OFF Netmall",
};
const JPY_MARKETPLACE_HOSTS = new Set(
  Object.keys(MARKETPLACE_NAMES).filter((host) => host !== "www.ebay.com"),
);

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown): number | undefined {
  const object = asObject(value);
  if (Object.keys(object).length)
    return numberValue(object.value ?? object.amount ?? object.price);
  const text = String(value ?? "").trim();
  if (!text || /(^|[^\d])-\s*\d/.test(text)) return undefined;
  const matches = text.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g);
  if (matches?.length !== 1) return undefined;
  const parsed = Number(matches[0].replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed)
    : undefined;
}

function shippingValue(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (
    /^(?:free(?:\s+(?:shipping|delivery))?|送料無料|送料(?:込み|込))$/i.test(
      text,
    )
  )
    return 0;
  return numberValue(value);
}

function normalizedCurrency(value: unknown) {
  const currency = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (["JPY", "YEN", "JP¥"].includes(currency)) return "JPY";
  return /^[A-Z]{3}$/.test(currency) ? currency : undefined;
}

function currencyFromPriceText(value: unknown) {
  if (typeof value !== "string") return undefined;
  if (/(?:JPY|JP¥|円)/i.test(value)) return "JPY";
  if (/(?:USD|US\s*\$|\$)/i.test(value)) return "USD";
  if (/(?:EUR|€)/i.test(value)) return "EUR";
  if (/(?:GBP|£)/i.test(value)) return "GBP";
  return undefined;
}

function jpyShippingValue(value: unknown, fallbackCurrency?: unknown) {
  const object = asObject(value);
  const currency = normalizedCurrency(
    object.currency ?? object.priceCurrency ?? fallbackCurrency,
  );
  if (currency && currency !== "JPY") return undefined;
  return shippingValue(value);
}

function urls(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .flatMap((entry) =>
      typeof entry === "string"
        ? [entry]
        : [String(asObject(entry).url ?? asObject(entry).src ?? "")],
    )
    .filter((entry) => /^https?:\/\//i.test(entry));
}

function rowUrl(row: ActorRow) {
  return String(
    row.url ?? row.productUrl ?? row.canonicalUrl ?? row.link ?? "",
  );
}

function rowId(row: ActorRow, url: string) {
  return String(
    row.id ??
      row.productId ??
      row.asin ??
      createHash("sha256").update(url).digest("hex").slice(0, 24),
  );
}

export function parseApifyProduct(row: ActorRow): RawItemDetail {
  const sourceUrl = rowUrl(row);
  if (!sourceUrl) throw new Error("Apify result has no product URL");
  const offers = asObject(row.offers);
  const brand = asObject(row.brand);
  const marketplaceHost = new URL(sourceUrl).hostname.toLowerCase();
  const priceCandidates = [
    {
      value: offers.price,
      currency:
        offers.priceCurrency ??
        offers.currency ??
        asObject(offers.price).currency,
    },
    {
      value: row.price,
      currency:
        row.priceCurrency ??
        row.currency ??
        row.currencyCode ??
        asObject(row.price).currency,
    },
    {
      value: row.currentPrice,
      currency: row.priceCurrency ?? row.currency ?? row.currencyCode,
    },
  ];
  const priceCandidate = priceCandidates.find(
    ({ value }) => numberValue(value) != null,
  );
  const priceCurrent = numberValue(priceCandidate?.value);
  if (!priceCurrent) throw new Error("Apify result has no public price");
  const priceCurrency =
    normalizedCurrency(priceCandidate?.currency) ??
    currencyFromPriceText(priceCandidate?.value);
  if (priceCurrency && priceCurrency !== "JPY")
    throw new Error(`Apify result is not priced in JPY: ${priceCurrency}`);
  if (!priceCurrency && !JPY_MARKETPLACE_HOSTS.has(marketplaceHost))
    throw new Error("Apify result has no verifiable JPY currency");
  const titleRaw = String(
    row.name ?? row.title ?? row.productName ?? "",
  ).trim();
  if (!titleRaw) throw new Error("Apify result has no product title");
  const availability = String(
    offers.availability ?? row.availability ?? row.inStock ?? "",
  );
  return {
    sourcePlatform: "apify_ecommerce",
    listingType: marketplaceHost === "www.ebay.com" ? "unknown" : "direct",
    sourceItemId: rowId(row, sourceUrl),
    sourceUrl,
    titleRaw,
    descriptionRaw: String(row.description ?? "").trim() || undefined,
    sellerName:
      String(
        asObject(offers.seller).name ?? row.seller ?? brand.slogan ?? "",
      ).trim() || undefined,
    sellerType: "store",
    priceCurrent,
    shippingFee:
      jpyShippingValue(
        asObject(offers.shippingDetails).shippingRate,
        offers.priceCurrency ?? offers.currency ?? priceCurrency,
      ) ??
      jpyShippingValue(
        row.shipping,
        row.shippingCurrency ?? row.currency ?? priceCurrency,
      ),
    conditionRaw:
      String(row.condition ?? row.itemCondition ?? "").trim() || undefined,
    imageUrls: [
      ...urls(row.image),
      ...urls(row.images),
      ...urls(row.imageUrls),
    ].filter((value, index, all) => all.indexOf(value) === index),
    sourceData: {
      marketplaceHost,
      marketplaceName: MARKETPLACE_NAMES[marketplaceHost] ?? marketplaceHost,
      ...row,
    },
    status: /out.?of.?stock|sold|false/i.test(availability) ? "sold" : "active",
    channel: "online",
  };
}

export class ApifyEcommerceAdapter implements SourceAdapter {
  readonly key = "apify_ecommerce";
  readonly displayName = "Apify";
  private readonly details = new Map<string, RawItemDetail>();

  private async run(input: Record<string, unknown>) {
    const token = process.env.APIFY_TOKEN;
    if (!token) throw new Error("APIFY_TOKEN is required");
    const actor =
      process.env.APIFY_ECOMMERCE_ACTOR ?? "apify~e-commerce-scraping-tool";
    const response = await fetch(
      `https://api.apify.com/v2/acts/${actor}/runs?token=${encodeURIComponent(token)}&waitForFinish=120`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(130_000),
      },
    );
    if (!response.ok)
      throw new Error(`Apify actor returned ${response.status}`);
    const run = (await response.json()) as {
      data?: { status?: string; defaultDatasetId?: string };
    };
    if (run.data?.status !== "SUCCEEDED" || !run.data.defaultDatasetId)
      throw new Error(
        `Apify actor did not finish: ${run.data?.status ?? "unknown"}`,
      );
    const dataset = await fetch(
      `https://api.apify.com/v2/datasets/${run.data.defaultDatasetId}/items?token=${encodeURIComponent(token)}&clean=true`,
      { signal: AbortSignal.timeout(30_000) },
    );
    if (!dataset.ok)
      throw new Error(`Apify dataset returned ${dataset.status}`);
    return (await dataset.json()) as ActorRow[];
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const marketplaces = (process.env.APIFY_MARKETPLACES ?? "www.amazon.co.jp")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const rows = await this.run({
      keyword: query.keyword,
      marketplaces,
      maxProductResults: Math.min(query.limit ?? 30, 100),
      additionalProperties: true,
    });
    const results: SearchResult[] = [];
    for (const row of rows) {
      try {
        const detail = parseApifyProduct(row);
        this.details.set(detail.sourceItemId, detail);
        results.push({
          sourceItemId: detail.sourceItemId,
          sourceUrl: detail.sourceUrl,
          titleHint: detail.titleRaw,
          // The actor search response already contains the normalized public
          // facts. Expose them to central procurement ranking instead of
          // making every Apify result look equally unknown until fetchDetail.
          detailHint: detail,
        });
      } catch {}
    }
    return results;
  }

  async fetchDetail(item: SearchResult): Promise<RawItemDetail> {
    const cached = this.details.get(item.sourceItemId);
    if (cached) return cached;
    const rows = await this.run({
      detailsUrls: [{ url: item.sourceUrl }],
      additionalProperties: true,
    });
    if (!rows[0]) throw new Error("Apify returned no detail row");
    return parseApifyProduct(rows[0]);
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
      shippingFee: detail.shippingFee,
    };
  }

  async normalize(raw: RawItemDetail) {
    return normalizeRawItem(raw);
  }
}
