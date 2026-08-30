import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { PrismaService } from "../prisma.service.js";
import { configuredProviderRuntimes } from "./ai-provider-registry.js";

const queueNames = [
  "source-search",
  "image-classification",
  "item-status-refresh",
  "seller-profile-backfill",
  "url-analysis",
  "inventory-maintenance",
  "disliked-maintenance",
  "market-intel-refresh",
  "title-translation",
  "item-detail-translation",
  "ai-operations",
];

@Injectable()
export class SystemContextService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot() {
    const now = new Date();
    const configuredProviders = configuredProviderRuntimes();
    const since24h = new Date(now.getTime() - 24 * 60 * 60_000);
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const [
      inventoryCount,
      activeListings,
      newProducts24h,
      listingTypes,
      sources,
      crawlerJobs,
      aiTasks,
      aiModels,
      aiProviderStates,
      aiCacheEntries,
      marketSummary,
      recentErrors,
      recentUserActivity,
      queues,
    ] = await Promise.all([
      this.prisma.item.count(),
      this.prisma.item.count({
        where: { archivedAt: null, ignored: false, purchaseRecord: null },
      }),
      this.prisma.item.count({ where: { detectedAt: { gte: since24h } } }),
      this.prisma.item.groupBy({
        by: ["listingType"],
        where: { archivedAt: null, ignored: false, purchaseRecord: null },
        _count: { _all: true },
      }),
      this.prisma.source.findMany({
        where: { enabled: true },
        select: {
          key: true,
          displayName: true,
          failureCount: true,
          circuitOpenAt: true,
          updatedAt: true,
        },
        orderBy: { displayName: "asc" },
      }),
      this.prisma.crawlJob.groupBy({
        by: ["status"],
        where: { createdAt: { gte: since24h }, jobType: "search" },
        _count: { _all: true },
      }),
      this.prisma.aiRun.groupBy({
        by: ["task", "status"],
        where: { startedAt: { gte: startOfDay } },
        _count: { _all: true },
      }),
      this.prisma.aiModelState.findMany({
        select: {
          model: true,
          provider: true,
          role: true,
          status: true,
          cooldownUntil: true,
          quotaResetAt: true,
          consecutiveFailures: true,
          lastSuccessAt: true,
          lastFailureAt: true,
          lastErrorCode: true,
        },
        orderBy: { model: "asc" },
      }),
      this.prisma.aiProviderState.findMany({
        select: {
          provider: true,
          status: true,
          cooldownUntil: true,
          quotaResetAt: true,
          remainingRequests: true,
          remainingTokens: true,
          lastErrorCode: true,
          consecutiveFailures: true,
          updatedAt: true,
        },
        orderBy: { provider: "asc" },
      }),
      this.prisma.aiCache.count({
        where: { expiresAt: { gt: now }, provider: { not: null } },
      }),
      Promise.all([
        this.prisma.marketIntel.count({
          where: { detectedAt: { gte: since24h } },
        }),
        this.prisma.keywordInsight.findMany({
          where: { recommended: true },
          orderBy: { lastAnalyzedAt: "desc" },
          take: 8,
        }),
      ]),
      Promise.all([
        this.prisma.crawlJob.findMany({
          where: { status: "failed" },
          select: {
            id: true,
            errorText: true,
            createdAt: true,
            source: { select: { displayName: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 6,
        }),
        this.prisma.aiRun.findMany({
          where: { status: "failed" },
          select: {
            id: true,
            task: true,
            provider: true,
            requestedModel: true,
            attempt: true,
            errorCode: true,
            startedAt: true,
          },
          orderBy: { startedAt: "desc" },
          take: 6,
        }),
      ]),
      Promise.all([
        this.prisma.item.count({
          where: { favorite: true, updatedAt: { gte: since24h } },
        }),
        this.prisma.purchaseRecord.count({
          where: { purchasedAt: { gte: since24h } },
        }),
        this.prisma.discoveryFeedback.groupBy({
          by: ["action"],
          where: { timestamp: { gte: since24h } },
          _count: { _all: true },
        }),
      ]),
      this.queueSnapshot(),
    ]);

    return {
      generatedAt: now.toISOString(),
      inventory: {
        totalListings: inventoryCount,
        activeListings,
        newProducts24h,
        listingTypes: Object.fromEntries(
          listingTypes.map((entry) => [entry.listingType, entry._count._all]),
        ),
      },
      crawlers: {
        jobs24h: Object.fromEntries(
          crawlerJobs.map((entry) => [entry.status, entry._count._all]),
        ),
        sources: sources.map((source) => ({
          ...source,
          healthy:
            source.failureCount === 0 ||
            !source.circuitOpenAt ||
            now.getTime() - source.circuitOpenAt.getTime() > 15 * 60_000,
        })),
      },
      ai: {
        providers: configuredProviders.map((provider) => ({
          id: provider.id,
          label: provider.label,
          tier: provider.apiTier,
        })),
        providerConfigured: configuredProviders.length > 0,
        providerStates: aiProviderStates,
        tasksToday: aiTasks,
        models: aiModels,
        cacheEntries: aiCacheEntries,
      },
      queues,
      market: {
        intel24h: marketSummary[0],
        keywords: marketSummary[1],
      },
      recentErrors: {
        crawler: recentErrors[0],
        ai: recentErrors[1],
      },
      recentUserActivity: {
        favorites24h: recentUserActivity[0],
        purchases24h: recentUserActivity[1],
        discovery: recentUserActivity[2],
      },
    };
  }

  private async queueSnapshot() {
    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      connectTimeout: 2_500,
    });
    const queues: Queue[] = [];
    try {
      await redis.connect();
      for (const name of queueNames)
        queues.push(new Queue(name, { connection: redis }));
      const counts = await Promise.all(
        queues.map(async (queue) => ({
          name: queue.name,
          ...(await queue.getJobCounts(
            "waiting",
            "active",
            "delayed",
            "failed",
            "completed",
          )),
        })),
      );
      return { status: "ok", counts };
    } catch (error) {
      return {
        status: "unavailable",
        error: error instanceof Error ? error.message.slice(0, 160) : "unknown",
        counts: [],
      };
    } finally {
      await Promise.all(
        queues.map((queue) => queue.close().catch(() => undefined)),
      );
      redis.disconnect();
    }
  }
}

export type SystemSnapshot = Awaited<
  ReturnType<SystemContextService["snapshot"]>
>;
