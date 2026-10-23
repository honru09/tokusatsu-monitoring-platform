import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
export type XianyuSessionState = "not_connected" | "logged_out" | "waiting_browser" | "authenticated" | "expired" | "verification_required" | "unavailable";
export type XianyuSessionStatus = {
  state: XianyuSessionState; label: string; checkedAt: string; loginAvailable: boolean;
  authenticated: boolean; accountLabel: string | null;
  capabilities: { search: boolean; publish: boolean; edit: boolean; metrics: boolean };
  message: string;
};
const states = new Set<XianyuSessionState>(["not_connected", "logged_out", "waiting_browser", "authenticated", "expired", "verification_required", "unavailable"]);
@Injectable()
export class XianyuSessionService {
  constructor(private readonly db: PrismaService) {}
  get configured() { return Boolean(process.env.XIANYU_SESSION_URL && process.env.XIANYU_SESSION_TOKEN); }
  private fallback(state: XianyuSessionState, message: string): XianyuSessionStatus {
    return { state, label: state === "not_connected" ? "未连接" : "登录服务暂不可用", message, checkedAt: new Date().toISOString(),
      loginAvailable: false, authenticated: false, accountLabel: null, capabilities: { search: false, publish: false, edit: false, metrics: false } };
  }
  private async call(path: string, method = "GET") {
    const base = new URL(`${process.env.XIANYU_SESSION_URL!.replace(/\/$/, "")}/`);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("Invalid session URL");
    const response = await fetch(new URL(path, base), { method, headers: { authorization: `Bearer ${process.env.XIANYU_SESSION_TOKEN}` },
      signal: AbortSignal.timeout(method === "GET" ? 8_000 : 30_000), redirect: "error" });
    if (!response.ok) throw new Error("闲鱼登录服务暂不可用，请启动本地连接服务");
    const raw = await response.json() as Record<string, unknown>;
    if (!states.has(raw.state as XianyuSessionState) || typeof raw.checkedAt !== "string" || !Number.isFinite(Date.parse(raw.checkedAt)) || Math.abs(Date.now() - Date.parse(raw.checkedAt)) > 60_000) throw new Error("登录状态未得到有效确认");
    const capability = raw.capabilities as Record<string, unknown> | undefined;
    const authenticated = raw.state === "authenticated" && raw.authenticated === true;
    return {
      state: raw.state as XianyuSessionState, checkedAt: raw.checkedAt, authenticated,
      label: typeof raw.label === "string" ? raw.label.slice(0, 80) : "待确认",
      accountLabel: authenticated && typeof raw.accountLabel === "string" ? raw.accountLabel.slice(0, 60) : null,
      loginAvailable: raw.loginAvailable === true,
      message: typeof raw.message === "string" ? raw.message.slice(0, 300) : "",
      capabilities: { search: authenticated && capability?.search === true, publish: authenticated && capability?.publish === true,
        edit: authenticated && capability?.edit === true, metrics: authenticated && capability?.metrics === true },
    } satisfies XianyuSessionStatus;
  }
  async status() {
    if (!this.configured) return this.fallback("not_connected", "先启动本地闲鱼连接服务");
    try { return await this.call("session"); } catch { return this.fallback("unavailable", "本地闲鱼连接服务暂不可用，自动操作已停止"); }
  }
  private async actor(accountId: string) {
    if (!await this.db.managerAccount.findFirst({ where: { id: accountId, active: true }, select: { id: true } })) throw new BadRequestException("管理者账号无效");
  }
  async start(accountId: string) {
    await this.actor(accountId);
    if (!this.configured) throw new ServiceUnavailableException("请先启动本地闲鱼连接服务");
    try {
      const result = await this.call("session/start", "POST");
      await this.db.resaleEvent.create({ data: { accountId, action: "login", detail: "打开官方闲鱼登录页面，等待用户验证" } });
      return result;
    } catch { throw new ServiceUnavailableException("无法打开闲鱼登录，请检查本地连接服务与浏览器"); }
  }
  async disconnect(accountId: string) {
    await this.actor(accountId);
    await this.db.resaleSettings.updateMany({ where: { id: "default" }, data: { paused: true, autoPublish: false, autoMetrics: false } });
    if (!this.configured) return this.status();
    const result = await this.call("session/disconnect", "POST");
    await this.db.resaleEvent.create({ data: { accountId, action: "logout", detail: "断开闲鱼登录并暂停自动任务" } });
    return result;
  }
  async assertCapability(capability: keyof XianyuSessionStatus["capabilities"]) {
    const status = await this.status();
    if (!status.authenticated || !status.capabilities[capability]) throw new ServiceUnavailableException(status.authenticated ? "当前闲鱼连接尚未验证此操作，请使用人工接管" : "闲鱼尚未登录或登录已失效，请重新登录");
  }
  async prepare(id: string, version: number, accountId: string) {
    await this.actor(accountId);
    const row = await this.db.resaleListing.findUnique({ where: { id } });
    if (!row || row.version !== version) throw new BadRequestException("草稿已更新，请保存后再打开发布页");
    if (!row.rightsConfirmed) throw new BadRequestException("请先确认商品图片可用于销售并保存");
    if (["published", "publishing", "uncertain", "withdrawing"].includes(row.status)) throw new BadRequestException("请先核实已有发布结果");
    if (!this.configured || !(await this.status()).authenticated) throw new ServiceUnavailableException("请先登录闲鱼");
    const response = await fetch(`${process.env.XIANYU_SESSION_URL!.replace(/\/$/, "")}/publish/prepare`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(90_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.XIANYU_SESSION_TOKEN}` },
      body: JSON.stringify({ id: row.id, version: row.version, title: row.title, description: row.description,
        deliveryText: row.deliveryText, priceCny: row.priceCny, imageUrls: row.imageUrls,
        shippingMode: row.shippingMode, shippingFeeCny: row.shippingFeeCny, locationText: row.locationText }),
    });
    const prepared = await response.json() as { state?: string; message?: string };
    if (!response.ok || prepared.state !== "prepared") throw new ServiceUnavailableException(prepared.message || "发布页面未得到确认，请在闲鱼浏览器核查");
    await this.db.resaleEvent.create({ data: { listingId: id, accountId, action: "prepare_publish", detail: "已将草稿填写到闲鱼官方发布页，等待最终确认" } });
    return { message: prepared.message };
  }
}
