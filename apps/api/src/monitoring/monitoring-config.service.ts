import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
} from "@nestjs/common";
import { Prisma, type MonitoringKeyword } from "@tokusatsu/db";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { PrismaService } from "../prisma.service.js";
import { activeMarketItemWhere } from "../items/active-market-scope.js";
import type {
  CreateMonitoringCategoryDto,
  CreateMonitoringKeywordDto,
  UpdateMonitoringCategoryDto,
  UpdateMonitoringKeywordDto,
} from "./monitoring-config.dto.js";

export const searchableMonitoringSources = [
  "mercari",
  "yahoo_auctions",
  "yahoo_fleamarket",
  "yahoo_shopping",
  "rakuma",
  "surugaya",
  "mandarake",
  "firecrawl_market",
  "apify_ecommerce",
] as const;

const keywordInclude = {
  category: { select: { id: true, name: true, scope: true } },
  _count: { select: { matches: true } },
} satisfies Prisma.MonitoringKeywordInclude;
const categoryInclude = {
  _count: { select: { items: true } },
} satisfies Prisma.MonitoringCategoryInclude;
type DispatchResult = {
  queued: number;
  skipped: number;
  jobIds: string[];
  error?: string;
};

export function normalizeMonitoringKeyword(value: unknown) {
  if (typeof value !== "string") throw new BadRequestException("请输入关键词");
  const keyword = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (
    !keyword ||
    keyword.length > 160 ||
    /[\u0000-\u001f\u007f]/u.test(keyword)
  )
    throw new BadRequestException("关键词需为1至160个字符");
  return { keyword, normalizedKeyword: keyword.toLocaleLowerCase("en-US") };
}

export function monitoringSearchJobId(
  keyword: Pick<MonitoringKeyword, "id" | "updatedAt" | "intervalMinutes">,
  sourceKey: string,
  now = Date.now(),
) {
  const revision = createHash("sha256")
    .update(keyword.updatedAt.toISOString())
    .digest("hex")
    .slice(0, 12);
  const window = Math.floor(now / (keyword.intervalMinutes * 60_000));
  return `monitor-${keyword.id}-${sourceKey}-${revision}-${window}`;
}

function categoryName(value: unknown) {
  const name = typeof value === "string" ? value.normalize("NFKC").trim() : "";
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/u.test(name))
    throw new BadRequestException("分类名称需为1至80个字符");
  return name;
}

function validInterval(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 15 || Number(value) > 1440)
    throw new BadRequestException("监控间隔需为15至1440分钟");
  return Number(value);
}

function publicConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002")
      throw new ConflictException("同名关键词或分类已存在");
    if (error.code === "P2003")
      throw new BadRequestException("关联分类已变更，请刷新后重试");
    if (error.code === "P2034")
      throw new ConflictException("监控配置同时发生变更，请重试");
  }
  throw error;
}

@Injectable()
export class MonitoringConfigService implements OnModuleDestroy {
  private redis?: Redis;
  private searchQueue?: Queue;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleDestroy() {
    await this.searchQueue?.close();
    this.redis?.disconnect();
  }

  private resetDispatchConnection() {
    const queue = this.searchQueue;
    this.searchQueue = undefined;
    this.redis?.disconnect();
    this.redis = undefined;
    void queue?.close().catch(() => undefined);
  }

