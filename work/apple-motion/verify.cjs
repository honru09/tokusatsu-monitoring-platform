'use strict';
const { chromium } = require('../../workers/crawlers/node_modules/playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.APPLE_UI_URL || 'http://127.0.0.1:3105';
const directory = path.join(__dirname, process.env.APPLE_UI_STAGE || 'development');
fs.mkdirSync(directory, { recursive: true });
const workspaces = ['inventory','catalog','links','purchases','orders','favorites','sellers','intel','disliked','monitoring','resale','ai','logistics','calculator','operations','assistant','collaboration','workbench','profile'];
async function read(url) { const response = await fetch(`${base}/backend/${url}`); assert.ok(response.ok, url); return response.json(); }
async function layout(page) {
  return page.evaluate(() => {
    const content = document.querySelector('.procurement-content');
    const header = document.querySelector('.procurement-header');
    const nav = document.querySelector('.primary-navigation');
    const shell = document.querySelector('.procurement-shell');
    return {
      documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      contentOverflow: content.scrollWidth > content.clientWidth + 1,
      background: getComputedStyle(shell).backgroundImage,
      ink: getComputedStyle(shell).color,
      accent: getComputedStyle(shell).getPropertyValue('--ui-accent').trim(),
      headerBlur: getComputedStyle(header).backdropFilter,
      navigation: { top: nav.getBoundingClientRect().top, bottom: nav.getBoundingClientRect().bottom },
      navCount: nav.querySelectorAll('button').length,
      contentTransform: getComputedStyle(content).transform,
    };
  });
}
(async () => {
  const [accounts, overview, resaleBefore, items] = await Promise.all([read('collaboration/accounts'), read('monitoring/overview'), read('resale'), read('items?listingType=direct&limit=3')]);
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const report = { base, pages: [], interactions: [], intercepted: [], errors: [], consoleErrors: [] };
  try {
    for (const setting of [
      { width: 1440, height: 1000, reducedMotion: 'no-preference' },
      { width: 390, height: 844, reducedMotion: 'no-preference' },
      { width: 320, height: 568, reducedMotion: 'reduce' },
      { width: 768, height: 1024, reducedMotion: 'no-preference' },
      { width: 1280, height: 800, reducedMotion: 'reduce' },
    ]) {
      const context = await browser.newContext({ viewport: { width: setting.width, height: setting.height }, reducedMotion: setting.reducedMotion });
      await context.addInitScript(id => localStorage.setItem('kamen-procurement-manager-v1', id), accounts.accounts[0].id);
      const page = await context.newPage();
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error') report.consoleErrors.push(message.text());
      });
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname === '/backend/monitoring/overview') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overview) });
        if (url.pathname === '/operations/') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body style="font:15px system-ui;background:#f5f5f7;color:#1d1d1f">运营会话只读验收夹具</body></html>' });
        if (url.pathname === '/backend/cart/share/ui-preview') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ snapshot: { title: '采购分享清单', itemCount: items.items.length, createdAt: new Date().toISOString(), items: items.items } }) });
        if (!['GET','HEAD','OPTIONS'].includes(request.method()) || /\/analysis(?:\/|$)/.test(url.pathname) || /\/ai\/(chat|translate|read|analyze)/.test(url.pathname)) {
          report.intercepted.push({ method: request.method(), path: url.pathname });
          return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        }
        return route.continue();
      });
      const targets = [1440,390].includes(setting.width) ? workspaces : ['inventory','catalog','workbench','resale','assistant'];
      for (const workspace of targets) {
        await page.goto(`${base}/?workspace=${workspace}`, { waitUntil: 'domcontentloaded' });
        await page.locator(`.workspace-${workspace}`).waitFor();
        if (workspace === 'inventory') await page.locator('.home-entry-directory').waitFor();
        if (workspace === 'catalog') await page.locator('.js-product-card:visible').first().waitFor();
        if (workspace === 'resale') {
          await page.getByRole('region', { name: '闲鱼运营', exact: true }).waitFor();
          const listing = resaleBefore.listings.find(row => row.images?.length) || resaleBefore.listings[0];
          if (listing) {
            const prefix = listing.title.slice(0, 12).replace(/\s+/g, ' ');
            await page.getByRole('button', { name: new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
            await page.getByLabel('标题', { exact: true }).waitFor();
          }
        }
        await page.waitForTimeout(700);
        const info = await layout(page);
        assert.equal(info.documentOverflow, false, `${workspace} ${setting.width} document`);
        assert.equal(info.contentOverflow, false, `${workspace} ${setting.width} content`);
        assert.match(info.background, /gradient/, 'Apple daylight restored');
        assert.equal(info.ink, 'rgb(29, 29, 31)');
        assert.equal(info.accent, '#0071e3');
        assert.equal(info.navCount, 4);
        assert.equal(info.contentTransform, 'none', 'fixed/sticky ancestors remain clear');
        if (setting.width < 640) assert.ok(info.navigation.bottom <= setting.height + 1 && info.navigation.top >= setting.height - 100);
        if (['inventory','workbench','resale','catalog'].includes(workspace) && [1440,390].includes(setting.width)) {
          await page.waitForFunction(() => [...document.images].filter(img => {
            const rect = img.getBoundingClientRect();
            return img.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) && rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.bottom > 0 && rect.left < innerWidth && rect.right > 0;
          }).every(img => img.complete && img.naturalWidth > 0));
          await page.evaluate(() => Promise.all([...document.images].filter(img => img.complete && img.naturalWidth > 0).map(img => img.decode())));
          await page.screenshot({ path: path.join(directory, `${workspace}-${setting.width}.png`) });
        }
        report.pages.push({ workspace, ...setting, ...info });
      }
      if ([1440,390].includes(setting.width)) {
        await page.goto(`${base}/share/ui-preview`);
        await page.locator('.share-editorial-item').first().waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        report.pages.push({ workspace: 'share', ...setting, documentOverflow: false });
      }
      await page.goto(`${base}/?workspace=workbench`);
      await page.locator('.workspace-workbench').waitFor();
      for (const label of ['消息','AI','首页','工作台']) await page.getByRole('navigation', { name: '主要工作区' }).getByRole('button', { name: label, exact: true }).click();
      await page.locator('.workspace-workbench').waitFor();
      await page.waitForTimeout(750);
      assert.equal((await layout(page)).contentTransform, 'none');
      const navButton = page.getByRole('navigation', { name: '主要工作区' }).getByRole('button', { name: '首页', exact: true });
      await navButton.focus();
      await page.keyboard.press('Enter');
      await page.locator('.workspace-inventory').waitFor();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'), true);
      report.interactions.push({ width: setting.width, reducedMotion: setting.reducedMotion, rapidNavigation: true, keyboardNavigation: true, fixedAncestorClear: true });
      await context.close();
    }
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.consoleErrors.filter(text => !/^Failed to load resource:/.test(text)), []);
    const resaleAfter = await read('resale');
    const stable = data => ({ settings: data.settings, listings: data.listings.map(row => ({ id: row.id, status: row.status, version: row.version, price: row.priceCny, title: row.title })) });
    assert.deepEqual(stable(resaleAfter), stable(resaleBefore));
    report.resaleUnchanged = true;
    report.realWritesAndModelCalls = 0;
    console.log(JSON.stringify({ pages: report.pages.length, interactionGroups: report.interactions.length, pageErrors: report.errors.length, resaleUnchanged: true }));
  } finally {
    fs.writeFileSync(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
