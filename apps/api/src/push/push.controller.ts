import { Body, Controller, Delete, Get, Post } from "@nestjs/common";
import { SubscribePushDto, UnsubscribePushDto } from "./push.dto.js";
import { PushService } from "./push.service.js";

@Controller("push")
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get("config")
  config() {
    return this.push.config();
  }

  @Post("subscriptions")
  subscribe(@Body() body: SubscribePushDto) {
    return this.push.subscribe(
      body.accountId,
      body.subscription,
      body.userAgent,
    );
  }

  @Delete("subscriptions")
  unsubscribe(@Body() body: UnsubscribePushDto) {
    return this.push.unsubscribe(body.accountId, body.endpoint);
  }
}
