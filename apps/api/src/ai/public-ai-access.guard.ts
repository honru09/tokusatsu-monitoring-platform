import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
  SetMetadata,
  UseGuards,
  applyDecorators,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { isIP } from "node:net";
import type { AiCostPolicy } from "./ai-model-catalog.js";

type PublicAiEndpoint = "chat" | "diagnose" | "reading";

type PublicAiRequest = {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
};

type PublicAiResponse = {
  setHeader?: (name: string, value: string | number) => void;
};

type RateBucket = {
  count: number;
  expiresAt: number;
};

const PUBLIC_AI_ENDPOINT = "public-ai-endpoint";
const DEFAULT_TRUSTED_PROXY_CIDRS = "127.0.0.1/32,::1,172.16.0.0/12";

export const PublicAiAccess = (endpoint: PublicAiEndpoint) =>
  applyDecorators(
    SetMetadata(PUBLIC_AI_ENDPOINT, endpoint),
    UseGuards(PublicAiAccessGuard),
  );

export function publicAiCostPolicy(): AiCostPolicy {
  const configured = process.env.AI_PUBLIC_COST_POLICY?.trim();
  if (configured === "free_only") return configured;
  if (
    process.env.AI_PUBLIC_ALLOW_PAID_MODELS === "true" &&
    (configured === "free_first" || configured === "paid_allowed")
  )
    return configured;
  return "free_only";
}

@Injectable()
export class PublicAiAccessGuard implements CanActivate, OnModuleDestroy {
  private readonly buckets = new Map<string, RateBucket>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(private readonly reflector: Reflector) {
    const intervalMs = this.integerEnv(
      "AI_PUBLIC_RATE_LIMIT_CLEANUP_MS",
      60_000,
      1_000,
      60 * 60_000,
    );
    this.cleanupTimer = setInterval(() => this.cleanup(Date.now()), intervalMs);
    this.cleanupTimer.unref?.();
  }

  canActivate(context: ExecutionContext): boolean {
    const endpoint = this.reflector.get<PublicAiEndpoint>(
      PUBLIC_AI_ENDPOINT,
      context.getHandler(),
    );
    if (!endpoint) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<PublicAiRequest>();
    const response = http.getResponse<PublicAiResponse>();
    this.consume(endpoint, this.clientIp(request), response);
    return true;
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  private consume(
    endpoint: PublicAiEndpoint,
    clientIp: string,
    response: PublicAiResponse,
  ) {
    const now = Date.now();
    const { limit, windowMs } = this.policy(endpoint);
    const key = `${endpoint}:${clientIp}`;
    let bucket = this.buckets.get(key);
    if (bucket && bucket.expiresAt <= now) {
      this.buckets.delete(key);
      bucket = undefined;
    }

    if (!bucket) {
      this.makeRoom(now);
      bucket = { count: 0, expiresAt: now + windowMs };
    }

    if (bucket.count >= limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((bucket.expiresAt - now) / 1_000),
      );
      response.setHeader?.("Retry-After", retryAfterSeconds);
      throw new HttpException(
        {
          code: "AI_PUBLIC_RATE_LIMITED",
          message: "AI 请求过于频繁，请稍后重试",
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    bucket.count += 1;
    // Refresh insertion order so the capacity eviction behaves as a small LRU.
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    response.setHeader?.("X-RateLimit-Limit", limit);
    response.setHeader?.("X-RateLimit-Remaining", limit - bucket.count);
    response.setHeader?.(
      "X-RateLimit-Reset",
      Math.ceil(bucket.expiresAt / 1_000),
    );
  }

  private clientIp(request: PublicAiRequest) {
    const peerIp = this.normalizeIp(
      request.socket?.remoteAddress ?? request.ip,
    );
    const forwardedIp = this.normalizeIp(
      this.singleHeader(request.headers?.["x-client-ip"]),
    );
    if (forwardedIp && peerIp && this.isTrustedProxy(peerIp))
      return forwardedIp;

    const requestIp = this.normalizeIp(request.ip);
    return requestIp ?? peerIp ?? "unknown";
  }

  private isTrustedProxy(peerIp: string) {
    const configured =
      process.env.AI_TRUSTED_PROXY_CIDRS?.trim() || DEFAULT_TRUSTED_PROXY_CIDRS;
    return configured
      .split(/[|,]/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .some((entry) => this.matchesCidr(peerIp, entry));
  }

  private matchesCidr(ip: string, entry: string) {
    const [networkRaw, prefixRaw] = entry.split("/");
    const network = this.normalizeIp(networkRaw);
    if (!network) return false;
    if (prefixRaw === undefined) return ip === network;

    const family = isIP(network);
    const prefix = Number(prefixRaw);
    if (family === 6) return prefix === 128 && isIP(ip) === 6 && ip === network;
    if (
      family !== 4 ||
      isIP(ip) !== 4 ||
      !Number.isInteger(prefix) ||
      prefix < 0 ||
      prefix > 32
    )
      return false;

    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (this.ipv4Number(ip) & mask) === (this.ipv4Number(network) & mask);
  }

  private ipv4Number(ip: string) {
    return (
      ip
        .split(".")
        .reduce((value, octet) => (value << 8) + Number(octet), 0) >>> 0
    );
  }

  private normalizeIp(value?: string) {
    if (!value) return undefined;
    const candidate = value.trim();
    const mapped = candidate.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
    const normalized = mapped ?? candidate.toLowerCase();
    return isIP(normalized) ? normalized : undefined;
  }

  private singleHeader(value?: string | string[]) {
    if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
    return value;
  }

  private policy(endpoint: PublicAiEndpoint) {
    if (endpoint === "reading") return { limit: 6, windowMs: 15 * 60_000 };
    if (endpoint === "diagnose") {
      return {
        limit: this.integerEnv("AI_PUBLIC_DIAGNOSE_RATE_LIMIT", 2, 1, 1_000),
        windowMs: this.integerEnv(
          "AI_PUBLIC_DIAGNOSE_RATE_WINDOW_MS",
          60 * 60_000,
          1_000,
          24 * 60 * 60_000,
        ),
      };
    }
    return {
      limit: this.integerEnv("AI_PUBLIC_CHAT_RATE_LIMIT", 12, 1, 10_000),
      windowMs: this.integerEnv(
        "AI_PUBLIC_CHAT_RATE_WINDOW_MS",
        15 * 60_000,
        1_000,
        24 * 60 * 60_000,
      ),
    };
  }

  private makeRoom(now: number) {
    this.cleanup(now);
    const maxBuckets = this.integerEnv(
      "AI_PUBLIC_RATE_LIMIT_MAX_BUCKETS",
      10_000,
      1,
      100_000,
    );
    while (this.buckets.size >= maxBuckets) {
      const oldest = this.buckets.keys().next().value as string | undefined;
      if (!oldest) break;
      this.buckets.delete(oldest);
    }
  }

  private cleanup(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.expiresAt <= now) this.buckets.delete(key);
    }
  }

  private integerEnv(
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ) {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
  }
}
