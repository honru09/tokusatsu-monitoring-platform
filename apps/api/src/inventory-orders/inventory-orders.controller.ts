import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import {
  AdjustInventoryOrderDto,
  CreateInventoryOrderDto,
  ListInventoryOrdersQuery,
  SellInventoryOrderDto,
} from "./inventory-orders.dto.js";
import { InventoryOrdersService } from "./inventory-orders.service.js";

@Controller("inventory-orders")
export class InventoryOrdersController {
  constructor(private readonly orders: InventoryOrdersService) {}

  @Get()
  list(@Query() query: ListInventoryOrdersQuery) {
    return this.orders.list(query);
  }

  @Post()
  create(@Body() body: CreateInventoryOrderDto) {
    return this.orders.create(body);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.orders.get(id);
  }

  @Post(":id/sell")
  sell(@Param("id") id: string, @Body() body: SellInventoryOrderDto) {
    return this.orders.sell(id, body);
  }

  @Post(":id/adjust")
  adjust(@Param("id") id: string, @Body() body: AdjustInventoryOrderDto) {
    return this.orders.adjust(id, body);
  }
}
