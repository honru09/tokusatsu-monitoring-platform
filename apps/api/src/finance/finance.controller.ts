import { Controller, Get } from "@nestjs/common";
import { FinanceService } from "./finance.service.js";

@Controller("finance")
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get("summary")
  summary() {
    return this.finance.summary();
  }
}
