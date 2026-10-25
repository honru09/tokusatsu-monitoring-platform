import { Global, Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { AccountSessionGuard, SessionAuthGuard } from "./session.guard.js";

/**
 * Global so the app module can register AccountSessionGuard as APP_GUARD
 * (and any feature module can inject AuthService) without re-providing it.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [PrismaService, AuthService, SessionAuthGuard, AccountSessionGuard],
  exports: [AuthService, SessionAuthGuard, AccountSessionGuard],
})
export class AuthModule {}
