import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scryptSync, randomBytes } from "node:crypto";
import net from "node:net";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createGateway, safeFilename, PREFIX } from "../server.mjs";
import { listenForHttpTest } from './listen.mjs';
let root, app, base, rfbServer;
const browserCalls = [];
const fixtureFields = [{ id: "account-field", kind: "account", label: "账号" }, { id: "password-field", kind: "password", label: "密码" }, { id: "code-field", kind: "code", label: "验证码" }];
const testPassword = "fixture-operations-password";
before(async () => {
  root = await mkdtemp(join(tmpdir(), "kamen-operations-test-"));
  await mkdir(join(root, "auth"));
  await mkdir(join(root, "materials"));
  const salt = "01".repeat(16),
    hash = scryptSync(testPassword, salt, 64).toString("hex");
  await writeFile(
    join(root, "auth", "accounts.json"),
    JSON.stringify([
      { id: "long", name: "龙", salt, hash },
      { id: "run", name: "润", salt, hash },
    ]),
  );
  rfbServer = net.createServer((socket) => {
    socket.write("RFB 003.008\n");
    socket.on("data", (data) => socket.write(data));
  });
  rfbServer.listen(0, "127.0.0.1");
  await once(rfbServer, "listening");
  const browsers = Object.fromEntries(
    ["xiaohongshu", "douyin"].map((id) => [
      id,
      { host: "127.0.0.1", port: rfbServer.address().port, viewPort: rfbServer.address().port, label: id },
    ]),
  );
  app = await createGateway({
    authDir: join(root, "auth"),
    materialRoot: join(root, "materials"),
    browsers,
    browserControl: async (platform, action, payload) => {
      browserCalls.push({ platform, action, payload });
      if(action==='page-scan')return {scanId:'page-scan-fixture',fields:[{id:'title',kind:'title',label:'标题',maxLength:30,value:'原始标题'},{id:'body',kind:'body',label:'正文',maxLength:20000,value:''}],actions:[{id:'location',label:'添加地点'}],choices:[]};
      if(action==='page-fill')return {ok:true,count:Object.keys(payload.values).length,verified:!Object.values(payload.values).includes('fixture-rejected')};
      if(action==='page-import')return payload.title==='fixture-no-editor'?{ok:false,code:'editor_not_ready'}:{ok:true,verified:true,count:2};
      if(action==='media-scan')return {scanId:'fixture-media',inputs:[{id:'photos',label:'图片',kind:'image',accept:'image/*',multiple:true}]};
      if(action==='media-attach')return {ok:true,attachedCount:payload.names.length,stage:'input_received'};
      return action === "login-scan" ? { scanId: "fixture-scan", fields: fixtureFields, canSubmit: true, qr: null } : { ok: true };
    },
  });
  await listenForHttpTest(app.server);
  base = `http://127.0.0.1:${app.server.address().port}`;
});
test('many uploaded files survive batches, can be selected together, and cannot escape the material folder',async()=>{
  const s=await login(),names=[];
  for(let i=0;i<14;i++){
    const created=await request('/api/uploads',{method:'POST',headers:auth(s),body:JSON.stringify({platform:'douyin',name:`photo-${i}.png`,size:3})});
    assert.equal(created.status,201);const ticket=await created.json();
    const saved=await request(`/api/uploads/${ticket.id}`,{method:'PUT',headers:{...auth(s),'x-upload-offset':'0'},body:'png'});const result=await saved.json();assert.equal(result.complete,true);names.push(result.name);
    const replay=await request(`/api/uploads/${ticket.id}`,{method:'PUT',headers:{...auth(s),'x-upload-offset':'0'},body:'png'});assert.equal((await replay.json()).offset,3);
    assert.equal((await request(`/api/uploads/${ticket.id}`,{headers:auth(s)})).status,200);
  }
  assert.equal((await(await request('/api/files/douyin',{headers:auth(s)})).json()).files.length,14);
  const scan=await(await request('/api/browser/douyin/media-scan',{method:'POST',headers:auth(s),body:'{}'})).json();
  const attach=await request('/api/browser/douyin/media-attach',{method:'POST',headers:auth(s),body:JSON.stringify({scanId:scan.scanId,inputId:'photos',names:names.slice(0,3)})});
  assert.equal(attach.status,200);assert.equal((await attach.json()).attachedCount,3);
  assert.deepEqual(browserCalls.at(-1).payload.names,names.slice(0,3));
  assert.equal((await request(`/api/preview/douyin/${names[0]}`,{headers:auth(s)})).headers.get('content-type'),'image/png');
  const newScan=await(await request('/api/browser/douyin/media-scan',{method:'POST',headers:auth(s),body:'{}'})).json();
  assert.equal((await request('/api/browser/douyin/media-attach',{method:'POST',headers:auth(s),body:JSON.stringify({scanId:newScan.scanId,inputId:'photos',names:['../secret.png']})})).status,400);
  const observer=await login(false);assert.equal((await request('/api/browser/douyin/media-scan',{method:'POST',headers:auth(observer),body:'{}'})).status,403);
  await Promise.all(names.map(name=>unlink(join(root,'materials','douyin',name))));
});
test('canceling an owned partial upload removes only its incomplete file',async()=>{
  const s=await login();const ticket=await(await request('/api/uploads',{method:'POST',headers:auth(s),body:JSON.stringify({platform:'xiaohongshu',name:'cancel.png',size:3})})).json();
  const other=await login(false);assert.equal((await request(`/api/uploads/${ticket.id}`,{method:'DELETE',headers:auth(other)})).status,404);
  assert.equal((await request(`/api/uploads/${ticket.id}`,{method:'DELETE',headers:auth(s)})).status,200);
  assert.equal((await request(`/api/uploads/${ticket.id}`,{headers:auth(s)})).status,404);
});
test("publishing helper is scan-bound, excludes arbitrary actions, and never auto-publishes",async()=>{
  const s=await login();
  const call=(action,input={})=>request('/api/browser/xiaohongshu/'+action,{method:'POST',headers:auth(s),body:JSON.stringify(input)});
  assert.equal((await call('page-fill',{scanId:'missing',values:{title:'更改'}})).status,409);
  const scan=await(await call('page-scan')).json();
  assert.equal(scan.fields[0].label,'标题');
  assert.equal((await call('page-fill',{scanId:scan.scanId,values:{arbitrary:'不允许'}})).status,400);
  assert.equal((await call('page-fill',{scanId:scan.scanId,values:{title:'过'.repeat(31)}})).status,400);
  assert.equal((await call('page-location',{scanId:scan.scanId,actionId:'publish'})).status,400);
  assert.equal((await call('page-fill',{scanId:scan.scanId,values:{title:'待确认标题',body:'完整正文'}})).status,200);
  assert.equal(browserCalls.at(-1).action,'page-fill');assert.deepEqual(browserCalls.at(-1).payload.values,{title:'待确认标题',body:'完整正文'});
  assert.equal((await call('page-fill',{scanId:scan.scanId,values:{title:'fixture-rejected'}})).status,422);
  assert.equal((await call('page-location',{scanId:scan.scanId,actionId:'location'})).status,200);
});
test('one-click import does not require a prior scan or cursor, still requires operator authority',async()=>{
  const s=await login();const url='/api/browser/xiaohongshu/page-import';
  const send=(payload,headers=auth(s))=>request(url,{method:'POST',headers,body:JSON.stringify(payload)});
  assert.equal((await send({title:'第一行',body:'剩下的\n全部内容'})).status,200);
  assert.deepEqual(browserCalls.at(-1).payload,{title:'第一行',body:'剩下的\n全部内容'});
  assert.equal((await send({title:'fixture-no-editor',body:'正文'})).status,422);
  assert.equal((await send({title:22,body:'正文'})).status,400);
  const observer=await login(false);assert.equal((await send({title:'禁止',body:'禁止'},auth(observer))).status,403);
});
after(async () => {
  app.server.closeAllConnections();
  await new Promise((r) => app.server.close(r));
  await new Promise((r) => rfbServer.close(r));
  await rm(root, { recursive: true, force: true });
});
const request = (path, options = {}) =>
  fetch(base + PREFIX + path, {
    ...options,
    headers: { origin: base, ...options.headers },
  });
