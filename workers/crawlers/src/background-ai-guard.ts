import { randomUUID } from "node:crypto";

type Clock = () => number;
type Wait = (milliseconds: number) => Promise<void>;

export type AutomaticAiCooldown = {
  reason: string;
  retryAt: number;
  status?: number;
};

export interface AutomaticAiCoordination {
  readCooldown(): Promise<AutomaticAiCooldown | null>;
  writeCooldown(cooldown: AutomaticAiCooldown): Promise<void>;
  acquire(owner: string, leaseMs: number): Promise<boolean>;
  renew(owner: string, leaseMs: number): Promise<boolean>;
  release(owner: string): Promise<void>;
}

export type AutomaticAiRedisClient = {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown>;
  eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
};

type AutomaticAiGuardOptions = {
  maxConcurrency?: number;
  defaultCooldownMs?: number;
  now?: Clock;
  wait?: Wait;
  coordination?: AutomaticAiCoordination;
  lockLeaseMs?: number;
  lockPollMs?: number;
};

const MINIMUM_COOLDOWN_MS = 60_000;
const MAXIMUM_COOLDOWN_MS = 6 * 60 * 60_000;
const DEFAULT_COOLDOWN_MS = 10 * 60_000;
const DEFAULT_LOCK_LEASE_MS = 6 * 60_000;
const DEFAULT_LOCK_POLL_MS = 250;

export function automaticPaidAiEnabled() {
  const configured =
    process.env.BACKGROUND_AI_PAID_AUTOMATION_ENABLED?.trim().toLowerCase();
  return (
    configured === "true" || (!configured && process.env.NODE_ENV === "test")
  );
}

/**
 * Public-market translation may use providers that the Gateway has already
 * classified as free without granting permission for any paid background
 * workload. Paid authorization remains a superset for installations that
 * deliberately fund all enrichment work.
 */
export function automaticBackgroundAiEnabled() {
  const configured =
    process.env.BACKGROUND_AI_FREE_AUTOMATION_ENABLED?.trim().toLowerCase();
  return (
    automaticPaidAiEnabled() ||
    configured === "true"
  );
}

const SHARED_OUTAGE_CODES = new Set([
  "AI_GATEWAY_NOT_CONFIGURED",
  "AI_GATEWAY_UNAVAILABLE",
  "AI_GATEWAY_ALL_FAILED",
  "AI_GATEWAY_ALL_PROVIDERS_COOLDOWN",
  "AI_GATEWAY_DEADLINE_EXCEEDED",
  "AI_GATEWAY_CAPACITY_COOLDOWN",
  "AI_GATEWAY_CATALOGUE_UNAVAILABLE",
  "AI_GATEWAY_NO_FREE_MODEL",
  "AI_GATEWAY_NO_ELIGIBLE_MODEL",
  "AI_GATEWAY_NO_MODEL",
  "AI_PROVIDER_AUTH_FAILED",
  "AI_PROVIDER_BALANCE_EXHAUSTED",
  "AI_PROVIDER_UNAVAILABLE",
]);

function boundedPositiveInteger(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || value == null || value < 1) return fallback;
  return Math.floor(value);
}

export class AutomaticAiDeferredError extends Error {
  constructor(
    readonly reason: string,
    readonly retryAt: Date,
    readonly status?: number,
  ) {
    super(`Automatic AI deferred until ${retryAt.toISOString()}`);
    this.name = "AutomaticAiDeferredError";
  }
}

/**
 * One process-wide gate for automatic enrichment. User-triggered API requests
 * never pass through this module. Different BullMQ workers therefore cannot
 * fan out paid requests when a backlog wakes after a deployment.
 */
export class AutomaticAiGuard {
  private readonly maxConcurrency: number;
  private readonly defaultCooldownMs: number;
  private readonly now: Clock;
  private readonly wait: Wait;
  private readonly lockLeaseMs: number;
  private readonly lockPollMs: number;
  private coordination?: AutomaticAiCoordination;
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private cooldownUntil = 0;
  private cooldownReason = "provider_unavailable";

  constructor(options: AutomaticAiGuardOptions = {}) {
    // Background enrichment is deliberately serial. Interactive API traffic
    // bypasses this guard and therefore always retains provider headroom.
    this.maxConcurrency = Math.min(
      1,
      boundedPositiveInteger(options.maxConcurrency, 1),
    );
    this.defaultCooldownMs = Math.max(
      MINIMUM_COOLDOWN_MS,
      Math.min(
        boundedPositiveInteger(options.defaultCooldownMs, DEFAULT_COOLDOWN_MS),
        MAXIMUM_COOLDOWN_MS,
      ),
    );
    this.now = options.now ?? Date.now;
    this.wait =
      options.wait ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.coordination = options.coordination;
    this.lockLeaseMs = Math.max(
      60_000,
      boundedPositiveInteger(options.lockLeaseMs, DEFAULT_LOCK_LEASE_MS),
    );
    this.lockPollMs = Math.max(
      1,
      boundedPositiveInteger(options.lockPollMs, DEFAULT_LOCK_POLL_MS),
    );
  }

