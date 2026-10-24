import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ItemsService } from "../items/items.service.js";
import { PrismaService } from "../prisma.service.js";

export function publicImportError(errorText: string | null) {
  if (!errorText) return null;
  if (errorText.includes("42P10")) return "旧任务受数据库升级影响，请重试。";
  if (
    /PrismaClient|ConnectorError|Invalid `prisma\.|query execution/iu.test(
      errorText,
    )
  )
    return "后台保存暂时失败，请重试。";
  return errorText.length > 240 ? `${errorText.slice(0, 239)}…` : errorText;
}

function importForClient<
  T extends { errorText: string | null; status?: string },
>(record: T) {
  return {
    ...record,
    errorText:
      record.status === "succeeded"
        ? null
        : publicImportError(record.errorText),
  };
}

@Injectable()
export class ImportsService {
  private succeededImportErrorRepair?: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly items: ItemsService,
  ) {}

  async list() {
    await this.repairSucceededImportErrors();
    const imports = await this.prisma.urlImport.findMany({
      // Purchase-link analyses share the UrlImport table (origin
      // "purchase") but belong to the purchase workspace, not this list.
      where: { origin: "link" },
      include: {
        item: { select: { id: true, titleRaw: true, priceCurrent: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return {
      imports: imports.map(importForClient),
      serverTime: new Date().toISOString(),
    };
  }

  async get(id: string) {
    await this.repairSucceededImportErrors();
    const record = await this.prisma.urlImport.findUnique({
      where: { id },
      include: { item: true },
    });
    return record
      ? importForClient(record)
      : { id, status: "failed", errorText: "任务不存在" };
  }

  retry(id: string) {
    return this.items.retryUrlImport(id);
  }

  async remove(id: string) {
    const record = await this.prisma.urlImport.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!record) throw new NotFoundException("链接分析任务不存在");
    if (record.status === "queued" || record.status === "running")
      throw new BadRequestException("进行中的链接分析任务不能清除");
    await this.prisma.urlImport.delete({ where: { id } });
    return { removed: true, id };
  }

  private repairSucceededImportErrors() {
    if (!this.succeededImportErrorRepair) {
      this.succeededImportErrorRepair = Promise.resolve()
        .then(() =>
          this.prisma.urlImport.updateMany({
            where: { status: "succeeded", errorText: { not: null } },
            data: { errorText: null },
          }),
        )
        .then(() => undefined)
        .catch(() => {
          // Keep imports readable and retry the idempotent repair next time.
          this.succeededImportErrorRepair = undefined;
        });
    }
    return this.succeededImportErrorRepair;
  }
}
