'use strict';

// Production UI footage. Every write and model request is fulfilled in memory.
const { chromium } = require('../../workers/crawlers/node_modules/playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const base = process.env.DEEP_APPLE_URL || 'http://localhost:3000';
const output = path.resolve(process.env.DEEP_DEMO_OUTPUT || 'work/deep-apple/demo');
fs.mkdirSync(output, { recursive: true });
const pause = (page, ms = 650) => page.waitForTimeout(ms);
async function visibleImages(page) {
  await page.waitForFunction(() => [...document.images].filter(img => {
    const rect = img.getBoundingClientRect();
    return img.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.bottom > 0 && rect.left < innerWidth && rect.right > 0;
  }).every(img => img.complete && img.naturalWidth > 0), null, { timeout: 45000 });
  await page.evaluate(() => Promise.all([...document.images].filter(img => img.complete && img.naturalWidth > 0).map(img => img.decode())));
}
async function screenshot(page, name) {
  await visibleImages(page);
  await pause(page, 350);
  await page.screenshot({ path: path.join(output, name) });
}
async function press(page, locator, hold = 150) {
  await locator.scrollIntoViewIfNeeded();
  const rect = await locator.boundingBox();
  assert.ok(rect, 'Press target is visible');
  await page.mouse.move(rect.x + rect.width * .5, rect.y + rect.height * .5, { steps: 8 });
  await pause(page, 150);
  await page.mouse.down(); await pause(page, hold); await page.mouse.up();
  await pause(page);
}
function ffmpegTool() {
  const choices = ['ffmpeg', path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/ffmpeg-1011/ffmpeg-win64.exe')];
  for (const executable of choices) {
    const result = spawnSync(executable, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
    if (result.status === 0) return { executable, h264: /\blibx264\b/.test(result.stdout + result.stderr) };
  }
  return null;
}
async function read(endpoint) {
  const response = await fetch(`${base}/backend/${endpoint}`);
  assert.ok(response.ok, endpoint);
  return response.json();
}

(async () => {
  const [accountData, publicItems, realResale, overview] = await Promise.all([
    read('collaboration/accounts'), read('items?listingType=direct&limit=100'), read('resale'), read('monitoring/overview'),
  ]);
  const anonymousAccounts = accountData.accounts.map((account, index) => ({ ...account, displayName: index ? '演示协作员' : '演示管理员', avatarInitial: '演', stats: { shares: 0, favorites: 0, dislikes: 0 } }));
  const gallerySeed = publicItems.items.find(item => item.id === 'b80d1c40-9fc5-43b2-96b8-9aba30d42a46' && item.images.length >= 3) || publicItems.items.find(item => item.images.length >= 3);
  assert.ok(gallerySeed, 'Public product with multiple images is available');
  const seedItems = [gallerySeed, ...publicItems.items.filter(item => item.id !== gallerySeed.id)].slice(0, 4).map(item => ({ ...structuredClone(item), favorite: false, note: null, purchaseRecord: null }));
  const photoUrls = gallerySeed.images.slice(0, 4).map(image => image.url);
  const listingTitle = gallerySeed.titleRaw.includes('レオ') ? 'S.H.Figuarts 雷欧奥特曼 发光改造' : (gallerySeed.titleZh || gallerySeed.titleRaw).replace(/ by メルカリ$/, '');
  const report = { base, capturedAt: new Date().toISOString(), fixtures: 'Anonymous accounts, empty messages, public product images, in-memory writes', realBusinessWrites: 0, realModels: 0, runs: [] };
  const encoder = ffmpegTool();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const label = viewport.width > 767 ? 'desktop' : 'mobile';
      const rawDirectory = path.join(output, '.raw', label); fs.mkdirSync(rawDirectory, { recursive: true });
      const context = await browser.newContext({ viewport, reducedMotion: 'no-preference', recordVideo: { dir: rawDirectory, size: viewport } });
      await context.addInitScript(id => localStorage.setItem('kamen-procurement-manager-v1', id), anonymousAccounts[0].id);
      const items = structuredClone(seedItems), cart = [];
      const rows = items.slice(0, 3).map((item, index) => ({
        ...structuredClone(realResale.listings[0]), id: `motion-demo-${index}`, itemId: item.id, item,
        version: 1, title: index ? (item.titleZh || item.titleRaw).replace(/ by メルカリ$/, '') : listingTitle,
        description: '商品现状与配件以货源图片为准。发布前核对价格、运费与配件，人工编辑后继续保存。',
        imageUrls: index ? item.images.slice(0, 3).map(image => image.url) : photoUrls,
        priceCny: index ? 380 : 560, status: 'draft', humanControl: false, sourcePriceJpy: item.priceCurrent,
        generationError: null, generationToken: null, generationRequestedBy: null, lastError: null,
        requiresWithdrawal: false, targetUrl: null, rightsConfirmed: false, fulfillmentConfirmed: false,
      }));
      let failNote = true;
      const run = { ...viewport, label, steps: [], screenshots: [], intercepted: [], pageErrors: [], consoleErrors: [] };
      report.runs.push(run);
      const page = await context.newPage();
      const started = Date.now();
      page.on('pageerror', error => run.pageErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') run.consoleErrors.push(message.text()); });
      if (page.routeWebSocket) await page.routeWebSocket('**/*', socket => socket.close());
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), method = request.method();
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) run.intercepted.push({ method, path: url.pathname });
        if (url.pathname.startsWith('/backend/collaboration/')) {
          if (url.pathname.endsWith('/accounts')) return json({ accounts: anonymousAccounts, unreadCount: 0, serverTime: new Date().toISOString() });
          if (url.pathname.endsWith('/messages')) return json({ messages: [], nextAfter: null });
          if (url.pathname.endsWith('/negotiations')) return json({ cases: [] });
          return json({ unread: 0, unreadCount: 0, online: false });
        }
        if (url.pathname === '/backend/monitoring/overview') return json(overview);
        if (url.pathname === '/backend/cart') return json({ items: cart, count: cart.length });
        if (url.pathname.startsWith('/backend/cart/items/')) {
          const id = url.pathname.split('/').pop(), body = request.postDataJSON(), item = items.find(row => row.id === id);
          const index = cart.findIndex(row => row.id === id);
          if (body.present && index < 0) cart.push(item);
          if (!body.present && index >= 0) cart.splice(index, 1);
          await new Promise(resolve => setTimeout(resolve, 600));
          return json({ items: cart, count: cart.length });
        }
        if (url.pathname === '/backend/items' && method === 'GET') return json({ ...publicItems, items, total: items.length });
        if (url.pathname.startsWith('/backend/items/')) {
          const item = items.find(row => url.pathname === `/backend/items/${row.id}`);
          if (item && method === 'GET') return json({ item });
          if (item && method === 'PATCH') {
            const body = request.postDataJSON();
            await new Promise(resolve => setTimeout(resolve, 650));
            if ('note' in body && failNote) { failNote = false; return json({ message: '演示保存失败，请重试' }, 409); }
            Object.assign(item, body); return json({ item });
          }
        }
        if (url.pathname.startsWith('/backend/resale')) {
          const suffix = url.pathname.replace('/backend/resale', '');
          if (suffix === '/account') return json({ state: 'authenticated', label: '已登录', authenticated: true, loginAvailable: true, accountLabel: '演示账号', checkedAt: new Date().toISOString(), message: '', capabilities: { search: true, publish: false, edit: false, metrics: false } });
          if (!suffix && method === 'GET') return json({ ...realResale, listings: rows, total: rows.length, counts: { draft: rows.length }, todayAttempts: 0, publisher: { configured: false, mode: 'manual', label: '官方页面确认', sellerActions: [] } });
          if (suffix === '/candidates') return json({ items: [], total: 0 });
          const row = rows.find(candidate => suffix === `/${candidate.id}`);
          if (row && method === 'GET') return json({ listing: row, events: [] });
          if (row && method === 'PATCH') {
            await new Promise(resolve => setTimeout(resolve, 800));
            Object.assign(row, request.postDataJSON(), { version: row.version + 1, humanControl: true });
            return json({ listing: row });
          }
          return json({});
        }
        if (url.pathname === '/operations/') return route.fulfill({ contentType: 'text/html', body: '<html><body>演示运营页面</body></html>' });
        if (!['GET', 'HEAD', 'OPTIONS'].includes(method) || /\/analysis(?:\/|$)/.test(url.pathname) || /\/ai\/(chat|translate|read|analyze)/.test(url.pathname)) return json({});
        if (/\/assistant\//.test(url.pathname)) return json({ messages: [] });
        return route.continue();
      });
      try {
        await page.goto(`${base}/?workspace=workbench`, { waitUntil: 'domcontentloaded' });
        await page.locator('#workbench-title').waitFor(); await visibleImages(page); await pause(page, 1100);
        const trimLeadSeconds = Math.max(0, (Date.now() - started) / 1000 - .45);
        const nav = page.getByRole('navigation', { name: '主要工作区' });
        for (const name of ['首页', 'AI', '工作台']) { await nav.getByRole('button', { name, exact: true }).hover(); await pause(page, 320); }
        await press(page, nav.getByRole('button', { name: '工作台', exact: true }), 180);
        run.steps.push('primary-navigation-hover-and-spring-press');
        if (label === 'desktop') {
          for (const name of [/^商品库/, /^链接专区/, /^收藏/, /^商品库/]) { await page.getByRole('button', { name }).first().hover(); await pause(page, 420); }
          run.steps.push('workbench-action-rail-continuous-selection');
        }
        await press(page, page.getByRole('button', { name: /^商品库/ }).first());
        const card = page.locator('.js-product-card:visible').first(); await card.waitFor();
        await card.scrollIntoViewIfNeeded(); await visibleImages(page); await pause(page, 800);
        const gallery = card.getByRole('group', { name: /^商品图片：/ });
        await press(page, gallery.getByRole('button', { name: '查看下一张商品图片', exact: true }));
        await visibleImages(page); await pause(page, 750);
        await press(page, gallery.getByRole('button', { name: '查看上一张商品图片', exact: true }));
        await visibleImages(page);
        run.steps.push('product-gallery-directional-switch-with-decoded-images');
        await screenshot(page, `${label}-catalog.png`); run.screenshots.push(`${label}-catalog.png`);
        await press(page, card.getByRole('button', { name: '收藏商品', exact: true }));
        await card.getByText('已收藏', { exact: true }).waitFor(); await pause(page, 950);
        await press(page, card.getByRole('button', { name: '加入购物车', exact: true }));
        await card.getByText('已加入采购清单', { exact: true }).waitFor(); await pause(page, 850);
        run.steps.push('favorite-and-cart-pending-to-confirmed-feedback');
        await press(page, card.getByRole('button', { name: '添加采购备注', exact: true }));
        const note = page.getByRole('dialog', { name: '采购备注', exact: true });
        await note.getByRole('textbox').fill('核对配件与运费'); await pause(page, 500);
        await press(page, note.getByRole('button', { name: '保存', exact: true }));
        await note.getByText('备注保存失败，请重试', { exact: true }).waitFor();
        assert.equal(await note.getByRole('textbox').inputValue(), '核对配件与运费');
        await screenshot(page, `${label}-note-retry.png`); run.screenshots.push(`${label}-note-retry.png`); await pause(page, 1000);
        await press(page, note.getByRole('button', { name: '保存', exact: true }));
        await note.waitFor({ state: 'hidden' }); await pause(page, 800);
        run.steps.push('note-failure-keeps-input-and-success-confirmation');
        await press(page, nav.getByRole('button', { name: '工作台', exact: true }));
        await page.locator('#workbench-title').waitFor();
        await press(page, page.getByRole('button', { name: /^闲鱼上架/ }).first());
        const workspace = page.getByRole('region', { name: '闲鱼运营', exact: true }); await workspace.waitFor();
        await visibleImages(page); await pause(page, 850);
        await press(page, workspace.getByRole('button', { name: new RegExp(listingTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }));
        await workspace.getByLabel('标题', { exact: true }).waitFor();
        await visibleImages(page); await pause(page, 750);
        await press(page, workspace.getByRole('button', { name: '选择第 2 张图片', exact: true }));
        await press(page, workspace.getByText('管理图片', { exact: true }));
        await press(page, workspace.getByRole('button', { name: '设为封面', exact: true }));
        await workspace.getByText('封面已更新，保存后生效', { exact: true }).waitFor();
        await workspace.getByText('管理图片', { exact: true }).click();
        run.steps.push('resale-photo-selection-and-cover-result');
        await screenshot(page, `${label}-resale-photo-edit.png`); run.screenshots.push(`${label}-resale-photo-edit.png`);
        await press(page, workspace.getByRole('button', { name: '商品预览', exact: true }));
        const preview = workspace.getByRole('article', { name: '商品预览内容', exact: true }); await preview.waitFor();
        await preview.scrollIntoViewIfNeeded(); await visibleImages(page); await pause(page, 750);
        await press(page, preview.getByRole('button', { name: '下一张', exact: true }));
        await visibleImages(page); await pause(page, 650);
        await press(page, preview.getByRole('button', { name: '上一张', exact: true }));
        await visibleImages(page);
        await screenshot(page, `${label}-resale-preview.png`); run.screenshots.push(`${label}-resale-preview.png`); await pause(page, 900);
        await press(page, workspace.getByRole('button', { name: '编辑商品', exact: true }));
        await press(page, workspace.getByRole('button', { name: '保存修改', exact: true }));
        await workspace.getByText('已保存，商品由人工接管', { exact: true }).waitFor(); await pause(page, 1000);
        run.steps.push('resale-preview-return-and-save-pending-to-checkmark');
        if (label === 'mobile') await press(page, workspace.getByRole('button', { name: '返回商品列表', exact: true }));
        const add = workspace.getByRole('button', { name: '添加货源', exact: true });
        await press(page, add);
        const sheet = page.getByRole('dialog', { name: '货源与市场', exact: true });
        await page.waitForFunction(() => { const dialog = document.querySelector('dialog[aria-labelledby="resale-tool-title"]'); return dialog?.open && getComputedStyle(dialog).transform === 'none'; });
        await screenshot(page, `${label}-resale-tools.png`); run.screenshots.push(`${label}-resale-tools.png`); await pause(page, 750);
        if (label === 'mobile') {
          const rect = await sheet.locator('header').first().boundingBox();
          const x = rect.x + 30, y = rect.y + 36;
          await page.mouse.move(x, y); await page.mouse.down();
          await page.mouse.move(x, y + 90, { steps: 16 }); await pause(page, 220);
          await screenshot(page, 'mobile-sheet-drag.png'); run.screenshots.push('mobile-sheet-drag.png');
          await page.mouse.move(x, y + 12, { steps: 14 }); await page.mouse.up();
          await page.waitForFunction(() => { const dialog = document.querySelector('dialog[aria-labelledby="resale-tool-title"]'); return dialog?.open && getComputedStyle(dialog).transform === 'none'; });
          await pause(page, 900);
          await page.mouse.move(x, y); await page.mouse.down();
          await page.mouse.move(x, y + 152, { steps: 20 }); await pause(page, 120); await page.mouse.up();
          await page.waitForFunction(() => !document.querySelector('dialog[aria-labelledby="resale-tool-title"]').open);
          assert.equal(await add.evaluate(node => node === document.activeElement), true);
          run.steps.push('mobile-sheet-direct-drag-reversal-spring-return-down-dismiss-and-focus');
        } else { await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'hidden' }); run.steps.push('resale-tools-drawer-and-escape-focus-return'); }
        await visibleImages(page); await pause(page, 1300);
        assert.deepEqual(run.pageErrors, []);
        assert.deepEqual(run.consoleErrors.filter(text => text !== 'Failed to load resource: the server responded with a status of 409 (Conflict)'), []);
        run.expectedFixture409 = run.consoleErrors.filter(text => text === 'Failed to load resource: the server responded with a status of 409 (Conflict)').length;
        run.durationSeconds = Math.round((Date.now() - started) / 1000 - trimLeadSeconds);
        const video = page.video(); await context.close();
        const raw = await video.path();
        const extension = encoder?.h264 ? 'mp4' : 'webm';
        const finalPath = path.join(output, `${label}.${extension}`);
        run.trimLeadSeconds = +trimLeadSeconds.toFixed(3);
        if (encoder) {
          const args = ['-y', '-hide_banner', '-ss', trimLeadSeconds.toFixed(3), '-i', raw, '-an', '-c:v', encoder.h264 ? 'libx264' : 'libvpx', ...(encoder.h264 ? ['-pix_fmt', 'yuv420p', '-movflags', '+faststart'] : ['-crf', '8', '-b:v', '4500k']), finalPath];
          const converted = spawnSync(encoder.executable, args, { encoding: 'utf8' });
          assert.equal(converted.status, 0, converted.stderr);
        } else fs.copyFileSync(raw, finalPath);
        run.video = path.basename(finalPath); run.format = extension;
        fs.writeFileSync(path.join(output, 'stdout.txt'), report.runs.filter(row => row.video).map(row => JSON.stringify({ label: row.label, video: row.video, durationSeconds: row.durationSeconds, steps: row.steps, pageErrors: row.pageErrors.length, realBusinessWrites: 0, realModels: 0 })).join('\n') + '\n');
        console.log(JSON.stringify({ label, video: run.video, durationSeconds: run.durationSeconds, steps: run.steps, pageErrors: 0, realBusinessWrites: 0, realModels: 0 }));
      } catch (error) {
        await page.screenshot({ path: path.join(output, `${label}-failure.png`) }).catch(() => {});
        run.failed = error.stack; await context.close(); throw error;
      } finally { fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2)); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
