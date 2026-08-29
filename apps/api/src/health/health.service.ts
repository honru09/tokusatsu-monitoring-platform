import { Injectable } from "@nestjs/common";
import { Redis } from "ioredis";
import { PrismaService } from "../prisma.service.js";

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check() {
    const checks: Record<string, string> = {};
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = "ok";
    } catch {
      checks.database = "error";
    }

    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    try {
      await redis.connect();
      checks.redis = (await redis.ping()) === "PONG" ? "ok" : "error";
    } catch {
      checks.redis = "error";
    } finally {
      redis.disconnect();
    }

    return {
      status: Object.values(checks).every((value) => value === "ok")
        ? "ok"
        : "degraded",
      service: "tokusatsu-api",
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
