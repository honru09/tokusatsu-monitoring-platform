const fs = require('node:fs');
const {chromium} = require('../workers/crawlers/node_modules/playwright-core');
(async()=>{
 const token=fs.readFileSync('.env','utf8').split(/\r?\n/).find(l=>l.startsWith('XIANYU_SESSION_TOKEN=')).slice('XIANYU_SESSION_TOKEN='.length);
 const response=await fetch('http://localhost:3880/session/start',{method:'POST',headers:{authorization:`Bearer ${token}`}});
 console.log('START',response.status,await response.json());
 if(!response.ok) return;
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9332');
 const page=browser.contexts()[0].pages().find(p=>p.url().includes('goofish.com'));
 await page.getByText('登录',{exact:true}).first().waitFor({timeout:20000}).catch(()=>{});
 console.log('BODY',(await page.locator('body').innerText()).slice(0,1200));
 console.log('HEADERS',await page.locator('header,[class*="header"],[class*="Header"]').evaluateAll(els=>els.slice(0,12).map(e=>({class:e.className,text:e.innerText?.slice(0,160),links:[...e.querySelectorAll('a')].map(a=>({text:a.innerText?.slice(0,60),path:a.getAttribute('href')?.split('?')[0]}))}))));
 const login=page.getByText('登录',{exact:true}).first();if(await login.isVisible().catch(()=>false))await login.click();
 await page.locator('iframe[src*="passport"]').waitFor({timeout:8000}).catch(()=>{});
 console.log('FRAMES',page.frames().map(f=>{const u=new URL(f.url());return{origin:u.origin,path:u.pathname};}));
 await page.screenshot({path:'work/xianyu-normal-login.png'});
 console.log('STATUS',await fetch('http://localhost:3880/session',{headers:{authorization:`Bearer ${token}`}}).then(r=>r.json()));
 await browser.close();
})();
