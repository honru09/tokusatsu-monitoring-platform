import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { LogisticsService } from "./logistics.service.js";
import {
  CreateCarrierDto,
  CreateTariffDto,
  LogisticsPatchDto,
  OptimizeLogisticsDto,
  UpdateCarrierDto,
  UpdateTariffDto,
} from "./logistics.dto.js";

@Controller("logistics")
export class LogisticsController {
  constructor(private readonly logistics: LogisticsService) {}

  @Get("items")
  items(@Query("ids") ids?: string) {
    return this.logistics.listItems(
      ids
        ?.split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    );
  }

  @Patch("items/:id")
  updateItem(@Param("id") id: string, @Body() body: LogisticsPatchDto) {
    return this.logistics.updateItem(id, body);
  }

  @Post("items/:id/predict")
  predictItem(@Param("id") id: string) {
    return this.logistics.predictItem(id);
  }

  @Get("carriers")
  carriers() {
    return this.logistics.listCarriers();
  }

  @Post("carriers")
  createCarrier(@Body() body: CreateCarrierDto) {
    return this.logistics.createCarrier(body);
  }

  @Patch("carriers/:id")
  updateCarrier(@Param("id") id: string, @Body() body: UpdateCarrierDto) {
    return this.logistics.updateCarrier(id, body);
  }

  @Post("carriers/:carrierId/tariffs")
  createTariff(
    @Param("carrierId") carrierId: string,
    @Body() body: CreateTariffDto,
  ) {
    return this.logistics.createTariff(carrierId, body);
  }

  @Patch("tariffs/:id")
  updateTariff(@Param("id") id: string, @Body() body: UpdateTariffDto) {
    return this.logistics.updateTariff(id, body);
  }

  @Delete("tariffs/:id")
  deleteTariff(@Param("id") id: string) {
    return this.logistics.deleteTariff(id);
  }

  @Post("optimize")
  optimize(@Body() body: OptimizeLogisticsDto) {
    return this.logistics.optimize(body);
  }
}
