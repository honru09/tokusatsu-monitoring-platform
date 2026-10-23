import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { AiController } from "./ai.controller.js";
import { AiGatewayService } from "./ai-gateway.service.js";
import { AiSystemService } from "./ai-system.service.js";
import { SystemContextService } from "./system-context.service.js";
import { SystemToolRegistryService } from "./system-tool-registry.service.js";
import { PublicAiAccessGuard } from "./public-ai-access.guard.js";
import { AiSdkModelClient } from "./ai-sdk-model.client.js";
import { ProductAiService } from "./product-ai.service.js";

@Module({
  controllers: [AiController],
  providers: [
    PrismaService,
    AiSdkModelClient,
    AiGatewayService,
    ProductAiService,
    SystemContextService,
    SystemToolRegistryService,
    AiSystemService,
    PublicAiAccessGuard,
  ],
  exports: [
    AiGatewayService,
    ProductAiService,
    AiSystemService,
    SystemContextService,
  ],
})
export class AiModule {}