  async get() {
    const [keywords, categories, platforms, categoryCounts] = await Promise.all(
      [
        this.prisma.monitoringKeyword.findMany({
          include: keywordInclude,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        this.prisma.monitoringCategory.findMany({
          include: categoryInclude,
          orderBy: [{ createdAt: "asc" }, { name: "asc" }],
        }),
        this.prisma.source.findMany({
          where: {
            key: { in: [...searchableMonitoringSources] },
            channel: "online",
            comparisonOnly: false,
          },
          select: { key: true, displayName: true, enabled: true },
          orderBy: { displayName: "asc" },
        }),
        this.prisma.item.groupBy({
          by: ["monitoringCategoryId"],
          where: {
            ...activeMarketItemWhere(),
            monitoringCategoryId: { not: null },
          },
          _count: { _all: true },
        }),
      ],
    );
    const latestRuns = await this.prisma.$queryRaw<
      {
        keywordId: string;
        status: string;
        startedAt: Date | null;
        finishedAt: Date | null;
        errorText: string | null;
      }[]
    >(Prisma.sql`
      SELECT DISTINCT ON ("query"->>'monitoringKeywordId')
        "query"->>'monitoringKeywordId' AS "keywordId", "status"::text AS "status", "startedAt", "finishedAt", "errorText"
      FROM "CrawlJob"
      WHERE "jobType"='search' AND "query"->>'monitoringKeywordId' IS NOT NULL
      ORDER BY "query"->>'monitoringKeywordId', "createdAt" DESC, "id" DESC
    `);
    const byKeyword = new Map(latestRuns.map((run) => [run.keywordId, run]));
    const countByCategory = new Map(
      categoryCounts.map((row) => [row.monitoringCategoryId, row._count._all]),
    );
    const categoryTotals = categories.map((category) => {
      const descendants = new Set([category.id]);
      for (let depth = 0; depth < 8; depth += 1) {
        const before = descendants.size;
        for (const child of categories)
          if (child.parentId && descendants.has(child.parentId))
            descendants.add(child.id);
        if (before === descendants.size) break;
      }
      const activeItems = [...descendants].reduce(
        (total, id) => total + (countByCategory.get(id) ?? 0),
        0,
      );
      return { ...category, activeItems, activeItemCount: activeItems };
    });
    return {
      keywords: keywords.map((keyword) => {
        const run = byKeyword.get(keyword.id);
        return {
          ...keyword,
          lastRunAt: run?.finishedAt ?? run?.startedAt ?? null,
          lastRunStatus: run?.status ?? null,
          lastRunError:
            run?.status === "failed" ? "最近扫描未完成，可重试" : null,
        };
      }),
      categories: categoryTotals,
      platforms,
    };
  }

  private async requireAccount(id: string) {
    if (
      !id ||
      !(await this.prisma.managerAccount.findFirst({
        where: { id, active: true },
        select: { id: true },
      }))
    )
      throw new BadRequestException("管理者账号无效");
  }

  private async requireCategory(
    id: string,
    store: Prisma.TransactionClient = this.prisma,
  ) {
    const category = await store.monitoringCategory.findUnique({
      where: { id },
    });
    if (!category) throw new NotFoundException("分类不存在");
    return category;
  }

  private async validateParent(
    parentId: string | null,
    id?: string,
    scope?: string,
    store: Prisma.TransactionClient = this.prisma,
  ) {
    let cursor = parentId;
    let depth = 0;
    while (cursor) {
      if (cursor === id || ++depth > 8)
        throw new BadRequestException("分类层级不能循环或超过8层");
      const parent = await this.requireCategory(cursor, store);
      if (scope && parent.scope !== scope)
        throw new BadRequestException("子分类需与上级分类范围一致");
      cursor = parent.parentId;
    }
  }

  async createCategory(body: CreateMonitoringCategoryDto) {
    await this.requireAccount(body.accountId);
    const parentId = body.parentId ?? null;
    const parent = parentId ? await this.requireCategory(parentId) : null;
    const scope = body.scope ?? parent?.scope ?? "general";
    if (!["toys", "general"].includes(scope))
      throw new BadRequestException("分类范围无效");
    await this.validateParent(parentId, undefined, scope);
    try {
      return await this.prisma.monitoringCategory.create({
        data: { name: categoryName(body.name), parentId, scope },
        include: categoryInclude,
      });
    } catch (error) {
      publicConflict(error);
    }
  }

  async updateCategory(id: string, body: UpdateMonitoringCategoryDto) {
    await this.requireAccount(body.accountId);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const current = await this.requireCategory(id, tx);
          const parentId =
            body.parentId === undefined ? current.parentId : body.parentId;
          const scope = body.scope ?? current.scope;
          if (!["toys", "general"].includes(scope))
            throw new BadRequestException("分类范围无效");
          await this.validateParent(parentId, id, scope, tx);
          if (
            scope !== current.scope &&
            (await tx.monitoringCategory.count({
              where: { parentId: id, scope: { not: scope } },
            }))
          )
            throw new BadRequestException("请先调整子分类范围");
          return tx.monitoringCategory.update({
            where: { id },
            data: {
              ...(body.name !== undefined
                ? { name: categoryName(body.name) }
                : {}),
              parentId,
              scope,
            },
            include: categoryInclude,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      publicConflict(error);
    }
  }

  private async validateSources(value: unknown) {
    if (
      !Array.isArray(value) ||
      value.length > 12 ||
      value.some(
        (key) =>
          typeof key !== "string" ||
          !(searchableMonitoringSources as readonly string[]).includes(key),
      )
    )
      throw new BadRequestException("请选择可搜索的线上平台");
    const sourceKeys = [...new Set(value as string[])];
    if (sourceKeys.length) {
      const found = await this.prisma.source.count({
        where: {
          key: { in: sourceKeys },
          channel: "online",
          comparisonOnly: false,
        },
      });
      if (found !== sourceKeys.length)
        throw new BadRequestException("所选平台不存在或仅支持比价");
    }
    return sourceKeys;
  }

  async createKeyword(body: CreateMonitoringKeywordDto) {
    await this.requireAccount(body.accountId);
    await this.requireCategory(body.categoryId);
    const names = normalizeMonitoringKeyword(body.keyword);
    const sourceKeys = await this.validateSources(body.sourceKeys ?? []);
    const intervalMinutes = validInterval(body.intervalMinutes ?? 60);
    if (body.enabled !== undefined && typeof body.enabled !== "boolean")
      throw new BadRequestException("启用状态无效");
    let keyword;
    try {
      keyword = await this.prisma.monitoringKeyword.create({
        data: {
          ...names,
          categoryId: body.categoryId,
          enabled: body.enabled ?? true,
          intervalMinutes,
          sourceKeys,
        },
        include: keywordInclude,
      });
    } catch (error) {
      publicConflict(error);
    }
    return { keyword, movedItems: 0, dispatch: await this.enqueue([keyword]) };
  }

  async updateKeyword(id: string, body: UpdateMonitoringKeywordDto) {
    await this.requireAccount(body.accountId);
    const sourceKeys =
      body.sourceKeys === undefined
        ? undefined
        : await this.validateSources(body.sourceKeys);
    const intervalMinutes =
      body.intervalMinutes === undefined
        ? undefined
        : validInterval(body.intervalMinutes);
    const names =
      body.keyword === undefined
        ? {}
        : normalizeMonitoringKeyword(body.keyword);
    if (body.enabled !== undefined && typeof body.enabled !== "boolean")
      throw new BadRequestException("启用状态无效");
    let result;
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          const current = await tx.monitoringKeyword.findUnique({
            where: { id },
          });
          if (!current) throw new NotFoundException("关键词不存在");
          if (body.categoryId !== undefined)
            await this.requireCategory(body.categoryId, tx);
          const keyword = await tx.monitoringKeyword.update({
            where: { id },
            data: {
              ...names,
              ...(body.categoryId !== undefined
                ? { categoryId: body.categoryId }
                : {}),
              ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
              ...(intervalMinutes !== undefined ? { intervalMinutes } : {}),
              ...(sourceKeys !== undefined ? { sourceKeys } : {}),
            },
            include: keywordInclude,
          });
          let movedItems = 0;
          if (keyword.categoryId !== current.categoryId) {
            const items = await tx.item.findMany({
              where: {
                monitoringKeywordMatches: { some: { keywordId: id } },
                OR: [
                  { monitoringCategoryId: null },
                  { monitoringCategoryId: { not: keyword.categoryId } },
                ],
              },
              select: { id: true, monitoringCategoryId: true },
            });
            movedItems = await this.moveMatchedItems(
              tx,
              items,
              body.accountId,
              "monitoring_keyword_target_changed",
            );
          }
          return { keyword, movedItems };
        },
        {
          timeout: 60_000,
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error) {
      publicConflict(error);
    }
    return { ...result, dispatch: await this.enqueue([result.keyword]) };
  }

  private async auditCategoryMoves(
    tx: Prisma.TransactionClient,
    items: { id: string; monitoringCategoryId: string | null }[],
    categoryId: string,
    actor: string,
    reason: string,
  ) {
    for (let offset = 0; offset < items.length; offset += 500) {
      await tx.manualReview.createMany({
        data: items.slice(offset, offset + 500).map((item) => ({
          itemId: item.id,
          actor,
          reason,
          beforeData: { monitoringCategoryId: item.monitoringCategoryId },
          afterData: { monitoringCategoryId: categoryId },
        })),
      });
    }
  }

  private async moveMatchedItems(
    tx: Prisma.TransactionClient,
    items: { id: string; monitoringCategoryId: string | null }[],
    actor: string,
    reason: string,
  ) {
    let moved = 0;
    for (let offset = 0; offset < items.length; offset += 500) {
      const batch = items.slice(offset, offset + 500);
      const matches = await tx.monitoringKeywordMatch.findMany({
        where: {
          itemId: { in: batch.map((item) => item.id) },
          keyword: { enabled: true },
        },
        select: { itemId: true, keyword: { select: { categoryId: true } } },
        orderBy: [{ keyword: { updatedAt: "desc" } }, { keywordId: "asc" }],
      });
      const winner = new Map<string, string>();
      for (const match of matches)
        if (!winner.has(match.itemId))
          winner.set(match.itemId, match.keyword.categoryId);
      const groups = new Map<string, typeof batch>();
      for (const item of batch) {
        const target = winner.get(item.id);
        if (!target || item.monitoringCategoryId === target) continue;
        const group = groups.get(target) ?? [];
        group.push(item);
        groups.set(target, group);
      }
      for (const [categoryId, changing] of groups) {
        const result = await tx.item.updateMany({
          where: { id: { in: changing.map((item) => item.id) } },
          data: { monitoringCategoryId: categoryId },
        });
        moved += result.count;
        await this.auditCategoryMoves(tx, changing, categoryId, actor, reason);
      }
    }
    return moved;
  }

  async reindex(id: string, accountId: string) {
    await this.requireAccount(accountId);
    return this.prisma.$transaction(
      async (tx) => {
        const keyword = await tx.monitoringKeyword.findUnique({
          where: { id },
        });
        if (!keyword) throw new NotFoundException("关键词不存在");
        const tokens = keyword.keyword
          .split(/\s+/u)
          .filter(Boolean)
          .map((token) => token.replace(/[\\%_]/g, "\\$&"));
        let matched = 0;
        let moved = 0;
        let cursor: string | undefined;
        const activeWhere = activeMarketItemWhere();
        for (;;) {
          const items = await tx.item.findMany({
            where: {
              ...activeWhere,
              ...(keyword.sourceKeys.length
                ? { source: { key: { in: keyword.sourceKeys } } }
                : {}),
              ...(cursor ? { id: { gt: cursor } } : {}),
              AND: [
                ...(Array.isArray(activeWhere.AND)
                  ? activeWhere.AND
                  : activeWhere.AND
                    ? [activeWhere.AND]
                    : []),
                ...tokens.map((token) => ({
                  OR: [
                    {
                      titleRaw: {
                        contains: token,
                        mode: "insensitive" as const,
                      },
                    },
                    {
                      descriptionRaw: {
                        contains: token,
                        mode: "insensitive" as const,
                      },
                    },
                  ],
                })),
              ],
            },
            select: { id: true, monitoringCategoryId: true },
            orderBy: { id: "asc" },
            take: 500,
          });
          if (!items.length) break;
          cursor = items.at(-1)!.id;
          matched += items.length;
          await tx.monitoringKeywordMatch.createMany({
            data: items.map((item) => ({
              itemId: item.id,
              keywordId: id,
              matchedKeyword: keyword.keyword,
            })),
            skipDuplicates: true,
          });
          moved += await this.moveMatchedItems(
            tx,
            items,
            accountId,
            "monitoring_keyword_reindex",
          );
        }
        return { matched, moved };
      },
      {
        timeout: 60_000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  async run(id: string, accountId: string) {
    await this.requireAccount(accountId);
    const keyword = await this.prisma.monitoringKeyword.findUnique({
      where: { id },
    });
    if (!keyword) throw new NotFoundException("关键词不存在");
    return this.enqueue([keyword]);
  }

  async refresh(accountId: string) {
    await this.requireAccount(accountId);
    const keywords = await this.prisma.monitoringKeyword.findMany({
      where: { enabled: true },
    });
    return this.enqueue(keywords);
  }

  private queue() {
    if (!this.searchQueue) {
      this.redis = new Redis(
        process.env.REDIS_URL ?? "redis://localhost:6379",
        {
          maxRetriesPerRequest: 1,
          connectTimeout: 3000,
          commandTimeout: 5000,
          retryStrategy: () => null,
        },
      );
      this.searchQueue = new Queue("source-search", { connection: this.redis });
    }
    return this.searchQueue;
  }

  private async enqueue(
    keywords: MonitoringKeyword[],
  ): Promise<DispatchResult> {
    const result: DispatchResult = { queued: 0, skipped: 0, jobIds: [] };
    const active = keywords.filter((keyword) => keyword.enabled);
    result.skipped += keywords.length - active.length;
    if (!active.length) return result;
    const sources = await this.prisma.source.findMany({
      where: {
        enabled: true,
        channel: "online",
        comparisonOnly: false,
        key: { in: [...searchableMonitoringSources] },
      },
      select: { key: true },
    });
    let pendingPairs: Set<string>;
    try {
      const pending = sources.length
        ? await this.queue().getJobs(
            ["waiting", "delayed", "prioritized", "active"],
            0,
            -1,
          )
        : [];
      pendingPairs = new Set(
        pending
          .filter(
            (job) => job.data?.monitoringKeywordId && job.data?.adapterKey,
          )
          .map(
            (job) => `${job.data.monitoringKeywordId}|${job.data.adapterKey}`,
          ),
      );
    } catch {
      this.resetDispatchConnection();
      result.error = "配置已保存，监控调度暂不可用";
      return result;
    }
    for (const keyword of active) {
      const selected = sources.filter(
        (source) =>
          !keyword.sourceKeys.length || keyword.sourceKeys.includes(source.key),
      );
      if (!selected.length) result.skipped += 1;
      for (const source of selected) {
        const pair = `${keyword.id}|${source.key}`;
        if (pendingPairs.has(pair)) {
          result.skipped += 1;
          continue;
        }
        const jobId = monitoringSearchJobId(keyword, source.key);
        try {
          const queue = this.queue();
          const existing = await queue.getJob(jobId);
          if (existing && (await existing.getState()) === "failed")
            await existing.remove();
          else if (existing) {
            result.skipped += 1;
            continue;
          }
          const job = await queue.add(
            "search",
            {
              adapterKey: source.key,
              monitoringKeywordId: keyword.id,
              query: {
                keyword: keyword.keyword,
                limit: 100,
                scanMode: "incremental",
                highPriority: true,
              },
            },
            {
              jobId,
              priority: 1,
              attempts: 4,
              backoff: { type: "exponential", delay: 30_000 },
              removeOnComplete: 1000,
              removeOnFail: 1000,
            },
          );
          // Start cadence from this actual dispatch, not the next wall-clock
          // bucket. The worker shares this durable Redis key.
          const revision = createHash("sha256")
            .update(keyword.updatedAt.toISOString())
            .digest("hex")
            .slice(0, 12);
          await this.redis!.set(
            `monitor-cadence-${keyword.id}-${source.key}-${revision}`,
            "scheduled",
            "PX",
            keyword.intervalMinutes * 60_000,
          );
          result.queued += 1;
          result.jobIds.push(String(job.id));
          pendingPairs.add(pair);
        } catch {
          this.resetDispatchConnection();
          result.error = "配置已保存，监控调度暂不可用";
          return result;
        }
      }
    }
    return result;
  }
}
