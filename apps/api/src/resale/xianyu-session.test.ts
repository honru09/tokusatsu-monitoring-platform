import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XianyuSessionService } from "./xianyu-session.service.js";

const session = (overrides: Record<string, unknown> = {}) => ({ state: "authenticated", label: "已登录", authenticated: true,
  loginAvailable: true, accountLabel: "测试账号", checkedAt: new Date().toISOString(), message: "已连接",
  capabilities: { search: true, publish: false, edit: false, metrics: false }, ...overrides });
const database = () => ({managerAccount: {findFirst: vi.fn().mockResolvedValue({id:"actor"})},
  resaleSettings: {updateMany: vi.fn().mockResolvedValue({count:1})}, resaleEvent: {create: vi.fn().mockResolvedValue({})},
  resaleListing: {findUnique: vi.fn().mockResolvedValue({id:"listing",version:2,rightsConfirmed:false,status:"draft"})}});
beforeEach(()=>{vi.stubEnv("XIANYU_SESSION_URL","http://localhost:3880");vi.stubEnv("XIANYU_SESSION_TOKEN","test-fixture-token");});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("Xianyu confirmed browser session",()=>{
  it("distinguishes authenticated search from unverified publishing",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockImplementation(async()=>new Response(JSON.stringify(session()))));
    const service=new XianyuSessionService(database() as never);
    expect(await service.status()).toMatchObject({authenticated:true,capabilities:{search:true,publish:false}});
    await expect(service.assertCapability("publish")).rejects.toThrow(/人工接管/);
  });
  it("rejects stale session evidence and disables every capability",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify(session({checkedAt:new Date(Date.now()-120000).toISOString()})))));
    expect(await new XianyuSessionService(database() as never).status()).toMatchObject({authenticated:false,capabilities:{search:false,publish:false}});
  });
  it("does not trust capability flags without an authenticated state",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify(session({state:"expired"})))));
    expect((await new XianyuSessionService(database() as never).status()).capabilities.search).toBe(false);
  });
  it("requires an existing manager before opening a browser",async()=>{
    const db=database();db.managerAccount.findFirst.mockResolvedValue(null as never);const upstream=vi.fn();vi.stubGlobal("fetch",upstream);
    await expect(new XianyuSessionService(db as never).start("invalid")).rejects.toThrow(/无效/);expect(upstream).not.toHaveBeenCalled();
  });
  it("pauses automatic publishing before attempting disconnection even if the bridge fails",async()=>{
    const db=database();vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("offline")));
    await expect(new XianyuSessionService(db as never).disconnect("actor")).rejects.toThrow();
    expect(db.resaleSettings.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:{paused:true,autoPublish:false,autoMetrics:false}}));
  });
  it("does not send an unconfirmed image or a stale draft to the publish page",async()=>{
    const db=database();const upstream=vi.fn();vi.stubGlobal("fetch",upstream);const service=new XianyuSessionService(db as never);
    await expect(service.prepare("listing",1,"actor")).rejects.toThrow(/已更新/);
    await expect(service.prepare("listing",2,"actor")).rejects.toThrow(/确认商品图片/);
    expect(upstream).not.toHaveBeenCalled();
  });
});
