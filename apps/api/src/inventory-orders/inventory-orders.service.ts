import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@tokusatsu/db";
import {
  applyAdjustment,
  applySale,
  inventoryOrderMetrics,
  orderNumberFromId,
} from "@tokusatsu/shared";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma.service.js";
import {
  ensureInventoryOrderFromBundle,
  type BundleMemberForInventory,
} from "./inventory-order-from-bundle.js";
import {
  AdjustInventoryOrderDto,
  CreateInventoryOrderDto,
  ListInventoryOrdersQuery,
  SellInventoryOrderDto,
} from "./inventory-orders.dto.js";

const detailInclude = {
  salesRecords: {
    orderBy: [{ soldAt: "desc" as const }, { id: "desc" as const }],
  },
  adjustments: {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
  },
} satisfies Prisma.InventoryOrderInclude;

type OrderRow = {
  id: string;
  orderNumber: string;
  name: string | null;
  platform: string | null;
  purchaseCost: number;
  initialQuantity: number;
  remainingQuantity: number;
  soldQuantity: number;
  totalSales: number;
  status: string;
  purchasedAt: Date | null;
  imageUrl: string | null;
  note: string | null;
  sourceBundleId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

class InventoryOrderWriteConflict extends Error {}

function inventorySnapshotWhere(
  order: OrderRow,
): Prisma.InventoryOrderWhereInput {
  return {
    id: order.id,
    purchaseCost: order.purchaseCost,
    initialQuantity: order.initialQuantity,
    remainingQuantity: order.remainingQuantity,
    soldQuantity: order.soldQuantity,
    totalSales: order.totalSales,
  };
}

function parsedDate(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new BadRequestException("购买时间格式无效");
  return parsed;
}

function serializeOrder(order: OrderRow) {
  const metrics = inventoryOrderMetrics({
    purchaseCost: order.purchaseCost,
    initialQuantity: order.initialQuantity,
    remainingQuantity: order.remainingQuantity,
    soldQuantity: order.soldQuantity,
    totalSales: order.totalSales,
  });
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    name: order.name,
    platform: order.platform,
    purchaseCost: order.purchaseCost,
    initialQuantity: order.initialQuantity,
    remainingQuantity: order.remainingQuantity,
    soldQuantity: order.soldQuantity,
    totalSales: order.totalSales,
    status: metrics.status,
    statusLabel:
      metrics.status === "in_stock"
        ? "在库"
        : metrics.status === "partially_sold"
          ? "部分售出"
          : "已售完",
    averageCost: metrics.averageCost,
    realizedProfit: metrics.realizedProfit,
    recoveryRatio: metrics.recoveryRatio,
    recoveryPercent: metrics.recoveryPercent,
    finalOrderProfit: metrics.finalOrderProfit,
    finalOrderMarginPercent: metrics.finalOrderMarginPercent,
    purchasedAt: order.purchasedAt?.toISOString() ?? null,
    imageUrl: order.imageUrl,
    note: order.note,
    sourceBundleId: order.sourceBundleId,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

@Injectable()
export class InventoryOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private async mutateWithRetry<T>(
    mutate: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(mutate);
      } catch (error) {
        if (!(error instanceof InventoryOrderWriteConflict)) throw error;
        // Every retry starts a new transaction and recalculates from current
        // stock/cost. Contention cannot produce unbounded work or overselling.
        if (attempt >= 2)
          throw new ConflictException("库存已变动，请刷新后重试");
      }
    }
  }

  async list(query: ListInventoryOrdersQuery) {
    const page = Math.max(1, query.page);
    const limit = Math.max(1, Math.min(100, query.limit));
    const search = query.search?.trim();
    const status = query.status?.trim();
    const where: Prisma.InventoryOrderWhereInput = {
      ...(status
        ? { status: status as "in_stock" | "partially_sold" | "sold_out" }
        : {}),
      ...(search
        ? {
            OR: [
              { orderNumber: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
              { platform: { contains: search, mode: "insensitive" } },
              { note: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [orders, total, aggregates] = await this.prisma.$transaction([
      this.prisma.inventoryOrder.findMany({
        where,
        orderBy: [{ purchasedAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.inventoryOrder.count({ where }),
      this.prisma.inventoryOrder.aggregate({
        where,
        _sum: {
          purchaseCost: true,
          totalSales: true,
          remainingQuantity: true,
          soldQuantity: true,
        },
      }),
    ]);

    return {
      orders: orders.map(serializeOrder),
      total,
      page,
      limit,
      totals: {
        purchaseCostYen: aggregates._sum.purchaseCost ?? 0,
        totalSalesYen: aggregates._sum.totalSales ?? 0,
        remainingQuantity: aggregates._sum.remainingQuantity ?? 0,
        soldQuantity: aggregates._sum.soldQuantity ?? 0,
      },
      serverTime: new Date().toISOString(),
    };
  }

  async get(id: string) {
    const order = await this.prisma.inventoryOrder.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (!order) throw new NotFoundException("库存订单不存在");
    return {
      order: {
        ...serializeOrder(order),
        salesRecords: order.salesRecords.map((sale) => ({
          id: sale.id,
          quantity: sale.quantity,
          salePrice: sale.salePrice,
          costOfSale: sale.costOfSale,
          profit: sale.profit,
          note: sale.note,
          soldAt: sale.soldAt.toISOString(),
          createdAt: sale.createdAt.toISOString(),
        })),
        adjustments: order.adjustments.map((adjustment) => ({
          id: adjustment.id,
          quantityDelta: adjustment.quantityDelta,
          reason: adjustment.reason,
          createdAt: adjustment.createdAt.toISOString(),
        })),
      },
      serverTime: new Date().toISOString(),
    };
  }

  async create(body: CreateInventoryOrderDto) {
    const id = randomUUID();
    const order = await this.prisma.inventoryOrder.create({
      data: {
        id,
        orderNumber: orderNumberFromId(id),
        name: body.name?.trim() || null,
        platform: body.platform?.trim() || null,
        purchaseCost: body.purchaseCost,
        initialQuantity: body.initialQuantity,
        remainingQuantity: body.initialQuantity,
        soldQuantity: 0,
        totalSales: 0,
        status: "in_stock",
        purchasedAt: parsedDate(body.purchasedAt) ?? new Date(),
        imageUrl: body.imageUrl?.trim() || null,
        note: body.note?.trim() || null,
      },
    });
    return {
      order: serializeOrder(order),
      serverTime: new Date().toISOString(),
    };
  }

  async sell(id: string, body: SellInventoryOrderDto) {
    try {
      const result = await this.mutateWithRetry(async (tx) => {
        const order = await tx.inventoryOrder.findUnique({ where: { id } });
        if (!order) throw new NotFoundException("库存订单不存在");

        const next = applySale(
          {
            purchaseCost: order.purchaseCost,
            initialQuantity: order.initialQuantity,
            remainingQuantity: order.remainingQuantity,
            soldQuantity: order.soldQuantity,
            totalSales: order.totalSales,
          },
          body.quantity,
          body.salePrice,
        );

        const claimed = await tx.inventoryOrder.updateMany({
          where: inventorySnapshotWhere(order),
          data: {
            remainingQuantity: next.remainingQuantity,
            soldQuantity: next.soldQuantity,
            totalSales: next.totalSales,
            status: next.status,
          },
        });
        if (claimed.count !== 1) throw new InventoryOrderWriteConflict();

        // Only append the sale after claiming the exact snapshot used for its
        // cost calculation. The enclosing transaction rolls back both writes.
        const sale = await tx.salesRecord.create({
          data: {
            inventoryOrderId: id,
            quantity: body.quantity,
            salePrice: body.salePrice,
            costOfSale: next.costOfSale,
            profit: next.saleProfit,
            note: body.note?.trim() || null,
          },
        });

        const updated = await tx.inventoryOrder.findUniqueOrThrow({
          where: { id },
        });

        return { order: updated, sale };
      });

      return {
        order: serializeOrder(result.order),
        sale: {
          id: result.sale.id,
          quantity: result.sale.quantity,
          salePrice: result.sale.salePrice,
          costOfSale: result.sale.costOfSale,
          profit: result.sale.profit,
          note: result.sale.note,
          soldAt: result.sale.soldAt.toISOString(),
        },
        serverTime: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof RangeError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }

  async adjust(id: string, body: AdjustInventoryOrderDto) {
    try {
      const result = await this.mutateWithRetry(async (tx) => {
        const order = await tx.inventoryOrder.findUnique({ where: { id } });
        if (!order) throw new NotFoundException("库存订单不存在");

        const next = applyAdjustment(
          {
            remainingQuantity: order.remainingQuantity,
            initialQuantity: order.initialQuantity,
          },
          body.quantityDelta,
        );

        const claimed = await tx.inventoryOrder.updateMany({
          where: inventorySnapshotWhere(order),
          data: {
            remainingQuantity: next.remainingQuantity,
            status: next.status,
          },
        });
        if (claimed.count !== 1) throw new InventoryOrderWriteConflict();

        const adjustment = await tx.inventoryAdjustment.create({
          data: {
            inventoryOrderId: id,
            quantityDelta: body.quantityDelta,
            reason: body.reason.trim(),
          },
        });

        const updated = await tx.inventoryOrder.findUniqueOrThrow({
          where: { id },
        });

        return { order: updated, adjustment };
      });

      return {
        order: serializeOrder(result.order),
        adjustment: {
          id: result.adjustment.id,
          quantityDelta: result.adjustment.quantityDelta,
          reason: result.adjustment.reason,
          createdAt: result.adjustment.createdAt.toISOString(),
        },
        serverTime: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof RangeError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }

  /** Dual-write helper: create an inventory order from a purchase bundle if missing. */
  ensureFromPurchaseBundle(
    tx: Prisma.TransactionClient,
    input: {
      bundleId: string;
      purchaseCost: number;
      purchasedAt: Date;
      note?: string | null;
      members: BundleMemberForInventory[];
    },
  ) {
    return ensureInventoryOrderFromBundle(tx, input);
  }
}
