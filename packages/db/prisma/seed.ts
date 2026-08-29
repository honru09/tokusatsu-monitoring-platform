import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const now = new Date();
const auctionEnd = new Date(
  now.getTime() + 2 * 60 * 60 * 1000 + 14 * 60 * 1000,
);

const items = [
  {
    sourceItemId: "mock-rider-belt-001",
    sourceUrl: "https://example.com/mock/rider-belt-001",
    titleRaw: "仮面ライダー DX変身ベルト まとめ売り 12点",
    descriptionRaw:
      "BANDAI製。動作未確認を含む中古セット。箱なし、一部キズあり。",
    locationText: "東京都千代田区",
    priceCurrent: 4800,
    shippingFee: 850,
    priceTotalEst: 5650,
    categoryIp: "kamen_rider" as const,
    categoryToyType: "dx_belt" as const,
    manufacturer: "bandai" as const,
    conditionGrade: "used" as const,
    quantityEst: 12,
    imageCount: 2,
    unitCostEst: 471,
    confidence: 0.88,
    needsReview: false,
    status: "active" as const,
    channel: "online" as const,
    auctionEndAt: auctionEnd,
    bidCount: 4,
    images: [
      "https://images.unsplash.com/photo-1594736797933-d0501ba2fe65?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1608889476561-6242cfdbf622?auto=format&fit=crop&w=900&q=80",
    ],
  },
  {
    sourceItemId: "mock-ultra-sofubi-002",
    sourceUrl: "https://example.com/mock/ultra-sofubi-002",
    titleRaw: "ウルトラマン ソフビ 20体 大量セット",
    descriptionRaw: "中古品。目立つ汚れがあるものを含みます。",
    locationText: "東京都中野区",
    priceCurrent: 3200,
    shippingFee: 750,
    priceTotalEst: 3950,
    categoryIp: "ultraman" as const,
    categoryToyType: "sofubi" as const,
    manufacturer: "bandai" as const,
    conditionGrade: "stained_or_damaged" as const,
    quantityEst: 20,
    imageCount: 1,
    unitCostEst: 198,
    confidence: 0.82,
    needsReview: false,
    status: "active" as const,
    channel: "online" as const,
    auctionEndAt: null,
    bidCount: null,
    images: [
      "https://images.unsplash.com/photo-1559715541-5daf8a0296d0?auto=format&fit=crop&w=900&q=80",
    ],
  },
  {
    sourceItemId: "mock-rider-gasha-003",
    sourceUrl: "https://example.com/mock/rider-gasha-003",
    titleRaw: "仮面ライダー ガシャポン 未開封 30個",
    descriptionRaw: "カプセル未開封。シリーズ混在。",
    locationText: "東京都豊島区",
    priceCurrent: 5980,
    shippingFee: 900,
    priceTotalEst: 6880,
    categoryIp: "kamen_rider" as const,
    categoryToyType: "gashapon" as const,
    manufacturer: "bandai" as const,
    conditionGrade: "new_sealed" as const,
    quantityEst: 30,
    imageCount: 1,
    unitCostEst: 229,
    confidence: 0.94,
    needsReview: false,
    status: "active" as const,
    channel: "online" as const,
    auctionEndAt: null,
    bidCount: null,
    images: [
      "https://images.unsplash.com/photo-1607457561901-e6ec3a6d16cf?auto=format&fit=crop&w=900&q=80",
    ],
  },
  {
    sourceItemId: "mock-rider-junk-004",
    sourceUrl: "https://example.com/mock/rider-junk-004",
    titleRaw: "仮面ライダー ジャンク 変身アイテム 処分品 45点",
    descriptionRaw: "破損、欠品、電池液漏れの可能性あり。部品取り前提。",
    locationText: "東京都町田市",
    priceCurrent: 2500,
    shippingFee: 1200,
    priceTotalEst: 3700,
    categoryIp: "kamen_rider" as const,
    categoryToyType: "henshin_item" as const,
    manufacturer: "unknown" as const,
    conditionGrade: "junk" as const,
    quantityEst: 45,
    imageCount: 0,
    unitCostEst: 82,
    confidence: 0.69,
    needsReview: true,
    status: "active" as const,
    channel: "physical_store" as const,
    auctionEndAt: null,
    bidCount: null,
    images: [],
  },
];

async function main() {
  const source = await prisma.source.upsert({
    where: { key: "mock" },
    update: { displayName: "Mock 数据源", enabled: true },
    create: {
      key: "mock",
      displayName: "Mock 数据源",
      baseUrl: "https://example.com/mock",
      channel: "online",
      rateLimitMs: 0,
    },
  });
  const seller = await prisma.seller.upsert({
    where: { sourceId_name: { sourceId: source.id, name: "东京示例中古店" } },
    update: {},
    create: {
      sourceId: source.id,
      name: "东京示例中古店",
      sellerType: "store",
      locationText: "东京",
    },
  });

  for (const record of items) {
    const { images, ...data } = record;
    const item = await prisma.item.upsert({
      where: {
        sourceId_sourceItemId: {
          sourceId: source.id,
          sourceItemId: data.sourceItemId,
        },
      },
      update: {
        ...data,
        listingType: data.auctionEndAt ? "auction" : "direct",
        sellerId: seller.id,
        lastSeenAt: now,
      },
      create: {
        ...data,
        listingType: data.auctionEndAt ? "auction" : "direct",
        sourceId: source.id,
        sellerId: seller.id,
        detectedAt: now,
        lastSeenAt: now,
      },
    });
    await prisma.itemImage.deleteMany({ where: { itemId: item.id } });
    if (images.length)
      await prisma.itemImage.createMany({
        data: images.map((url, position) => ({
          itemId: item.id,
          url,
          position,
        })),
      });
    await prisma.itemPriceHistory.create({
      data: {
        itemId: item.id,
        priceCurrent: data.priceCurrent,
        shippingFee: data.shippingFee,
        bidCount: data.bidCount,
      },
    });
  }
  console.log(`Seeded ${items.length} procurement items.`);
}

main().finally(async () => prisma.$disconnect());
