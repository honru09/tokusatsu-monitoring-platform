'use strict';
const { chromium } = require('../../workers/crawlers/node_modules/playwright-core');
const base = 'http://127.0.0.1:3000';
function imageState(nodes) {
  return nodes.filter(img => { const r = img.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; }).map(img => {
    const style = getComputedStyle(img), url = new URL(img.currentSrc || img.src);
    const ancestors = [];
    for (let node = img.parentElement; node && node.tagName !== 'BODY'; node = node.parentElement) {
      const css = getComputedStyle(node);
      if (css.opacity !== '1' || css.transform !== 'none' || css.visibility !== 'visible' || css.clipPath !== 'none') ancestors.push({ tag: node.tagName, opacity: css.opacity, transform: css.transform, visibility: css.visibility, clipPath: css.clipPath });
    }
    return { alt: img.alt, source: url.origin + url.pathname, complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, transform: style.transform, opacity: style.opacity, visibility: style.visibility, clipPath: style.clipPath, ancestors };
  });
}
(async () => {
  const accounts = await (await fetch(`${base}/backend/collaboration/accounts`)).json();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const reports = [];
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      await context.addInitScript(id => localStorage.setItem('kamen-procurement-manager-v1', id), accounts.accounts[0].id);
      const page = await context.newPage();
      const report = { viewport, imageFailures: [], consoleError: [], pageerror: [], early: [], settled: [] };
      page.on('pageerror', error => report.pageerror.push(error.message));
      page.on('console', message => { if (message.type() === 'error') report.consoleError.push(message.text().slice(0, 1500)); });
      page.on('requestfailed', request => { if (request.resourceType() === 'image') report.imageFailures.push({ source: new URL(request.url()).origin + new URL(request.url()).pathname, failure: request.failure()?.errorText }); });
      page.on('response', response => { if (response.request().resourceType() === 'image' && response.status() >= 400) report.imageFailures.push({ source: new URL(response.url()).origin + new URL(response.url()).pathname, status: response.status() }); });
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || /\/analysis(?:\/|$)/.test(url.pathname) || /\/ai\/(chat|translate|read|analyze)/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return route.continue();
      });
      await page.goto(`${base}/?workspace=resale`, { waitUntil: 'domcontentloaded' });
      const region = page.getByRole('region', { name: '闲鱼运营', exact: true });
      await region.locator('[aria-label="上架商品列表"] button[aria-pressed]').first().click();
      await region.getByLabel('标题', { exact: true }).waitFor();
      const start = Date.now();
      report.early = await region.locator('img').evaluateAll(imageState);
      try {
        await page.waitForFunction(() => {
          const root = document.querySelector('section[aria-labelledby="resale-title"]');
          return [...root.querySelectorAll('img')].filter(img => { const r = img.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; }).every(img => img.complete);
        }, null, { timeout: 30000 });
      } catch { report.loadTimeout = true; }
      report.waitMs = Date.now() - start;
      report.settled = await region.locator('img').evaluateAll(imageState);
      await page.screenshot({ path: `work/apple-motion/production/resale-images-settled-${viewport.width}.png` });
      reports.push(report);
      await context.close();
    }
  } finally { await browser.close(); }
  console.log(JSON.stringify(reports, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
