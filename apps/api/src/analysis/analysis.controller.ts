import { Body, Controller, Get, Post } from "@nestjs/common";
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
  translate(@Body() body: TranslateDto) {
    return this.analysis.translate(body);
  }
}
