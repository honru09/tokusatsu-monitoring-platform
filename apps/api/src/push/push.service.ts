import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { createVapidJwt, encryptPushPayload } from "./push-crypto.js";

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface PushSubscriptionRow {
  id: string;
  accountId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

/**
 * The push_subscription delegate is generated from the Prisma schema at
 * build time; the narrow shape is spelled out here so this module does
 * not depend on which generated client happens to be on disk.
 */
interface PushSubscriptionDelegate {
  upsert(args: {
    where: { endpoint: string };
    create: Omit<PushSubscriptionRow, "id">;
    update: Omit<PushSubscriptionRow, "id">;
  }): Promise<PushSubscriptionRow>;
  findMany(args: {
    where: { accountId: string };
  }): Promise<PushSubscriptionRow[]>;
  delete(args: { where: { id: string } }): Promise<unknown>;
  deleteMany(args: {
    where: { accountId: string; endpoint: string };
  }): Promise<{ count: number }>;
}

export interface PushNotification {
  title: string;
  body: string;
  url: string;
}

/** Sends one encrypted payload; rejects with an error carrying statusCode on HTTP failures. */
export type PushSender = (
  subscription: PushSubscriptionRow,
  payload: string,
) => Promise<void>;

export function pushDeliveryStatus(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === "number") return status;
  }
  return undefined;
}

/** Default sender: VAPID JWT + aes128gcm body, posted to the subscription endpoint. */
export function createHttpPushSender(
  config: VapidConfig,
  fetchFn: typeof fetch = fetch,
): PushSender {
  return async (subscription, payload) => {
    const body = encryptPushPayload({
      payload,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    });
    const jwt = createVapidJwt({
      endpoint: subscription.endpoint,
      subject: config.subject,
      privateKey: config.privateKey,
      publicKey: config.publicKey,
    });
    const response = await fetchFn(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: `vapid t=${jwt}, k=${config.publicKey}`,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "Content-Length": String(body.length),
        TTL: "86400",
        Urgency: "normal",
      },
      body: new Uint8Array(body),
    });
    if (!response.ok) {
      const error = new Error(
        `push endpoint answered ${response.status}`,
      ) as Error & { statusCode: number };
      error.statusCode = response.status;
      throw error;
    }
  };
}

const DECISION_LABELS: Record<string, string> = {
  want: "要",
  buy: "要",
  yes: "要",
  "要": "要",
  negotiate: "砍价",
  negotiation: "砍价",
  bargain: "砍价",
  "砍价": "砍价",
  pass: "不要",
  no: "不要",
  reject: "不要",
  "不要": "不要",
  purchased: "已买下",
  bought: "已买下",
  "已买下": "已买下",
};

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  /**
   * Delivery seam. Left null in tests / unconfigured environments; the
   * real HTTP sender is built lazily from the VAPID config on first use.
   * Tests assign a fake here instead of touching the network.
   */
  sender: PushSender | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private get store(): PushSubscriptionDelegate {
    return (
      this.prisma as unknown as { pushSubscription: PushSubscriptionDelegate }
    ).pushSubscription;
  }

  readConfig(): VapidConfig | null {
    const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
    const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
    const subject = process.env.VAPID_SUBJECT?.trim();
    if (!publicKey || !privateKey || !subject) return null;
    return { publicKey, privateKey, subject };
  }

  config() {
    const config = this.readConfig();
    return {
      enabled: Boolean(config),
      publicKey: config?.publicKey ?? null,
    };
  }

  async subscribe(
    accountId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    userAgent?: string,
  ) {
    await this.requireAccount(accountId);
    const row = await this.store.upsert({
      where: { endpoint: subscription.endpoint },
      create: {
        accountId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: userAgent?.trim() || null,
      },
      update: {
        accountId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: userAgent?.trim() || null,
      },
    });
    return { subscribed: true, id: row.id };
  }

  async unsubscribe(accountId: string, endpoint: string) {
    await this.requireAccount(accountId);
    const result = await this.store.deleteMany({
      where: { accountId, endpoint },
    });
    return { removed: result.count > 0 };
  }

  /**
   * Best-effort fan-out to one account's browsers. Every failure is
   * logged and swallowed: a dead push endpoint must never fail the
   * request that triggered the notification. Subscriptions the push
   * service reports as gone (404/410) are pruned.
   */
  async notifyAccount(
    accountId: string,
    notification: PushNotification,
  ): Promise<{ sent: number; pruned: number }> {
    const config = this.readConfig();
    if (!config && !this.sender) return { sent: 0, pruned: 0 };
    let subscriptions: PushSubscriptionRow[];
    try {
      subscriptions = await this.store.findMany({ where: { accountId } });
    } catch (error) {
      this.logger.warn(`push subscription lookup failed: ${String(error)}`);
      return { sent: 0, pruned: 0 };
    }
    if (!subscriptions.length) return { sent: 0, pruned: 0 };
    const send = this.sender ?? createHttpPushSender(config as VapidConfig);
    const payload = JSON.stringify(notification);
    let sent = 0;
    let pruned = 0;
    for (const subscription of subscriptions) {
      try {
        await send(subscription, payload);
        sent += 1;
      } catch (error) {
        const status = pushDeliveryStatus(error);
        if (status === 404 || status === 410) {
          pruned += 1;
          try {
            await this.store.delete({ where: { id: subscription.id } });
          } catch (deleteError) {
            this.logger.warn(
              `push subscription prune failed: ${String(deleteError)}`,
            );
          }
        } else {
          this.logger.warn(
            `push delivery failed (${status ?? "no status"}): ${String(error)}`,
          );
        }
      }
    }
    return { sent, pruned };
  }

  /** Decision-made notification; see NOTES.md for the call site in the decision upsert. */
  async notifyDecision(input: {
    itemTitle: string;
    status: string;
    deciderName: string;
    recipientAccountId: string;
  }): Promise<{ sent: number; pruned: number }> {
    const label = DECISION_LABELS[input.status] ?? input.status;
    return this.notifyAccount(input.recipientAccountId, {
      title: "搭档已做决定",
      body: `${input.deciderName} 对《${input.itemTitle}》定了：${label}`,
      url: "/?workspace=collaboration",
    });
  }

  private async requireAccount(id: string) {
    const account = await this.prisma.managerAccount.findFirst({
      where: { id, active: true },
    });
    if (!account) throw new BadRequestException("管理者账号无效");
    return account;
  }
}
