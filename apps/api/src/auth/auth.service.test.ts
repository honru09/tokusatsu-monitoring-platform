import { HttpException, UnauthorizedException } from "@nestjs/common";
import { randomBytes, scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "./auth.service.js";

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

const accountRow = {
  id: "manager-1",
  key: "wang",
  displayName: "王",
  avatarInitial: "王",
  position: 1,
  active: true,
  passwordHash: hashPassword("123456"),
};

function fixture() {
  const prisma = {
    managerAccount: {
      findFirst: vi.fn(
        ({ where }: { where: { loginCode?: string; id?: string; active: boolean } }) => {
          if (where.loginCode !== undefined) {
            return Promise.resolve(
              where.loginCode === "123456" ? accountRow : null,
            );
          }
          return Promise.resolve(
            where.id === "manager-1" ? accountRow : null,
          );
        },
      ),
    },
  };
  const service = new AuthService(prisma as never);
  return { prisma, service };
}

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-auth-secret-for-unit-tests");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AuthService.verifyPassword", () => {
  it("round-trips a scrypt hash generated with the production parameters", () => {
    const { service } = fixture();
    const stored = hashPassword("correct horse");
    expect(service.verifyPassword("correct horse", stored)).toBe(true);
    expect(service.verifyPassword("wrong", stored)).toBe(false);
  });

  it("rejects malformed stored hashes", () => {
    const { service } = fixture();
    expect(service.verifyPassword("x", null)).toBe(false);
    expect(service.verifyPassword("x", undefined)).toBe(false);
    expect(service.verifyPassword("x", "")).toBe(false);
    expect(service.verifyPassword("x", "not-a-hash")).toBe(false);
    expect(service.verifyPassword("x", "scrypt$only-two")).toBe(false);
    expect(service.verifyPassword("x", "bcrypt$AAAA$BBBB")).toBe(false);
    expect(service.verifyPassword("x", "scrypt$$")).toBe(false);
  });
});

describe("AuthService tokens", () => {
  it("signs and verifies a token", () => {
    const { service } = fixture();
    const token = service.signToken("manager-1");
    expect(token.startsWith("v1.")).toBe(true);
    expect(service.verifyToken(token)).toEqual({ accountId: "manager-1" });
  });

  it("rejects a tampered token", () => {
    const { service } = fixture();
    const token = service.signToken("manager-1");
    const [version, payload, signature] = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: "manager-2", iat: 1, exp: 9999999999 }),
      "utf8",
    ).toString("base64url");
    expect(
      service.verifyToken(`${version}.${tamperedPayload}.${signature}`),
    ).toBeNull();
    expect(
      service.verifyToken(`${version}.${payload}.${signature.slice(0, -2)}aa`),
    ).toBeNull();
    expect(service.verifyToken("garbage")).toBeNull();
    expect(service.verifyToken(null)).toBeNull();
    expect(service.verifyToken("")).toBeNull();
  });

  it("rejects an expired token", () => {
    const { service } = fixture();
    const expired = service.signToken("manager-1", -60);
    expect(service.verifyToken(expired)).toBeNull();
  });
});

describe("AuthService.login", () => {
  it("returns a token and the account summary on success", async () => {
    const { service } = fixture();
    const result = await service.login("123456", "123456");
    expect(result.account).toEqual({
      id: "manager-1",
      key: "wang",
      displayName: "王",
      avatarInitial: "王",
      position: 1,
    });
    expect(service.verifyToken(result.token)).toEqual({
      accountId: "manager-1",
    });
    expect(JSON.stringify(result)).not.toContain("passwordHash");
  });

  it("rejects a wrong password and an unknown code with the same error", async () => {
    const { service } = fixture();
    await expect(service.login("123456", "wrong")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.login("999999", "123456")).rejects.toMatchObject({
      message: "账号或密码不正确",
    });
  });

  it("locks after five consecutive failures and rejects even the correct password while locked", async () => {
    const { service } = fixture();
    for (let i = 0; i < 5; i += 1) {
      await expect(service.login("123456", "wrong")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    const locked = await service
      .login("123456", "123456")
      .catch((error: unknown) => error);
    expect(locked).toBeInstanceOf(HttpException);
    expect((locked as HttpException).getStatus()).toBe(429);
    expect((locked as HttpException).message).toBe("尝试过于频繁，请稍后再试");
  });

  it("resets the failure count after a successful login", async () => {
    const { service } = fixture();
    for (let i = 0; i < 4; i += 1) {
      await expect(service.login("123456", "wrong")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    await expect(service.login("123456", "123456")).resolves.toMatchObject({
      account: { id: "manager-1" },
    });
    // Four more failures after the reset must not lock the account.
    for (let i = 0; i < 4; i += 1) {
      await expect(service.login("123456", "wrong")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    await expect(service.login("123456", "123456")).resolves.toMatchObject({
      account: { id: "manager-1" },
    });
  });
});

describe("AuthService.accountForToken", () => {
  it("returns the summary for a valid token and null otherwise", async () => {
    const { service } = fixture();
    const token = service.signToken("manager-1");
    await expect(service.accountForToken(token)).resolves.toEqual({
      id: "manager-1",
      key: "wang",
      displayName: "王",
      avatarInitial: "王",
      position: 1,
    });
    await expect(service.accountForToken("garbage")).resolves.toBeNull();
    await expect(service.accountForToken(null)).resolves.toBeNull();
    const unknown = service.signToken("manager-unknown");
    await expect(service.accountForToken(unknown)).resolves.toBeNull();
  });
});
