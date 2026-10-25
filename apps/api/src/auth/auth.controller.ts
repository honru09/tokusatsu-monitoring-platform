import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { LoginDto } from "./auth.dto.js";
import { AuthService, bearerToken } from "./auth.service.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  login(@Body() body: LoginDto) {
    return this.auth.login(body.code, body.password);
  }

  @Get("me")
  async me(@Headers("authorization") authorization?: string) {
    const account = await this.auth.accountForToken(bearerToken(authorization));
    if (!account) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
    return { account };
  }
}
