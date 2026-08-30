import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { MarketIntelService } from "./market-intel.service.js";

@Controller("market-intel")
export class MarketIntelController {
  constructor(private readonly marketIntel: MarketIntelService) {}

  @Get()
  list(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("kind") kind?: string,
    @Query("search") search?: string,
  ) {
    return this.marketIntel.list({
      page: Number(page ?? 1),
      limit: Number(limit ?? 30),
      kind,
      search,
    });
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.marketIntel.get(id);
  }

  @Post("refresh")
  refresh() {
    return this.marketIntel.refresh();
  }
}