  setCoordination(coordination: AutomaticAiCoordination | undefined) {
    this.coordination = coordination;
  }

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const promise = this.execute(operation);
    this.inFlight.set(key, promise);
    void promise.then(
      () => this.inFlight.delete(key),
      () => this.inFlight.delete(key),
    );
    return promise;
  }

  async pause(
    reason: string,
    delayMs = this.defaultCooldownMs,
    status?: number,
  ) {
    const duration = Math.max(
      MINIMUM_COOLDOWN_MS,
      Math.min(delayMs, MAXIMUM_COOLDOWN_MS),
    );
    const retryAt = this.now() + duration;
    if (retryAt >= this.cooldownUntil) {
      this.cooldownUntil = retryAt;
      this.cooldownReason = reason;
    }
    const cooldown = {
      reason: this.cooldownReason,
      retryAt: this.cooldownUntil,
      ...(status == null ? {} : { status }),
    };
    await this.coordination?.writeCooldown(cooldown).catch((error) => {
      console.warn(
        JSON.stringify({
          event: "background_ai_cooldown_persist_failed",
          error: error instanceof Error ? error.name : "unknown_error",
        }),
      );
    });
    return new AutomaticAiDeferredError(
      this.cooldownReason,
      new Date(this.cooldownUntil),
      status,
    );
  }

  resetForTests() {
    this.cooldownUntil = 0;
    this.cooldownReason = "provider_unavailable";
    this.inFlight.clear();
  }

  private async refreshSharedCooldown() {
    if (!this.coordination) return;
    let shared: AutomaticAiCooldown | null;
    try {
      shared = await this.coordination.readCooldown();
    } catch (error) {
      throw new AutomaticAiDeferredError(
        "coordination_unavailable",
        new Date(this.now() + MINIMUM_COOLDOWN_MS),
      );
    }
    if (shared && shared.retryAt > this.cooldownUntil) {
      this.cooldownUntil = shared.retryAt;
      this.cooldownReason = shared.reason;
    }
  }

  private deferredError() {
    if (this.cooldownUntil <= this.now()) return undefined;
    return new AutomaticAiDeferredError(
      this.cooldownReason,
      new Date(this.cooldownUntil),
    );
  }

  private async execute<T>(operation: () => Promise<T>) {
    await this.refreshSharedCooldown();
    const beforeQueue = this.deferredError();
    if (beforeQueue) throw beforeQueue;
    await this.acquire();
    let distributedOwner: string | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      distributedOwner = await this.acquireDistributed();
      await this.refreshSharedCooldown();
      const afterQueue = this.deferredError();
      if (afterQueue) throw afterQueue;
      if (distributedOwner) {
        heartbeat = setInterval(
          () => {
            void this.coordination
              ?.renew(distributedOwner!, this.lockLeaseMs)
              .catch(() => undefined);
          },
          Math.max(1_000, Math.floor(this.lockLeaseMs / 3)),
        );
        heartbeat.unref?.();
      }
      return await operation();
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (distributedOwner)
        await this.coordination
          ?.release(distributedOwner)
          .catch(() => undefined);
      this.release();
    }
  }

  private async acquireDistributed() {
    if (!this.coordination) return undefined;
    const owner = randomUUID();
    for (;;) {
      await this.refreshSharedCooldown();
      const deferred = this.deferredError();
      if (deferred) throw deferred;
      if (await this.coordination.acquire(owner, this.lockLeaseMs))
        return owner;
      await this.wait(this.lockPollMs);
    }
  }

  private async acquire() {
    if (this.active < this.maxConcurrency) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.active -= 1;
  }
}

function configuredConcurrency() {
  return Math.min(
    1,
    boundedPositiveInteger(
      Number(process.env.BACKGROUND_AI_MAX_CONCURRENCY),
      1,
    ),
  );
}

const automaticAiGuard = new AutomaticAiGuard({
  maxConcurrency: configuredConcurrency(),
  defaultCooldownMs: Number(process.env.BACKGROUND_AI_COOLDOWN_MS),
});

function retryAfterMilliseconds(response: Response, fallback: number) {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return fallback;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? Math.max(MINIMUM_COOLDOWN_MS, timestamp - Date.now())
    : fallback;
}

async function outageReason(response: Response) {
  if (
    [401, 402, 403, 408, 429].includes(response.status) ||
    response.status >= 500
  )
    return `gateway_http_${response.status}`;
  if (response.status < 400 || response.status >= 500) return undefined;
  const text = await response
    .clone()
    .text()
    .catch(() => "");
  try {
    const payload = JSON.parse(text) as { code?: unknown };
    if (
      typeof payload.code === "string" &&
      SHARED_OUTAGE_CODES.has(payload.code)
    )
      return payload.code;
  } catch {
    // A malformed content response is a per-item failure, not a pool outage.
  }
  return undefined;
}

function outageDelay(response: Response) {
  const credentialOrBalanceFailure = [401, 402, 403].includes(response.status);
  return retryAfterMilliseconds(
    response,
    credentialOrBalanceFailure ? 30 * 60_000 : DEFAULT_COOLDOWN_MS,
  );
}

