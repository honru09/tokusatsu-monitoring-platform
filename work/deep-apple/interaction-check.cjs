'use strict';
const { chromium } = require('../../workers/crawlers/node_modules/playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.DEEP_APPLE_URL || 'http://127.0.0.1:3105';
const output = path.join(__dirname, process.env.DEEP_APPLE_STAGE || 'development');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const read = async url => { const response = await fetch(`${base}/backend/${url}`); assert.ok(response.ok); return response.json(); };
  const [accounts, overview] = await Promise.all([read('collaboration/accounts'), read('monitoring/overview')]);
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const report = { base, runs: [], realBusinessWrites: 0, realModels: 0 };
  try {
    for (const setting of [
      { width: 1440, height: 1000, reducedMotion: 'no-preference' },
      { width: 390, height: 844, reducedMotion: 'no-preference' },
      { width: 320, height: 568, reducedMotion: 'reduce' },
    ]) {
      const context = await browser.newContext({ viewport: setting, reducedMotion: setting.reducedMotion });
      await context.addInitScript(id => localStorage.setItem('kamen-procurement-manager-v1', id), accounts.accounts[0].id);
      const page = await context.newPage();
      const run = { ...setting, checks: [], errors: [], consoleErrors: [], intercepted: [] };
      report.runs.push(run);
      page.on('pageerror', e => run.errors.push(e.message));
      page.on('console', message => { if (message.type() === 'error' && !/^Failed to load resource:/.test(message.text())) run.consoleErrors.push(message.text()); });
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname === '/backend/monitoring/overview') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overview) });
        if (url.pathname === '/operations/') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>运营只读验收夹具</body></html>' });
        if (!['GET','HEAD','OPTIONS'].includes(request.method()) || /\/analysis(?:\/|$)/.test(url.pathname) || /\/ai\/(chat|translate|read|analyze)/.test(url.pathname)) {
          run.intercepted.push({ method: request.method(), path: url.pathname });
          return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        }
        return route.continue();
      });
      await page.goto(`${base}/?workspace=workbench`);
      await page.locator('#workbench-title').waitFor();
      await page.waitForTimeout(700);
      const language = page.getByRole('button', { name: /显示语言/ });
      await language.scrollIntoViewIfNeeded();
      const bounds = await language.boundingBox();
      await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height * .5);
      await page.mouse.down();
      await page.waitForTimeout(140);
      assert.equal(await language.getAttribute('data-apple-pressed'), 'true');
      const light = await language.evaluate(el => ({ light: +getComputedStyle(el).getPropertyValue('--apple-touch-light'), image: getComputedStyle(el).backgroundImage, x: el.style.getPropertyValue('--apple-touch-x') }));
      assert.ok(light.light > .3);
      assert.match(light.image, /radial-gradient/);
      assert.ok(parseFloat(light.x) > 0);
      await page.mouse.up();
      assert.equal(await language.getAttribute('data-apple-pressed'), null);
      run.checks.push({ name: 'pointer-origin-light-and-release', pass: true });
      await page.mouse.down();
      await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })));
      assert.equal(await language.getAttribute('data-apple-pressed'), null);
      await page.mouse.up();
      run.checks.push({ name: 'pointer-cancel-does-not-stick', pass: true });
      await language.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.documentElement.dataset.appleInput), 'keyboard');
      assert.equal(await language.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
      await page.keyboard.down('Space');
      await page.waitForTimeout(160);
      assert.equal(await language.evaluate(el => getComputedStyle(el).transform), 'none');
      await page.keyboard.up('Space');
      run.checks.push({ name: 'keyboard-feedback-is-immediate', pass: true });
      const entry = page.getByRole('button', { name: /^链接专区/ }).first();
      await entry.hover();
      await page.waitForTimeout(450);
      const rail = await entry.evaluate(el => { const light = el.parentElement.querySelector('span[aria-hidden="true"]'); return { opacity: getComputedStyle(light).opacity, transform: getComputedStyle(light).transform }; });
      if (setting.reducedMotion === 'reduce') assert.equal(rail.opacity, '0');
      else assert.equal(rail.opacity, '1');
      run.checks.push({ name: 'action-rail-follows-action-and-reduce', pass: true });
      const nav = page.getByRole('navigation', { name: '主要工作区' });
      for (const name of ['消息','AI','首页','工作台']) await nav.getByRole('button', { name, exact: true }).click();
      await page.locator('#workbench-title').waitFor();
      await page.waitForTimeout(600);
      assert.equal(await page.locator('.procurement-content').evaluate(el => getComputedStyle(el).transform), 'none');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      run.checks.push({ name: 'rapid-navigation-and-fixed-ancestor', pass: true });
      await nav.getByRole('button', { name: '首页', exact: true }).click();
      await page.locator('.home-category-drawer').waitFor();
      const drawer = page.locator('.home-category-drawer'), summary = drawer.locator('summary');
      await summary.click();
      await page.waitForTimeout(270);
      assert.equal(await drawer.evaluate(el => el.open), true);
      const disclosure = await drawer.evaluate(el => ({ height: getComputedStyle(el, '::details-content').height, opacity: getComputedStyle(el, '::details-content').opacity }));
      assert.ok(parseFloat(disclosure.height) > 0);
      assert.equal(disclosure.opacity, '1');
      await summary.click();
      await summary.focus();
      await page.keyboard.press('Enter');
      assert.equal(await drawer.evaluate(el => el.open), true);
      assert.ok((await drawer.evaluate(el => getComputedStyle(el, '::details-content').transitionDuration)).split(',').every(duration => parseFloat(duration) < .001));
      assert.ok((await drawer.locator('summary svg').last().evaluate(el => getComputedStyle(el).transitionDuration)).split(',').every(duration => parseFloat(duration) < .001));
      await page.keyboard.press('Enter');
      assert.equal(await drawer.evaluate(el => el.open), false);
      run.checks.push({ name: 'native-disclosure-pointer-and-keyboard', pass: true });
      const navRect = await nav.boundingBox();
      if (setting.width < 640) assert.ok(navRect.y + navRect.height <= setting.height + 1);
      assert.deepEqual(run.errors, []);
      assert.deepEqual(run.consoleErrors, []);
      run.checks.push({ name: 'SSR-console-and-layout', pass: true });
      await page.waitForFunction(() => [...document.images].filter(img => { const rect = img.getBoundingClientRect(); return img.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) && rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.bottom > 0 && rect.left < innerWidth && rect.right > 0; }).every(img => img.complete && img.naturalWidth > 0));
      await page.evaluate(() => Promise.all([...document.images].filter(img => img.complete && img.naturalWidth > 0).map(img => img.decode())));
      await page.screenshot({ path: path.join(output, `home-${setting.width}.png`) });
      await context.close();
    }
    console.log(JSON.stringify({ runs: report.runs.length, passed: report.runs.reduce((n, r) => n + r.checks.length, 0) }));
  } finally { fs.writeFileSync(path.join(output, 'interaction-check.json'), JSON.stringify(report, null, 2)); await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
