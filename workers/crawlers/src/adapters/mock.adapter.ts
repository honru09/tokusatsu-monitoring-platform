import { normalizeRawItem } from "@tokusatsu/shared";
import type {
  ItemStatusUpdate,
  RawItemDetail,
  SearchQuery,
  SearchResult,
  SourceAdapter,
  StoredItem,
} from "@tokusatsu/shared";

const fixtures: RawItemDetail[] = [
  {
    sourcePlatform: "mock",
    sourceItemId: "rider-belt-001",
    sourceUrl: "https://example.com/mock/rider-belt-001",
    titleRaw: "仮面ライダー DX変身ベルト まとめ売り 12点",
    descriptionRaw: "BANDAI製。中古、一部キズあり。箱なし。",
    sellerName: "东京示例中古店",
    sellerType: "store",
    locationText: "東京都千代田区",
    priceCurrent: 4800,
    shippingFee: 850,
    auctionEndAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    bidCount: 4,
    conditionRaw: "中古",
    imageUrls: [
      "https://images.unsplash.com/photo-1594736797933-d0501ba2fe65?auto=format&fit=crop&w=900&q=80",
    ],
    status: "active",
    channel: "online",
  },
  {
    sourcePlatform: "mock",
    sourceItemId: "rider-gasha-003",
    sourceUrl: "https://example.com/mock/rider-gasha-003",
    titleRaw: "仮面ライダー ガシャポン 未開封 30個",
    descriptionRaw: "カプセル未開封。シリーズ混在。BANDAI",
    sellerName: "东京示例中古店",
    sellerType: "store",
    locationText: "東京都豊島区",
    priceCurrent: 5980,
    shippingFee: 900,
    conditionRaw: "未開封",
    imageUrls: [
      "https://images.unsplash.com/photo-1607457561901-e6ec3a6d16cf?auto=format&fit=crop&w=900&q=80",
    ],
    status: "active",
    channel: "online",
  },
  {
    sourcePlatform: "mock",
    sourceItemId: "ultra-sofubi-002",
    sourceUrl: "https://example.com/mock/ultra-sofubi-002",
    titleRaw: "ウルトラマン ソフビ 20体 大量セット",
    descriptionRaw: "中古品。目立つ汚れがあるものを含みます。",
    sellerName: "东京示例中古店",
    sellerType: "store",
    locationText: "東京都中野区",
    priceCurrent: 3200,
    shippingFee: 750,
    conditionRaw: "汚れあり",
    imageUrls: [
      "https://images.unsplash.com/photo-1559715541-5daf8a0296d0?auto=format&fit=crop&w=900&q=80",
    ],
    status: "active",
    channel: "online",
  },
];

export class MockAdapter implements SourceAdapter {
  readonly key = "mock";
  readonly displayName = "Mock 数据源";

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const keyword = query.keyword.toLowerCase();
    return fixtures
      .filter(
        (item) =>
          !keyword ||
          item.titleRaw.toLowerCase().includes(keyword) ||
          /仮面ライダー|ウルトラマン/.test(keyword),
      )
      .slice(0, query.limit ?? 50)
      .map(({ sourceItemId, sourceUrl, titleRaw }) => ({
        sourceItemId,
        sourceUrl,
        titleHint: titleRaw,
      }));
  }

  async fetchDetail(result: SearchResult): Promise<RawItemDetail> {
    const item = fixtures.find(
      (candidate) => candidate.sourceItemId === result.sourceItemId,
    );
    if (!item) throw new Error(`Mock item ${result.sourceItemId} not found`);
    return { ...item, imageUrls: [...item.imageUrls] };
  }

  async refreshStatus(item: StoredItem): Promise<ItemStatusUpdate> {
    return {
      status:
        item.auctionEndAt && item.auctionEndAt < new Date()
          ? "ended"
          : item.status,
    };
  }

  async normalize(raw: RawItemDetail) {
    return normalizeRawItem(raw);
  }
}
