import { Injectable } from "@nestjs/common";
import { ConditionGrade, ListingType, Prisma } from "@tokusatsu/db";
import { PrismaService } from "../prisma.service.js";
import { valueKingPeerRelation } from '../items/value-king.js';
import {
  activeMarketItemWhere,
  excludedProcurementDescriptionFragments,
  excludedProcurementTitleFragments,
} from "../items/active-market-scope.js";
import {
  publicReadyChinaComparisonWhere,
  publicValueKingOpportunityRelation,
  readyValueKingOpportunityRelation,
  type XianyuPriceBand,
  valueKingOpportunityResponse,
} from "../items/item-response.js";

type CrawlMetrics = {
  candidates?: number;
  inserted?: number;
  skippedKnown?: number;
  detailFailed?: number;
  scanMode?: string;
  pageStart?: number;
  pages?: number;
};

type DailyDiscoveryRow = {
  date: string;
  count: number | bigint;
};

const DAY_MS = 24 * 60 * 60 * 1000;
function tokyoDateKey(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function sevenDayTrend(rows: DailyDiscoveryRow[], now: Date) {
  const counts = new Map(rows.map((row) => [row.date, Number(row.count)]));
  return Array.from({ length: 7 }, (_, index) => {
    const date = tokyoDateKey(new Date(now.getTime() - (6 - index) * DAY_MS));
    return { date, count: counts.get(date) ?? 0 };
  });
}

const sourceLabels: Record<string, string> = {
  mandarake: "Mandarake",
  mercari: "Mercari",
  yahoo_auctions: "Yahoo!オークション",
  yahoo_fleamarket: "Yahoo!フリマ",
  yahoo_shopping: "Yahoo!ショッピング",
  rakuma: "ラクマ",
  surugaya: "駿河屋",
  firecrawl_market: "Firecrawl",
  apify_ecommerce: "Apify",
  public_page: "网页来源",
  playwright_page: "Playwright",
  mock: "本地测试来源",
};

function metricsOf(value: Prisma.JsonValue | null): CrawlMetrics {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return value as CrawlMetrics;
}

function groupedCount(entry: {
  _count?: true | { _all?: number | null } | null;
}) {
  return typeof entry._count === "object" && entry._count
    ? (entry._count._all ?? 0)
    : 0;
}

@Injectable()
export class MonitoringService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const now = new Date();
    const since = new Date(now.getTime() - DAY_MS);
    const trendSince = new Date(now.getTime() - 7 * DAY_MS);
    const activeMarketWhere = activeMarketItemWhere({ now });
    const valueKingRelation = publicValueKingOpportunityRelation(now);
    const xianyuItemWhere = (
      priceBand?: XianyuPriceBand,
    ): Prisma.ItemWhereInput => {
      const comparison = publicReadyChinaComparisonWhere(priceBand, now);
      return comparison
        ? {
            ...activeMarketWhere,
            product: { is: { marketComparisons: { some: comparison } } },
          }
        : { id: "__comparison_exposure_disabled__" };
    };
    const [
      jobs,
      allSources,
      itemTotal,
      activeTotal,
      discovered24h,
      productTotal,
      pendingReviewTotal,
      inventoryTotal,
      categoryGroups,
      collectionGroups,
      listingTypeGroups,
      sourceGroups,
      discoveryRows,
      xianyuComparisonTotal,
      xianyuUnder300,
      xianyu300To999,
      xianyuAtLeast1000,
      valueKingCandidates,
    ] = await this.prisma.$transaction([
      this.prisma.crawlJob.findMany({
        where: { jobType: "search", createdAt: { gte: since } },
        include: {
          source: { select: { key: true, displayName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      this.prisma.source.findMany({
        select: {
          id: true,
          key: true,
          displayName: true,
          enabled: true,
          circuitOpenAt: true,
          failureCount: true,
          _count: { select: { items: true } },
        },
        orderBy: { displayName: "asc" },
      }),
      this.prisma.item.count(),
      this.prisma.item.count({ where: activeMarketWhere }),
      this.prisma.item.count({ where: { detectedAt: { gte: since } } }),
      this.prisma.product.count(),
      this.prisma.reviewQueue.count({ where: { status: "pending" } }),
      this.prisma.inventory.aggregate({ _sum: { quantity: true } }),
      this.prisma.item.groupBy({
        by: ["categoryIp"],
        where: activeMarketWhere,
        orderBy: { categoryIp: "asc" },
        _count: { _all: true },
      }),
      this.prisma.item.groupBy({
        by: ["collectibleSeries", "categoryIp"],
        where: {
          ...activeMarketWhere,
          collectibleSeries: { not: null },
        },
        orderBy: [{ collectibleSeries: "asc" }, { categoryIp: "asc" }],
        _count: { _all: true },
      }),
      this.prisma.item.groupBy({
        by: ["listingType"],
        where: activeMarketWhere,
        orderBy: { listingType: "asc" },
        _count: { _all: true },
      }),
      this.prisma.item.groupBy({
        by: ["sourceId"],
        where: activeMarketWhere,
        orderBy: { sourceId: "asc" },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<DailyDiscoveryRow[]>(Prisma.sql`
        SELECT
          to_char(
            (item."detectedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tokyo',
            'YYYY-MM-DD'
          ) AS date,
          COUNT(*)::integer AS count
        FROM "Item" AS item
        WHERE item."detectedAt" >= ${trendSince}
          AND item."status"::text IN ('active', 'unknown')
          AND item."archivedAt" IS NULL
          AND item."ignored" = FALSE
          AND item."channel"::text = 'online'
          AND item."categoryToyType"::text <> 'card'
          AND (
            item."listingType"::text <> 'auction'
            OR item."auctionEndAt" IS NULL
            OR item."auctionEndAt" > ${now}
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "PurchaseRecord" AS purchase
            WHERE purchase."itemId" = item."id"
          )
          AND ${Prisma.join(
            excludedProcurementDescriptionFragments.map(
              (fragment) =>
                Prisma.sql`(
                  item."descriptionRaw" IS NULL
                  OR LOWER(item."descriptionRaw") NOT LIKE ${`%${fragment.toLowerCase()}%`}
                )`,
            ),
            " AND ",
          )}
          AND ${Prisma.join(
            excludedProcurementTitleFragments.map(
              (fragment) =>
                Prisma.sql`LOWER(item."titleRaw") NOT LIKE ${`%${fragment.toLowerCase()}%`}`,
            ),
            " AND ",
          )}
        GROUP BY to_char(
          (item."detectedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tokyo',
          'YYYY-MM-DD'
        )
        ORDER BY date ASC
      `),
      this.prisma.item.count({ where: xianyuItemWhere() }),
      this.prisma.item.count({ where: xianyuItemWhere("lt_300") }),
      this.prisma.item.count({ where: xianyuItemWhere("300_999") }),
      this.prisma.item.count({ where: xianyuItemWhere("gte_1000") }),
      this.prisma.item.findMany({
        where: {
                ...activeMarketWhere,
                listingType: ListingType.direct,
                status: "active",
                shippingFee: { not: null },
                quantityEst: { not: null },
                conditionGrade: {
                  in: [
                    ConditionGrade.new_sealed,
                    ConditionGrade.like_new,
                    ConditionGrade.used,
                  ],
                },
              },
        select: {
          id:true,sellerId:true,titleRaw:true,descriptionRaw:true,conditionRaw:true,categoryIp:true,categoryToyType:true,collectibleSeries:true,lastSeenAt:true,channel:true,
          shfLine:true,shfEdition:true,shfRegion:true,shfReleaseChannel:true,
          images:{select:{id:true},take:1},product:{select:{listings:valueKingPeerRelation}},
          listingType: true,
          status: true,
          archivedAt: true,
          ignored: true,
          priceCurrent: true,
          shippingFee: true,
          quantityEst: true,
          conditionGrade: true,
          purchaseRecord: { select: { id: true } },
          crossMarketOpportunities:
            valueKingRelation ?? readyValueKingOpportunityRelation,
        },
      }),
    ]);
    const sources = allSources.filter((source) => source.enabled);
    const sourceById = new Map(allSources.map((source) => [source.id, source]));
    const totals = jobs.reduce(
      (sum, job) => {
        const metrics = metricsOf(job.metrics);
        sum.candidates += metrics.candidates ?? 0;
        sum.inserted += metrics.inserted ?? 0;
        sum.skippedKnown += metrics.skippedKnown ?? 0;
        sum.detailFailed += metrics.detailFailed ?? 0;
        if (job.status === "succeeded") sum.succeeded += 1;
        if (job.status === "failed") sum.failed += 1;
        return sum;
      },
      {
        candidates: 0,
        inserted: 0,
        skippedKnown: 0,
        detailFailed: 0,
        succeeded: 0,
        failed: 0,
      },
    );
    const lastScan = jobs.find((job) => job.finishedAt)?.finishedAt ?? null;
    const lastDiscovery =
      jobs.find((job) => (metricsOf(job.metrics).inserted ?? 0) > 0)
        ?.finishedAt ?? null;
    const recent = jobs.slice(0, 12).map((job) => ({
      id: job.id,
      source: job.source?.key ?? "unknown",
      sourceName:
        sourceLabels[job.source?.key ?? ""] ??
        job.source?.displayName ??
        job.source?.key ??
        "未知来源",
      status: job.status,
      query: job.query,
      metrics: metricsOf(job.metrics),
      error: job.errorText,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    }));
    return {
      status:
        totals.succeeded > 0 &&
        !sources.some(
          (source) =>
            source.circuitOpenAt &&
            Date.now() - source.circuitOpenAt.getTime() < 15 * 60 * 1000,
        )
          ? "active"
          : "attention",
      serverTime: now.toISOString(),
      lastScan,
      lastDiscovery,
      itemTotal,
      activeTotal,
      discovered24h,
      productTotal,
      pendingReviewTotal,
      inventoryTotal: inventoryTotal._sum.quantity ?? 0,
      totals24h: totals,
      sources: sources.map((source) => ({
        key: source.key,
        displayName: sourceLabels[source.key] ?? source.displayName,
        itemCount: source._count.items,
        failureCount: source.failureCount,
        circuitOpenAt: source.circuitOpenAt,
      })),
      market: {
        activeTotal: categoryGroups.reduce(
          (sum, entry) => sum + groupedCount(entry),
          0,
        ),
        categories: categoryGroups
          .map((entry) => ({
            key: String(entry.categoryIp),
            count: groupedCount(entry),
          }))
          .filter((entry) => entry.count > 0)
          .sort((left, right) => right.count - left.count),
        collections: collectionGroups
          .filter((entry) => entry.collectibleSeries != null)
          .map((entry) => ({
            key: String(entry.collectibleSeries),
            categoryIp: String(entry.categoryIp),
            count: groupedCount(entry),
          }))
          .filter((entry) => entry.count > 0)
          .sort((left, right) => right.count - left.count),
        listingTypes: listingTypeGroups
          .map((entry) => ({
            key: String(entry.listingType),
            count: groupedCount(entry),
          }))
          .filter((entry) => entry.count > 0)
          .sort((left, right) => right.count - left.count),
        sources: sourceGroups
          .map((entry) => {
            const source = sourceById.get(entry.sourceId);
            return {
              key: source?.key ?? entry.sourceId,
              displayName:
                sourceLabels[source?.key ?? ""] ??
                source?.displayName ??
                "未知来源",
              count: groupedCount(entry),
            };
          })
          .filter((entry) => entry.count > 0)
          .sort((left, right) => right.count - left.count),
        discoveryTrend: sevenDayTrend(discoveryRows, now),
        valueKingTotal: valueKingCandidates.filter(
          (item) => valueKingOpportunityResponse(item, now) != null,
        ).length,
        xianyuComparison: {
          total: xianyuComparisonTotal,
          priceBands: [
            { key: "lt_300", label: "¥300 以下", count: xianyuUnder300 },
            {
              key: "300_999",
              label: "¥300–999",
              count: xianyu300To999,
            },
            {
              key: "gte_1000",
              label: "¥1,000 以上",
              count: xianyuAtLeast1000,
            },
          ],
        },
      },
      recent,
    };
  }
}
