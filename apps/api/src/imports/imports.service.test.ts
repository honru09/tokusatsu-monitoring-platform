import { describe, expect, it, vi } from "vitest";
import { ImportsService, publicImportError } from "./imports.service.js";

describe("ImportsService failure handling", () => {
  it("repairs stale persisted errors on successful imports once before listing them", async () => {
    const stored: {
      id: string;
      status: string;
      errorText: string | null;
    } = {
      id: "eventually-succeeded",
      status: "succeeded",
      errorText: "Error: first attempt failed",
    };
    const updateMany = vi.fn().mockImplementation(async () => {
      stored.errorText = null;
      return { count: 1 };
    });
    const prisma = {
      urlImport: {
        updateMany,
        findMany: vi.fn().mockImplementation(async () => [{ ...stored }]),
      },
    };
    const service = new ImportsService(prisma as never, {} as never);

    const first = await service.list();
    const second = await service.list();

    expect(first.imports[0]).toMatchObject({
      status: "succeeded",
      errorText: null,
    });
    expect(second.imports[0].errorText).toBeNull();
    expect(stored.errorText).toBeNull();
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { status: "succeeded", errorText: { not: null } },
      data: { errorText: null },
    });
  });

  it("does not expose a raw Prisma database error to the workspace", async () => {
    const prisma = {
      urlImport: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "old-failure",
            errorText:
              "PrismaClientUnknownRequestError: ConnectorError 42P10 query execution",
          },
        ]),
      },
    };
    const service = new ImportsService(prisma as never, {} as never);

    const result = await service.list();

    expect(result.imports[0].errorText).toBe(
      "旧任务受数据库升级影响，请重试。",
    );
    expect(result.imports[0].errorText).not.toContain("PrismaClient");
  });

  it("suppresses a stale error left by an earlier queue attempt after success", async () => {
    const prisma = {
      urlImport: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "eventually-succeeded",
            status: "succeeded",
            errorText: "Error: first attempt failed",
          },
        ]),
      },
    };
    const service = new ImportsService(prisma as never, {} as never);

    const result = await service.list();

    expect(result.imports[0]).toMatchObject({
      status: "succeeded",
      errorText: null,
    });
  });

  it("delegates retry to the URL queue without creating a second task card", async () => {
    const retryUrlImport = vi.fn().mockResolvedValue({
      accepted: true,
      importId: "failed-import",
    });
    const service = new ImportsService(
      {} as never,
      {
        retryUrlImport,
      } as never,
    );

    await expect(service.retry("failed-import")).resolves.toMatchObject({
      accepted: true,
      importId: "failed-import",
    });
    expect(retryUrlImport).toHaveBeenCalledWith("failed-import");
  });

  it("allows a terminal task record to be cleared but protects active work", async () => {
    const prisma = {
      urlImport: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: "running", status: "running" })
          .mockResolvedValueOnce({ id: "failed", status: "failed" }),
        delete: vi.fn().mockResolvedValue({ id: "failed" }),
      },
    };
    const service = new ImportsService(prisma as never, {} as never);

    await expect(service.remove("running")).rejects.toThrow(
      "进行中的链接分析任务不能清除",
    );
    await expect(service.remove("failed")).resolves.toEqual({
      removed: true,
      id: "failed",
    });
    expect(prisma.urlImport.delete).toHaveBeenCalledWith({
      where: { id: "failed" },
    });
  });

  it("truncates an unusually long public adapter error", () => {
    expect(publicImportError("x".repeat(500))).toHaveLength(240);
  });
});
