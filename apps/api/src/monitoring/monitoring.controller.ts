import { Controller, Get } from "@nestjs/common";
import { MonitoringService } from "./monitoring.service.js";

@Controller("monitoring")
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get("overview")
  overview() {
    return this.monitoring.overview();
  }
}
