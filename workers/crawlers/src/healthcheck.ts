import { Redis } from "ioredis";
import { prisma } from "@tokusatsu/db";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});
try {
  await redis.connect();
  if ((await redis.ping()) !== "PONG") throw new Error("Redis ping failed");
  await prisma.$queryRaw`SELECT 1`;
  process.exitCode = 0;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  redis.disconnect();
  await prisma.$disconnect();
}
