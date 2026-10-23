const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  try {
    await page.goto('https://www.goofish.com/', {waitUntil: 'domcontentloaded', timeout: 30000});
    await page.getByText('登录', {exact:true}).first().waitFor({timeout:20000}).catch(()=>{});
    console.log('BODY', (await page.locator('body').innerText()).slice(0,1600));
    const login = page.getByText('登录', {exact:true}).first();
    if(await login.isVisible()) await login.click();
    await page.locator('iframe').first().waitFor({timeout:15000}).catch(()=>{});
    console.log('FRAMES', page.frames().map(f=> { const u=new URL(f.url()); return { origin:u.origin, path:u.pathname, keys:[...u.searchParams.keys()] }; }));
    for(const f of page.frames()) {
      if(f === page.mainFrame()) continue;
      console.log('LOGIN_UI', (await f.locator('body').innerText()).slice(0,1300));
      console.log('QR_LOCATORS', await f.locator('canvas, img, .qrcode-img, .qrcode-login').evaluateAll(els=>els.slice(0,8).map(e=>({tag:e.tagName,class:e.className,width:e.clientWidth,height:e.clientHeight}))));
    }
    await page.screenshot({ path: 'work/xianyu-probe.png' });
  } finally { await browser.close(); }
})();
