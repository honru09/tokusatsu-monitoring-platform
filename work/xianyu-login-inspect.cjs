const {chromium}=require('../workers/crawlers/node_modules/playwright-core');
(async()=>{const b=await chromium.connectOverCDP('http://127.0.0.1:9332'); const p=b.contexts()[0].pages().find(p=>p.url().includes('goofish.com'));
console.log('LINKS',JSON.stringify(await p.locator('a,button,[role="button"]').evaluateAll(els=>els.filter(e=>!e.closest('[class*="feeds"],[class*="goods"],[class*="card"]')).slice(0,65).map(e=>({tag:e.tagName,text:e.textContent?.trim().slice(0,70),title:e.title,aria:e.getAttribute('aria-label'),path:e.href ? new URL(e.href).pathname:null,queryKeys:e.href ? [...new URL(e.href).searchParams.keys()]:[]}))),null,2));
console.log('FRAMES',p.frames().map(f=>{let u=new URL(f.url());return{origin:u.origin,path:u.pathname};}));
for(const f of p.frames()) if(/passport/.test(f.url()))console.log('LOGIN_TEXT',await f.locator('body').innerText());
await p.screenshot({path:'work/xianyu-normal-login.png'}); await b.close();})();
