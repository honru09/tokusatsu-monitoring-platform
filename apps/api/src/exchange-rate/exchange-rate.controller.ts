import { Controller, Get } from "@nestjs/common";
import { ExchangeRateService } from "./exchange-rate.service.js";

@Controller("exchange-rate")
export class ExchangeRateController {
  constructor(private readonly exchangeRate: ExchangeRateService) {}

  @Get()
  current() {
    return this.exchangeRate.current();
  }
}
