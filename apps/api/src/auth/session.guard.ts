import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService, bearerToken } from "./auth.service.js";

type SessionRequest = {
  url?: string;
  originalUrl?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: unknown;
  body?: unknown;
  authAccountId?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestPath(request: SessionRequest): string {
  const rawUrl = request.url ?? request.originalUrl ?? "";
  return rawUrl.split("?")[0] || "/";
}

function requestMethod(request: SessionRequest): string {
  return (request.method ?? "GET").toUpperCase();
}

function tokenFromRequest(request: SessionRequest): string | null {
  return bearerToken(request.headers?.authorization);
}

/**
 * Utility guard: when a valid Bearer token is present it records the
 * authenticated account id on the request and allows the call; otherwise it
 * simply returns false without throwing.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<SessionRequest>();
    const verified = this.auth.verifyToken(tokenFromRequest(request));
    if (!verified) return false;
    request.authAccountId = verified.accountId;
    return true;
  }
}

/**
 * Global session enforcement policy (registered as APP_GUARD by the app
 * module):
 *
 * - Public routes stay open: /health, /time, /auth/login, GET /push/config
 *   and GET /cart/share/... (public share links). Every other route that is
 *   not in the protected set also passes through without a token — the API
 *   is internal and reached through the web proxy, and worker-called read
 *   endpoints must keep working.
 * - Protected routes (/collaboration/*, /push/subscriptions, /cart except
 *   public share links, POST /shipments) require a valid Bearer token.
 *   Identity is never trusted from the client on those routes: the token's
 *   account id overwrites query.accountId and body.accountId (and
 *   body.senderId on POST /collaboration/messages, plus body.actor when
 *   present).
 * - On non-protected routes a valid token, when present, still wins over a
 *   client-supplied identity: body.actor is overwritten, and body.accountId
 *   is overwritten on /items and /resale routes. An absent or invalid token
 *   leaves the request unchanged.
 */
@Injectable()
export class AccountSessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<SessionRequest>();
    const path = requestPath(request);
    const method = requestMethod(request);

    if (this.isPublic(path, method)) return true;

    if (this.isProtected(path, method)) {
      const verified = this.auth.verifyToken(tokenFromRequest(request));
      if (!verified) throw new UnauthorizedException("请先登录");
      const accountId = verified.accountId;
      request.authAccountId = accountId;
      if (isPlainObject(request.query)) {
        request.query.accountId = accountId;
      }
      if (isPlainObject(request.body)) {
        request.body.accountId = accountId;
        if (method === "POST" && path === "/collaboration/messages") {
          request.body.senderId = accountId;
        }
        if ("actor" in request.body) {
          request.body.actor = accountId;
        }
      }
      return true;
    }

    // Non-protected route: pass through, but a valid token still overrides
    // client-supplied identity fields where they are semantically the caller.
    const verified = this.auth.verifyToken(tokenFromRequest(request));
    if (verified) {
      const accountId = verified.accountId;
      request.authAccountId = accountId;
      if (isPlainObject(request.body)) {
        if ("actor" in request.body) {
          request.body.actor = accountId;
        }
        if (
          "accountId" in request.body &&
          (path.startsWith("/items") || path.startsWith("/resale"))
        ) {
          request.body.accountId = accountId;
        }
      }
    }
    return true;
  }

  private isPublic(path: string, method: string): boolean {
    if (path.startsWith("/health")) return true;
    if (path.startsWith("/time")) return true;
    if (path.startsWith("/auth/login")) return true;
    if (method === "GET" && path === "/push/config") return true;
    if (method === "GET" && path.startsWith("/cart/share/")) return true;
    return false;
  }

  private isProtected(path: string, method: string): boolean {
    if (path.startsWith("/collaboration")) return true;
    if (path.startsWith("/push/subscriptions")) return true;
    if (path === "/cart" || path.startsWith("/cart/")) {
      // GET /cart/share/... is handled as public above.
      return true;
    }
    if (
      method === "POST" &&
      (path === "/shipments" || path.startsWith("/shipments/"))
    ) {
      return true;
    }
    return false;
  }
}
