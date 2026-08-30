import { Injectable, NotFoundException } from "@nestjs/common";
import { MarketIntelKind, Prisma } from "@tokusatsu/db";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { PrismaService } from "../prisma.service.js";

@Injectable()
export class MarketIntelService {
  constructor(private readonly prisma: PrismaService) {}

  async list(input: {
    page: number;
    limit: number;
    kind?: string;
    search?: string;
  }) {
    const page = Number.isFinite(input.page)
      ? Math.max(1, Math.floor(input.page))
      : 1;
    const limit = Number.isFinite(input.limit)
      ? Math.max(1, Math.min(100, Math.floor(input.limit)))
      : 30;
    const where: Prisma.MarketIntelWhereInput = {};
    if (["news", "forum", "post"].includes(input.kind ?? "")) {
      where.kind = input.kind as MarketIntelKind;
    }
    if (input.search?.trim()) {
      const query = input.search.trim();
      where.OR = [
        { titleRaw: { contains: query, mode: "insensitive" } },
        { bodyRaw: { contains: query, mode: "insensitive" } },
        { titleZh: { contains: query, mode: "insensitive" } },
        { bodyZh: { contains: query, mode: "insensitive" } },
        { author: { contains: query, mode: "insensitive" } },
        { sourceName: { contains: query, mode: "insensitive" } },
      ];
    }
    const [items, total, news, forum, post, latest] =
      await this.prisma.$transaction([
        this.prisma.marketIntel.findMany({
          where,
          orderBy: [{ publishedAt: "desc" }, { detectedAt: "desc" }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.marketIntel.count({ where }),
        this.prisma.marketIntel.count({
          where: { ...where, kind: MarketIntelKind.news },
        }),
        this.prisma.marketIntel.count({
          where: { ...where, kind: MarketIntelKind.forum },
        }),
        this.prisma.marketIntel.count({
          where: { ...where, kind: MarketIntelKind.post },
        }),
        this.prisma.marketIntel.findFirst({
          orderBy: { detectedAt: "desc" },
          select: { detectedAt: true },
        }),
      ]);
    return {
      items,
      total,
      facets: { news, forum, post },
      page,
      pageCount: Math.max(1, Math.ceil(total / limit)),
      lastUpdatedAt: latest?.detectedAt ?? null,
      serverTime: new Date().toISOString(),
    };
  }

  async get(id: string) {
    const item = await this.prisma.marketIntel.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("Market intelligence not found");
    return { item, serverTime: new Date().toISOString() };
  }

  async refresh() {
    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
    const queue = new Queue("market-intel-refresh", { connection: redis });
    const job = await queue.add(
      "manual-market-intel-refresh",
      { requestedAt: new Date().toISOString() },
      {
        jobId: `intel-manual-${Date.now()}`,
        removeOnComplete: 50,
        removeOnFail: 50,
      },
    );
    await queue.close();
    await redis.quit();
    return { accepted: true, jobId: String(job.id), message: "资讯刷新已排队" };
  }
}
