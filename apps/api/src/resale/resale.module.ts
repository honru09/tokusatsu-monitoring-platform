import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module.js";
import { PrismaService } from "../prisma.service.js";
import { ResaleController } from "./resale.controller.js";
import { ResalePublisher } from "./resale-publisher.js";
import { ResaleService } from "./resale.service.js";
import { ResaleOperationsService } from "./resale-operations.service.js";
import { XianyuSessionService } from "./xianyu-session.service.js";

@Module({
  imports: [AiModule],
  controllers: [ResaleController],
  providers: [
    PrismaService,
    ResalePublisher,
    ResaleService,
    ResaleOperationsService,
    XianyuSessionService,
  ],
})
export class ResaleModule {}
