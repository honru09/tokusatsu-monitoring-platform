import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { ShipmentsController } from "./shipments.controller.js";
import { ShipmentsService } from "./shipments.service.js";

@Module({
  controllers: [ShipmentsController],
  providers: [PrismaService, ShipmentsService],
  exports: [ShipmentsService],
})
export class ShipmentsModule {}
