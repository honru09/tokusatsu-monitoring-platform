'use strict';
const { chromium } = require('../../workers/crawlers/node_modules/playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.APPLE_UI_URL || 'http://127.0.0.1:3105';
const out = path.join(__dirname, 'navigation-communications');
const actors = [
  { id:'11111111-1111-4111-8111-111111111111',key:'manager_one',displayName:'龙',avatarInitial:'龙',position:1,active:true,online:true },
  { id:'22222222-2222-4222-8222-222222222222',key:'manager_two',displayName:'润',avatarInitial:'润',position:2,active:true,online:true },
];
async function navigation(page,label) { await page.getByRole('navigation',{name:'主要工作区'}).getByRole('button',{name:label,exact:true}).click(); }
async function rootState(page) { return page.locator('#workspace-content').evaluate(node=>({ transform:getComputedStyle(node).transform,animations:node.getAnimations().filter(a=>a.playState==='running').length })); }
async function scrolling(page,top) { return page.evaluate(value=>{const node=document.querySelector('#workspace-content');const scrollable=/auto|scroll/.test(getComputedStyle(node).overflowY)&&node.scrollHeight>node.clientHeight+1;if(value!=null){if(scrollable)node.scrollTop=value;else window.scrollTo(0,value);}return scrollable?node.scrollTop:window.scrollY;},top); }
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const reports=[];
 try {
  for(const settings of [{width:1440,height:1000,reducedMotion:'no-preference'},{width:390,height:844,reducedMotion:'no-preference'},{width:390,height:844,reducedMotion:'reduce'}]){
   const context=await browser.newContext({viewport:{width:settings.width,height:settings.height},reducedMotion:settings.reducedMotion});
   await context.addInitScript(id=>localStorage.setItem('kamen-procurement-manager-v1',id),actors[0].id);
   const page=await context.newPage();
   const errors=[],hydrationErrors=[];let interceptedWrites=0,modelCalls=0;
   page.on('pageerror',error=>errors.push(error.message));
   page.on('console',message=>{if(message.type()==='error'&&/hydrat|didn't match/i.test(message.text()))hydrationErrors.push(message.text());});
   await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url()),endpoint=url.pathname.replace(/^\/backend/,'');
    const json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    if(url.pathname==='/operations-browser/'||url.pathname==='/operations-browser')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><meta name="viewport" content="width=device-width"><body>只读运营会话</body></html>'});
    if(endpoint==='/collaboration/accounts')return json({accounts:actors});
    if(endpoint==='/collaboration/messages'&&request.method()==='GET')return json({messages:[],nextAfter:null});
    if(endpoint==='/collaboration/negotiations')return json({cases:[]});
    if(/^\/(ai|analysis)\/(chat|translate|read|analyze)/.test(endpoint)){modelCalls++;return json({message:'验收拦截'});}
    if(!['GET','HEAD','OPTIONS'].includes(request.method())){interceptedWrites++;return json({ok:true});}
    return route.continue();
   });
   await page.goto(`${base}/?workspace=workbench`,{waitUntil:'domcontentloaded'});
   await page.locator('#workbench-title').waitFor();
   assert.deepEqual(await rootState(page),{transform:'none',animations:0},'initial workspace does not animate');
   await page.waitForTimeout(600);
   assert.equal(await page.locator('[data-scroll-entry]').first().evaluate(node=>getComputedStyle(node).transform),'none','workbench stages settle clear');
   await page.screenshot({path:path.join(out,`workbench-${settings.width}-${settings.reducedMotion}.png`)});
   await navigation(page,'AI');
   await page.locator('.assistant-chat').waitFor();
   const entry=await rootState(page);
   if(settings.reducedMotion==='reduce')assert.equal(entry.animations,0);else assert.equal(entry.animations,1);
   await page.evaluate(()=>{window.previousWorkspaceAnimation=document.querySelector('#workspace-content').getAnimations()[0];});
   await navigation(page,'消息');
   await page.locator('.collaboration-chat').waitFor();
   assert.equal(await page.evaluate(()=>!window.previousWorkspaceAnimation||window.previousWorkspaceAnimation.playState==='idle'),true,'previous navigation is cancelled');
   const draft=page.getByRole('textbox',{name:'消息内容',exact:true});
   await draft.fill('尚未发送的协作草稿');
   await navigation(page,'工作台');
   await navigation(page,'消息');
   assert.equal(await draft.inputValue(),'尚未发送的协作草稿','persistent conversation keeps its draft');
   await page.waitForTimeout(550);
   assert.deepEqual(await rootState(page),{transform:'none',animations:0},'rapid transitions release root transform');
   const workbench=page.getByRole('navigation',{name:'主要工作区'}).getByRole('button',{name:'工作台',exact:true});
   await workbench.focus();await page.keyboard.press('Enter');
   await page.locator('#workbench-title').waitFor();
   assert.deepEqual(await rootState(page),{transform:'none',animations:0},'keyboard navigation is immediate');
   await page.getByRole('button',{name:/商品库 比较/}).click();
   await page.locator('.js-product-card:visible').first().waitFor();
   const saved=await scrolling(page,700);
   assert.ok(saved>=699,'catalog scroll reaches 700');
   await navigation(page,'消息');
   await page.goBack();
   await page.locator('.workspace-catalog').waitFor();
   await page.waitForTimeout(550);
   assert.ok(Math.abs((await scrolling(page,null))-700)<=1,'history restores 700px');
   await navigation(page,'工作台');
   await page.getByRole('button',{name:/运营台 运行任务/}).click();
   const frame=page.locator('iframe[data-operations-frame]');
   await frame.waitFor();
   await frame.evaluate(node=>node.dataset.instanceCheck='same');
   await navigation(page,'消息');
   await page.goBack();
   await frame.waitFor();
   assert.equal(await frame.getAttribute('data-instance-check'),'same','operations iframe is preserved');
   await page.waitForTimeout(550);
   assert.equal((await rootState(page)).transform,'none');
   assert.deepEqual(errors,[]);assert.deepEqual(hydrationErrors,[]);assert.equal(modelCalls,0);
   reports.push({...settings,initialImmediate:true,rapidCancel:true,draftPreserved:true,scroll700Restored:true,keyboardImmediate:true,iframePreserved:true,rootTransformClear:true,interceptedWrites,realModelCalls:0,pageErrors:errors,hydrationErrors});
   console.log(JSON.stringify(reports.at(-1)));
   await context.close();
  }
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(reports,null,2));
 } finally {await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
