import { Injectable } from "@nestjs/common";
import type { Prisma } from "@tokusatsu/db";
import { PrismaService } from "../prisma.service.js";

type CrawlMetrics = {
  candidates?: number;
  inserted?: number;
  skippedKnown?: number;
  detailFailed?: number;
  scanMode?: string;
  pageStart?: number;
  pages?: number;
};

const sourceLabels: Record<string, string> = {
  mandarake: "日本中古店",
  mercari: "日本二手市场",
  yahoo_auctions: "日本拍卖市场",
  firecrawl_market: "自动适配来源",
  mock: "本地测试来源",
};

function metricsOf(value: Prisma.JsonValue | null): CrawlMetrics {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return value as CrawlMetrics;
}

@Injectable()
export class MonitoringService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [jobs, sources, itemTotal, activeTotal, discovered24h] =
      await this.prisma.$transaction([
        this.prisma.crawlJob.findMany({
          where: { jobType: "search", createdAt: { gte: since } },
          include: {
            source: { select: { key: true, displayName: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
        this.prisma.source.findMany({
          where: { enabled: true },
          select: {
            key: true,
            displayName: true,
            circuitOpenAt: true,
            failureCount: true,
            _count: { select: { items: true } },
          },
          orderBy: { displayName: "asc" },
        }),
        this.prisma.item.count(),
        this.prisma.item.count({ where: { status: "active" } }),
        this.prisma.item.count({ where: { detectedAt: { gte: since } } }),
      ]);
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
      sourceName: sourceLabels[job.source?.key ?? ""] ?? "自动适配来源",
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
      serverTime: new Date().toISOString(),
      lastScan,
      lastDiscovery,
      itemTotal,
      activeTotal,
      discovered24h,
      totals24h: totals,
      sources: sources.map((source) => ({
        key: source.key,
        displayName: sourceLabels[source.key] ?? "自动适配来源",
        itemCount: source._count.items,
        failureCount: source.failureCount,
        circuitOpenAt: source.circuitOpenAt,
      })),
      recent,
    };
  }
}
