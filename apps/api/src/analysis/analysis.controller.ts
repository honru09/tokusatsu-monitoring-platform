import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { AnalysisService } from "./analysis.service.js";
import { TranslateDto } from "./analysis.dto.js";

@Controller("analysis")
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Get("market")
  market() {
    return this.analysis.market();
  }

  @Post("translate")
  translate(
    @Body() body: TranslateDto,
    @Query("costPolicy") costPolicy?: string,
  ) {
    return this.analysis.translate(
      body,
      costPolicy === "free_only" ? "free_only" : undefined,
    );
  }

  @Get("item/:id")
  item(
    @Param("id") id: string,
    @Query("refresh") refresh?: string,
    @Query("costPolicy") costPolicy?: string,
  ) {
    return this.analysis.itemTranslation(
      id,
      refresh === "true",
      costPolicy === "free_only" ? "free_only" : undefined,
    );
  }

  @Get("seller/:id")
  seller(
    @Param("id") id: string,
    @Query("targetPrice") targetPrice?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    const parsed = targetPrice == null ? undefined : Number(targetPrice);
    return this.analysis.seller(
      id,
      parsed != null && Number.isFinite(parsed) && parsed >= 0
        ? parsed
        : undefined,
      Number(page ?? 1),
      Number(limit ?? 48),
    );
  }

  @Post("seller/:id/refresh")
  refreshSeller(@Param("id") id: string) {
    return this.analysis.refreshSeller(id);
  }
}
