import { PrismaClient } from "@tokusatsu/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AiGatewayService } from "./ai-gateway.service.js";
import { configuredProviderRuntimes } from "./ai-provider-registry.js";
import { recordResponseSchema } from "./ai-response-schema.js";
import type { PrismaService } from "../prisma.service.js";
const databaseUrl=process.env.RESALE_TEST_DATABASE_URL;
const suite=databaseUrl ? describe : describe.skip;
suite("Zhipu quota and actual gateway persistence",()=>{
 const db=new PrismaClient({datasources:{db:{url:databaseUrl}}});
 const schema=recordResponseSchema<{translated:string}>("test.zhipu.translation",1,value=>value && typeof value === 'object' && 'translated' in value && typeof value.translated === 'string' ? {success:true,value:{translated:value.translated}} : {success:false,issues:[{path:'translated',code:'invalid'}]});
 const request=(text='商品翻译')=>({task:'translation' as const,maxTokens:4096,dataClass:'public_market' as const,messages:[{role:'user' as const,content:text}],responseSchema:schema});
 beforeAll(async()=>{await db.$connect();});
 beforeEach(async()=>{
  vi.stubEnv('ZHIPU_API_KEY','test-fixture');vi.stubEnv('ZHIPU_API_URL','https://open.bigmodel.cn/api/paas/v4');vi.stubEnv('ZHIPU_API_TIER','promotion');vi.stubEnv('ZHIPU_FREE_RESOURCE_EXPIRES_AT','2026-11-09T14:35:56+08:00');
  vi.stubEnv('ZHIPU_FREE_TOKEN_LIMIT','14000000');vi.stubEnv('ZHIPU_DAILY_TOKEN_LIMIT','200000');
  await db.aiCache.deleteMany({where:{provider:'zhipu'}});await db.aiRun.deleteMany({where:{provider:'zhipu'}});await db.aiModelState.deleteMany({where:{provider:'zhipu'}});await db.aiProviderState.deleteMany({where:{provider:'zhipu'}});
 });
 afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
 afterAll(async()=>{await db.$disconnect();});
 const gateway=()=>new AiGatewayService(db as PrismaService);
 it('coalesces duplicate requests and uses persisted cache without another model call',async()=>{
  const upstream=vi.fn().mockResolvedValue(new Response(JSON.stringify({model:'glm-5.3-flash',choices:[{message:{content:'{"translated":"中文商品"}'}}],usage:{prompt_tokens:10,completion_tokens:20}}),{status:200}));vi.stubGlobal('fetch',upstream);
  const service=gateway();const [a,b]=await Promise.all([service.executeJson(request()),service.executeJson(request())]);
  expect(a.runId).toBe(b.runId);expect(upstream).toHaveBeenCalledTimes(1);
  expect((await service.executeJson(request())).cached).toBe(true);expect(upstream).toHaveBeenCalledTimes(1);
  expect(await service.resourceStatus()).toMatchObject({accountedTokens:30,todayTokens:30});
 });
 it('locks the shared budget across separate API instances before any external request',async()=>{
  vi.stubEnv('ZHIPU_FREE_TOKEN_LIMIT','10000');
  const make=()=>db.aiRun.create({data:{task:'translation',provider:'zhipu',requestedModel:'glm-5.3-flash',status:'running',inputHash:crypto.randomUUID(),input:{}}});
  const [a,b]=await Promise.all([make(),make()]);const provider=configuredProviderRuntimes()[0];
  type Reservation={reserveProviderBudget:(p:typeof provider,m:string,r:ReturnType<typeof request>,id:string)=>Promise<number>};
  const results=await Promise.allSettled([(gateway() as unknown as Reservation).reserveProviderBudget(provider,'glm-5.3-flash',request(),a.id),(gateway() as unknown as Reservation).reserveProviderBudget(provider,'glm-5.3-flash',request(),b.id)]);
  expect(results.filter(r=>r.status === 'fulfilled')).toHaveLength(1);
  expect((await db.aiRun.aggregate({_sum:{quotaReservation:true},where:{provider:'zhipu'}}))._sum.quotaReservation).toBeLessThanOrEqual(10000);
 });
 it('retains a conservative charge on unknown outcomes and never automatically retries',async()=>{
  vi.stubEnv('AI_HTTP_RETRIES','2');const upstream=vi.fn().mockRejectedValue(new Error('connection lost'));vi.stubGlobal('fetch',upstream);
  await expect(gateway().executeJson(request('超时检查'))).rejects.toThrow();expect(upstream).toHaveBeenCalledTimes(1);
  const run=await db.aiRun.findFirst({where:{provider:'zhipu'}});expect(run?.status).toBe('failed');expect(run?.quotaReservation).toBeGreaterThan(4096);
 });
 it('charges reported usage even when returned JSON fails our contract',async()=>{
  const upstream=vi.fn().mockResolvedValue(new Response(JSON.stringify({model:'glm-5.3-flash',choices:[{message:{content:'{"wrong":true}'}}],usage:{prompt_tokens:12,completion_tokens:25}}),{status:200}));vi.stubGlobal('fetch',upstream);
  const service=gateway();await expect(service.executeJson(request('契约检查'))).rejects.toThrow();expect((await service.resourceStatus()).accountedTokens).toBe(37);
 });
 it('does not contact the provider after the resource expiry',async()=>{
  vi.stubEnv('ZHIPU_FREE_RESOURCE_EXPIRES_AT','2026-01-01T00:00:00Z');const upstream=vi.fn();vi.stubGlobal('fetch',upstream);
  await expect(gateway().executeJson(request('到期检查'))).rejects.toThrow();expect(upstream).not.toHaveBeenCalled();
 });
});