function transportFailure(error: unknown): boolean {
  if (error instanceof AutomaticAiDeferredError) return false;
  if (error instanceof TypeError) return true;
  if (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  )
    return true;
  if (
    error instanceof Error &&
    "cause" in error &&
    error.cause != null &&
    error.cause !== error &&
    transportFailure(error.cause)
  )
    return true;
  const message = error instanceof Error ? error.message : String(error);
  return /AI Gateway[^\n]*(?:401|402|403|404|408|429|5\d\d|unavailable|not[ _-]?found|not[ _-]?configured|timeout|capacity|balance|额度|余额|限流)/i.test(
    message,
  );
}

export function isAutomaticAiUnavailable(error: unknown) {
  return error instanceof AutomaticAiDeferredError || transportFailure(error);
}

export async function runAutomaticAiTask<T>(
  key: string,
  operation: () => Promise<T>,
  guard: AutomaticAiGuard = automaticAiGuard,
  options: { authorization?: "paid" | "free" } = {},
) {
  const authorization = options.authorization ?? "paid";
  const enabled =
    authorization === "free"
      ? automaticBackgroundAiEnabled()
      : automaticPaidAiEnabled();
  if (!enabled)
    throw new AutomaticAiDeferredError(
      authorization === "free"
        ? "background_automation_not_authorized"
        : "paid_automation_not_authorized",
      new Date(Date.now() + MAXIMUM_COOLDOWN_MS),
    );
  return guard.run(key, async () => {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AutomaticAiDeferredError) throw error;
      if (transportFailure(error))
        throw await guard.pause("gateway_transport_unavailable");
      throw error;
    }
  });
}

export async function backgroundAiFetch(
  key: string,
  input: string | URL | Request,
  init?: RequestInit,
  options: {
    guard?: AutomaticAiGuard;
    fetcher?: typeof fetch;
    authorization?: "paid" | "free";
  } = {},
) {
  const guard = options.guard ?? automaticAiGuard;
  const response = await runAutomaticAiTask(
    key,
    async () => {
      const result = await (options.fetcher ?? fetch)(input, init);
      const reason = await outageReason(result);
      if (reason)
        throw await guard.pause(reason, outageDelay(result), result.status);
      return result;
    },
    guard,
    { authorization: options.authorization },
  );
  // Identical in-flight requests share the original response. Give every
  // caller an independent body stream so de-duplication remains transparent.
  return response.clone();
}

export function resetAutomaticAiGuardForTests() {
  automaticAiGuard.resetForTests();
}

const RELEASE_LOCK_SCRIPT = [
  'if redis.call("get", KEYS[1]) == ARGV[1] then',
  '  return redis.call("del", KEYS[1])',
  "end",
  "return 0",
].join("\n");

const RENEW_LOCK_SCRIPT = [
  'if redis.call("get", KEYS[1]) == ARGV[1] then',
  '  return redis.call("pexpire", KEYS[1], ARGV[2])',
  "end",
  "return 0",
].join("\n");

/** Redis keeps the gate valid across worker restarts and multiple replicas. */
export class RedisAutomaticAiCoordination implements AutomaticAiCoordination {
  private readonly cooldownKey: string;
  private readonly lockKey: string;

  constructor(
    private readonly redis: AutomaticAiRedisClient,
    prefix = process.env.BACKGROUND_AI_COORDINATION_PREFIX ??
      "tokusatsu:background-ai:v1",
  ) {
    this.cooldownKey = `${prefix}:cooldown`;
    this.lockKey = `${prefix}:lock`;
  }

  async readCooldown() {
    const raw = await this.redis.get(this.cooldownKey);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Partial<AutomaticAiCooldown>;
      if (typeof value.reason !== "string" || !Number.isFinite(value.retryAt))
        return null;
      return {
        reason: value.reason,
        retryAt: Number(value.retryAt),
        ...(Number.isFinite(value.status)
          ? { status: Number(value.status) }
          : {}),
      };
    } catch {
      return null;
    }
  }

  async writeCooldown(cooldown: AutomaticAiCooldown) {
    const ttl = Math.max(1, Math.ceil(cooldown.retryAt - Date.now()));
    await this.redis.set(this.cooldownKey, JSON.stringify(cooldown), "PX", ttl);
  }

  async acquire(owner: string, leaseMs: number) {
    return (
      (await this.redis.set(this.lockKey, owner, "PX", leaseMs, "NX")) === "OK"
    );
  }

  async renew(owner: string, leaseMs: number) {
    return (
      Number(
        await this.redis.eval(
          RENEW_LOCK_SCRIPT,
          1,
          this.lockKey,
          owner,
          leaseMs,
        ),
      ) === 1
    );
  }

  async release(owner: string) {
    await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, this.lockKey, owner);
  }
}

export function configureAutomaticAiCoordination(
  redis: AutomaticAiRedisClient,
) {
  automaticAiGuard.setCoordination(new RedisAutomaticAiCoordination(redis));
}
