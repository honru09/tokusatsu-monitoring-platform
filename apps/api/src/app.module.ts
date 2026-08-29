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

@Module({
  controllers: [
    HealthController,
    TimeController,
    MetricsController,
    MonitoringController,
    ItemsController,
    ImportsController,
    AnalysisController,
    DiscoveryController,
  ],
  providers: [
    PrismaService,
    HealthService,
    ItemsService,
    MonitoringService,
    ImportsService,
    AnalysisService,
    DiscoveryService,
  ],
})
export class AppModule {}
