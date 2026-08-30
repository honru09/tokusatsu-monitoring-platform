import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ItemsService } from "./items.service.js";
import {
  AnalyzeUrlDto,
  ItemChangesQuery,
  ListItemsQuery,
  ListSellersQuery,
  PurchaseDto,
  UpdateItemDto,
} from "./items.dto.js";

@Controller("items")
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  list(@Query() query: ListItemsQuery) {
    return this.items.list(query);
  }

  @Post("analyze-url")
  analyzeUrl(@Body() body: AnalyzeUrlDto) {
    return this.items.analyzeUrl(body.url);
  }

  @Get("purchases")
  purchases() {
    return this.items.listPurchases();
  }

  @Get("changes")
  changes(@Query() query: ItemChangesQuery) {
    return this.items.changes(query.since);
  }

  @Get("sellers")
  sellers(@Query() query: ListSellersQuery) {
    return this.items.listSellers(
      query.search,
      query.page,
      query.limit,
      query.segment,
    );
  }

  @Get("sellers/:id")
  seller(
    @Param("id") id: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.items.getSeller(id, Number(page ?? 1), Number(limit ?? 48));
  }

  @Get("reviews/pending")
  pendingReviews() {
    return this.items.pendingReviews();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.items.get(id);
  }

  @Get(":id/audit")
  audit(@Param("id") id: string) {
    return this.items.audit(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: UpdateItemDto) {
    return this.items.update(id, body);
  }

  @Post(":id/purchase")
  purchase(@Param("id") id: string, @Body() body: PurchaseDto) {
    return this.items.purchase(id, body);
  }

  @Get(":id/purchase/receipts/:receiptId")
  receipt(@Param("id") id: string, @Param("receiptId") receiptId: string) {
    return this.items.receipt(id, receiptId);
  }
}
