'use strict';
const { chromium } = require('../../workers/crawlers/node_modules/playwright-core');
const base = 'http://127.0.0.1:3105';
(async () => {
  const accounts = await (await fetch(`${base}/backend/collaboration/accounts`)).json();
  const overview = await (await fetch(`${base}/backend/monitoring/overview`)).json();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const report = { pageerror: [], consoleError: [], failedRequests: [], badResponses: [], intercepted: [], steps: [], overlay: [] };
  try {
    for (const setting of [{ width: 1440, reducedMotion: 'no-preference' }, { width: 390, reducedMotion: 'reduce' }]) {
      const { width, reducedMotion } = setting;
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion });
      await context.addInitScript(id => localStorage.setItem('kamen-procurement-manager-v1', id), accounts.accounts[0].id);
      const page = await context.newPage();
      page.on('pageerror', error => report.pageerror.push({ width, message: error.message, stack: error.stack?.slice(0, 5000) }));
      page.on('console', message => { if (message.type() === 'error') report.consoleError.push({ width, text: message.text().slice(0, 5000) }); });
      page.on('requestfailed', request => report.failedRequests.push({ width, path: new URL(request.url()).pathname, message: request.failure()?.errorText }));
      page.on('response', response => { if (response.status() >= 400) report.badResponses.push({ width, path: new URL(response.url()).pathname, status: response.status() }); });
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname === '/backend/monitoring/overview') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overview) });
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || /\/analysis(?:\/|$)/.test(url.pathname) || /\/ai\/(chat|translate|read|analyze)/.test(url.pathname)) {
          report.intercepted.push({ width, method: request.method(), path: url.pathname });
          return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        }
        return route.continue();
      });
      for (const workspace of ['resale']) {
        await page.goto(`${base}/?workspace=${workspace}`, { waitUntil: 'domcontentloaded' });
        await page.locator(`.workspace-${workspace}`).waitFor({ timeout: 15000 });
        await page.waitForTimeout(700);
      }
      for (const label of ['消息', 'AI', '首页', '工作台']) {
        try {
          await page.getByRole('navigation', { name: '主要工作区' }).getByRole('button', { name: label, exact: true }).click({ timeout: 6000 });
          report.steps.push({ width, label, clicked: true });
        } catch (error) { report.steps.push({ width, label, error: error.message.slice(0, 2000) }); break; }
      }
      const overlay = await page.evaluate(() => {
        const portals = [...document.querySelectorAll('nextjs-portal')];
        function texts(root) {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          const output = []; let node;
          while (node = walker.nextNode()) if (!node.parentElement?.closest('style,script') && node.textContent.trim()) output.push(node.textContent.trim());
          return output.concat([...root.querySelectorAll('*')].filter(node => node.shadowRoot).map(node => texts(node.shadowRoot))).join('\n');
        }
        return portals.map(portal => ({ text: portal.shadowRoot ? texts(portal.shadowRoot).slice(0, 14000) : portal.textContent, rect: { x: portal.getBoundingClientRect().x, y: portal.getBoundingClientRect().y } }));
      });
      report.overlay.push({ width, reducedMotion, portals: overlay });
      await context.close();
    }
  } finally { await browser.close(); }
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
