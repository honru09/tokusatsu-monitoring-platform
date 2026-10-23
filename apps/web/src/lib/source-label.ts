const platformNames: Record<string, string> = {
  mandarake: "Mandarake",
  mercari: "Mercari",
  yahoo_auctions: "Yahoo!オークション",
  yahoo_fleamarket: "Yahoo!フリマ",
  yahoo_shopping: "Yahoo!ショッピング",
  rakuma: "ラクマ",
  surugaya: "駿河屋",
  mock: "本地测试来源",
};

const genericSources = new Set([
  "firecrawl_market",
  "apify_ecommerce",
  "playwright_page",
  "public_page",
]);

export function marketplaceSourceName(
  key: string,
  fallback?: string,
  sourceUrl?: string,
) {
  if (genericSources.has(key)) {
    if (sourceUrl) {
      try {
        const host = new URL(sourceUrl).hostname.replace(/^www\./, "");
        if (host === "item.rakuten.co.jp") return "乐天市场";
        if (host === "amazon.co.jp") return "Amazon 日本";
        if (host === "jp.mercari.com") return "Mercari";
        if (host === "paypayfleamarket.yahoo.co.jp") return "Yahoo!フリマ";
        if (host === "netmall.hardoff.co.jp") return "HARD OFF Netmall";
        if (host === "store.shopping.yahoo.co.jp") return "Yahoo!ショッピング";
        if (host) return host;
      } catch {
        /* Use the server-provided name when no listing URL is available. */
      }
    }
    return fallback?.trim() || "来源待确认";
  }
  return platformNames[key] ?? (fallback?.trim() || key);
}

export function marketplaceSourceOptions(
  sources: readonly {
    key: string;
    displayName?: string | null;
    itemCount?: number;
  }[],
) {
  const seen = new Set<string>();
  return sources
    .filter((source) => source.key && (source.itemCount ?? 1) > 0)
    .filter((source) => {
      if (seen.has(source.key)) return false;
      seen.add(source.key);
      return true;
    })
    .map((source) => ({
      value: source.key,
      label: marketplaceSourceName(source.key, source.displayName ?? undefined),
    }));
}
