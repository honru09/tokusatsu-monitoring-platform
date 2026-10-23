const {chromium}=require('../workers/crawlers/node_modules/playwright-core');
(async()=>{const b=await chromium.connectOverCDP('http://127.0.0.1:9332');const p=await b.contexts()[0].newPage();
await p.goto('https://www.goofish.com/publish',{waitUntil:'domcontentloaded',timeout:20000});
await p.locator('body').filter({hasText:'发布'}).waitFor({timeout:12000}).catch(()=>{});
console.log('BODY',(await p.locator('body').innerText()).slice(0,2400));
console.log('FORM',await p.locator('input,textarea,button,[contenteditable]').evaluateAll(els=>els.map(e=>({tag:e.tagName,type:e.type,name:e.name,placeholder:e.placeholder,aria:e.getAttribute('aria-label'),text:e.tagName==='BUTTON'?e.innerText:undefined,contenteditable:e.getAttribute('contenteditable')}))));
await p.screenshot({path:'work/xianyu-publish-form.png'});
await p.close();await b.close();})();
