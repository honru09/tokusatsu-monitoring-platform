'use strict';
const fs = require('node:fs');
const {chromium} = require('../workers/crawlers/node_modules/playwright-core');
const token = fs.readFileSync('.env','utf8').match(/^XIANYU_SESSION_TOKEN=(.+)$/m)?.[1].trim();
const headers = {authorization:`Bearer ${token}`,'content-type':'application/json'};
(async()=>{
  const status = await (await fetch('http://127.0.0.1:3880/session',{headers,signal:AbortSignal.timeout(10000)})).json();
  console.log(JSON.stringify({session:status.state,search:status.capabilities?.search}));
  if(status.authenticated){
    const response = await fetch('http://127.0.0.1:3880/search',{method:'POST',headers,body:JSON.stringify({keyword:'假面骑士',limit:3}),signal:AbortSignal.timeout(30000)});
    const result = await response.json();
    console.log(JSON.stringify({searchStatus:response.status,items:result.items?.length,message:result.message,valid:result.items?.every(item=>/^https:\/\/www\.goofish\.com\/item\?id=\d+$/.test(item.targetUrl)&&item.priceCny>0)}));
  }
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9332',{timeout:5000});
  let page;
  try {
    page = await browser.contexts()[0].newPage();
    await page.goto('https://www.goofish.com/publish',{waitUntil:'domcontentloaded',timeout:20000});
    const file = page.locator('input[name="file"][type="file"]');
    await file.waitFor({state:'attached',timeout:12000});
    console.log('uploadContainer',await file.evaluate(e=>e.parentElement.parentElement.outerHTML.slice(0,6500)));
  }finally{await page?.close().catch(()=>{});await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
