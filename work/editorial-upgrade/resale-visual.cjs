const {chromium}=require('../../workers/crawlers/node_modules/playwright-core');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const target=process.env.RESALE_UI_URL || 'http://127.0.0.1:3105';
const output='work/editorial-upgrade';
fs.mkdirSync(output,{recursive:true});
(async()=>{
const accounts=await(await fetch(`${target}/backend/collaboration/accounts`)).json();
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:768,height:1024},{width:1280,height:900},{width:1440,height:1000}]) {
    const context=await browser.newContext({viewport,reducedMotion:viewport.width===768?'reduce':'no-preference'});
    await context.addInitScript(id=>localStorage.setItem('kamen-procurement-manager-v1',id),accounts.accounts[0].id);
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    // This visual inspection may read data, but cannot send any mutation or model request.
    await page.route(url=>url.pathname.startsWith('/backend/'),async route=>{if(route.request().method()!=='GET')return route.abort('blockedbyclient');return route.continue();});
    await page.goto(`${target}/?workspace=resale`,{waitUntil:'domcontentloaded'});
    const workspace=page.getByRole('region',{name:'闲鱼运营',exact:true});
    const first=workspace.locator('[aria-label="上架商品列表"] button[aria-pressed]').first();await first.waitFor();
    await page.screenshot({path:path.join(output,`resale-list-${viewport.width}.png`)});
    await first.click();await workspace.getByLabel('标题',{exact:true}).waitFor();
    if(viewport.width>=1000)await workspace.getByRole('heading',{name:'商品编辑',exact:true}).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const small=await workspace.locator('button:visible,select:visible,input:not([type="checkbox"]):visible,summary:visible').evaluateAll(nodes=>nodes.filter(node=>node.getBoundingClientRect().height<43).map(node=>node.textContent));assert.deepEqual(small,[]);
    await page.screenshot({path:path.join(output,`resale-editor-${viewport.width}.png`)});
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({viewport:viewport.width,passed:['real-read-only-data','list-to-editor','44px-controls','no-overflow','no-page-errors']}));
    await context.close();
  }
} finally {await browser.close();}
})();
