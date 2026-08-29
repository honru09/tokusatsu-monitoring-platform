import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";

@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const imports = await this.prisma.urlImport.findMany({
      include: {
        item: { select: { id: true, titleRaw: true, priceCurrent: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { imports, serverTime: new Date().toISOString() };
  }

  async get(id: string) {
    const record = await this.prisma.urlImport.findUnique({
      where: { id },
      include: { item: true },
    });
    return record ?? { id, status: "failed", errorText: "任务不存在" };
  }
}
