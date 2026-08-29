import { Controller, Get } from "@nestjs/common";
import { AnalysisService } from "./analysis.service.js";

@Controller("analysis")
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Get("market")
  market() {
    return this.analysis.market();
  }
}
