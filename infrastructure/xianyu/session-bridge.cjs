'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { chromium } = require('../../workers/crawlers/node_modules/playwright-core');
const { createPublishPreparer } = require('./publish-form.cjs');
const root = path.resolve(__dirname, '../..');
const privateDir = path.join(root, '.private-operations/xianyu');
const profileDir = path.join(privateDir, 'browser-profile');
const cdpPort = 9332;
const token = process.env.XIANYU_SESSION_TOKEN || fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).map(l => l.match(/^XIANYU_SESSION_TOKEN=(.+)$/)).find(Boolean)?.[1]?.trim();
if (!token || token.length < 32) throw new Error('XIANYU_SESSION_TOKEN is required');
fs.mkdirSync(privateDir, {recursive:true});
let browser, context, loginPage, verificationPage, starting, wasAuthenticated = false, lastSearchAt = 0;
try { wasAuthenticated = JSON.parse(fs.readFileSync(path.join(privateDir, 'state.json'), 'utf8')).wasAuthenticated === true; } catch {}
function remember(value) { wasAuthenticated = value; fs.writeFileSync(path.join(privateDir, 'state.json'), JSON.stringify({wasAuthenticated:value})); }
function browserExecutable() {
  const candidates = [process.env.XIANYU_BROWSER_PATH,
    path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')];
  return candidates.find(p => p && fs.existsSync(p));
}
async function connect() {
  if (browser?.isConnected()) return true;
  const ownedFile = path.join(privateDir, 'browser.json');
  if (!fs.existsSync(ownedFile)) return false;
  const owned = JSON.parse(fs.readFileSync(ownedFile, 'utf8'));
  if (owned.profile !== profileDir || !Number.isInteger(owned.pid)) return false;
  try { process.kill(owned.pid, 0); } catch { return false; }
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, {timeout:2500});
    context = browser.contexts()[0];
    loginPage = context.pages().find(p => /^https:\/\/www\.goofish\.com\/(?:\?.*)?$/.test(p.url())) || context.pages().find(p => /^https:\/\/www\.goofish\.com\//.test(p.url())) || null;
    return Boolean(context);
  } catch { return false; }
}
function result(state, message, accountLabel = null) {
  const authenticated = state === 'authenticated';
  const labels = {logged_out:'未登录', waiting_browser:'等待登录', authenticated:'已登录', expired:'登录已失效', verification_required:'需要人工验证', unavailable:'连接暂不可用'};
  return {state, label:labels[state], authenticated, accountLabel, checkedAt:new Date().toISOString(), loginAvailable:Boolean(browserExecutable()),
    capabilities:{search:authenticated, publish:false, edit:false, metrics:false}, message};
}
async function status(ignoreStarting = false) {
  if (starting && !ignoreStarting) return result('waiting_browser', '正在打开闲鱼，请在浏览器内扫码登录');
  if (!await connect()) return result(wasAuthenticated ? 'expired' : 'logged_out', '点击一键登录，在官方闲鱼页面完成扫码');
  try {
    if (verificationPage && !verificationPage.isClosed()) {
      const text = await verificationPage.locator('body').innerText().catch(()=> '');
      if (/非法访问|安全验证|滑块验证|请完成验证|人机验证/.test(text)) return result('verification_required', '请在闲鱼浏览器完成官方验证');
      verificationPage = null;
    }
    const candidates = [...new Set([loginPage, ...context.pages()])].filter(page => page && !page.isClosed() && /^https:\/\/www\.goofish\.com\//.test(page.url()));
    const checks = [];
    for (const page of candidates) {
      const ui = await page.evaluate(() => {
      const body = document.body?.innerText || '';
      const headers = [...document.querySelectorAll('header, [class*="header"], [class*="Header"]')];
      const header = headers.find(h => h.querySelector('a[href*="personal"], [class*="nick--"]'));
      const personal = header?.querySelector('a[href*="personal"]');
      const nick = header?.querySelector('[class*="nick--"]');
      const text = nick?.textContent?.trim() || personal?.textContent?.trim() || '';
      return {verification:/非法访问|安全验证|滑块验证|请完成验证|人机验证/.test(body),
        loggedIn:Boolean(text && !/^登录$/.test(text) && (nick || (personal && /userId=\d+/i.test(personal.getAttribute('href') || '')))),
        accountLabel:text.slice(0,60), loginVisible:headers.some(h => [...h.querySelectorAll('a,button,[class*="nick--"]')].some(e => /^登录$/.test(e.textContent?.trim() || '')))};
      }).catch(()=>null);
      if (ui) checks.push({page, ui});
    }
    const cookies = await context.cookies('https://www.goofish.com/');
    const sessionPresent = cookies.some(c => c.name === 'cookie2' && c.value) && cookies.some(c => c.name === 'unb' && c.value);
    const authenticatedPage = checks.find(({ui})=>ui.loggedIn && !ui.loginVisible && !ui.verification);
    if (authenticatedPage && sessionPresent) { loginPage = authenticatedPage.page; remember(true); return result('authenticated', '商品监测可运行，发布和编辑使用人工接管', authenticatedPage.ui.accountLabel); }
    if (checks.some(({ui})=>ui.verification)) return result('verification_required', '请在闲鱼浏览器完成官方验证，系统已停止自动请求');
    const loginFrame = candidates.some(page => page.frames().some(f => /passport\.(goofish|taobao)\.com/.test(f.url())));
    return result(loginFrame ? 'waiting_browser' : wasAuthenticated ? 'expired' : 'logged_out', loginFrame ? '请在打开的闲鱼页面扫码或完成验证码' : '请在闲鱼页面登录，状态会自动更新');
  } catch { return result('unavailable', '页面正在切换，稍后可重新检查'); }
}
async function start() {
  if (starting) return starting;
  starting = (async () => {
    if (!await connect()) {
      const executable = browserExecutable();
      if (!executable) throw new Error('未找到 Chrome 或 Edge 浏览器');
      const portBusy = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {signal:AbortSignal.timeout(800)}).then(r=>r.ok).catch(()=>false);
      if (portBusy) throw new Error('登录连接端口已被其他浏览器占用');
      const child = spawn(executable, [`--remote-debugging-port=${cdpPort}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profileDir}`, '--no-first-run', '--new-window', 'https://www.goofish.com/'], {detached:true, stdio:'ignore', windowsHide:false});
      if (!child.pid) throw new Error('无法启动浏览器');
      fs.writeFileSync(path.join(privateDir, 'browser.json'), JSON.stringify({pid:child.pid, profile:profileDir}));
      child.unref();
      for (let i=0; i<25 && !await connect(); i++) await new Promise(resolve => setTimeout(resolve,300));
      if (!browser?.isConnected()) throw new Error('浏览器登录连接尚未就绪');
    }
    const current = await status(true);
    if (current.authenticated || current.state === 'verification_required') {
      await (verificationPage || loginPage)?.bringToFront();
      return current;
    }
    if (!loginPage || loginPage.isClosed()) loginPage = await context.newPage();
    if (!/^https:\/\/www\.goofish\.com\//.test(loginPage.url())) await loginPage.goto('https://www.goofish.com/', {waitUntil:'domcontentloaded', timeout:15000});
    await loginPage.bringToFront();
    const login = loginPage.getByText('登录', {exact:true}).first();
    if (await login.isVisible().catch(()=>false)) await login.click({timeout:3000}).catch(()=>{});
    return status(true);
  })();
  try { return await starting; } finally { starting = null; }
}
async function disconnect() {
  preparePublish.reset();
  if (await connect()) {
    await context.clearCookies();
    for (const page of context.pages()) if (/\.goofish\.com\//.test(page.url())) {
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }).catch(()=>{});
      await page.reload({waitUntil:'domcontentloaded', timeout:10000}).catch(()=>{});
    }
  }
  remember(false);
  verificationPage = null;
  return result('logged_out', '登录已断开，系统自动任务已暂停');
}
async function search(input) {
  const current = await status();
  if (!current.authenticated) return {code:401, payload:{requiresLogin:true, status:'login_required'}};
  if (Date.now() - lastSearchAt < 15000) return {code:429, payload:{status:'rate_limited'}};
  const keyword = typeof input.keyword === 'string' ? input.keyword.trim() : '';
  if (!keyword || keyword.length > 120) return {code:400, payload:{message:'搜索词无效'}};
  lastSearchAt = Date.now();
  const page = await context.newPage();
  try {
    await page.goto(`https://www.goofish.com/search?q=${encodeURIComponent(keyword)}`, {waitUntil:'domcontentloaded', timeout:15000});
    await page.locator('a[href*="/item?"]').first().waitFor({timeout:6000}).catch(()=>{});
    const body = await page.locator('body').innerText();
    if (/非法访问|安全验证|滑块验证|请完成验证/.test(body)) { verificationPage = page; await page.bringToFront(); return {code:403, payload:{blocked:true, status:'verify_required'}}; }
    if (page.frames().some(f=>/passport\.(goofish|taobao)\.com/.test(f.url()))) return {code:401, payload:{requiresLogin:true, status:'login_required'}};
    const items = await page.locator('a[href*="/item?"]').evaluateAll(links => links.flatMap(link => {
      const url = new URL(link.href); const targetItemId = url.searchParams.get('id');
      const text = link.innerText?.trim() || ''; const lines = text.split(/\n/).map(v=>v.trim()).filter(Boolean);
      const price = text.match(/[¥￥]\s*(\d+(?:\.\d+)?)/); const title = lines.find(l=>l.length > 4 && !/^[¥￥\d\s.]+$/.test(l));
      if (!targetItemId || !/^\d+$/.test(targetItemId) || !price || !title) return [];
      return [{targetItemId, title, priceCny:Number(price[1]), targetUrl:`https://www.goofish.com/item?id=${targetItemId}`, imageUrl:link.querySelector('img')?.src || null, region:''}];
    }));
    if (!items.length && !/没有找到|暂无相关|暂无商品|没有相关/.test(body)) return {code:422, payload:{message:'页面未提供可确认的商品列表，请在浏览器核查'}};
    return {code:200, payload:{items:items.slice(0,Math.min(Number(input.limit)||50,50)), observedAt:new Date().toISOString()}};
  } finally { if (!page.isClosed() && !/验证/.test(await page.locator('body').innerText().catch(()=>''))) await page.close(); }
}
function authorized(req) { const incoming = Buffer.from(req.headers.authorization || ''); const expected = Buffer.from(`Bearer ${token}`); return incoming.length === expected.length && crypto.timingSafeEqual(incoming,expected); }
function send(res, code, payload) { res.writeHead(code, {'content-type':'application/json; charset=utf-8', 'cache-control':'no-store'}); res.end(JSON.stringify(payload)); }
let mutation = Promise.resolve();
const preparePublish = createPublishPreparer({getStatus:status,createPage:()=>context.newPage()});
function serialize(action) { const result = mutation.catch(()=>{}).then(action); mutation = result.catch(()=>{}); return result; }
const server = http.createServer(async (req,res) => {
  if (req.url === '/health') return send(res,200,{ready:true,service:'xianyu-session'});
  if (!authorized(req)) return send(res,401,{message:'Unauthorized'});
  try {
    if (req.method === 'GET' && req.url === '/session') return send(res,200,await status());
    if (req.method === 'POST' && req.url === '/session/start') return send(res,200,await serialize(start));
    if (req.method === 'POST' && req.url === '/session/disconnect') return send(res,200,await serialize(disconnect));
    if (req.method === 'POST' && req.url === '/search') {
      let body=''; for await (const chunk of req) { body += chunk; if(body.length > 4096) return send(res,413,{message:'Body too large'}); }
      const result = await serialize(()=>search(JSON.parse(body || '{}'))); return send(res,result.code,result.payload);
    }
    if (req.method === 'POST' && req.url === '/publish/prepare') {
      let body=''; for await (const chunk of req) {body+=chunk;if(body.length>32768) return send(res,413,{message:'Body too large'});}
      const prepared = await serialize(()=>preparePublish(JSON.parse(body || '{}')));
      return send(res,prepared.state === 'prepared' ? 200 : 409,prepared);
    }
    return send(res,404,{message:'Not found'});
  } catch (error) { send(res,503,{message:error instanceof Error && ['未找到 Chrome 或 Edge 浏览器','登录连接端口已被其他浏览器占用'].includes(error.message) ? error.message : '登录连接操作失败，请在本机核查浏览器'}); }
});
server.listen(3880,'0.0.0.0',()=>console.log('Xianyu session bridge ready on port 3880'));
