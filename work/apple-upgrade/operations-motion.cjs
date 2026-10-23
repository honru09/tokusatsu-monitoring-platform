const {chromium}=require('../../workers/crawlers/node_modules/playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const target='http://127.0.0.1:3105';
const report={target,checks:[],blocked:[],errors:[]};
const logistics={id:'motion-product',titleRaw:'商品参数核算',titleZh:'商品参数核算',priceCurrent:10000,favorite:true,source:{key:'mercari',displayName:'Mercari'},images:[],logistics:{weightGrams:100,packageWeightGrams:150,lengthMm:120,widthMm:80,heightMm:60,estimatedSalePriceYen:18000}};
async function position(locator){return locator.evaluate(el=>{const t=getComputedStyle(el).transform,m=t==='none'?null:new DOMMatrixReadOnly(t);return {transform:t,y:m?.m42||0,scale:m?.a||1,opacity:getComputedStyle(el).opacity};});}
async function frame(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
(async()=>{
const accounts=await(await fetch(target+'/backend/collaboration/accounts')).json();
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
for(const settings of [{width:390,height:844,motion:'no-preference'},{width:390,height:568,motion:'reduce'},{width:1440,height:1000,motion:'no-preference'}]){
const context=await browser.newContext({viewport:{width:settings.width,height:settings.height},reducedMotion:settings.motion});
await context.addInitScript(actor=>localStorage.setItem('kamen-procurement-manager-v1',actor),accounts.accounts[0].id);
const page=await context.newPage();page.setDefaultTimeout(60000);
page.on('pageerror',error=>report.errors.push(error.message));
await page.route('**/*',async route=>{
const r=route.request(),url=new URL(r.url()),suffix=url.pathname.replace(/^\/backend/,'');
const json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
if(r.method()!=='GET'||/^\/analysis(?:\/|$)|\/(predict|translate|chat|models?)(?:\/|$)/.test(suffix)){report.blocked.push({method:r.method(),path:suffix});return json({message:'UI验证拦截写入和模型'},403);}
if(!url.pathname.startsWith('/backend/'))return route.continue();
if(suffix==='/collaboration/accounts')return json(accounts);
if(suffix==='/logistics/items')return json({items:[logistics]});
if(suffix==='/logistics/carriers')return json({carriers:[{id:'fixture-carrier',displayName:'测试快递',enabled:true}]});
if(suffix==='/monitoring/config')return json({keywords:[],platforms:[{key:'mercari',displayName:'Mercari',enabled:true}],categories:[{id:'category-a',name:'分类 A',scope:'toys',_count:{items:3}},{id:'category-b',name:'分类 B',scope:'general',_count:{items:2}}]});
return route.continue();
});
await page.goto(target+'/?workspace=calculator',{waitUntil:'domcontentloaded'});
const calc=page.locator('.procurement-calculator'),layout=calc.locator('.procurement-calc-layout');
await calc.getByLabel('商品数量',{exact:true}).fill('30');
await calc.getByLabel('日本整批商品报价',{exact:true}).fill('10000');
await calc.getByLabel('预计国内整批售价',{exact:true}).fill('20000');
await calc.getByRole('button',{name:'对内 · 实际收益',exact:true}).focus();await page.keyboard.press('Enter');
const actual=calc.getByLabel('实际整批采购价',{exact:true});await actual.waitFor();await frame(page);
const keyboard=await position(layout);assert.equal(await calc.getAttribute('data-keyboard-motion'),'true');assert.equal(keyboard.y,0);assert.equal(keyboard.scale,1);assert.equal(keyboard.opacity,'1');
const before=await actual.boundingBox();await actual.fill('9000');await frame(page);const after=await actual.boundingBox();assert.ok(Math.abs(before.y-after.y)<1);assert.ok(Math.abs(before.height-after.height)<1);
report.checks.push({name:'keyboard view change is immediate; number entry does not move',settings,keyboard,before,after});
for(const name of ['对外 · 客户报价','对内 · 实际收益','对外 · 客户报价','对内 · 实际收益'])await calc.getByRole('button',{name,exact:true}).click();
await actual.waitFor();assert.equal(await actual.inputValue(),'9000');assert.equal(await calc.getByRole('button',{name:'对内 · 实际收益',exact:true}).getAttribute('aria-pressed'),'true');
await page.waitForFunction(()=>{const e=document.querySelector('.procurement-calc-layout'),s=getComputedStyle(e),m=s.transform==='none'?null:new DOMMatrixReadOnly(s.transform);return s.opacity==='1'&&(!m||Math.abs(m.m42)<.01&&Math.abs(m.a-1)<.001);});
report.checks.push({name:'rapid pointer mode reversals settle on last target and preserve draft',settings,final:await position(layout)});
await page.goto(target+'/?workspace=logistics',{waitUntil:'domcontentloaded'});
const shipping=page.locator('.logistics-workspace');await shipping.getByRole('button',{name:/商品参数核算/}).click();
const disclosure=shipping.getByRole('button',{name:'商品参数 · 1 件',exact:true});
await disclosure.click();await disclosure.click();await disclosure.click();
const weight=shipping.getByLabel('商品重量',{exact:true});await weight.waitFor();await weight.fill('300');assert.equal(await weight.inputValue(),'300');assert.equal(await disclosure.getAttribute('aria-expanded'),'true');
await disclosure.focus();await page.keyboard.press('Space');await frame(page);assert.equal(await disclosure.getAttribute('aria-expanded'),'false');
await page.keyboard.press('Space');await frame(page);assert.equal(await disclosure.getAttribute('aria-expanded'),'true');assert.equal(await weight.inputValue(),'300');
report.checks.push({name:'accordion reverses without waiting and keyboard toggles preserve inputs',settings,rootKeyboard:await shipping.getAttribute('data-keyboard-motion')});
await page.goto(target+'/?workspace=monitoring',{waitUntil:'domcontentloaded'});
const monitoring=page.locator('.mcfg-workspace');await monitoring.getByRole('button',{name:'添加关键词',exact:true}).first().focus();await page.keyboard.press('Enter');
const dialog=page.getByRole('dialog');await dialog.waitFor();await frame(page);const dialogState=await position(dialog);assert.equal(dialogState.y,0);assert.equal(dialogState.scale,1);assert.equal(dialogState.opacity,'1');await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);
for(const name of ['分类 A','分类 B','分类 A','分类 B'])await monitoring.getByRole('button',{name:new RegExp('^'+name)}).click();
assert.equal(await monitoring.getByRole('button',{name:/^分类 B/}).getAttribute('aria-pressed'),'true');assert.equal(await monitoring.getByRole('button',{name:/^分类 A/}).getAttribute('aria-pressed'),'false');
report.checks.push({name:'monitor dialog keyboard entry is immediate and category reversals keep last selection',settings,dialog:dialogState});
await context.close();
}
assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await browser.close();fs.writeFileSync('work/apple-upgrade/operations-motion.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors}));
})().catch(error=>{report.error=error.stack;fs.writeFileSync('work/apple-upgrade/operations-motion.json',JSON.stringify(report,null,2));console.error(error);process.exitCode=1;});
