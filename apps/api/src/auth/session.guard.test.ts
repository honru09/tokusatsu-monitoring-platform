import { UnauthorizedException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "./auth.service.js";
import { AccountSessionGuard, SessionAuthGuard } from "./session.guard.js";

type FakeRequest = {
  url: string;
  method: string;
  headers: Record<string, string | undefined>;
  query: Record<string, unknown>;
  body: Record<string, unknown>;
  authAccountId?: string;
};

function makeAuth() {
  const prisma = {
    managerAccount: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return new AuthService(prisma as never);
}

function contextFor(request: FakeRequest) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

function request(overrides: Partial<FakeRequest> = {}): FakeRequest {
  return {
    url: "/collaboration/messages",
    method: "POST",
    headers: {},
    query: {},
    body: {},
    ...overrides,
  };
}

let auth: AuthService;
let token: string;

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-auth-secret-for-guard-tests");
  auth = makeAuth();
  token = auth.signToken("manager-1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SessionAuthGuard", () => {
  it("accepts a valid Bearer token and records the account id", () => {
    const guard = new SessionAuthGuard(auth);
    const req = request({ headers: { authorization: `Bearer ${token}` } });
    expect(guard.canActivate(contextFor(req))).toBe(true);
    expect(req.authAccountId).toBe("manager-1");
  });

  it("returns false without throwing for a missing or invalid token", () => {
    const guard = new SessionAuthGuard(auth);
    expect(guard.canActivate(contextFor(request()))).toBe(false);
    const bad = request({ headers: { authorization: "Bearer garbage" } });
    expect(guard.canActivate(contextFor(bad))).toBe(false);
    expect(bad.authAccountId).toBeUndefined();
  });
});

describe("AccountSessionGuard", () => {
  it("rejects a protected route without a token", () => {
    const guard = new AccountSessionGuard(auth);
    expect(() => guard.canActivate(contextFor(request()))).toThrow(
      UnauthorizedException,
    );
    const bad = request({ headers: { authorization: "Bearer garbage" } });
    expect(() => guard.canActivate(contextFor(bad))).toThrow(
      UnauthorizedException,
    );
  });

  it("forces identity from the token on a protected route", () => {
    const guard = new AccountSessionGuard(auth);
    const req = request({
      headers: { authorization: `Bearer ${token}` },
      query: { accountId: "manager-2" },
      body: { accountId: "manager-2", senderId: "manager-2", text: "hi" },
    });
    expect(guard.canActivate(contextFor(req))).toBe(true);
    expect(req.authAccountId).toBe("manager-1");
    expect(req.query.accountId).toBe("manager-1");
    expect(req.body.accountId).toBe("manager-1");
    // POST /collaboration/messages: the sender is always the token account.
    expect(req.body.senderId).toBe("manager-1");
    expect(req.body.text).toBe("hi");
  });

  it("overwrites body.actor on a protected route when present", () => {
    const guard = new AccountSessionGuard(auth);
    const req = request({
      url: "/push/subscriptions",
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: { actor: "manager-2", endpoint: "https://example.com" },
    });
    expect(guard.canActivate(contextFor(req))).toBe(true);
    expect(req.body.actor).toBe("manager-1");
    expect(req.body.accountId).toBe("manager-1");
    expect(req.body.senderId).toBeUndefined();
  });

  it("requires a token for cart and POST /shipments, but not for public share links", () => {
    const guard = new AccountSessionGuard(auth);
    expect(() =>
      guard.canActivate(
        contextFor(request({ url: "/cart", method: "GET" })),
      ),
    ).toThrow(UnauthorizedException);
    expect(() =>
      guard.canActivate(
        contextFor(request({ url: "/shipments", method: "POST" })),
      ),
    ).toThrow(UnauthorizedException);
    expect(
      guard.canActivate(
        contextFor(request({ url: "/cart/share/abc123", method: "GET" })),
      ),
    ).toBe(true);
    // Creating a share is not the public link: it stays protected.
    expect(() =>
      guard.canActivate(
        contextFor(request({ url: "/cart/share", method: "POST" })),
      ),
    ).toThrow(UnauthorizedException);
  });

  it("lets public routes through without a token and without mutation", () => {
    const guard = new AccountSessionGuard(auth);
    for (const pub of [
      request({ url: "/health", method: "GET" }),
      request({ url: "/time", method: "GET" }),
      request({ url: "/auth/login", method: "POST" }),
      request({ url: "/push/config", method: "GET" }),
    ]) {
      expect(guard.canActivate(contextFor(pub))).toBe(true);
      expect(pub.body).toEqual({});
      expect(pub.authAccountId).toBeUndefined();
    }
  });

  it("passes non-protected routes through unchanged without a token", () => {
    const guard = new AccountSessionGuard(auth);
    const req = request({
      url: "/items/abc/favorite",
      method: "POST",
      body: { actor: "manager-2", accountId: "manager-2" },
    });
    expect(guard.canActivate(contextFor(req))).toBe(true);
    expect(req.body.actor).toBe("manager-2");
    expect(req.body.accountId).toBe("manager-2");
  });

  it("overrides actor and accountId from a valid token on non-protected /items and /resale routes", () => {
    const guard = new AccountSessionGuard(auth);
    const itemsReq = request({
      url: "/items/abc/favorite",
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: { actor: "manager-2", accountId: "manager-2" },
    });
    expect(guard.canActivate(contextFor(itemsReq))).toBe(true);
    expect(itemsReq.body.actor).toBe("manager-1");
    expect(itemsReq.body.accountId).toBe("manager-1");

    const resaleReq = request({
      url: "/resale/listings",
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: { accountId: "manager-2" },
    });
    expect(guard.canActivate(contextFor(resaleReq))).toBe(true);
    expect(resaleReq.body.accountId).toBe("manager-1");
  });

  it("does not override accountId on other non-protected routes", () => {
    const guard = new AccountSessionGuard(auth);
    const req = request({
      url: "/monitoring/run",
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: { accountId: "manager-2" },
    });
    expect(guard.canActivate(contextFor(req))).toBe(true);
    expect(req.body.accountId).toBe("manager-2");
  });

  it("strips the query string before matching routes", () => {
    const guard = new AccountSessionGuard(auth);
    const req = request({
      url: "/collaboration/messages?accountId=manager-2",
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(guard.canActivate(contextFor(req))).toBe(true);
    expect(req.query.accountId).toBe("manager-1");
  });
});
