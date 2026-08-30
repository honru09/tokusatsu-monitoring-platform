import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { CartService } from "./cart.service.js";
import { CreateCartShareDto, UpdateCartItemDto } from "./cart.dto.js";

@Controller("cart")
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  current() {
    return this.cart.current();
  }

  @Patch("items/:itemId")
  updateItem(@Param("itemId") itemId: string, @Body() body: UpdateCartItemDto) {
    return this.cart.updateItem(itemId, body.present);
  }

  @Post("share")
  share(@Body() body: CreateCartShareDto) {
    return this.cart.createShare(body.itemIds);
  }

  @Get("share/:token")
  shared(@Param("token") token: string) {
    return this.cart.shared(token);
  }
}
