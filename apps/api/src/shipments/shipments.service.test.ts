import { describe, expect, it, vi } from "vitest";
import { ShipmentsService } from "./shipments.service.js";

const NOW = new Date("2026-10-25T00:00:00.000Z");
const ACCOUNT = { id: "mgr-1", displayName: "王", active: true };

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "ord-1",
    orderNumber: "ORD-00000001",
    name: "DX 腰带",
    platform: "Mercari",
    purchaseCost: 10_000,
    initialQuantity: 10,
    remainingQuantity: 10,
    soldQuantity: 0,
    totalSales: 0,
    status: "in_stock",
    purchasedAt: NOW,
    imageUrl: null,
    note: null,
    sourceBundleId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function harness({
  account = ACCOUNT as typeof ACCOUNT | null,
  orders = [makeOrder()],
} = {}) {
  const rows = new Map(orders.map((o) => [o.id, { ...o }]));
  const shipments: Record<string, unknown>[] = [];

  const tx = {
    inventoryOrder: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => {
          const row = rows.get(where.id);
          return row ? { ...row } : null;
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const row = rows.get(where.id as string);
          if (!row) return { count: 0 };
          if (
            Object.entries(where).some(
              ([key, value]) => Reflect.get(row, key) !== value,
            )
          )
            return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
    },
    shipment: {
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        const lines = (data.lines?.create ?? []).map(
          (line: Record<string, unknown>, i: number) => ({
            id: `line-${shipments.length}-${i}`,
            shipmentId: data.id,
            ...line,
          }),
        );
        const shipment = {
          id: data.id,
          totalDeclared: data.totalDeclared,
          exchangeRate: data.exchangeRate ?? null,
          totalDeclaredCny: data.totalDeclaredCny ?? null,
          createdById: data.createdById,
          createdAt: NOW,
          createdBy: { displayName: account?.displayName ?? "王" },
          lines,
        };
        shipments.push(shipment);
        return shipment;
      }),
    },
  };

  const prisma = {
    managerAccount: {
      findFirst: vi.fn(async () => account),
    },
    $transaction: vi.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
    ),
    shipment: {
      findMany: vi.fn(async () => shipments),
    },
  };

  return {
    service: new ShipmentsService(prisma as never),
    prisma,
    tx,
    rows,
    shipments,
  };
}

