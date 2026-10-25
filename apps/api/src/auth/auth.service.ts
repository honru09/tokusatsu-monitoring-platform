import {
  HttpException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { PrismaService } from "../prisma.service.js";

export type ManagerAccountSummary = {
  id: string;
  key: string;
  displayName: string;
  avatarInitial: string;
  position: number;
};

type ManagerAccountRow = {
  id: string;
  key: string;
  displayName: string;
  avatarInitial: string;
  position: number;
  active: boolean;
  passwordHash: string | null;
};

// The generated Prisma client can lag the schema in some environments (the
// loginCode column is newer than the checked-in client), so account lookups
// go through this narrow structural view, mirroring the pattern used by
// NegotiationScriptService for ShareRound.
type ManagerAccountPrisma = {
  managerAccount: {
    findFirst(args: {
      where:
        | { loginCode: string; active: true }
        | { id: string; active: true };
    }): Promise<ManagerAccountRow | null>;
  };
};

export function bearerToken(
  authorization: string | string[] | undefined,
): string | null {
  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return (match ? match[1] : value).trim() || null;
}

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_CONSECUTIVE_FAILURES = 5;
const LOCK_DURATION_MS = 5 * 60 * 1_000;

type FailureState = {
  count: number;
  lockedUntil: number;
};

@Injectable()
export class AuthService {
  private readonly secret: string;
  private readonly failures = new Map<string, FailureState>();

  constructor(private readonly prisma: PrismaService) {
    const configured = process.env.AUTH_SECRET;
    if (configured) {
      this.secret = configured;
    } else {
      this.secret = randomBytes(32).toString("base64url");
      console.warn(
        "AUTH_SECRET is not set; generated an ephemeral auth secret, so sessions will not survive restarts.",
      );
    }
  }

  private accounts(): ManagerAccountPrisma {
    return this.prisma as unknown as ManagerAccountPrisma;
  }

  signToken(accountId: string, ttlSeconds: number = TOKEN_TTL_SECONDS): string {
    const iat = Math.floor(Date.now() / 1_000);
    const payload = { sub: accountId, iat, exp: iat + ttlSeconds };
    const payloadPart = `v1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
    const signature = createHmac("sha256", this.secret)
      .update(payloadPart)
      .digest();
    return `${payloadPart}.${signature.toString("base64url")}`;
  }

  verifyToken(token: unknown): { accountId: string } | null {
    if (typeof token !== "string" || !token) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") return null;
    const payloadPart = `${parts[0]}.${parts[1]}`;
    let actual: Buffer;
    try {
      actual = Buffer.from(parts[2], "base64url");
    } catch {
      return null;
    }
    const expected = createHmac("sha256", this.secret)
      .update(payloadPart)
      .digest();
    if (actual.length !== expected.length) return null;
    if (!timingSafeEqual(actual, expected)) return null;
    let payload: { sub?: unknown; iat?: unknown; exp?: unknown };
    try {
      payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf8"),
      ) as { sub?: unknown; iat?: unknown; exp?: unknown };
    } catch {
      return null;
    }
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    if (typeof payload.exp !== "number") return null;
    if (payload.exp <= Math.floor(Date.now() / 1_000)) return null;
    return { accountId: payload.sub };
  }

  verifyPassword(password: string, stored: string | null | undefined): boolean {
    if (!stored) return false;
    const parts = stored.split("$");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;
    let salt: Buffer;
    let expected: Buffer;
    try {
      salt = Buffer.from(parts[1], "base64");
      expected = Buffer.from(parts[2], "base64");
    } catch {
      return false;
    }
    if (!salt.length || expected.length !== 64) return false;
    let computed: Buffer;
    try {
      computed = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    } catch {
      return false;
    }
    return timingSafeEqual(computed, expected);
  }

  async login(
    code: string,
    password: string,
  ): Promise<{ token: string; account: ManagerAccountSummary }> {
    const now = Date.now();
    const state = this.failures.get(code);
    if (state && state.lockedUntil > now) {
      throw new HttpException("尝试过于频繁，请稍后再试", 429);
    }
    if (state && state.lockedUntil && state.lockedUntil <= now) {
      this.failures.delete(code);
    }

    const account = await this.accounts().managerAccount.findFirst({
      where: { loginCode: code, active: true },
    });

    if (
      !account ||
      !account.passwordHash ||
      !this.verifyPassword(password, account.passwordHash)
    ) {
      this.recordFailure(code);
      throw new UnauthorizedException("账号或密码不正确");
    }

    this.failures.delete(code);
    return {
      token: this.signToken(account.id),
      account: this.summary(account),
    };
  }

  async accountForToken(
    token: string | null | undefined,
  ): Promise<ManagerAccountSummary | null> {
    const verified = this.verifyToken(token);
    if (!verified) return null;
    const account = await this.accounts().managerAccount.findFirst({
      where: { id: verified.accountId, active: true },
    });
    if (!account) return null;
    return this.summary(account);
  }

  private recordFailure(code: string) {
    const now = Date.now();
    const state = this.failures.get(code) ?? { count: 0, lockedUntil: 0 };
    state.count += 1;
    if (state.count >= MAX_CONSECUTIVE_FAILURES) {
      state.lockedUntil = now + LOCK_DURATION_MS;
    }
    this.failures.set(code, state);
  }

  private summary(account: ManagerAccountRow): ManagerAccountSummary {
    return {
      id: account.id,
      key: account.key,
      displayName: account.displayName,
      avatarInitial: account.avatarInitial,
      position: account.position,
    };
  }
}
