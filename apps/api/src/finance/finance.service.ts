import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const [bundleAggregate, salesAggregate] = await Promise.all([
      this.prisma.purchaseBundle.aggregate({
        _sum: { totalPurchaseAmount: true },
      }),
      // Income comes from sales_records (JPY): ResaleListing has no sold
      // status or JPY sale price — its statuses are a listing pipeline
      // (draft/queued/published/...), so it cannot represent sale income.
      this.prisma.salesRecord.aggregate({
        _sum: { salePrice: true },
      }),
    ]);

    const totalCostYen = bundleAggregate._sum.totalPurchaseAmount ?? 0;
    const totalIncomeYen = salesAggregate._sum.salePrice ?? 0;

    return {
      totalCostYen,
      totalIncomeYen,
      netProfitYen: totalIncomeYen - totalCostYen,
      serverTime: new Date().toISOString(),
    };
  }
}
