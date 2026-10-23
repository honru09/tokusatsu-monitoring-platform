import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { InventoryOrdersController } from "./inventory-orders.controller.js";
import { InventoryOrdersService } from "./inventory-orders.service.js";

@Module({
  controllers: [InventoryOrdersController],
  providers: [PrismaService, InventoryOrdersService],
  exports: [InventoryOrdersService],
})
export class InventoryOrdersModule {}
