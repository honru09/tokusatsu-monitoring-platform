'use strict';
const { chromium } = require('../../workers/crawlers/node_modules/playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.DEEP_APPLE_URL || 'http://127.0.0.1:3105';
const output = process.env.DEEP_RESALE_OUTPUT || 'work/deep-apple/resale-depth-local';
(async () => {
  const accounts = await (await fetch(`${base}/backend/collaboration/accounts`)).json();
  const real = await (await fetch(`${base}/backend/resale`)).json();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const reports = [];
  try {
    for (const setting of [{ width: 1440, height: 1000, reducedMotion: 'no-preference' }, { width: 390, height: 844, reducedMotion: 'no-preference' }, { width: 320, height: 568, reducedMotion: 'reduce' }]) {
      const context = await browser.newContext({ viewport: setting, reducedMotion: setting.reducedMotion });
      await context.addInitScript(id => localStorage.setItem('kamen-procurement-manager-v1', id), accounts.accounts[0].id);
      const page = await context.newPage(), consoleError = [], pageErrors = [];
      page.on('console', message => { if (message.type() === 'error') consoleError.push(message.text()); });
      page.on('pageerror', error => pageErrors.push(error.message));
      let failSave = true;
      const rows = ['甲商品', '乙商品'].map((title, index) => ({ ...structuredClone(real.listings[0]), id: `motion-fixture-${index}`, itemId: `source-${index}`, version: 1, title, imageUrls: [0, 1, 2].map(photo => `${base}/brand-icon.svg?photo=${photo}`), status: 'draft', humanControl: false, generationError: null, generationToken: null, generationRequestedBy: null, lastError: null, requiresWithdrawal: false, targetUrl: null, rightsConfirmed: false, fulfillmentConfirmed: false }));
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), suffix = url.pathname.replace('/backend/resale', '');
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname.startsWith('/backend/resale')) {
          if (suffix === '/account') return json({ state: 'authenticated', label: '已登录', authenticated: true, loginAvailable: true, accountLabel: '只读界面夹具', checkedAt: new Date().toISOString(), message: '界面验证', capabilities: { search: true, publish: false, edit: false, metrics: false } });
          if (!suffix && request.method() === 'GET') {
            const query = url.searchParams.get('search');
            if (query) await new Promise(resolve => setTimeout(resolve, 250));
            const goods = query ? rows.filter(row => row.title.includes(query)) : rows;
            return json({ ...real, listings: goods, total: goods.length, counts: { draft: 2 }, publisher: { configured: false, mode: 'manual', label: '官方页面确认', sellerActions: [] } });
          }
          if (suffix === '/candidates') return json({ items: [], total: 0 });
          const row = rows.find(candidate => suffix === `/${candidate.id}`);
          if (row && request.method() === 'GET') return json({ listing: row, events: [] });
          if (row && request.method() === 'PATCH') {
            if (failSave) { failSave = false; return json({ message: '测试保存失败，修改仍保留' }, 409); }
            const body = request.postDataJSON(); Object.assign(row, body, { version: row.version + 1, humanControl: true });
            return json({ listing: row });
          }
          throw new Error(`Unexpected fixture resale request: ${request.method()} ${suffix}`);
        }
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || /\/analysis(?:\/|$)/.test(url.pathname) || /\/ai\/(chat|translate|read|analyze)/.test(url.pathname)) return json({});
        return route.continue();
      });
      await page.goto(`${base}/?workspace=resale`, { waitUntil: 'domcontentloaded' });
      const workspace = page.getByRole('region', { name: '闲鱼运营', exact: true });
      await workspace.getByRole('button', { name: /甲商品/ }).waitFor();
      const search = workspace.getByLabel('搜索货源或上架商品', { exact: true });
      await search.fill('甲'); await workspace.getByRole('button', { name: '搜索', exact: true }).click();
      await workspace.getByText('正在更新商品…', { exact: true }).waitFor();
      await workspace.getByText('找到 1 件商品', { exact: true }).waitFor();
      await search.fill(''); await search.press('Enter');
      await workspace.getByRole('button', { name: /乙商品/ }).waitFor();
      await workspace.getByRole('button', { name: /甲商品/ }).click();
      const editor = workspace.getByRole('region', { name: '编辑上架商品', exact: true });
      await workspace.getByRole('button', { name: '选择第 2 张图片', exact: true }).click();
      await workspace.getByText('管理图片', { exact: true }).click();
      await workspace.getByRole('button', { name: '设为封面', exact: true }).click();
      await workspace.getByText('封面已更新，保存后生效', { exact: true }).waitFor();
      assert.match(await workspace.getByRole('img', { name: '上架图片 1', exact: true }).getAttribute('src'), /photo=1$/);
      await workspace.getByRole('button', { name: '商品预览', exact: true }).click();
      const preview = workspace.getByRole('article', { name: '商品预览内容', exact: true });
      await preview.getByRole('button', { name: '下一张' }).click();
      await preview.getByRole('button', { name: '上一张' }).click();
      await workspace.getByRole('button', { name: '编辑商品', exact: true }).focus(); await page.keyboard.press('Enter');
      assert.equal(await workspace.getByLabel('标题', { exact: true }).evaluate(node => getComputedStyle(node.closest('form')).transform), 'none');
      await workspace.getByLabel('标题', { exact: true }).fill('人工编辑保留');
      assert.deepEqual(consoleError, []); // Fresh SSR and all interactions before the intentional failure stay clean.
      await workspace.getByRole('button', { name: '保存修改', exact: true }).click();
      await workspace.getByText('测试保存失败，修改仍保留', { exact: true }).waitFor();
      assert.equal(await workspace.getByLabel('标题', { exact: true }).inputValue(), '人工编辑保留');
      await workspace.getByRole('button', { name: '保存修改', exact: true }).click();
      await workspace.getByText('已保存，商品由人工接管', { exact: true }).waitFor();
      assert.equal(await workspace.getByText('封面已更新，保存后生效', { exact: true }).count(), 0);
      if (setting.width < 768) {
        await workspace.getByRole('button', { name: '返回商品列表', exact: true }).click();
        const add = workspace.getByRole('button', { name: '添加货源', exact: true }); await add.click();
        const sheet = page.getByRole('dialog', { name: '货源与市场', exact: true });
        await page.waitForFunction(() => { const dialog = document.querySelector('dialog[aria-labelledby="resale-tool-title"]'); return dialog?.open && getComputedStyle(dialog).transform === 'none'; });
        const header = sheet.locator('header').first(), rect = await header.boundingBox();
        await page.mouse.move(rect.x + 30, rect.y + 36); await page.mouse.down(); await page.mouse.move(rect.x + 30, rect.y + 96, { steps: 5 }); await page.mouse.move(rect.x + 30, rect.y + 44, { steps: 5 }); await page.mouse.up();
        await page.waitForFunction(() => { const dialog = document.querySelector('dialog[aria-labelledby="resale-tool-title"]'); return dialog?.open && getComputedStyle(dialog).transform === 'none'; });
        await page.mouse.move(rect.x + 30, rect.y + 36); await page.mouse.down(); await page.mouse.move(rect.x + 30, rect.y + 156, { steps: 5 }); await page.mouse.up();
        await sheet.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => !document.querySelector('dialog[aria-labelledby="resale-tool-title"]').open);
        assert.equal(await add.evaluate(node => node === document.activeElement), true);
      }
      assert.deepEqual(consoleError.filter(message => message !== 'Failed to load resource: the server responded with a status of 409 (Conflict)'), []); assert.deepEqual(pageErrors, []);
      const run = { width: setting.width, reducedMotion: setting.reducedMotion, passed: ['SSR-no-console-or-hydration-errors', 'real-search-request-feedback', 'photo-cover-result-feedback', 'preview-direction-and-keyboard-instant-return', 'failed-save-keeps-input', 'saved-state-clears-unsaved-photo-message', ...(setting.width < 768 ? ['sheet-drag-reversal-and-close-focus'] : [])], pageErrors, hydrationErrors: consoleError.filter(message => /hydration|did not match|server rendered|hydrated/i.test(message)), expectedFixture409: consoleError.filter(message => message === 'Failed to load resource: the server responded with a status of 409 (Conflict)').length };
      reports.push(run);
      console.log(JSON.stringify(run));
      await context.close();
    }
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ base, runs: reports, realBusinessWrites: 0, realModels: 0 }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