afterEach(() => { for(const key of app.sessions.keys())app.viewers.revoke(key); });
async function login(operate = true) {
  const r = await request("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "long", password: testPassword }),
  });
  assert.equal(r.status, 200);
  const data = await r.json();
  const result = {
    cookie: r.headers.get("set-cookie").split(";")[0],
    csrf: data.csrf,
    setCookie: r.headers.get("set-cookie"),
    clientId: randomBytes(16).toString("hex"),
  };
  if(operate)assert.equal((await request('/api/control',{method:'POST',headers:{cookie:result.cookie,'x-csrf-token':result.csrf,'x-operations-client':result.clientId},body:JSON.stringify({role:'operator'})})).status,200);
  return result;
}
const auth = (s) => ({ cookie: s.cookie, "x-csrf-token": s.csrf, "x-operations-client":s.clientId });
test("anonymous visitors cannot access sessions or files", async () => {
  for (const path of [
    "/api/status",
    "/api/credentials/xiaohongshu",
    "/api/browser/xiaohongshu/restore",
    "/api/files/xiaohongshu",
    "/api/download/douyin/a.mp4",
  ])
    assert.equal((await request(path)).status, 401);
});
test("wrong credentials and cross-origin login are rejected", async () => {
  assert.equal(
    (
      await request("/api/login", {
        method: "POST",
        headers: { origin: "https://untrusted.invalid" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/login", {
        method: "POST",
        body: JSON.stringify({ username: "long", password: "incorrect" }),
      })
    ).status,
    401,
  );
});
test("real sessions use scoped secure cookies; selected identity alone cannot authorize", async () => {
  const s = await login();
  assert.match(s.setCookie, /HttpOnly/);
  assert.match(s.setCookie, /Secure/);
  assert.match(s.setCookie, /SameSite=Strict/);
  assert.match(s.setCookie, /Path=\/operations-browser\//);
  assert.equal(
    (await request("/api/status", { headers: { cookie: "managerId=long" } }))
      .status,
    401,
  );
  const result = await request("/api/status", { headers: auth(s) });
  assert.equal((await result.json()).name, "龙");
  assert.equal(
    (
      await request("/api/logout", {
        method: "POST",
        headers: { cookie: s.cookie },
      })
    ).status,
    403,
  );
  await request("/api/logout", {
    method: "POST",
    headers: auth(s),
    body: "{}",
  });
  assert.equal(
    (await request("/api/status", { headers: auth(s) })).status,
    401,
  );
});
test("files validate extensions, traversal, offsets and stream only authenticated uploads", async () => {
  const s = await login();
  assert.equal(safeFilename("../escape.mp4"), null);
  assert.equal(safeFilename("evil.html"), null);
  assert.equal(safeFilename("..\\escape.png"), null);
  const create = await request("/api/uploads", {
    method: "POST",
    headers: auth(s),
    body: JSON.stringify({
      platform: "xiaohongshu",
      name: "素材.png",
      size: 6,
    }),
  });
  assert.equal(create.status, 201);
  const u = await create.json();
  assert.equal(
    (
      await request(`/api/uploads/${u.id}`, {
        method: "PUT",
        headers: { ...auth(s), "x-upload-offset": "1" },
        body: "abc",
      })
    ).status,
    409,
  );
  const a = await request(`/api/uploads/${u.id}`, {
    method: "PUT",
    headers: { ...auth(s), "x-upload-offset": "0" },
    body: "abc",
  });
  assert.equal((await a.json()).offset, 3);
  await request('/api/control',{method:'POST',headers:auth(s),body:JSON.stringify({role:'observer'})});
  assert.equal((await request('/api/uploads',{method:'POST',headers:auth(s),body:JSON.stringify({platform:'xiaohongshu',name:'new.png',size:1})})).status,403);
  const b = await request(`/api/uploads/${u.id}`, {
    method: "PUT",
    headers: { ...auth(s), "x-upload-offset": "3" },
    body: "def",
  });
  const result = await b.json();
  assert.equal(result.complete, true);
  assert.equal(
    await readFile(join(root, "materials", "xiaohongshu", result.name), "utf8"),
    "abcdef",
  );
  const own = await request("/api/files/xiaohongshu", { headers: auth(s) });
  assert.equal((await own.json()).files.length, 1);
  const other = await request("/api/files/douyin", { headers: auth(s) });
  assert.equal((await other.json()).files.length, 0);
});
test("websocket requires authenticated origin, allows observation, logout terminates own stream", async () => {
  const s = await login();
  const url = base.replace("http:", "ws:") + PREFIX + `/ws/douyin?client=${s.clientId}`;
  const denied = new WebSocket(url, { origin: base });
  const [error] = await once(denied, "error");
  assert.match(error.message, /403/);
  const foreign = new WebSocket(url, {
    origin: "https://untrusted.invalid",
    headers: { cookie: s.cookie },
  });
  assert.match((await once(foreign, "error"))[0].message, /403/);
  const ws = new WebSocket(url, {
    origin: base,
    headers: { cookie: s.cookie },
  });
  const received = once(ws, "message");
  await once(ws, "open");
  assert.equal((await received)[0].toString(), "RFB 003.008\n");
  assert.equal(browserCalls.at(-1).action, "restore");
  const second = new WebSocket(url, {
    origin: base,
    headers: { cookie: s.cookie },
  });
  assert.match((await once(second, "error"))[0].message, /409/);
  const closed = once(ws, "close");
  await request("/api/logout", {
    method: "POST",
    headers: auth(s),
    body: "{}",
  });
  await closed;
  assert.equal(app.viewers.frames.size, 0);
});
test("login assistant requires csrf, binds scans to a session, and never returns stored secrets", async () => {
  const s = await login();
  const call = (path, body = {}, headers = auth(s)) => request(path, { method: "POST", headers, body: JSON.stringify(body) });
  assert.equal((await call("/api/browser/xiaohongshu/restore", {}, { cookie: s.cookie })).status, 403);
  const saved = await request("/api/credentials/xiaohongshu", { method: "PUT", headers: auth(s), body: JSON.stringify({ account: "fixture-phone", password: "fixture-secret" }) });
  assert.equal(saved.status, 200);
  assert.doesNotMatch(await saved.text(), /fixture-phone|fixture-secret/);
  const disk = await readFile(join(root, "auth", "credentials-xiaohongshu.json"), "utf8");
  assert.doesNotMatch(disk, /fixture-phone|fixture-secret/);
  const scan = await call("/api/browser/xiaohongshu/login-scan");
  const { scanId } = await scan.json();
  const other = await login(false);
  assert.equal((await call("/api/browser/xiaohongshu/login-fill", { scanId, useSaved: true }, auth(other))).status, 403);
  const fill = await call("/api/browser/xiaohongshu/login-fill", { scanId, useSaved: true, values: { "code-field": "fixture-otp" } });
  assert.equal(fill.status, 200);
  assert.equal(browserCalls.at(-1).payload.values["password-field"], "fixture-secret");
  assert.equal(browserCalls.at(-1).payload.values["code-field"], "fixture-otp");
  assert.doesNotMatch(await fill.text(), /fixture-secret|fixture-otp/);
  assert.equal((await call("/api/browser/xiaohongshu/login-submit", { scanId })).status, 200);
  assert.equal((await call("/api/browser/xiaohongshu/login-submit", { scanId })).status, 409);
  const clear = await request("/api/credentials/xiaohongshu", { method: "DELETE", headers: auth(s) });
  assert.equal((await clear.json()).saved, false);
});
