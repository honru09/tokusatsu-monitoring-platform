'use strict';
const {chromium}=require('../../workers/crawlers/node_modules/playwright-core');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const target='http://localhost:3000';
const artifactDir=__dirname;
async function read(endpoint){const response=await fetch(`${target}/backend/${endpoint}`);assert.ok(response.ok,`${endpoint}: ${response.status}`);return response.json();}
function state(data){return {settings:{paused:data.settings.paused,autoPublish:data.settings.autoPublish,autoMetrics:data.settings.autoMetrics},listings:data.listings.map(row=>({id:row.id,version:row.version,title:row.title,status:row.status,priceCny:row.priceCny,rightsConfirmed:row.rightsConfirmed,fulfillmentConfirmed:row.fulfillmentConfirmed})).sort((a,b)=>a.id.localeCompare(b.id))};}
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
(async()=>{
 const [accounts,before,session]=await Promise.all([read('collaboration/accounts'),read('resale'),read('resale/account')]);
 assert.equal(session.authenticated,true);
 assert.equal(before.settings.paused,true);assert.equal(before.settings.autoPublish,false);
 const first=before.listings[0];assert.ok(first);
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const checks=[];
 try{
  for(const width of [1440,390,320]){
   const context=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'});
   await context.addInitScript(actor=>localStorage.setItem('kamen-procurement-manager-v1',actor),accounts.accounts[0].id);
   const page=await context.newPage();const errors=[];const blocked=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>{
    const request=route.request();
    if(!['GET','HEAD','OPTIONS'].includes(request.method())){
     blocked.push({method:request.method(),path:new URL(request.url()).pathname});
     return route.fulfill({status:200,contentType:'application/json',body:'{}'});
    }
    return route.continue();
   });
   await page.goto(`${target}/?workspace=resale`,{waitUntil:'domcontentloaded'});
   const workspace=page.getByRole('region',{name:'闲鱼上架',exact:true});
   await workspace.getByText('已登录',{exact:true}).waitFor();
   await workspace.getByRole('button',{name:new RegExp(escape(first.title.slice(0,12).replace(/\s+/g,' ')))}).first().click();
   const editor=workspace.getByRole('region',{name:'编辑上架商品',exact:true});
   const title=editor.getByLabel('标题',{exact:true});await title.waitFor();
   await page.waitForFunction(()=>[...document.querySelectorAll('[aria-label="商品图片管理"] img')].every(img=>img.complete&&img.naturalWidth>0),{},{timeout:20000});
   assert.equal(await editor.getByRole('button',{name:'设为封面',exact:true}).count(),0);
   await title.fill(first.title.slice(0,59)+' ');
   await editor.getByRole('button',{name:'保存修改',exact:true}).waitFor({state:'visible'});
   await editor.getByRole('heading',{name:'商品编辑',exact:true}).scrollIntoViewIfNeeded();
   const visual=await workspace.evaluate(node=>{
    const short=[...node.querySelectorAll('button,select,input:not([type="checkbox"]),summary')].filter(el=>el.getClientRects().length&&el.getBoundingClientRect().height<43).map(el=>el.getAttribute('aria-label')||el.textContent);
    const primary=[...node.querySelectorAll('footer button[class*="publishAction"]')].filter(el=>el.getClientRects().length);
    const style=getComputedStyle(primary[0]);
    const luminance=value=>{const channels=value.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;};
    const a=luminance(style.color),b=luminance(style.backgroundColor);
    return {short,overflow:document.documentElement.scrollWidth>innerWidth,primaryCount:primary.length,primaryHeight:primary[0].getBoundingClientRect().height,primaryContrast:Number(((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toFixed(2)),thumbnailWidth:node.querySelector('[aria-label="商品图片管理"] button').getBoundingClientRect().width};
   });
   assert.deepEqual(visual.short,[]);assert.equal(visual.overflow,false);assert.equal(visual.primaryCount,1);assert.ok(visual.primaryHeight>=48);assert.ok(visual.primaryContrast>=4.5);
   await page.screenshot({path:path.join(artifactDir,`real-simplified-${width}.png`)});
   await workspace.getByLabel('更多页面操作',{exact:true}).click();
   await workspace.getByRole('button',{name:'自动化设置',exact:true}).waitFor();
   await page.keyboard.press('Escape');
   assert.equal(await workspace.getByRole('button',{name:'自动化设置',exact:true}).count(),0);
   assert.deepEqual(errors,[]);
   assert.equal(blocked.filter(row=>/\/(ai|analysis|resale)(?:\/|$)/.test(row.path)).length,0);
   checks.push({width,...visual,pageErrors:errors,blockedWrites:blocked});
   await context.close();
  }
 }finally{await browser.close();}
 const after=await read('resale');assert.deepEqual(state(after),state(before));
 const evidence={authenticated:session.authenticated,capabilities:session.capabilities,before:state(before),after:state(after),checks,note:'真实商品 GET 数据；所有写入拦截，标题编辑只存在于隔离浏览器，未保存。'};
 fs.writeFileSync(path.join(artifactDir,'live-verification.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence));
})().catch(error=>{console.error(error);process.exitCode=1;});
