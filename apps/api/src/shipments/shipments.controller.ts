import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { CreateShipmentDto, ListShipmentsQuery } from "./shipments.dto.js";
import { ShipmentsService } from "./shipments.service.js";

@Controller("shipments")
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Post()
  create(@Body() body: CreateShipmentDto) {
    return this.shipments.create(body);
  }

  @Get()
  list(@Query() query: ListShipmentsQuery) {
    return this.shipments.list(query);
  }
}
