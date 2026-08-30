import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module.js";
import { PrismaService } from "../prisma.service.js";
import { LogisticsController } from "./logistics.controller.js";
import { LogisticsService } from "./logistics.service.js";

@Module({
  imports: [AiModule],
  controllers: [LogisticsController],
  providers: [PrismaService, LogisticsService],
})
export class LogisticsModule {}