describe("ShipmentsService.create", () => {
  it("decrements stock and flips status to sold_out at zero, with total math", async () => {
    const h = harness();

    const result = await h.service.create({
      accountId: "mgr-1",
      lines: [{ inventoryOrderId: "ord-1", quantity: 10, unitDeclaredYen: 180 }],
    });

    expect(h.rows.get("ord-1")).toMatchObject({
      remainingQuantity: 0,
      status: "sold_out",
    });
    expect(result.totalDeclared).toBe(1800);
    expect(result.createdById).toBe("mgr-1");
    expect(result.createdByName).toBe("王");
    expect(result.createdAt).toBe(NOW.toISOString());
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      inventoryOrderId: "ord-1",
      itemName: "DX 腰带",
      quantity: 10,
      unitDeclaredYen: 180,
      lineTotalYen: 1800,
    });
  });

  it("persists the FX snapshot when exchangeRate and totalDeclaredCny are sent", async () => {
    const h = harness();

    const result = await h.service.create({
      accountId: "mgr-1",
      exchangeRate: 0.0425,
      totalDeclaredCny: 76,
      lines: [{ inventoryOrderId: "ord-1", quantity: 10, unitDeclaredYen: 180 }],
    });

    expect(result.exchangeRate).toBe(0.0425);
    expect(result.totalDeclaredCny).toBe(76);
    expect(result.totalDeclared).toBe(1800);
    expect(h.tx.shipment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          exchangeRate: 0.0425,
          totalDeclaredCny: 76,
        }),
      }),
    );
  });

  it("stores null FX snapshot fields when they are absent", async () => {
    const h = harness();

    const result = await h.service.create({
      accountId: "mgr-1",
      lines: [{ inventoryOrderId: "ord-1", quantity: 1, unitDeclaredYen: 100 }],
    });

    expect(result.exchangeRate).toBeNull();
    expect(result.totalDeclaredCny).toBeNull();
    expect(h.tx.shipment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          exchangeRate: null,
          totalDeclaredCny: null,
        }),
      }),
    );
  });

  it("flips status to partially_sold when stock remains", async () => {
    const h = harness();

    const result = await h.service.create({
      accountId: "mgr-1",
      lines: [{ inventoryOrderId: "ord-1", quantity: 3, unitDeclaredYen: 500 }],
    });

    expect(h.rows.get("ord-1")).toMatchObject({
      remainingQuantity: 7,
      status: "partially_sold",
    });
    expect(result.totalDeclared).toBe(1500);
  });

  it("sums totalDeclared across multiple orders", async () => {
    const h = harness({
      orders: [
        makeOrder(),
        makeOrder({
          id: "ord-2",
          name: "SHF 假面骑士",
          initialQuantity: 5,
          remainingQuantity: 5,
          purchaseCost: 5_000,
        }),
      ],
    });

    const result = await h.service.create({
      accountId: "mgr-1",
      lines: [
        { inventoryOrderId: "ord-1", quantity: 2, unitDeclaredYen: 900 },
        { inventoryOrderId: "ord-2", quantity: 1, unitDeclaredYen: 100 },
      ],
    });

    expect(result.totalDeclared).toBe(1900);
    expect(result.lines).toHaveLength(2);
    expect(h.rows.get("ord-1")?.remainingQuantity).toBe(8);
    expect(h.rows.get("ord-2")?.remainingQuantity).toBe(4);
  });

  it("rejects insufficient stock without creating a shipment", async () => {
    const h = harness({
      orders: [makeOrder({ initialQuantity: 3, remainingQuantity: 3 })],
    });

    await expect(
      h.service.create({
        accountId: "mgr-1",
        lines: [{ inventoryOrderId: "ord-1", quantity: 4, unitDeclaredYen: 100 }],
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(h.shipments).toHaveLength(0);
    expect(h.rows.get("ord-1")?.remainingQuantity).toBe(3);
  });

  it("rejects an unknown inventory order with 404", async () => {
    const h = harness();

    await expect(
      h.service.create({
        accountId: "mgr-1",
        lines: [
          { inventoryOrderId: "ord-missing", quantity: 1, unitDeclaredYen: 100 },
        ],
      }),
    ).rejects.toMatchObject({ status: 404, message: "库存订单不存在" });
    expect(h.shipments).toHaveLength(0);
  });

  it("rejects an unknown or inactive account", async () => {
    const h = harness({ account: null });

    await expect(
      h.service.create({
        accountId: "mgr-unknown",
        lines: [{ inventoryOrderId: "ord-1", quantity: 1, unitDeclaredYen: 100 }],
      }),
    ).rejects.toMatchObject({ status: 400, message: "管理者账号无效" });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("merges duplicate lines for the same order", async () => {
    const h = harness();

    const result = await h.service.create({
      accountId: "mgr-1",
      lines: [
        { inventoryOrderId: "ord-1", quantity: 2, unitDeclaredYen: 300 },
        { inventoryOrderId: "ord-1", quantity: 3, unitDeclaredYen: 300 },
      ],
    });

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ quantity: 5, lineTotalYen: 1500 });
    expect(result.totalDeclared).toBe(1500);
    expect(h.rows.get("ord-1")?.remainingQuantity).toBe(5);
  });

  it("rejects duplicate lines that disagree on unit declared price", async () => {
    const h = harness();

    await expect(
      h.service.create({
        accountId: "mgr-1",
        lines: [
          { inventoryOrderId: "ord-1", quantity: 1, unitDeclaredYen: 300 },
          { inventoryOrderId: "ord-1", quantity: 1, unitDeclaredYen: 400 },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(h.shipments).toHaveLength(0);
  });

  it("rejects empty lines", async () => {
    const h = harness();

    await expect(
      h.service.create({ accountId: "mgr-1", lines: [] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("bounds retries and conflicts when the snapshot claim keeps failing", async () => {
    const h = harness();
    h.tx.inventoryOrder.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      h.service.create({
        accountId: "mgr-1",
        lines: [{ inventoryOrderId: "ord-1", quantity: 1, unitDeclaredYen: 100 }],
      }),
    ).rejects.toMatchObject({ status: 409, message: "库存已变动，请刷新后重试" });
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(h.shipments).toHaveLength(0);
  });
});

describe("ShipmentsService.list", () => {
  it("lists newest first with serialized lines and clamps the limit", async () => {
    const h = harness();
    await h.service.create({
      accountId: "mgr-1",
      lines: [{ inventoryOrderId: "ord-1", quantity: 1, unitDeclaredYen: 700 }],
    });
    // Re-mock findMany to observe the query the service issues.
    h.prisma.shipment.findMany.mockClear();

    const result = await h.service.list({ limit: 9999 });

    expect(h.prisma.shipment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 200,
      }),
    );
    expect(result.shipments).toHaveLength(1);
    expect(result.shipments[0]).toMatchObject({
      totalDeclared: 700,
      createdByName: "王",
    });
    expect(typeof result.serverTime).toBe("string");
  });

  it("includes the FX snapshot in list results, null for rows without one", async () => {
    const h = harness();
    await h.service.create({
      accountId: "mgr-1",
      exchangeRate: 0.0425,
      totalDeclaredCny: 30,
      lines: [{ inventoryOrderId: "ord-1", quantity: 1, unitDeclaredYen: 700 }],
    });
    await h.service.create({
      accountId: "mgr-1",
      lines: [{ inventoryOrderId: "ord-1", quantity: 1, unitDeclaredYen: 700 }],
    });

    const result = await h.service.list({});

    expect(result.shipments).toHaveLength(2);
    expect(result.shipments[0]).toMatchObject({
      exchangeRate: 0.0425,
      totalDeclaredCny: 30,
    });
    expect(result.shipments[1]).toMatchObject({
      exchangeRate: null,
      totalDeclaredCny: null,
    });
  });

  it("defaults the limit to 50", async () => {
    const h = harness();

    await h.service.list({});

    expect(h.prisma.shipment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });
});
