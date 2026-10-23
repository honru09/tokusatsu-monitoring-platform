const {chromium}=require('../../workers/crawlers/node_modules/playwright-core');
(async()=>{
const browser=await chromium.launch({headless:true,channel:'chrome'});
const accounts=await(await fetch('http://127.0.0.1:3105/backend/collaboration/accounts')).json();
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addInitScript(id=>localStorage.setItem('kamen-procurement-manager-v1',id),accounts.accounts[0].id);
const page=await context.newPage();page.on('pageerror',e=>console.log('PAGEERROR',e.message));page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text());});page.on('response',r=>{if(r.status()>=400)console.log('BADHTTP',r.status(),r.url());});
await page.goto('http://127.0.0.1:3105/?workspace=resale',{waitUntil:'networkidle'});
console.log((await page.locator('body').innerText()).slice(0,9000));
await page.screenshot({path:'work/editorial-upgrade/inspect-resale.png',fullPage:true});
await browser.close();
})();
