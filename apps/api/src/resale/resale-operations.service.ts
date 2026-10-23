import { randomUUID } from "node:crypto";
import {
  Optional,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { XianyuSessionService } from "./xianyu-session.service.js";
import { PrismaService } from "../prisma.service.js";
import { ResalePublisher } from "./resale-publisher.js";
import type {
  ResaleMonitorDto,
  ResaleObservationDto,
  ResaleMetricDto,
  ResaleTaskDto,
  ResaleTaskResultDto,
} from "./resale.dto.js";
import {
  matchesMonitor,
  parseMarketObservation,
  metricDelta,
  csvCell,
} from "./resale-operations.policy.js";
import { chinaDayStart, sourceBlockReason } from "./resale.policy.js";

@Injectable()
export class ResaleOperationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResaleOperationsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;
  constructor(
    private readonly db: PrismaService,
    private readonly publisher: ResalePublisher,
    @Optional() private readonly session?: XianyuSessionService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick().catch(() =>
        this.logger.warn("闲鱼运营任务失败，请检查数据库和渠道连接"),
      );
    }, 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    this.stopped = true;
    clearInterval(this.timer);
  }
  private async actor(id: string) {
    if (
      !(await this.db.managerAccount.findFirst({ where: { id, active: true } }))
    )
      throw new BadRequestException("管理者账号无效");
  }
  private async audit(
    accountId: string,
    action: string,
    detail: string,
    listingId?: string,
  ) {
    await this.db.resaleEvent.create({
      data: { accountId, action, detail, listingId },
    });
  }
  private searchConfig() {
    const ownUrl = process.env.RESALE_MARKET_SEARCH_URL?.trim();
    const raw = ownUrl || process.env.XIANYU_SEARCH_API_URL;
    try {
      const url = new URL(raw ?? "");
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return null;
      return {
        url,
        token: ownUrl
          ? process.env.RESALE_MARKET_SEARCH_TOKEN
          : process.env.XIANYU_SEARCH_API_TOKEN,
      };
    } catch {
      return null;
    }
  }
  async overview() {
    const [monitors, discoveries, unread, tasks, published, metricCount] =
      await Promise.all([
        this.db.resaleMonitor.findMany({
          orderBy: { createdAt: "desc" },
          take: 100,
          include: { _count: { select: { observations: true } } },
        }),
        this.db.resaleMarketObservation.findMany({
          orderBy: { discoveredAt: "desc" },
          take: 50,
          include: { monitor: { select: { keyword: true } } },
        }),
        this.db.resaleMarketObservation.count({ where: { readAt: null } }),
        this.db.resaleSellerTask.findMany({
          orderBy: { createdAt: "desc" },
          take: 100,
          include: { listing: { select: { title: true } } },
        }),
        this.db.resaleListing.count({ where: { status: "published" } }),
        this.db.resaleMetricSnapshot.count(),
      ]);
    const session = this.session?.configured ? await this.session.status() : null;
    return {
      monitors,
      discoveries,
      unread,
      tasks,
      published,
      metricCount,
      capabilities: {
        searchConfigured: Boolean(this.searchConfig()),
        searchReady: Boolean(this.searchConfig()) && (!session || session.capabilities.search),
        sessionState: session?.state ?? null,
        sellerActions: this.publisher.capability.sellerActions,
        publishing: this.publisher.capability.configured,
      },
      integrations: {
        titleSkill: {
          name: "@user_a41ae6c8/xianyu-title-generator",
          version: "4.0.0",
          mode: "adapted_prompt",
        },
        monitor: { source: "voltwake/xianyu-monitor", mode: "adapted_filters" },
      },
    };
  }
  async saveMonitor(body: ResaleMonitorDto) {
    await this.actor(body.accountId);
    if (body.maxPriceCny < body.minPriceCny)
      throw new BadRequestException("价格上限不能低于下限");
    const { accountId, id, ...data } = body;
    const monitor = await this.db.$transaction(async (tx) => {
      // Serialise the task cap and edits against scanner claims.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(610091600)`;
      if (id) {
        await tx.$queryRaw`SELECT id FROM resale_monitors WHERE id = ${id} FOR UPDATE`;
        const current = await tx.resaleMonitor.findUnique({ where: { id } });
        if (!current) throw new NotFoundException("监测任务不存在");
        if (current.leaseUntil && current.leaseUntil > new Date())
          throw new ConflictException("扫描进行中，结束后再修改");
        return tx.resaleMonitor.update({
          where: { id },
          data: { ...data, nextScanAt: new Date(), lastError: null },
        });
      }
      if ((await tx.resaleMonitor.count()) >= 100)
        throw new BadRequestException("最多保存100个监测任务");
      return tx.resaleMonitor.create({
        data: { ...data, nextScanAt: new Date() },
      });
    });
    await this.audit(
      accountId,
      "monitor_settings",
      `已保存闲鱼监测：${monitor.keyword}`,
    );
    return { monitor };
  }
  private async ingestRows(monitorId: string, items: unknown[]) {
    const monitor = await this.db.resaleMonitor.findUnique({
      where: { id: monitorId },
    });
    if (!monitor) throw new NotFoundException("监测任务不存在");
    let discovered = 0,
      updated = 0,
      rejected = 0;
    const seen = new Set<string>();
    for (const value of items.slice(0, 100)) {
      const row = parseMarketObservation(value);
      if (!row || !matchesMonitor(row, monitor)) {
        rejected++;
        continue;
      }
      if (seen.has(row.targetItemId)) continue;
      seen.add(row.targetItemId);
      const inserted = await this.db.resaleMarketObservation.createMany({
        data: [{ ...row, monitorId }],
        skipDuplicates: true,
      });
      if (inserted.count) discovered++;
      else {
        await this.db.resaleMarketObservation.update({
          where: {
            monitorId_targetItemId: {
              monitorId,
              targetItemId: row.targetItemId,
            },
          },
          data: { ...row, lastSeenAt: new Date() },
        });
        updated++;
      }
    }
    return { discovered, updated, rejected };
  }
  async ingest(monitorId: string, body: ResaleObservationDto) {
    await this.actor(body.accountId);
    const result = await this.ingestRows(monitorId, body.items);
    await this.audit(
      body.accountId,
      "monitor_import",
      `导入监测结果：新增${result.discovered}，更新${result.updated}，过滤${result.rejected}`,
    );
    return result;
  }
  async markRead(accountId: string) {
    await this.actor(accountId);
    await this.db.resaleMarketObservation.updateMany({
      where: { readAt: null },
      data: { readAt: new Date() },
    });
    return { message: "已标记当前发现为已读" };
  }
  async scan(id: string, accountId?: string) {
    if (accountId) await this.actor(accountId);
    if (this.session?.configured) await this.session.assertCapability("search");
    const config = this.searchConfig();
    if (!config)
      throw new BadRequestException("闲鱼搜索连接未配置，可先导入监测结果");
    const now = new Date(),
      token = randomUUID();
    const monitor = await this.db.$transaction(async (tx) => {
      if (!accountId) {
        await tx.$queryRaw`SELECT id FROM resale_settings WHERE id = 'default' FOR UPDATE`;
        const settings = await tx.resaleSettings.findUnique({
          where: { id: "default" },
        });
        if (!settings || settings.paused)
          throw new ConflictException("自动任务已暂停");
      }
      const claim = await tx.resaleMonitor.updateMany({
        where: {
          id,
          AND: [
            { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
            ...(!accountId
              ? [
                  {
                    active: true,
                    OR: [{ nextScanAt: null }, { nextScanAt: { lte: now } }],
                  },
                ]
              : []),
          ],
        },
        data: { leaseToken: token, leaseUntil: new Date(Date.now() + 90_000) },
      });
      if (!claim.count)
        throw new ConflictException("任务已在扫描、暂停或尚未到扫描时间");
      return (await tx.resaleMonitor.findUnique({ where: { id } }))!;
    });
    try {
      const response = await fetch(config.url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(25_000),
        headers: {
          "content-type": "application/json",
          ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
        },
        body: JSON.stringify({
          keyword: monitor.keyword,
          limit: 50,
          maxItems: 50,
        }),
      });
      if ([401, 403, 409, 429].includes(response.status)) {
        await this.db.resaleMonitor.updateMany({
          where: { id, leaseToken: token },
          data: { active: false },
        });
        throw new Error(
          "搜索服务需要登录、验证或已限流，监测已停止，请在连接端处理",
        );
      }
      if (!response.ok) throw new Error("搜索服务请求失败");
      const data = (await response.json()) as
        | Record<string, unknown>
        | unknown[]
        | null;
      if (!data || typeof data !== "object")
        throw new Error("搜索服务返回格式无效");
      const root = Array.isArray(data) ? { items: data } : data;
      if (
        root.blocked === true ||
        root.requiresLogin === true ||
        /captcha|verify|login_required|risk_control/i.test(
          String(root.status ?? ""),
        )
      ) {
        await this.db.resaleMonitor.updateMany({
          where: { id, leaseToken: token },
          data: { active: false },
        });
        throw new Error("搜索服务要求人工验证，监测已停止");
      }
      const nested =
        root.data && typeof root.data === "object"
          ? (root.data as Record<string, unknown>)
          : undefined;
      if (nested?.blocked === true || nested?.requiresLogin === true) {
        await this.db.resaleMonitor.updateMany({
          where: { id, leaseToken: token },
          data: { active: false },
        });
        throw new Error("搜索服务要求人工验证，监测已停止");
      }
      const items =
        root.items ?? root.results ?? nested?.items ?? nested?.results;
      if (!Array.isArray(items))
        throw new Error("搜索服务没有返回商品列表，无法当作零结果");
      const result = await this.ingestRows(id, items);
      await this.db.resaleMonitor.updateMany({
        where: { id, leaseToken: token },
        data: {
          lastScanAt: new Date(),
          nextScanAt: new Date(Date.now() + monitor.intervalMinutes * 60_000),
          lastError: null,
        },
      });
      return result;
    } catch (error) {
      await this.db.resaleMonitor.updateMany({
        where: { id, leaseToken: token },
        data: {
          nextScanAt: new Date(Date.now() + monitor.intervalMinutes * 60_000),
          lastError: error instanceof Error ? error.message : "扫描失败",
        },
      });
      throw error;
    } finally {
      await this.db.resaleMonitor.updateMany({
        where: { id, leaseToken: token },
        data: { leaseUntil: null, leaseToken: null },
      });
    }
  }
  async saveMetric(body: ResaleMetricDto, origin = "manual") {
    await this.actor(body.accountId);
    const row = await this.db.resaleListing.findUnique({
      where: { id: body.listingId },
    });
    if (!row?.targetItemId)
      throw new BadRequestException("先回填闲鱼商品，再记录实际运营数据");
    const observedAt = new Date(body.observedAt);
    if (
      !Number.isFinite(observedAt.getTime()) ||
      observedAt.getTime() > Date.now() + 300_000
    )
      throw new BadRequestException("观测时间无效或位于未来");
    const values = [body.views, body.wants, body.orders, body.revenueCny];
    if (values.every((value) => value == null))
      throw new BadRequestException("至少填写一项真实指标，未知项留空");
    if (
      values.some(
        (value) =>
          value != null &&
          (!Number.isFinite(value) || value < 0 || value > 1000000000),
      )
    )
      throw new BadRequestException("指标数值无效");
    if (
      [body.views, body.wants, body.orders].some(
        (value) => value != null && !Number.isInteger(value),
      )
    )
      throw new BadRequestException("浏览、想要和订单必须是整数");
    const { accountId, ...data } = body;
    const snapshot = await this.db.resaleMetricSnapshot.create({
      data: { ...data, targetItemId: row.targetItemId, observedAt, origin },
    });
    await this.audit(
      accountId,
      "metrics_record",
      `已记录${origin === "manual" ? "人工核实" : "连接端回传"}运营指标`,
      row.id,
    );
    return { snapshot };
  }
  async syncMetric(listingId: string, accountId?: string) {
    if (accountId) await this.actor(accountId);
    const row = await this.db.resaleListing.findUnique({
      where: { id: listingId },
    });
    if (!row?.targetItemId || row.status !== "published")
      throw new BadRequestException("只有已发布商品可以同步指标");
    if (!accountId) {
      const settings = await this.db.resaleSettings.findUnique({
        where: { id: "default" },
      });
      if (
        !settings ||
        settings.paused ||
        !settings.autoMetrics ||
        row.humanControl
      )
        return;
    }
    await this.db.resaleListing.updateMany({
      where: { id: listingId, targetItemId: row.targetItemId },
      data: { metricsCheckedAt: new Date() },
    });
    try {
      const data = await this.publisher.pullMetrics(row.targetItemId);
      return await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM resale_listings WHERE id = ${listingId} FOR UPDATE`;
        const current = await tx.resaleListing.findUnique({
          where: { id: listingId },
        });
        if (current?.targetItemId !== row.targetItemId)
          throw new ConflictException("闲鱼商品已变化，未写入旧商品数据");
        const snapshot = await tx.resaleMetricSnapshot.upsert({
          where: {
            listingId_observedAt: { listingId, observedAt: data.observedAt },
          },
          create: {
            listingId,
            targetItemId: row.targetItemId!,
            ...data,
            origin: "bridge",
          },
          update: {},
        });
        await tx.resaleListing.update({
          where: { id: listingId },
          data: { metricsError: null },
        });
        return { snapshot };
      });
    } catch (error) {
      const detail = "运营指标同步失败，请检查连接端数据与授权";
      await this.db.resaleListing.updateMany({
        where: { id: listingId, targetItemId: row.targetItemId },
        data: { metricsError: detail },
      });
      this.logger.warn(detail);
      throw error;
    }
  }
  async metrics(days = 7) {
    const from = new Date(Date.now() - days * 86_400_000);
    const listings = await this.db.resaleListing.findMany({
      where: { targetItemId: { not: null } },
      select: {
        id: true,
        targetItemId: true,
        title: true,
        status: true,
        priceCny: true,
        metricsError: true,
        metricsCheckedAt: true,
      },
    });
    const snapshots = await this.db.resaleMetricSnapshot.findMany({
      orderBy: { observedAt: "desc" },
      distinct: ["listingId", "targetItemId"],
    });
    const newest = new Map(
      snapshots.map((snapshot) => [
        `${snapshot.listingId}:${snapshot.targetItemId}`,
        snapshot,
      ]),
    );
    const recent = await this.db.resaleMetricSnapshot.findMany({
      where: { observedAt: { gte: from } },
      orderBy: { observedAt: "desc" },
      take: 5001,
    });
    const truncated = recent.length > 5000;
    const samples = recent.slice(0, 5000).reverse();
    const keys = ["views", "wants", "orders", "revenueCny"] as const;
    const totals = Object.fromEntries(
      keys.map((key) => {
        const known = listings
          .map((row) => newest.get(`${row.id}:${row.targetItemId}`)?.[key])
          .filter((value): value is number => typeof value === "number");
        return [
          key,
          {
            value: known.length
              ? known.reduce((sum, value) => sum + value, 0)
              : null,
            coverage: known.length,
          },
        ];
      }),
    );
    const series: {
      day: string;
      recorded: number;
      views: number | null;
      wants: number | null;
      orders: number | null;
      revenueCny: number | null;
    }[] = [];
    for (let offset = days - 1; offset >= 0; offset--) {
      const day = new Date(Date.now() - offset * 86_400_000).toLocaleDateString(
        "sv-SE",
        { timeZone: "Asia/Shanghai" },
      );
      const latest = new Map<string, (typeof samples)[number]>();
      for (const sample of samples)
        if (
          sample.observedAt.toLocaleDateString("sv-SE", {
            timeZone: "Asia/Shanghai",
          }) === day
        )
          latest.set(sample.listingId, sample);
      const values = Object.fromEntries(
        keys.map((key) => {
          const known = [...latest.values()]
            .map((row) => row[key])
            .filter((value): value is number => value !== null);
          return [
            key,
            known.length ? known.reduce((sum, value) => sum + value, 0) : null,
          ];
        }),
      ) as Pick<(typeof series)[number], (typeof keys)[number]>;
      series.push({ day, recorded: latest.size, ...values });
    }
    return {
      days,
      listingCount: listings.length,
      totals,
      series,
      truncated,
      listings: listings.map((row) => {
        const history = samples.filter(
          (sample) =>
            sample.listingId === row.id &&
            sample.targetItemId === row.targetItemId,
        );
        const first = history[0],
          last = history.at(-1);
        return {
          ...row,
          latest: newest.get(`${row.id}:${row.targetItemId}`) ?? null,
          periodChange: Object.fromEntries(
            keys.map((key) => [
              key,
              history.length >= 2 ? metricDelta(first![key], last![key]) : null,
            ]),
          ),
        };
      }),
    };
  }
  async csv(days: number) {
    const rows = await this.db.resaleMetricSnapshot.findMany({
      where: { observedAt: { gte: new Date(Date.now() - days * 86_400_000) } },
      orderBy: { observedAt: "desc" },
      take: 5000,
      include: { listing: { select: { title: true, targetItemId: true } } },
    });
    return (
      "\ufeff" +
      [
        [
          "闲鱼商品ID",
          "商品标题",
          "观测时间",
          "浏览量",
          "想要数",
          "订单数",
          "累计收入人民币",
          "来源",
        ],
        ...rows.map((row) => [
          row.targetItemId,
          row.listing.title,
          row.observedAt.toISOString(),
          row.views,
          row.wants,
          row.orders,
          row.revenueCny,
          row.origin,
        ]),
      ]
        .map((row) => row.map(csvCell).join(","))
        .join("\r\n")
    );
  }
  async createTask(body: ResaleTaskDto) {
    await this.actor(body.accountId);
    const scheduledAt = new Date(body.scheduledAt);
    if (
      !Number.isFinite(scheduledAt.getTime()) ||
      scheduledAt.getTime() > Date.now() + 365 * 86_400_000
    )
      throw new BadRequestException("任务时间无效或超过一年");
    if (
      body.kind === "reprice" &&
      !(typeof body.priceCny === "number" && body.priceCny > 0)
    )
      throw new BadRequestException("调价任务需要明确的目标售价");
    const task = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM resale_listings WHERE id = ${body.listingId} FOR UPDATE`;
      const row = await tx.resaleListing.findUnique({
        where: { id: body.listingId },
      });
      if (
        !row ||
        row.version !== body.version ||
        row.status !== "published" ||
        !row.targetItemId
      )
        throw new ConflictException("仅能为当前版本的已发布商品创建任务");
      if (row.requiresWithdrawal)
        throw new BadRequestException("货源不可用，先处理下架");
      if (
        row.humanControl &&
        this.publisher.capability.sellerActions.includes(body.kind)
      )
        throw new BadRequestException(
          "商品已人工接管，交回自动流程后再安排自动维护",
        );
      if (
        await tx.resaleSellerTask.count({
          where: {
            listingId: row.id,
            status: { in: ["queued", "running", "uncertain", "manual"] },
          },
        })
      )
        throw new ConflictException("已有未完成的维护任务，请先核实或取消");
      const day = chinaDayStart(scheduledAt);
      if (
        body.kind === "bump" &&
        (await tx.resaleSellerTask.count({
          where: {
            listingId: row.id,
            kind: "bump",
            status: { notIn: ["cancelled", "failed"] },
            scheduledAt: { gte: day, lt: new Date(day.getTime() + 86_400_000) },
          },
        }))
      )
        throw new BadRequestException(
          "本系统每件商品每天最多安排一次擦亮，不代表平台额度",
        );
      return tx.resaleSellerTask.create({
        data: {
          listingId: row.id,
          listingVersion: row.version,
          targetItemId: row.targetItemId,
          kind: body.kind,
          priceCny: body.kind === "reprice" ? body.priceCny : null,
          scheduledAt,
          accountId: body.accountId,
          status: this.publisher.capability.sellerActions.includes(body.kind)
            ? "queued"
            : "manual",
        },
      });
    });
    await this.audit(
      body.accountId,
      "seller_task",
      `已安排${body.kind === "bump" ? "擦亮" : "调价"}${task.status === "manual" ? "手动维护清单" : "任务"}`,
      body.listingId,
    );
    return { task };
  }
  async resolveTask(id: string, body: ResaleTaskResultDto) {
    await this.actor(body.accountId);
    return this.db.$transaction(async (tx) => {
      const initial = await tx.resaleSellerTask.findUnique({ where: { id } });
      if (!initial) throw new NotFoundException("维护任务不存在");
      await tx.$queryRaw`SELECT id FROM resale_listings WHERE id = ${initial.listingId} FOR UPDATE`;
      const task = await tx.resaleSellerTask.findUnique({ where: { id } });
      if (!task) throw new NotFoundException("维护任务不存在");
      if (task.status === "running")
        throw new ConflictException("请求已发出，请等待回执或超时核实");
      if (
        body.action === "cancel" &&
        !["queued", "manual"].includes(task.status)
      )
        throw new ConflictException("当前任务不能取消");
      if (
        body.action !== "cancel" &&
        !["manual", "uncertain"].includes(task.status)
      )
        throw new ConflictException("当前任务不需要人工确认");
      const status = body.action === "confirmed" ? "succeeded" : "cancelled";
      const changed = await tx.resaleSellerTask.updateMany({
        where: { id, status: task.status },
        data: { status, finishedAt: new Date(), lastError: null },
      });
      if (!changed.count) throw new ConflictException("任务状态已变化");
      if (body.action === "confirmed" && task.kind === "reprice")
        await tx.resaleListing.updateMany({
          where: {
            id: task.listingId,
            targetItemId: task.targetItemId,
            status: "published",
          },
          data: { priceCny: task.priceCny!, version: { increment: 1 } },
        });
      await tx.resaleEvent.create({
        data: {
          listingId: task.listingId,
          accountId: body.accountId,
          action: "seller_task_resolved",
          detail: `人工${body.action === "confirmed" ? "确认已执行" : "确认未执行或取消"}维护任务`,
        },
      });
      return { message: "维护结果已记录" };
    });
  }
  private async executeTask(id: string) {
    const task = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM resale_settings WHERE id = 'default' FOR UPDATE`;
      const settings = await tx.resaleSettings.findUnique({
        where: { id: "default" },
      });
      if (!settings || settings.paused) return null;
      const initial = await tx.resaleSellerTask.findUnique({ where: { id } });
      if (
        !initial ||
        initial.status !== "queued" ||
        initial.scheduledAt > new Date()
      )
        return null;
      await tx.$queryRaw`SELECT id FROM resale_listings WHERE id = ${initial.listingId} FOR UPDATE`;
      const current = await tx.resaleSellerTask.findUnique({ where: { id } });
      if (!current || current.status !== "queued") return null;
      const row = await tx.resaleListing.findUnique({
        where: { id: current.listingId },
        include: { item: true },
      });
      if (row?.humanControl) return null;
      const validActor = await tx.managerAccount.findFirst({
        where: { id: current.accountId, active: true },
      });
      if (
        !row ||
        !validActor ||
        row.version !== current.listingVersion ||
        row.status !== "published" ||
        row.targetItemId !== current.targetItemId ||
        row.requiresWithdrawal ||
        sourceBlockReason(row.item, row, settings.sourceFreshMinutes) ||
        !this.publisher.capability.sellerActions.includes(current.kind)
      ) {
        await tx.resaleSellerTask.updateMany({
          where: { id, status: "queued" },
          data: {
            status: "failed",
            lastError: "商品版本、货源或渠道已变化，请人工核查后重新安排",
            finishedAt: new Date(),
          },
        });
        return null;
      }
      const claimed = await tx.resaleSellerTask.updateMany({
        where: { id, status: "queued" },
        data: { status: "running", startedAt: new Date() },
      });
      if (!claimed.count) return null;
      await tx.resaleListing.update({
        where: { id: row.id },
        data: { version: { increment: 1 } },
      });
      return current;
    });
    if (!task) return;
    try {
      await this.publisher.sellerAction(
        task.kind as "bump" | "reprice",
        task.targetItemId,
        task.id,
        task.priceCny ?? undefined,
      );
      await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM resale_listings WHERE id = ${task.listingId} FOR UPDATE`;
        const changed = await tx.resaleSellerTask.updateMany({
          where: { id, status: { in: ["running", "uncertain"] } },
          data: {
            status: "succeeded",
            finishedAt: new Date(),
            lastError: null,
          },
        });
        if (changed.count && task.kind === "reprice")
          await tx.resaleListing.updateMany({
            where: {
              id: task.listingId,
              targetItemId: task.targetItemId,
              status: "published",
            },
            data: { priceCny: task.priceCny!, version: { increment: 1 } },
          });
        await tx.resaleEvent.create({
          data: {
            listingId: task.listingId,
            accountId: task.accountId,
            action: "seller_task_succeeded",
            detail: changed.count
              ? "卖家渠道已确认维护结果"
              : "收到较晚的渠道回执；任务已被人工核实，保留当前人工结果",
          },
        });
      });
    } catch {
      await this.uncertainTask(id, "结果未确认，请到闲鱼核实；不会自动重发");
    }
  }
  private async uncertainTask(id: string, detail: string) {
    await this.db.$transaction(async (tx) => {
      const task = await tx.resaleSellerTask.findUnique({ where: { id } });
      if (!task) return;
      await tx.$queryRaw`SELECT id FROM resale_listings WHERE id = ${task.listingId} FOR UPDATE`;
      const changed = await tx.resaleSellerTask.updateMany({
        where: { id, status: "running" },
        data: { status: "uncertain", lastError: detail },
      });
      if (changed.count) {
        await tx.resaleListing.updateMany({
          where: { id: task.listingId },
          data: { humanControl: true, version: { increment: 1 } },
        });
        await tx.resaleEvent.create({
          data: {
            listingId: task.listingId,
            accountId: task.accountId,
            action: "seller_task_uncertain",
            detail,
          },
        });
      }
    });
  }
  async tick() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const expired = await this.db.resaleSellerTask.findMany({
        where: {
          status: "running",
          startedAt: { lt: new Date(Date.now() - 120_000) },
        },
        take: 100,
        select: { id: true },
      });
      for (const task of expired)
        await this.uncertainTask(
          task.id,
          "执行超时或服务重启，请到闲鱼核实；不会自动重发",
        );
      const settings = await this.db.resaleSettings.findUnique({
        where: { id: "default" },
      });
      if (!settings || settings.paused) return;
      if (this.searchConfig()) {
        const monitors = await this.db.resaleMonitor.findMany({
          where: {
            active: true,
            OR: [{ nextScanAt: null }, { nextScanAt: { lte: new Date() } }],
          },
          take: 3,
          orderBy: { nextScanAt: "asc" },
        });
        for (const monitor of monitors) {
          if (
            this.stopped ||
            (
              await this.db.resaleSettings.findUnique({
                where: { id: "default" },
              })
            )?.paused
          )
            break;
          await this.scan(monitor.id).catch(() => {});
        }
      }
      const tasks = await this.db.resaleSellerTask.findMany({
        where: { status: "queued", scheduledAt: { lte: new Date() } },
        orderBy: { scheduledAt: "asc" },
        take: 3,
      });
      for (const task of tasks) {
        if (this.stopped) break;
        await this.executeTask(task.id).catch(() => {});
      }
      if (
        settings.autoMetrics &&
        this.publisher.capability.sellerActions.includes("metrics")
      ) {
        const listings = await this.db.resaleListing.findMany({
          where: {
            status: "published",
            humanControl: false,
            OR: [
              { metricsCheckedAt: null },
              { metricsCheckedAt: { lt: new Date(Date.now() - 3_600_000) } },
            ],
          },
          select: { id: true },
          take: 3,
          orderBy: { metricsCheckedAt: "asc" },
        });
        for (const row of listings) {
          if (this.stopped) break;
          await this.syncMetric(row.id).catch(() => {});
        }
      }
    } finally {
      this.running = false;
    }
  }
}
