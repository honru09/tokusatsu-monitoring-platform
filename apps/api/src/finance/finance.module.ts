import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { FinanceController } from "./finance.controller.js";
import { FinanceService } from "./finance.service.js";

@Module({
  controllers: [FinanceController],
  providers: [PrismaService, FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
