import { Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { XianyuSessionService } from "./xianyu-session.service.js";
import { validGoofishItemUrl } from "./resale.policy.js";
import { parseMetricObservation } from "./resale-operations.policy.js";

export type PublishPayload = {
  id: string;
  version: number;
  title: string;
  description: string;
  priceCny: number;
  imageUrls: string[];
  deliveryText: string;
  sourceUrl: string;
  targetItemId: string | null;
};
export type PublishReceipt = { targetItemId: string; targetUrl: string };

// This protocol belongs to our bridge, not to Goofish's public API.
@Injectable()
export class ResalePublisher {
  constructor(@Optional() private readonly session?: XianyuSessionService) {}
  get capability() {
    const raw = process.env.RESALE_PUBLISHER_URL;
    let configured = false;
    try {
      const url = new URL(raw ?? "");
      configured =
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        Boolean(process.env.RESALE_PUBLISHER_TOKEN);
    } catch {}
    return {
      configured,
      mode: configured ? "bridge" : "manual",
      label: configured ? "发布桥接服务已配置" : "手动发布，自动发布尚未连接",
      sellerActions: configured
        ? (process.env.RESALE_PUBLISHER_CAPABILITIES ?? "")
            .split(",")
            .map((action) => action.trim())
            .filter((action) => ["bump", "reprice", "metrics"].includes(action))
        : [],
    };
  }
  async execute(
    action: "publish" | "withdraw",
    payload: PublishPayload,
    operationToken: string,
  ): Promise<PublishReceipt | null> {
    if (this.session?.configured) await this.session.assertCapability("publish");
    if (!this.capability.configured)
      throw new ServiceUnavailableException(
        "尚未连接闲鱼发布服务，请使用手动发布",
      );
    const base = `${process.env.RESALE_PUBLISHER_URL!.replace(/\/$/, "")}/`;
    const target = new URL(`listings/${encodeURIComponent(payload.id)}`, base);
    const response = await fetch(target, {
      method: action === "publish" ? "PUT" : "DELETE",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.RESALE_PUBLISHER_TOKEN}`,
        "idempotency-key": operationToken,
      },
      body: JSON.stringify({ ...payload, action, operationToken }),
      redirect: "error",
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok)
      throw new Error("发布服务未返回确认结果，请在闲鱼核实后回填");
    const result = (await response.json()) as Record<string, unknown>;
    if (action === "withdraw" && result.status === "withdrawn") return null;
    if (
      action === "publish" &&
      result.status === "published" &&
      typeof result.targetItemId === "string" &&
      result.targetItemId.length > 0 &&
      result.targetItemId.length <= 120 &&
      typeof result.targetUrl === "string" &&
      validGoofishItemUrl(result.targetItemId, result.targetUrl)
    )
      return { targetItemId: result.targetItemId, targetUrl: result.targetUrl };
    throw new Error("发布结果无法确认，请在闲鱼核实后回填");
  }
  async sellerAction(
    kind: "bump" | "reprice",
    targetItemId: string,
    operationToken: string,
    priceCny?: number,
  ) {
    if (this.session?.configured) await this.session.assertCapability("edit");
    if (!this.capability.sellerActions.includes(kind))
      throw new Error("当前发布渠道未声明支持此操作");
    const base = `${process.env.RESALE_PUBLISHER_URL!.replace(/\/$/, "")}/`;
    const response = await fetch(
      new URL(`seller/items/${encodeURIComponent(targetItemId)}/actions`, base),
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(25_000),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.RESALE_PUBLISHER_TOKEN}`,
          "idempotency-key": operationToken,
        },
        body: JSON.stringify({
          action: kind,
          targetItemId,
          operationToken,
          ...(kind === "reprice" ? { priceCny } : {}),
        }),
      },
    );
    if (!response.ok) throw new Error("卖家渠道未确认操作结果");
    const data = (await response.json()) as Record<string, unknown>;
    if (
      data.status !== "succeeded" ||
      data.targetItemId !== targetItemId ||
      (kind === "reprice" && data.priceCny !== priceCny)
    )
      throw new Error("卖家操作回执无法确认");
  }
  async pullMetrics(targetItemId: string) {
    if (this.session?.configured) await this.session.assertCapability("metrics");
    if (!this.capability.sellerActions.includes("metrics"))
      throw new Error("当前发布渠道未声明支持运营指标");
    const base = `${process.env.RESALE_PUBLISHER_URL!.replace(/\/$/, "")}/`;
    const response = await fetch(
      new URL(`seller/items/${encodeURIComponent(targetItemId)}/metrics`, base),
      {
        headers: {
          authorization: `Bearer ${process.env.RESALE_PUBLISHER_TOKEN}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(25_000),
      },
    );
    if (!response.ok) throw new Error("运营指标服务没有返回数据");
    const snapshot = parseMetricObservation(
      await response.json(),
      targetItemId,
    );
    if (!snapshot)
      throw new Error("指标商品、观测时间或数值无效，请在连接端核查");
    return snapshot;
  }
}
