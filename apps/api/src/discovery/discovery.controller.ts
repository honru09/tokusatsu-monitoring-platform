import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import {
  DiscoveryFeedbackDto,
  DiscoveryFeedQuery,
  DiscoveryUndoDto,
} from "./discovery.dto.js";
import { DiscoveryService } from "./discovery.service.js";

@Controller("discovery")
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get()
  feed(@Query() query: DiscoveryFeedQuery) {
    return this.discovery.feed(query.limit, query.listingType);
  }

  @Post("feedback")
  feedback(@Body() body: DiscoveryFeedbackDto) {
    return this.discovery.feedback(body);
  }

  @Post("undo")
  undo(@Body() body: DiscoveryUndoDto) {
    return this.discovery.undo(body.feedbackId);
  }
}
