import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { AiController } from "./ai.controller.js";
import { AiGatewayService } from "./ai-gateway.service.js";
import { AiSystemService } from "./ai-system.service.js";
import { SystemContextService } from "./system-context.service.js";
import { SystemToolRegistryService } from "./system-tool-registry.service.js";
import { PublicAiAccessGuard } from "./public-ai-access.guard.js";

@Module({
  controllers: [AiController],
  providers: [
    PrismaService,
    AiGatewayService,
    SystemContextService,
    SystemToolRegistryService,
    AiSystemService,
    PublicAiAccessGuard,
  ],
  exports: [AiGatewayService, AiSystemService, SystemContextService],
})
export class AiModule {}
