import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { ItemsController } from "./items/items.controller.js";
import { ItemsService } from "./items/items.service.js";
import { PrismaService } from "./prisma.service.js";
import { TimeController } from "./time.controller.js";
import { MetricsController } from "./metrics.controller.js";
import { MonitoringController } from "./monitoring/monitoring.controller.js";
import { MonitoringService } from "./monitoring/monitoring.service.js";
import { ImportsController } from "./imports/imports.controller.js";
import { ImportsService } from "./imports/imports.service.js";
import { AnalysisController } from "./analysis/analysis.controller.js";
import { AnalysisService } from "./analysis/analysis.service.js";
import { DiscoveryController } from "./discovery/discovery.controller.js";
import { DiscoveryService } from "./discovery/discovery.service.js";
import { MarketIntelController } from "./market-intel/market-intel.controller.js";
import { MarketIntelService } from "./market-intel/market-intel.service.js";
import { AiModule } from "./ai/ai.module.js";
import { CartController } from "./cart/cart.controller.js";
import { CartService } from "./cart/cart.service.js";
import { ExchangeRateController } from "./exchange-rate/exchange-rate.controller.js";
import { ExchangeRateService } from "./exchange-rate/exchange-rate.service.js";
import { LogisticsModule } from "./logistics/logistics.module.js";

@Module({
  imports: [AiModule, LogisticsModule],
  controllers: [
    HealthController,
    TimeController,
    MetricsController,
    MonitoringController,
    ItemsController,
    ImportsController,
    AnalysisController,
    DiscoveryController,
    MarketIntelController,
    CartController,
    ExchangeRateController,
  ],
  providers: [
    PrismaService,
    HealthService,
    ItemsService,
    MonitoringService,
    ImportsService,
    AnalysisService,
    DiscoveryService,
    MarketIntelService,
    CartService,
    ExchangeRateService,
  ],
})
export class AppModule {}
