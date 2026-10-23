import http from "node:http";
import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import {
  readFile,
  writeFile,
  rename,
  mkdir,
  readdir,
  stat,
  open,
  unlink,
  statfs,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createViewerHub } from "./viewer-hub.mjs";
import { createCredentialVault } from "./credential-vault.mjs";
import { createBrowserControl } from "./browser-control.mjs";
import { resolveMaterialBatch, safeStoredMediaName } from './media-files.mjs';

const derive = promisify(scrypt);
export const PREFIX = "/operations-browser";
const COOKIE = "__Secure-kamen_operations";
const WEEK = 7 * 24 * 3600_000;
const MAX_FILE = 2 * 1024 ** 3;
const CHUNK = 4 * 1024 ** 2;
const EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
  ".heic",
  ".heif",
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
]);
const hash = (value) => createHash("sha256").update(value).digest("hex");
export function sameOrigin(req) {
  try {
    const origin = new URL(req.headers.origin);
    return (
      ["http:", "https:"].includes(origin.protocol) &&
      origin.host === req.headers.host &&
      !["cross-site", "none"].includes(req.headers["sec-fetch-site"])
    );
  } catch {
    return false;
  }
}
export function safeFilename(value) {
  if (
    typeof value !== "string" ||
    value.length > 160 ||
    basename(value) !== value ||
    /[\\/\x00-\x1f]/.test(value) ||
    !EXTENSIONS.has(extname(value).toLowerCase())
  )
    return null;
  return value.replace(/[<>:"|?*]/g, "_");
}
const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};
async function body(req, limit = 12_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit)
      throw Object.assign(new Error("请求过大"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function createGateway(options = {}) {
  const authDir = resolve(
    options.authDir ?? process.env.OPS_AUTH_DIR ?? "/auth",
  );
  const materialRoot = resolve(
    options.materialRoot ?? process.env.OPS_MATERIALS ?? "/materials",
  );
  const publicDir = resolve(
    options.publicDir ?? fileURLToPath(new URL("./public", import.meta.url)),
  );
  const accounts = JSON.parse(
    await readFile(resolve(authDir, "accounts.json"), "utf8"),
  );
  if (
    !Array.isArray(accounts) ||
    ![1, 2].includes(accounts.length) ||
    accounts.some(
      (a) =>
        !["shared", "long", "run"].includes(a.id) ||
        !/^[a-f0-9]{32}$/.test(a.salt) ||
        !/^[a-f0-9]{128}$/.test(a.hash),
    )
  )
    throw new Error("Invalid operations account configuration");
  const browsers = options.browsers ?? {
    xiaohongshu: { host: "ops-xiaohongshu", port: 5900, label: "小红书" },
    douyin: { host: "ops-douyin", port: 5900, label: "抖音" },
  };
  const sessions = new Map();
  const browserControl = options.browserControl ?? createBrowserControl(authDir, browsers);
  const vault = await createCredentialVault(authDir);
  const loginScans = new Map();
  const editorScans = new Map();
  const mediaScans = new Map();
  const browserActions = new Set();
  const uploads = new Map();
  let uploadStartTail=Promise.resolve();
  const failures = new Map();
  const sessionFile = resolve(authDir, "sessions.json");
  let saveTail = Promise.resolve();
  let attempts = [];
  const persist = () => {
    saveTail = saveTail
      .catch(() => {})
      .then(async () => {
        await writeFile(sessionFile + ".tmp", JSON.stringify([...sessions]), {
          mode: 0o600,
        });
        await rename(sessionFile + ".tmp", sessionFile);
      });
    return saveTail;
  };
  try {
    for (const [key, s] of JSON.parse(await readFile(sessionFile, "utf8"))) {
      if (
        /^[a-f0-9]{64}$/.test(key) &&
        s.expires > Date.now() &&
        accounts.some((a) => a.id === s.accountId)
      )
        sessions.set(key, s);
    }
  } catch {}
  for (const id of Object.keys(browsers))
    await mkdir(resolve(materialRoot, id), { recursive: true });
  const sessionFor = (req) => {
    const cookie = (req.headers.cookie ?? "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(COOKIE + "="))
      ?.slice(COOKIE.length + 1);
    if (!cookie || !/^[A-Za-z0-9_-]{43}$/.test(cookie)) return null;
    const key = hash(cookie),
      session = sessions.get(key);
    return session && session.expires > Date.now() ? { ...session, key } : null;
  };
  const csrfValid = (req, s) =>
    sameOrigin(req) && req.headers["x-csrf-token"] === s.csrf;
  const viewers = createViewerHub({ browsers, browserControl, sessions, sessionFor, sameOrigin });
  async function listFiles(platform) {
    const dir = resolve(materialRoot, platform);
    return (
      await Promise.all(
        (await readdir(dir))
          .filter((name) => !name.startsWith("."))
          .map(async (name) => {
            const s = await stat(resolve(dir, name));
            return s.isFile()
              ? { name, size: s.size, createdAt: s.mtime.toISOString() }
              : null;
          }),
      )
    )
      .filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader(
      "content-security-policy",
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'self'; form-action 'self'; base-uri 'none'; object-src 'none'",
    );
    try {
      const pathname = new URL(req.url, "http://internal").pathname;
      if (pathname === "/health") {
        json(res, 200, { status: "ok" });
        return;
      }
      if (!pathname.startsWith(PREFIX + "/")) {
        json(res, 404, { error: "Not found" });
        return;
      }
      const path = pathname.slice(PREFIX.length);
      if (
        req.method === "GET" &&
        ["/", "/client.js", "/style.css"].includes(path)
      ) {
        const filename = path === "/" ? "index.html" : path.slice(1);
        res.setHeader(
          "content-type",
          path.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : path.endsWith(".css")
              ? "text/css; charset=utf-8"
              : "text/html; charset=utf-8",
        );
        res.end(await readFile(resolve(publicDir, filename)));
        return;
      }
      if (path === "/api/login" && req.method === "POST") {
        if (!sameOrigin(req)) {
          json(res, 403, { error: "请从运营台登录" });
          return;
        }
        const now = Date.now();
        attempts = attempts.filter((x) => x > now - 60_000);
        if (attempts.length >= 30) {
          json(res, 429, { error: "尝试过多，请稍后重试" });
          return;
        }
        attempts.push(now);
        const input = JSON.parse((await body(req)).toString());
        const id = accounts.length === 1 ? accounts[0].id : typeof input.username === "string" ? input.username : "";
        const failed = failures.get(id);
        if (failed?.until > now) {
          json(res, 429, { error: "尝试过多，请15分钟后重试" });
          return;
        }
        const account = accounts.find((a) => a.id === id);
        const password =
          typeof input.password === "string" ? input.password : "";
        if (password.length > 256) {
          json(res, 400, { error: "账号或密码不正确" });
          return;
        }
        const derived = await derive(
          password,
          (account ?? accounts[0]).salt,
          64,
        );
        if (
          !account ||
          !timingSafeEqual(derived, Buffer.from(account.hash, "hex"))
        ) {
          const count = (failed?.count ?? 0) + 1;
          failures.set(id, {
            count,
            until: count >= 5 ? now + 15 * 60_000 : 0,
          });
          json(res, 401, { error: "账号或密码不正确" });
          return;
        }
        failures.delete(id);
        const token = randomBytes(32).toString("base64url");
        const s = {
          accountId: id,
          name: account.name,
          csrf: randomBytes(24).toString("base64url"),
          expires: now + WEEK,
        };
        const old = sessionFor(req);
        if (old) {
          sessions.delete(old.key);
          viewers.revoke(old.key);
        }
        for (const [k, v] of sessions) if (v.expires <= now) sessions.delete(k);
        if (sessions.size >= 40) sessions.delete(sessions.keys().next().value);
        sessions.set(hash(token), s);
        await persist();
        res.setHeader(
          "set-cookie",
          `${COOKIE}=${token}; Path=${PREFIX}/; Max-Age=${WEEK / 1000}; HttpOnly; Secure; SameSite=Strict`,
        );
        json(res, 200, { name: s.name, csrf: s.csrf });
        return;
      }
      const s = sessionFor(req);
      if (!s) {
        json(res, 401, { error: "请先登录运营台" });
        return;
      }
      if (req.method !== "GET" && !csrfValid(req, s)) {
        json(res, 403, { error: "请求校验失败，请刷新运营台" });
        return;
      }
      const clientId = req.headers["x-operations-client"];
      if (path === "/api/control" && req.method === "POST") {
        const input = JSON.parse((await body(req)).toString());
        const result = viewers.choose(s, clientId, input.role);
        const { status: code, ...data } = result;
        json(res, code, data);
        return;
      }
      // An upload already authorized by its owner can finish after switching to chat.
      // The chunk handler still validates owner, expiry, expected offset and size.
      const continuingUpload = ['GET','PUT','DELETE'].includes(req.method) && /^\/api\/uploads\/[a-f0-9]{32}$/.test(path);
      if (req.method !== "GET" && path !== "/api/logout" && !continuingUpload && !viewers.canOperate(s, clientId)) {
        json(res, 403, { error: "请先切换为操作员" });
        return;
      }
      const credentials = path.match(/^\/api\/credentials\/(xiaohongshu|douyin)$/);
      if (credentials) {
        const platform = credentials[1];
        if (req.method === "GET") json(res, 200, await vault.status(platform));
        else if (req.method === "PUT") json(res, 200, await vault.save(platform, JSON.parse((await body(req)).toString())));
        else if (req.method === "DELETE") json(res, 200, await vault.clear(platform));
        else json(res, 405, { error: "Method not allowed" });
        return;
      }
      const browserAction = path.match(/^\/api\/browser\/(xiaohongshu|douyin)\/(restore|home|login-scan|login-fill|login-submit|page-scan|page-fill|page-import|page-location|page-choice|media-scan|media-attach|page-view)$/);
      if (browserAction && req.method === "POST") {
        const [, platform, action] = browserAction;
        if (browserActions.has(platform)) {
          json(res, 409, { error: "运营浏览器正在使用，请稍后重试" });
          return;
        }
        browserActions.add(platform);
        try {
          const input = JSON.parse((await body(req, ["page-fill","page-import"].includes(action) ? 100_000 : 12_000)).toString());
          let payload = {};
          if(action==='page-view'){
            if(!['up','down','top','bottom','zoom-in','zoom-out','zoom-reset'].includes(input.command))throw new Error('Invalid page view');
            payload={command:input.command};
          }
          if(action === "page-import") {
            if(typeof input.title !== 'string' || typeof input.body !== 'string' || input.title.length>20000 || input.body.length>20000)throw new Error('Invalid draft');
            payload={title:input.title,body:input.body};
          }
          const scanKey = `${s.key}:${platform}`;
          const editorKey = `${scanKey}:${clientId}`;
          if(action==='media-attach') {
            const scan=mediaScans.get(editorKey);
            if(!scan||scan.scanId!==input.scanId||scan.expires<Date.now()||!scan.inputs.some(f=>f.id===input.inputId)){json(res,409,{error:'请重新识别上传位置'});return;}
            const names=await resolveMaterialBatch(materialRoot,platform,input.names);
            payload={scanId:scan.scanId,inputId:input.inputId,names};
            mediaScans.delete(editorKey);
          }
          if (["page-fill", "page-location", "page-choice"].includes(action)) {
            const editor = editorScans.get(editorKey);
            if (!editor || editor.scanId !== input.scanId || editor.expires < Date.now()) { json(res, 409, { error: "请重新识别当前编辑页" }); return; }
            payload = { scanId: editor.scanId };
            if (action === "page-fill") {
              const values = input.values;
              if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).length > 16) throw new Error("Invalid editor fields");
              payload.values = {};
              for (const [id,value] of Object.entries(values)) {
                const field = editor.fields.find(f => f.id === id);
                if (!field || typeof value !== "string" || value.length > field.maxLength) throw new Error("Invalid editor value");
                payload.values[id] = value;
              }
            } else {
              const choices = action === "page-location" ? editor.actions : editor.choices;
              if (!choices.some(a => a.id === input.actionId)) throw new Error("Invalid location option");
              payload.actionId = input.actionId;
            }
          }
          if (action === "login-fill" || action === "login-submit") {
            const scan = loginScans.get(scanKey);
            if (!scan || scan.scanId !== input.scanId || scan.expires < Date.now()) {
              json(res, 409, { error: "请重新识别登录页" }); return;
            }
            payload = { scanId: scan.scanId };
            if (action === "login-fill") {
              const saved = input.useSaved === true ? await vault.read(platform) : null;
              const values = input.values ?? {};
              if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Invalid fields");
              payload.values = {};
              for (const field of scan.fields) {
                const value = values[field.id] ?? (field.kind === "account" ? saved?.account : field.kind === "password" ? saved?.password : undefined);
                if (value !== undefined) {
                  if (typeof value !== "string" || value.length > 256) throw new Error("Invalid value");
                  payload.values[field.id] = value;
                }
              }
            } else loginScans.delete(scanKey);
          }
          if (!viewers.canOperate(s, clientId)) { json(res, 403, { error: "操作权已转交" }); return; }
          const result = await browserControl(platform, action, payload);
          if(action==='media-scan'&&result.scanId){for(const [key,value] of mediaScans)if(value.expires<Date.now())mediaScans.delete(key);mediaScans.set(editorKey,{scanId:result.scanId,inputs:result.inputs,expires:Date.now()+300_000});}
          if(action==='media-attach'&&result.ok!==true){const errors={single_input:'当前控件仅支持单文件，请切到平台的图片批量上传区',unsupported_type:'所选素材类型与平台上传位置不符',rescan:'页面已变化，请重新识别',rescan_or_clear:'上传控件已变化或已有附件，请在平台核对后重新识别',attachment_uncertain:'附件已发送但无法核对，请先在平台确认，避免重复添加'};json(res,422,{error:errors[result.code]??'未能添加附件，请检查当前平台页面'});return;}
          if(action === "page-import" && (result.verified !== true || result.count !== 2)) {
            const errors={editor_not_ready:"请先打开发布编辑页；上传素材后需能看到标题和正文。无需点选输入框。",draft_too_long:"标题或正文超过平台限制，请缩短后导入",empty_title:"第一行标题不能为空",invalid_draft:"文案格式无效"};
            json(res,422,{error:errors[result.code]??"平台未保留全部文案，请核对后重新导入"});return;
          }
          if(action === "page-fill" && (result.verified !== true || result.count !== Object.keys(payload.values).length)) {
            json(res, 422, { error: "平台未保留全部修改，请核对后重新填入" });
            return;
          }
          if (action === "login-scan" && result.scanId) {
            for (const [key, value] of loginScans) if (value.expires < Date.now()) loginScans.delete(key);
            loginScans.set(scanKey, { scanId: result.scanId, fields: result.fields, expires: Date.now() + 180_000 });
          }
          if (action === "page-scan" && result.scanId) {
            for (const [key,value] of editorScans) if(value.expires < Date.now())editorScans.delete(key);
            editorScans.set(editorKey, { scanId: result.scanId, fields: result.fields.map(({id,maxLength})=>({id,maxLength})), actions:result.actions, choices:result.choices, expires:Date.now()+600_000 });
          }
          json(res, 200, result);
        } finally { browserActions.delete(platform); }
        return;
      }
      if (path === "/api/status" && req.method === "GET") {
        json(res, 200, {
          name: s.name,
          csrf: s.csrf,
          network: "当前电脑网络",
          ...viewers.status(s, clientId),
        });
        return;
      }
      if (path === "/api/logout" && req.method === "POST") {
        sessions.delete(s.key);
        await persist();
        viewers.revoke(s.key);
        res.setHeader(
          "set-cookie",
          `${COOKIE}=; Path=${PREFIX}/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
        );
        json(res, 200, { ok: true });
        return;
      }
      const files = path.match(/^\/api\/files\/(xiaohongshu|douyin)$/);
      if (files && req.method === "GET") {
        json(res, 200, { files: await listFiles(files[1]) });
        return;
      }
      if (path === "/api/uploads" && req.method === "POST") {
        const input = JSON.parse((await body(req)).toString());
        const prior=uploadStartTail;let releaseStart;uploadStartTail=new Promise(resolve=>{releaseStart=resolve;});await prior;
        try {
        const name = safeFilename(input.name);
        if (
          !name ||
          !browsers[input.platform] ||
          !Number.isSafeInteger(input.size) ||
          input.size < 1 ||
          input.size > MAX_FILE
        ) {
          json(res, 400, { error: "仅支持图片/视频，单文件不超过2GB" });
          return;
        }
        if (
          [...uploads.values()].filter(u=>!u.complete&&!u.canceled).length >= 12 ||
          [...uploads.values()].filter((u) => u.owner === s.key&&!u.complete&&!u.canceled).length >= 2
        ) {
          json(res, 429, { error: "请等待当前上传完成" });
          return;
        }
        const existing = (await listFiles(input.platform)).reduce(
          (sum, f) => sum + f.size,
          0,
        );
        const pending = [...uploads.values()]
          .filter((u) => u.platform === input.platform&&!u.complete&&!u.canceled)
          .reduce((sum, u) => sum + u.size, 0);
        if (existing + pending + input.size > 10 * 1024 ** 3) {
          json(res, 413, { error: "素材库超过10GB，请先整理素材" });
          return;
        }
        const disk = await statfs(materialRoot);
        if (disk.bavail * disk.bsize < input.size + 512 * 1024 ** 2) {
          json(res, 507, { error: "电脑磁盘空间不足" });
          return;
        }
        const id = randomBytes(16).toString("hex"),
          dir = resolve(materialRoot, input.platform),
          part = resolve(dir, "." + id + ".part");
        await writeFile(part, Buffer.alloc(0), { flag: "wx", mode: 0o600 });
        uploads.set(id, {
          owner: s.key,
          platform: input.platform,
          size: input.size,
          offset: 0,
          part,
          name: `${new Date().toISOString().slice(0, 10)}-${id.slice(0, 6)}-${name}`,
          created: Date.now(),
          busy: false,
        });
        json(res, 201, { id, chunkSize: CHUNK });
        return;
        } finally {releaseStart();}
      }
      const upload = path.match(/^\/api\/uploads\/([a-f0-9]{32})$/);
      if(upload&&['GET','DELETE'].includes(req.method)) {
        const u=uploads.get(upload[1]);if(!u||u.owner!==s.key){json(res,404,{error:'上传不存在'});return;}
        if(req.method==='GET'){json(res,200,{offset:u.offset,size:u.size,complete:Boolean(u.complete),name:u.name});return;}
        if(u.complete){json(res,409,{error:'已完成的素材不会随队列取消删除'});return;}
        u.canceled=true;
        if(!u.busy){uploads.delete(upload[1]);await unlink(u.part).catch(()=>{});}
        json(res,200,{ok:true});return;
      }
      if (upload && req.method === "PUT") {
        const u = uploads.get(upload[1]);
        if (!u || u.owner !== s.key) {
          json(res, 404, { error: "上传不存在，请重新选择文件" });
          return;
        }
        if(u.complete){json(res,200,{offset:u.offset,complete:true,name:u.name});return;}
        if(u.canceled){json(res,409,{error:'上传已取消'});return;}
        if (u.busy) {
          json(res, 409, { error: "分块正在保存" });
          return;
        }
        if (Number(req.headers["x-upload-offset"]) !== u.offset) {
          json(res, 409, { error: "上传位置不一致，请重试", offset: u.offset });
          return;
        }
        u.busy = true;
        try {
          const data = await body(req, CHUNK);
          if (!data.length || u.offset + data.length > u.size) {
            json(res, 400, { error: "文件大小不一致" });
            return;
          }
          const handle = await open(u.part, "r+");
          try {
            let written = 0;
            while (written < data.length) {
              const r = await handle.write(
                data,
                written,
                data.length - written,
                u.offset + written,
              );
              if (!r.bytesWritten) throw new Error("write failed");
              written += r.bytesWritten;
            }
            u.offset += written;
          } finally {
            await handle.close();
          }
          if(u.canceled){json(res,409,{error:'上传已取消'});return;}
          const complete = u.offset === u.size;
          if (complete) {
            await rename(u.part, resolve(materialRoot, u.platform, u.name));
            u.complete=true;
          }
          json(res, 200, { offset: u.offset, complete, name: u.name });
          return;
        } finally {
          u.busy = false;
          if(u.canceled){uploads.delete(upload[1]);await unlink(u.part).catch(()=>{});}
        }
      }
      const download = path.match(
        /^\/api\/(?:download|preview)\/(xiaohongshu|douyin)\/([^/]+)$/,
      );
      if (download && req.method === "GET") {
        const name = decodeURIComponent(download[2]);
        if (!safeStoredMediaName(name)) {
          json(res, 400, { error: "文件名无效" });
          return;
        }
        const file = resolve(materialRoot, download[1], name);
        const info = await stat(file);
        if (!info.isFile()) throw new Error("not file");
        const preview=path.startsWith('/api/preview/');
        const imageTypes={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.avif':'image/avif'};
        if(preview&&!imageTypes[extname(name).toLowerCase()]){json(res,415,{error:'此格式暂不支持预览'});return;}
        res.setHeader("content-type", preview?imageTypes[extname(name).toLowerCase()]:"application/octet-stream");
        res.setHeader("content-length", info.size);
        res.setHeader(
          "content-disposition",
          `${preview?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
        );
        createReadStream(file).pipe(res);
        return;
      }
      json(res, 404, { error: "Not found" });
    } catch (error) {
      if (!res.headersSent)
        json(res, error.status ?? 400, {
          error: error.status === 413 ? "请求过大" : error.status === 409 ? "页面已变化，请重新识别后再确认" : "操作失败，请重试",
        });
      else res.destroy();
    }
  });
  server.on("upgrade", viewers.upgrade);
  const expiryTimer = setInterval(() => {
    for (const [id, u] of uploads)
      if (Date.now() - u.created > 3600_000 && !u.busy) {
        uploads.delete(id);
        void unlink(u.part).catch(() => {});
      }
  }, 30_000);
  expiryTimer.unref();
  server.on("close", () => {
    clearInterval(expiryTimer);
    viewers.close();
  });
  return { server, sessions, viewers };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { server } = await createGateway();
  server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0", () =>
    console.log("Operations gateway ready"),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close(() => process.exit(0)));
}
