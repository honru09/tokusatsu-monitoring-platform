import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ImportResaleDto,
  ResaleActionDto,
  ResaleActorDto,
  ResaleVersionDto,
  ResaleQueryDto,
  UpdateResaleDto,
  UpdateResaleSettingsDto,
  ResaleBulkDto,
  ResaleMonitorDto,
  ResaleObservationDto,
  ResaleMetricsQueryDto,
  ResaleMetricDto,
  ResaleMetricSyncDto,
  ResaleTaskDto,
  ResaleTaskResultDto,
} from "./resale.dto.js";
import { ResaleService } from "./resale.service.js";
import { ResaleOperationsService } from "./resale-operations.service.js";
import { XianyuSessionService } from "./xianyu-session.service.js";

@Controller("resale")
export class ResaleController {
  constructor(
    private readonly resale: ResaleService,
    private readonly operations: ResaleOperationsService,
    private readonly session: XianyuSessionService,
  ) {}
  @Get() list(@Query() query: ResaleQueryDto) {
    return this.resale.list(query);
  }
  @Get("candidates") candidates(@Query() query: ResaleQueryDto) {
    return this.resale.candidates(query);
  }
  @Get("account") account() { return this.session.status(); }
  @Post("account/login") login(@Body() body: ResaleActorDto) { return this.session.start(body.accountId); }
  @Post("account/disconnect") disconnect(@Body() body: ResaleActorDto) { return this.session.disconnect(body.accountId); }
  @Post(":id/prepare") prepare(@Param("id") id: string, @Body() body: ResaleVersionDto) { return this.session.prepare(id, body.version, body.accountId); }
  @Post("import") import(@Body() body: ImportResaleDto) {
    return this.resale.import(body);
  }
  @Patch("settings") settings(@Body() body: UpdateResaleSettingsDto) {
    return this.resale.updateSettings(body);
  }
  @Post("run") async run(@Body() body: ResaleActorDto) {
    const result = await this.resale.run(body.accountId);
    void this.operations.tick().catch(() => {});
    return result;
  }
  @Post("bulk") bulk(@Body() body: ResaleBulkDto) {
    return this.resale.bulk(body);
  }
  @Get("operations") overview() {
    return this.operations.overview();
  }
  @Post("monitors") monitor(@Body() body: ResaleMonitorDto) {
    return this.operations.saveMonitor(body);
  }
  @Post("monitors/:id/scan") scan(
    @Param("id") id: string,
    @Body() body: ResaleActorDto,
  ) {
    return this.operations.scan(id, body.accountId);
  }
  @Post("monitors/:id/import") observations(
    @Param("id") id: string,
    @Body() body: ResaleObservationDto,
  ) {
    return this.operations.ingest(id, body);
  }
  @Post("discoveries/read") readDiscoveries(@Body() body: ResaleActorDto) {
    return this.operations.markRead(body.accountId);
  }
  @Get("metrics") metrics(@Query() query: ResaleMetricsQueryDto) {
    return this.operations.metrics(query.days);
  }
  @Post("metrics") metric(@Body() body: ResaleMetricDto) {
    return this.operations.saveMetric(body);
  }
  @Post("metrics/sync") syncMetrics(@Body() body: ResaleMetricSyncDto) {
    return this.operations.syncMetric(body.listingId, body.accountId);
  }
  @Get("metrics.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="xianyu-metrics.csv"')
  csv(@Query() query: ResaleMetricsQueryDto) {
    return this.operations.csv(query.days);
  }
  @Post("tasks") task(@Body() body: ResaleTaskDto) {
    return this.operations.createTask(body);
  }
  @Post("tasks/:id/actions") taskResult(
    @Param("id") id: string,
    @Body() body: ResaleTaskResultDto,
  ) {
    return this.operations.resolveTask(id, body);
  }
  @Get(":id") get(@Param("id") id: string) {
    return this.resale.get(id);
  }
  @Patch(":id") update(@Param("id") id: string, @Body() body: UpdateResaleDto) {
    return this.resale.update(id, body);
  }
  @Post(":id/actions") action(
    @Param("id") id: string,
    @Body() body: ResaleActionDto,
  ) {
    return this.resale.action(id, body);
  }
}
