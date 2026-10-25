import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { LogisticsService } from "./logistics.service.js";
import {
  LogisticsPatchDto,
  OptimizeLogisticsDto,
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

  @Post("optimize")
  optimize(@Body() body: OptimizeLogisticsDto) {
    return this.logistics.optimize(body);
  }
}
