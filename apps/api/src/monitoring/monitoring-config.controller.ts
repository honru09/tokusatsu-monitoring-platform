import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import {
  CreateMonitoringCategoryDto,
  CreateMonitoringKeywordDto,
  MonitoringActorDto,
  UpdateMonitoringCategoryDto,
  UpdateMonitoringKeywordDto,
} from "./monitoring-config.dto.js";
import { MonitoringConfigService } from "./monitoring-config.service.js";

@Controller("monitoring")
export class MonitoringConfigController {
  constructor(private readonly config: MonitoringConfigService) {}

  @Get("config")
  get() {
    return this.config.get();
  }

  @Post("categories")
  createCategory(@Body() body: CreateMonitoringCategoryDto) {
    return this.config.createCategory(body);
  }

  @Patch("categories/:id")
  updateCategory(
    @Param("id") id: string,
    @Body() body: UpdateMonitoringCategoryDto,
  ) {
    return this.config.updateCategory(id, body);
  }

  @Post("keywords")
  createKeyword(@Body() body: CreateMonitoringKeywordDto) {
    return this.config.createKeyword(body);
  }

  @Patch("keywords/:id")
  updateKeyword(
    @Param("id") id: string,
    @Body() body: UpdateMonitoringKeywordDto,
  ) {
    return this.config.updateKeyword(id, body);
  }

  @Post("keywords/:id/run")
  run(@Param("id") id: string, @Body() body: MonitoringActorDto) {
    return this.config.run(id, body.accountId);
  }

  @Post("keywords/:id/reindex")
  reindex(@Param("id") id: string, @Body() body: MonitoringActorDto) {
    return this.config.reindex(id, body.accountId);
  }

  @Post("config/refresh")
  refresh(@Body() body: MonitoringActorDto) {
    return this.config.refresh(body.accountId);
  }
}
