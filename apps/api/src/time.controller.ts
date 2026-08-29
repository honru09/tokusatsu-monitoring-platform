import { Controller, Get } from "@nestjs/common";

@Controller("time")
export class TimeController {
  @Get()
  now() {
    return { serverTime: new Date().toISOString() };
  }
}
