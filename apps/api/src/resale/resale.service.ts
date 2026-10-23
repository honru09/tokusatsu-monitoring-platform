import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, type ResaleSettings } from "@tokusatsu/db";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { PrismaService } from "../prisma.service.js";
import { ProductAiService } from "../ai/product-ai.service.js";
import { copySchema, normalizeCopy, resalePrompt } from "./resale-content.js";
import type {
  ImportResaleDto,
  ResaleBulkDto,
  ResaleActionDto,
  ResaleQueryDto,
  UpdateResaleDto,
  UpdateResaleSettingsDto,
} from "./resale.dto.js";
import {
  approvalBlockReason,
  busyStatuses,
  chinaDayStart,
  sourceBlockReason,
  suggestedResalePrice,
  terminalSourceStatuses,
  validGoofishItemUrl,
  validPublicUrl,
} from "./resale.policy.js";
import { ResalePublisher } from "./resale-publisher.js";

const includeSource = {
  item: {
    include: {
      source: { select: { key: true, displayName: true } },
      images: { orderBy: { position: "asc" as const } },
    },
  },
} satisfies Prisma.ResaleListingInclude;

@Injectable()
export class ResaleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResaleService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;
  private sourceScanCursor: string | undefined;
  private redis?: Redis;
  private statusQueue?: Queue;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: ProductAiService,
    private readonly publisher: ResalePublisher,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick().catch(() =>
        this.logger.warn("转售后台任务失败，请检查数据库和发布连接"),
      );
    }, 60_000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.statusQueue?.close();
    this.redis?.disconnect();
  }
  private settings() {
    return this.prisma.resaleSettings.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    });
  }
  private async actor(accountId: string) {
    if (
      !(await this.prisma.managerAccount.findFirst({
        where: { id: accountId, active: true },
        select: { id: true },
      }))
    )
      throw new BadRequestException("管理者账号无效");
  }
  private async row(id: string, tx: Prisma.TransactionClient = this.prisma) {
    const row = await tx.resaleListing.findUnique({
      where: { id },
      include: includeSource,
    });
    if (!row) throw new NotFoundException("转售商品不存在");
    return row;
  }
  private async event(
    tx: Prisma.TransactionClient,
    listingId: string | null,
    accountId: string | null,
    action: string,
    detail: string,
  ) {
    await tx.resaleEvent.create({
      data: { listingId, accountId, action, detail },
    });
  }
  private async change(
    id: string,
    version: number,
    accountId: string | null,
    action: string,
    detail: string,
    data: Prisma.ResaleListingUpdateManyMutationInput,
    validate?: (row: Awaited<ReturnType<ResaleService["row"]>>) => void,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM resale_listings WHERE id = ${id} FOR UPDATE`;
      const row = await this.row(id, tx);
      if (row.version !== version)
        throw new ConflictException(
          "商品已被其他操作更新，请刷新后重试；当前输入仍保留",
        );
      validate?.(row);
      if (
        [
          "resume",
          "record",
          "confirm_withdrawn",
          "confirm_not_published",
        ].includes(action) &&
        (await tx.resaleSellerTask.count({
          where: { listingId: id, status: { in: ["running", "uncertain"] } },
        }))
      )
        throw new ConflictException(
          "维护操作正在执行或结果待核实，请先处理维护任务",
        );
      const result = await tx.resaleListing.updateMany({
        where: { id, version },
        data: { ...data, version: { increment: 1 } },
      });
      if (!result.count)
        throw new ConflictException("商品已更新，请刷新后重试");
      await this.event(tx, id, accountId, action, detail);
      if (action === "record" && !row.publishedAt)
        await this.event(
          tx,
          id,
          accountId,
          "publish_attempt",
          "人工回填首次发布结果",
        );
      return this.row(id, tx);
    });
  }
  async list(query: ResaleQueryDto) {
    const settings = await this.settings();
    const search = query.search?.trim();
    const where: Prisma.ResaleListingWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { item: { titleRaw: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const [listings, total, counts, todayAttempts] = await Promise.all([
      this.prisma.resaleListing.findMany({
        where,
        include: includeSource,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit,
        skip: (query.page - 1) * query.limit,
      }),
      this.prisma.resaleListing.count({ where }),
      this.prisma.resaleListing.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      this.prisma.resaleEvent.count({
        where: {
          action: "publish_attempt",
          createdAt: { gte: chinaDayStart() },
        },
      }),
    ]);
    return {
      listings,
      total,
      page: query.page,
      limit: query.limit,
      settings,
      counts: Object.fromEntries(
        counts.map((row) => [row.status, row._count._all]),
      ),
      todayAttempts,
      publisher: this.publisher.capability,
    };
  }
  async get(id: string) {
    const [listing, events] = await Promise.all([
      this.row(id),
      this.prisma.resaleEvent.findMany({
        where: { listingId: id },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    return { listing, events };
  }
  async updateSettings(body: UpdateResaleSettingsDto) {
    await this.actor(body.accountId);
    if (body.maxPriceJpy < body.minPriceJpy)
      throw new BadRequestException("价格上限不能低于下限");
    if (body.autoPublish && !this.publisher.capability.configured)
      throw new BadRequestException("自动发布尚未连接，请先使用手动发布");
    if (
      body.autoMetrics &&
      !this.publisher.capability.sellerActions.includes("metrics")
    )
      throw new BadRequestException("当前渠道尚未连接运营指标，可先人工记录");
    await this.settings();
    const { accountId, ...data } = body;
    return this.prisma.$transaction(async (tx) => {
      const settings = await tx.resaleSettings.update({
        where: { id: "default" },
        data,
      });
      await this.event(
        tx,
        null,
        accountId,
        "settings",
        settings.paused ? "自动任务已暂停" : "自动任务设置已保存",
      );
      return { settings };
    });
  }
  private importWhere(settings: ResaleSettings): Prisma.ItemWhereInput {
    return {
      source: { key: "mercari" },
      status: "active",
      listingType: "direct",
      archivedAt: null,
      ignored: false,
      purchaseRecord: null,
      resaleListing: null,
      priceCurrent: { gte: settings.minPriceJpy, lte: settings.maxPriceJpy },
      ...(settings.keywords.length
        ? {
            OR: settings.keywords.flatMap((keyword) => [
              { titleRaw: { contains: keyword, mode: "insensitive" as const } },
              { titleZh: { contains: keyword, mode: "insensitive" as const } },
              {
                monitoringKeywordMatches: {
                  some: {
                    keyword: {
                      keyword: {
                        contains: keyword,
                        mode: "insensitive" as const,
                      },
                    },
                  },
                },
              },
            ]),
          }
        : {}),
      AND: [
        ...settings.requiredKeywords.map((word) => ({
          OR: [
            { titleRaw: { contains: word, mode: "insensitive" as const } },
            { titleZh: { contains: word, mode: "insensitive" as const } },
            {
              descriptionRaw: { contains: word, mode: "insensitive" as const },
            },
            { descriptionZh: { contains: word, mode: "insensitive" as const } },
          ],
        })),
        ...settings.excludedKeywords.map((word) => ({
          AND: [
            {
              titleRaw: {
                mode: "insensitive" as const,
                not: { contains: word },
              },
            },
            {
              OR: [
                { titleZh: null },
                {
                  titleZh: {
                    mode: "insensitive" as const,
                    not: { contains: word },
                  },
                },
              ],
            },
            {
              OR: [
                { descriptionRaw: null },
                {
                  descriptionRaw: {
                    mode: "insensitive" as const,
                    not: { contains: word },
                  },
                },
              ],
            },
            {
              OR: [
                { descriptionZh: null },
                {
                  descriptionZh: {
                    mode: "insensitive" as const,
                    not: { contains: word },
                  },
                },
              ],
            },
          ],
        })),
      ],
    };
  }
  async candidates(query: ResaleQueryDto) {
    const settings = await this.settings();
    const where = this.importWhere(settings);
    if (query.search?.trim())
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        {
          OR: [
            {
              titleRaw: { contains: query.search.trim(), mode: "insensitive" },
            },
            { titleZh: { contains: query.search.trim(), mode: "insensitive" } },
          ],
        },
      ];
    const [items, total] = await Promise.all([
      this.prisma.item.findMany({
        where,
        include: { source: true, images: { orderBy: { position: "asc" } } },
        take: query.limit,
        skip: (query.page - 1) * query.limit,
        orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.item.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        suggestedPriceCny: suggestedResalePrice(item, settings),
      })),
      total,
      page: query.page,
    };
  }
  async import(body: ImportResaleDto) {
    await this.actor(body.accountId);
    return this.importItems(
      await this.settings(),
      body.itemIds,
      body.accountId,
    );
  }
  private async importItems(
    settings: ResaleSettings,
    itemIds?: string[],
    accountId: string | null = null,
  ) {
    if (itemIds && itemIds.length === 0) return { imported: 0 };
    const items = await this.prisma.item.findMany({
      where: {
        ...this.importWhere(settings),
        ...(itemIds ? { id: { in: itemIds } } : {}),
      },
      include: { images: { orderBy: { position: "asc" } } },
      take: 50,
      orderBy: { detectedAt: "desc" },
    });
    let imported = 0;
    for (const item of items) {
      try {
        await this.prisma.$transaction(async (tx) => {
          if (!accountId) {
            await tx.$queryRaw`SELECT id FROM resale_settings WHERE id = 'default' FOR UPDATE`;
            const current = await tx.resaleSettings.findUnique({
              where: { id: "default" },
            });
            if (!current || current.paused || !current.autoImport)
              throw new ConflictException("自动收录已暂停");
          }
          const row = await tx.resaleListing.create({
            data: {
              itemId: item.id,
              title: (item.titleZh || item.titleRaw).slice(0, 60),
              description:
                item.descriptionZh ||
                item.descriptionRaw ||
                "货源尚未提供完整说明，请补充后审核。",
              sourcePriceJpy: item.priceCurrent,
              sourceShippingJpy: item.shippingFee,
              priceCny: suggestedResalePrice(item, settings),
              imageUrls: item.images.slice(0, 9).map((image) => image.url),
              deliveryText: settings.deliveryText,
              shippingMode: settings.shippingMode,
              shippingFeeCny: settings.shippingFeeCny,
              locationText: settings.locationText,
            },
          });
          await this.event(
            tx,
            row.id,
            accountId,
            "import",
            "已从 Mercari 监测库收录，待编辑审核",
          );
        });
        imported++;
      } catch (error) {
        if (
          !(
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          )
        )
          throw error;
      }
    }
    return { imported };
  }
  async update(id: string, body: UpdateResaleDto) {
    await this.actor(body.accountId);
    if (!body.imageUrls.every(validPublicUrl))
      throw new BadRequestException("商品图片链接格式无效");
    const source = (await this.row(id)).item;
    const { accountId, version, ...data } = body;
    return {
      listing: await this.change(
        id,
        version,
        accountId,
        "edit",
        "人工编辑已保存，并接管该商品",
        {
          ...data,
          status: "draft",
          humanControl: true,
          sourcePriceJpy: source.priceCurrent,
          sourceShippingJpy: source.shippingFee,
          lastError: null,
          generationError: null,
          generationRequestedBy: null,
        },
        (row) => {
          if (busyStatuses.has(row.status) || row.status === "published")
            throw new ConflictException(
              "请先核实发布结果或完成下架，再编辑商品",
            );
        },
      ),
    };
  }
  async action(id: string, body: ResaleActionDto) {
    await this.actor(body.accountId);
    const row = await this.row(id);
    if (row.version !== body.version)
      throw new ConflictException("商品已更新，请刷新后重试");
    const settings = await this.settings();
    const validateEditable = (current: typeof row) => {
      if (busyStatuses.has(current.status) || current.status === "published")
        throw new ConflictException("请先核实发布结果或完成下架");
    };
    const requireApproved = (current: typeof row) => {
      const reason =
        approvalBlockReason(current) ||
        sourceBlockReason(current.item, current, settings.sourceFreshMinutes);
      if (reason) throw new BadRequestException(reason);
    };
    if (body.action === "recheck") {
      await this.recheck(row.item);
      return { listing: row, message: "货源核查已排队，稍后刷新查看" };
    }
    if (body.action === "generate") {
      validateEditable(row);
      const listing = await this.change(
        id,
        body.version,
        body.accountId,
        "generate_requested",
        "文案生成已排队，原稿仍可编辑",
        {
          status: "draft",
          generationRequestedBy: body.accountId,
          generationError: null,
          rightsConfirmed: false,
          fulfillmentConfirmed: false,
        },
      );
      void this.tick().catch(() => this.logger.warn("文案任务暂未执行"));
      return { listing, message: "文案生成已排队，可继续编辑" };
    }
    if (body.action === "publish" || body.action === "withdraw") {
      return this.executePublication(
        id,
        body.version,
        body.action === "publish" ? "publish" : "withdraw",
        body.accountId,
        false,
      );
    }
    if (body.action === "record") {
      if (
        !body.targetItemId ||
        !body.targetUrl ||
        !validGoofishItemUrl(body.targetItemId, body.targetUrl)
      )
        throw new BadRequestException(
          "请填写闲鱼商品 ID 和有效的 HTTPS 商品链接",
        );
      return {
        listing: await this.change(
          id,
          body.version,
          body.accountId,
          "record",
          "人工核实并回填闲鱼发布结果",
          {
            status: "published",
            targetItemId: body.targetItemId,
            targetUrl: body.targetUrl,
            publishedAt: row.publishedAt ?? new Date(),
            publishOrigin: row.publishOrigin ?? "manual",
            humanControl: true,
            operationToken: null,
            operationStartedAt: null,
            lastError: null,
            requiresWithdrawal:
              terminalSourceStatuses.has(row.item.status) ||
              Boolean(row.item.archivedAt),
          },
          (current) => {
            if (
              current.status === "publishing" ||
              current.status === "withdrawing"
            )
              throw new ConflictException("发布请求仍在运行，请等待结果");
            if (current.status !== "uncertain" && approvalBlockReason(current))
              throw new BadRequestException(approvalBlockReason(current)!);
          },
        ),
      };
    }
    if (
      body.action === "confirm_withdrawn" ||
      body.action === "confirm_not_published"
    ) {
      return {
        listing: await this.change(
          id,
          body.version,
          body.accountId,
          body.action,
          "人工已在闲鱼核实商品状态",
          {
            status: body.action === "confirm_withdrawn" ? "withdrawn" : "draft",
            targetItemId: null,
            targetUrl: null,
            operationToken: null,
            operationStartedAt: null,
            humanControl: true,
            requiresWithdrawal: false,
            lastError: null,
          },
          (current) => {
            if (
              body.action === "confirm_not_published"
                ? current.status !== "uncertain"
                : !["published", "uncertain"].includes(current.status)
            )
              throw new ConflictException("当前状态不能执行此确认");
          },
        ),
      };
    }
    let data: Prisma.ResaleListingUpdateManyMutationInput;
    let detail: string;
    if (body.action === "takeover") {
      data = { humanControl: true };
      detail = "已人工接管，后续自动操作停止；已发出的请求会继续回报结果";
    } else if (body.action === "resume") {
      data = { humanControl: false };
      detail = "已交回自动流程，暂停商品仍需重新审核";
    } else if (body.action === "pause") {
      validateEditable(row);
      data = { status: "paused", humanControl: true };
      detail = "商品已暂停并退出发布队列";
    } else if (body.action === "approve") {
      validateEditable(row);
      requireApproved(row);
      data = { status: "ready", lastError: null };
      detail = "已审核，可进入发布队列";
    } else if (body.action === "enqueue") {
      requireApproved(row);
      if (row.status !== "ready") throw new BadRequestException("请先审核商品");
      if (
        body.publishAt &&
        (!Number.isFinite(new Date(body.publishAt).getTime()) ||
          new Date(body.publishAt).getTime() > Date.now() + 365 * 86_400_000)
      )
        throw new BadRequestException("计划发布时间无效或超过一年");
      data = {
        status: "queued",
        humanControl: false,
        lastError: null,
        publishAt: body.publishAt ? new Date(body.publishAt) : null,
      };
      detail = body.publishAt
        ? `已加入发布队列，计划 ${new Date(body.publishAt).toISOString()}`
        : "已加入发布队列";
    } else throw new BadRequestException("不支持的操作");
    return {
      listing: await this.change(
        id,
        body.version,
        body.accountId,
        body.action,
        detail,
        data,
        (current) => {
          if (["approve", "pause"].includes(body.action))
            validateEditable(current);
          if (["approve", "enqueue"].includes(body.action))
            requireApproved(current);
        },
      ),
    };
  }
  private async recheck(
    item: Awaited<ReturnType<ResaleService["row"]>>["item"],
  ) {
    if (
      terminalSourceStatuses.has(item.status) ||
      item.archivedAt ||
      item.ignored
    )
      throw new BadRequestException("该货源已不可用，请查看原商品");
    if (!this.statusQueue) {
      this.redis = new Redis(
        process.env.REDIS_URL ?? "redis://localhost:6379",
        {
          maxRetriesPerRequest: 1,
          connectTimeout: 3000,
          commandTimeout: 5000,
          retryStrategy: () => null,
        },
      );
      this.redis.on("error", () => {});
      this.statusQueue = new Queue("item-status-refresh", {
        connection: this.redis,
      });
    }
    try {
      await this.statusQueue.add(
        "refresh-status",
        {
          itemId: item.id,
          sourceItemId: item.sourceItemId,
          sourceUrl: item.sourceUrl,
          status: item.status,
          auctionEndAt: item.auctionEndAt,
          adapterKey: "mercari",
        },
        {
          jobId: `resale-check-${item.id}-${Math.floor(Date.now() / 60_000)}`,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        "货源核查服务暂时不可用，请检查采集任务连接",
      );
    }
  }
  private async generate(
    id: string,
    version: number,
    accountId: string | null,
  ) {
    const row = await this.row(id);
    if (
      row.version !== version ||
      busyStatuses.has(row.status) ||
      row.status === "published"
    )
      throw new ConflictException("商品状态已变化，无法生成文案");
    if (!accountId && row.humanControl) return;
    const translated = Boolean(row.item.titleZh && (!row.item.descriptionRaw || row.item.descriptionZh) && (!row.item.conditionRaw || row.item.conditionZh));
    // Background work only reuses existing translations; model requests need a human action.
    if (!accountId && !translated) return;
    const token = randomUUID();
    const claim = await this.prisma.resaleListing.updateMany({
      where: {
        id,
        version,
        OR: [
          { generationToken: null },
          { generationStartedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
        ],
      },
      data: {
        generationToken: token,
        generationStartedAt: new Date(),
        generationError: null,
      },
    });
    if (!claim.count) throw new ConflictException("文案正在生成，请稍后刷新");
    try {
      const settings = await this.settings();
      const result = translated ? { data: {
        title: Array.from(row.item.titleZh!).slice(0, settings.titleMaxLength).join(""),
        description: [row.item.descriptionZh, row.item.conditionZh ? `成色：${row.item.conditionZh}` : null].filter(Boolean).join("\n\n") || "请核对原商品信息后补充描述。",
        titleCandidates: [], contentKeywords: [], contentWarnings: ["发布前请核对货源和交付条件"],
      } } : await this.ai.execute("translation", {
        itemId: row.itemId,
        costPolicy: "free_only",
        maxTokens: 5000,
        bypassCache: false,
        responseSchema: copySchema,
        messages: [
          {
            role: "system",
            content: resalePrompt(settings.titleStyle, settings.titleMaxLength),
          },
          {
            role: "user",
            content: JSON.stringify({
              title: row.item.titleRaw,
              description: row.item.descriptionRaw,
              condition: row.item.conditionRaw,
              translatedDescription: row.item.descriptionZh,
              translatedCondition: row.item.conditionZh,
              confirmedDeliveryText: row.deliveryText,
            }),
          },
        ],
      });
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.resaleListing.updateMany({
          where: {
            id,
            version,
            generationToken: token,
            ...(accountId ? {} : { humanControl: false }),
            status: { in: ["draft", "paused", "blocked"] },
          },
          data: {
            ...normalizeCopy(result.data, settings.titleMaxLength),
            generatedAt: new Date(),
            generationToken: null,
            generationStartedAt: null,
            generationError: null,
            status: "draft",
            rightsConfirmed: false,
            fulfillmentConfirmed: false,
            version: { increment: 1 },
          },
        });
        if (changed.count) {
          await tx.resaleListing.updateMany({
            where: { id, generationRequestedBy: accountId },
            data: { generationRequestedBy: null },
          });
          await this.event(
            tx,
            id,
            accountId,
            "generate",
            "中文草稿已生成，待人工核查商品信息",
          );
        }
      });
    } catch {
      await this.prisma.resaleListing.updateMany({
        where: { id, generationToken: token },
        data: {
          generationError: "文案生成失败，已保留原稿；可编辑或重试",
          generationToken: null,
          generationStartedAt: null,
          generationRequestedBy: null,
        },
      });
      throw new ServiceUnavailableException(
        "文案生成失败，已保留原稿；可编辑或重试",
      );
    } finally {
      await this.prisma.resaleListing.updateMany({
        where: { id, generationToken: token },
        data: { generationToken: null, generationStartedAt: null },
      });
    }
  }
  private async executePublication(
    id: string,
    version: number,
    action: "publish" | "withdraw",
    accountId: string | null,
    automatic: boolean,
  ) {
    if (!this.publisher.capability.configured)
      throw new BadRequestException(
        "自动发布尚未连接，请复制文案到闲鱼发布并回填结果",
      );
    await this.settings();
    const token = randomUUID();
    const claim = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM resale_settings WHERE id = 'default' FOR UPDATE`;
      const settings = (await tx.resaleSettings.findUnique({
        where: { id: "default" },
      }))!;
      await tx.$queryRaw`SELECT id FROM resale_listings WHERE id = ${id} FOR UPDATE`;
      const row = await this.row(id, tx);
      if (row.version !== version || busyStatuses.has(row.status))
        throw new ConflictException("商品状态已变化，请刷新");
      if (
        await tx.resaleSellerTask.count({
          where: { listingId: id, status: { in: ["running", "uncertain"] } },
        })
      )
        throw new ConflictException(
          "维护任务正在执行或结果待核实，请先处理维护任务",
        );
      if (
        automatic &&
        action === "publish" &&
        row.publishAt &&
        row.publishAt > new Date()
      )
        throw new ConflictException("尚未到计划发布时间");
      if (
        automatic &&
        (settings.paused ||
          row.humanControl ||
          (action === "publish" && !settings.autoPublish))
      )
        throw new ConflictException("自动任务已暂停或人工接管");
      if (action === "publish") {
        if (!["ready", "queued"].includes(row.status))
          throw new BadRequestException("请先审核商品");
        const reason =
          approvalBlockReason(row) ||
          sourceBlockReason(row.item, row, settings.sourceFreshMinutes);
        if (reason) throw new BadRequestException(reason);
        const count = await tx.resaleEvent.count({
          where: {
            action: "publish_attempt",
            createdAt: { gte: chinaDayStart() },
          },
        });
        if (count >= settings.dailyPublishLimit)
          throw new BadRequestException(
            "已达到本日发布额度，明日继续或修改额度",
          );
      } else if (
        row.status !== "published" ||
        !row.targetItemId ||
        row.publishOrigin !== "bridge"
      )
        throw new BadRequestException("该商品需要在闲鱼手动下架，再确认结果");
      const claimed = await tx.resaleListing.updateMany({
        where: { id, version },
        data: {
          status: action === "publish" ? "publishing" : "withdrawing",
          operationToken: token,
          operationStartedAt: new Date(),
          lastError: null,
          version: { increment: 1 },
        },
      });
      if (!claimed.count) throw new ConflictException("商品已更新，请刷新");
      await this.event(
        tx,
        id,
        accountId,
        action === "publish" ? "publish_attempt" : "withdraw_attempt",
        action === "publish" ? "已发送发布请求" : "已发送下架请求",
      );
      return row;
    });
    try {
      const receipt = await this.publisher.execute(
        action,
        {
          id,
          version: claim.version,
          title: claim.title,
          description: claim.description,
          priceCny: claim.priceCny,
          imageUrls: claim.imageUrls,
          deliveryText: claim.deliveryText,
          sourceUrl: claim.item.sourceUrl,
          targetItemId: claim.targetItemId,
        },
        token,
      );
      await this.prisma.$transaction(async (tx) => {
        const current = await this.row(id, tx);
        const sourceUnavailable =
          terminalSourceStatuses.has(current.item.status) ||
          Boolean(current.item.archivedAt) ||
          current.item.ignored;
        const changed = await tx.resaleListing.updateMany({
          where: { id, operationToken: token },
          data: {
            status: action === "publish" ? "published" : "withdrawn",
            ...(receipt
              ? { ...receipt, publishedAt: new Date(), publishOrigin: "bridge" }
              : {}),
            operationToken: null,
            operationStartedAt: null,
            requiresWithdrawal: action === "publish" && sourceUnavailable,
            lastError: null,
            version: { increment: 1 },
          },
        });
        if (changed.count)
          await this.event(
            tx,
            id,
            accountId,
            action === "publish" ? "published" : "withdrawn",
            action === "publish" ? "发布服务已确认上架" : "发布服务已确认下架",
          );
      });
    } catch {
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.resaleListing.updateMany({
          where: { id, operationToken: token },
          data: {
            status: "uncertain",
            humanControl: true,
            lastError: "发布或下架结果待核实，请到闲鱼检查并回填；不会自动重试",
            version: { increment: 1 },
          },
        });
        if (changed.count)
          await this.event(
            tx,
            id,
            accountId,
            "uncertain",
            "外部操作未确认，已停止自动重试",
          );
      });
    }
    return { listing: await this.row(id) };
  }
  async run(accountId: string) {
    await this.actor(accountId);
    void this.tick().catch(() => this.logger.warn("转售任务执行失败"));
    return { message: "已安排执行一轮任务，暂停时仅核查状态和执行人工请求" };
  }
  async bulk(body: ResaleBulkDto) {
    await this.actor(body.accountId);
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of body.listingIds) {
      try {
        const row = await this.row(id);
        if (body.versions[id] !== row.version)
          throw new ConflictException("商品版本已变化，请刷新后重新选择");
        await this.action(id, {
          accountId: body.accountId,
          version: row.version,
          action: body.action,
          publishAt: body.publishAt,
        });
        results.push({ id, ok: true });
      } catch (error) {
        results.push({
          id,
          ok: false,
          error: error instanceof Error ? error.message : "操作失败",
        });
      }
    }
    return { results, succeeded: results.filter((result) => result.ok).length };
  }
  private async tick() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const settings = await this.settings();
      // Persisted in-flight requests are never retried after an API restart.
      await this.prisma.resaleListing.updateMany({
        where: {
          status: { in: ["publishing", "withdrawing"] },
          operationStartedAt: { lt: new Date(Date.now() - 2 * 60_000) },
        },
        data: {
          status: "uncertain",
          humanControl: true,
          lastError: "请求超时或后台重启，请在闲鱼核实实际结果",
          version: { increment: 1 },
        },
      });
      await this.syncSources(settings);
      const requested = await this.prisma.resaleListing.findMany({
        where: {
          status: "draft",
          generationRequestedBy: { not: null },
          generationError: null,
        },
        take: 3,
        orderBy: { updatedAt: "asc" },
      });
      for (const row of requested) {
        if (this.stopped) break;
        await this.generate(
          row.id,
          row.version,
          row.generationRequestedBy,
        ).catch(() => {});
      }
      if (settings.paused) return;
      if (settings.autoImport) await this.importItems(settings);
      if (settings.autoGenerate) {
        const drafts = await this.prisma.resaleListing.findMany({
          where: {
            status: "draft",
            humanControl: false,
            generatedAt: null,
            generationError: null,
            item: {
              AND: [
                { titleZh: { not: null } },
                { titleZh: { not: "" } },
                { OR: [{ descriptionRaw: null }, { descriptionRaw: "" }, { AND: [{ descriptionZh: { not: null } }, { descriptionZh: { not: "" } }] }] },
                { OR: [{ conditionRaw: null }, { conditionRaw: "" }, { AND: [{ conditionZh: { not: null } }, { conditionZh: { not: "" } }] }] },
              ],
            },
          },
          orderBy: { createdAt: "asc" },
          take: 3,
        });
        for (const draft of drafts) {
          if ((await this.settings()).paused || this.stopped) break;
          await this.generate(draft.id, draft.version, null).catch(() => {});
        }
      }
      if (settings.autoPublish && this.publisher.capability.configured) {
        const queued = await this.prisma.resaleListing.findMany({
          where: {
            status: "queued",
            humanControl: false,
            OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }],
          },
          orderBy: { updatedAt: "asc" },
          take: 5,
        });
        for (const draft of queued) {
          if (this.stopped) break;
          try {
            await this.executePublication(
              draft.id,
              draft.version,
              "publish",
              null,
              true,
            );
          } catch (error) {
            await this.prisma.resaleListing.updateMany({
              where: { id: draft.id, version: draft.version, status: "queued" },
              data: {
                lastError:
                  error instanceof BadRequestException
                    ? error.message
                    : "队列暂未执行，请检查任务设置",
              },
            });
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
  private async syncSources(settings: ResaleSettings) {
    const rows = await this.prisma.resaleListing.findMany({
      where: {
        status: { in: ["ready", "queued", "published"] },
        ...(this.sourceScanCursor ? { id: { gt: this.sourceScanCursor } } : {}),
      },
      include: includeSource,
      orderBy: { id: "asc" },
      take: 200,
    });
    this.sourceScanCursor =
      rows.length === 200 ? rows[rows.length - 1]!.id : undefined;
    for (const row of rows) {
      const reason = sourceBlockReason(
        row.item,
        row,
        settings.sourceFreshMinutes,
      );
      if (!reason) {
        if (row.lastError && row.status !== "published")
          await this.prisma.resaleListing.updateMany({
            where: { id: row.id, version: row.version },
            data: { lastError: null },
          });
        continue;
      }
      const unavailable =
        terminalSourceStatuses.has(row.item.status) ||
        Boolean(row.item.archivedAt) ||
        row.item.ignored;
      const priceChanged =
        row.item.priceCurrent !== row.sourcePriceJpy ||
        row.item.shippingFee !== row.sourceShippingJpy;
      if (row.status === "published") {
        if (unavailable && !row.requiresWithdrawal)
          await this.change(
            row.id,
            row.version,
            null,
            "source_unavailable",
            "货源不可用，需下架闲鱼商品",
            { requiresWithdrawal: true, lastError: reason },
          ).catch(() => {});
        if (
          unavailable &&
          !settings.paused &&
          !row.humanControl &&
          row.publishOrigin === "bridge" &&
          this.publisher.capability.configured
        ) {
          const latest = await this.row(row.id);
          await this.executePublication(
            latest.id,
            latest.version,
            "withdraw",
            null,
            true,
          ).catch(() => {});
        }
      } else if (unavailable || priceChanged) {
        await this.change(row.id, row.version, null, "source_blocked", reason, {
          status: "blocked",
          lastError: reason,
        }).catch(() => {});
      } else if (!settings.paused) {
        await this.prisma.resaleListing.updateMany({
          where: { id: row.id, version: row.version },
          data: { lastError: reason },
        });
        await this.recheck(row.item).catch(() => {});
      }
    }
  }
}
