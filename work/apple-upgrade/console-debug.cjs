'use strict';
const { chromium } = require('../../workers/crawlers/node_modules/playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const target = process.env.EDITORIAL_UI_URL || 'http://localhost:3105';
const out = path.resolve(__dirname, 'console-debug');
const accounts = [
  { id: '11111111-1111-4111-8111-111111111111', key: 'manager_one', displayName: '龙', avatarInitial: '龙', position: 1, active: true, online: true, stats: { shares: 1337, favorites: 864, dislikes: 29 } },
  { id: '22222222-2222-4222-8222-222222222222', key: 'manager_two', displayName: '润', avatarInitial: '润', position: 2, active: true, online: false, stats: { shares: 427, favorites: 92, dislikes: 8 } },
];
const title = 'S.H.Figuarts 仮面ライダー / 假面骑士限定套装，附属配件与原盒需核对（长中日文标题排版验收）';
const item = { id: 'editorial-product-1', titleRaw: title, titleZh: title, sourceUrl: 'https://jp.mercari.com/item/editorial-fixture', priceCurrent: 9999999, listingType: 'direct', source: { key: 'mercari', displayName: 'Mercari' }, images: [], product: null };
const baseMessage = { recipientId: accounts[0].id, senderId: accounts[1].id, sender: accounts[1], recipient: accounts[0], replyToId: null, forwardedFromId: null, readAt: '2026-10-09T04:10:00Z', updatedAt: '2026-10-09T04:10:00Z', replyTo: null, reactions: [] };
const messages = Array.from({ length: 22 }, (_, index) => ({ ...baseMessage, id: `editorial-message-${index}`, createdAt: new Date(Date.UTC(2026, 9, 9, 3, index)).toISOString(), text: index === 21 ? '先确认数量、配件与运费。来源信息保留原文，中文标题可以继续人工调整。' : `第 ${index + 1} 条采购讨论：已核对商品资料。`, itemId: index === 21 ? item.id : null, item: index === 21 ? item : null }));
const assistantHistory = Array.from({ length: 16 }, (_, index) => ({ id: `history-${index}`, role: index % 2 ? 'assistant' : 'user', content: index % 2 ? '请先核对总价、运费与套装数量，再判断采购价值。未知字段仍需人工确认。' : '帮我整理这件商品的采购信息。', ...(index === 15 ? { items: [item, { ...item, id: 'editorial-product-2', titleZh: '附属配件待确认的商品', priceCurrent: 12400 }], suggestions: ['哪些字段还需要确认？'], model: 'glm-5.3-flash', generatedAt: '2026-10-09T04:10:00Z' } : {}) }));
const resource = { configured: true, available: true, model: 'glm-5.3-flash', tokenLimit: 14000000, dailyTokenLimit: 200000, accountedTokens: 5090, todayTokens: 5090, remainingLocalBudget: 13994910, expiresAt: '2026-11-09T06:35:56.000Z', allowedUses: ['product_reading', 'translation', 'chat'], note: '本地统计并非账号实时余额；本次界面验收使用夹具，不调用模型。' };
const viewportCases = [{ width: 320, height: 780 }, { width: 390, height: 844 }, { width: 768, height: 960 }, { width: 1280, height: 900 }, { width: 1440, height: 960 }, { width: 320, height: 568 }].filter(row => !process.env.EDITORIAL_CASES || process.env.EDITORIAL_CASES.split(',').includes(`${row.width}x${row.height}`));

async function measure(page, rootSelector) {
  return page.evaluate(selector => {
    const root = document.querySelector(selector);
    const visible = node => { const b = node.getBoundingClientRect(); const s = getComputedStyle(node); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !node.closest('[hidden],[inert]') && b.bottom > 0 && b.top < innerHeight; };
    const controls = Array.from(root.querySelectorAll('button,a,summary,input,textarea')).filter(visible).map(node => { const b = node.getBoundingClientRect(); return { label: node.getAttribute('aria-label') || node.textContent?.trim().slice(0, 40) || node.placeholder, width: b.width, height: b.height }; });
    const overflow = Array.from(root.querySelectorAll('*')).filter(visible).filter(node => { const b = node.getBoundingClientRect(); return b.right > innerWidth + 1 || b.left < -1; }).map(node => ({ className: String(node.className), tag: node.tagName, right: node.getBoundingClientRect().right })).slice(0, 15);
    return { pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, controls, smallControls: controls.filter(node => node.width < 43.5 || node.height < 43.5), overflow, root: root.getBoundingClientRect().toJSON() };
  }, rootSelector);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const reportFile = path.join(out, 'report.json');
  const results = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : [];
  try {
    for (const viewport of viewportCases) for (const reducedMotion of ['no-preference', 'reduce']) {
      const context = await browser.newContext({ viewport, reducedMotion, isMobile: viewport.width < 700, hasTouch: viewport.width < 700 });
      await context.addInitScript(({ actor, history }) => { localStorage.setItem('kamen-procurement-manager-v1', actor); if (!localStorage.getItem('editorial-assistant-empty') && !localStorage.getItem('kamen-procurement-assistant-v1')) localStorage.setItem('kamen-procurement-assistant-v1', JSON.stringify(history)); }, { actor: accounts[0].id, history: assistantHistory });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if(message.type() === 'error' || message.type() === 'warning') console.log(message.type(), message.text()); });
      let modelRequests = 0;
      let chatRequests = 0;
      let savedMessages = messages.slice();
      let resourceState = 'ready';
      let releaseResource;
      let emptyConversation = false;
      let holdChatResponse = false;
      let releaseChat;
      await page.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const endpoint = url.pathname.replace(/^\/backend/, '');
        const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
        if (url.pathname === '/operations-browser/' || url.pathname === '/operations-browser') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:14px system-ui;color:#1d1d1f;background:#fff;padding:24px}header{border-bottom:1px solid #e8e8ed;padding-bottom:16px}button{min-height:44px;border:1px solid #e8e8ed;padding:8px 16px;background:#fff;border-radius:8px;margin-top:16px}</style><header>运营浏览器 · 同源只读验收夹具</header><p>窗口与消息保持连接，验收不会操作真实会话。</p><button onclick="parent.postMessage({type:\'kamen-operations:navigate\',workspace:\'collaboration\'},location.origin)">消息</button></html>' });
        if (endpoint === '/collaboration/accounts') return json({ accounts });
        if (endpoint === '/collaboration/messages' && request.method() === 'GET') return json({ messages: emptyConversation ? [] : savedMessages, nextAfter: savedMessages.at(-1)?.updatedAt || null });
        if (endpoint === '/collaboration/negotiations') return json({ cases: [{ id: 'case-1', status: 'in_progress', statusChangedAt: '2026-10-09T04:00:00Z', item, initiatedBy: accounts[0] }] });
        if (endpoint === '/ai/resources') { if (resourceState === 'error') return json({ message: '状态读取验收错误，请重试' }, 503); if (resourceState === 'loading') await new Promise(resolve => { releaseResource = resolve; }); return json(resource); }
        if (endpoint === '/ai/chat') { chatRequests++; const body = request.postDataJSON(); if (holdChatResponse) await new Promise(resolve => { releaseChat = resolve; }); return json({ answerZh: `界面验收回复：${body.message}`, items: [], suggestions: [], model: 'glm-5.3-flash', generatedAt: new Date().toISOString(), fallbackUsed: false }); }
        if (/^\/(ai|analysis)(\/|$)/.test(endpoint)) { modelRequests++; return json({ message: '界面验收拦截模型与分析请求' }, 403); }
        if (request.method() !== 'GET' && request.method() !== 'HEAD') {
          if (endpoint === '/collaboration/messages') { const body = request.postDataJSON(); const saved = { ...baseMessage, id: `saved-${Date.now()}`, senderId: accounts[0].id, recipientId: accounts[1].id, sender: accounts[0], recipient: accounts[1], text: body.text || null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), item: body.itemId ? item : null, itemId: body.itemId || null, replyTo: body.replyToId ? messages[21] : null }; savedMessages.push(saved); return json(saved); }
          if (endpoint === '/collaboration/presence') return json({ account: accounts[0] });
          return json({ ok: true, count: 0 });
        }
        return route.continue();
      });

      const caseResults = { ...viewport, reducedMotion, pages: [], errors, modelRequests: 0 };
      for (const workspace of ['ai']) {
        await page.goto(`${target}/?workspace=${workspace}`, { waitUntil: 'domcontentloaded' });
        const selectors = { collaboration: '.collaboration-chat', assistant: '.assistant-chat', ai: '[aria-labelledby="ai-system-title"]', profile: '.manager-profile-page', operations: '.operations-workspace' };
        const root = page.locator(selectors[workspace]);
        await root.waitFor({ state: 'visible' });
        if (workspace === 'collaboration') await root.getByText(messages[21].text, { exact: true }).waitFor();
        if (workspace === 'assistant') await root.getByText('哪些字段还需要确认？', { exact: true }).waitFor();
        if (workspace === 'ai') await root.getByText('glm-5.3-flash', { exact: true }).waitFor();
        if (workspace === 'profile') await root.locator('.manager-profile-card').waitFor();
        if (workspace === 'operations') await page.frameLocator('iframe[data-operations-frame]').getByText('运营浏览器 · 同源只读验收夹具', { exact: true }).waitFor();
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(out, `${workspace}-${viewport.width}x${viewport.height}-${reducedMotion}-default.png`), fullPage: false });
        if (workspace === 'collaboration') {
          await root.getByText(messages[21].text, { exact: true }).waitFor();
          const bubble = root.locator('.collaboration-message').last();
          await bubble.click();
          await root.getByRole('toolbar', { name: '消息操作' }).waitFor();
          const tool = await measure(page, selectors[workspace]);
          assert.equal(tool.overflow.length, 0, `${workspace} tool overflow ${JSON.stringify(tool.overflow)}`);
          await root.getByRole('button', { name: '回复消息', exact: true }).click();
          assert.equal(await root.getByRole('toolbar').count(), 0);
          await root.getByRole('button', { name: '移除引用', exact: true }).click();
          await root.locator('summary').click();
          assert.equal(await root.locator('details').evaluate(node => node.open), true);
        }
        if (workspace === 'assistant') {
          await root.getByText('哪些字段还需要确认？', { exact: true }).waitFor();
          const feed = root.locator('.assistant-chat-feed');
          await feed.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll', { bubbles: true })); });
          const box = root.getByRole('textbox', { name: '向 AI 采购助手提问', exact: true });
          await box.fill('界面验收问题');
          await root.getByRole('button', { name: '发送', exact: true }).click();
          await root.getByText('界面验收回复：界面验收问题', { exact: true }).waitFor();
          assert.equal(chatRequests, 1);
        }
        if (workspace === 'profile') {
          const tabs = root.getByRole('tab');
          await tabs.first().focus();
          await page.keyboard.press('ArrowRight');
          await tabs.nth(1).waitFor();
          assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
          assert.equal(await tabs.nth(1).evaluate(node => document.activeElement === node), true);
        }
        if (workspace === 'ai') {
          await root.getByText('glm-5.3-flash', { exact: true }).waitFor();
          await root.locator('summary').click();
        }
        if (workspace === 'operations') {
          await page.frameLocator('iframe[data-operations-frame]').getByText('运营浏览器 · 同源只读验收夹具', { exact: true }).waitFor();
          const frameId = await root.locator('iframe').evaluate(node => { node.dataset.validationId = 'same-frame'; return node.dataset.validationId; });
          await root.getByRole('button', { name: '重新连接', exact: true }).click();
          assert.equal(await root.locator('iframe').getAttribute('data-validation-id'), frameId);
          await root.getByRole('button', { name: '展开', exact: true }).click();
          assert.equal(await page.evaluate(() => document.documentElement.dataset.operationsExpanded), 'true');
          await root.getByRole('button', { name: '收起', exact: true }).click();
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(250);
        const metrics = await measure(page, selectors[workspace]);
        caseResults.pages.push({ workspace, ...metrics });
        await page.screenshot({ path: path.join(out, `${workspace}-${viewport.width}x${viewport.height}-${reducedMotion}.png`), fullPage: false });
        assert.equal(metrics.pageOverflow, false, `${workspace} page overflow ${viewport.width}`);
        assert.deepEqual(metrics.smallControls, [], `${workspace} small controls ${JSON.stringify(metrics.smallControls)}`);
        assert.deepEqual(metrics.overflow, [], `${workspace} viewport overflow ${JSON.stringify(metrics.overflow)}`);
      }
      if (process.env.EDITORIAL_INTERACTIONS === '1') {
        const ai = page.locator('[aria-labelledby="ai-system-title"]');
        await page.goto(`${target}/?workspace=ai`, { waitUntil: 'domcontentloaded' });
        await ai.getByText('glm-5.3-flash', { exact: true }).waitFor();
        await page.evaluate(() => { window.__editorialNavigationMarker = 'preserved'; });
        await ai.getByRole('button', { name: '到商品库，从详情读取商品', exact: true }).click();
        await page.waitForURL('**/?workspace=catalog');
        assert.equal(await page.evaluate(() => window.__editorialNavigationMarker), 'preserved');
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await ai.getByText('glm-5.3-flash', { exact: true }).waitFor();
        await ai.getByRole('button', { name: '打开 AI 聊天', exact: true }).click();
        await page.waitForURL('**/?workspace=assistant');
        assert.equal(await page.evaluate(() => window.__editorialNavigationMarker), 'preserved');
        assert.equal(chatRequests, 1, 'Navigation must not request a chat response');
        const assistant = page.locator('.assistant-chat');
        holdChatResponse = true;
        await assistant.getByRole('textbox', { name: '向 AI 采购助手提问', exact: true }).fill('旧消息阅读位置');
        await assistant.getByRole('button', { name: '发送', exact: true }).click();
        await assistant.getByRole('status').waitFor();
        await assistant.locator('.assistant-chat-feed').evaluate(node => { node.scrollTop = 40; node.dispatchEvent(new Event('scroll', { bubbles: true })); });
        releaseChat();
        await assistant.getByText('界面验收回复：旧消息阅读位置', { exact: true }).waitFor({ state: 'attached' });
        assert.equal(await assistant.locator('.assistant-chat-feed').evaluate(node => node.scrollTop), 40);
        holdChatResponse = false;
        emptyConversation = true;
        await page.evaluate(() => sessionStorage.clear());
        await page.goto(`${target}/?workspace=collaboration`, { waitUntil: 'domcontentloaded' });
        await page.getByText('从第一件商品开始讨论', { exact: true }).waitFor();
        await page.screenshot({ path: path.join(out, `collaboration-empty-${viewport.width}x${viewport.height}-${reducedMotion}.png`) });
        assert.deepEqual((await measure(page, '.collaboration-chat')).smallControls, []);
        await page.evaluate(() => { localStorage.removeItem('kamen-procurement-assistant-v1'); localStorage.setItem('editorial-assistant-empty', 'true'); });
        await page.goto(`${target}/?workspace=assistant`, { waitUntil: 'domcontentloaded' });
        await page.getByText('找商品、查价格，或问问当前库存。', { exact: true }).waitFor();
        await page.screenshot({ path: path.join(out, `assistant-empty-${viewport.width}x${viewport.height}-${reducedMotion}.png`) });
        resourceState = 'error';
        await page.goto(`${target}/?workspace=ai`, { waitUntil: 'domcontentloaded' });
        await ai.getByRole('alert').waitFor();
        await page.screenshot({ path: path.join(out, `ai-error-${viewport.width}x${viewport.height}-${reducedMotion}.png`) });
        resourceState = 'ready';
        await ai.getByRole('button', { name: '刷新状态', exact: true }).click();
        await ai.getByText('glm-5.3-flash', { exact: true }).waitFor();
        await ai.getByRole('alert').waitFor({ state: 'detached' });
        resourceState = 'loading';
        await page.goto(`${target}/?workspace=ai`, { waitUntil: 'domcontentloaded' });
        await ai.getByRole('status').waitFor();
        await page.screenshot({ path: path.join(out, `ai-loading-${viewport.width}x${viewport.height}-${reducedMotion}.png`) });
        releaseResource();
        await ai.getByText('glm-5.3-flash', { exact: true }).waitFor();
        resourceState = 'ready';
        caseResults.interactions = ['ai-to-product-library-without-reload', 'ai-to-chat-without-reload', 'no-model-on-navigation', 'new-reply-preserves-old-reading-position', 'empty-conversation', 'empty-assistant', 'resource-error-retry', 'resource-loading-completion'];
      }
      caseResults.modelRequests = modelRequests;
      assert.equal(modelRequests, 0, 'No automatic model/analysis requests are allowed');
      assert.deepEqual(errors, []);
      const existing = results.findIndex(row => row.width === caseResults.width && row.height === caseResults.height && row.reducedMotion === caseResults.reducedMotion);
      if (existing >= 0) results[existing] = caseResults; else results.push(caseResults);
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(results, null, 2));
      console.log(JSON.stringify({ ...viewport, reducedMotion, passed: caseResults.pages.map(row => row.workspace), modelRequests, pageErrors: errors.length }));
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
