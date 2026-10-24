import { afterEach, describe, expect, it, vi } from "vitest";
import { assertAiScope, conservativeTokenReservation, imageReservationTokens, normalizeScopedRequest, zhipuResourcePolicy } from "./zhipu.policy.js";
import { candidatesForTask, routeForProvider } from "./ai-router.js";
import { configuredProviderRuntimes } from "./ai-provider-registry.js";
afterEach(()=>vi.unstubAllEnvs());
describe("scoped Zhipu resource policy",()=>{
  it("rejects analysis tasks outside the three approved uses",()=>{
    for(const task of ["market_analysis","crawler_diagnosis","seller_analysis","logistics_analysis","bulk_filter","cross_validation"] as const) expect(()=>assertAiScope(task)).toThrow(/仅用于/);
    expect(()=>assertAiScope("complex_analysis")).toThrow();
    expect(()=>assertAiScope("complex_analysis","product_reading")).not.toThrow();
  });
  it("does not restore removed providers, wildcard routes or paid models from stale env",()=>{
    vi.stubEnv("BAI_API_KEY","fixture");vi.stubEnv("AI_PROVIDER_ORDER","ovo|bai");vi.stubEnv("AI_ROUTE_ZHIPU_TRANSLATION","*");
    expect(configuredProviderRuntimes(["bai","ovo"])).toEqual([]);
    expect(routeForProvider("translation","bai")).toEqual([]);
    expect(candidatesForTask("translation",["zhipu"],{costPolicy:"paid_allowed",requiresVision:false,availableModels:new Map([["zhipu",new Set(["glm-5.3-flashx"]) ]])})).toEqual([{provider:"zhipu",model:"glm-5.3-flash",costTier:"promotion"}]);
  });
  it("rejects key forwarding to a custom endpoint",()=>{
    vi.stubEnv("ZHIPU_API_KEY","fixture");vi.stubEnv("ZHIPU_API_URL","https://example.com/api/paas/v4");vi.stubEnv("ZHIPU_CUSTOM_ENDPOINT_AUTHORIZED","true");
    expect(configuredProviderRuntimes()).toEqual([]);
  });
  it("bounds resources below the screenshot bundle even with oversized env",()=>{
    vi.stubEnv("ZHIPU_FREE_TOKEN_LIMIT","999999999");vi.stubEnv("ZHIPU_DAILY_TOKEN_LIMIT","999999999");
    vi.stubEnv("ZHIPU_FREE_RESOURCE_EXPIRES_AT","2030-01-01T00:00:00Z");
    expect(zhipuResourcePolicy()).toMatchObject({tokenLimit:14000000,dailyTokenLimit:200000,paidFallback:false,backgroundAi:false});
    expect(zhipuResourcePolicy().expiresAt.toISOString()).toBe("2026-11-09T06:35:56.000Z");
  });
  it("limits the image count and prevents long context from consuming quota",()=>{
    const request={task:"translation" as const,maxTokens:99999,messages:[{role:"user" as const,content:"翻译"}]};
    expect(normalizeScopedRequest(request).maxTokens).toBe(8192);
    expect(()=>normalizeScopedRequest({...request,imageUrls:['a','b','c']})).toThrow(/两张/);
    expect(()=>normalizeScopedRequest({...request,messages:[{role:'user',content:'x'.repeat(60001)}]})).toThrow(/上下文/);
  });
  it("scales the translation floor by input size and keeps the chat floor",()=>{
    const small={task:"translation" as const,maxTokens:10,messages:[{role:"user" as const,content:"短いタイトル"}]};
    expect(normalizeScopedRequest(small).maxTokens).toBe(1024);
    const large={task:"translation" as const,maxTokens:10,messages:[{role:"user" as const,content:"x".repeat(3000)}]};
    expect(normalizeScopedRequest(large).maxTokens).toBe(4096);
    const chat={task:"assistant_chat" as const,maxTokens:10,messages:[{role:"user" as const,content:"hi"}]};
    expect(normalizeScopedRequest(chat).maxTokens).toBe(4096);
  });
  it("reserves a calibrated per-image estimate instead of 65,536",()=>{
    const messages=[{content:"x"}];
    const base=Buffer.byteLength(JSON.stringify(messages),"utf8")+100+1024;
    expect(imageReservationTokens()).toBe(8192);
    expect(conservativeTokenReservation(messages,100,2)).toBe(base+2*8192);
    vi.stubEnv("ZHIPU_IMAGE_RESERVATION_TOKENS","4096");
    expect(conservativeTokenReservation(messages,100,1)).toBe(base+4096);
    vi.stubEnv("ZHIPU_IMAGE_RESERVATION_TOKENS","999999999");
    expect(imageReservationTokens()).toBe(65536);
    vi.stubEnv("ZHIPU_IMAGE_RESERVATION_TOKENS","0");
    expect(imageReservationTokens()).toBe(8192);
  });
});
