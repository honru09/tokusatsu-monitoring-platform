import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@tokusatsu/db";
import { resolveInventoryOrderStatus } from "@tokusatsu/shared";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma.service.js";
import {
  CreateShipmentDto,
  ListShipmentsQuery,
  ShipmentLineDto,
} from "./shipments.dto.js";

type OrderRow = {
  id: string;
  name: string | null;
  purchaseCost: number;
  initialQuantity: number;
  remainingQuantity: number;
  soldQuantity: number;
  totalSales: number;
  status: string;
};

type ShipmentLineRow = {
  id: string;
  inventoryOrderId: string;
  itemName: string | null;
  quantity: number;
  unitDeclaredYen: number;
  lineTotalYen: number;
};

type ShipmentRow = {
  id: string;
  totalDeclared: number;
  exchangeRate?: unknown;
  totalDeclaredCny?: number | null;
  createdById: string;
  createdAt: Date;
  createdBy?: { displayName: string } | null;
  lines: ShipmentLineRow[];
};

class ShipmentWriteConflict extends Error {}

function inventorySnapshotWhere(order: OrderRow) {
  return {
    id: order.id,
    purchaseCost: order.purchaseCost,
    initialQuantity: order.initialQuantity,
    remainingQuantity: order.remainingQuantity,
    soldQuantity: order.soldQuantity,
    totalSales: order.totalSales,
  };
}

function serializeShipment(shipment: ShipmentRow, fallbackName?: string) {
  return {
    id: shipment.id,
    totalDeclared: shipment.totalDeclared,
    exchangeRate:
      shipment.exchangeRate == null ? null : Number(shipment.exchangeRate),
    totalDeclaredCny: shipment.totalDeclaredCny ?? null,
    createdById: shipment.createdById,
    createdByName: shipment.createdBy?.displayName ?? fallbackName ?? null,
    createdAt: shipment.createdAt.toISOString(),
    lines: (shipment.lines ?? []).map((line) => ({
      id: line.id,
      inventoryOrderId: line.inventoryOrderId,
      itemName: line.itemName,
      quantity: line.quantity,
      unitDeclaredYen: line.unitDeclaredYen,
      lineTotalYen: line.lineTotalYen,
    })),
  };
}

function mergeLines(lines: ShipmentLineDto[]): ShipmentLineDto[] {
  const merged = new Map<string, ShipmentLineDto>();
  for (const line of lines) {
    const existing = merged.get(line.inventoryOrderId);
    if (!existing) {
      merged.set(line.inventoryOrderId, { ...line });
      continue;
    }
    if (existing.unitDeclaredYen !== line.unitDeclaredYen)
      throw new BadRequestException("同一库存订单的申报单价不一致");
    existing.quantity += line.quantity;
  }
  return [...merged.values()];
}

@Injectable()
export class ShipmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private async mutateWithRetry<T>(
    mutate: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(mutate);
      } catch (error) {
        if (!(error instanceof ShipmentWriteConflict)) throw error;
        // Every retry starts a new transaction and recalculates from current
        // stock. Contention cannot produce unbounded work or overshipping.
        if (attempt >= 2)
          throw new ConflictException("库存已变动，请刷新后重试");
      }
    }
  }

  async create(body: CreateShipmentDto) {
    if (!body.lines || body.lines.length === 0)
      throw new BadRequestException("发货明细不能为空");

    const account = await this.prisma.managerAccount.findFirst({
      where: { id: body.accountId, active: true },
    });
    if (!account) throw new BadRequestException("管理者账号无效");

    const lines = mergeLines(body.lines);
    const totalDeclared = lines.reduce(
      (sum, line) => sum + line.quantity * line.unitDeclaredYen,
      0,
    );

    try {
      const shipment = await this.mutateWithRetry(async (tx) => {
        const claimed: {
          order: OrderRow;
          line: ShipmentLineDto;
          nextRemaining: number;
        }[] = [];

        for (const line of lines) {
          const order = (await tx.inventoryOrder.findUnique({
            where: { id: line.inventoryOrderId },
          })) as OrderRow | null;
          if (!order) throw new NotFoundException("库存订单不存在");

          if (line.quantity > order.remainingQuantity)
            throw new RangeError(
              `库存不足：${order.name ?? order.id} 剩余 ${order.remainingQuantity} 件`,
            );

          const nextRemaining = order.remainingQuantity - line.quantity;
          const nextStatus = resolveInventoryOrderStatus(
            nextRemaining,
            order.initialQuantity,
          );

          const updated = await tx.inventoryOrder.updateMany({
            where: inventorySnapshotWhere(order),
            data: {
              remainingQuantity: nextRemaining,
              status: nextStatus,
            },
          });
          if (updated.count !== 1) throw new ShipmentWriteConflict();

          claimed.push({ order, line, nextRemaining });
        }

        const shipmentId = randomUUID();
        const created = (await tx.shipment.create({
          data: {
            id: shipmentId,
            totalDeclared,
            exchangeRate: body.exchangeRate ?? null,
            totalDeclaredCny: body.totalDeclaredCny ?? null,
            createdById: body.accountId,
            lines: {
              create: claimed.map(({ order, line }) => ({
                id: randomUUID(),
                inventoryOrderId: line.inventoryOrderId,
                itemName: order.name,
                quantity: line.quantity,
                unitDeclaredYen: line.unitDeclaredYen,
                lineTotalYen: line.quantity * line.unitDeclaredYen,
              })),
            },
          },
          include: {
            lines: true,
            createdBy: { select: { displayName: true } },
          },
        })) as ShipmentRow;

        return created;
      });

      return serializeShipment(shipment, account.displayName);
    } catch (error) {
      if (error instanceof RangeError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }

  async list(query: ListShipmentsQuery) {
    const take = Math.max(1, Math.min(200, query.limit ?? 50));
    const shipments = (await this.prisma.shipment.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      include: {
        lines: true,
        createdBy: { select: { displayName: true } },
      },
    })) as ShipmentRow[];

    return {
      shipments: shipments.map((shipment) => serializeShipment(shipment)),
      serverTime: new Date().toISOString(),
    };
  }
}
